from app.services.score_service import calculate_score


def score_config():
    return {
        "distanceReferenceKm": 5,
        "distanceDecayKm": 100,
        "timeReferenceSec": 5000,
        "timeSlope": 0.001,
        "deltaVReferenceKmPerSec": 0.5,
        "deltaVSlope": 5,
        "distanceWeight": 50,
        "timeWeight": 25,
        "deltaVWeight": 25,
    }


def test_distance_score_is_binary_after_required_distance_is_reached():
    near_threshold = calculate_score(score_config(), 4.9, 5000, 0.5)
    closer = calculate_score(score_config(), 1.0, 5000, 0.5)

    assert near_threshold["distanceScore"] == 50
    assert closer["distanceScore"] == 50
    assert near_threshold["totalScore"] == closer["totalScore"]


def test_distance_score_is_zero_before_required_distance_is_reached():
    result = calculate_score(score_config(), 5.1, 5000, 0.5)

    assert result["distanceScore"] == 0
