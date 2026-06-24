"""Background periodic jobs."""
import asyncio
import logging

from app.database import async_session_maker
from app.services.bond import BondService

logger = logging.getLogger("uvicorn")


async def order_expiry_job(interval_seconds: int = 60) -> None:
    """Expire PENDING_PAYMENT orders past their deadline and return slots to bond."""
    while True:
        try:
            async with async_session_maker() as session:
                svc = BondService(session)
                expired = await svc.expire_pending_orders()
                if expired:
                    logger.info(f"Expiry job: expired {expired} order(s)")
        except Exception as exc:
            logger.error(f"Order expiry job error: {exc}")
        await asyncio.sleep(interval_seconds)
