import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import create_tables
from app.endpoints import admin, bond, lnurl, tiers, webhook
from app.jobs import bond_monitor_job, order_expiry_job

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("uvicorn")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    logger.info("Database tables ready")

    task_monitor = asyncio.create_task(bond_monitor_job(interval_seconds=60))
    task_expiry = asyncio.create_task(order_expiry_job(interval_seconds=60))
    logger.info("Background jobs started")

    yield

    task_monitor.cancel()
    task_expiry.cancel()
    with suppress(asyncio.CancelledError):
        await asyncio.gather(task_monitor, task_expiry)
    logger.info("Background jobs stopped")


app = FastAPI(
    title="Timelock Service",
    description="NIP-600 fidelity bond certificate service",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tiers.router)
app.include_router(bond.router)
app.include_router(lnurl.router)
app.include_router(admin.router)
app.include_router(webhook.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
