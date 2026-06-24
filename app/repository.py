"""Database access layer."""
import time
import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import BondOrder, BondPool, BondTier, OrderState, PoolStatus


class TierRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, **kwargs) -> BondTier:
        tier = BondTier(id=str(uuid.uuid4()), **kwargs)
        self.session.add(tier)
        await self.session.commit()
        await self.session.refresh(tier)
        return tier

    async def get_by_id(self, tier_id: str) -> BondTier | None:
        result = await self.session.execute(
            select(BondTier).where(BondTier.id == tier_id)
        )
        return result.scalar_one_or_none()

    async def list_active(self) -> list[BondTier]:
        result = await self.session.execute(
            select(BondTier).where(BondTier.is_active == True)
        )
        return list(result.scalars().all())

    async def update(self, tier_id: str, **kwargs) -> None:
        await self.session.execute(
            update(BondTier).where(BondTier.id == tier_id).values(**kwargs)
        )
        await self.session.commit()


class PoolRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, **kwargs) -> BondPool:
        pool = BondPool(id=str(uuid.uuid4()), **kwargs)
        self.session.add(pool)
        await self.session.commit()
        await self.session.refresh(pool)
        return pool

    async def get_by_id(self, pool_id: str) -> BondPool | None:
        result = await self.session.execute(
            select(BondPool)
            .options(selectinload(BondPool.tier))
            .where(BondPool.id == pool_id)
        )
        return result.scalar_one_or_none()

    async def get_available_for_tier(self, tier_id: str) -> BondPool | None:
        """Find a pool with available slots for this tier."""
        result = await self.session.execute(
            select(BondPool)
            .options(selectinload(BondPool.tier))
            .where(
                BondPool.tier_id == tier_id,
                BondPool.status == PoolStatus.AVAILABLE,
            )
            .limit(1)
        )
        pool = result.scalar_one_or_none()
        if pool and pool.tier:
            if pool.used_slots >= pool.tier.max_slots:
                return None
        return pool

    async def get_by_status(self, status: PoolStatus) -> list[BondPool]:
        result = await self.session.execute(
            select(BondPool)
            .options(selectinload(BondPool.tier))
            .where(BondPool.status == status)
        )
        return list(result.scalars().all())

    async def list_all(self) -> list[BondPool]:
        result = await self.session.execute(
            select(BondPool).options(selectinload(BondPool.tier))
        )
        return list(result.scalars().all())

    async def update(self, pool_id: str, **kwargs) -> None:
        await self.session.execute(
            update(BondPool).where(BondPool.id == pool_id).values(**kwargs)
        )
        await self.session.commit()

    async def increment_used_slots(self, pool_id: str) -> None:
        pool = await self.get_by_id(pool_id)
        if pool:
            new_count = pool.used_slots + 1
            await self.update(pool_id, used_slots=new_count)
            if pool.tier and new_count >= pool.tier.max_slots:
                await self.update(pool_id, status=PoolStatus.FULL)

    async def decrement_used_slots(self, pool_id: str) -> None:
        pool = await self.get_by_id(pool_id)
        if pool and pool.used_slots > 0:
            new_count = pool.used_slots - 1
            updates: dict = {"used_slots": new_count}
            if pool.status == PoolStatus.FULL:
                updates["status"] = PoolStatus.AVAILABLE
            await self.update(pool_id, **updates)


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
            .options(selectinload(BondOrder.pool), selectinload(BondOrder.tier))
            .where(BondOrder.id == order_id)
        )
        return result.scalar_one_or_none()

    async def get_by_payment_hash(self, payment_hash: str) -> BondOrder | None:
        result = await self.session.execute(
            select(BondOrder)
            .options(selectinload(BondOrder.pool))
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
            select(BondOrder).options(
                selectinload(BondOrder.pool), selectinload(BondOrder.tier)
            )
        )
        return list(result.scalars().all())

    async def update(self, order_id: str, **kwargs) -> None:
        await self.session.execute(
            update(BondOrder).where(BondOrder.id == order_id).values(**kwargs)
        )
        await self.session.commit()
