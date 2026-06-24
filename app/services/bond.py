"""
Core bond service: orchestrates tier/pool management and order lifecycle.
"""
import hashlib
import json
import logging
import os
import time

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.crypto.aes import decrypt_bytes, encrypt_bytes, encrypt_cert
from app.crypto.bip46 import derive_bond_from_xprv, next_available_index
from app.crypto.certificate import sign_bond_cert
from app.crypto.nostr import normalize_public_key
from app.models import BondOrder, BondPool, BondTier, OrderState, PoolStatus
from app.repository import OrderRepository, PoolRepository, TierRepository
from app.services.electrs import electrs_client
from app.services.lnbits import lnbits_client
from app.services.cln import cln_client

logger = logging.getLogger("uvicorn")

_SERVER_KEY = bytes.fromhex(settings.preimage_encryption_key)


def _encrypt_preimage(r: bytes) -> str:
    """Store preimage_r encrypted at rest using the server key."""
    ct, nonce = encrypt_bytes(r, _SERVER_KEY)
    return f"{nonce}:{ct}"


def _decrypt_preimage(enc: str) -> bytes:
    nonce_hex, ct_b64 = enc.split(":", 1)
    return decrypt_bytes(ct_b64, nonce_hex, _SERVER_KEY)


class BondService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.tiers = TierRepository(session)
        self.pools = PoolRepository(session)
        self.orders = OrderRepository(session)

    # ── Tier management ──────────────────────────────────────────────────────

    async def create_tier(
        self,
        name: str,
        description: str,
        max_slots: int,
        bond_sats: int,
        timelock_duration_months: int,
        fee_rate: float | None = None,
    ) -> BondTier:
        return await self.tiers.create(
            name=name,
            description=description,
            max_slots=max_slots,
            bond_sats=bond_sats,
            timelock_duration_months=timelock_duration_months,
            fee_rate=fee_rate if fee_rate is not None else settings.default_fee_rate,
        )

    async def list_tiers(self) -> list[BondTier]:
        return await self.tiers.list_active()

    # ── Pool management ───────────────────────────────────────────────────────

    async def create_pool(
        self,
        tier_id: str,
        timelock_index: int | None = None,
    ) -> BondPool:
        tier = await self.tiers.get_by_id(tier_id)
        if not tier:
            raise ValueError(f"Tier {tier_id} not found")

        # Pick the next suitable BIP46 index if not specified
        if timelock_index is None:
            timelock_index = next_available_index(0, tier.timelock_duration_months)

        bond = derive_bond_from_xprv(settings.bip46_xprv, timelock_index)
        pool = await self.pools.create(
            tier_id=tier_id,
            timelock_index=timelock_index,
            timelock_expiry=bond.timelock_ts,
            timelocked_address=bond.address,
            bond_pubkey_hex=bond.pubkey_hex,
            witness_script_hex=bond.witness_script_hex,
            status=PoolStatus.PENDING_FUNDING,
            used_slots=0,
        )
        logger.info(f"Created pool {pool.id} at address {bond.address} (index={timelock_index})")
        return pool

    async def fund_pool_via_cln(self, pool_id: str) -> str:
        """Trigger CLN on-chain withdraw to the pool's BIP46 address. Returns txid."""
        pool = await self.pools.get_by_id(pool_id)
        if not pool:
            raise ValueError(f"Pool {pool_id} not found")
        if pool.status != PoolStatus.PENDING_FUNDING:
            raise ValueError(f"Pool is not in PENDING_FUNDING state: {pool.status}")

        tier = pool.tier
        result = await cln_client.withdraw(pool.timelocked_address, tier.bond_sats)
        txid = result["txid"]
        await self.pools.update(pool_id, funding_txid=txid)
        logger.info(f"Pool {pool_id} funded via CLN: txid={txid}")
        return txid

    async def record_pool_utxo(
        self, pool_id: str, txid: str, vout: int, sats: int | None = None
    ) -> None:
        """Manually record UTXO (used when funding externally or after CLN withdraw)."""
        pool = await self.pools.get_by_id(pool_id)
        if not pool:
            raise ValueError(f"Pool {pool_id} not found")
        updates: dict = {"utxo_txid": txid, "utxo_vout": vout}
        if sats:
            updates["utxo_sats"] = sats
        await self.pools.update(pool_id, **updates)

    # ── Order lifecycle ───────────────────────────────────────────────────────

    async def create_order(self, tier_id: str, npub: str) -> BondOrder:
        """
        Core purchase flow:
        1. Resolve npub to hex
        2. Find available pool slot
        3. Generate preimage_r, build cert, encrypt it
        4. Create LNbits invoice with preimage=r
        5. Save order
        """
        npub_hex = normalize_public_key(npub)

        tier = await self.tiers.get_by_id(tier_id)
        if not tier or not tier.is_active:
            raise ValueError("Tier not found or inactive")

        pool = await self.pools.get_available_for_tier(tier_id)
        if not pool:
            raise ValueError("No bond slots available for this tier; check back later")
        if not pool.utxo:
            raise ValueError("Bond pool is not funded yet")

        # Calculate pricing
        price_sats = tier.price_per_slot_sats
        bond_sats = pool.utxo_sats // tier.max_slots if pool.utxo_sats else tier.bond_sats // tier.max_slots

        # Generate preimage_r and payment hash
        preimage_r = os.urandom(32)
        preimage_hash = hashlib.sha256(preimage_r).hexdigest()

        # Build the raw cert fields the client needs to assemble the kind 30600 event.
        # The client signs the Nostr event with their own key — Nostr stays client-side.
        bond_sig = sign_bond_cert(
            settings.bip46_xprv,
            pool.timelock_index,
            npub_hex,
            pool.timelock_expiry,
        )
        cert_data = {
            "bond_sig": bond_sig,
            "xpub": settings.bip46_xpub,
            "utxo": pool.utxo,
            "timelock_index": pool.timelock_index,
            "expiry": pool.timelock_expiry,
        }
        cert_json = json.dumps(cert_data, separators=(",", ":"))

        # Encrypt cert with preimage_r
        encrypted_cert, cert_nonce = encrypt_cert(cert_json, preimage_r)

        # Create Lightning invoice with custom preimage
        expires_at = int(time.time()) + settings.invoice_expiry_seconds
        webhook_url = f"{settings.service_base_url}/api/v1/webhook/payment"
        invoice_data = await lnbits_client.create_invoice(
            amount_sats=price_sats,
            memo=f"Fidelity bond certificate — {tier.name}",
            preimage_hex=preimage_r.hex(),
            expiry_seconds=settings.invoice_expiry_seconds,
            webhook_url=webhook_url,
        )

        # Atomically reserve slot and save order
        await self.pools.increment_used_slots(pool.id)
        order = await self.orders.create(
            pool_id=pool.id,
            tier_id=tier_id,
            beneficiary_npub=npub_hex,
            bond_sats=bond_sats,
            price_sats=price_sats,
            state=OrderState.PENDING_PAYMENT,
            preimage_hash=preimage_hash,
            preimage_r_enc=_encrypt_preimage(preimage_r),
            payment_request=invoice_data["payment_request"],
            encrypted_cert=encrypted_cert,
            cert_nonce=cert_nonce,
            lnbits_payment_hash=invoice_data["payment_hash"],
            expires_at=expires_at,
        )
        logger.info(f"Order {order.id} created for npub={npub_hex[:16]}... tier={tier.name}")
        return order

    async def handle_payment_confirmed(self, payment_hash: str) -> None:
        """Called by webhook when LNbits confirms a payment. Transitions order to PAID."""
        order = await self.orders.get_by_payment_hash(payment_hash)
        if not order:
            logger.warning(f"Payment webhook: no order for payment_hash={payment_hash}")
            return
        if order.state != OrderState.PENDING_PAYMENT:
            logger.info(f"Order {order.id} already in state {order.state}, skipping")
            return
        await self.orders.update(
            order.id,
            state=OrderState.PAID,
            paid_at=int(time.time()),
        )
        logger.info(f"Order {order.id} PAID — cert ready for decryption")

    async def expire_pending_orders(self) -> int:
        """Mark PENDING_PAYMENT orders as EXPIRED if past expiry. Returns count."""
        expired = await self.orders.get_expired_pending()
        count = 0
        for order in expired:
            await self.orders.update(order.id, state=OrderState.EXPIRED)
            await self.pools.decrement_used_slots(order.pool_id)
            logger.info(f"Order {order.id} expired, slot returned to pool {order.pool_id}")
            count += 1
        return count

    async def check_pending_pools(self) -> int:
        """Poll electrs for UTXO confirmation on PENDING_FUNDING pools. Returns count activated."""
        pending = await self.pools.get_by_status(PoolStatus.PENDING_FUNDING)
        activated = 0
        for pool in pending:
            if not pool.utxo_txid:
                # Try to find the UTXO on-chain from the pool address
                try:
                    tier = pool.tier
                    result = await electrs_client.find_utxo_for_address(
                        pool.timelocked_address, tier.bond_sats if tier else 0
                    )
                    if result:
                        txid, vout, sats = result
                        await self.pools.update(
                            pool.id,
                            utxo_txid=txid,
                            utxo_vout=vout,
                            utxo_sats=sats,
                        )
                        pool_updated = await self.pools.get_by_id(pool.id)
                        if pool_updated:
                            pool = pool_updated
                except Exception as exc:
                    logger.warning(f"Pool {pool.id} electrs scan failed: {exc}")
                    continue

            if pool.utxo_txid:
                try:
                    confirmed = await electrs_client.is_utxo_confirmed(
                        pool.utxo_txid,
                        pool.utxo_vout or 0,
                        min_confirmations=settings.utxo_min_confirmations,
                    )
                    if confirmed:
                        await self.pools.update(
                            pool.id,
                            status=PoolStatus.AVAILABLE,
                            confirmed_at=int(time.time()),
                        )
                        logger.info(f"Pool {pool.id} CONFIRMED and now AVAILABLE for sales")
                        activated += 1
                except Exception as exc:
                    logger.warning(f"Pool {pool.id} confirmation check failed: {exc}")
        return activated
