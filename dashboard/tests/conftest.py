"""Shared fixtures: a mock GitHub (oauth + api) behind httpx.MockTransport."""

from __future__ import annotations

import httpx
import pytest

from server.app import create_app
from server.config import Settings

METRICS_FIXTURE = [
    {
        "date": "2026-06-01",
        "total_active_users": 12,
        "copilot_ide_chat": {
            "editors": [
                {
                    "name": "vscode",
                    "models": [
                        {"name": "gpt-5", "total_chats": 40},
                        {"name": "claude-sonnet", "total_chats": 25},
                    ],
                }
            ]
        },
        "copilot_ide_code_completions": {
            "editors": [
                {
                    "models": [
                        {"languages": [{"name": "python", "total_code_lines_accepted": 120}]}
                    ]
                }
            ]
        },
    },
    {
        "date": "2026-06-02",
        "total_active_users": 15,
        "copilot_ide_chat": {
            "editors": [
                {"name": "vscode", "models": [{"name": "gpt-5", "total_chats": 35}]}
            ]
        },
    },
]

BILLING_FIXTURE = {
    "usageItems": [
        {"product": "Copilot", "sku": "copilot_premium_requests", "quantity": 500, "netAmount": 4.5},
        {"product": "Copilot", "sku": "copilot_business_seats", "quantity": 20, "netAmount": 380.0},
        {"product": "Actions", "sku": "actions_linux", "quantity": 9000, "netAmount": 72.0},
    ]
}

SEATS_FIXTURE = {
    "total_seats": 2,
    "seats": [
        {"assignee": {"login": "octo-dev"}, "last_activity_at": "2026-06-10T12:00:00Z", "last_activity_editor": "vscode"},
        {"assignee": {"login": "octo-admin"}, "last_activity_at": "2026-06-11T09:00:00Z", "last_activity_editor": "vscode"},
    ],
}


class FakeGitHub:
    """Configurable request handler for httpx.MockTransport."""

    def __init__(self):
        self.authorized = True       # device flow immediately authorized
        self.membership_role = "admin"

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/login/device/code":
            return httpx.Response(200, json={
                "device_code": "dev-123", "user_code": "ABCD-1234",
                "verification_uri": "https://github.com/login/device",
                "expires_in": 900, "interval": 5,
            })
        if path == "/login/oauth/access_token":
            if not self.authorized:
                return httpx.Response(200, json={"error": "authorization_pending"})
            return httpx.Response(200, json={"access_token": "gho_test", "token_type": "bearer"})
        if path == "/user":
            return httpx.Response(200, json={"login": "octo-admin"})
        if path == "/user/memberships/orgs/zava":
            return httpx.Response(200, json={"role": self.membership_role, "state": "active"})
        if path == "/orgs/zava/copilot/metrics":
            return httpx.Response(200, json=METRICS_FIXTURE)
        if path == "/organizations/zava/settings/billing/usage":
            return httpx.Response(200, json=BILLING_FIXTURE)
        if path == "/organizations/zava/settings/billing/budgets":
            return httpx.Response(404, json={"message": "Not Found"})
        if path == "/orgs/zava/copilot/billing/seats":
            return httpx.Response(200, json=SEATS_FIXTURE)
        return httpx.Response(404, json={"message": f"unmocked path {path}"})


@pytest.fixture
def fake_github() -> FakeGitHub:
    return FakeGitHub()


@pytest.fixture
def settings() -> Settings:
    return Settings(
        github_oauth_client_id="test-client-id",
        session_secret="test-secret",
        allowed_orgs=["zava"],
        secure_cookies=False,
        cache_ttl_seconds=0,
    )


@pytest.fixture
async def client(settings, fake_github):
    app = create_app(settings=settings, transport=httpx.MockTransport(fake_github.handler))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as c:
        async with app.router.lifespan_context(app):
            yield c


async def login(client) -> dict:
    """Run the full device flow against the fake GitHub; returns poll result."""
    start = (await client.post("/api/auth/device/start")).json()
    resp = await client.post(
        "/api/auth/device/poll", json={"pending_id": start["pending_id"]}
    )
    return resp.json()
