import { describe, expect, it, vi } from "vitest";
import { CATALOG, SEED_ITEMS } from "../../src/domain/catalog";
import type { Item, Work } from "../../src/domain/types";
import { parseOfficialExecOutput, prepareRank, rankVerifiedInventory, requireQlooConfiguration } from "../../src/server/qloo";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const work = (n: number): Work => ({ ...CATALOG[0], id: `work-${n}`, mappingStatus: "verified", qlooEntityId: id(n) });
const item = (n: number, workId = `work-${n}`): Item => ({ ...SEED_ITEMS[0], id: `copy-${n}`, workId, ownerId: `member-${n}`, attested: true, state: "available", version: 1, heldByProposalId: null, createdAt: "2026-01-01T00:00:00Z", dataOrigin: "authored-sample" });
const scope = () => ({ scopeId: "community-a", memberId: "you", category: "book" as const, preferenceVersion: 1, seedWorkIds: ["work-1"], works: Array.from({ length: 12 }, (_, n) => work(n + 1)), items: Array.from({ length: 12 }, (_, n) => item(n + 1)) });
const env = { QLOO_API_KEY: "unit-test-not-a-real-key" };
const result = (ids: string[]) => ({ schema_version: "1.0-preview.1", operation: "rank", status: "ok", results: ids.map(entity_id => ({ entity_id, type: "urn:entity:book", affinity: .7 })) });

describe("official Qloo integration boundary", () => {
  it("rejects authored IDs, missing keys and untrusted endpoint configuration before transport", async () => {
    const source = scope(); source.works[0].mappingStatus = "authored";
    expect(() => prepareRank(source)).toThrow(expect.objectContaining({ code: "VERIFIED_MAPPING_REQUIRED" }));
    const transport = vi.fn();
    await expect(rankVerifiedInventory(prepareRank(scope()), scope(), { env: {}, transport })).rejects.toMatchObject({ code: "MISSING_QLOO_KEY" });
    expect(transport).not.toHaveBeenCalled();
    expect(() => requireQlooConfiguration({ ...env, QLOO_BASE_URL: "https://untrusted.example" })).toThrow();
    expect(() => requireQlooConfiguration({ ...env, QLOO_BASE_URL: "https://hackathon.api.qloo.com" })).toThrow();
  });
  it("deduplicates entities, caps ten candidates, records shortlist coverage and excludes unavailable copies", () => {
    const source = scope(); source.items.push(item(13, "work-1")); source.items.push({ ...item(14, "work-2"), state: "reserved" });
    const prepared = prepareRank(source);
    expect(prepared.request.options).toHaveLength(10);
    expect(prepared.shortlist).toEqual({ eligibleEntities: 12, selectedEntities: 10, policy: "entity-id-order" });
    expect(prepared.copies.filter(copy => copy.entityId === id(1))).toHaveLength(2);
    expect(prepared.copies.some(copy => copy.itemId === "copy-14")).toBe(false);
  });
  it("binds evidence to scope, preference version and every eligible copy version", async () => {
    const before = scope(); const prepared = prepareRank(before); const transport = vi.fn();
    for (const changed of [{ ...before, scopeId: "other" }, { ...before, preferenceVersion: 2 }, { ...before, items: before.items.map((copy, index) => index === 11 ? { ...copy, version: 2 } : copy) }]) {
      await expect(rankVerifiedInventory(prepared, changed, { env, transport })).rejects.toMatchObject({ code: "STALE_CANDIDATES" });
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it("fans one entity result back to the exact eligible copies, preserving within-request order", async () => {
    const source = scope(); source.items.push(item(13, "work-1"));
    const ranked = await rankVerifiedInventory(prepareRank(source), source, { env, transport: async () => result([id(2), id(1)]) });
    expect(ranked.rankings.map(row => row.entityId)).toEqual([id(2), id(1)]);
    expect(ranked.rankings[1].itemIds).toEqual(["copy-1", "copy-13"]);
    expect(ranked.source).toBe("live-qloo"); // Injected transport exercises parsing, never a live test claim.
  });
  it("rejects unsolicited, duplicate, wrong-category and oversized responses", async () => {
    const source = scope();
    const wrong = result([id(1)]); wrong.results[0].type = "urn:entity:artist";
    for (const response of [result([id(99)]), result([id(1), id(1)]), wrong, result(Array.from({ length: 11 }, (_, n) => id(n + 1)))]) {
      await expect(rankVerifiedInventory(prepareRank(source), source, { env, transport: async () => response })).rejects.toMatchObject({ code: "QLOO_RESPONSE_INVALID" });
    }
  });
  it("returns an honest empty result and propagates upstream failure without sample fallback", async () => {
    const source = scope();
    const empty = await rankVerifiedInventory(prepareRank(source), source, { env, transport: async () => result([]) });
    expect(empty.rankings).toEqual([]);
    await expect(rankVerifiedInventory(prepareRank(source), source, { env, transport: async () => { throw new Error("upstream offline"); } })).rejects.toThrow("upstream offline");
  });
  it("preserves all six workflow statuses and suppresses private failure prose", async () => {
    const source = scope();
    for (const status of ["ok", "empty", "needs_input", "partial", "degraded", "error"]) {
      const response = { ...result(["ok", "partial", "degraded"].includes(status) ? [id(1)] : []), status, error: { code: "QLOO_RATE_LIMIT", layer: "qloo", retryable: true, recovery: "PRIVATE_SEED_CONTEXT" } };
      const ranked = await rankVerifiedInventory(prepareRank(source), source, { env, transport: async () => response });
      expect(ranked.status).toBe(status);
      expect(JSON.stringify(ranked)).not.toContain("PRIVATE_SEED_CONTEXT");
      expect(ranked.rankings.length).toBe(["ok", "partial", "degraded"].includes(status) ? 1 : 0);
    }
  });
  it("normalizes the CLI structured failure shape and rejects inconsistent state", async () => {
    const source = scope();
    const raw = parseOfficialExecOutput(JSON.stringify({ operation: "rank", error: { code: "QLOO_AUTH", layer: "qloo", retryable: false, recovery: "Configure the event key" } }));
    const ranked = await rankVerifiedInventory(prepareRank(source), source, { env, transport: async () => raw });
    expect(ranked.status).toBe("error");
    expect(ranked.error).toEqual({ code: "QLOO_AUTH", retryable: false });
    for (const response of [{ ...result([id(1)]), status: "empty" }, { ...result([]), status: "error" }, { ...result([id(1)]), result_count: 2 }]) {
      await expect(rankVerifiedInventory(prepareRank(source), source, { env, transport: async () => response })).rejects.toMatchObject({ code: "QLOO_RESPONSE_INVALID" });
    }
  });
});
