import { describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { boundedQlooFetch } from "../../scripts/qloo-fetch-guard.mjs";
import { officialCatalogArguments, parseCatalogSearchResponse } from "../../src/server/catalog-qloo";
import { cloudTaskPayload, taskDispatchConfiguration } from "../../src/server/dispatch";

// Synthetic rows matching the installed low-level CLI response contract. No Qloo data.
const id = "00000000-0000-4000-8000-00000000000a";
const book = { entity_id: id.toUpperCase(), name: "Synthetic library book", types: ["urn:entity:book"], disambiguation: "A clearly fictional fixture", properties: { publication_year: 2001, description: "Raw prose must be discarded", image: { url: "https://invalid.example/fixture" } } };

describe("bounded catalog identity normalization", () => {
  it("runs the installed official CLI with its required query flag and the production one-fetch guard", async () => {
    const privateHome = await mkdtemp(join(tmpdir(), "relay-qloo-contract-"));
    try {
      const bin = fileURLToPath(new URL("./bin.js", import.meta.resolve("@qloo/qloo-harness")));
      for (const [category, entityType] of [["book", "book"], ["game", "videogame"], ["record", "artist"]] as const) {
        const { stdout, stderr } = await promisify(execFile)(process.execPath, ["--import", resolve("tests/fixtures/qloo-search-fetch.mjs"), "--import", resolve("scripts/qloo-fetch-guard.mjs"), bin, ...officialCatalogArguments("Synthetic test query", category)], { timeout: 5000, maxBuffer: 100000, env: { PATH: process.env.PATH, NODE_ENV: "test", QLOO_HOME: privateHome, QLOO_API_KEY: "synthetic-no-provider-access", QLOO_BASE_URL: "https://hackathon.api.qloo.com", QLOO_TRUSTED_BASE_URL: "https://hackathon.api.qloo.com", RELAY_QLOO_FETCH_GUARD: "1", RELAY_QLOO_OPERATION: "search" } });
        const observed = stderr.split("\n").filter(line => line.startsWith("RELAY_TEST_FETCH ")).map(line => JSON.parse(line.slice("RELAY_TEST_FETCH ".length)));
        expect(observed).toEqual([{ path: "/search", query: "Synthetic test query", types: `urn:entity:${entityType}`, take: "5", redirects: "error" }]);
        expect(parseCatalogSearchResponse(JSON.parse(stdout), category)).toHaveLength(1);
      }
    } finally { await rm(privateHome, { recursive: true, force: true }); }
  });
  it("normalizes the search types array and retains only identifying details", () => {
    const parsed = parseCatalogSearchResponse([book], "book");
    expect(parsed).toEqual([{ entityId: id, name: book.name, entityType: "urn:entity:book", disambiguation: book.disambiguation, year: 2001 }]);
    expect(JSON.stringify(parsed)).not.toContain("Raw prose");
    expect(JSON.stringify(parsed)).not.toContain("invalid.example");
    expect(parseCatalogSearchResponse([], "game")).toEqual([]);
  });
  it("rejects wrong, missing, ambiguous and duplicate identities instead of substituting them", () => {
    for (const rows of [[book, { ...book, entity_id: id }], [{ ...book, types: ["urn:entity:artist"] }], [{ ...book, types: ["urn:entity:book", "urn:entity:movie"] }], [{ ...book, types: ["urn:entity"] }], [{ ...book, types: undefined }], Array.from({ length: 6 }, () => book)]) expect(() => parseCatalogSearchResponse(rows, "book")).toThrow();
  });
  it("keeps artist identity distinct from a record title and does not fabricate a release year", () => {
    const parsed = parseCatalogSearchResponse([{ ...book, types: ["urn:entity:artist"], name: "Synthetic band" }], "record");
    expect(parsed[0]).toMatchObject({ entityType: "urn:entity:artist", name: "Synthetic band", year: null });
  });
  it("preserves bounded catalog ISBN identifiers while discarding descriptive provider prose", () => {
    const parsed = parseCatalogSearchResponse([{ ...book, properties: { isbn13: "000-0000000000", isbn10: "000000000X", description: "Unneeded provider prose" } }], "book");
    expect(parsed[0]).toMatchObject({ isbn13: "0000000000000", isbn10: "000000000X" });
    expect(JSON.stringify(parsed)).not.toContain("Unneeded provider prose");
    expect(parseCatalogSearchResponse([{ ...book, properties: { isbn13: "not-an-isbn" } }], "book")[0]).not.toHaveProperty("isbn13");
  });
  it("allows one search fetch only, with no insights, redirects or retries", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("[]"));
    const bounded = boundedQlooFetch(fetcher, "https://hackathon.api.qloo.com", "search");
    await expect(bounded("https://hackathon.api.qloo.com/v2/insights")).rejects.toThrow("boundary");
    await bounded("https://hackathon.api.qloo.com/search?query=synthetic");
    await expect(bounded("https://hackathon.api.qloo.com/search?query=synthetic")).rejects.toThrow("budget exhausted");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("error");
  });
  it("dispatches only the catalog identifier to the authenticated private worker", () => {
    const config = taskDispatchConfiguration({ GOOGLE_CLOUD_PROJECT: "relay-example", RELAY_WORKER_URL: "https://relay-worker-example.run.app", RELAY_TASKS_INVOKER_SERVICE_ACCOUNT: "invoker@relay-example.iam.gserviceaccount.com" })!;
    const task = cloudTaskPayload(config, { catalogSearchId: id });
    expect(JSON.parse(Buffer.from(task.task.httpRequest.body, "base64").toString())).toEqual({ catalogSearchId: id });
    expect(task.task.name).not.toEqual(cloudTaskPayload(config, id).task.name);
  });
});
