"""Ontario statutory holidays (computed locally with the `holidays` package)."""

from __future__ import annotations

import holidays
import pandas as pd

REGION = "CA-ON"


def ontario_holidays(years: range) -> pd.DataFrame:
    # Civic Holiday (August) is not statutory but most offices close, so the
    # load drops like a holiday; include the optional category to capture it.
    cal = holidays.country_holidays(
        "CA", subdiv="ON", years=list(years), categories=(holidays.PUBLIC, holidays.OPTIONAL)
    )
    rows = [(day, REGION, name) for day, name in sorted(cal.items())]
    return pd.DataFrame(rows, columns=["day", "region", "name"])
