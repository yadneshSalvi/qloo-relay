import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { CatalogCandidate, CatalogSearch } from "../domain/catalog-search";
import { assertDomain, DomainError } from "../domain/errors";
import type { Category, Work } from "../domain/types";
import { getPool, withTransaction } from "./db";
import { resolveSessionAccess } from "./service";
import { loadWorkspace } from "./workspace";
import { requireQlooConfiguration } from "./qloo";
import { parseCatalogSearchResponse, runOfficialCatalogSearch, type CatalogTransport } from "./catalog-qloo";
import { configuredLimit } from "./provider-budget";

export const catalogCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("search"), query: z.string().trim().min(2).max(160), category: z.enum(["book", "record", "game"]) }),
  z.strictObject({ type: z.literal("confirm"), searchId: z.uuid(), entityId: z.uuid().transform(value => value.toLowerCase()), use: z.enum(["reference", "inventory"]), recordTitle: z.string().trim().min(1).max(160).optional() }),
]);
type SearchCommand = Extract<z.infer<typeof catalogCommandSchema>, { type: "search" }>;
type ConfirmCommand = Extract<z.infer<typeof catalogCommandSchema>, { type: "confirm" }>;
interface SearchRow {
  id: string; session_id: string; member_id: string; request_key: string; command_hash: string;
  query: string; category: Category; status: CatalogSearch["status"]; candidates: CatalogCandidate[];
  error_code: string | null; error_message: string | null; cache: CatalogSearch["cache"];
  lease_token: string | null; lease_until: Date | null; attempts: number; created_at: Date; expires_at: Date;
}
export type ClaimedCatalogSearch = SearchRow & { lease_token: string };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const serialize = (row: SearchRow): CatalogSearch => {
  const expired = ["queued", "running"].includes(row.status) && row.expires_at <= new Date();
  return { id: row.id, query: row.query, category: row.category, status: expired ? "failed" : row.status, candidates: row.status === "succeeded" ? row.candidates : [], createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(), errorCode: expired ? "SEARCH_EXPIRED" : row.error_code, errorMessage: expired ? "This search expired. Start another explicit search to continue." : row.error_message, cache: row.cache };
};

export async function getCatalogSearch(token: string, searchId?: string): Promise<CatalogSearch | null> {
  return withTransaction(async client => {
    const actor = await resolveSessionAccess(client, token);
    const row = (await client.query<SearchRow>("SELECT * FROM relay.catalog_searches WHERE session_id=$1 AND member_id=$2 AND ($3::uuid IS NULL OR id=$3) ORDER BY created_at DESC LIMIT 1", [actor.id, actor.memberId, searchId ?? null])).rows[0];
    if (searchId) assertDomain(row, "SEARCH_NOT_FOUND", "That catalog search belongs to another participant or has ended.", 404);
    return row ? serialize(row) : null;
  });
}

export async function enqueueCatalogSearch(token: string, command: SearchCommand, requestKey: string): Promise<CatalogSearch> {
  if (process.env.RELAY_LIVE_DISCOVERY_ENABLED !== "true") requireQlooConfiguration();
  return withTransaction(async client => {
    const actor = await resolveSessionAccess(client, token);
    assertDomain(actor.role === "member", "MEMBER_REQUIRED", "Join as a participant to select favorites or offer copies.", 403);
    const expired = await client.query<{ id: string }>("UPDATE relay.catalog_searches SET status='failed',error_code='SEARCH_EXPIRED',error_message='This search expired. Start another explicit search to continue.',lease_token=NULL,lease_until=NULL WHERE session_id=$1 AND member_id=$2 AND status IN ('queued','running') AND expires_at<=now() RETURNING id", [actor.id, actor.memberId]);
    if (expired.rows.length) await client.query("UPDATE relay.provider_calls SET state='uncertain',finished_at=now() WHERE catalog_search_id=ANY($1::uuid[]) AND state='started'", [expired.rows.map(row => row.id)]);
    const commandHash = hash(command);
    const replay = (await client.query<SearchRow>("SELECT * FROM relay.catalog_searches WHERE session_id=$1 AND member_id=$2 AND request_key=$3", [actor.id, actor.memberId, requestKey])).rows[0];
    if (replay) { assertDomain(replay.command_hash === commandHash, "IDEMPOTENCY_CONFLICT", "This request key was already used for a different catalog search."); return serialize(replay); }
    const active = (await client.query<SearchRow>("SELECT * FROM relay.catalog_searches WHERE session_id=$1 AND member_id=$2 AND status IN ('queued','running')", [actor.id, actor.memberId])).rows[0];
    if (active) { assertDomain(active.query === command.query && active.category === command.category, "SEARCH_IN_PROGRESS", "Your previous catalog search is still running. Wait for its result before starting another."); return serialize(active); }
    const recent = (await client.query<{ count: string }>("SELECT count(*) FROM relay.catalog_searches WHERE session_id=$1 AND member_id=$2 AND created_at>now()-interval '1 minute'", [actor.id, actor.memberId])).rows[0];
    assertDomain(Number(recent.count) < 3, "SEARCH_RATE_LIMIT", "Wait a minute before searching again. Search by a specific title or artist to use fewer requests.", 429);
    const row = (await client.query<SearchRow>("INSERT INTO relay.catalog_searches(id,session_id,member_id,request_key,command_hash,query,category,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'queued',now()+interval '30 minutes') RETURNING *", [randomUUID(), actor.id, actor.memberId, requestKey, commandHash, command.query, command.category])).rows[0];
    return serialize(row);
  });
}

export async function confirmCatalogCandidate(token: string, command: ConfirmCommand, requestKey: string) {
  return withTransaction(async client => {
    const actor = await resolveSessionAccess(client, token);
    assertDomain(actor.role === "member", "MEMBER_REQUIRED", "Only a participant can confirm a cultural identity.", 403);
    const commandHash = hash(command);
    const replay = (await client.query<{ work_id: string; command_hash: string }>("SELECT work_id,command_hash FROM relay.catalog_selections WHERE session_id=$1 AND member_id=$2 AND request_key=$3", [actor.id, actor.memberId, requestKey])).rows[0];
    if (replay) {
      assertDomain(replay.command_hash === commandHash, "IDEMPOTENCY_CONFLICT", "This request key belongs to a different identity choice.");
      return { workspace: await loadWorkspace(client, actor.id, actor.memberId), workId: replay.work_id, notice: "Identity already confirmed. Saving favorites or listing a copy remains your next explicit action." };
    }
    const search = (await client.query<SearchRow>("SELECT * FROM relay.catalog_searches WHERE id=$1 AND session_id=$2 AND member_id=$3 FOR UPDATE", [command.searchId, actor.id, actor.memberId])).rows[0];
    assertDomain(search && search.status === "succeeded" && search.expires_at > new Date(), "SEARCH_NOT_READY", "This catalog result is unavailable or expired. Run an explicit search again before selecting an identity.", 422);
    const candidate = search.candidates.find(entry => entry.entityId === command.entityId);
    assertDomain(candidate, "IDENTITY_NOT_IN_RESULTS", "Choose an identity returned by this participant’s catalog search. Unrequested IDs cannot be confirmed.", 422);
    assertDomain(!(search.category === "record" && command.use === "inventory") || !!command.recordTitle, "RECORD_TITLE_REQUIRED", "Qloo verifies the artist. Enter the actual record title before adding that record to your shelf.", 422);
    const referenceOnly = search.category === "record" && command.use === "reference";
    const title = search.category === "record" && command.use === "inventory" ? command.recordTitle! : candidate.name;
    const existing = (await client.query<{ id: string }>("SELECT c.id FROM relay.catalog_works c JOIN relay.catalog_mappings m ON m.work_id=c.id WHERE m.entity_id=$1 AND c.data->>'title'=$2 AND COALESCE(c.data->>'referenceOnly','false')=$5 AND (c.session_id IS NULL OR (c.session_id=$3 AND (c.visibility='shared' OR c.created_by_member_id=$4))) LIMIT 1", [candidate.entityId, title, actor.id, actor.memberId, String(referenceOnly)])).rows[0];
    const workId = existing?.id ?? `work-${randomUUID()}`;
    if (!existing) {
      const palette = search.category === "book" ? { background: "#e8dfcd", foreground: "#24352c", accent: "#b53d36" } : search.category === "game" ? { background: "#9d332b", foreground: "#fff2d4", accent: "#d9ee86" } : { background: "#173b50", foreground: "#eee8d9", accent: "#e9ae56" };
      const work: Work = { id: workId, title, author: search.category === "record" ? candidate.name : candidate.disambiguation || "Confirmed catalog identity", subtitle: search.category === "record" ? "Artist-level cultural identity" : candidate.disambiguation, category: search.category, year: candidate.year ?? 0, tags: [], description: referenceOnly ? `A favorite artist: ${candidate.name}. This cultural reference is not a physical album. Confirm a record title separately before listing a copy.` : search.category === "record" ? `Cultural identity is verified at artist level: ${candidate.name}. The record title is participant supplied; edition and condition belong to each physical copy.` : "You selected this cultural identity from Qloo’s catalog. Each physical copy has its own edition, condition, ownership attestation and handoff inspection.", colors: palette, mappingStatus: "verified", qlooEntityId: candidate.entityId, dataOrigin: "live-qloo", ...(referenceOnly ? { referenceOnly: true } : {}) };
      await client.query("INSERT INTO relay.catalog_works(id,data,session_id,created_by_member_id,visibility) VALUES($1,$2,$3,$4,'private')", [workId, work, actor.id, actor.memberId]);
      await client.query("INSERT INTO relay.catalog_mappings(work_id,entity_id,entity_type,entity_name,query,verified_at,verification,source,evidence) VALUES($1,$2,$3,$4,$5,now(),'Participant explicitly selected this exact returned cultural identity. Physical details remain separate.','live-qloo',$6)", [workId, candidate.entityId, candidate.entityType, candidate.name, search.query, { searchId: search.id, confirmation: "participant-selection", use: command.use, cache: search.cache }]);
    }
    await client.query("INSERT INTO relay.catalog_selections(session_id,member_id,request_key,command_hash,search_id,work_id) VALUES($1,$2,$3,$4,$5,$6)", [actor.id, actor.memberId, requestKey, commandHash, search.id, workId]);
    await client.query("INSERT INTO relay.evidence(session_id,id,member_id,kind,source,title,summary,details) VALUES($1,$2,$3,'inventory','live-qloo','An explicitly confirmed cultural identity','The participant selected one exact result from a bounded Qloo search. This selection does not list a copy, save a preference, approve a trade or establish ownership.',$4)", [actor.id, randomUUID(), actor.memberId, { searchId: search.id, workId, entityId: candidate.entityId, entityType: candidate.entityType, use: command.use, artistLevel: search.category === "record" }]);
    return { workspace: await loadWorkspace(client, actor.id, actor.memberId), workId, notice: "Identity confirmed. Review and save your favorites or physical copy details to continue." };
  });
}

export async function claimNextCatalogSearch(onlySearchId?: string): Promise<ClaimedCatalogSearch | null> {
  return withTransaction(async client => {
    const row = (await client.query<SearchRow>("SELECT * FROM relay.catalog_searches WHERE ($1::uuid IS NULL OR id=$1) AND (status='queued' OR (status='running' AND lease_until<now())) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1", [onlySearchId ?? null])).rows[0];
    if (!row) return null;
    if (row.attempts >= 2 || row.expires_at <= new Date()) {
      await client.query("UPDATE relay.catalog_searches SET status='failed',error_code='SEARCH_EXPIRED',error_message='This search expired or reached its recovery limit. Start another explicit search.',lease_token=NULL,lease_until=NULL WHERE id=$1", [row.id]);
      await client.query("UPDATE relay.provider_calls SET state='uncertain',finished_at=now() WHERE catalog_search_id=$1 AND state='started'", [row.id]);
      return null;
    }
    if (row.status === "running") await client.query("UPDATE relay.provider_calls SET state='uncertain',finished_at=now() WHERE catalog_search_id=$1 AND state='started'", [row.id]);
    return (await client.query<ClaimedCatalogSearch>("UPDATE relay.catalog_searches SET status='running',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '30 seconds' WHERE id=$1 RETURNING *", [row.id, randomUUID()])).rows[0];
  });
}

async function lockSearch(client: PoolClient, search: ClaimedCatalogSearch) {
  const row = (await client.query<SearchRow>("SELECT * FROM relay.catalog_searches WHERE id=$1 FOR UPDATE", [search.id])).rows[0];
  assertDomain(row?.status === "running" && row.lease_token === search.lease_token && row.lease_until && row.lease_until > new Date(), "SEARCH_LEASE_LOST", "This worker no longer owns the catalog search.");
  return row;
}

async function checkSearchActor(client: PoolClient, search: ClaimedCatalogSearch) {
  const session = (await client.query<{ expires_at: Date }>("SELECT expires_at FROM relay.sessions WHERE id=$1 FOR UPDATE", [search.session_id])).rows[0];
  assertDomain(session && session.expires_at > new Date(), "SESSION_EXPIRED", "This community expired before the catalog result arrived.", 401);
  await lockSearch(client, search);
  assertDomain((await client.query("SELECT 1 FROM relay.members WHERE session_id=$1 AND id=$2 AND active AND role='member'", [search.session_id, search.member_id])).rows.length, "MEMBERSHIP_INACTIVE", "This participant is no longer active. No catalog result was released.", 403);
}

async function reserveSearchCall(search: ClaimedCatalogSearch) {
  return withTransaction(async client => {
    await lockSearch(client, search);
    await client.query("SELECT pg_advisory_xact_lock(742319820)");
    const counts = (await client.query<{ global: string; session: string; search: string }>("SELECT count(*) FILTER(WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') global,count(*) FILTER(WHERE session_id=$1 AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') session,count(*) FILTER(WHERE catalog_search_id=$2) search FROM relay.provider_calls WHERE provider='qloo'", [search.session_id, search.id])).rows[0];
    assertDomain(Number(counts.global) < configuredLimit("RELAY_QLOO_DAILY_LIMIT", 12, 1000) && Number(counts.session) < configuredLimit("RELAY_QLOO_SESSION_DAILY_LIMIT", 6, 100) && Number(counts.search) < 1, "PROVIDER_BUDGET_EXHAUSTED", "Catalog search reached its configured Qloo request limit. A previously sent request remains counted even if its outcome is uncertain. Saved identities remain available.", 429);
    const id = randomUUID();
    await client.query("INSERT INTO relay.provider_calls(id,session_id,catalog_search_id,provider,operation,state) VALUES($1,$2,$3,'qloo',$4,'started')", [id, search.session_id, search.id, `catalog-search:${search.category}`]);
    return id;
  });
}

export async function processCatalogSearch(search: ClaimedCatalogSearch, transport: CatalogTransport = runOfficialCatalogSearch) {
  let callId: string | null = null;
  const injected = transport !== runOfficialCatalogSearch;
  const namespace = `${injected ? "injected-test:" : ""}community:${search.session_id}`;
  try {
    await withTransaction(client => checkSearchActor(client, search));
    const queryHash = hash({ version: "relay-catalog-v1", endpoint: injected ? "injected-test" : requireQlooConfiguration().baseUrl, query: search.query.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US"), category: search.category });
    const cached = (await getPool().query<{ candidates: CatalogCandidate[] }>("SELECT candidates FROM relay.catalog_query_cache WHERE namespace=$1 AND query_hash=$2 AND expires_at>now()", [namespace, queryHash])).rows[0];
    let candidates: CatalogCandidate[];
    if (cached) candidates = cached.candidates;
    else {
      callId = await reserveSearchCall(search);
      candidates = parseCatalogSearchResponse(await transport(search.query, search.category), search.category);
      await getPool().query("UPDATE relay.provider_calls SET state='succeeded',finished_at=now() WHERE id=$1 AND state='started'", [callId]);
    }
    await withTransaction(async client => {
      await checkSearchActor(client, search);
      if (!cached) await client.query("INSERT INTO relay.catalog_query_cache(namespace,query_hash,candidates,expires_at) VALUES($1,$2,$3,now()+interval '24 hours') ON CONFLICT(namespace,query_hash) DO UPDATE SET candidates=EXCLUDED.candidates,created_at=now(),expires_at=EXCLUDED.expires_at", [namespace, queryHash, JSON.stringify(candidates)]);
      await client.query("UPDATE relay.catalog_searches SET status='succeeded',candidates=$2,cache=$3,lease_token=NULL,lease_until=NULL WHERE id=$1", [search.id, JSON.stringify(candidates), cached ? "hit" : "miss"]);
    });
  } catch (error) {
    const code = error instanceof DomainError ? error.code : "CATALOG_UPSTREAM";
    const message = error instanceof DomainError ? error.message : "The catalog search could not finish. No identity was selected; start a new search to retry.";
    await withTransaction(async client => {
      const current = (await client.query<SearchRow>("SELECT * FROM relay.catalog_searches WHERE id=$1 FOR UPDATE", [search.id])).rows[0];
      if (current?.status !== "running" || current.lease_token !== search.lease_token || !current.lease_until || current.lease_until <= new Date()) return;
      await client.query("UPDATE relay.catalog_searches SET status='failed',error_code=$2,error_message=$3,lease_token=NULL,lease_until=NULL WHERE id=$1", [search.id, code, message]);
      if (callId) await client.query("UPDATE relay.provider_calls SET state='uncertain',finished_at=now() WHERE id=$1 AND state='started'", [callId]);
    });
  }
}
