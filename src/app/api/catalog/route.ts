import type { NextRequest } from "next/server";
import { z } from "zod";
import { DomainError } from "../../../domain/errors";
import { catalogCommandSchema, confirmCatalogCandidate, enqueueCatalogSearch, getCatalogSearch } from "../../../server/catalog-search";
import { dispatchCatalogSearch } from "../../../server/dispatch";
import { assertSameOrigin, errorResponse, json, sessionToken } from "../../../server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireToken(request: NextRequest) {
  const token = sessionToken(request);
  if (!token) throw new DomainError("SESSION_REQUIRED", "Open your community before searching the catalog.", 401);
  return token;
}

export async function GET(request: NextRequest) {
  try {
    const searchId = z.uuid().optional().parse(request.nextUrl.searchParams.get("searchId") ?? undefined);
    return json({ search: await getCatalogSearch(requireToken(request), searchId) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const token = requireToken(request);
    const key = request.headers.get("idempotency-key");
    if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", "Send a valid Idempotency-Key for this catalog action.", 400);
    if (Number(request.headers.get("content-length") ?? 0) > 4096) throw new DomainError("REQUEST_TOO_LARGE", "This catalog request is too large.", 413);
    const body = await request.text();
    if (body.length > 4096) throw new DomainError("REQUEST_TOO_LARGE", "This catalog request is too large.", 413);
    const command = catalogCommandSchema.parse(JSON.parse(body));
    if (command.type === "confirm") return json(await confirmCatalogCandidate(token, command, key));
    const search = await enqueueCatalogSearch(token, command, key);
    if (search.status === "queued") await dispatchCatalogSearch(search.id);
    return json({ search });
  } catch (error) { return errorResponse(error); }
}
