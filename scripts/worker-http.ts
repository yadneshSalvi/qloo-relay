import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { loadEnvFile } from "node:process";
import { z } from "zod";
import { closePool, getPool } from "../src/server/db";
import { processNextWork } from "../src/server/worker";

if (existsSync(".env.local")) loadEnvFile(".env.local");
const controller = new AbortController();
const requestSchema = z.strictObject({ jobId: z.uuid().optional(), catalogSearchId: z.uuid().optional() }).refine(value => !(value.jobId && value.catalogSearchId));
const workerId = randomUUID();
let active = false;

// Cloud Run must enforce IAM on this service. Local mode binds only to loopback.
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/health" && request.method === "GET") {
    try { await getPool().query("SELECT 1"); response.end(JSON.stringify({ status: "ready", runtime: "request-driven", active })); }
    catch { response.statusCode = 503; response.end(JSON.stringify({ status: "database-unavailable" })); }
    return;
  }
  if (request.url !== "/work" || request.method !== "POST") { response.statusCode = 404; response.end(JSON.stringify({ error: "NOT_FOUND" })); return; }
  if (active || controller.signal.aborted) { response.statusCode = 503; response.setHeader("Retry-After", "15"); response.end(JSON.stringify({ error: "WORKER_BUSY" })); return; }
  active = true;
  try {
    let body = "";
    for await (const chunk of request) { body += chunk.toString(); if (body.length > 2048) throw new Error("REQUEST_TOO_LARGE"); }
    const input = requestSchema.parse(JSON.parse(body || "{}"));
    await getPool().query("INSERT INTO relay.worker_heartbeats(worker_id) VALUES($1) ON CONFLICT(worker_id) DO UPDATE SET last_seen_at=now()", [workerId]);
    const processed = await processNextWork(input, controller.signal);
    response.end(JSON.stringify({ status: processed ? "processed" : "idle" }));
  } catch (error) {
    response.statusCode = error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503;
    response.end(JSON.stringify({ error: response.statusCode === 400 ? "INVALID_REQUEST" : "WORKER_UNAVAILABLE" }));
  } finally { active = false; }
});
server.requestTimeout = 180_000;
server.headersTimeout = 10_000;
server.listen(Number(process.env.PORT ?? 3102), process.env.WORKER_HOST ?? "127.0.0.1", () => { console.log("RELAY HTTP worker ready. Keep this service private behind authenticated invocation."); });

const shutdown = () => {
  controller.abort();
  server.close(() => { void closePool(); });
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
