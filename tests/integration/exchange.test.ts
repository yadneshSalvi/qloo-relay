import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { enumerateCycles, type FeasibleCycle } from "../../src/domain/solver";
import type { Command, Proposal, Workspace } from "../../src/domain/types";
import { closePool, getPool, withTransaction } from "../../src/server/db";
import { createSession, executeCommand, getEvents, getWorkspace } from "../../src/server/service";
import { ensureTestSchema } from "./db-fixture";

if (!process.env.DATABASE_URL && existsSync(".env.local")) loadEnvFile(".env.local");
const ownedSessions: string[] = [];
type Mutation = Exclude<Command, { type: "startSession" | "reset" }>;

async function fresh() {
  const session = await createSession("Integration reader");
  ownedSessions.push(session.workspace.session.id);
  return session;
}
const command = (token: string, value: Mutation, key = randomUUID()) => executeCommand(token, value, key);
async function primary() {
  const session = await fresh();
  await command(session.token, { type: "approve", giveItemId: "item-creative-act-you", receiveItemId: "item-hades-noah", expectedGiveVersion: 1, expectedReceiveVersion: 1 });
  const result = await command(session.token, { type: "createProposals" });
  return { ...session, workspace: result.workspace, proposal: result.workspace.proposals.find((proposal) => proposal.status === "proposed")! };
}
async function confirmAll(token: string, proposal: Proposal, except?: string) {
  let workspace: Workspace | undefined;
  for (const leg of proposal.legs.filter((entry) => entry.memberId !== except)) workspace = (await command(token, { type: "confirm", proposalId: proposal.id, memberId: leg.memberId, expectedVersion: proposal.version })).workspace;
  return workspace ?? getWorkspace(token);
}
async function stageProposal(workspace: Workspace, cycle: FeasibleCycle) {
  const id = randomUUID();
  await withTransaction(async (client) => {
    await client.query("SELECT id FROM relay.sessions WHERE id=$1 FOR UPDATE", [workspace.session.id]);
    await client.query("INSERT INTO relay.proposals(session_id,id,version,fingerprint,status,terms,expires_at) VALUES($1,$2,1,$3,'proposed',$4,$5)", [workspace.session.id, id, `test-${id}`, workspace.terms, new Date(Date.now() + 3600000)]);
    for (const [ordinal, leg] of cycle.approvals.entries()) await client.query("INSERT INTO relay.proposal_legs(session_id,proposal_id,member_id,ordinal,give_item_id,receive_item_id,approval_id,give_version,receive_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [workspace.session.id, id, leg.memberId, ordinal, leg.giveItemId, leg.receiveItemId, leg.id, leg.giveVersion, leg.receiveVersion]);
  });
  return (await getPool().query<{ id: string }>("SELECT id FROM relay.proposals WHERE session_id=$1 AND id=$2", [workspace.session.id, id])).rows[0].id;
}

/** A real PostgreSQL lock barrier establishes both commit orders without timing assumptions. */
async function raceInOrder<T, U>(sessionId: string, first: () => Promise<T>, second: () => Promise<U>) {
  const blocker = await getPool().connect();
  const waitForBlocked = async (count: number) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await getPool().query<{ count: string }>("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM relay.sessions WHERE token_hash=%'");
      if (Number(result.rows[0].count) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("PostgreSQL concurrency barrier did not observe both blocked transactions.");
  };
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM relay.sessions WHERE id=$1 FOR UPDATE", [sessionId]);
    const firstResult = first();
    // Attach rejection handlers immediately; both promises may reject after the barrier opens.
    const firstSettled = firstResult.then((value) => ({ status: "fulfilled" as const, value }), (reason: unknown) => ({ status: "rejected" as const, reason }));
    await waitForBlocked(1);
    const secondResult = second();
    const secondSettled = secondResult.then((value) => ({ status: "fulfilled" as const, value }), (reason: unknown) => ({ status: "rejected" as const, reason }));
    await waitForBlocked(2);
    await blocker.query("COMMIT");
    return await Promise.all([firstSettled, secondSettled]);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
}

beforeAll(ensureTestSchema);
afterEach(async () => {
  if (ownedSessions.length) {
    await getPool().query("DELETE FROM relay.sessions WHERE id=ANY($1::uuid[])", [[...ownedSessions]]);
    ownedSessions.length = 0;
  }
});
afterAll(closePool);

describe("durable sample exchange on actual PostgreSQL", () => {
  it("isolates every cookie community and preserves state across connection-pool restart", async () => {
    const a = await fresh();
    const b = await fresh();
    expect(a.workspace.session.id).not.toBe(b.workspace.session.id);
    await command(a.token, { type: "saveItem", itemId: "item-hades-noah" });
    expect((await getWorkspace(b.token)).savedItemIds).toEqual([]);
    await closePool();
    expect((await getWorkspace(a.token)).savedItemIds).toEqual(["item-hades-noah"]);
    await expect(getWorkspace(a.workspace.session.id)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("keeps authored discovery, saved interest, and exact human action distinct", async () => {
    const session = await fresh();
    const initial = await command(session.token, { type: "createProposals" });
    expect(initial.workspace.proposals).toHaveLength(0);
    const discovered = await command(session.token, { type: "discover" });
    expect(discovered.workspace.discovery?.source).toBe("authored-sample");
    expect(discovered.workspace.discovery?.suggestions[0].itemId).toBe("item-hades-noah");
    expect(discovered.workspace.approvals.every((approval) => approval.authored)).toBe(true);
    await command(session.token, { type: "saveItem", itemId: "item-hades-noah" });
    const saved = await command(session.token, { type: "createProposals" });
    expect(saved.workspace.proposals).toHaveLength(0);
    await command(session.token, { type: "dismiss", itemId: "item-hades-noah", reason: "Not for this copy" });
    const dismissed = await command(session.token, { type: "discover" });
    expect(dismissed.workspace.discovery?.suggestions.some((entry) => entry.itemId === "item-hades-noah")).toBe(false);
    const before = dismissed.workspace.approvals.length;
    await command(session.token, { type: "preferences", seedWorkIds: ["work-in-rainbows"], novelty: 90 });
    const changed = await command(session.token, { type: "discover" });
    expect(changed.workspace.discovery?.preferenceVersion).toBe(2);
    expect(changed.workspace.discovery?.suggestions[0].itemId).not.toBe("item-hades-noah");
    expect(changed.workspace.approvals).toHaveLength(before);
  });

  it("makes a three-member cycle only from exact approval, then requires every confirmation", async () => {
    const session = await primary();
    expect(session.proposal.legs).toHaveLength(3);
    expect(new Set(session.proposal.legs.map((leg) => leg.memberId))).toEqual(new Set(["you", "maya", "noah"]));
    await expect(command(session.token, { type: "confirm", proposalId: session.proposal.id, memberId: "iris", expectedVersion: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(command(session.token, { type: "confirm", proposalId: session.proposal.id, memberId: "you", expectedVersion: 2 })).rejects.toMatchObject({ code: "STALE_PROPOSAL_VERSION" });
    const partial = await confirmAll(session.token, session.proposal, "maya");
    expect(partial.proposals[0].status).toBe("proposed");
    expect(partial.items.filter((item) => item.state === "reserved")).toHaveLength(0);
    const final = await command(session.token, { type: "confirm", proposalId: session.proposal.id, memberId: "maya", expectedVersion: 1 });
    expect(final.workspace.proposals[0].status).toBe("reserved");
    expect(final.workspace.items.filter((item) => item.state === "reserved")).toHaveLength(3);
    expect(final.workspace.stats.completedCycles).toBe(0);
    const holds = await getPool().query("SELECT * FROM relay.member_reservations WHERE session_id=$1 AND state='active'", [session.workspace.session.id]);
    expect(holds.rows).toHaveLength(3);
  });

  it("replays concurrent idempotency keys once and rejects reuse for another action", async () => {
    const session = await fresh();
    const key = randomUUID();
    const add: Mutation = { type: "addItem", workId: "work-earthsea", edition: "Paperback · English", condition: "good", notes: "A second physical copy", attested: true };
    const results = await Promise.all([command(session.token, add, key), command(session.token, add, key)]);
    expect(results[0].workspace.items).toHaveLength(17);
    expect(results[1].workspace.items).toHaveLength(17);
    expect(results[1].workspace.events.filter((entry) => entry.type === "item.listed")).toHaveLength(1);
    await expect(command(session.token, { type: "saveItem", itemId: "item-hades-noah" }, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rejects wrong ownership, missing attestation, stale copies, and changed exact terms", async () => {
    const session = await primary();
    await expect(command(session.token, { type: "approve", giveItemId: "item-hades-noah", receiveItemId: "item-creative-act-you", expectedGiveVersion: 1, expectedReceiveVersion: 1 })).rejects.toMatchObject({ code: "INVALID_OWNERSHIP" });
    await expect(command(session.token, { type: "addItem", workId: "work-earthsea", edition: "Paperback", condition: "good", notes: "", attested: false })).rejects.toMatchObject({ code: "OWNERSHIP_ATTESTATION_REQUIRED" });
    await getPool().query("UPDATE relay.approvals SET terms_hash='changed' WHERE session_id=$1 AND member_id='you'", [session.workspace.session.id]);
    await expect(command(session.token, { type: "confirm", proposalId: session.proposal.id, memberId: "you", expectedVersion: 1 })).rejects.toMatchObject({ code: "STALE_TERMS" });
    await command(session.token, { type: "updateItem", itemId: "item-creative-act-you", expectedVersion: 1, condition: "fair" });
    await expect(command(session.token, { type: "approve", giveItemId: "item-creative-act-you", receiveItemId: "item-hades-noah", expectedGiveVersion: 1, expectedReceiveVersion: 1 })).rejects.toMatchObject({ code: "STALE_ITEM_VERSION" });
    expect((await getWorkspace(session.token)).proposals[0].status).toBe("invalidated");
  });

  it("rechecks membership before reservation and blocks cross-session proposal access", async () => {
    const session = await primary();
    const other = await fresh();
    await expect(command(other.token, { type: "confirm", proposalId: session.proposal.id, memberId: "you", expectedVersion: 1 })).rejects.toMatchObject({ code: "PROPOSAL_NOT_FOUND" });
    await getPool().query("UPDATE relay.members SET active=false WHERE session_id=$1 AND id='maya'", [session.workspace.session.id]);
    await expect(command(session.token, { type: "confirm", proposalId: session.proposal.id, memberId: "you", expectedVersion: 1 })).rejects.toMatchObject({ code: "MEMBERSHIP_INACTIVE" });
  });

  it("races competing final confirmations and reserves exactly one complete cycle", async () => {
    const session = await primary();
    const alternative = enumerateCycles({ items: session.workspace.items, approvals: session.workspace.approvals, termsHash: session.workspace.terms.hash, now: new Date() }).find((cycle) => cycle.memberIds.length === 2)!;
    const alternateId = await stageProposal(session.workspace, alternative);
    await confirmAll(session.token, session.proposal, "maya");
    await command(session.token, { type: "confirm", proposalId: alternateId, memberId: "you", expectedVersion: 1 });
    const results = await Promise.allSettled([
      command(session.token, { type: "confirm", proposalId: session.proposal.id, memberId: "maya", expectedVersion: 1 }),
      command(session.token, { type: "confirm", proposalId: alternateId, memberId: "noah", expectedVersion: 1 }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const workspace = await getWorkspace(session.token);
    expect(workspace.proposals.filter((proposal) => proposal.status === "reserved")).toHaveLength(1);
    const duplicateItems = await getPool().query("SELECT item_id FROM relay.item_reservations WHERE session_id=$1 AND state='active' GROUP BY item_id HAVING count(*)>1", [workspace.session.id]);
    const duplicateMembers = await getPool().query("SELECT member_id FROM relay.member_reservations WHERE session_id=$1 AND state='active' GROUP BY member_id HAVING count(*)>1", [workspace.session.id]);
    expect(duplicateItems.rows).toEqual([]);
    expect(duplicateMembers.rows).toEqual([]);
    expect(workspace.events.filter((entry) => entry.type === "proposal.reserved")).toHaveLength(1);
  });

  it("rolls back earlier item/member holds and the final confirmation when a later unique constraint fails", async () => {
    const session = await primary();
    const alternative = enumerateCycles({ items: session.workspace.items, approvals: session.workspace.approvals, termsHash: session.workspace.terms.hash, now: new Date() }).find((cycle) => cycle.memberIds.length === 2)!;
    const alternateId = await stageProposal(session.workspace, alternative);
    await confirmAll(session.token, session.proposal, "maya");
    await getPool().query("INSERT INTO relay.item_reservations(session_id,proposal_id,item_id,state,expires_at) VALUES($1,$2,'item-hades-noah','active',$3)", [session.workspace.session.id, alternateId, new Date(Date.now() + 3600000)]);
    await expect(command(session.token, { type: "confirm", proposalId: session.proposal.id, memberId: "maya", expectedVersion: 1 })).rejects.toMatchObject({ code: "23505" });
    const holds = await getPool().query("SELECT * FROM relay.item_reservations WHERE session_id=$1 AND proposal_id=$2", [session.workspace.session.id, session.proposal.id]);
    expect(holds.rows).toHaveLength(0);
    const members = await getPool().query("SELECT * FROM relay.member_reservations WHERE session_id=$1 AND proposal_id=$2", [session.workspace.session.id, session.proposal.id]);
    expect(members.rows).toHaveLength(0);
    const refreshed = await getWorkspace(session.token);
    expect(refreshed.proposals.find((proposal) => proposal.id === session.proposal.id)?.legs.find((leg) => leg.memberId === "maya")?.confirmed).toBe(false);
  });

  it("uses a database constraint to prevent overlap for different copies owned by one member", async () => {
    const session = await primary();
    const extra = await command(session.token, { type: "approve", giveItemId: "item-kind-of-blue-you", receiveItemId: "item-braiding-sweetgrass-leila", expectedGiveVersion: 1, expectedReceiveVersion: 1 });
    const alternative = enumerateCycles({ items: extra.workspace.items, approvals: extra.workspace.approvals, termsHash: extra.workspace.terms.hash, now: new Date() }).find((cycle) => cycle.memberIds.length === 2 && cycle.itemIds.includes("item-kind-of-blue-you"))!;
    const alternateId = await stageProposal(extra.workspace, alternative);
    await confirmAll(session.token, session.proposal);
    await expect(getPool().query("INSERT INTO relay.member_reservations(session_id,proposal_id,member_id,state,expires_at) VALUES($1,$2,'you','active',$3)", [session.workspace.session.id, alternateId, new Date(Date.now() + 3600000)])).rejects.toMatchObject({ code: "23505", constraint: "one_active_member_reservation" });
  });

  for (const withdrawalFirst of [true, false]) it(`serializes approval withdrawal and final confirmation (${withdrawalFirst ? "withdrawal" : "confirmation"} commits first)`, async () => {
    const session = await primary();
    await confirmAll(session.token, session.proposal, "maya");
    const approval = session.workspace.approvals.find((entry) => entry.memberId === "you")!;
    const withdraw = () => command(session.token, { type: "revokeApproval", approvalId: approval.id, reason: "Changed my mind" });
    const final = () => command(session.token, { type: "confirm", proposalId: session.proposal.id, memberId: "maya", expectedVersion: 1 });
    const results = await raceInOrder(session.workspace.session.id, withdrawalFirst ? withdraw : final, withdrawalFirst ? final : withdraw);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe(withdrawalFirst ? "rejected" : "fulfilled");
    const workspace = await getWorkspace(session.token);
    expect(workspace.proposals.find((proposal) => proposal.id === session.proposal.id)?.status).toBe("withdrawn");
    expect(workspace.items.some((item) => item.state === "reserved")).toBe(false);
    expect(workspace.events.some((entry) => entry.type === "proposal.reserved")).toBe(!withdrawalFirst);
  });

  for (const withdrawalFirst of [true, false]) it(`serializes item withdrawal and final confirmation (${withdrawalFirst ? "withdrawal" : "confirmation"} commits first)`, async () => {
    const session = await primary();
    await confirmAll(session.token, session.proposal, "maya");
    const withdraw = () => command(session.token, { type: "withdrawItem", itemId: "item-creative-act-you", expectedVersion: 1, reason: "Cannot bring this copy" });
    const final = () => command(session.token, { type: "confirm", proposalId: session.proposal.id, memberId: "maya", expectedVersion: 1 });
    const results = await raceInOrder(session.workspace.session.id, withdrawalFirst ? withdraw : final, withdrawalFirst ? final : withdraw);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe(withdrawalFirst ? "rejected" : "fulfilled");
    const workspace = await getWorkspace(session.token);
    expect(workspace.items.find((item) => item.id === "item-creative-act-you")?.state).toBe("withdrawn");
    expect(workspace.items.some((item) => item.state === "reserved")).toBe(false);
  });

  it("repairs after Maya withdraws using existing alternate approval and fresh confirmation", async () => {
    const session = await primary();
    await confirmAll(session.token, session.proposal);
    const withdrawn = await command(session.token, { type: "withdraw", proposalId: session.proposal.id, memberId: "maya", reason: "Cannot attend" });
    expect(withdrawn.workspace.items.some((item) => item.state === "reserved")).toBe(false);
    const result = await command(session.token, { type: "retryRepair", proposalId: session.proposal.id });
    const repaired = result.workspace.proposals.find((proposal) => proposal.repairOf === session.proposal.id)!;
    expect(repaired.legs).toHaveLength(2);
    expect(repaired.legs.every((leg) => !leg.confirmed)).toBe(true);
    expect(repaired.legs.map((leg) => leg.memberId).sort()).toEqual(["noah", "you"]);
    expect(repaired.status).toBe("proposed");
    const confirmed = await confirmAll(session.token, repaired);
    expect(confirmed.proposals.find((proposal) => proposal.id === repaired.id)?.status).toBe("reserved");
  });

  it("expires an unreceived reservation without relisting copies already in hub custody", async () => {
    const session = await primary();
    await confirmAll(session.token, session.proposal);
    await getPool().query("UPDATE relay.proposals SET expires_at=now()-interval '1 second' WHERE session_id=$1 AND id=$2", [session.workspace.session.id, session.proposal.id]);
    const expired = await getWorkspace(session.token);
    expect(expired.proposals[0].status).toBe("expired");
    expect(expired.items.some((item) => item.state === "reserved")).toBe(false);
    const replacement = (await command(session.token, { type: "retryRepair", proposalId: session.proposal.id })).workspace.proposals.find((proposal) => proposal.status === "proposed")!;
    await confirmAll(session.token, replacement);
    await command(session.token, { type: "receive", proposalId: replacement.id, itemId: replacement.legs[0].giveItemId, conditionAccepted: true });
    await getPool().query("UPDATE relay.proposals SET expires_at=now()-interval '1 second' WHERE session_id=$1 AND id=$2", [session.workspace.session.id, replacement.id]);
    const frozen = await getWorkspace(session.token);
    expect(frozen.proposals.find((proposal) => proposal.id === replacement.id)?.status).toBe("disputed");
    expect(frozen.items.find((item) => item.id === replacement.legs[0].giveItemId)?.state).toBe("at_hub");
    expect(frozen.items.filter((item) => item.heldByProposalId === replacement.id)).toHaveLength(3);
  });

  it("blocks release until every copy passes inspection, audits reinspection, then completes atomically", async () => {
    const session = await primary();
    await confirmAll(session.token, session.proposal);
    await expect(command(session.token, { type: "complete", proposalId: session.proposal.id })).rejects.toMatchObject({ code: "HANDOFF_INCOMPLETE" });
    const [first, ...rest] = session.proposal.legs;
    const rejected = await command(session.token, { type: "receive", proposalId: session.proposal.id, itemId: first.giveItemId, conditionAccepted: false });
    expect(rejected.workspace.proposals[0].status).toBe("disputed");
    await expect(command(session.token, { type: "complete", proposalId: session.proposal.id })).rejects.toMatchObject({ code: "HANDOFF_INCOMPLETE" });
    for (const leg of rest) await command(session.token, { type: "receive", proposalId: session.proposal.id, itemId: leg.giveItemId, conditionAccepted: true });
    const accepted = await command(session.token, { type: "receive", proposalId: session.proposal.id, itemId: first.giveItemId, conditionAccepted: true });
    expect(accepted.workspace.proposals[0].status).toBe("handoff_ready");
    expect(accepted.workspace.events.some((entry) => entry.type === "handoff.disputed")).toBe(true);
    expect(accepted.workspace.events.some((entry) => entry.type === "handoff.reinspected")).toBe(true);
    const key = randomUUID();
    const result = await command(session.token, { type: "complete", proposalId: session.proposal.id }, key);
    expect(result.workspace.stats.completedCycles).toBe(1);
    expect(result.workspace.stats.completedMembers).toBe(3);
    expect(result.workspace.stats.dataOrigin).toBe("authored-sample");
    expect(result.workspace.proposals[0].receipts.every((receipt) => receipt.releasedAt)).toBe(true);
    expect(result.workspace.items.filter((item) => item.state === "exchanged")).toHaveLength(3);
    const replayed = await command(session.token, { type: "complete", proposalId: session.proposal.id }, key);
    expect(replayed.workspace.events.filter((entry) => entry.type === "handoff.completed")).toHaveLength(1);
    expect((await getEvents(session.token, 0)).events.every((entry, index, array) => index === 0 || entry.sequence > array[index - 1].sequence)).toBe(true);
  });

  it("does not return authored fallback or change the workspace when live credentials are missing", async () => {
    const session = await fresh();
    const previousKey = process.env.QLOO_API_KEY;
    delete process.env.QLOO_API_KEY;
    try {
      await expect(command(session.token, { type: "discover", mode: "live" })).rejects.toMatchObject({ code: "MISSING_QLOO_KEY" });
      expect((await getWorkspace(session.token)).discovery).toBeNull();
    } finally {
      if (previousKey !== undefined) process.env.QLOO_API_KEY = previousKey;
    }
  });
});
