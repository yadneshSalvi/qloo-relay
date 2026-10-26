import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as catalogGet, POST as catalogPost } from "../../src/app/api/catalog/route";
import { claimNextCatalogSearch, confirmCatalogCandidate, enqueueCatalogSearch, getCatalogSearch, processCatalogSearch } from "../../src/server/catalog-search";
import type { CatalogTransport } from "../../src/server/catalog-qloo";
import { closePool, getPool } from "../../src/server/db";
import { createSession, executeCommand, getWorkspace, SESSION_COOKIE } from "../../src/server/service";
import { ensureTestSchema } from "./db-fixture";

const sessions: string[] = [];
const candidateId = "00000000-0000-4000-8000-000000000011";
const raw = (category = "book") => [{ entity_id: candidateId.toUpperCase(), name: "An explicitly synthetic identity", types: [`urn:entity:${category}`], disambiguation: "Synthetic creator · integration fixture", properties: { publication_year: 2001 } }];
const searchCommand = { type: "search", query: "Synthetic unlisted book", category: "book" } as const;
const transport: CatalogTransport = async (_query, category) => raw(category === "record" ? "artist" : category === "game" ? "videogame" : "book");
async function fresh() { const session = await createSession("Catalog fixture"); sessions.push(session.workspace.session.id); return session; }
async function resolved(token: string, category: "book" | "record" | "game" = "book") {
  const search = await enqueueCatalogSearch(token, { ...searchCommand, category }, randomUUID());
  await processCatalogSearch((await claimNextCatalogSearch(search.id))!, transport);
  return (await getCatalogSearch(token, search.id))!;
}
function post(token: string, body: unknown, key = randomUUID()) {
  return new NextRequest("http://localhost:3101/api/catalog", { method: "POST", headers: { origin: "http://localhost:3101", "content-type": "application/json", "idempotency-key": key, cookie: `${SESSION_COOKIE}=${token}` }, body: JSON.stringify(body) });
}
beforeAll(async () => {
  await ensureTestSchema();
  process.env.RELAY_LIVE_DISCOVERY_ENABLED = "true";
  process.env.RELAY_QLOO_DAILY_LIMIT = "1000";
  process.env.RELAY_QLOO_SESSION_DAILY_LIMIT = "100";
  delete process.env.RELAY_WORKER_URL;
});
afterEach(async () => {
  if (sessions.length) await getPool().query("DELETE FROM relay.sessions WHERE id=ANY($1::uuid[])", [sessions.splice(0)]);
  await getPool().query("DELETE FROM relay.catalog_query_cache WHERE namespace LIKE 'injected-test:%'");
  process.env.RELAY_QLOO_SESSION_DAILY_LIMIT = "100";
});
afterAll(closePool);

describe("explicit catalog search on isolated actual PostgreSQL", () => {
  it("coalesces durable searches, claims one worker, and confirms only after a separate exact choice", async () => {
    const session = await fresh(); const key = randomUUID();
    const a = await enqueueCatalogSearch(session.token, searchCommand, key);
    const b = await enqueueCatalogSearch(session.token, searchCommand, randomUUID());
    expect(b.id).toBe(a.id);
    await expect(enqueueCatalogSearch(session.token, { ...searchCommand, query: "Different lookup" }, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const claims = await Promise.all([claimNextCatalogSearch(a.id), claimNextCatalogSearch(a.id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const calls = vi.fn(transport);
    await processCatalogSearch(claims.find(Boolean)!, calls);
    await closePool();
    const result = (await getCatalogSearch(session.token, a.id))!;
    expect(result).toMatchObject({ status: "succeeded", cache: "miss" });
    expect(result.candidates).toHaveLength(1);
    expect(calls).toHaveBeenCalledTimes(1);
    const untouched = await getWorkspace(session.token);
    expect(untouched.preferences).toEqual(session.workspace.preferences);
    expect(untouched.works.some(work => work.qlooEntityId === candidateId)).toBe(false);
    const confirmation = { type: "confirm", searchId: a.id, entityId: candidateId, use: "reference" } as const;
    const confirmKey = randomUUID();
    const accepted = await confirmCatalogCandidate(session.token, confirmation, confirmKey);
    expect(accepted.workspace.works.find(work => work.id === accepted.workId)).toMatchObject({ mappingStatus: "verified", qlooEntityId: candidateId, dataOrigin: "live-qloo" });
    expect(accepted.workspace.preferences).toEqual(session.workspace.preferences);
    expect(accepted.workspace.items).toHaveLength(16);
    expect(accepted.workspace.approvals.filter(approval => approval.memberId === "you")).toEqual([]);
    expect((await confirmCatalogCandidate(session.token, confirmation, confirmKey)).workId).toBe(accepted.workId);
  });

  it("reuses a normalized lookup only within its community and counts each actual request", async () => {
    const a = await fresh(); const b = await fresh(); const calls = vi.fn(transport);
    for (const [session, query] of [[a, "Synthetic book"], [a, "  SYNTHETIC   book  "], [b, "Synthetic book"]] as const) {
      const search = await enqueueCatalogSearch(session.token, { ...searchCommand, query }, randomUUID());
      await processCatalogSearch((await claimNextCatalogSearch(search.id))!, calls);
    }
    expect(calls).toHaveBeenCalledTimes(2);
    expect((await getCatalogSearch(a.token))?.cache).toBe("hit");
    const ledger = await getPool().query("SELECT 1 FROM relay.provider_calls WHERE session_id=ANY($1::uuid[]) AND provider='qloo'", [[a.workspace.session.id, b.workspace.session.id]]);
    expect(ledger.rowCount).toBe(2);
  });

  it("rejects a forged, foreign or expired result and requires a distinct record title", async () => {
    const a = await fresh(); const b = await fresh(); const search = await resolved(a.token, "record");
    const confirm = { type: "confirm", searchId: search.id, entityId: candidateId, use: "inventory" } as const;
    await expect(confirmCatalogCandidate(a.token, { ...confirm, entityId: randomUUID() }, randomUUID())).rejects.toMatchObject({ code: "IDENTITY_NOT_IN_RESULTS" });
    await expect(confirmCatalogCandidate(b.token, confirm, randomUUID())).rejects.toMatchObject({ code: "SEARCH_NOT_READY" });
    await expect(getCatalogSearch(b.token, search.id)).rejects.toMatchObject({ code: "SEARCH_NOT_FOUND" });
    await expect(confirmCatalogCandidate(a.token, confirm, randomUUID())).rejects.toMatchObject({ code: "RECORD_TITLE_REQUIRED" });
    const artist = await confirmCatalogCandidate(a.token, { ...confirm, use: "reference" }, randomUUID());
    expect(artist.workspace.works.find(work => work.id === artist.workId)?.referenceOnly).toBe(true);
    await expect(executeCommand(a.token, { type: "addItem", workId: artist.workId, edition: "Vinyl", condition: "good", notes: "Artist alone is not an album", attested: true }, randomUUID())).rejects.toMatchObject({ code: "RECORD_TITLE_REQUIRED" });
    const selfTitled = await confirmCatalogCandidate(a.token, { ...confirm, recordTitle: "An explicitly synthetic identity" }, randomUUID());
    expect(selfTitled.workId).not.toBe(artist.workId);
    expect(selfTitled.workspace.works.find(work => work.id === selfTitled.workId)?.referenceOnly).not.toBe(true);
    const accepted = await confirmCatalogCandidate(a.token, { ...confirm, recordTitle: "Participant supplied album" }, randomUUID());
    expect(accepted.workspace.works.find(work => work.id === accepted.workId)).toMatchObject({ title: "Participant supplied album", author: "An explicitly synthetic identity", category: "record", year: 0 });
    await getPool().query("UPDATE relay.catalog_searches SET expires_at=now()-interval '1 second' WHERE id=$1", [search.id]);
    await expect(confirmCatalogCandidate(a.token, confirm, randomUUID())).rejects.toMatchObject({ code: "SEARCH_NOT_READY" });
  });

  it("fences an expired worker and never repeats a paid search whose outcome became uncertain", async () => {
    const session = await fresh(); const search = await enqueueCatalogSearch(session.token, searchCommand, randomUUID());
    let start!: () => void; let finish!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    const release = new Promise<void>(resolve => { finish = resolve; });
    const pending = processCatalogSearch((await claimNextCatalogSearch(search.id))!, async () => { start(); await release; return raw(); });
    await started;
    await getPool().query("UPDATE relay.catalog_searches SET lease_until=now()-interval '1 second' WHERE id=$1", [search.id]);
    finish(); await pending;
    expect((await getCatalogSearch(session.token, search.id))?.status).toBe("running");
    const retry = (await claimNextCatalogSearch(search.id))!; const calls = vi.fn(transport);
    expect(retry.attempts).toBe(2);
    await processCatalogSearch(retry, calls);
    expect(calls).not.toHaveBeenCalled();
    expect(await getCatalogSearch(session.token, search.id)).toMatchObject({ status: "failed", errorCode: "PROVIDER_BUDGET_EXHAUSTED" });
  });

  it("shares the discovery Qloo budget and returns safe actor-scoped HTTP errors", async () => {
    const session = await fresh();
    process.env.RELAY_QLOO_SESSION_DAILY_LIMIT = "1";
    await getPool().query("INSERT INTO relay.provider_calls(id,session_id,provider,operation,state) VALUES($1,$2,'qloo','rank:book','succeeded')", [randomUUID(), session.workspace.session.id]);
    const response = await catalogPost(post(session.token, searchCommand));
    expect(response.status).toBe(200);
    const search = (await response.json()).search;
    const calls = vi.fn(transport);
    await processCatalogSearch((await claimNextCatalogSearch(search.id))!, calls);
    expect(calls).not.toHaveBeenCalled();
    expect(await getCatalogSearch(session.token, search.id)).toMatchObject({ status: "failed", errorCode: "PROVIDER_BUDGET_EXHAUSTED" });
    const crossSite = post(session.token, searchCommand); crossSite.headers.set("origin", "https://invalid.example");
    expect((await catalogPost(crossSite)).status).toBe(403);
    expect((await catalogPost(post(session.token, { ...searchCommand, memberId: "not-you" }))).status).toBe(400);
    expect((await catalogGet(new NextRequest("http://localhost:3101/api/catalog"))).status).toBe(401);
    const missing = new NextRequest(`http://localhost:3101/api/catalog?searchId=${randomUUID()}`, { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
    expect((await catalogGet(missing)).status).toBe(404);
  });
});
