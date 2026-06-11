"""Async GitHub API client + response parsing for the admin dashboard.

The endpoint selection and the defensive parsing mirror `cmd_spend` in
the gh-octerse CLI (copilot metrics + billing usage, snake/camel-case
tolerant), so numbers here agree with `gh octerse spend`.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from .config import Settings


class GitHubError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"GitHub API {status}: {message}")
        self.status = status
        self.message = message


class TTLCache:
    def __init__(self, ttl_seconds: int):
        self._ttl = ttl_seconds
        self._data: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        hit = self._data.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        self._data.pop(key, None)
        return None

    def set(self, key: str, value: Any) -> None:
        self._data[key] = (time.monotonic() + self._ttl, value)


class GitHubClient:
    """Thin async wrapper; one instance per authenticated session token."""

    def __init__(self, http: httpx.AsyncClient, token: str, settings: Settings):
        self._http = http
        self._token = token
        self._settings = settings

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        resp = await self._http.get(
            f"{self._settings.github_api_url}{path}",
            params=params,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": self._settings.github_api_version,
            },
        )
        if resp.status_code >= 400:
            try:
                message = resp.json().get("message", resp.text)
            except ValueError:
                message = resp.text
            raise GitHubError(resp.status_code, message)
        return resp.json()

    async def user(self) -> dict:
        return await self._get("/user")

    async def org_membership(self, org: str) -> dict:
        return await self._get(f"/user/memberships/orgs/{org}")

    async def admin_org_memberships(self) -> list[str]:
        """Orgs where the user is an admin (used when no allow-list is set)."""
        memberships = await self._get(
            "/user/memberships/orgs", params={"state": "active", "per_page": 100}
        )
        return [
            m["organization"]["login"]
            for m in memberships
            if m.get("role") == "admin" and m.get("organization", {}).get("login")
        ]

    async def copilot_metrics(self, org: str, since: str, until: str) -> list:
        return await self._get(
            f"/orgs/{org}/copilot/metrics", params={"since": since, "until": until}
        )

    async def billing_usage(self, org: str, year: int, month: int) -> dict:
        return await self._get(
            f"/organizations/{org}/settings/billing/usage",
            params={"year": year, "month": month},
        )

    async def budgets(self, org: str) -> dict:
        return await self._get(f"/organizations/{org}/settings/billing/budgets")

    async def copilot_seats(self, org: str) -> dict:
        return await self._get(
            f"/orgs/{org}/copilot/billing/seats", params={"per_page": 100}
        )


# ---------------------------------------------------------------------------
# Pure parsing helpers (schema-tolerant, mirror the jq in gh-octerse spend)
# ---------------------------------------------------------------------------


def _pick(d: dict, *keys: str, default: Any = 0) -> Any:
    for k in keys:
        if d.get(k) is not None:
            return d[k]
    return default


def _chat_models(day: dict):
    chat = _pick(day, "copilot_ide_chat", "copilotIdeChat", default={}) or {}
    for editor in chat.get("editors") or []:
        yield from editor.get("models") or []


def extract_active_users(metrics: Any) -> int:
    if isinstance(metrics, list) and metrics:
        return int(_pick(metrics[-1], "total_active_users", "totalActiveUsers"))
    return 0


def extract_chat_turns(metrics: Any) -> int:
    if not isinstance(metrics, list):
        return 0
    return sum(
        int(_pick(m, "total_chats", "totalChats"))
        for day in metrics
        for m in _chat_models(day)
    )


def extract_model_mix(metrics: Any) -> dict[str, int]:
    """Chat turns per model name, summed across the period."""
    mix: dict[str, int] = {}
    if not isinstance(metrics, list):
        return mix
    for day in metrics:
        for m in _chat_models(day):
            name = m.get("name") or "unknown"
            mix[name] = mix.get(name, 0) + int(_pick(m, "total_chats", "totalChats"))
    return mix


def extract_daily_series(metrics: Any) -> list[dict]:
    """Per-day chat turns: [{date, value}, ...]."""
    out: list[dict] = []
    if not isinstance(metrics, list):
        return out
    for day in metrics:
        value = sum(int(_pick(m, "total_chats", "totalChats")) for m in _chat_models(day))
        out.append({"date": day.get("date", ""), "value": value})
    return out


def extract_loc_accepted(metrics: Any) -> int:
    """Accepted completion lines — the closest real signal to 'LOC committed'."""
    if not isinstance(metrics, list):
        return 0
    total = 0
    for day in metrics:
        comp = _pick(day, "copilot_ide_code_completions", "copilotIdeCodeCompletions", default={}) or {}
        for editor in comp.get("editors") or []:
            for model in editor.get("models") or []:
                for lang in model.get("languages") or []:
                    total += int(_pick(lang, "total_code_lines_accepted", "totalCodeLinesAccepted"))
    return total


def _usage_items(billing: Any) -> list[dict]:
    if not isinstance(billing, dict):
        return []
    return _pick(billing, "usageItems", "usage_items", default=[]) or []


def extract_copilot_cents(billing: Any) -> int:
    cents = 0.0
    for item in _usage_items(billing):
        if "copilot" in str(item.get("product", "")).lower():
            amount = _pick(item, "netAmount", "net_amount", "grossAmount", "gross_amount")
            cents += float(amount) * 100
    return int(cents)


def extract_premium_quantity(billing: Any) -> int:
    qty = 0.0
    for item in _usage_items(billing):
        sku = str(item.get("sku", "")).lower()
        if "premium" in sku or "request" in sku:
            qty += float(item.get("quantity") or 0)
    return int(qty)


def extract_budgets(budgets: Any) -> list[dict]:
    """Normalize the (preview) budgets API into the panel's budget rows."""
    if not isinstance(budgets, dict):
        return []
    rows = []
    for b in budgets.get("budgets") or []:
        amount = float(_pick(b, "budget_amount", "amount", "targetAmount"))
        consumed = float(_pick(b, "current_spend", "spend", "consumed"))
        target = b.get("target") or {}
        entity = (
            target.get("name")
            or target.get("slug")
            or _pick(b, "name", "id", default="budget")
        )
        rows.append(
            {
                "scope": _pick(b, "type", "scope", default="organization"),
                "entity": str(entity),
                "amount": amount,
                "consumed": consumed,
                "enforce": bool(
                    _pick(b, "prevent_further_usage", "stop_usage", "enforce", default=False)
                ),
            }
        )
    return rows


def extract_seats(seats: Any) -> list[dict]:
    out = []
    if not isinstance(seats, dict):
        return out
    for seat in seats.get("seats") or []:
        login = (seat.get("assignee") or {}).get("login")
        if not login:
            continue
        out.append(
            {
                "login": login,
                "last_activity_at": seat.get("last_activity_at"),
                "last_activity_editor": seat.get("last_activity_editor"),
            }
        )
    return out
