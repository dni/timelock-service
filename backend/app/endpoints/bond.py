import asyncio
from urllib.parse import urlparse

from bech32 import bech32_encode, convertbits
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session_maker, get_session
from app.repository import OrderRepository
from app.schemas import BondOrderResponse, BondRequestBody, BondStatusResponse
from app.services.bond import BondService
from app.services.lnbits import LightningNodeUnavailableError

router = APIRouter(prefix="/api/v1/bond", tags=["bond"])


def _lnurl_pay_url(order_id: str) -> str:
    return f"{settings.service_base_url.rstrip('/')}/api/v1/lnurlp/{order_id}"


def _lnurl(order_id: str) -> str:
    data = convertbits(_lnurl_pay_url(order_id).encode("utf-8"), 8, 5, True)
    return bech32_encode("lnurl", data).upper()


def _lightning_address(order_id: str) -> str | None:
    host = urlparse(settings.service_base_url).hostname
    return f"{order_id}@{host}" if host else None


def _order_status_response(order) -> BondStatusResponse:
    bond = order.bond
    return BondStatusResponse(
        order_id=order.id,
        state=order.state,
        beneficiary_pubkey=order.beneficiary_npub,
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
