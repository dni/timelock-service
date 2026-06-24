import logging

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.repository import BondRepository, OrderRepository
from app.schemas import AdminBondResponse, CreateBondBody, RecordUtxoBody
from app.services.bond import BondService

logger = logging.getLogger("uvicorn")
router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


def require_admin(x_admin_key: str = Header(alias="X-Admin-Key")):
    if x_admin_key != settings.admin_api_key:
        raise HTTPException(status_code=401, detail="Invalid admin key")


def _bond_response(bond) -> AdminBondResponse:
    return AdminBondResponse(
        id=bond.id,
        name=bond.name,
        description=bond.description,
        max_slots=bond.max_slots,
        used_slots=bond.used_slots,
        bond_sats=bond.bond_sats,
        price_per_slot_sats=bond.price_per_slot_sats,
        fee_rate=bond.fee_rate,
        timelock_index=bond.timelock_index,
        timelock_expiry=bond.timelock_expiry,
        timelocked_address=bond.timelocked_address,
        utxo=bond.utxo,
        utxo_sats=bond.utxo_sats,
        status=bond.status,
        confirmed_at=bond.confirmed_at,
        created_at=bond.created_at,
    )


# ── Bonds ─────────────────────────────────────────────────────────────────────

@router.post("/bonds", response_model=AdminBondResponse, dependencies=[Depends(require_admin)])
async def create_bond(body: CreateBondBody, session: AsyncSession = Depends(get_session)):
    svc = BondService(session)
    try:
        bond = await svc.create_bond(
            name=body.name,
            description=body.description,
            max_slots=body.max_slots,
            bond_sats=body.bond_sats,
            fee_rate=body.fee_rate,
            timelock_index=body.timelock_index,
            timelock_duration_months=body.timelock_duration_months,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _bond_response(bond)


@router.get("/bonds", response_model=list[AdminBondResponse], dependencies=[Depends(require_admin)])
async def list_bonds(session: AsyncSession = Depends(get_session)):
    repo = BondRepository(session)
    bonds = await repo.list_all()
    return [_bond_response(b) for b in bonds]


@router.get("/bonds/{bond_id}", response_model=AdminBondResponse, dependencies=[Depends(require_admin)])
async def get_bond(bond_id: str, session: AsyncSession = Depends(get_session)):
    repo = BondRepository(session)
    bond = await repo.get_by_id(bond_id)
    if not bond:
        raise HTTPException(status_code=404, detail="Bond not found")
    return _bond_response(bond)


@router.post(
    "/bonds/{bond_id}/record-utxo",
    response_model=AdminBondResponse,
    dependencies=[Depends(require_admin)],
)
async def record_bond_utxo(
    bond_id: str,
    body: RecordUtxoBody,
    session: AsyncSession = Depends(get_session),
):
    svc = BondService(session)
    try:
        await svc.record_bond_utxo(bond_id, body.txid, body.vout, body.sats)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    repo = BondRepository(session)
    bond = await repo.get_by_id(bond_id)
    return _bond_response(bond)


# ── Orders ─────────────────────────────────────────────────────────────────────

@router.get("/orders", dependencies=[Depends(require_admin)])
async def list_orders(session: AsyncSession = Depends(get_session)):
    repo = OrderRepository(session)
    orders = await repo.list_all()
    return [
        {
            "id": o.id,
            "state": o.state,
            "bond_id": o.bond_id,
            "beneficiary_npub": o.beneficiary_npub,
            "price_sats": o.price_sats,
            "bond_sats": o.bond_sats,
            "payment_hash": o.lnbits_payment_hash,
            "created_at": o.created_at,
            "paid_at": o.paid_at,
            "expires_at": o.expires_at,
        }
        for o in orders
    ]
