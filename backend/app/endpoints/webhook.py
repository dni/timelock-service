import logging

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.services.bond import BondService

logger = logging.getLogger("uvicorn")
router = APIRouter(prefix="/api/v1/webhook", tags=["webhook"])


@router.post("/payment")
async def payment_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    # Verify webhook secret via X-Api-Key header
    api_key = request.headers.get("X-Api-Key", "")
    if api_key != settings.lnbits_webhook_secret:
        logger.warning("Payment webhook: invalid API key")
        return Response("unauthorized", status_code=401)

    data = await request.json()
    payment_hash = data.get("payment_hash") or data.get("checking_id")
    if not payment_hash:
        logger.warning(f"Payment webhook: missing payment_hash in {data}")
        return {"ok": False, "error": "missing payment_hash"}

    logger.info(f"Payment webhook received: payment_hash={payment_hash}")

    svc = BondService(session)
    background_tasks.add_task(svc.handle_payment_confirmed, payment_hash)
    return {"ok": True}
