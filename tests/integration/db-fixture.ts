import "./test-env";
import { CATALOG } from "../../src/domain/catalog";
import { withTransaction } from "../../src/server/db";
import { SCHEMA_UP } from "../../src/server/schema";

/** Parallel test files share PostgreSQL, but never rerun DDL over another file's transactions. */
export async function ensureTestSchema() {
  if (!process.env.DATABASE_URL) throw new Error("These integration tests require actual PostgreSQL. Set DATABASE_URL or use the documented .env.local example.");
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(742319816)");
    const table = (await client.query<{ name: string | null }>("SELECT to_regclass('relay.schema_migrations') AS name")).rows[0];
    const version = table.name ? Number((await client.query<{ version: number | null }>("SELECT max(version) AS version FROM relay.schema_migrations")).rows[0].version ?? 0) : 0;
    if (version < 7) await client.query(SCHEMA_UP);
    const count = Number((await client.query<{ count: string }>("SELECT count(*) FROM relay.catalog_works")).rows[0].count);
    if (!count) for (const work of CATALOG) await client.query("INSERT INTO relay.catalog_works(id,data) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [work.id, work]);
  });
}
