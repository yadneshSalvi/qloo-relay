import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { assertDomain, DomainError } from "../domain/errors";
import { EMPTY_USAGE, RUN_LIMITS, type AgentReport, type AgentRun, type AgentRunStatus, type AgentTrace, type AgentUsage } from "../domain/runtime";
import type { Category, Command, DiscoveryRun, Workspace } from "../domain/types";
import { getPool, withTransaction } from "./db";
import { configuredLimit } from "./provider-budget";
import { prepareRank, rankVerifiedInventory, requireQlooConfiguration, type PreparedRank, type QlooTransport, type RankScope } from "./qloo";
import { loadWorkspace } from "./workspace";
import { buildGroundedReport, requireAgentConfiguration, runDiscoveryAgent, type AgentDependencies, type RankedCategory } from "./agent";

export interface DiscoveryInput {
  category: Category | "all";
  preferenceVersion: number;
  prepared: Partial<Record<Category, PreparedRank>>;
}
export interface DiscoveryCheckpoint {
  rankings?: Partial<Record<Category, RankedCategory>>;
  cacheHits?: number;
}
export interface JobRow {
  id: string; session_id: string; member_id: string; status: AgentRunStatus; stage: string;
  input: DiscoveryInput; checkpoint: DiscoveryCheckpoint; report: AgentReport | null;
  error_code: string | null; error_message: string | null; attempts: number;
  lease_token: string | null; lease_until: Date | null; cancel_requested: boolean;
  created_at: Date; started_at: Date | null; finished_at: Date | null;
}
export type ClaimedJob = JobRow & { lease_token: string };
export type QlooResult = Awaited<ReturnType<typeof rankVerifiedInventory>>;
const categories: Category[] = ["book", "record", "game"];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function scopeFor(workspace: Workspace, category: Category): RankScope {
  const dismissed = new Set(workspace.dismissals.map(entry => entry.itemId));
  return {
    scopeId: workspace.session.id, memberId: workspace.currentMemberId,
    preferenceVersion: workspace.preferences.version, seedWorkIds: workspace.preferences.seedWorkIds,
    works: workspace.works, items: workspace.items.filter(item => !dismissed.has(item.id)), category,
  };
}

async function appendTrace(client: PoolClient, jobId: string, stage: string, message: string) {
  // Every writer locks the job first. Sequence remains stable across reconnects and retries.
  await client.query("INSERT INTO relay.agent_events(job_id,sequence,stage,message) SELECT $1,COALESCE(MAX(sequence),0)+1,$2,$3 FROM relay.agent_events WHERE job_id=$1", [jobId, stage, message]);
}

export async function loadAgentRuns(client: PoolClient, sessionId: string, memberId: string): Promise<AgentRun[]> {
  const jobs = (await client.query<JobRow>("SELECT * FROM relay.agent_jobs WHERE session_id=$1 AND member_id=$2 ORDER BY created_at DESC,id DESC LIMIT 8", [sessionId, memberId])).rows;
  if (!jobs.length) return [];
  const traces = (await client.query<{ job_id: string; sequence: number; stage: string; message: string; created_at: Date }>("SELECT * FROM relay.agent_events WHERE job_id=ANY($1::uuid[]) ORDER BY job_id,sequence", [jobs.map(job => job.id)])).rows;
  const usage = (await client.query<{ job_id: string; qloo: string; model: string; unreported: string; input_tokens: string; output_tokens: string }>("SELECT job_id,count(*) FILTER(WHERE provider='qloo') qloo,count(*) FILTER(WHERE provider='openai') model,count(*) FILTER(WHERE provider='openai' AND input_tokens=0 AND output_tokens=0) unreported,coalesce(sum(input_tokens),0) input_tokens,coalesce(sum(output_tokens),0) output_tokens FROM relay.provider_calls WHERE job_id=ANY($1::uuid[]) GROUP BY job_id", [jobs.map(job => job.id)])).rows;
  return jobs.map(job => {
    const row = usage.find(entry => entry.job_id === job.id);
    return {
      id: job.id, memberId: job.member_id, status: job.status, stage: job.stage, category: job.input.category,
      createdAt: job.created_at.toISOString(), startedAt: job.started_at?.toISOString() ?? null, finishedAt: job.finished_at?.toISOString() ?? null,
      errorCode: job.error_code, errorMessage: job.error_message, report: job.report, attempt: job.attempts,
      canRetry: ["failed", "cancelled", "stale", "partial"].includes(job.status),
      trace: traces.filter(entry => entry.job_id === job.id).slice(-60).map((entry): AgentTrace => ({ sequence: entry.sequence, stage: entry.stage, message: entry.message, createdAt: entry.created_at.toISOString() })),
      usage: { qlooCalls: Number(row?.qloo ?? 0), modelCalls: Number(row?.model ?? 0), unreportedModelCalls: Number(row?.unreported ?? 0), inputTokens: Number(row?.input_tokens ?? 0), outputTokens: Number(row?.output_tokens ?? 0), cacheHits: job.checkpoint.cacheHits ?? 0 },
    };
  });
}

/** Called inside the same community/idempotency transaction as the user's command. */
export async function enqueueDiscovery(client: PoolClient, workspace: Workspace, command: Pick<Extract<Command, { type: "discover" }>, "category">): Promise<string> {
  if (process.env.RELAY_LIVE_DISCOVERY_ENABLED !== "true") {
    requireQlooConfiguration();
    requireAgentConfiguration();
  }
  assertDomain(workspace.access.role === "member", "MEMBER_REQUIRED", "Taste discovery belongs to a participant. Join with a member invitation to discover trades.", 403);
  const existing = (await client.query<{ id: string }>("SELECT id FROM relay.agent_jobs WHERE session_id=$1 AND member_id=$2 AND status IN ('queued','running')", [workspace.session.id, workspace.currentMemberId])).rows[0];
  if (existing) return "Your discovery is already in progress. Its saved progress continues if you leave this page.";
  const recent = (await client.query<{ count: string }>("SELECT count(*) FROM relay.agent_jobs WHERE session_id=$1 AND member_id=$2 AND created_at>now()-interval '1 hour'", [workspace.session.id, workspace.currentMemberId])).rows[0];
  assertDomain(Number(recent.count) < 8, "RUN_RATE_LIMIT", "This participant has reached the limit of eight discovery runs per hour. Saved results remain available.", 429);
  const prepared: DiscoveryInput["prepared"] = {};
  for (const category of command.category ? [command.category] : categories) {
    try { prepared[category] = prepareRank(scopeFor(workspace, category)); }
    catch (error) {
      if (!(error instanceof DomainError) || error.code !== "NO_ELIGIBLE_CANDIDATES") throw error;
    }
  }
  assertDomain(Object.keys(prepared).length > 0, "NO_ELIGIBLE_CANDIDATES", "No available copies have verified cultural identities in these categories. Offer a supported copy or explore a different category.", 422);
  const id = randomUUID();
  await client.query("INSERT INTO relay.agent_jobs(id,session_id,member_id,status,input) VALUES($1,$2,$3,'queued',$4)", [id, workspace.session.id, workspace.currentMemberId, { category: command.category ?? "all", preferenceVersion: workspace.preferences.version, prepared } satisfies DiscoveryInput]);
  await appendTrace(client, id, "queued", "Request saved. The worker will inspect available copies, consult Qloo, and ask only for decisions you can make.");
  return "Your live discovery is queued. You can leave and return; progress and results are saved.";
}

export async function controlRun(client: PoolClient, workspace: Workspace, command: Extract<Command, { type: "cancelRun" | "retryRun" }>): Promise<string> {
  const job = (await client.query<JobRow>("SELECT * FROM relay.agent_jobs WHERE id=$1 AND session_id=$2 AND member_id=$3 FOR UPDATE", [command.runId, workspace.session.id, workspace.currentMemberId])).rows[0];
  assertDomain(job, "RUN_NOT_FOUND", "That discovery does not belong to this participant.", 404);
  if (command.type === "retryRun") {
    assertDomain(["failed", "cancelled", "stale", "partial"].includes(job.status), "RUN_NOT_RETRYABLE", "This discovery is complete or still running. Start a new discovery when your tastes change.");
    return enqueueDiscovery(client, workspace, { category: job.input.category === "all" ? undefined : job.input.category });
  }
  if (!["queued", "running"].includes(job.status)) return "This discovery has already stopped. Existing results and exact trade approvals are preserved.";
  await client.query("UPDATE relay.agent_jobs SET status='cancelled',stage='cancelled',cancel_requested=true,lease_token=NULL,lease_until=NULL,finished_at=now(),updated_at=now() WHERE id=$1", [job.id]);
  await client.query("UPDATE relay.provider_calls SET state='uncertain',finished_at=now() WHERE job_id=$1 AND state='started'", [job.id]);
  await appendTrace(client, job.id, "cancelled", "You stopped this run. A request already sent to a provider may still count against its limit; no trade was approved.");
  return "Discovery stopped. Your shelf, saved results, and approvals are unchanged.";
}

export async function claimNextJob(onlyJobId?: string): Promise<ClaimedJob | null> {
  return withTransaction(async client => {
    const job = (await client.query<JobRow>("SELECT * FROM relay.agent_jobs WHERE ($1::uuid IS NULL OR id=$1) AND (status='queued' OR (status='running' AND lease_until<now())) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1", [onlyJobId ?? null])).rows[0];
    if (!job) return null;
    if (job.cancel_requested || job.attempts >= RUN_LIMITS.maxAttempts) {
      await client.query("UPDATE relay.agent_jobs SET status=$2,stage=$2,error_code=$3,error_message=$4,finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=$1", [job.id, job.cancel_requested ? "cancelled" : "failed", job.cancel_requested ? "RUN_CANCELLED" : "WORKER_RESTART_LIMIT", "The run stopped after its recovery limit. Review saved evidence before explicitly retrying."]);
      await client.query("UPDATE relay.provider_calls SET state='uncertain',finished_at=now() WHERE job_id=$1 AND state='started'", [job.id]);
      await appendTrace(client, job.id, "stopped", "Worker recovery reached its limit. No exchange action was taken.");
      return null;
    }
    if (job.status === "running") {
      await client.query("UPDATE relay.provider_calls SET state='uncertain',finished_at=now() WHERE job_id=$1 AND state='started'", [job.id]);
      await appendTrace(client, job.id, "recovered", "The previous worker lease ended. Resuming from saved category evidence; uncertain provider requests remain counted.");
    }
    const token = randomUUID();
    return (await client.query<ClaimedJob>("UPDATE relay.agent_jobs SET status='running',stage='inspecting',attempts=attempts+1,lease_token=$2,lease_until=now()+($3::integer*interval '1 millisecond'),started_at=coalesce(started_at,now()),updated_at=now() WHERE id=$1 RETURNING *", [job.id, token, RUN_LIMITS.leaseMs])).rows[0];
  });
}

async function lockJob(client: PoolClient, job: ClaimedJob): Promise<JobRow> {
  const current = (await client.query<JobRow>("SELECT * FROM relay.agent_jobs WHERE id=$1 FOR UPDATE", [job.id])).rows[0];
  assertDomain(current?.status === "running" && current.lease_token === job.lease_token && current.lease_until && current.lease_until > new Date() && !current.cancel_requested, "RUN_LEASE_LOST", "This worker no longer owns the discovery run.");
  return current;
}

async function trace(job: ClaimedJob, stage: string, message: string) {
  await withTransaction(async client => {
    await lockJob(client, job);
    await client.query("UPDATE relay.agent_jobs SET stage=$2,updated_at=now() WHERE id=$1", [job.id, stage]);
    await appendTrace(client, job.id, stage, message);
  });
}

async function snapshot(job: ClaimedJob): Promise<Workspace> {
  return withTransaction(async client => {
    // Same lock ordering as commands: community, then job. External work runs outside this transaction.
    const session = (await client.query<{ expires_at: Date }>("SELECT expires_at FROM relay.sessions WHERE id=$1 FOR UPDATE", [job.session_id])).rows[0];
    assertDomain(session && session.expires_at > new Date(), "SESSION_EXPIRED", "This exchange community expired before discovery finished.", 401);
    await lockJob(client, job);
    const member = (await client.query("SELECT 1 FROM relay.members WHERE session_id=$1 AND id=$2 AND active AND role='member'", [job.session_id, job.member_id])).rows[0];
    assertDomain(member, "MEMBERSHIP_INACTIVE", "This participant is no longer active. Discovery has stopped.", 403);
    return loadWorkspace(client, job.session_id, job.member_id);
  });
}

/** Reserve budget BEFORE any paid request. Unknown outcomes are never refunded automatically. */
export async function reserveProviderCall(job: ClaimedJob, provider: "qloo" | "openai", operation: string): Promise<string> {
  return withTransaction(async client => {
    await lockJob(client, job);
    await client.query("SELECT pg_advisory_xact_lock($1)", [provider === "qloo" ? 742319820 : 742319821]);
    const counts = (await client.query<{ global: string; participant: string; run: string }>("SELECT count(*) FILTER(WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS global,count(*) FILTER(WHERE session_id=$2 AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS participant,count(*) FILTER(WHERE job_id=$3) AS run FROM relay.provider_calls WHERE provider=$1", [provider, job.session_id, job.id])).rows[0];
    const limit = provider === "qloo" ? configuredLimit("RELAY_QLOO_DAILY_LIMIT", 12, 1000) : configuredLimit("RELAY_MODEL_DAILY_LIMIT", 100, 10000);
    const participantLimit = provider === "qloo" ? configuredLimit("RELAY_QLOO_SESSION_DAILY_LIMIT", 6, 100) : configuredLimit("RELAY_MODEL_SESSION_DAILY_LIMIT", 32, 1000);
    const runLimit = provider === "qloo" ? RUN_LIMITS.qlooCalls : RUN_LIMITS.modelSteps;
    assertDomain(Number(counts.global) < limit && Number(counts.participant) < participantLimit && Number(counts.run) < runLimit, "PROVIDER_BUDGET_EXHAUSTED", `${provider === "qloo" ? "Qloo" : "Model"} discovery reached its configured usage limit. Saved evidence is still available; the system will not spend beyond this limit.`, 429);
    const id = randomUUID();
    await client.query("INSERT INTO relay.provider_calls(id,session_id,job_id,provider,operation,state) VALUES($1,$2,$3,$4,$5,'started')", [id, job.session_id, job.id, provider, operation]);
    return id;
  });
}

async function finishProviderCall(id: string, state: "succeeded" | "failed", usage: { inputTokens?: number; outputTokens?: number } = {}) {
  // A cancelled/expired request stays uncertain even if an obsolete worker later returns.
  await getPool().query("UPDATE relay.provider_calls SET state=CASE WHEN state='started' THEN $2 ELSE state END,input_tokens=GREATEST(input_tokens,$3),output_tokens=GREATEST(output_tokens,$4),finished_at=coalesce(finished_at,now()) WHERE id=$1", [id, state, usage.inputTokens ?? 0, usage.outputTokens ?? 0]);
}

async function checkpointCategory(job: ClaimedJob, category: Category, ranked: RankedCategory, cached: boolean) {
  await withTransaction(async client => {
    const current = await lockJob(client, job);
    const checkpoint: DiscoveryCheckpoint = { ...current.checkpoint, rankings: { ...current.checkpoint.rankings, [category]: ranked }, cacheHits: (current.checkpoint.cacheHits ?? 0) + Number(cached) };
    await client.query("UPDATE relay.agent_jobs SET checkpoint=$2,updated_at=now() WHERE id=$1", [job.id, checkpoint]);
    await appendTrace(client, job.id, cached ? "cache-hit" : "ranked", `${cached ? "Reused saved Qloo evidence for" : "Qloo ranked"} ${category === "record" ? "artists behind the offered records" : category === "book" ? "books" : "games"}: ${ranked.result.rankings.length} entities, ${ranked.prepared.copies.length} eligible copies. Availability will be checked again before publication.`);
    job.checkpoint = checkpoint;
  });
}

async function rankCategory(job: ClaimedJob, category: Category, transport?: QlooTransport): Promise<RankedCategory> {
  if (job.checkpoint.rankings?.[category]) return job.checkpoint.rankings[category];
  const prepared = job.input.prepared[category];
  assertDomain(prepared, "CATEGORY_NOT_AVAILABLE", "This category was not included in the verified eligible inventory.", 422);
  const current = await snapshot(job);
  assertDomain(current.preferences.version === job.input.preferenceVersion && prepareRank(scopeFor(current, category)).scopeHash === prepared.scopeHash, "STALE_CANDIDATES", "Your tastes or available copies changed while discovery was running. Start a new discovery.");
  // This cache contains only cultural entities, not copies, owners or scope IDs.
  // Identical public sample queries can share it. Private communities have separate namespaces.
  const namespace = `${transport ? "injected-test:" : ""}${current.session.mode === "sample" ? "public-sample" : `community:${job.session_id}`}`;
  const queryKey = hash({ adapter: prepared.adapterVersion, endpoint: requireQlooConfiguration().baseUrl, request: prepared.request });
  const waitUntil = Date.now() + 22_000;
  let ownsQuery = false;
  while (!ownsQuery) {
    const cached = (await getPool().query<{ response: QlooResult }>("SELECT response FROM relay.qloo_query_cache WHERE namespace=$1 AND cache_key=$2 AND expires_at>now()", [namespace, queryKey])).rows[0];
    if (cached) {
      const result: QlooResult = { ...cached.response, scopeHash: prepared.scopeHash, shortlist: prepared.shortlist, rankings: cached.response.rankings.map(row => ({ ...row, itemIds: prepared.copies.filter(copy => copy.entityId === row.entityId).map(copy => copy.itemId) })) };
      const ranked: RankedCategory = { category, prepared, result, evidenceId: randomUUID(), cache: "hit" };
      await checkpointCategory(job, category, ranked, true);
      return ranked;
    }
    const claim = await getPool().query("INSERT INTO relay.qloo_query_claims(namespace,cache_key,job_id,lease_token,lease_until) VALUES($1,$2,$3,$4,now()+interval '25 seconds') ON CONFLICT(namespace,cache_key) DO UPDATE SET job_id=EXCLUDED.job_id,lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until WHERE relay.qloo_query_claims.lease_until<now() RETURNING job_id", [namespace, queryKey, job.id, job.lease_token]);
    ownsQuery = !!claim.rowCount;
    if (!ownsQuery) {
      assertDomain(Date.now() < waitUntil, "QUERY_IN_PROGRESS", "An identical cultural query is still running. Its saved result can be reused on retry.", 503);
      await withTransaction(client => lockJob(client, job));
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  await trace(job, "consulting-qloo", `Requesting Qloo affinity only among verified available ${category === "record" ? "record artists" : category === "book" ? "books" : "games"}. No participant identity or copy notes are sent.`);
  let result: QlooResult;
  try {
    const callId = await reserveProviderCall(job, "qloo", `rank:${category}`);
    try {
      result = await rankVerifiedInventory(prepared, scopeFor(current, category), { transport });
      await finishProviderCall(callId, result.status === "error" ? "failed" : "succeeded");
    } catch (error) { await finishProviderCall(callId, "failed"); throw error; }
    if (["ok", "empty", "partial", "degraded"].includes(result.status)) {
      await withTransaction(async client => {
        await lockJob(client, job);
        const cultural = { ...result, scopeHash: "cultural-query-only", rankings: result.rankings.map(row => ({ ...row, itemIds: [] })) };
        await client.query("INSERT INTO relay.qloo_query_cache(namespace,cache_key,response,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(namespace,cache_key) DO UPDATE SET response=EXCLUDED.response,created_at=now(),expires_at=EXCLUDED.expires_at", [namespace, queryKey, cultural, new Date(Date.now() + RUN_LIMITS.cacheMs)]);
      });
    }
  } finally {
    await getPool().query("DELETE FROM relay.qloo_query_claims WHERE namespace=$1 AND cache_key=$2 AND job_id=$3 AND lease_token=$4", [namespace, queryKey, job.id, job.lease_token]);
  }
  const ranked: RankedCategory = { category, prepared, result, evidenceId: randomUUID(), cache: "miss" };
  await checkpointCategory(job, category, ranked, false);
  return ranked;
}

async function publish(job: ClaimedJob, report: AgentReport) {
  await withTransaction(async client => {
    const session = (await client.query<{ expires_at: Date }>("SELECT expires_at FROM relay.sessions WHERE id=$1 FOR UPDATE", [job.session_id])).rows[0];
    assertDomain(session && session.expires_at > new Date(), "SESSION_EXPIRED", "This community expired before discovery finished.", 401);
    const currentJob = await lockJob(client, job);
    const workspace = await loadWorkspace(client, job.session_id, job.member_id);
    const active = (await client.query("SELECT 1 FROM relay.members WHERE session_id=$1 AND id=$2 AND active", [job.session_id, job.member_id])).rows.length;
    assertDomain(active && workspace.preferences.version === job.input.preferenceVersion, "STALE_CANDIDATES", "Membership or taste references changed. Review the current workspace and run discovery again.");
    const completed = Object.values(currentJob.checkpoint.rankings ?? {}).filter((value): value is RankedCategory => !!value);
    for (const ranked of completed) {
      assertDomain(prepareRank(scopeFor(workspace, ranked.category)).scopeHash === ranked.prepared.scopeHash, "STALE_CANDIDATES", "Inventory changed before these results could be published. Run discovery again for current copies.");
    }
    report = buildGroundedReport(workspace, currentJob.checkpoint.rankings ?? {}, report.decisions.map(decision => decision.itemId), report.model);
    // No arbitrary model text is rendered. Every display decision references verified evidence and a current copy.
    const sourceItems = new Map(completed.flatMap(ranked => ranked.result.rankings.flatMap(row => row.itemIds.map(itemId => [itemId, ranked] as const))));
    assertDomain(report.decisions.every(decision => sourceItems.get(decision.itemId)?.evidenceId === decision.evidenceId && workspace.items.some(item => item.id === decision.itemId && item.version === sourceItems.get(decision.itemId)?.prepared.copies.find(copy => copy.itemId === item.id)?.version && item.state === "available" && item.ownerId !== job.member_id)), "AGENT_GROUNDING_FAILED", "An agent selection could not be tied to a current Qloo-ranked copy. No suggestion was published.");
    for (const ranked of completed) {
      await client.query("INSERT INTO relay.evidence(session_id,id,member_id,kind,source,title,summary,details) VALUES($1,$2,$3,'discovery','live-qloo',$4,$5,$6) ON CONFLICT DO NOTHING", [job.session_id, ranked.evidenceId, job.member_id, `Qloo ${ranked.category === "record" ? "artist" : ranked.category} ranking`, "Qloo affinity over verified cultural identities. Physical edition, condition, willingness and handoff remain separate application and participant decisions.", { runId: job.id, generatedAt: ranked.result.generatedAt, cache: ranked.cache, request: ranked.prepared.request, scopeHash: ranked.prepared.scopeHash, copies: ranked.prepared.copies, coverage: ranked.prepared.coverage, shortlist: ranked.prepared.shortlist, adapterVersion: ranked.result.adapterVersion, status: ranked.result.status, rankings: ranked.result.rankings, warning: ranked.result.warning, modelAuthority: "discovery-only", consentCreated: false }]);
    }
    const candidateItems = [...new Set(completed.flatMap(ranked => ranked.prepared.copies.map(copy => copy.itemId)))];
    const run: DiscoveryRun = {
      id: job.id, status: "ready", source: "live-qloo", category: job.input.category, preferenceVersion: job.input.preferenceVersion,
      candidateItemIds: candidateItems, candidateSetHash: hash(completed.map(ranked => ranked.prepared.scopeHash)),
      suggestions: report.decisions.map(decision => ({ itemId: decision.itemId, rank: decision.categoryRank, reason: decision.explanation, signals: workspace.preferences.seedWorkIds.map(id => workspace.works.find(work => work.id === id)?.title ?? id), evidenceId: decision.evidenceId, source: "live-qloo" })),
      createdAt: new Date().toISOString(), disclosure: `Qloo-ranked cultural identities · ${completed.some(ranked => ranked.cache === "hit") ? "includes saved evidence with its original timestamp" : "live provider requests"} · ${workspace.session.mode === "sample" ? "authored sample copies and members" : "participant-listed copies"} · AI-curated categories, no automatic approval`,
    };
    await client.query("INSERT INTO relay.discovery_runs(session_id,id,member_id,data) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,id) DO NOTHING", [job.session_id, job.id, job.member_id, run]);
    const partial = report.warnings.length > 0 || completed.some(ranked => ["partial", "degraded", "error", "needs_input"].includes(ranked.result.status));
    await client.query("UPDATE relay.agent_jobs SET status=$2,stage='ready',report=$3,finished_at=now(),updated_at=now(),lease_token=NULL,lease_until=NULL WHERE id=$1", [job.id, partial ? "partial" : "succeeded", report]);
    await appendTrace(client, job.id, "ready", `${report.decisions.length} verified suggestions are ready. Current copy versions were rechecked; approval and confirmation still belong to each participant.`);
  });
}

function safeRunFailure(error: unknown): { code: string; message: string } {
  if (error instanceof DomainError) return { code: error.code, message: error.message };
  // Never expose provider request bodies, headers, raw errors or model-generated prose.
  const timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
  return { code: timeout ? "RUN_DEADLINE" : "AGENT_UPSTREAM", message: timeout ? "Discovery reached its time limit. Saved category evidence can be reused on an explicit retry." : "The model or discovery provider could not finish this run. Saved evidence and exact approvals remain available." };
}

export interface ProcessJobOptions { qlooTransport?: QlooTransport; model?: AgentDependencies["model"]; signal?: AbortSignal }

export async function processDiscoveryJob(job: ClaimedJob, options: ProcessJobOptions = {}): Promise<void> {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(RUN_LIMITS.elapsedMs), ...(options.signal ? [options.signal] : [])]);
  let heartbeatBusy = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      const renewed = await getPool().query("UPDATE relay.agent_jobs SET lease_until=now()+($3::integer*interval '1 millisecond'),updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND NOT cancel_requested AND lease_until>now() RETURNING id", [job.id, job.lease_token, RUN_LIMITS.leaseMs]);
      if (!renewed.rowCount) controller.abort();
    } catch { controller.abort(); } finally { heartbeatBusy = false; }
  }, 10_000);
  try {
    const workspace = await snapshot(job);
    await trace(job, "inspecting", "Checking your selected references, exact available copies and existing approved exchange paths.");
    const used = (await getPool().query<{ count: string }>("SELECT count(*) FROM relay.provider_calls WHERE job_id=$1 AND provider='openai'", [job.id])).rows[0];
    let pendingModelCall: string | null = null;
    const report = await runDiscoveryAgent({
      workspace, prepared: job.input.prepared, completed: job.checkpoint.rankings ?? {}, signal, model: options.model,
      remainingModelSteps: RUN_LIMITS.modelSteps - Number(used.count),
      rank: category => rankCategory(job, category, options.qlooTransport),
      trace: (stage, message) => trace(job, stage, message),
      beforeModel: async () => { pendingModelCall = await reserveProviderCall(job, "openai", "discovery-tool-step"); },
      afterModel: async usage => { if (pendingModelCall) await finishProviderCall(pendingModelCall, "succeeded", usage); pendingModelCall = null; },
    });
    signal.throwIfAborted();
    await trace(job, "rechecking", "Checking every suggested physical copy and preference version again before showing the result.");
    await publish(job, report);
  } catch (error) {
    const failure = safeRunFailure(error);
    await withTransaction(async client => {
      const current = (await client.query<JobRow>("SELECT * FROM relay.agent_jobs WHERE id=$1 FOR UPDATE", [job.id])).rows[0];
      if (current?.status !== "running" || current.lease_token !== job.lease_token || !current.lease_until || current.lease_until <= new Date()) return;
      const status = ["STALE_CANDIDATES", "NO_ELIGIBLE_CANDIDATES", "MEMBERSHIP_INACTIVE", "SESSION_EXPIRED"].includes(failure.code) ? "stale" : "failed";
      await client.query("UPDATE relay.agent_jobs SET status=$2,stage=$2,error_code=$3,error_message=$4,finished_at=now(),updated_at=now(),lease_token=NULL,lease_until=NULL WHERE id=$1", [job.id, status, failure.code, failure.message]);
      await client.query("UPDATE relay.provider_calls SET state='uncertain',finished_at=now() WHERE job_id=$1 AND state='started'", [job.id]);
      await appendTrace(client, job.id, status, failure.message);
    });
  } finally { clearInterval(heartbeat); }
}

export async function workerHealth() {
  const result = (await getPool().query<{ ready: boolean; queued: string; oldest_queue_seconds: string | null }>("SELECT EXISTS(SELECT 1 FROM relay.worker_heartbeats WHERE last_seen_at>now()-interval '40 seconds') ready,(SELECT count(*) FROM relay.agent_jobs WHERE status='queued') queued,(SELECT extract(epoch FROM now()-min(created_at)) FROM relay.agent_jobs WHERE status='queued') oldest_queue_seconds")).rows[0];
  return { ready: result.ready, queued: Number(result.queued), oldestQueueSeconds: result.oldest_queue_seconds ? Math.round(Number(result.oldest_queue_seconds)) : 0 };
}

export function runUsageTotal(runs: AgentRun[]): AgentUsage {
  return runs.reduce((total, run) => ({ qlooCalls: total.qlooCalls + run.usage.qlooCalls, cacheHits: total.cacheHits + run.usage.cacheHits, modelCalls: total.modelCalls + run.usage.modelCalls, unreportedModelCalls: total.unreportedModelCalls + run.usage.unreportedModelCalls, inputTokens: total.inputTokens + run.usage.inputTokens, outputTokens: total.outputTokens + run.usage.outputTokens }), { ...EMPTY_USAGE });
}
