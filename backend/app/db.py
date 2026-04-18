"""Async Postgres connection pool with pgvector registered per connection."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from pgvector.psycopg import register_vector_async
from psycopg_pool import AsyncConnectionPool

_pool: AsyncConnectionPool | None = None


async def _configure(conn) -> None:
    await register_vector_async(conn)


def get_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        url = os.environ["DATABASE_URL"]
        _pool = AsyncConnectionPool(
            url,
            min_size=1,
            max_size=5,
            open=False,
            configure=_configure,
        )
    return _pool


async def open_pool() -> None:
    await get_pool().open()


async def close_pool() -> None:
    if _pool is not None:
        await _pool.close()


@asynccontextmanager
async def conn():
    async with get_pool().connection() as c:
        yield c
