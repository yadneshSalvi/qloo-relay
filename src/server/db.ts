import pg, { type Pool, type PoolClient } from "pg";
import { DomainError } from "../domain/errors";

const shared = globalThis as typeof globalThis & { relayPool?: Pool };

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new DomainError("DATABASE_UNCONFIGURED", "PostgreSQL is not configured. Set DATABASE_URL and run the migration.", 503);
  if (!shared.relayPool) {
    const max = Number(process.env.RELAY_DB_POOL_MAX ?? 10);
    if (!Number.isInteger(max) || max < 1 || max > 10) throw new DomainError("DATABASE_CONFIGURATION", "RELAY_DB_POOL_MAX must be an integer from 1 to 10.", 503);
    shared.relayPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      application_name: "relay-exchange",
    });
    shared.relayPool.on("error", () => { /* Request boundaries report connection errors without connection strings. */ });
  }
  return shared.relayPool;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (shared.relayPool) { await shared.relayPool.end(); delete shared.relayPool; }
}
