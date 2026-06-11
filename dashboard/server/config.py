"""Configuration for the Octerse admin dashboard backend.

All settings come from environment variables so the same image runs
locally and in a hosted container service.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


class ConfigError(RuntimeError):
    pass


@dataclass
class Settings:
    github_oauth_client_id: str
    session_secret: str
    allowed_orgs: list[str] = field(default_factory=list)
    enterprise: str | None = None
    github_api_url: str = "https://api.github.com"
    github_oauth_url: str = "https://github.com"
    github_api_version: str = "2022-11-28"
    cache_ttl_seconds: int = 300
    session_ttl_seconds: int = 8 * 3600
    secure_cookies: bool = True
    # USD billed per premium request beyond the included allowance.
    price_per_unit: float = 0.04

    @classmethod
    def from_env(cls) -> "Settings":
        client_id = os.environ.get("GITHUB_OAUTH_CLIENT_ID", "")
        secret = os.environ.get("SESSION_SECRET", "")
        if not client_id:
            raise ConfigError(
                "GITHUB_OAUTH_CLIENT_ID is required (a GitHub OAuth App client id "
                "with device flow enabled)"
            )
        if not secret:
            raise ConfigError("SESSION_SECRET is required (any long random string)")
        orgs = [
            o.strip()
            for o in os.environ.get("OCTERSE_ALLOWED_ORGS", "").split(",")
            if o.strip()
        ]
        return cls(
            github_oauth_client_id=client_id,
            session_secret=secret,
            allowed_orgs=orgs,
            enterprise=os.environ.get("OCTERSE_ENTERPRISE") or None,
            github_api_url=os.environ.get("GITHUB_API_URL", cls.github_api_url),
            github_oauth_url=os.environ.get("GITHUB_OAUTH_URL", cls.github_oauth_url),
            cache_ttl_seconds=int(os.environ.get("OCTERSE_CACHE_TTL", "300")),
            session_ttl_seconds=int(os.environ.get("OCTERSE_SESSION_TTL", str(8 * 3600))),
            secure_cookies=os.environ.get("OCTERSE_INSECURE_COOKIES", "") != "1",
        )
