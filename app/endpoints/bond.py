from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.repository import OrderRepository
from app.schemas import BondOrderResponse, BondRequestBody, BondStatusResponse
from app.services.bond import BondService

router = APIRouter(prefix="/api/v1/bond", tags=["bond"])


@router.post("/request", response_model=BondOrderResponse)
async def request_bond(body: BondRequestBody, session: AsyncSession = Depends(get_session)):
    svc = BondService(session)
    try:
        order = await svc.create_order(body.tier_id, body.npub)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    pool = order.pool
    return BondOrderResponse(
        order_id=order.id,
        state=order.state,
        invoice=order.payment_request,
        payment_hash=order.lnbits_payment_hash,
        price_sats=order.price_sats,
        bond_sats=order.bond_sats,
        encrypted_cert=order.encrypted_cert,
        cert_nonce=order.cert_nonce,
        timelocked_address=pool.timelocked_address if pool else "",
        bond_expiry=pool.timelock_expiry if pool else 0,
        expires_at=order.expires_at,
    )


@router.get("/{order_id}", response_model=BondStatusResponse)
async def get_bond_status(order_id: str, session: AsyncSession = Depends(get_session)):
    """
    Poll order status. When state=PAID, encrypted_cert and cert_nonce are included.
    Decrypt client-side: AES-256-GCM(key=preimage_r_from_ln_wallet, nonce=cert_nonce, ct=encrypted_cert)
    """
    repo = OrderRepository(session)
    order = await repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    pool = order.pool
    from app.models import OrderState
    include_cert = order.state == OrderState.PAID
    return BondStatusResponse(
        order_id=order.id,
        state=order.state,
        price_sats=order.price_sats,
        bond_sats=order.bond_sats,
        encrypted_cert=order.encrypted_cert if include_cert else None,
        cert_nonce=order.cert_nonce if include_cert else None,
        payment_hash=order.lnbits_payment_hash,
        timelocked_address=pool.timelocked_address if pool else "",
        bond_expiry=pool.timelock_expiry if pool else 0,
        expires_at=order.expires_at,
        paid_at=order.paid_at,
    )
