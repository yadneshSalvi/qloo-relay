import type { NextRequest } from "next/server";
import { DomainError } from "../../../domain/errors";
import { errorResponse, json, sessionToken } from "../../../server/http";
import { getEvents } from "../../../server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const token = sessionToken(request);
    if (!token) throw new DomainError("SESSION_REQUIRED", "Open the sample workspace to read its events.", 401);
    const after = Number(new URL(request.url).searchParams.get("after") ?? "0");
    if (!Number.isSafeInteger(after) || after < 0) throw new DomainError("VALIDATION_ERROR", "The event cursor must be a nonnegative integer.", 400);
    return json(await getEvents(token, after));
  } catch (error) { return errorResponse(error); }
}
