import { createHash } from "node:crypto";
import { z } from "zod";
import type { Workspace } from "../domain/types";
import { withTransaction } from "./db";

const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });
let token: { value: string; expiresAt: number } | null = null;

export function taskDispatchConfiguration(env: Record<string, string | undefined> = process.env) {
  if (!env.RELAY_WORKER_URL) return null; // Local persistent worker needs no cloud dispatch.
  const project = env.GOOGLE_CLOUD_PROJECT;
  const location = env.RELAY_TASKS_LOCATION ?? "us-central1";
  const queue = env.RELAY_TASKS_QUEUE ?? "relay-discovery";
  const invoker = env.RELAY_TASKS_INVOKER_SERVICE_ACCOUNT;
  const workerUrl = new URL(env.RELAY_WORKER_URL);
  if (!project || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) || !/^[a-z0-9-]{1,60}$/.test(location) || !/^[A-Za-z0-9_-]{1,100}$/.test(queue) || !invoker || !/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.iam\.gserviceaccount\.com$/.test(invoker) || workerUrl.protocol !== "https:" || workerUrl.pathname !== "/" || workerUrl.search || workerUrl.hash || workerUrl.username || workerUrl.password) throw new Error("Cloud worker dispatch configuration is incomplete.");
  return { parent: `projects/${project}/locations/${location}/queues/${queue}`, invoker, workerOrigin: workerUrl.origin };
}

type WorkTarget = { jobId: string } | { catalogSearchId: string };

export function cloudTaskPayload(config: NonNullable<ReturnType<typeof taskDispatchConfiguration>>, jobIdOrTarget: string | WorkTarget) {
  const target = typeof jobIdOrTarget === "string" ? { jobId: jobIdOrTarget } : jobIdOrTarget;
  const taskId = createHash("sha256").update(JSON.stringify(target)).digest("hex");
  return {
    task: {
      name: `${config.parent}/tasks/${taskId}`, dispatchDeadline: "180s",
      httpRequest: { url: `${config.workerOrigin}/work`, httpMethod: "POST", headers: { "Content-Type": "application/json" }, body: Buffer.from(JSON.stringify(target)).toString("base64"), oidcToken: { serviceAccountEmail: config.invoker, audience: config.workerOrigin } },
    },
  };
}

async function dispatch(target: WorkTarget, fetcher: typeof fetch) {
  const config = taskDispatchConfiguration();
  if (!config) return;
  if (!token || token.expiresAt < Date.now() + 60_000) {
    const response = await fetcher(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" }, redirect: "error", signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("Cloud metadata authentication is unavailable.");
    const value = tokenSchema.parse(await response.json());
    token = { value: value.access_token, expiresAt: Date.now() + value.expires_in * 1000 };
  }
  const response = await fetcher(`https://cloudtasks.googleapis.com/v2/${config.parent}/tasks`, { method: "POST", headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/json" }, body: JSON.stringify(cloudTaskPayload(config, target)), redirect: "error", signal: AbortSignal.timeout(5000) });
  // The deterministic task name makes an idempotent command replay safe.
  if (!response.ok && response.status !== 409) throw new Error("Cloud Tasks did not accept this dispatch.");
  await response.body?.cancel();
}

/** Run only AFTER the database command commits. Scheduler recovery handles a missed kick. */
export async function dispatchPendingDiscovery(workspace: Workspace, fetcher: typeof fetch = fetch): Promise<void> {
  const job = workspace.agentRuns.find(run => run.status === "queued" && run.memberId === workspace.currentMemberId);
  if (!job || !process.env.RELAY_WORKER_URL) return;
  try { await dispatch({ jobId: job.id }, fetcher); }
  catch {
    // No access token, task request or provider response is logged or returned.
    await withTransaction(async client => {
      const current = (await client.query("SELECT id FROM relay.agent_jobs WHERE id=$1 AND status='queued' FOR UPDATE", [job.id])).rows[0];
      if (!current) return;
      const recorded = (await client.query("SELECT 1 FROM relay.agent_events WHERE job_id=$1 AND stage='dispatch-delayed'", [job.id])).rows.length;
      if (!recorded) await client.query("INSERT INTO relay.agent_events(job_id,sequence,stage,message) SELECT $1,COALESCE(MAX(sequence),0)+1,'dispatch-delayed','The immediate worker notification was delayed. Your request remains saved for the scheduled recovery worker.' FROM relay.agent_events WHERE job_id=$1", [job.id]);
    }).catch(() => undefined);
  }
}

/** The queued catalog row remains authoritative if an immediate notification fails. */
export async function dispatchCatalogSearch(searchId: string, fetcher: typeof fetch = fetch): Promise<void> {
  try { await dispatch({ catalogSearchId: searchId }, fetcher); }
  catch { /* Scheduled recovery retries saved work without exposing dispatch credentials. */ }
}
