"""LNbits REST API client for Lightning invoice management."""
import json
import logging
from urllib.parse import urlsplit, urlunsplit

import httpx

from app.config import settings

logger = logging.getLogger("uvicorn")


class LightningNodeUnavailableError(RuntimeError):
    """Raised when the configured Lightning backend cannot create invoices."""


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
        LNbits should create the invoice using this preimage.
        Returns {"payment_hash": ..., "payment_request": ...}.
        """
        payload: dict = {
            "out": False,
            "amount": amount_sats,
            "memo": memo,
            "expiry": expiry_seconds,
            "webhook": webhook_url,
        }
        # Custom preimage: payment_hash = SHA256(preimage)
        if preimage_hex:
            payload["preimage"] = preimage_hex
        try:
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
        except (httpx.HTTPError, KeyError) as exc:
            logger.warning("Lightning invoice creation failed: %s", exc)
            raise LightningNodeUnavailableError("Lightning node not available") from exc

    async def check_invoice(self, payment_hash: str) -> dict:
        """Check payment status. Returns full payment record including preimage if paid."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{self.base}/api/v1/payments/{payment_hash}",
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_wallet(self) -> dict:
        """Returns wallet metadata from LNbits."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{self.base}/api/v1/wallet",
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_balance(self) -> int:
        """Returns wallet balance in sats."""
        return (await self.get_wallet())["balance"] // 1000  # msat → sat

    async def wallet_websocket_url(self) -> str:
        """Returns the LNbits wallet websocket URL for payment notifications."""
        wallet_id = (await self.get_wallet())["id"]
        parts = urlsplit(self.base)
        scheme = "wss" if parts.scheme == "https" else "ws"
        base = urlunsplit((scheme, parts.netloc, parts.path.rstrip("/"), "", ""))
        return f"{base}/api/v1/ws/{wallet_id}"


def extract_payment_hash(payload: object) -> str | None:
    """Extract a payment hash/checking id from common LNbits webhook/ws payloads."""
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8", errors="replace")

    if isinstance(payload, str):
        stripped = payload.strip()
        if not stripped:
            return None
        try:
            return extract_payment_hash(json.loads(stripped))
        except json.JSONDecodeError:
            return stripped.strip('"') or None

    if isinstance(payload, dict):
        for key in ("payment_hash", "checking_id", "hash"):
            value = payload.get(key)
            if value:
                return str(value)
        for key in ("payment", "data", "wallet_payment"):
            value = payload.get(key)
            if isinstance(value, (dict, str, bytes)):
                payment_hash = extract_payment_hash(value)
                if payment_hash:
                    return payment_hash

    return None


lnbits_client = LnbitsClient()
