"""Compatibility entrypoint for the optional replica relay cache.

FastAPI Cloud deploys ``app.main:app`` from the backend directory. The same API
serves local nodes and the reconstructible relay role so their sync contract
cannot drift.
"""

from app.main import app

__all__ = ["app"]
