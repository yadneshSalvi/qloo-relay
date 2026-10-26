import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { closePool } from "../src/server/db";
import { processNextWork, runWorker } from "../src/server/worker";

if (existsSync(".env.local")) loadEnvFile(".env.local");
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());

async function main() {
  if (process.argv.includes("--once")) {
    const processed = await processNextWork({}, controller.signal);
    console.log(processed ? "Processed one queued catalog or discovery request; inspect its saved status." : "No catalog or discovery request is waiting.");
    await closePool();
    return;
  }
  console.log("RELAY catalog and discovery worker ready. Provider secrets and payloads are not logged.");
  await runWorker(controller.signal);
}

main().catch(error => {
  console.error("RELAY worker stopped", { code: error && typeof error === "object" && "code" in error ? String(error.code) : "WORKER_FAILURE" });
  process.exitCode = 1;
}).finally(closePool);
