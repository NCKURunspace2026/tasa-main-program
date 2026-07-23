const API_BASE_STORAGE_KEY = "mission-dashboard-api-base-url";
const runtimeApiBaseUrl = new URLSearchParams(window.location.search).get("apiBaseUrl");
const DEFAULT_API_BASE_URL = runtimeApiBaseUrl
  ?? import.meta.env.VITE_API_BASE_URL
  ?? "http://127.0.0.1:8000/api";
const DEFAULT_RELAY_ADDRESS = "https://missiondashboard.fastapicloud.dev";

function getStoredApiBaseUrl() {
  if (typeof window === "undefined") return DEFAULT_API_BASE_URL;
  if (runtimeApiBaseUrl) return runtimeApiBaseUrl;
  const storedApiBaseUrl = window.localStorage.getItem(API_BASE_STORAGE_KEY);
  if (!storedApiBaseUrl) {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, DEFAULT_API_BASE_URL);
    return DEFAULT_API_BASE_URL;
  }
  return storedApiBaseUrl;
}

function normalizeCloudAddress(cloudAddress) {
  const parsed = new URL(cloudAddress.trim());
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Cloud address must use HTTP or HTTPS.");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = pathname.endsWith("/api") ? pathname : `${pathname}/api`;
  return parsed.toString().replace(/\/$/, "");
}

export function getCloudAddress() {
  return DEFAULT_RELAY_ADDRESS;
}

export async function testCloudConnection(cloudAddress) {
  const apiBaseUrl = normalizeCloudAddress(cloudAddress);
  const healthUrl = apiBaseUrl.replace(/\/api$/, "/health");
  const startedAt = performance.now();
  const response = await fetch(healthUrl);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.status !== "ok" || payload?.nodeRole !== "relay") {
    throw new Error("Relay health check failed.");
  }
  return {
    latencyMs: Math.round(performance.now() - startedAt),
    nodeRole: payload.nodeRole,
  };
}

export function getSyncSettings() {
  return request("/sync/settings");
}

export function updateSyncSettings(settings) {
  return request("/sync/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export function runDataSync() {
  return request("/sync/run", { method: "POST" });
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

export function revalidateSolution(solutionId, payload) {
  return request(`/solutions/${solutionId}/revalidate`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getScenarios() {
  return request("/scenarios");
}

export function createScenario(scenario) {
  return adminRequest("/scenarios", {
    method: "POST",
    body: JSON.stringify(scenario),
  });
}

export function updateScenario(scenarioId, scenario) {
  return adminRequest(`/scenarios/${scenarioId}`, {
    method: "PUT",
    body: JSON.stringify(scenario),
  });
}

export function deleteScenario(scenarioId, adminPassword) {
  return adminRequest(`/scenarios/${scenarioId}`, { method: "DELETE", adminPassword });
}

export function deleteSolution(solutionId, adminPassword) {
  return adminRequest(`/solutions/${solutionId}`, { method: "DELETE", adminPassword });
}

export async function downloadDataExport(format, includeArchived = false) {
  const parameters = new URLSearchParams({
    format,
    includeArchived: String(includeArchived),
  });
  const response = await fetch(`${getStoredApiBaseUrl()}/data/export?${parameters.toString()}`);
  if (!response.ok) throw new Error(`Data export failed (${response.status}).`);
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="?([^";]+)"?/)?.[1]
    ?? `mission-dashboard-dataset.${format}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return filename;
}

function adminRequest(path, options) {
  if (!window.missionDashboardDesktop?.localAdminRequest) {
    throw new Error("Scenario administration requires the Electron app.");
  }
  return window.missionDashboardDesktop.localAdminRequest(path, options);
}
