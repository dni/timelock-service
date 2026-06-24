import logging
from hmac import compare_digest

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.services.bond import BondService
from app.services.lnbits import extract_payment_hash

logger = logging.getLogger("uvicorn")
router = APIRouter(prefix="/api/v1/webhook", tags=["webhook"])


async def _extract_payment_hash(request: Request) -> tuple[str | None, object]:
    try:
        data: object = await request.json()
    except ValueError:
        data = (await request.body()).decode("utf-8", errors="replace").strip()

    return extract_payment_hash(data), data


@router.post("/payment")
async def payment_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    # LNbits webhooks do not reliably include custom headers, so accept the
    # secret either as X-Api-Key or as a query string token.
    api_key = request.headers.get("X-Api-Key", "")
    secret = request.query_params.get("secret", "")
    if not (
        compare_digest(api_key, settings.lnbits_webhook_secret)
        or compare_digest(secret, settings.lnbits_webhook_secret)
    ):
        logger.warning("Payment webhook: invalid API key")
        return Response("unauthorized", status_code=401)

    payment_hash, data = await _extract_payment_hash(request)
    if not payment_hash:
        logger.warning(f"Payment webhook: missing payment_hash in {data}")
        return {"ok": False, "error": "missing payment_hash"}

    logger.info(f"Payment webhook received: payment_hash={payment_hash}")

    svc = BondService(session)
    await svc.handle_payment_confirmed(payment_hash)
    return {"ok": True}
