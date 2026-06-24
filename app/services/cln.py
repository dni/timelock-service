"""CLN/clnrest client for on-chain operations (funding bond pools)."""
import logging

import httpx

from app.config import settings

logger = logging.getLogger("uvicorn")


class ClnClient:
    def __init__(self) -> None:
        self.base = settings.cln_rest_url.rstrip("/")
        self.headers = {
            "Rune": settings.cln_rest_rune,
            "Content-Type": "application/json",
        }

    async def _post(self, path: str, payload: dict) -> dict:
        async with httpx.AsyncClient(timeout=60, verify=False) as client:
            resp = await client.post(
                f"{self.base}{path}",
                headers=self.headers,
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_info(self) -> dict:
        return await self._post("/v1/getinfo", {})

    async def withdraw(
        self,
        destination: str,
        amount_sats: int,
        feerate: str = "normal",
    ) -> dict:
        """
        Send on-chain from CLN wallet to the BIP46 P2WSH address.
        Returns {"txid": ..., "psbt": ...}.
        """
        payload = {
            "destination": destination,
            "satoshi": amount_sats,
            "feerate": feerate,
        }
        result = await self._post("/v1/withdraw", payload)
        logger.info(f"CLN withdraw to {destination}: txid={result.get('txid')}")
        return result

    async def list_funds(self) -> dict:
        """List CLN on-chain UTXOs and channels."""
        return await self._post("/v1/listfunds", {})


cln_client = ClnClient()
