"""Session-gated data API.

GET /api/dashboard returns the full dataset in the exact shapes the
panel's render pipeline expects (enterprise pool, models, orgs, users,
budgets). Fields that have no real API source are estimated and flagged
via the top-level `estimated` list so the UI can label them.
"""

from __future__ import annotations

import asyncio
import datetime as dt

from fastapi import APIRouter, Depends, Request

from .auth import Session, require_session
from .config import Settings
from .github import (
    GitHubClient,
    GitHubError,
    extract_active_users,
    extract_budgets,
    extract_chat_turns,
    extract_copilot_cents,
    extract_daily_series,
    extract_loc_accepted,
    extract_model_mix,
    extract_premium_quantity,
    extract_seats,
)

router = APIRouter(prefix="/api")

MAX_MODELS = 5


def _period(now: dt.date) -> dict:
    first = now.replace(day=1)
    if now.month == 12:
        next_first = dt.date(now.year + 1, 1, 1)
    else:
        next_first = dt.date(now.year, now.month + 1, 1)
    return {
        "since": first.isoformat(),
        "until": now.isoformat(),
        "day": now.day,
        "daysInMonth": (next_first - first).days,
        "label": now.strftime("%B %Y"),
        "resets": next_first.strftime("%b %-d, 00:00 UTC"),
    }


async def _org_snapshot(gh: GitHubClient, org: str, period: dict) -> dict:
    """Fetch + parse one org; degrades gracefully per endpoint and records
    which sources failed so the UI can show partial-data warnings."""
    year, month = int(period["until"][:4]), int(period["until"][5:7])
    errors: dict[str, str] = {}

    async def safe(coro, fallback, label: str):
        try:
            return await coro
        except GitHubError as exc:
            errors[label] = f"HTTP {exc.status}: {exc.message}"
            return fallback

    metrics, billing, budgets, seats = await asyncio.gather(
        safe(gh.copilot_metrics(org, period["since"], period["until"]), [], "metrics"),
        safe(gh.billing_usage(org, year, month), {"usageItems": []}, "billing"),
        safe(gh.budgets(org), {}, "budgets"),
        safe(gh.copilot_seats(org), {}, "seats"),
    )
    return {
        "org": org,
        "active_users": extract_active_users(metrics),
        "chat_turns": extract_chat_turns(metrics),
        "model_mix": extract_model_mix(metrics),
        "daily": extract_daily_series(metrics),
        "loc": extract_loc_accepted(metrics),
        "cents": extract_copilot_cents(billing),
        "premium": extract_premium_quantity(billing),
        "budgets": extract_budgets(budgets),
        "seats": extract_seats(seats),
        "errors": errors,
    }


def _assemble(snapshots: list[dict], period: dict, settings: Settings) -> dict:
    estimated: set[str] = set()

    # Global model list: top N by chat turns across all orgs.
    totals: dict[str, int] = {}
    for snap in snapshots:
        for name, v in snap["model_mix"].items():
            totals[name] = totals.get(name, 0) + v
    model_names = [n for n, _ in sorted(totals.items(), key=lambda kv: -kv[1])][:MAX_MODELS]

    # Align daily series across orgs on the union of dates.
    dates = sorted({d["date"] for snap in snapshots for d in snap["daily"] if d["date"]})

    orgs = []
    users = []
    budgets = []
    total_cents = 0
    for snap in snapshots:
        credits = snap["premium"]
        if credits == 0 and snap["chat_turns"] > 0:
            credits = snap["chat_turns"]  # engagement proxy when no premium SKU usage
            estimated.add("credits")
        per_day = {d["date"]: d["value"] for d in snap["daily"]}
        org_row = {
            "name": snap["org"],
            "credits": credits,
            "loc": snap["loc"],
            "models": [snap["model_mix"].get(n, 0) for n in model_names],
            "daily": [per_day.get(date, 0) for date in dates],
            "activeUsers": snap["active_users"],
            "chatTurns": snap["chat_turns"],
        }
        orgs.append(org_row)
        total_cents += snap["cents"]
        budgets.extend(snap["budgets"])

        # Per-user rows from Copilot seats. The billing APIs expose no
        # per-user credit split, so distribute the org total evenly and label it.
        seats = snap["seats"]
        if seats:
            share = credits // len(seats) if credits else 0
            if credits:
                estimated.add("user_credits")
            top_model = model_names[0] if model_names and snap["model_mix"] else "—"
            for seat in seats:
                users.append(
                    {
                        "login": seat["login"],
                        "team": snap["org"],
                        "credits": share,
                        "net": 0,
                        "topModel": top_model,
                        "loc": snap["loc"] // len(seats),
                        "budget": None,
                        "lastActivity": seat.get("last_activity_at"),
                        "editor": seat.get("last_activity_editor"),
                    }
                )

    pool_total = sum(b["amount"] for b in budgets) if budgets else 0
    pool_consumed = sum(o["credits"] for o in orgs)
    if not budgets:
        estimated.add("pool")

    errors = {snap["org"]: snap["errors"] for snap in snapshots if snap["errors"]}

    return {
        "enterprise": {
            "name": settings.enterprise or "all organizations",
            "poolTotal": pool_total,
            "poolConsumed": pool_consumed,
            "netOverageUSD": round(total_cents / 100, 2),
            "pricePerUnit": settings.price_per_unit,
        },
        "models": [{"name": n} for n in model_names],
        "orgs": orgs,
        "teams": [],  # team-level metrics: follow-up iteration
        "users": users,
        "budgets": budgets,
        "days": [d[5:] if len(d) >= 10 else d for d in dates],  # MM-DD labels
        "period": period,
        "estimated": sorted(estimated),
        "errors": errors,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }


@router.get("/dashboard")
async def dashboard(request: Request, session: Session = Depends(require_session)):
    settings: Settings = request.app.state.settings
    cache = request.app.state.cache
    cache_key = f"dashboard:{session.login}:{','.join(session.admin_orgs)}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    gh = GitHubClient(request.app.state.http, session.token, settings)
    period = _period(dt.date.today())
    snapshots = await asyncio.gather(
        *(_org_snapshot(gh, org, period) for org in session.admin_orgs)
    )
    payload = _assemble(list(snapshots), period, settings)
    cache.set(cache_key, payload)
    return payload
