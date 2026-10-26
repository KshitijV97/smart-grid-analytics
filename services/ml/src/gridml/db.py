"""Thin Postgres helpers built on psycopg 3."""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any

import pandas as pd
import psycopg
from psycopg.rows import dict_row

from gridml.config import get_settings


@contextmanager
def connect() -> Iterator[psycopg.Connection[dict[str, Any]]]:
    # prepare_threshold=None keeps us compatible with transaction-mode poolers.
    with psycopg.connect(
        get_settings().database_url, row_factory=dict_row, prepare_threshold=None
    ) as conn:
        yield conn


def fetch_df(sql: str, params: Sequence[Any] | dict[str, Any] | None = None) -> pd.DataFrame:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
        cols = [d.name for d in cur.description] if cur.description else []
    return pd.DataFrame(rows, columns=cols)


def upsert_df(
    df: pd.DataFrame,
    table: str,
    key: Sequence[str],
    *,
    touch_ingested_at: bool = False,
    batch_size: int = 5000,
) -> int:
    """Insert rows, updating non-key columns on conflict. Returns rows written."""
    if df.empty:
        return 0
    cols = list(df.columns)
    updates = [c for c in cols if c not in key]
    col_sql = ", ".join(cols)
    placeholders = ", ".join(["%s"] * len(cols))
    set_sql = ", ".join(f"{c} = excluded.{c}" for c in updates)
    if touch_ingested_at:
        set_sql += ", ingested_at = now()"
    sql = (
        f"insert into {table} ({col_sql}) values ({placeholders}) "
        f"on conflict ({', '.join(key)}) do update set {set_sql}"
    )
    clean = df.astype(object).where(pd.notna(df), None)
    records = [tuple(r) for r in clean.itertuples(index=False, name=None)]
    with connect() as conn, conn.cursor() as cur:
        for i in range(0, len(records), batch_size):
            cur.executemany(sql, records[i : i + batch_size])
        conn.commit()
    return len(records)


def execute(sql: str, params: Sequence[Any] | dict[str, Any] | None = None) -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall() if cur.description else []
        conn.commit()
    return rows
