import json
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Query
from lnurl.models import LnurlPayActionResponse, LnurlPayResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.models import OrderState
from app.repository import OrderRepository
from app.services.bond import BondService

router = APIRouter(tags=["lnurl"])


def _error(reason: str) -> dict:
    return {"status": "ERROR", "reason": reason}


def _service_host() -> str:
    parsed = urlparse(settings.service_base_url)
    return parsed.hostname or parsed.netloc or "localhost"


def _metadata(order_id: str, include_identifier: bool = False) -> str:
    entries: list[list[str]] = [
        ["text/plain", f"NIP-600 fidelity bond certificate order {order_id}"],
    ]
    if include_identifier:
        entries.append(["text/identifier", f"{order_id}@{_service_host()}"])
    return json.dumps(entries, separators=(",", ":"))


async def _pay_request(
    order_id: str,
    session: AsyncSession,
    include_identifier: bool = False,
) -> dict:
    repo = OrderRepository(session)
    order = await repo.get_by_id(order_id)
    if not order:
        return _error("Order not found")
    if order.state != OrderState.PENDING_PAYMENT:
        return _error(f"Order is not payable: {order.state}")

    amount_msat = order.price_sats * 1000
    callback = f"{settings.service_base_url.rstrip('/')}/api/v1/lnurlp/{order.id}/callback"
    return LnurlPayResponse(
        callback=callback,
        minSendable=amount_msat,
        maxSendable=amount_msat,
        metadata=_metadata(order.id, include_identifier=include_identifier),
    ).dict()


@router.get("/api/v1/lnurlp/{order_id}")
async def lnurl_pay_request(order_id: str, session: AsyncSession = Depends(get_session)):
    return await _pay_request(order_id, session)


@router.get("/.well-known/lnurlp/{order_id}")
async def lightning_address_pay_request(
    order_id: str,
    session: AsyncSession = Depends(get_session),
):
    return await _pay_request(order_id, session, include_identifier=True)


@router.get("/api/v1/lnurlp/{order_id}/callback")
async def lnurl_pay_callback(
    order_id: str,
    amount: int = Query(description="Payment amount in millisatoshis"),
    session: AsyncSession = Depends(get_session),
):
    repo = OrderRepository(session)
    order = await repo.get_by_id(order_id)
    if not order:
        return _error("Order not found")
    if order.state != OrderState.PENDING_PAYMENT:
        return _error(f"Order is not payable: {order.state}")

    expected_amount = order.price_sats * 1000
    if amount != expected_amount:
        return _error(f"Invalid amount: expected {expected_amount} msat")

    svc = BondService(session)
    success_action = await svc.build_lud10_success_action(order)
    return LnurlPayActionResponse(
        pr=order.payment_request,
        successAction=success_action,
    ).dict()
