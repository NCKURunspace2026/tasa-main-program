from __future__ import annotations

from typing import Optional
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, field_validator


class ValidationSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gmatApiUrl: Optional[str] = None

    @field_validator("gmatApiUrl")
    @classmethod
    def validate_gmat_api_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value.strip() == "":
            return None
        normalized = value.strip().rstrip("/")
        parsed = urlparse(normalized)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("gmatApiUrl must be a valid HTTP or HTTPS URL.")
        return normalized
