import type { NextRequest } from "next/server";
import { parseCommand } from "../../../domain/commands";
import { DomainError } from "../../../domain/errors";
import { assertSameOrigin, attachSession, errorResponse, json } from "../../../server/http";
import { createSession, executeCommand, replaceSession, SESSION_COOKIE } from "../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const key = request.headers.get("idempotency-key");
    if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key of 8–128 letters, numbers, or . _ : - characters for this action.", 400);
    if (Number(request.headers.get("content-length") ?? 0) > 65536) throw new DomainError("REQUEST_TOO_LARGE", "This sample command exceeds the request size limit.", 413);
    const body = await request.text();
    if (body.length > 65536) throw new DomainError("REQUEST_TOO_LARGE", "This sample command exceeds the request size limit.", 413);
    const command = parseCommand(JSON.parse(body));
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (command.type === "startSession" || command.type === "reset") {
      let session;
      try { session = token ? await replaceSession(token, command, key) : await createSession(command.displayName); }
      catch (error) {
        if (!(error instanceof DomainError) || error.code !== "SESSION_EXPIRED") throw error;
        session = await createSession(command.displayName);
      }
      return attachSession(json({ workspace: session.workspace, notice: "Started a fresh, isolated sample exchange. Every member and copy is fictional." }), request, session.token);
    }
    if (!token) throw new DomainError("SESSION_REQUIRED", "Open the sample workspace before making an exchange action.", 401);
    return json(await executeCommand(token, command, key));
  } catch (error) { return errorResponse(error); }
}
