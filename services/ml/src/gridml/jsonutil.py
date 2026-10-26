"""JSON helpers that turn NaN / inf into null (Postgres jsonb and browsers reject NaN)."""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

import numpy as np


def clean(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, list | tuple):
        return [clean(v) for v in obj]
    if isinstance(obj, float | np.floating):
        return float(obj) if np.isfinite(obj) else None
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, datetime | date):
        return obj.isoformat()
    return obj


def dumps(obj: Any) -> str:
    return json.dumps(clean(obj))
