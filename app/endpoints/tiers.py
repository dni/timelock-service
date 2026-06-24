from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import BondStatus
from app.repository import BondRepository
from app.schemas import BondListItem

router = APIRouter(prefix="/api/v1/bonds", tags=["bonds"])


@router.get("", response_model=list[BondListItem])
async def list_available_bonds(session: AsyncSession = Depends(get_session)):
    """List bonds that are available for purchase."""
    repo = BondRepository(session)
    bonds = await repo.get_by_status(BondStatus.AVAILABLE)
    return [
        BondListItem(
            id=b.id,
            name=b.name,
            description=b.description,
            max_slots=b.max_slots,
            slots_available=b.slots_available,
            bond_sats=b.bond_sats,
            price_per_slot_sats=b.price_per_slot_sats,
            fee_rate=b.fee_rate,
            timelock_expiry=b.timelock_expiry,
            status=b.status,
        )
        for b in bonds
    ]
