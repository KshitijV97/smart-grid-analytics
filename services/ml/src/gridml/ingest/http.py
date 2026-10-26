"""Shared HTTP client with retries for the public data providers."""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from gridml.config import get_settings

log = logging.getLogger(__name__)


class NotFoundError(Exception):
    """The provider has no file for the requested period."""


def get(url: str, params: dict[str, Any] | None = None, attempts: int = 4) -> httpx.Response:
    settings = get_settings()
    headers = {"User-Agent": settings.user_agent}
    delay = 2.0
    for attempt in range(1, attempts + 1):
        try:
            resp = httpx.get(
                url,
                params=params,
                headers=headers,
                timeout=settings.http_timeout_seconds,
                follow_redirects=True,
            )
            if resp.status_code == 404:
                raise NotFoundError(url)
            if resp.status_code == 429 or resp.status_code >= 500:
                raise httpx.HTTPStatusError(
                    f"HTTP {resp.status_code}", request=resp.request, response=resp
                )
            resp.raise_for_status()
            return resp
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            if attempt == attempts:
                raise
            log.warning("GET %s failed (%s), retrying in %.0fs", url, exc, delay)
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")
