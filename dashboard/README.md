# Octerse Admin Dashboard

Live backend + admin login for the Copilot AI Credits admin panel.
A small FastAPI service serves the panel ([static/index.html](static/index.html)),
authenticates admins via **GitHub OAuth device flow**, and proxies live data from
the GitHub Copilot metrics + billing APIs (the same endpoints `gh octerse spend` reads).

Only users who are an **admin of an allowed organization** can sign in.
The GitHub token obtained at login never leaves the server — the browser only
holds a signed, httpOnly session cookie.

## Prerequisites

1. A **GitHub OAuth App** (org → Settings → Developer settings → OAuth Apps):
   - Enable **Device flow**.
   - No callback URL is needed for device flow.
   - Note the **Client ID**.
2. Admins signing in will be asked to grant `read:org` and `manage_billing:copilot`.

## Configuration (environment variables)

| Variable | Required | Description |
| --- | --- | --- |
| `GITHUB_OAUTH_CLIENT_ID` | yes | OAuth App client id (device flow enabled) |
| `SESSION_SECRET` | yes | long random string used to sign session cookies |
| `OCTERSE_ALLOWED_ORGS` | recommended | comma-separated org allow-list; if unset, any org the user administers is shown |
| `OCTERSE_ENTERPRISE` | no | display name of the enterprise in the header |
| `OCTERSE_CACHE_TTL` | no | seconds to cache GitHub responses (default 300) |
| `OCTERSE_SESSION_TTL` | no | session lifetime in seconds (default 8h) |
| `OCTERSE_INSECURE_COOKIES` | no | set `1` only for plain-HTTP local dev |

## Run locally

```sh
cd dashboard
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'

export GITHUB_OAUTH_CLIENT_ID=<client id>
export SESSION_SECRET=$(openssl rand -hex 32)
export OCTERSE_ALLOWED_ORGS=my-org
export OCTERSE_INSECURE_COOKIES=1   # http://localhost only

uvicorn server.app:create_app --factory --reload
# open http://127.0.0.1:8000
```

## Tests

```sh
pip install -e '.[dev]'
pytest
```

## Deploy (container)

```sh
docker build -t octerse-dashboard .
docker run -p 8000:8000 \
  -e GITHUB_OAUTH_CLIENT_ID=... -e SESSION_SECRET=... \
  -e OCTERSE_ALLOWED_ORGS=my-org \
  octerse-dashboard
```

Any container host works (Azure Container Apps, Cloud Run, Fly, …).
Run behind HTTPS in production — cookies are `Secure` by default.
For Azure Container Apps: put `SESSION_SECRET` in a secret, set min replicas to 1
(sessions and cache are in-memory), and pin to a single replica or add sticky
sessions if you scale out.

## Data sources & honesty notes

| Widget | Source |
| --- | --- |
| Credits consumed | `GET /organizations/{org}/settings/billing/usage` (premium-request quantity; falls back to chat turns, flagged `~`) |
| Net billed | same endpoint, Copilot products' `netAmount` |
| Model mix / daily trend / active users | `GET /orgs/{org}/copilot/metrics` |
| LOC accepted | Copilot metrics `total_code_lines_accepted` |
| Budgets / credit pool | `GET /organizations/{org}/settings/billing/budgets` (preview; degrades to "no budgets set") |
| Per-user table | `GET /orgs/{org}/copilot/billing/seats`; per-user credits/LOC are even-split **estimates** (GitHub exposes no per-user billing) and are flagged `~` in the UI |

Fields the APIs can't provide stay clearly labelled as estimates — the footer
lists which fields are estimated for the current tenant.
