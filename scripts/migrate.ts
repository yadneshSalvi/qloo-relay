import { CATALOG } from "../src/domain/catalog";
import { withTransaction, closePool } from "../src/server/db";
import { SCHEMA_DOWN, SCHEMA_UP } from "../src/server/schema";

async function main() {
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(742319816)");
    if (process.argv.includes("--down")) {
      await client.query(SCHEMA_DOWN);
      console.log("Removed the application-owned relay schema.");
      return;
    }
    await client.query(SCHEMA_UP);
    for (const work of CATALOG) {
      await client.query("INSERT INTO relay.catalog_works(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data", [work.id, work]);
    }
    console.log(`RELAY schema v7 ready; ${CATALOG.length} starter catalog works. Verified mappings are preserved separately; confirmed additions are scoped. Private communities start empty.`);
  });
}

main().catch((error) => {
  console.error("Migration failed:", error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[redacted]") : "unknown error");
  process.exitCode = 1;
}).finally(async () => { await closePool(); });
