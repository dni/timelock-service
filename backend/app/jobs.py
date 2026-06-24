"""Background periodic jobs."""
import asyncio
import logging

import websockets

from app.database import async_session_maker
from app.services.bond import BondService
from app.services.lnbits import extract_payment_hash, lnbits_client

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


async def lnbits_payment_websocket_job() -> None:
    """Watch LNbits wallet websocket notifications and mark matching orders paid."""
    reconnect_delay = 1
    while True:
        try:
            url = await lnbits_client.wallet_websocket_url()
            logger.info("Connecting to LNbits wallet websocket")
            async with websockets.connect(url, ping_interval=20, ping_timeout=20) as websocket:
                logger.info("LNbits wallet websocket connected")
                reconnect_delay = 1
                async for message in websocket:
                    payment_hash = extract_payment_hash(message)
                    if not payment_hash:
                        logger.debug("LNbits websocket message without payment hash: %s", message)
                        continue
                    async with async_session_maker() as session:
                        svc = BondService(session)
                        await svc.handle_payment_confirmed(payment_hash)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("LNbits wallet websocket error: %s", exc)
            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, 60)
