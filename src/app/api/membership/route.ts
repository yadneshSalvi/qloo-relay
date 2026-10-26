import type { NextRequest } from "next/server";
import { membershipSchema } from "../../../domain/membership";
import { DomainError } from "../../../domain/errors";
import { assertSameOrigin, attachPrivateSession, attachSession, clearPrivateSession, errorResponse, json, sessionToken } from "../../../server/http";
import { createPrivateCommunity, endBrowserAccess, joinPrivateCommunity, listCommunityInvites, manageCommunity } from "../../../server/membership";
import { ACCESS_COOKIE, createSession, getWorkspace, SESSION_COOKIE } from "../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const token = sessionToken(request);
    if (!token) throw new DomainError("SESSION_REQUIRED", "Join a private community before managing invitations.", 401);
    return json(await listCommunityInvites(token));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const key = request.headers.get("idempotency-key");
    if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key of 8–128 safe characters.", 400);
    if (Number(request.headers.get("content-length") ?? 0) > 8192) throw new DomainError("REQUEST_TOO_LARGE", "This membership request is too large.", 413);
    const body = await request.text();
    if (body.length > 8192) throw new DomainError("REQUEST_TOO_LARGE", "This membership request is too large.", 413);
    const command = membershipSchema.parse(JSON.parse(body));
    if (command.type === "joinCommunity") {
      const joined = await joinPrivateCommunity(command, key);
      return attachPrivateSession(json({ workspace: joined.workspace, notice: "You joined with your own scoped browser session. Your display name is self-reported." }), request, joined.token);
    }
    if (command.type === "leaveBrowser") {
      const privateToken = request.cookies.get(ACCESS_COOKIE)?.value;
      if (privateToken) await endBrowserAccess(privateToken);
      const sampleToken = request.cookies.get(SESSION_COOKIE)?.value;
      if (sampleToken) {
        try { return clearPrivateSession(json({ workspace: await getWorkspace(sampleToken), notice: "Private session signed out. Your isolated sample is open." }), request); }
        catch (error) { if (!(error instanceof DomainError) || error.code !== "SESSION_EXPIRED") throw error; }
      }
      const sample = await createSession();
      return clearPrivateSession(attachSession(json({ workspace: sample.workspace, notice: "Private session signed out. An isolated sample is open." }), request, sample.token), request);
    }
    let token = sessionToken(request);
    if (command.type === "createCommunity") {
      const sample = token ? null : await createSession();
      token ??= sample!.token;
      const created = await createPrivateCommunity(token, command, key);
      const response = attachPrivateSession(json({ workspace: created.workspace, notice: "Your private community is ready. Create individual invitations to bring people in." }), request, created.token);
      return sample ? attachSession(response, request, sample.token) : response;
    }
    if (!token) throw new DomainError("SESSION_REQUIRED", "Join a private community before managing access.", 401);
    return json(await manageCommunity(token, command, key));
  } catch (error) { return errorResponse(error); }
}
