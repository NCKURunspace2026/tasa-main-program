from app.services.score_service import calculate_score


def score_config():
    return {
        "timeReferenceSec": 5000,
        "timeSlope": 0.001,
        "deltaVReferenceKmPerSec": 0.5,
        "deltaVSlope": 5,
    }


def test_distance_score_uses_the_fixed_competition_term_after_interception():
    near_threshold = calculate_score(score_config(), 4.9, 5000, 0.5)
    closer = calculate_score(score_config(), 1.0, 5000, 0.5)

    assert near_threshold["distanceScore"] == 50
    assert closer["distanceScore"] == 50
    assert near_threshold["totalScore"] == closer["totalScore"]


def test_distance_score_decays_outside_the_intercept_distance():
    result = calculate_score(score_config(), 5.1, 5000, 0.5)

    assert 0 < result["distanceScore"] < 50
