const { validateSubmission } = require("./validationService.cjs");

const PROVIDER = "official-gmat-console";

function createValidationWorker({
  apiBaseUrl,
  workerToken,
  workerId,
  readConfig,
  pollIntervalMs = 2000,
}) {
  let stopped = false;
  let timer = null;

  async function request(path, options = {}) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Token": workerToken,
        ...options.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.detail ?? `Worker request failed (${response.status}).`);
    }
    return payload;
  }

  async function postResult(submissionId, result) {
    return request(`/internal/validation/${submissionId}/result`, {
      method: "POST",
      body: JSON.stringify({ ...result, workerId }),
    });
  }

  async function tick() {
    if (stopped) return;
    try {
      const config = readConfig();
      const gmatConfigured = Boolean(config.executablePath);
      await request("/internal/validation/heartbeat", {
        method: "POST",
        body: JSON.stringify({ workerId, provider: PROVIDER, gmatConfigured }),
      });
      if (gmatConfigured) {
        const { item } = await request("/internal/validation/next", {
          method: "POST",
          body: JSON.stringify({ workerId }),
        });
        if (item) await validateItem(item, config);
      }
    } catch (error) {
      console.error(`[validation-worker] ${error.message}`);
    } finally {
      if (!stopped) timer = setTimeout(tick, pollIntervalMs);
    }
  }

  async function validateItem(item, config) {
    try {
      const result = await validateSubmission({
        executablePath: config.executablePath,
        scenario: item.scenario,
        finalDecisionVariables: item.decisionVariables,
        timeoutMs: Number(config.timeoutMs ?? 120000),
        keepTemporaryFiles: Boolean(config.keepTemporaryFiles),
      });
      if (result.status !== "validated") {
        await postResult(item.submissionId, {
          claimToken: item.claimToken,
          status: "failed",
          provider: PROVIDER,
          errorMessage: "Official GMAT constraints did not pass.",
        });
        return;
      }
      await postResult(item.submissionId, {
        claimToken: item.claimToken,
        status: "passed",
        provider: PROVIDER,
        minimumDistanceKm: result.minimumDistance,
        missionTimeSec: result.totalTime,
        totalDeltaVKmPerSec: result.totalDeltaV,
        penaltyScore: 0,
      });
    } catch (error) {
      await postResult(item.submissionId, {
        claimToken: item.claimToken,
        status: "failed",
        provider: PROVIDER,
        errorMessage: error.message,
      });
    }
  }

  return {
    start() { if (!timer && !stopped) tick(); },
    stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; },
  };
}

module.exports = { createValidationWorker };
