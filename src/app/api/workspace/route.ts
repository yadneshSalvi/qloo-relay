import type { NextRequest } from "next/server";
import { DomainError } from "../../../domain/errors";
import { attachSession, errorResponse, json } from "../../../server/http";
import { createSession, getWorkspace, SESSION_COOKIE } from "../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (token) {
      try { return json({ workspace: await getWorkspace(token) }); }
      catch (error) { if (!(error instanceof DomainError) || error.code !== "SESSION_EXPIRED") throw error; }
    }
    const session = await createSession();
    return attachSession(json({ workspace: session.workspace }), request, session.token);
  } catch (error) { return errorResponse(error); }
}
