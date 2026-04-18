"""Launcher for the FastAPI app.

Forces a SelectorEventLoop on Windows by calling uvicorn's Server directly
with a custom asyncio loop factory. The default `uvicorn.run()` re-installs
a ProactorEventLoop policy on Windows, which psycopg's async mode can't use.
"""
from __future__ import annotations

import asyncio
import os
import selectors
import sys


def main() -> None:
    from uvicorn import Config, Server

    config = Config(
        "app.main:app",
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
        log_level=os.environ.get("LOG_LEVEL", "info"),
        loop="asyncio",
    )
    server = Server(config)

    loop_factory = None
    if sys.platform == "win32":
        loop_factory = lambda: asyncio.SelectorEventLoop(selectors.SelectSelector())

    asyncio.run(server.serve(), loop_factory=loop_factory)


if __name__ == "__main__":
    main()
