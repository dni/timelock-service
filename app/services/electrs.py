"""Esplora REST API client (electrs) for UTXO monitoring and tx broadcast."""
import logging

import httpx

from app.config import settings

logger = logging.getLogger("uvicorn")


class ElectrsClient:
    def __init__(self) -> None:
        self.base = settings.electrs_url.rstrip("/")

    async def get_address_utxos(self, address: str) -> list[dict]:
        """
        Returns list of UTXOs for the address.
        Each: {"txid": ..., "vout": ..., "value": ..., "status": {"confirmed": bool, ...}}
        """
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{self.base}/address/{address}/utxo")
            resp.raise_for_status()
            return resp.json()

    async def get_tx(self, txid: str) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{self.base}/tx/{txid}")
            resp.raise_for_status()
            return resp.json()

    async def get_tx_outspend(self, txid: str, vout: int) -> dict:
        """Check if a specific output is spent. Returns {"spent": bool, ...}."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{self.base}/tx/{txid}/outspend/{vout}")
            resp.raise_for_status()
            return resp.json()

    async def get_block_tip_height(self) -> int:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{self.base}/blocks/tip/height")
            resp.raise_for_status()
            return int(resp.text.strip())

    async def broadcast_tx(self, raw_tx_hex: str) -> str:
        """Broadcast a raw transaction. Returns txid."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self.base}/tx",
                content=raw_tx_hex,
                headers={"Content-Type": "text/plain"},
            )
            resp.raise_for_status()
            return resp.text.strip()

    async def find_utxo_for_address(
        self, address: str, expected_sats: int
    ) -> tuple[str, int, int] | None:
        """
        Finds a UTXO at the given address with the expected value.
        Returns (txid, vout, value_sats) or None.
        """
        utxos = await self.get_address_utxos(address)
        for utxo in utxos:
            if utxo["value"] == expected_sats:
                return utxo["txid"], utxo["vout"], utxo["value"]
        # Accept any UTXO if exact amount not found (fees may vary)
        if utxos:
            u = utxos[0]
            return u["txid"], u["vout"], u["value"]
        return None

    async def is_utxo_confirmed(
        self,
        txid: str,
        vout: int,
        min_confirmations: int = 1,
    ) -> bool:
        """True if the UTXO has at least min_confirmations."""
        try:
            tx = await self.get_tx(txid)
            status = tx.get("status", {})
            if not status.get("confirmed"):
                return False
            if min_confirmations <= 1:
                return True
            tip = await self.get_block_tip_height()
            block_height = status.get("block_height", 0)
            return (tip - block_height + 1) >= min_confirmations
        except Exception as exc:
            logger.warning(f"electrs UTXO check failed for {txid}:{vout}: {exc}")
            return False


electrs_client = ElectrsClient()
