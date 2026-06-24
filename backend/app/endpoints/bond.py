from urllib.parse import urlparse

from bech32 import bech32_encode, convertbits
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.repository import OrderRepository
from app.schemas import BondOrderResponse, BondRequestBody, BondStatusResponse
from app.services.bond import BondService

router = APIRouter(prefix="/api/v1/bond", tags=["bond"])


def _lnurl_pay_url(order_id: str) -> str:
    return f"{settings.service_base_url.rstrip('/')}/api/v1/lnurlp/{order_id}"


def _lnurl(order_id: str) -> str:
    data = convertbits(_lnurl_pay_url(order_id).encode("utf-8"), 8, 5, True)
    return bech32_encode("lnurl", data).upper()


def _lightning_address(order_id: str) -> str | None:
    host = urlparse(settings.service_base_url).hostname
    return f"{order_id}@{host}" if host else None


@router.post("/request", response_model=BondOrderResponse)
async def request_bond(body: BondRequestBody, session: AsyncSession = Depends(get_session)):
    svc = BondService(session)
    try:
        order = await svc.create_order(body.bond_id, body.npub)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    bond = order.bond
    return BondOrderResponse(
        order_id=order.id,
        state=order.state,
        invoice=order.payment_request,
        lnurl=_lnurl(order.id),
        lnurl_pay_url=_lnurl_pay_url(order.id),
        lightning_address=_lightning_address(order.id),
        payment_hash=order.lnbits_payment_hash,
        price_sats=order.price_sats,
        bond_sats=order.bond_sats,
        encrypted_cert=order.encrypted_cert,
        cert_nonce=order.cert_nonce,
        timelocked_address=bond.timelocked_address if bond else "",
        bond_expiry=bond.timelock_expiry if bond else 0,
        expires_at=order.expires_at,
    )


@router.get("/{order_id}", response_model=BondStatusResponse)
async def get_bond_status(order_id: str, session: AsyncSession = Depends(get_session)):
    repo = OrderRepository(session)
    order = await repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    bond = order.bond
    return BondStatusResponse(
        order_id=order.id,
        state=order.state,
        invoice=order.payment_request,
        lnurl=_lnurl(order.id),
        lnurl_pay_url=_lnurl_pay_url(order.id),
        lightning_address=_lightning_address(order.id),
        price_sats=order.price_sats,
        bond_sats=order.bond_sats,
        encrypted_cert=order.encrypted_cert,
        cert_nonce=order.cert_nonce,
        payment_hash=order.lnbits_payment_hash,
        timelocked_address=bond.timelocked_address if bond else "",
        bond_expiry=bond.timelock_expiry if bond else 0,
        expires_at=order.expires_at,
        paid_at=order.paid_at,
    )
