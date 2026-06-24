from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.repository import PoolRepository, TierRepository
from app.schemas import TierWithAvailabilityResponse

router = APIRouter(prefix="/api/v1/tiers", tags=["tiers"])


@router.get("", response_model=list[TierWithAvailabilityResponse])
async def list_tiers(session: AsyncSession = Depends(get_session)):
    tier_repo = TierRepository(session)
    pool_repo = PoolRepository(session)
    tiers = await tier_repo.list_active()

    from app.models import PoolStatus
    result = []
    for tier in tiers:
        pools = await pool_repo.get_by_status(PoolStatus.AVAILABLE)
        tier_pools = [p for p in pools if p.tier_id == tier.id]
        slots_available = sum(
            max(0, tier.max_slots - p.used_slots) for p in tier_pools
        )
        result.append(
            TierWithAvailabilityResponse(
                id=tier.id,
                name=tier.name,
                description=tier.description,
                max_slots=tier.max_slots,
                bond_sats=tier.bond_sats,
                price_per_slot_sats=tier.price_per_slot_sats,
                fee_rate=tier.fee_rate,
                timelock_duration_months=tier.timelock_duration_months,
                is_active=tier.is_active,
                slots_available=slots_available,
            )
        )
    return result
