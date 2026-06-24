"""LNbits REST API client for Lightning invoice management."""
import logging

import httpx

from app.config import settings

logger = logging.getLogger("uvicorn")


class LnbitsClient:
    def __init__(self) -> None:
        self.base = settings.lnbits_url.rstrip("/")
        self.headers = {
            "X-Api-Key": settings.lnbits_invoice_key,
            "Content-Type": "application/json",
        }

    async def create_invoice(
        self,
        amount_sats: int,
        memo: str,
        preimage_hex: str,
        expiry_seconds: int,
        webhook_url: str,
    ) -> dict:
        """
        Create a Lightning invoice with a specific preimage.
        LNbits forwards `preimage` to CLN's invoice command.
        Returns {"payment_hash": ..., "payment_request": ...}.
        """
        payload: dict = {
            "out": False,
            "amount": amount_sats,
            "memo": memo,
            "expiry": expiry_seconds,
            "webhook": webhook_url,
        }
        # Custom preimage: CLN sets payment_hash = SHA256(preimage)
        if preimage_hex:
            payload["preimage"] = preimage_hex
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self.base}/api/v1/payments",
                headers=self.headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "payment_hash": data["payment_hash"],
                "payment_request": data["payment_request"],
            }

    async def check_invoice(self, payment_hash: str) -> dict:
        """Check payment status. Returns full payment record including preimage if paid."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{self.base}/api/v1/payments/{payment_hash}",
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_balance(self) -> int:
        """Returns wallet balance in sats."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{self.base}/api/v1/wallet",
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()["balance"] // 1000  # msat → sat


lnbits_client = LnbitsClient()
