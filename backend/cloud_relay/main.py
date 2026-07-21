"""Compatibility entrypoint for the former stateless relay.

FastAPI Cloud now deploys ``app.main:app`` from the backend directory. Keeping
this import avoids breaking old local commands while ensuring there is only one
backend implementation.
"""

from app.main import app

__all__ = ["app"]
