/** Loaded only in the Qloo child process. A workflow budget is an HTTP budget. */
export function boundedQlooFetch(fetchImpl, origin, operation = "insights") {
  if (!["https://api.qloo.com", "https://hackathon.api.qloo.com"].includes(origin)) throw new Error("Qloo origin is not approved.");
  let requests = 0;
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const path = operation === "search" ? "/search" : "/v2/insights";
    if (!["insights", "search"].includes(operation) || url.origin !== origin || url.pathname !== path || method.toUpperCase() !== "GET" || url.username || url.password) throw new Error("Qloo request is outside the verified API boundary.");
    if (++requests > 1) throw new Error("Qloo HTTP request budget exhausted; automatic retries are disabled.");
    const originalSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return fetchImpl(input, { ...init, redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(12_000), ...(originalSignal ? [originalSignal] : [])]) });
  };
}

if (process.env.RELAY_QLOO_FETCH_GUARD === "1") {
  globalThis.fetch = boundedQlooFetch(globalThis.fetch, process.env.QLOO_BASE_URL, process.env.RELAY_QLOO_OPERATION ?? "insights");
}
