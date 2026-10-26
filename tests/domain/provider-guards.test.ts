import { describe, expect, it, vi } from "vitest";
import { boundedQlooFetch } from "../../scripts/qloo-fetch-guard.mjs";
import { cloudTaskPayload, taskDispatchConfiguration } from "../../src/server/dispatch";
import { parseOfficialInsightsOutput } from "../../src/server/qloo";

describe("provider and dispatch boundaries", () => {
  it("makes at most one fetch and forbids redirects, hydration, wrong origins and mutation methods", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("[]"));
    const bounded = boundedQlooFetch(fetcher, "https://hackathon.api.qloo.com");
    for (const url of ["https://unrelated.example/v2/insights", "https://hackathon.api.qloo.com/entities", "https://hackathon.api.qloo.com/search"]) await expect(bounded(url)).rejects.toThrow("boundary");
    await expect(bounded("https://hackathon.api.qloo.com/v2/insights", { method: "POST" })).rejects.toThrow("boundary");
    await bounded("https://hackathon.api.qloo.com/v2/insights");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    await expect(bounded("https://hackathon.api.qloo.com/v2/insights")).rejects.toThrow("budget exhausted");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("normalizes the official low-level array without retaining metadata, artwork or raw provider prose", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const result = parseOfficialInsightsOutput(JSON.stringify([{ entity_id: id, type: "urn:entity", subtype: "urn:entity:book", query: { affinity: .3 }, properties: { description: "Provider prose must not leak through normalization." } }]), { options: [id], option_type: "book", signals: [id] });
    expect(result).toMatchObject({ operation: "rank", results: [{ affinity: .3, subtype: "urn:entity:book" }] });
    expect(JSON.stringify(result)).not.toContain("Provider prose");
    expect(() => parseOfficialInsightsOutput('{"error":"private"}', { options: [id], option_type: "book", signals: [id] })).toThrow();
  });
  it("creates idempotent authenticated Cloud Tasks without putting secrets in the task body", () => {
    expect(taskDispatchConfiguration({})).toBeNull();
    expect(() => taskDispatchConfiguration({ RELAY_WORKER_URL: "http://untrusted.example" })).toThrow();
    const config = taskDispatchConfiguration({ GOOGLE_CLOUD_PROJECT: "relay-example", RELAY_WORKER_URL: "https://relay-worker-example.run.app", RELAY_TASKS_INVOKER_SERVICE_ACCOUNT: "invoker@relay-example.iam.gserviceaccount.com" })!;
    const a = cloudTaskPayload(config, "00000000-0000-4000-8000-000000000001");
    expect(cloudTaskPayload(config, "00000000-0000-4000-8000-000000000001")).toEqual(a);
    expect(a.task.httpRequest.oidcToken.audience).toBe("https://relay-worker-example.run.app");
    expect(JSON.parse(Buffer.from(a.task.httpRequest.body, "base64").toString())).toEqual({ jobId: "00000000-0000-4000-8000-000000000001" });
  });
});
