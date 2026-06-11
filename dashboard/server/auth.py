"""GitHub OAuth device-flow login + signed-cookie sessions.

Flow:
  1. POST /api/auth/device/start  -> backend asks GitHub for a device code,
     returns {pending_id, user_code, verification_uri, interval}.
     The device_code never leaves the server.
  2. Frontend polls POST /api/auth/device/poll {pending_id} until GitHub
     authorizes. Backend exchanges for a user token, verifies the user is
     an *admin* of at least one allowed org, then issues a signed httpOnly
     session cookie. The GitHub token stays server-side only.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel

from .config import Settings
from .github import GitHubClient, GitHubError

COOKIE_NAME = "octerse_session"
OAUTH_SCOPES = "read:org manage_billing:copilot"
DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"

router = APIRouter(prefix="/api/auth")


@dataclass
class Session:
    id: str
    login: str
    token: str
    admin_orgs: list[str]
    created_at: float = field(default_factory=time.time)


class SessionStore:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._serializer = URLSafeTimedSerializer(settings.session_secret, salt="octerse-session")
        self._sessions: dict[str, Session] = {}

    def create(self, login: str, token: str, admin_orgs: list[str]) -> str:
        sid = secrets.token_urlsafe(32)
        self._sessions[sid] = Session(id=sid, login=login, token=token, admin_orgs=admin_orgs)
        return self._serializer.dumps(sid)

    def resolve(self, cookie_value: str | None) -> Session | None:
        if not cookie_value:
            return None
        try:
            sid = self._serializer.loads(cookie_value, max_age=self._settings.session_ttl_seconds)
        except BadSignature:
            return None
        session = self._sessions.get(sid)
        if session and time.time() - session.created_at > self._settings.session_ttl_seconds:
            self._sessions.pop(sid, None)
            return None
        return session

    def drop(self, cookie_value: str | None) -> None:
        if not cookie_value:
            return
        try:
            sid = self._serializer.loads(cookie_value, max_age=self._settings.session_ttl_seconds)
        except BadSignature:
            return
        self._sessions.pop(sid, None)


def require_session(request: Request) -> Session:
    store: SessionStore = request.app.state.sessions
    session = store.resolve(request.cookies.get(COOKIE_NAME))
    if session is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    return session


def _set_session_cookie(response: Response, settings: Settings, cookie_value: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        cookie_value,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
        path="/",
    )


async def _resolve_admin_orgs(gh: GitHubClient, settings: Settings) -> list[str]:
    """Orgs (from the allow-list, or any org) where the user is an admin."""
    if settings.allowed_orgs:
        admin_orgs = []
        for org in settings.allowed_orgs:
            try:
                membership = await gh.org_membership(org)
            except GitHubError:
                continue
            if membership.get("role") == "admin":
                admin_orgs.append(org)
        return admin_orgs
    return await gh.admin_org_memberships()


class PollBody(BaseModel):
    pending_id: str


@router.post("/device/start")
async def device_start(request: Request):
    settings: Settings = request.app.state.settings
    http: httpx.AsyncClient = request.app.state.http
    resp = await http.post(
        f"{settings.github_oauth_url}/login/device/code",
        data={"client_id": settings.github_oauth_client_id, "scope": OAUTH_SCOPES},
        headers={"Accept": "application/json"},
    )
    data = resp.json()
    if resp.status_code >= 400 or "device_code" not in data:
        reason = data.get("error_description") or data.get("error") or f"HTTP {resp.status_code}"
        raise HTTPException(
            status_code=502,
            detail=(
                f"GitHub device authorization failed: {reason}. "
                "Check GITHUB_OAUTH_CLIENT_ID — it must be a real OAuth App "
                "client id with device flow enabled."
            ),
        )
    pending_id = secrets.token_urlsafe(24)
    request.app.state.pending[pending_id] = {
        "device_code": data["device_code"],
        "expires_at": time.time() + int(data.get("expires_in", 900)),
    }
    return {
        "pending_id": pending_id,
        "user_code": data["user_code"],
        "verification_uri": data.get("verification_uri", "https://github.com/login/device"),
        "interval": int(data.get("interval", 5)),
    }


@router.post("/device/poll")
async def device_poll(body: PollBody, request: Request, response: Response):
    settings: Settings = request.app.state.settings
    http: httpx.AsyncClient = request.app.state.http
    pending: dict = request.app.state.pending

    entry = pending.get(body.pending_id)
    if entry is None or entry["expires_at"] < time.time():
        pending.pop(body.pending_id, None)
        raise HTTPException(status_code=404, detail="unknown or expired login attempt")

    resp = await http.post(
        f"{settings.github_oauth_url}/login/oauth/access_token",
        data={
            "client_id": settings.github_oauth_client_id,
            "device_code": entry["device_code"],
            "grant_type": DEVICE_GRANT,
        },
        headers={"Accept": "application/json"},
    )
    data = resp.json()

    error = data.get("error")
    if error in ("authorization_pending", "slow_down"):
        return {"status": "pending"}
    if error:
        pending.pop(body.pending_id, None)
        return {"status": "error", "error": error}

    token = data.get("access_token")
    if not token:
        pending.pop(body.pending_id, None)
        return {"status": "error", "error": "no_token"}
    pending.pop(body.pending_id, None)

    gh = GitHubClient(http, token, settings)
    try:
        user = await gh.user()
        admin_orgs = await _resolve_admin_orgs(gh, settings)
    except GitHubError as exc:
        raise HTTPException(status_code=502, detail=f"GitHub verification failed: {exc.message}")

    if not admin_orgs:
        return {
            "status": "forbidden",
            "error": "not_an_admin",
            "detail": "Your GitHub account is not an admin of any allowed organization.",
        }

    store: SessionStore = request.app.state.sessions
    cookie_value = store.create(login=user.get("login", ""), token=token, admin_orgs=admin_orgs)
    _set_session_cookie(response, settings, cookie_value)
    return {"status": "ok", "login": user.get("login", ""), "orgs": admin_orgs}


@router.get("/me")
async def me(request: Request):
    session = require_session(request)
    return {"login": session.login, "orgs": session.admin_orgs}


@router.post("/logout")
async def logout(request: Request, response: Response):
    store: SessionStore = request.app.state.sessions
    store.drop(request.cookies.get(COOKIE_NAME))
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"status": "ok"}
