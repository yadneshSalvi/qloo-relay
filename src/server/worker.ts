import { randomUUID } from "node:crypto";
import { claimNextCatalogSearch, processCatalogSearch } from "./catalog-search";
import { closePool, getPool } from "./db";
import { claimNextJob, processDiscoveryJob } from "./jobs";

export async function processNextWork(target: { jobId?: string; catalogSearchId?: string }, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  if (!target.jobId) {
    const search = await claimNextCatalogSearch(target.catalogSearchId);
    if (search) { await processCatalogSearch(search); return true; }
    if (target.catalogSearchId) return false;
  }
  const job = await claimNextJob(target.jobId);
  if (!job) return false;
  await processDiscoveryJob(job, { signal });
  return true;
}

/** Long-lived hosts may poll; Cloud Run invokes the bounded HTTP worker instead. */
export async function runWorker(signal: AbortSignal) {
  const workerId = randomUUID();
  const tick = async () => { await getPool().query("INSERT INTO relay.worker_heartbeats(worker_id) VALUES($1) ON CONFLICT(worker_id) DO UPDATE SET last_seen_at=now()", [workerId]); };
  await tick();
  const heartbeat = setInterval(() => { void tick().catch(() => undefined); }, 10_000);
  try {
    while (!signal.aborted) {
      if (await processNextWork({}, signal)) continue;
      await new Promise<void>(resolve => { const timer = setTimeout(done, 1000); function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); } signal.addEventListener("abort", done, { once: true }); });
    }
  } finally { clearInterval(heartbeat); await getPool().query("DELETE FROM relay.worker_heartbeats WHERE worker_id=$1", [workerId]); await closePool(); }
}
