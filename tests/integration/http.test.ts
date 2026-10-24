import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as workspaceGet } from "../../src/app/api/workspace/route";
import { POST as commandPost } from "../../src/app/api/command/route";
import { GET as eventsGet } from "../../src/app/api/events/route";
import type { ApiResult } from "../../src/domain/types";
import { closePool, getPool } from "../../src/server/db";
import { SESSION_COOKIE } from "../../src/server/service";
import { ensureTestSchema } from "./db-fixture";

if (!process.env.DATABASE_URL && existsSync(".env.local")) loadEnvFile(".env.local");
const ownedSessions: string[] = [];
async function open() {
  const response = await workspaceGet(new NextRequest("http://localhost:3101/api/workspace"));
  const body = await response.json() as ApiResult;
  ownedSessions.push(body.workspace.session.id);
  const token = response.cookies.get(SESSION_COOKIE)!.value;
  return { response, body, token };
}
function request(body: unknown, token?: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3101/api/command", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3101", "idempotency-key": randomUUID(), ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}), ...headers }, body: JSON.stringify(body) });
}

beforeAll(ensureTestSchema);
afterEach(async () => {
  if (ownedSessions.length) { await getPool().query("DELETE FROM relay.sessions WHERE id=ANY($1::uuid[])", [[...ownedSessions]]); ownedSessions.length = 0; }
});
afterAll(closePool);

describe("HTTP API with a real durable database", () => {
  it("creates an isolated HTTP-only sample cookie and forbids shared response caching", async () => {
    const { response, body } = await open();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const cookie = response.cookies.get(SESSION_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.path).toBe("/");
    expect(body.workspace.session.dataOrigin).toBe("authored-sample");
    expect(body.workspace.capabilities.outboundMessaging).toBe(false);
  });

  it("validates session scope, strict extra fields, idempotency headers, and request origin", async () => {
    expect((await commandPost(request({ type: "createProposals" }))).status).toBe(401);
    const session = await open();
    const missingKey = request({ type: "createProposals" }, session.token);
    missingKey.headers.delete("idempotency-key");
    expect((await commandPost(missingKey)).status).toBe(400);
    const injected = await commandPost(request({ type: "createProposals", forceReserve: true }, session.token));
    expect(injected.status).toBe(400);
    expect((await injected.json()).error.code).toBe("VALIDATION_ERROR");
    const crossSite = await commandPost(request({ type: "createProposals" }, session.token, { origin: "https://unrelated.example", "sec-fetch-site": "cross-site" }));
    expect(crossSite.status).toBe(403);
    expect((await crossSite.json()).error.code).toBe("CROSS_SITE_REQUEST");
  });

  it("returns authoritative refreshed state, prevents duplicate mutations, and exposes ordered scoped events", async () => {
    const session = await open();
    const key = randomUUID();
    const body = { type: "approve", giveItemId: "item-creative-act-you", receiveItemId: "item-hades-noah", expectedGiveVersion: 1, expectedReceiveVersion: 1 };
    const first = await commandPost(request(body, session.token, { "idempotency-key": key }));
    expect(first.status).toBe(200);
    const replay = await commandPost(request(body, session.token, { "idempotency-key": key }));
    const replayed = await replay.json() as ApiResult;
    expect(replayed.workspace.approvals.filter((approval) => approval.memberId === "you")).toHaveLength(1);
    const proposed = await commandPost(request({ type: "createProposals" }, session.token));
    expect((await proposed.json() as ApiResult).workspace.proposals[0].legs).toHaveLength(3);
    const events = await eventsGet(new NextRequest("http://localhost:3101/api/events?after=0", { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } }));
    expect(events.status).toBe(200);
    const page = await events.json();
    expect(page.nextSequence).toBeGreaterThan(1);
    expect(page.events[0].type).toBe("session.started");
    const unauthenticated = await eventsGet(new NextRequest("http://localhost:3101/api/events"));
    expect(unauthenticated.status).toBe(401);
  });

  it("makes reset a fresh fictional community and returns a structured live configuration error", async () => {
    const session = await open();
    const key = randomUUID();
    const resetCommand = { type: "reset", displayName: "Sample reader" };
    const reset = await commandPost(request(resetCommand, session.token, { "idempotency-key": key }));
    const body = await reset.json() as ApiResult;
    ownedSessions.push(body.workspace.session.id);
    expect(body.workspace.session.id).not.toBe(session.body.workspace.session.id);
    expect(reset.cookies.get(SESSION_COOKIE)?.value).not.toBe(session.token);
    expect(body.workspace.members.find((member) => member.id === "you")?.name).toBe("Sample reader");
    const replayOld = await commandPost(request(resetCommand, session.token, { "idempotency-key": key }));
    expect((await replayOld.json() as ApiResult).workspace.session.id).toBe(body.workspace.session.id);
    const replayNew = await commandPost(request(resetCommand, reset.cookies.get(SESSION_COOKIE)!.value, { "idempotency-key": key }));
    expect((await replayNew.json() as ApiResult).workspace.session.id).toBe(body.workspace.session.id);
    const previous = process.env.QLOO_API_KEY;
    delete process.env.QLOO_API_KEY;
    try {
      const live = await commandPost(request({ type: "discover", mode: "live" }, reset.cookies.get(SESSION_COOKIE)!.value));
      expect(live.status).toBe(503);
      expect((await live.json()).error.code).toBe("MISSING_QLOO_KEY");
    } finally { if (previous !== undefined) process.env.QLOO_API_KEY = previous; }
  });
});
