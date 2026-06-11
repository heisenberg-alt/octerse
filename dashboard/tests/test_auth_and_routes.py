"""Auth flow + session gating + dashboard assembly."""

from tests.conftest import login


async def test_dashboard_requires_session(client):
    resp = await client.get("/api/dashboard")
    assert resp.status_code == 401


async def test_me_requires_session(client):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


async def test_device_flow_login_as_admin(client):
    result = await login(client)
    assert result["status"] == "ok"
    assert result["login"] == "octo-admin"
    assert result["orgs"] == ["zava"]

    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json() == {"login": "octo-admin", "orgs": ["zava"]}


async def test_device_flow_pending(client, fake_github):
    fake_github.authorized = False
    result = await login(client)
    assert result["status"] == "pending"
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_non_admin_is_rejected(client, fake_github):
    fake_github.membership_role = "member"
    result = await login(client)
    assert result["status"] == "forbidden"
    assert result["error"] == "not_an_admin"
    assert (await client.get("/api/dashboard")).status_code == 401


async def test_logout_clears_session(client):
    await login(client)
    assert (await client.get("/api/auth/me")).status_code == 200
    await client.post("/api/auth/logout")
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_dashboard_payload(client):
    await login(client)
    resp = await client.get("/api/dashboard")
    assert resp.status_code == 200
    d = resp.json()

    assert d["enterprise"]["netOverageUSD"] == 384.5
    assert [m["name"] for m in d["models"]] == ["gpt-5", "claude-sonnet"]

    (org,) = d["orgs"]
    assert org["name"] == "zava"
    assert org["credits"] == 500          # premium request quantity
    assert org["loc"] == 120              # accepted completion lines
    assert org["models"] == [75, 25]
    assert org["daily"] == [65, 35]
    assert org["activeUsers"] == 15

    assert d["days"] == ["06-01", "06-02"]
    assert len(d["users"]) == 2
    assert d["users"][0]["credits"] == 250  # 500 split across 2 seats
    assert "user_credits" in d["estimated"]
    assert "pool" in d["estimated"]         # budgets endpoint 404s in fixture
    assert d["budgets"] == []
    assert d["teams"] == []


async def test_unknown_pending_id(client):
    resp = await client.post("/api/auth/device/poll", json={"pending_id": "nope"})
    assert resp.status_code == 404
