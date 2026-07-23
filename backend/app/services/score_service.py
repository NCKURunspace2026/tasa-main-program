from __future__ import annotations

import math


class InvalidScoreConfigError(ValueError):
    pass


def calculate_score(
    score_config: dict,
    minimum_distance_km: float,
    mission_time_sec: float,
    total_delta_v_kmps: float,
    penalty_score: float = 0,
) -> dict:
    required = (
        "distanceReferenceKm", "distanceDecayKm", "timeReferenceSec",
        "timeSlope", "deltaVReferenceKmPerSec", "deltaVSlope",
        "distanceWeight", "timeWeight", "deltaVWeight",
    )
    missing = [key for key in required if key not in score_config]
    if missing:
        raise InvalidScoreConfigError(f"scoreConfig is missing: {', '.join(missing)}.")

    values = {key: float(score_config[key]) for key in required}
    if not all(math.isfinite(value) for value in values.values()):
        raise InvalidScoreConfigError("scoreConfig values must be finite.")
    if values["distanceDecayKm"] <= 0:
        raise InvalidScoreConfigError("distanceDecayKm must be greater than zero.")

    distance_score = (
        values["distanceWeight"]
        if minimum_distance_km <= values["distanceReferenceKm"]
        else 0.0
    )
    time_score = values["timeWeight"] / (
        1 + math.exp(_clamp_exponent(
            values["timeSlope"] * (mission_time_sec - values["timeReferenceSec"])
        ))
    )
    delta_v_score = values["deltaVWeight"] / (
        1 + math.exp(_clamp_exponent(
            values["deltaVSlope"] * (
                total_delta_v_kmps - values["deltaVReferenceKmPerSec"]
            )
        ))
    )
    total_score = distance_score + time_score + delta_v_score - penalty_score
    return {
        "distanceScore": distance_score,
        "timeScore": time_score,
        "deltaVScore": delta_v_score,
        "penaltyScore": penalty_score,
        "totalScore": total_score,
    }


def _clamp_exponent(value: float) -> float:
    return max(-700.0, min(700.0, value))
