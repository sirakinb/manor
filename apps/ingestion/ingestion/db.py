"""Postgres access. Every write carries the workspaceId the request named;
nothing here ever picks a workspace on its own."""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from contextlib import contextmanager
from typing import Any, Iterator, Sequence

import psycopg2
import psycopg2.extras


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


@contextmanager
def connection() -> Iterator[Any]:
    # Prisma stores DateTime as a naive UTC timestamp, so every session is UTC and
    # a plain now() lands the right value in "createdAt"/"updatedAt".
    conn = psycopg2.connect(database_url(), options="-c timezone=UTC")
    conn.autocommit = False
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def new_id() -> str:
    """Row ids are opaque strings in Manor (Prisma cuid by default); a uuid4 string is fine."""
    return str(uuid.uuid4())


def jsonb(value: Any) -> psycopg2.extras.Json:
    return psycopg2.extras.Json(value, dumps=lambda v: json.dumps(v, default=str))


def upsert_rows(
    cur: Any,
    table: str,
    columns: Sequence[str],
    rows: Sequence[Sequence[Any]],
    conflict: Sequence[str],
    *,
    update: Sequence[str] | None = None,
    touch_updated_at: bool = True,
    page_size: int = 500,
) -> int:
    """INSERT ... ON CONFLICT DO UPDATE for camelCase-quoted Manor tables.

    `columns` must start with "id"; a fresh uuid is supplied per row and kept
    only when the row is new (the conflict update never touches id).
    """
    if not rows:
        return 0
    quoted = ", ".join(f'"{c}"' for c in columns)
    updates = list(update if update is not None else [c for c in columns if c not in ("id", *conflict)])
    set_clause = ", ".join(f'"{c}" = excluded."{c}"' for c in updates)
    if touch_updated_at and "updatedAt" not in updates:
        set_clause = f'{set_clause}, "updatedAt" = now()' if set_clause else '"updatedAt" = now()'
    conflict_clause = ", ".join(f'"{c}"' for c in conflict)
    sql = (
        f'insert into "{table}" ({quoted}) values %s '
        f"on conflict ({conflict_clause}) do update set {set_clause}"
    )
    psycopg2.extras.execute_values(cur, sql, rows, page_size=page_size)
    return len(rows)


def utc_now() -> datetime:
    """Naive UTC, the shape Prisma writes into timestamp(3) columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
