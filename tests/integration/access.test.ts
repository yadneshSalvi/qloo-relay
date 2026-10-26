import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as membershipPost } from "../../src/app/api/membership/route";
import { GET as workspaceGet } from "../../src/app/api/workspace/route";
import { POST as commandPost } from "../../src/app/api/command/route";
import type { MembershipCommand } from "../../src/domain/membership";
import type { Command, Workspace } from "../../src/domain/types";
import { closePool, getPool } from "../../src/server/db";
import { createPrivateCommunity, joinPrivateCommunity, listCommunityInvites, manageCommunity } from "../../src/server/membership";
import { ACCESS_COOKIE, createSession, executeCommand, getWorkspace, SESSION_COOKIE } from "../../src/server/service";
import { ensureTestSchema } from "./db-fixture";

if (!process.env.DATABASE_URL && existsSync(".env.local")) loadEnvFile(".env.local");
const ownedSessions: string[] = [];
const command = (token: string, value: Exclude<Command, { type: "startSession" | "reset" }>, key = randomUUID()) => executeCommand(token, value, key);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const createInput = { type: "createCommunity", communityName: "Saturday exchange", displayName: "Alex coordinator", location: "Library foyer · desk", handoffWindow: "31 October 2026, 5–7 pm IST", acceptedRules: true } as const;

async function fresh() {
  const sample = await createSession("Sample guest");
  ownedSessions.push(sample.workspace.session.id);
  const coordinator = await createPrivateCommunity(sample.token, createInput, randomUUID());
  ownedSessions.push(coordinator.workspace.session.id);
  return { sample, coordinator };
}

async function invite(token: string, label: string, role: "member" | "coordinator" = "member") {
  const result = await manageCommunity(token, { type: "createInvite", label, role, expiresInHours: 24 }, randomUUID());
  return result.invite!;
}

async function member(token: string, name: string) {
  const invitation = await invite(token, name);
  return joinPrivateCommunity({ type: "joinCommunity", inviteCode: invitation.code, displayName: name, acceptedRules: true }, randomUUID());
}

async function listing(token: string, workId: string) {
  const result = await command(token, { type: "addItem", workId, edition: "Paperback · English", condition: "good", notes: "Owned and honestly described by this invited guest.", attested: true });
  return result.workspace.items.find((item) => item.ownerId === result.workspace.currentMemberId)!;
}

async function pair() {
  const { sample, coordinator } = await fresh();
  const alice = await member(coordinator.token, "Alice guest");
  const bob = await member(coordinator.token, "Bob guest");
  const a = await listing(alice.token, "work-earthsea");
  const b = await listing(bob.token, "work-piranesi");
  await command(alice.token, { type: "approve", giveItemId: a.id, receiveItemId: b.id, expectedGiveVersion: 1, expectedReceiveVersion: 1 });
  await command(bob.token, { type: "approve", giveItemId: b.id, receiveItemId: a.id, expectedGiveVersion: 1, expectedReceiveVersion: 1 });
  const proposed = await command(coordinator.token, { type: "createProposals" });
  return { sample, coordinator, alice, bob, a, b, proposal: proposed.workspace.proposals[0] };
}

async function reserve(context: Awaited<ReturnType<typeof pair>>) {
  for (const participant of [context.alice, context.bob]) await command(participant.token, { type: "confirm", proposalId: context.proposal.id, memberId: participant.workspace.currentMemberId, expectedVersion: context.proposal.version });
}

function request(path: string, body: unknown, cookies: Record<string, string> = {}, key = randomUUID()) {
  return new NextRequest(`http://localhost:3101/api/${path}`, { method: "POST", headers: { origin: "http://localhost:3101", "content-type": "application/json", "idempotency-key": key, cookie: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ") }, body: JSON.stringify(body) });
}

beforeAll(ensureTestSchema);
afterEach(async () => { if (ownedSessions.length) { await getPool().query("DELETE FROM relay.sessions WHERE id=ANY($1::uuid[])", [[...ownedSessions]]); ownedSessions.length = 0; } });
afterAll(closePool);

describe("private invited community authorization with actual PostgreSQL", () => {
  it("starts empty, preserves the isolated sample, and safely replays community creation", async () => {
    const sample = await createSession();
    ownedSessions.push(sample.workspace.session.id);
    const key = randomUUID();
    const first = await createPrivateCommunity(sample.token, createInput, key);
    ownedSessions.push(first.workspace.session.id);
    const replayOld = await createPrivateCommunity(sample.token, createInput, key);
    const replayNew = await createPrivateCommunity(first.token, createInput, key);
    expect(replayOld.token).toBe(first.token);
    expect(replayNew.workspace.session.id).toBe(first.workspace.session.id);
    expect(first.workspace.session.mode).toBe("private");
    expect(first.workspace.session.canRolePlay).toBe(false);
    expect(first.workspace.items).toHaveLength(0);
    expect(first.workspace.approvals).toHaveLength(0);
    expect(first.workspace.members).toHaveLength(1);
    expect(first.workspace.access.role).toBe("coordinator");
    expect(first.workspace.terms.handoffWindow).not.toContain("sample");
    expect((await getWorkspace(sample.token)).items).toHaveLength(16);
    await expect(createPrivateCommunity(sample.token, { ...createInput, communityName: "Different event" }, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("uses a single invitation once, replays only its exact join, and never stores raw capabilities", async () => {
    const { coordinator } = await fresh();
    const invitation = await invite(coordinator.token, "Intended participant");
    const key = randomUUID();
    const action = { type: "joinCommunity", inviteCode: invitation.code, displayName: "Chosen guest name", acceptedRules: true } as const;
    const joined = await joinPrivateCommunity(action, key);
    expect((await joinPrivateCommunity(action, key)).token).toBe(joined.token);
    await expect(joinPrivateCommunity(action, randomUUID())).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
    await expect(joinPrivateCommunity({ ...action, displayName: "Another person" }, key)).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
    const stored = (await getPool().query<{ token_hash: string }>("SELECT token_hash FROM relay.community_invites WHERE id=$1 UNION ALL SELECT token_hash FROM relay.access_sessions WHERE session_id=$2", [invitation.id, coordinator.workspace.session.id])).rows;
    expect(stored.some((row) => row.token_hash === digest(invitation.code))).toBe(true);
    expect(stored.some((row) => row.token_hash === digest(joined.token))).toBe(true);
    expect(stored.every((row) => row.token_hash !== joined.token && row.token_hash !== invitation.code)).toBe(true);
    const publicManagement = JSON.stringify(await listCommunityInvites(coordinator.token));
    expect(publicManagement).not.toContain(invitation.code);
    expect(publicManagement).not.toContain(joined.token);
    expect(joined.workspace.members.find((entry) => entry.isYou)?.name).toBe("Chosen guest name");
    expect(joined.workspace.currentMemberId).not.toBe(coordinator.workspace.currentMemberId);
  });

  it("serializes simultaneous joins and rejects revoked or expired invitations", async () => {
    const { coordinator } = await fresh();
    const contested = await invite(coordinator.token, "Contested invitation");
    const results = await Promise.allSettled(["First guest", "Second guest"].map((displayName) => joinPrivateCommunity({ type: "joinCommunity", inviteCode: contested.code, displayName, acceptedRules: true }, randomUUID())));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const revoked = await invite(coordinator.token, "Revoked invitation");
    await manageCommunity(coordinator.token, { type: "revokeInvite", inviteId: revoked.id }, randomUUID());
    await expect(joinPrivateCommunity({ type: "joinCommunity", inviteCode: revoked.code, displayName: "Guest", acceptedRules: true }, randomUUID())).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
    const expired = await invite(coordinator.token, "Expired invitation");
    await getPool().query("UPDATE relay.community_invites SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1", [expired.id]);
    await expect(joinPrivateCommunity({ type: "joinCommunity", inviteCode: expired.code, displayName: "Guest", acceptedRules: true }, randomUUID())).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
  });

  it("isolates each member’s preferences, saved copies, dismissals, and idempotency scope", async () => {
    const { coordinator } = await fresh();
    const alice = await member(coordinator.token, "Alice guest");
    const bob = await member(coordinator.token, "Bob guest");
    const copy = await listing(bob.token, "work-earthsea");
    const sameKey = randomUUID();
    await command(alice.token, { type: "preferences", seedWorkIds: ["work-hades"], novelty: 100 }, sameKey);
    await command(bob.token, { type: "preferences", seedWorkIds: ["work-creative-act"], novelty: 0 }, sameKey);
    await command(alice.token, { type: "saveItem", itemId: copy.id });
    await command(alice.token, { type: "dismiss", itemId: copy.id, reason: "Not for my shelf today" });
    const aw = await getWorkspace(alice.token);
    const bw = await getWorkspace(bob.token);
    const cw = await getWorkspace(coordinator.token);
    expect(aw.preferences.seedWorkIds).toEqual(["work-hades"]);
    expect(bw.preferences.seedWorkIds).toEqual(["work-creative-act"]);
    expect(cw.preferences.seedWorkIds).toEqual([]);
    expect(aw.savedItemIds).toEqual([copy.id]);
    expect(bw.savedItemIds).toEqual([]);
    expect(aw.dismissals).toHaveLength(1);
    expect(bw.dismissals).toHaveLength(0);
    expect(aw.evidence.filter((entry) => entry.kind === "preferences")).toHaveLength(1);
    expect(cw.evidence.filter((entry) => entry.kind === "preferences")).toHaveLength(0);
    expect(JSON.stringify(aw.evidence.filter((entry) => entry.kind === "preferences"))).not.toContain("work-creative-act");
    await expect(command(alice.token, { type: "discover", mode: "sample" })).rejects.toMatchObject({ code: "SAMPLE_ONLY" });
  });

  it("accepts a visible custom work beyond the starter catalog and shares it only with an explicit listing", async () => {
    const { coordinator } = await fresh();
    const alice = await member(coordinator.token, "Alice catalog guest");
    const bob = await member(coordinator.token, "Bob catalog guest");
    const elsewhere = await fresh();
    const outsider = await member(elsewhere.coordinator.token, "Another community guest");
    const id = `work-${randomUUID()}`;
    const work = { ...alice.workspace.works[0], id, title: "Isolated custom-work test fixture", mappingStatus: "unresolved", qlooEntityId: null, dataOrigin: "participant-recorded" };
    await getPool().query("INSERT INTO relay.catalog_works(id,data,session_id,created_by_member_id,visibility) VALUES($1,$2,$3,$4,'private')", [id, work, coordinator.workspace.session.id, alice.workspace.currentMemberId]);
    expect((await getWorkspace(alice.token)).works.some((entry) => entry.id === id)).toBe(true);
    expect((await getWorkspace(bob.token)).works.some((entry) => entry.id === id)).toBe(false);
    expect((await getWorkspace(coordinator.token)).works.some((entry) => entry.id === id)).toBe(false);
    expect((await getWorkspace(outsider.token)).works.some((entry) => entry.id === id)).toBe(false);
    const savedTaste = await command(alice.token, { type: "preferences", seedWorkIds: [id], novelty: 50 });
    expect(savedTaste.workspace.preferences.seedWorkIds).toEqual([id]);
    await expect(command(bob.token, { type: "preferences", seedWorkIds: [id], novelty: 50 })).rejects.toMatchObject({ code: "UNKNOWN_REFERENCE" });
    const listingCommand = { type: "addItem", workId: id, edition: "English paperback test edition", condition: "good", notes: "A deliberately isolated custom listing fixture.", attested: false } as const;
    await expect(command(alice.token, listingCommand)).rejects.toMatchObject({ code: "OWNERSHIP_ATTESTATION_REQUIRED" });
    expect((await getWorkspace(bob.token)).works.some((entry) => entry.id === id)).toBe(false);
    await expect(command(bob.token, { ...listingCommand, attested: true })).rejects.toMatchObject({ code: "WORK_NOT_FOUND" });
    await command(alice.token, { ...listingCommand, attested: true });
    expect((await getWorkspace(bob.token)).works.some((entry) => entry.id === id)).toBe(true);
    expect((await getWorkspace(coordinator.token)).works.some((entry) => entry.id === id)).toBe(true);
    expect((await getWorkspace(outsider.token)).works.some((entry) => entry.id === id)).toBe(false);
    await expect(command(outsider.token, { ...listingCommand, attested: true })).rejects.toMatchObject({ code: "WORK_NOT_FOUND" });
  });

  it("rejects supplied-member impersonation, foreign inventory edits, and cross-community targets", async () => {
    const context = await pair();
    const { alice, bob, a, b, proposal, coordinator } = context;
    await expect(command(alice.token, { type: "confirm", proposalId: proposal.id, memberId: bob.workspace.currentMemberId, expectedVersion: 1 })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(command(alice.token, { type: "withdraw", proposalId: proposal.id, memberId: bob.workspace.currentMemberId, reason: "I am pretending to be another member" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(command(alice.token, { type: "updateItem", itemId: b.id, expectedVersion: 1, notes: "Unauthorized edit" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(command(alice.token, { type: "approve", giveItemId: b.id, receiveItemId: a.id, expectedGiveVersion: 1, expectedReceiveVersion: 1 })).rejects.toMatchObject({ code: "INVALID_OWNERSHIP" });
    const bobApproval = (await getWorkspace(bob.token)).approvals.find((entry) => entry.memberId === bob.workspace.currentMemberId)!;
    await expect(command(alice.token, { type: "revokeApproval", approvalId: bobApproval.id, reason: "Unauthorized revocation" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await fresh();
    const outsider = await member(other.coordinator.token, "Outside guest");
    await expect(command(outsider.token, { type: "updateItem", itemId: a.id, expectedVersion: 1, notes: "Cross-community mutation" })).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
    expect((await getWorkspace(coordinator.token)).proposals[0].legs.every((leg) => !leg.confirmed)).toBe(true);
    expect((await getWorkspace(alice.token)).items.find((item) => item.id === b.id)?.notes).toBe(b.notes);
  });

  it("separates coordinator operations from participant consent and completes only an inspected set", async () => {
    const context = await pair();
    const { coordinator, alice, proposal, a, b } = context;
    await expect(command(coordinator.token, { type: "confirm", proposalId: proposal.id, memberId: alice.workspace.currentMemberId, expectedVersion: 1 })).rejects.toMatchObject({ code: "PARTICIPANT_REQUIRED" });
    await expect(command(coordinator.token, { type: "addItem", workId: "work-earthsea", edition: "Coordinator pretend listing", condition: "good", notes: "Not allowed", attested: true })).rejects.toMatchObject({ code: "PARTICIPANT_REQUIRED" });
    await expect(manageCommunity(alice.token, { type: "createInvite", label: "Privilege escalation", role: "coordinator", expiresInHours: 24 }, randomUUID())).rejects.toMatchObject({ code: "COORDINATOR_REQUIRED" });
    await reserve(context);
    expect((await getWorkspace(alice.token)).proposals[0].status).toBe("reserved");
    await expect(command(alice.token, { type: "receive", proposalId: proposal.id, itemId: a.id, conditionAccepted: true })).rejects.toMatchObject({ code: "COORDINATOR_REQUIRED" });
    await expect(command(alice.token, { type: "complete", proposalId: proposal.id })).rejects.toMatchObject({ code: "COORDINATOR_REQUIRED" });
    await command(coordinator.token, { type: "receive", proposalId: proposal.id, itemId: a.id, conditionAccepted: true });
    await expect(command(coordinator.token, { type: "complete", proposalId: proposal.id })).rejects.toMatchObject({ code: "HANDOFF_INCOMPLETE" });
    const inspected = await command(coordinator.token, { type: "receive", proposalId: proposal.id, itemId: b.id, conditionAccepted: true });
    expect(inspected.workspace.proposals[0].receipts.every((receipt) => receipt.inspectorId === coordinator.workspace.currentMemberId)).toBe(true);
    const done = await command(coordinator.token, { type: "complete", proposalId: proposal.id });
    expect(done.workspace.proposals[0].status).toBe("completed");
    expect(done.workspace.evidence.find((entry) => entry.kind === "release")?.source).toBe("participant-recorded");
    expect(done.workspace.evidence.find((entry) => entry.kind === "release")?.details).toMatchObject({ independentlyObserved: false, rolePlayed: false });
  });

  it("revokes member access, approvals, and unreceived reservations atomically", async () => {
    const context = await pair();
    await reserve(context);
    const result = await manageCommunity(context.coordinator.token, { type: "revokeMember", memberId: context.alice.workspace.currentMemberId, reason: "Membership ended before the handoff" }, randomUUID());
    expect(result.workspace.proposals[0].status).toBe("withdrawn");
    expect(result.workspace.items.find((item) => item.id === context.a.id)?.state).toBe("withdrawn");
    expect(result.workspace.items.find((item) => item.id === context.b.id)?.state).toBe("available");
    expect(result.workspace.approvals.filter((entry) => entry.memberId === context.alice.workspace.currentMemberId).every((entry) => entry.status === "revoked")).toBe(true);
    expect(result.workspace.stats.activeApprovals).toBe(0);
    await expect(getWorkspace(context.alice.token)).rejects.toMatchObject({ code: "ACCESS_REVOKED" });
    await expect(command(context.alice.token, { type: "createProposals" })).rejects.toMatchObject({ code: "ACCESS_REVOKED" });
    expect((await getWorkspace(context.bob.token)).currentMemberId).toBe(context.bob.workspace.currentMemberId);
  });

  it("keeps a whole exchange frozen when membership is revoked after physical receipt", async () => {
    const context = await pair();
    await reserve(context);
    await command(context.coordinator.token, { type: "receive", proposalId: context.proposal.id, itemId: context.a.id, conditionAccepted: true });
    const result = await manageCommunity(context.coordinator.token, { type: "revokeMember", memberId: context.alice.workspace.currentMemberId, reason: "Access ended after coordinator receipt" }, randomUUID());
    expect(result.workspace.proposals[0]).toMatchObject({ status: "disputed", disputeKind: "custody" });
    const holds = await getPool().query("SELECT 1 FROM relay.item_reservations WHERE session_id=$1 AND state='active'", [context.coordinator.workspace.session.id]);
    expect(holds.rowCount).toBe(2);
    expect(result.workspace.proposals[0].receipts.every((receipt) => !receipt.releasedAt)).toBe(true);
    await expect(command(context.coordinator.token, { type: "complete", proposalId: context.proposal.id })).rejects.toMatchObject({ code: "HANDOFF_INCOMPLETE" });
    await expect(command(context.coordinator.token, { type: "receive", proposalId: context.proposal.id, itemId: context.b.id, conditionAccepted: true })).rejects.toMatchObject({ code: "HANDOFF_NOT_READY" });
  });

  it("revokes a delegated coordinator’s unspent invitation capabilities with their membership", async () => {
    const { coordinator } = await fresh();
    const delegation = await invite(coordinator.token, "Another desk coordinator", "coordinator");
    const delegated = await joinPrivateCommunity({ type: "joinCommunity", inviteCode: delegation.code, displayName: "Delegated coordinator", acceptedRules: true }, randomUUID());
    const unspent = await invite(delegated.token, "Unspent coordinator invitation", "coordinator");
    await manageCommunity(coordinator.token, { type: "revokeMember", memberId: delegated.workspace.currentMemberId, reason: "Coordinator responsibility ended" }, randomUUID());
    await expect(getWorkspace(delegated.token)).rejects.toMatchObject({ code: "ACCESS_REVOKED" });
    await expect(joinPrivateCommunity({ type: "joinCommunity", inviteCode: unspent.code, displayName: "Cannot regain access", acceptedRules: true }, randomUUID())).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
    await expect(manageCommunity(coordinator.token, { type: "revokeMember", memberId: coordinator.workspace.currentMemberId, reason: "Attempting to remove the final coordinator" }, randomUUID())).rejects.toMatchObject({ code: "CANNOT_REVOKE_SELF" });
  });

  it("uses an HttpOnly private cookie with actor scope, strict commands, and fail-closed revocation", async () => {
    const { sample, coordinator } = await fresh();
    const invitation = await invite(coordinator.token, "HTTP invited guest");
    const joined = await membershipPost(request("membership", { type: "joinCommunity", inviteCode: invitation.code, displayName: "HTTP guest", acceptedRules: true }, { [SESSION_COOKIE]: sample.token }));
    expect(joined.status).toBe(200);
    const credential = joined.cookies.get(ACCESS_COOKIE)!;
    expect(credential.httpOnly).toBe(true);
    expect(credential.sameSite).toBe("lax");
    expect(credential.path).toBe("/");
    const body = await joined.json() as { workspace: Workspace };
    expect(JSON.stringify(body)).not.toContain(credential.value);
    const cookies = { [SESSION_COOKIE]: sample.token, [ACCESS_COOKIE]: credential.value };
    const query = new NextRequest("http://localhost:3101/api/workspace", { headers: { cookie: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ") } });
    expect((await (await workspaceGet(query)).json()).workspace.currentMemberId).toBe(body.workspace.currentMemberId);
    const injected = await commandPost(request("command", { type: "addItem", memberId: coordinator.workspace.currentMemberId, workId: "work-earthsea", edition: "Illegal injected owner", condition: "good", notes: "No", attested: true }, cookies));
    expect(injected.status).toBe(400);
    const reset = await commandPost(request("command", { type: "reset" }, cookies));
    expect(reset.status).toBe(403);
    const crossOrigin = request("membership", { type: "leaveBrowser" }, cookies);
    crossOrigin.headers.set("origin", "https://unrelated.example");
    expect((await membershipPost(crossOrigin)).status).toBe(403);
    const forged = { type: "createInvite", label: "Forged coordinator", role: "coordinator", expiresInHours: 24 } satisfies MembershipCommand;
    expect((await membershipPost(request("membership", forged, cookies))).status).toBe(403);
    await manageCommunity(coordinator.token, { type: "revokeMember", memberId: body.workspace.currentMemberId, reason: "Testing revoked HTTP browser access" }, randomUUID());
    const revoked = await workspaceGet(query);
    expect(revoked.status).toBe(401);
    expect((await revoked.json()).error.code).toBe("ACCESS_REVOKED");
    const left = await membershipPost(request("membership", { type: "leaveBrowser" }, cookies));
    expect(left.status).toBe(200);
    expect(left.cookies.get(ACCESS_COOKIE)?.maxAge).toBe(0);
    expect((await left.json()).workspace.session.id).toBe(sample.workspace.session.id);
  });
});
