"""Bond service: orchestrates bond management and order lifecycle."""
import hashlib
import json
import logging
import os
import time
from urllib.parse import urlencode

from lnurl.models import AesAction
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.crypto.aes import decrypt_bytes, decrypt_cert, encrypt_bytes, encrypt_cert, encrypt_lud10_success_action
from app.crypto.bip46 import derive_bond_from_xprv, next_available_index
from app.crypto.certificate import sign_bond_cert
from app.crypto.nostr import normalize_public_key
from app.models import Bond, BondOrder, BondStatus, OrderState
from app.repository import BondRepository, OrderRepository
from app.services.lnbits import lnbits_client

logger = logging.getLogger("uvicorn")

_SERVER_KEY = bytes.fromhex(settings.preimage_encryption_key)


def _payment_webhook_url() -> str:
    base = settings.service_base_url.rstrip("/")
    token = urlencode({"secret": settings.lnbits_webhook_secret})
    return f"{base}/api/v1/webhook/payment?{token}"


def _encrypt_preimage(r: bytes) -> str:
    ct, nonce = encrypt_bytes(r, _SERVER_KEY)
    return f"{nonce}:{ct}"


def _decrypt_preimage(enc: str) -> bytes:
    nonce_hex, ct_b64 = enc.split(":", 1)
    return decrypt_bytes(ct_b64, nonce_hex, _SERVER_KEY)


class BondService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.bonds = BondRepository(session)
        self.orders = OrderRepository(session)

    # ── Bond management ───────────────────────────────────────────────────────

    async def create_bond(
        self,
        name: str,
        description: str,
        max_slots: int,
        bond_sats: int,
        fee_rate: float,
        timelock_index: int | None = None,
        timelock_duration_months: int | None = None,
    ) -> Bond:
        if timelock_index is None:
            if timelock_duration_months is None:
                raise ValueError("Either timelock_index or timelock_duration_months is required")
            timelock_index = next_available_index(0, timelock_duration_months)

        bip46 = derive_bond_from_xprv(settings.bip46_xprv, timelock_index)
        bond = await self.bonds.create(
            name=name,
            description=description,
            max_slots=max_slots,
            bond_sats=bond_sats,
            fee_rate=fee_rate,
            timelock_index=timelock_index,
            timelock_expiry=bip46.timelock_ts,
            timelocked_address=bip46.address,
            bond_pubkey_hex=bip46.pubkey_hex,
            witness_script_hex=bip46.witness_script_hex,
        )
        logger.info(f"Created bond {bond.id} at {bip46.address} (index={timelock_index})")
        return bond

    async def record_bond_utxo(self, bond_id: str, txid: str, vout: int, sats: int | None = None) -> None:
        """Record the on-chain UTXO and activate the bond for sale."""
        bond = await self.bonds.get_by_id(bond_id)
        if not bond:
            raise ValueError(f"Bond {bond_id} not found")
        updates: dict = {
            "utxo_txid": txid,
            "utxo_vout": vout,
            "status": BondStatus.AVAILABLE,
            "confirmed_at": int(time.time()),
        }
        if sats is not None:
            updates["utxo_sats"] = sats
        await self.bonds.update(bond_id, **updates)
        logger.info(f"Bond {bond_id} UTXO recorded ({txid}:{vout}) — now AVAILABLE")

    # ── Order lifecycle ───────────────────────────────────────────────────────

    async def create_order(self, bond_id: str, npub: str) -> BondOrder:
        npub_hex = normalize_public_key(npub)

        bond = await self.bonds.get_by_id(bond_id)
        if not bond:
            raise ValueError("Bond not found")
        if bond.status != BondStatus.AVAILABLE:
            raise ValueError(f"Bond is not available: {bond.status}")
        if not bond.utxo:
            raise ValueError("Bond is not funded yet")
        if bond.used_slots >= bond.max_slots:
            raise ValueError("No slots available for this bond")

        price_sats = bond.price_per_slot_sats
        bond_sats = (bond.utxo_sats or bond.bond_sats) // bond.max_slots

        preimage_r = os.urandom(32)
        preimage_hash = hashlib.sha256(preimage_r).hexdigest()

        bond_sig = sign_bond_cert(settings.bip46_xprv, bond.timelock_index, npub_hex, bond.timelock_expiry)
        cert_data = {
            "bond_sig": bond_sig,
            "xpub": settings.bip46_xpub,
            "utxo": bond.utxo,
            "timelock_index": bond.timelock_index,
            "expiry": bond.timelock_expiry,
        }
        encrypted_cert, cert_nonce = encrypt_cert(json.dumps(cert_data, separators=(",", ":")), preimage_r)

        expires_at = int(time.time()) + settings.invoice_expiry_seconds
        invoice_data = await lnbits_client.create_invoice(
            amount_sats=price_sats,
            memo=f"Fidelity bond certificate — {bond.name}",
            preimage_hex=preimage_r.hex(),
            expiry_seconds=settings.invoice_expiry_seconds,
            webhook_url=_payment_webhook_url(),
        )

        await self.bonds.increment_used_slots(bond_id)
        order = await self.orders.create(
            bond_id=bond_id,
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
        order.bond = bond
        logger.info(f"Order {order.id} created for npub={npub_hex[:16]}... bond={bond_id}")
        return order

    async def handle_payment_confirmed(self, payment_hash: str) -> None:
        order = await self.orders.get_by_payment_hash(payment_hash)
        if not order:
            logger.warning(f"Payment webhook: no order for payment_hash={payment_hash}")
            return
        if order.state != OrderState.PENDING_PAYMENT:
            logger.info(f"Order {order.id} already in state {order.state}, skipping")
            return
        await self.orders.update(order.id, state=OrderState.PAID, paid_at=int(time.time()))
        logger.info(f"Order {order.id} PAID — cert ready for decryption")

    async def build_lud10_success_action(self, order: BondOrder) -> AesAction:
        if not order.encrypted_cert or not order.cert_nonce:
            raise ValueError("Order has no encrypted certificate")
        preimage_r = _decrypt_preimage(order.preimage_r_enc)
        cert_json = decrypt_cert(order.encrypted_cert, order.cert_nonce, preimage_r)
        ciphertext, iv = encrypt_lud10_success_action(cert_json, preimage_r)
        return AesAction(description="NIP-600 fidelity bond certificate", ciphertext=ciphertext, iv=iv)

    async def expire_pending_orders(self) -> int:
        expired = await self.orders.get_expired_pending()
        count = 0
        for order in expired:
            await self.orders.update(order.id, state=OrderState.EXPIRED)
            await self.bonds.decrement_used_slots(order.bond_id)
            logger.info(f"Order {order.id} expired, slot returned to bond {order.bond_id}")
            count += 1
        return count
