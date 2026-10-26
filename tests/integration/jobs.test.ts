import { randomUUID } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CATALOG } from "../../src/domain/catalog";
import { closePool, getPool, withTransaction } from "../../src/server/db";
import { claimNextJob, processDiscoveryJob, reserveProviderCall, type ClaimedJob } from "../../src/server/jobs";
import type { QlooTransport } from "../../src/server/qloo";
import { createSession, executeCommand, getWorkspace } from "../../src/server/service";
import { ensureTestSchema } from "./db-fixture";

const sessions: string[] = [];
const works: string[] = [];
const command = (token: string, value: Parameters<typeof executeCommand>[1]) => executeCommand(token, value, randomUUID());

async function fixture(reuse?: string) {
  const session = await createSession("Synthetic runtime test"); sessions.push(session.workspace.session.id);
  const prefix = reuse ?? randomUUID();
  await withTransaction(async client => {
    for (const work of CATALOG) {
      const id = `test-${prefix}-${work.id}`;
      if (!reuse) {
        works.push(id);
        await client.query("INSERT INTO relay.catalog_works(id,data) VALUES($1,$2)", [id, { ...work, id }]);
        await client.query("INSERT INTO relay.catalog_mappings(work_id,entity_id,entity_type,entity_name,query,verified_at,verification,source,evidence) VALUES($1,$2,$3,$4,$4,now(),'Synthetic test mapping. No provider response data.','live-qloo',$5)", [id, randomUUID(), `urn:entity:${work.category === "record" ? "artist" : work.category === "game" ? "videogame" : "book"}`, work.title, { fixture: true }]);
      }
      await client.query("UPDATE relay.items SET work_id=$3 WHERE session_id=$1 AND work_id=$2", [session.workspace.session.id, work.id, id]);
    }
    await client.query("UPDATE relay.preference_versions SET seed_work_ids=$2 WHERE session_id=$1", [session.workspace.session.id, JSON.stringify(session.workspace.preferences.seedWorkIds.map(id => `test-${prefix}-${id}`))]);
  });
  return { ...session, prefix, workspace: await getWorkspace(session.token) };
}
async function queued(token: string) { return (await command(token, { type: "discover", mode: "live", category: "game" })).workspace.agentRuns[0]; }
function model() {
  const actions = [{ name: "inspect_inventory", input: {} }, { name: "rank_inventory", input: { category: "game" } }, { name: "inspect_exchange_paths", input: { itemIds: ["item-hades-noah"] } }, { name: "finish_discovery", input: { itemIds: ["item-hades-noah"], focus: "exchange-path" } }];
  let index = 0;
  return new MockLanguageModelV4({ doGenerate: async () => {
    const action = actions[Math.min(index, actions.length - 1)]; index++;
    return { content: [{ type: "tool-call", toolCallId: `runtime-test-${index}`, toolName: action.name, input: JSON.stringify(action.input) }], finishReason: { unified: "tool-calls", raw: undefined }, usage: { inputTokens: { total: 40, noCache: 40, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 20, text: 20, reasoning: undefined } }, warnings: [] };
  } });
}
const transport: QlooTransport = async request => ({ schema_version: "1.0-preview.1", operation: "rank", status: "ok", interpretation: { option_type: `urn:entity:${request.option_type}` }, results: request.options.map(entity_id => ({ entity_id, type: "urn:entity", subtype: `urn:entity:${request.option_type}`, affinity: .5 })) });
function barrier() {
  let announce!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { announce = resolve; });
  const allowed = new Promise<void>(resolve => { release = resolve; });
  const delayed: QlooTransport = async (request, configuration) => { announce(); await allowed; return transport(request, configuration); };
  return { started, release, delayed };
}
beforeAll(async () => {
  await ensureTestSchema();
  process.env.QLOO_API_KEY = "synthetic-key-no-provider-access";
  process.env.OPENAI_API_KEY = "synthetic-key-no-provider-access";
  process.env.RELAY_QLOO_DAILY_LIMIT = "1000";
  process.env.RELAY_MODEL_DAILY_LIMIT = "1000";
  process.env.RELAY_QLOO_SESSION_DAILY_LIMIT = "100";
  process.env.RELAY_MODEL_SESSION_DAILY_LIMIT = "1000";
});
afterEach(async () => {
  if (sessions.length) await getPool().query("DELETE FROM relay.sessions WHERE id=ANY($1::uuid[])", [sessions.splice(0)]);
  if (works.length) await getPool().query("DELETE FROM relay.catalog_works WHERE id=ANY($1::text[])", [works.splice(0)]);
  await getPool().query("DELETE FROM relay.qloo_query_cache WHERE namespace LIKE 'injected-test:%'");
  process.env.RELAY_QLOO_DAILY_LIMIT = "1000";
});
afterAll(closePool);

describe("durable discovery runtime on isolated actual PostgreSQL", () => {
  it("coalesces enqueue and worker claims, checkpoints evidence, and survives pool restart without creating consent", async () => {
    const sample = await fixture(); const run = await queued(sample.token);
    expect((await queued(sample.token)).id).toBe(run.id);
    const claims = await Promise.all([claimNextJob(run.id), claimNextJob(run.id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const calls = vi.fn(transport);
    await processDiscoveryJob(claims.find(Boolean)!, { model: model(), qlooTransport: calls });
    await closePool();
    const state = await getWorkspace(sample.token);
    expect(state.agentRuns[0].status).toBe("succeeded");
    expect(state.agentRuns[0].usage).toMatchObject({ qlooCalls: 1, modelCalls: 4, inputTokens: 160, outputTokens: 80, unreportedModelCalls: 0 });
    expect(state.agentRuns[0].trace.at(-1)?.stage).toBe("ready");
    expect(state.discovery?.source).toBe("live-qloo");
    expect(state.discovery?.suggestions[0].itemId).toBe("item-hades-noah");
    expect(state.approvals.filter(approval => approval.memberId === "you")).toEqual([]);
    expect(state.proposals).toEqual([]);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("shares only cultural query evidence across sample workspaces and fans results to current copies", async () => {
    const a = await fixture(); const b = await fixture(a.prefix);
    const runA = await queued(a.token); const callsA = vi.fn(transport);
    await processDiscoveryJob((await claimNextJob(runA.id))!, { model: model(), qlooTransport: callsA });
    await getPool().query("INSERT INTO relay.items(session_id,id,work_id,owner_id,edition,condition,notes,attested,state) SELECT session_id,'second-hades-copy',work_id,owner_id,edition,condition,notes,true,'available' FROM relay.items WHERE session_id=$1 AND id='item-hades-noah'", [b.workspace.session.id]);
    const runB = await queued(b.token); const callsB = vi.fn(transport);
    await processDiscoveryJob((await claimNextJob(runB.id))!, { model: model(), qlooTransport: callsB });
    const state = await getWorkspace(b.token);
    expect(state.agentRuns[0].status).toBe("succeeded");
    expect(state.agentRuns[0].usage).toMatchObject({ qlooCalls: 0, cacheHits: 1 });
    expect(JSON.stringify(state.evidence.find(entry => entry.source === "live-qloo")!.details.rankings)).toContain("second-hades-copy");
    expect(callsA).toHaveBeenCalledTimes(1);
    expect(callsB).not.toHaveBeenCalled();
  });
  it("rejects a copy-version change after the paid response before publishing any discovery", async () => {
    const sample = await fixture(); const run = await queued(sample.token); const delayed = barrier();
    const pending = processDiscoveryJob((await claimNextJob(run.id))!, { model: model(), qlooTransport: delayed.delayed });
    await delayed.started;
    await getPool().query("UPDATE relay.items SET version=version+1 WHERE session_id=$1 AND id='item-hades-noah'", [sample.workspace.session.id]);
    delayed.release(); await pending;
    const state = await getWorkspace(sample.token);
    expect(state.agentRuns[0]).toMatchObject({ status: "stale", errorCode: "STALE_CANDIDATES" });
    expect(state.discovery).toBeNull();
    expect(state.proposals).toEqual([]);
  });
  it("fences cancellation while a provider request is in flight and keeps its reserved budget", async () => {
    const sample = await fixture(); const run = await queued(sample.token); const delayed = barrier();
    const pending = processDiscoveryJob((await claimNextJob(run.id))!, { model: model(), qlooTransport: delayed.delayed });
    await delayed.started;
    await command(sample.token, { type: "cancelRun", runId: run.id });
    delayed.release(); await pending;
    const state = await getWorkspace(sample.token);
    expect(state.agentRuns[0].status).toBe("cancelled");
    expect(state.agentRuns[0].usage.qlooCalls).toBe(1);
    expect(state.discovery).toBeNull();
    const call = (await getPool().query<{ state: string }>("SELECT state FROM relay.provider_calls WHERE job_id=$1 AND provider='qloo'", [run.id])).rows[0];
    expect(call.state).toBe("uncertain");
  });
  it("an expired worker cannot overwrite a recoverable run, then a fresh fenced claim finishes it", async () => {
    const sample = await fixture(); const run = await queued(sample.token); const delayed = barrier();
    const first = (await claimNextJob(run.id))!;
    const pending = processDiscoveryJob(first, { model: model(), qlooTransport: delayed.delayed });
    await delayed.started;
    await getPool().query("UPDATE relay.agent_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [run.id]);
    delayed.release(); await pending;
    const expired = (await getPool().query<{ status: string }>("SELECT status FROM relay.agent_jobs WHERE id=$1", [run.id])).rows[0];
    expect(expired.status).toBe("running");
    const next = (await claimNextJob(run.id))!;
    expect(next.lease_token).not.toBe(first.lease_token);
    await processDiscoveryJob(next, { model: model(), qlooTransport: transport });
    const state = await getWorkspace(sample.token);
    expect(state.agentRuns[0].status).toBe("succeeded");
    expect(state.agentRuns[0].attempt).toBe(2);
    expect(state.agentRuns[0].trace.some(event => event.stage === "recovered")).toBe(true);
  });
  it("serializes the global budget before any request and rejects unauthorized run control", async () => {
    const a = await fixture(); const b = await fixture(); const run = await queued(a.token);
    const job = (await claimNextJob(run.id)) as ClaimedJob;
    process.env.RELAY_QLOO_DAILY_LIMIT = "1";
    const outcomes = await Promise.allSettled([reserveProviderCall(job, "qloo", "budget-test"), reserveProviderCall(job, "qloo", "budget-test-2")]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(outcome => outcome.status === "rejected")).toMatchObject({ reason: { code: "PROVIDER_BUDGET_EXHAUSTED" } });
    await expect(command(b.token, { type: "cancelRun", runId: run.id })).rejects.toMatchObject({ code: "RUN_NOT_FOUND" });
  });
});
