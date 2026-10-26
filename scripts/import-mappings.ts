import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { z } from "zod";
import { closePool, withTransaction } from "../src/server/db";

if (existsSync(".env.local")) loadEnvFile(".env.local");
const mappingSchema = z.array(z.strictObject({
  workId: z.string().min(1).max(120), entityId: z.uuid(),
  entityType: z.enum(["urn:entity:book", "urn:entity:artist", "urn:entity:videogame"]),
  entityName: z.string().min(1).max(300), query: z.string().min(1).max(300),
  verifiedAt: z.iso.datetime(), verification: z.string().min(10).max(1000),
  evidence: z.record(z.string(), z.unknown()).default({}),
})).min(1).max(100).refine(rows => new Set(rows.map(row => row.workId)).size === rows.length, "Each catalog work must have one reviewed mapping.");

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Provide a local reviewed-mappings JSON file. Keep Qloo responses outside Git.");
  const mappings = mappingSchema.parse(JSON.parse(await readFile(file, "utf8")));
  await withTransaction(async client => {
    for (const row of mappings) {
      const catalog = (await client.query<{ data: { category: string } }>("SELECT data FROM relay.catalog_works WHERE id=$1", [row.workId])).rows[0];
      const expected = { book: "urn:entity:book", record: "urn:entity:artist", game: "urn:entity:videogame" }[catalog?.data.category];
      if (expected !== row.entityType) throw new Error("A reviewed mapping does not match its catalog category. Nothing was imported.");
      await client.query("INSERT INTO relay.catalog_mappings(work_id,entity_id,entity_type,entity_name,query,verified_at,verification,source,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,'live-qloo',$8) ON CONFLICT(work_id) DO UPDATE SET entity_id=EXCLUDED.entity_id,entity_type=EXCLUDED.entity_type,entity_name=EXCLUDED.entity_name,query=EXCLUDED.query,verified_at=EXCLUDED.verified_at,verification=EXCLUDED.verification,evidence=EXCLUDED.evidence", [row.workId, row.entityId, row.entityType, row.entityName, row.query, row.verifiedAt, row.verification, row.evidence]);
    }
  });
  console.log(`Imported ${mappings.length} reviewed catalog mappings. The import file and raw provider responses remain outside Git.`);
}

main().catch(error => {
  console.error("Mapping import failed", { name: error instanceof Error ? error.name : "unknown" });
  process.exitCode = 1;
}).finally(closePool);
