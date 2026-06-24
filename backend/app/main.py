import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.database import create_tables
from app.endpoints import admin, bond, lnurl, tiers, webhook
from app.jobs import lnbits_payment_websocket_job, order_expiry_job

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("uvicorn")


class SPAStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    logger.info("Database tables ready")

    task_expiry = asyncio.create_task(order_expiry_job(interval_seconds=60))
    task_lnbits_ws = asyncio.create_task(lnbits_payment_websocket_job())
    logger.info("Background jobs started")

    yield

    for task in (task_expiry, task_lnbits_ws):
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
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


_STATIC = Path("/app/static")
if _STATIC.exists():
    app.mount("/", SPAStaticFiles(directory=str(_STATIC), html=True), name="frontend")
