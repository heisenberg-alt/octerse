"""Parsing helpers must mirror the jq logic in gh-octerse spend."""

from server.github import (
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
from tests.conftest import BILLING_FIXTURE, METRICS_FIXTURE, SEATS_FIXTURE


def test_active_users_takes_latest_day():
    assert extract_active_users(METRICS_FIXTURE) == 15
    assert extract_active_users([]) == 0
    assert extract_active_users({"message": "Not Found"}) == 0


def test_chat_turns_sums_all_models_all_days():
    assert extract_chat_turns(METRICS_FIXTURE) == 100


def test_model_mix():
    assert extract_model_mix(METRICS_FIXTURE) == {"gpt-5": 75, "claude-sonnet": 25}


def test_daily_series():
    assert extract_daily_series(METRICS_FIXTURE) == [
        {"date": "2026-06-01", "value": 65},
        {"date": "2026-06-02", "value": 35},
    ]


def test_loc_accepted():
    assert extract_loc_accepted(METRICS_FIXTURE) == 120


def test_copilot_cents_filters_product_and_ignores_actions():
    # (4.5 + 380.0) * 100 — the Actions line is excluded
    assert extract_copilot_cents(BILLING_FIXTURE) == 38450


def test_premium_quantity_matches_sku():
    assert extract_premium_quantity(BILLING_FIXTURE) == 500


def test_camel_and_snake_case_both_parse():
    camel = [{"date": "2026-06-01", "totalActiveUsers": 7,
              "copilotIdeChat": {"editors": [{"models": [{"name": "m", "totalChats": 3}]}]}}]
    assert extract_active_users(camel) == 7
    assert extract_chat_turns(camel) == 3
    snake_billing = {"usage_items": [{"product": "copilot", "sku": "premium", "quantity": 2, "net_amount": 1.0}]}
    assert extract_copilot_cents(snake_billing) == 100
    assert extract_premium_quantity(snake_billing) == 2


def test_budgets_normalization():
    raw = {"budgets": [{"type": "organization", "budget_amount": 1000,
                        "current_spend": 250, "target": {"name": "zava"},
                        "prevent_further_usage": True}]}
    assert extract_budgets(raw) == [
        {"scope": "organization", "entity": "zava", "amount": 1000.0,
         "consumed": 250.0, "enforce": True}
    ]
    assert extract_budgets({"message": "Not Found"}) == []


def test_seats():
    seats = extract_seats(SEATS_FIXTURE)
    assert [s["login"] for s in seats] == ["octo-dev", "octo-admin"]
