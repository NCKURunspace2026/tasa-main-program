from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ..models import AppSetting


VALIDATION_SETTINGS_KEY = "validation"


def get_validation_settings(session: Session) -> dict:
    setting = session.get(AppSetting, VALIDATION_SETTINGS_KEY)
    value = setting.value_json if setting else {}
    return {
        "gmatApiUrl": value.get("gmatApiUrl"),
        "validationProvider": "mock-validation-not-physical",
    }


def update_validation_settings(session: Session, gmat_api_url: Optional[str]) -> dict:
    setting = session.get(AppSetting, VALIDATION_SETTINGS_KEY)
    value = {"gmatApiUrl": gmat_api_url}
    if setting is None:
        setting = AppSetting(key=VALIDATION_SETTINGS_KEY, value_json=value)
        session.add(setting)
    else:
        setting.value_json = value
    session.commit()
    return get_validation_settings(session)
