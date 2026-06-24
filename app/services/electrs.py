"""LNbits blockexplorer API client for on-chain UTXO monitoring."""
import logging

import httpx

from app.config import settings

logger = logging.getLogger("uvicorn")


class BlockExplorerClient:
    """Queries on-chain data via the LNbits blockexplorer REST API."""

    def __init__(self) -> None:
        self.base = f"{settings.lnbits_url.rstrip('/')}/blockexplorer/api/v1"
        self.headers = {"X-Api-Key": settings.lnbits_invoice_key}

    async def _get(self, path: str) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{self.base}{path}", headers=self.headers)
            resp.raise_for_status()
            return resp.json()

    async def get_tip_height(self) -> int:
        data = await self._get("/tip")
        return int(data["height"])

    async def get_tx(self, txid: str) -> dict:
        return await self._get(f"/tx/{txid}")

    async def get_address(self, address: str) -> dict:
        """Returns {balance: {confirmed, unconfirmed}, history: [{tx_hash, height, fee?}]}"""
        return await self._get(f"/address/{address}")

    async def find_utxo_for_address(
        self, address: str, expected_sats: int
    ) -> tuple[str, int, int] | None:
        """
        Find a UTXO at the given address.
        Walks the address history and inspects each tx's outputs.
        Returns (txid, vout, value_sats) or None.
        """
        try:
            addr_data = await self.get_address(address)
        except Exception as exc:
            logger.warning(f"blockexplorer address lookup failed for {address}: {exc}")
            return None

        for entry in addr_data.get("history", []):
            txid = entry["tx_hash"]
            try:
                tx = await self.get_tx(txid)
            except Exception as exc:
                logger.warning(f"blockexplorer tx lookup failed for {txid}: {exc}")
                continue
            for out in tx.get("vout", []):
                spk = out.get("scriptPubKey", {})
                if spk.get("address") != address:
                    continue
                value_sats = round(out["value"] * 1e8)
                vout_n = out["n"]
                if value_sats == expected_sats:
                    return txid, vout_n, value_sats
                # Accept any output to this address if exact amount not found
                if not expected_sats:
                    return txid, vout_n, value_sats

        return None

    async def is_utxo_confirmed(
        self,
        txid: str,
        vout: int,
        min_confirmations: int = 1,
    ) -> bool:
        """True if the tx has at least min_confirmations."""
        try:
            tx = await self.get_tx(txid)
        except Exception as exc:
            logger.warning(f"blockexplorer tx lookup failed for {txid}: {exc}")
            return False

        # Get the output's address to query history confirmation
        outputs = tx.get("vout", [])
        address: str | None = None
        for out in outputs:
            if out.get("n") == vout:
                address = out.get("scriptPubKey", {}).get("address")
                break

        if not address:
            return False

        try:
            addr_data = await self.get_address(address)
        except Exception as exc:
            logger.warning(f"blockexplorer address lookup failed for {address}: {exc}")
            return False

        for entry in addr_data.get("history", []):
            if entry["tx_hash"] != txid:
                continue
            height = entry.get("height", 0)
            if height <= 0:
                return False
            if min_confirmations <= 1:
                return True
            try:
                tip = await self.get_tip_height()
                return (tip - height + 1) >= min_confirmations
            except Exception as exc:
                logger.warning(f"blockexplorer tip lookup failed: {exc}")
                return False

        return False

    async def broadcast_tx(self, raw_tx_hex: str) -> str:
        """Broadcast a raw transaction via LNbits blockexplorer. Returns txid."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self.base}/tx",
                headers={**self.headers, "Content-Type": "text/plain"},
                content=raw_tx_hex,
            )
            resp.raise_for_status()
            return resp.text.strip()


electrs_client = BlockExplorerClient()
