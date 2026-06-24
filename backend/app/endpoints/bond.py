import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session_maker, get_session
from app.models import OrderState
from app.repository import OrderRepository
from app.schemas import BondOrderResponse, BondRequestBody, BondStatusResponse
from app.services.bond import BondService
from app.services.lnbits import LightningNodeUnavailableError, lnbits_client

logger = logging.getLogger("uvicorn")

router = APIRouter(prefix="/api/v1/bond", tags=["bond"])


def _order_status_response(order) -> BondStatusResponse:
    bond = order.bond
    return BondStatusResponse(
        order_id=order.id,
        state=order.state,
        beneficiary_pubkey=order.beneficiary_npub,
        invoice=order.payment_request,
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


@router.post("/request", response_model=BondOrderResponse)
async def request_bond(body: BondRequestBody, session: AsyncSession = Depends(get_session)):
    svc = BondService(session)
    try:
        order = await svc.create_order(body.bond_id, body.npub)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except LightningNodeUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    bond = order.bond
    return BondOrderResponse(
        order_id=order.id,
        state=order.state,
        beneficiary_pubkey=order.beneficiary_npub,
        invoice=order.payment_request,
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

    return _order_status_response(order)


@router.post("/{order_id}/refresh", response_model=BondStatusResponse)
async def refresh_bond_status(order_id: str, session: AsyncSession = Depends(get_session)):
    """Poll LNBits directly for payment status and confirm the order if paid."""
    repo = OrderRepository(session)
    order = await repo.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.state == OrderState.PENDING_PAYMENT and order.lnbits_payment_hash:
        try:
            invoice = await lnbits_client.check_invoice(order.lnbits_payment_hash)
            if invoice.get("paid"):
                svc = BondService(session)
                await svc.handle_payment_confirmed(order.lnbits_payment_hash)
                order = await repo.get_by_id(order_id)
        except Exception as exc:
            logger.warning("LNBits manual check failed for order %s: %s", order_id, exc)

    return _order_status_response(order)


@router.get("/{order_id}/preimage")
async def get_bond_preimage(order_id: str, session: AsyncSession = Depends(get_session)):
    svc = BondService(session)
    try:
        return {"preimage": await svc.get_paid_order_preimage(order_id)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.websocket("/{order_id}/ws")
async def watch_bond_status(websocket: WebSocket, order_id: str):
    await websocket.accept()
    last_state: tuple[str, int | None] | None = None
    try:
        while True:
            async with async_session_maker() as session:
                repo = OrderRepository(session)
                order = await repo.get_by_id(order_id)
                if not order:
                    await websocket.send_json({"error": "Order not found"})
                    await websocket.close(code=1008)
                    return

                response = _order_status_response(order)
                state = (response.state, response.paid_at)
                if state != last_state:
                    await websocket.send_json(response.model_dump())
                    last_state = state
                if response.state in {"PAID", "EXPIRED"}:
                    await websocket.close(code=1000)
                    return

            await asyncio.sleep(1)
    except WebSocketDisconnect:
        return
