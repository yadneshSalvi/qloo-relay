import { getPool } from "../../../server/db";
import { errorResponse, json } from "../../../server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getPool().query<{ version: number }>("SELECT max(version) AS version FROM relay.schema_migrations");
    return json({ status: "ready", storage: "postgresql", schemaVersion: result.rows[0].version, mode: "authored-sample", outboundMessaging: false });
  } catch (error) { return errorResponse(error); }
}
