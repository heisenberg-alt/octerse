"""App factory for the Octerse admin dashboard."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import auth, routes
from .auth import SessionStore
from .config import Settings
from .github import TTLCache

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


def create_app(settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.http = httpx.AsyncClient(transport=transport, timeout=30)
        yield
        await app.state.http.aclose()

    app = FastAPI(title="Octerse Admin Dashboard", lifespan=lifespan)
    app.state.settings = settings
    app.state.sessions = SessionStore(settings)
    app.state.pending = {}
    app.state.cache = TTLCache(settings.cache_ttl_seconds)

    app.include_router(auth.router)
    app.include_router(routes.router)
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
    return app
