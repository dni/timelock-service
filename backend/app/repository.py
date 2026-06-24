"""Database access layer."""
import time
import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Bond, BondOrder, BondStatus, OrderState


class BondRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, **kwargs) -> Bond:
        bond = Bond(id=str(uuid.uuid4()), **kwargs)
        self.session.add(bond)
        await self.session.commit()
        await self.session.refresh(bond)
        return bond

    async def get_by_id(self, bond_id: str) -> Bond | None:
        result = await self.session.execute(select(Bond).where(Bond.id == bond_id))
        return result.scalar_one_or_none()

    async def get_by_status(self, status: BondStatus) -> list[Bond]:
        result = await self.session.execute(select(Bond).where(Bond.status == status))
        return list(result.scalars().all())

    async def list_all(self) -> list[Bond]:
        result = await self.session.execute(select(Bond))
        return list(result.scalars().all())

    async def update(self, bond_id: str, **kwargs) -> None:
        await self.session.execute(update(Bond).where(Bond.id == bond_id).values(**kwargs))
        await self.session.commit()

    async def increment_used_slots(self, bond_id: str) -> None:
        bond = await self.get_by_id(bond_id)
        if bond:
            new_count = bond.used_slots + 1
            updates: dict = {"used_slots": new_count}
            if new_count >= bond.max_slots:
                updates["status"] = BondStatus.FULL
            await self.update(bond_id, **updates)

    async def decrement_used_slots(self, bond_id: str) -> None:
        bond = await self.get_by_id(bond_id)
        if bond and bond.used_slots > 0:
            new_count = bond.used_slots - 1
            updates: dict = {"used_slots": new_count}
            if bond.status == BondStatus.FULL:
                updates["status"] = BondStatus.AVAILABLE
            await self.update(bond_id, **updates)


class OrderRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, **kwargs) -> BondOrder:
        order = BondOrder(id=str(uuid.uuid4()), **kwargs)
        self.session.add(order)
        await self.session.commit()
        await self.session.refresh(order)
        return order

    async def get_by_id(self, order_id: str) -> BondOrder | None:
        result = await self.session.execute(
            select(BondOrder)
            .options(selectinload(BondOrder.bond))
            .where(BondOrder.id == order_id)
        )
        return result.scalar_one_or_none()

    async def get_by_payment_hash(self, payment_hash: str) -> BondOrder | None:
        result = await self.session.execute(
            select(BondOrder)
            .options(selectinload(BondOrder.bond))
            .where(BondOrder.lnbits_payment_hash == payment_hash)
        )
        return result.scalar_one_or_none()

    async def get_expired_pending(self, now: int | None = None) -> list[BondOrder]:
        if now is None:
            now = int(time.time())
        result = await self.session.execute(
            select(BondOrder).where(
                BondOrder.state == OrderState.PENDING_PAYMENT,
                BondOrder.expires_at < now,
            )
        )
        return list(result.scalars().all())

    async def list_all(self) -> list[BondOrder]:
        result = await self.session.execute(
            select(BondOrder).options(selectinload(BondOrder.bond))
        )
        return list(result.scalars().all())

    async def update(self, order_id: str, **kwargs) -> None:
        await self.session.execute(
            update(BondOrder).where(BondOrder.id == order_id).values(**kwargs)
        )
        await self.session.commit()
