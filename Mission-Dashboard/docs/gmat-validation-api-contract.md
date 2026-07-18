# GMAT Validation Integration Contract v1

## Purpose

The primary production path is **Electron Client → local `GmatConsole` → central server**. Each client runs GMAT locally using its configured executable path; the server stores validation evidence and builds the leaderboard. This document preserves a future HTTP adapter contract only; it is not the current execution path.

## Optional future HTTP adapter request

`POST {gmatApiUrl}/validate`

```json
{
  "schemaVersion": "1.0",
  "scenario": {
    "scenarioId": "SC-004",
    "name": "Earth-Moon Transfer",
    "definition": {
      "schemaVersion": "1.0",
      "referenceFrame": "EarthMJ2000Eq",
      "units": {
        "distance": "km",
        "velocity": "km/s",
        "time": "s"
      },
      "chaserInitialState": {
        "epochUtc": "2026-01-01T00:00:00Z",
        "positionKm": [7000, 0, 0],
        "velocityKmPerS": [0, 7.546, 0]
      },
      "targetInitialState": {
        "epochUtc": "2026-01-01T00:00:00Z",
        "positionKm": [7100, 0, 0],
        "velocityKmPerS": [0, 7.493, 0]
      },
      "constraints": {
        "maximumBurnCount": 10,
        "maximumTotalDeltaV": 1.5,
        "maximumMissionTime": 21600,
        "maximumFinalDistance": 5
      }
    }
  },
  "submission": {
    "submissionId": "SUB-000001",
    "finalDecisionVariables": {
      "tWait": 0,
      "burns": [],
      "finalCoastTime": 5000
    }
  }
}
```

## Successful response

```json
{
  "status": "validated",
  "providerRunId": "gmat-run-123",
  "officialResults": {
    "officialScore": 76.42,
    "finalDistance": 4.9809,
    "totalDeltaV": 0.5392,
    "totalTime": 5079.24,
    "burnCount": 2
  },
  "constraints": [
    {
      "name": "finalDistance",
      "value": 4.9809,
      "limit": 5,
      "operator": "<=",
      "satisfied": true
    }
  ],
  "artifacts": {
    "trajectoryImageBase64": "optional-base64-png",
    "log": "optional GMAT output"
  }
}
```

## Failure response

```json
{
  "status": "failed",
  "errorMessage": "Final distance constraint failed.",
  "officialResults": null,
  "constraints": []
}
```

## Implementation boundary

The dashboard does not fabricate propagation results. Until an external service implements this contract and GMAT can execute a Scenario Definition, the dashboard must continue to report `mock-validation-not-physical`.
