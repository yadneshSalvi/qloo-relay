import type { NextRequest } from "next/server";
import { DomainError } from "../../../domain/errors";
import { attachSession, errorResponse, json, sessionToken } from "../../../server/http";
import { ACCESS_COOKIE, createSession, getWorkspace } from "../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const token = sessionToken(request);
    if (token) {
      try { return json({ workspace: await getWorkspace(token) }); }
      catch (error) { if (request.cookies.has(ACCESS_COOKIE) || !(error instanceof DomainError) || error.code !== "SESSION_EXPIRED") throw error; }
    }
    const session = await createSession();
    return attachSession(json({ workspace: session.workspace }), request, session.token);
  } catch (error) { return errorResponse(error); }
}
