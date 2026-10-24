import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { DomainError } from "../domain/errors";
import type { ApiError } from "../domain/types";
import { SESSION_COOKIE, SESSION_LIFETIME_SECONDS } from "./service";

export function json<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
}

export function attachSession(response: NextResponse, request: NextRequest, token: string) {
  response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: SESSION_LIFETIME_SECONDS });
  return response;
}

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) {
    throw new DomainError("CROSS_SITE_REQUEST", "Open RELAY directly to make a sample exchange action.", 403);
  }
}

export function errorResponse(error: unknown): NextResponse<ApiError> {
  if (error instanceof DomainError) return json({ error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) } }, error.status);
  if (error instanceof ZodError) return json({ error: { code: "VALIDATION_ERROR", message: "Review the highlighted action fields and try again.", details: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) } }, 400);
  if (error instanceof SyntaxError) return json({ error: { code: "INVALID_JSON", message: "Send one valid JSON command." } }, 400);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  if (code === "23505") return json({ error: { code: "RESERVATION_CONFLICT", message: "A member or exact copy was reserved by another exchange. Refresh the workspace before trying again." } }, 409);
  if (["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "57P01", "53300"].includes(code)) return json({ error: { code: "DATABASE_UNAVAILABLE", message: "PostgreSQL is temporarily unavailable. Your durable sample state is preserved; retry when the database is ready." } }, 503);
  if (code === "42P01" || code === "3F000") return json({ error: { code: "SCHEMA_NOT_READY", message: "The RELAY database schema is not ready. Run the documented migration before starting a session." } }, 503);
  console.error("RELAY request failed", { code, name: error instanceof Error ? error.name : "unknown" });
  return json({ error: { code: "INTERNAL_ERROR", message: "This action could not be completed. No partial exchange allocation was applied. Refresh and retry." } }, 500);
}
