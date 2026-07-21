const API_BASE_STORAGE_KEY = "mission-dashboard-api-base-url";
const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000/api";

function getStoredApiBaseUrl() {
  if (typeof window === "undefined") return DEFAULT_API_BASE_URL;
  const runtimeParams = new URLSearchParams(window.location.search);
  const runtimeAddress = runtimeParams.get("serverAddress");
  if (runtimeParams.get("desktopRole") === "server" && runtimeAddress) {
    const runtimeApiBaseUrl = normalizeServerAddress(runtimeAddress);
    window.localStorage.setItem(API_BASE_STORAGE_KEY, runtimeApiBaseUrl);
    return runtimeApiBaseUrl;
  }
  return window.localStorage.getItem(API_BASE_STORAGE_KEY) ?? DEFAULT_API_BASE_URL;
}

function normalizeServerAddress(serverAddress) {
  const parsed = new URL(serverAddress.trim());
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Server address must use HTTP or HTTPS.");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = pathname.endsWith("/api") ? pathname : `${pathname}/api`;
  return parsed.toString().replace(/\/$/, "");
}

export function getServerAddress() {
  return getStoredApiBaseUrl().replace(/\/api$/, "");
}

export function setServerAddress(serverAddress) {
  const apiBaseUrl = normalizeServerAddress(serverAddress);
  window.localStorage.setItem(API_BASE_STORAGE_KEY, apiBaseUrl);
  return apiBaseUrl.replace(/\/api$/, "");
}

export async function testServerConnection(serverAddress) {
  const apiBaseUrl = normalizeServerAddress(serverAddress);
  const healthUrl = apiBaseUrl.replace(/\/api$/, "/health");
  const startedAt = performance.now();
  const response = await fetch(healthUrl);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.status !== "ok") {
    throw new Error("Server health check failed.");
  }
  return {
    latencyMs: Math.round(performance.now() - startedAt),
    validationProvider: payload.validationProvider,
    validationWorker: payload.validationWorker,
    physicalValidation: payload.physicalValidation,
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${getStoredApiBaseUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.detail?.message ??
      payload?.detail ??
      payload?.message ??
      `Request failed with status ${response.status}.`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }

  return payload;
}

export function createSubmission(submission) {
  return request("/submissions", {
    method: "POST",
    body: JSON.stringify(submission),
  });
}

export function getSubmission(submissionId) {
  return request(`/submissions/${submissionId}`);
}

export function getLeaderboard(scenarioId, parameters = {}) {
  const searchParams = new URLSearchParams(parameters);
  return request(
    `/scenarios/${scenarioId}/leaderboard?${searchParams.toString()}`,
  );
}

export function getSolutionDetail(solutionId) {
  return request(`/solutions/${solutionId}`);
}

export function getScenarios() {
  return request("/scenarios");
}

export function createScenario(scenario) {
  return request("/scenarios", {
    method: "POST",
    headers: { "X-Device-Role": "server" },
    body: JSON.stringify(scenario),
  });
}

export function updateScenario(scenarioId, scenario) {
  return request(`/scenarios/${scenarioId}`, {
    method: "PUT",
    headers: { "X-Device-Role": "server" },
    body: JSON.stringify(scenario),
  });
}
