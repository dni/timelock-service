import logging

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.repository import PoolRepository, TierRepository
from app.schemas import (
    CreatePoolBody,
    CreateTierBody,
    PoolResponse,
    RecordUtxoBody,
    TierResponse,
)
from app.services.bond import BondService

logger = logging.getLogger("uvicorn")
router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


def require_admin(x_admin_key: str = Header(alias="X-Admin-Key")):
    if x_admin_key != settings.admin_api_key:
        raise HTTPException(status_code=401, detail="Invalid admin key")


# ── Tiers ──────────────────────────────────────────────────────────────────────

@router.post("/tiers", response_model=TierResponse, dependencies=[Depends(require_admin)])
async def create_tier(body: CreateTierBody, session: AsyncSession = Depends(get_session)):
    svc = BondService(session)
    try:
        tier = await svc.create_tier(
            name=body.name,
            description=body.description,
            max_slots=body.max_slots,
            bond_sats=body.bond_sats,
            timelock_duration_months=body.timelock_duration_months,
            fee_rate=body.fee_rate,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return TierResponse(
        id=tier.id,
        name=tier.name,
        description=tier.description,
        max_slots=tier.max_slots,
        bond_sats=tier.bond_sats,
        price_per_slot_sats=tier.price_per_slot_sats,
        fee_rate=tier.fee_rate,
        timelock_duration_months=tier.timelock_duration_months,
        is_active=tier.is_active,
    )


@router.get("/tiers", response_model=list[TierResponse], dependencies=[Depends(require_admin)])
async def list_tiers(session: AsyncSession = Depends(get_session)):
    repo = TierRepository(session)
    tiers = await repo.list_active()
    return [
        TierResponse(
            id=t.id,
            name=t.name,
            description=t.description,
            max_slots=t.max_slots,
            bond_sats=t.bond_sats,
            price_per_slot_sats=t.price_per_slot_sats,
            fee_rate=t.fee_rate,
            timelock_duration_months=t.timelock_duration_months,
            is_active=t.is_active,
        )
        for t in tiers
    ]


# ── Pools ──────────────────────────────────────────────────────────────────────

@router.post("/pools", response_model=PoolResponse, dependencies=[Depends(require_admin)])
async def create_pool(body: CreatePoolBody, session: AsyncSession = Depends(get_session)):
    svc = BondService(session)
    try:
        pool = await svc.create_pool(body.tier_id, body.timelock_index)
        if body.fund_via_cln:
            txid = await svc.fund_pool_via_cln(pool.id)
            logger.info(f"Auto-funded pool {pool.id} via CLN: txid={txid}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return _pool_response(pool)


@router.get("/pools", response_model=list[PoolResponse], dependencies=[Depends(require_admin)])
async def list_pools(session: AsyncSession = Depends(get_session)):
    repo = PoolRepository(session)
    pools = await repo.list_all()
    return [_pool_response(p) for p in pools]


@router.post(
    "/pools/{pool_id}/record-utxo",
    response_model=PoolResponse,
    dependencies=[Depends(require_admin)],
)
async def record_pool_utxo(
    pool_id: str,
    body: RecordUtxoBody,
    session: AsyncSession = Depends(get_session),
):
    svc = BondService(session)
    try:
        await svc.record_pool_utxo(pool_id, body.txid, body.vout, body.sats)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    repo = PoolRepository(session)
    pool = await repo.get_by_id(pool_id)
    return _pool_response(pool)


@router.post(
    "/pools/{pool_id}/fund",
    dependencies=[Depends(require_admin)],
)
async def fund_pool(pool_id: str, session: AsyncSession = Depends(get_session)):
    svc = BondService(session)
    try:
        txid = await svc.fund_pool_via_cln(pool_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"txid": txid}


# ── Orders ─────────────────────────────────────────────────────────────────────

@router.get("/orders", dependencies=[Depends(require_admin)])
async def list_orders(session: AsyncSession = Depends(get_session)):
    from app.repository import OrderRepository
    repo = OrderRepository(session)
    orders = await repo.list_all()
    return [
        {
            "id": o.id,
            "state": o.state,
            "beneficiary_npub": o.beneficiary_npub,
            "price_sats": o.price_sats,
            "bond_sats": o.bond_sats,
            "payment_hash": o.lnbits_payment_hash,
            "created_at": o.created_at,
            "paid_at": o.paid_at,
            "expires_at": o.expires_at,
            "pool_id": o.pool_id,
            "tier_id": o.tier_id,
        }
        for o in orders
    ]


def _pool_response(pool) -> PoolResponse:
    return PoolResponse(
        id=pool.id,
        tier_id=pool.tier_id,
        tier_name=pool.tier.name if pool.tier else None,
        timelock_index=pool.timelock_index,
        timelock_expiry=pool.timelock_expiry,
        timelocked_address=pool.timelocked_address,
        utxo=pool.utxo,
        utxo_sats=pool.utxo_sats,
        status=pool.status,
        used_slots=pool.used_slots,
        max_slots=pool.tier.max_slots if pool.tier else None,
        created_at=pool.created_at,
        confirmed_at=pool.confirmed_at,
    )
