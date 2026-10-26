import { getPool } from "../../../server/db";
import { json } from "../../../server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getPool().query<{ version: number }>("SELECT max(version) AS version FROM relay.schema_migrations");
    if (Number(result.rows[0]?.version ?? 0) < 7) return json({ status: "unavailable" }, 503);
    return json({ status: "ready", liveDiscovery: { available: process.env.RELAY_LIVE_DISCOVERY_ENABLED === "true" || !!(process.env.QLOO_API_KEY && process.env.OPENAI_API_KEY) } });
  } catch { return json({ status: "unavailable" }, 503); }
}
