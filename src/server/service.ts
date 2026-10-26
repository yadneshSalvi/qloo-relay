import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { MEMBERS, SEED_APPROVALS, SEED_ITEMS, TERMS } from "../domain/catalog";
import { assertDomain } from "../domain/errors";
import { solveCycles } from "../domain/solver";
import { APPROVAL_LIFETIME_MS, PROPOSAL_LIFETIME_MS } from "../domain/policy";
import type { ApiResult, Command, Evidence, ExchangeTerms, Item, Proposal, Workspace } from "../domain/types";
import { withTransaction } from "./db";
import { loadWorkspace, type SessionRow } from "./workspace";
import { enqueueDiscovery, controlRun } from "./jobs";

export const SESSION_COOKIE = "relay_sample";
export const ACCESS_COOKIE = "relay_private";
export const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const hashValue = (value: unknown) => hash(JSON.stringify(value));

async function evidence(client: PoolClient, sessionId: string, kind: Evidence["kind"], title: string, summary: string, details: Record<string, unknown>, memberId: string | null = null) {
  const id = randomUUID();
  await client.query("INSERT INTO relay.evidence(session_id,id,kind,source,title,summary,details,member_id) SELECT $1,$2,$3,CASE WHEN mode='sample' THEN 'authored-sample' ELSE 'participant-recorded' END,$4,$5,$6,$7 FROM relay.sessions WHERE id=$1", [sessionId, id, kind, title, summary, details, memberId]);
  return id;
}

export async function event(client: PoolClient, sessionId: string, type: string, aggregateId: string, summary: string, payload: Record<string, unknown> = {}) {
  const id = randomUUID();
  const sequence = (await client.query<{ next_sequence: string }>("UPDATE relay.sessions SET next_sequence=next_sequence+1 WHERE id=$1 RETURNING next_sequence", [sessionId])).rows[0].next_sequence;
  await client.query("INSERT INTO relay.domain_events(session_id,id,sequence,type,aggregate_id,summary,payload) VALUES($1,$2,$3,$4,$5,$6,$7)", [sessionId, id, sequence, type, aggregateId, summary, payload]);
  await client.query("INSERT INTO relay.outbox(session_id,event_id,payload) VALUES($1,$2,$3)", [sessionId, id, { type, aggregateId, sequence: Number(sequence), ...payload }]);
}

export async function createSession(displayName = "You", transaction?: { client: PoolClient; token: string }): Promise<{ token: string; workspace: Workspace }> {
  const id = randomUUID();
  const token = transaction?.token ?? randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_SECONDS * 1000);
  const terms: ExchangeTerms = { ...TERMS, hash: hashValue(TERMS) };
  const seed = async (client: PoolClient) => {
    await client.query("INSERT INTO relay.sessions(id,token_hash,display_name,terms,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)", [id, hash(token), displayName, terms, now, expiresAt]);
    for (const member of MEMBERS) {
      const name = member.id === "you" ? displayName : member.name;
      const initials = member.id === "you" && displayName !== "You" ? displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() : member.initials;
      await client.query("INSERT INTO relay.members(session_id,id,name,initials,bio,color,role) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, member.id, name, initials, member.bio, member.color, member.role]);
    }
    await client.query("INSERT INTO relay.preference_versions(session_id,version,seed_work_ids,novelty) VALUES($1,1,$2,50)", [id, JSON.stringify(["work-creative-act", "work-kind-of-blue", "work-earthsea"])]);
    for (const item of SEED_ITEMS) {
      await client.query("INSERT INTO relay.items(session_id,id,work_id,owner_id,edition,condition,notes,attested,state) VALUES($1,$2,$3,$4,$5,$6,$7,true,'available')", [id, item.id, item.workId, item.ownerId, item.edition, item.condition, item.notes]);
    }
    const seedEvidence = await evidence(client, id, "session", "A fresh authored community", "Every sample member, offered copy, and prewritten approval belongs only to this cookie session. You can explicitly role-play members and the coordinator.", { dataOrigin: "authored-sample", fictionalMembers: MEMBERS.length, offeredCopies: SEED_ITEMS.length, approvals: SEED_APPROVALS, outboundMessaging: false });
    for (const approval of SEED_APPROVALS) {
      await client.query("INSERT INTO relay.approvals(session_id,id,member_id,give_item_id,receive_item_id,give_version,receive_version,terms_version,terms_hash,preference_rank,status,authored,evidence_id,expires_at) VALUES($1,$2,$3,$4,$5,1,1,$6,$7,$8,'active',true,$9,$10)", [id, randomUUID(), approval.memberId, approval.giveItemId, approval.receiveItemId, terms.version, terms.hash, approval.preferenceRank, seedEvidence, new Date(now.getTime() + APPROVAL_LIFETIME_MS)]);
    }
    await event(client, id, "session.started", id, "Created an isolated fictional exchange community.", { evidenceId: seedEvidence, dataOrigin: "authored-sample" });
    return loadWorkspace(client, id);
  };
  const workspace = transaction ? await seed(transaction.client) : await withTransaction(seed);
  return { token, workspace };
}

/** Replayed resets from either the old or replacement cookie return the same fresh community. */
export async function replaceSession(token: string, command: Extract<Command, { type: "startSession" | "reset" }>, key: string) {
  return withTransaction(async (client) => {
    const previous = await lockSession(client, token);
    assertDomain(previous.mode === "sample", "PRIVATE_COMMUNITY_ACTIVE", "Leave the private community in this browser before starting a fresh sample.", 403);
    const commandHash = hashValue(command);
    const replay = (await client.query<{ command_hash: string; replacement_session_id: string | null }>("SELECT command_hash,replacement_session_id FROM relay.idempotency_keys WHERE session_id=$1 AND key=$2", [previous.id, key])).rows[0];
    const deriveToken = () => createHmac("sha256", token).update(`relay-session-replacement-v1:${key}:${commandHash}`).digest("base64url");
    if (replay) {
      assertDomain(replay.command_hash === commandHash && replay.replacement_session_id, "IDEMPOTENCY_CONFLICT", "This request key was used for another action. Retry with a new key.");
      const replacementToken = replay.replacement_session_id === previous.id ? token : deriveToken();
      const active = await client.query("SELECT 1 FROM relay.sessions WHERE id=$1 AND token_hash=$2 AND expires_at>now()", [replay.replacement_session_id, hash(replacementToken)]);
      assertDomain(active.rows.length, "SESSION_EXPIRED", "The replacement sample session expired. Open a fresh sample workspace.", 401);
      return { token: replacementToken, workspace: await loadWorkspace(client, replay.replacement_session_id) };
    }
    const replacement = await createSession(command.displayName, { client, token: deriveToken() });
    for (const sessionId of [previous.id, replacement.workspace.session.id]) {
      await client.query("INSERT INTO relay.idempotency_keys(session_id,key,command_hash,notice,replacement_session_id) VALUES($1,$2,$3,$4,$5)", [sessionId, key, commandHash, "Started a fresh isolated sample community.", replacement.workspace.session.id]);
    }
    return replacement;
  });
}

export interface SessionAccess extends SessionRow {
  memberId: string;
  role: "member" | "coordinator";
  credentialId: string | null;
  credentialExpiresAt: Date;
}

/** A supplied member ID never selects the actor. Every private actor comes from a hashed bearer credential. */
export async function resolveSessionAccess(client: PoolClient, token: string): Promise<SessionAccess> {
  assertDomain(/^[A-Za-z0-9_-]{43}$/.test(token), "SESSION_EXPIRED", "This browser session has ended. Open community access to continue.", 401);
  const privateAccess = (await client.query<SessionRow & { member_id: string; role: SessionAccess["role"]; active: boolean; credential_id: string; credential_expires_at: Date; revoked_at: Date | null }>(
    "SELECT s.*,a.member_id,m.role,m.active,a.id AS credential_id,a.expires_at AS credential_expires_at,a.revoked_at FROM relay.access_sessions a JOIN relay.sessions s ON s.id=a.session_id JOIN relay.members m ON m.session_id=a.session_id AND m.id=a.member_id WHERE a.token_hash=$1 FOR UPDATE OF s", [hash(token)],
  )).rows[0];
  if (privateAccess) {
    assertDomain(privateAccess.mode === "private" && privateAccess.active && !privateAccess.revoked_at && privateAccess.credential_expires_at > new Date() && privateAccess.expires_at > new Date(), "ACCESS_REVOKED", "This community session expired or its access was revoked. Ask the coordinator for a new invitation.", 401);
    return { ...privateAccess, memberId: privateAccess.member_id, role: privateAccess.role, credentialId: privateAccess.credential_id, credentialExpiresAt: privateAccess.credential_expires_at };
  }
  const session = (await client.query<SessionRow>("SELECT * FROM relay.sessions WHERE token_hash=$1 AND mode='sample' FOR UPDATE", [hash(token)])).rows[0];
  assertDomain(session && session.expires_at > new Date(), "SESSION_EXPIRED", "This browser session has ended. Open community access to continue.", 401);
  return { ...session, memberId: "you", role: "member", credentialId: null, credentialExpiresAt: session.expires_at };
}

const lockSession = resolveSessionAccess;

export async function cancelProposal(client: PoolClient, sessionId: string, proposal: Proposal, status: "withdrawn" | "invalidated" | "expired", reason: string, memberId: string | null = null) {
  const inCustody = proposal.receipts.length > 0;
  const nextStatus = inCustody ? "disputed" : status;
  await client.query("UPDATE relay.proposals SET status=$3,withdrawn_by=$4,withdrawal_reason=$5,dispute_kind=$6 WHERE session_id=$1 AND id=$2", [sessionId, proposal.id, nextStatus, memberId, reason, inCustody ? "custody" : null]);
  if (!inCustody) {
    await client.query("UPDATE relay.item_reservations SET state='released' WHERE session_id=$1 AND proposal_id=$2 AND state='active'", [sessionId, proposal.id]);
    await client.query("UPDATE relay.member_reservations SET state='released' WHERE session_id=$1 AND proposal_id=$2 AND state='active'", [sessionId, proposal.id]);
    await client.query("UPDATE relay.items SET state='available',held_by_proposal_id=NULL WHERE session_id=$1 AND held_by_proposal_id=$2 AND state='reserved'", [sessionId, proposal.id]);
  }
  await event(client, sessionId, `proposal.${nextStatus}`, proposal.id, inCustody ? "A change after hub receipt froze this exchange for coordinator review." : reason, { memberId, reason, previousStatus: proposal.status });
}

async function expireState(client: PoolClient, sessionId: string, memberId = "you") {
  await client.query("UPDATE relay.approvals SET status='expired' WHERE session_id=$1 AND status='active' AND expires_at <= now()", [sessionId]);
  const expired = (await client.query<{ id: string }>("SELECT id FROM relay.proposals WHERE session_id=$1 AND status IN ('proposed','reserved','handoff_ready') AND expires_at<=now() ORDER BY id", [sessionId])).rows;
  if (expired.length) {
    const workspace = await loadWorkspace(client, sessionId, memberId);
    for (const row of expired) {
      const proposal = workspace.proposals.find((entry) => entry.id === row.id)!;
      await cancelProposal(client, sessionId, proposal, "expired", "The confirmation or reservation window expired. Fresh confirmation is required.");
    }
  }
}

export async function getWorkspace(token: string): Promise<Workspace> {
  return withTransaction(async (client) => {
    const session = await lockSession(client, token);
    await expireState(client, session.id, session.memberId);
    return loadWorkspace(client, session.id, session.memberId, session.credentialExpiresAt);
  });
}

export async function getEvents(token: string, after: number) {
  return withTransaction(async (client) => {
    const session = await lockSession(client, token);
    await expireState(client, session.id, session.memberId);
    const rows = (await client.query<{ id: string; sequence: string; type: string; aggregate_id: string; summary: string; created_at: Date }>("SELECT id,sequence,type,aggregate_id,summary,created_at FROM relay.domain_events WHERE session_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 101", [session.id, after])).rows;
    const events = rows.slice(0, 100).map((row) => ({ id: row.id, sequence: Number(row.sequence), type: row.type, aggregateId: row.aggregate_id, summary: row.summary, createdAt: row.created_at.toISOString() }));
    return { events, nextSequence: events.at(-1)?.sequence ?? after, hasMore: rows.length > 100, dataOrigin: session.mode === "sample" ? "authored-sample" : "participant-recorded" };
  });
}

function itemById(workspace: Workspace, id: string): Item {
  const item = workspace.items.find((entry) => entry.id === id);
  assertDomain(item, "ITEM_NOT_FOUND", "That copy does not belong to this community.", 404);
  return item;
}

function proposalById(workspace: Workspace, id: string): Proposal {
  const proposal = workspace.proposals.find((entry) => entry.id === id);
  assertDomain(proposal, "PROPOSAL_NOT_FOUND", "That exchange does not belong to this community.", 404);
  return proposal;
}

function checkItemVersion(item: Item, expected: number) {
  assertDomain(item.version === expected, "STALE_ITEM_VERSION", "This copy changed after you reviewed it. Review the current edition and condition before approving again.");
}

function validateProposal(workspace: Workspace, proposal: Proposal) {
  assertDomain(proposal.expiresAt > new Date().toISOString(), "PROPOSAL_EXPIRED", "This exchange window expired. Request a fresh proposal.");
  assertDomain(proposal.legs.length >= 2 && proposal.legs.length <= 5, "INVALID_CYCLE", "An exchange must contain two to five members.");
  assertDomain(new Set(proposal.legs.map((leg) => leg.memberId)).size === proposal.legs.length, "INVALID_CYCLE", "A member cannot participate twice in an exchange.");
  const gives = new Set(proposal.legs.map((leg) => leg.giveItemId));
  assertDomain(gives.size === proposal.legs.length && proposal.legs.every((leg) => gives.has(leg.receiveItemId)), "INVALID_CYCLE", "Every copy must have exactly one giver and one receiver.");
  assertDomain(new Set(proposal.legs.map((leg) => leg.receiveItemId)).size === proposal.legs.length, "INVALID_CYCLE", "A copy cannot be received twice.");
  for (const leg of proposal.legs) {
    const give = itemById(workspace, leg.giveItemId);
    const receive = itemById(workspace, leg.receiveItemId);
    const approval = workspace.approvals.find((entry) => entry.id === leg.approvalId);
    assertDomain(approval && approval.status === "active" && approval.expiresAt > new Date().toISOString(), "APPROVAL_NOT_ACTIVE", "An exact approval expired or was withdrawn. Request a fresh exchange.");
    assertDomain(approval.memberId === leg.memberId && give.ownerId === leg.memberId && give.ownerId !== receive.ownerId && give.attested && receive.attested, "INVALID_OWNERSHIP", "The exchange ownership or attestation changed.");
    assertDomain(approval.giveItemId === give.id && approval.receiveItemId === receive.id && approval.termsHash === proposal.terms.hash && approval.termsVersion === proposal.terms.version && proposal.terms.hash === workspace.terms.hash, "STALE_TERMS", "The approved terms differ from this proposal. Fresh approval is required.");
    assertDomain(approval.giveVersion === leg.giveVersion && approval.receiveVersion === leg.receiveVersion && give.version === leg.giveVersion && receive.version === leg.receiveVersion, "STALE_ITEM_VERSION", "A copy changed after approval. Review the new details and approve again.");
    const ownedState = (item: Item) => item.state === "available" || (item.heldByProposalId === proposal.id && ["reserved", "at_hub"].includes(item.state));
    assertDomain(ownedState(give) && ownedState(receive), "RESERVATION_CONFLICT", "One of these copies is unavailable or held by another exchange.");
  }
}

async function invalidateItemProposals(client: PoolClient, workspace: Workspace, itemId: string, reason: string) {
  for (const proposal of workspace.proposals.filter((entry) => ["proposed", "reserved", "handoff_ready"].includes(entry.status) && entry.legs.some((leg) => leg.giveItemId === itemId || leg.receiveItemId === itemId))) {
    await cancelProposal(client, workspace.session.id, proposal, "invalidated", reason);
  }
}

async function generateProposals(client: PoolClient, workspace: Workspace, repairOf: Proposal | null = null) {
  const busyMembers = workspace.proposals.filter((proposal) => ["reserved", "handoff_ready", "disputed"].includes(proposal.status)).flatMap((proposal) => proposal.legs.map((leg) => leg.memberId));
  const excludedMemberIds = [...busyMembers, ...workspace.members.filter((member) => member.active === false || member.role !== "member").map((member) => member.id), ...(repairOf?.withdrawnBy ? [repairOf.withdrawnBy] : [])];
  const result = solveCycles({ items: workspace.items, approvals: workspace.approvals, termsHash: workspace.terms.hash, now: new Date(), excludedMemberIds });
  const selectedKeys = new Set(result.selected.map((cycle) => hash(cycle.key)));
  for (const old of workspace.proposals.filter((proposal) => proposal.status === "proposed")) {
    const key = hash(old.legs.map((leg) => `${leg.giveItemId}>${leg.receiveItemId}`).join("|"));
    if (!selectedKeys.has(key)) await cancelProposal(client, workspace.session.id, old, "invalidated", "A fresh allocation replaced this proposed exchange; no previous confirmations carry over.");
  }
  let created = 0;
  for (const cycle of result.selected) {
    const fingerprint = hash(cycle.key);
    const existing = await client.query("SELECT id FROM relay.proposals WHERE session_id=$1 AND fingerprint=$2 AND status IN ('proposed','reserved','handoff_ready')", [workspace.session.id, fingerprint]);
    if (existing.rows.length) continue;
    const id = randomUUID();
    const expiresAt = new Date(Math.min(Date.now() + PROPOSAL_LIFETIME_MS, ...cycle.approvals.map((approval) => new Date(approval.expiresAt).getTime())));
    await client.query("INSERT INTO relay.proposals(session_id,id,version,fingerprint,status,terms,expires_at,repair_of) VALUES($1,$2,1,$3,'proposed',$4,$5,$6)", [workspace.session.id, id, fingerprint, workspace.terms, expiresAt, repairOf?.id ?? null]);
    for (const [ordinal, approval] of cycle.approvals.entries()) {
      await client.query("INSERT INTO relay.proposal_legs(session_id,proposal_id,member_id,ordinal,give_item_id,receive_item_id,approval_id,give_version,receive_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [workspace.session.id, id, approval.memberId, ordinal, approval.giveItemId, approval.receiveItemId, approval.id, approval.giveVersion, approval.receiveVersion]);
    }
    await event(client, workspace.session.id, repairOf ? "proposal.repaired" : "proposal.created", id, `Proposed a ${cycle.memberIds.length}-member exchange. Every member must confirm its exact terms.`, { memberIds: cycle.memberIds, itemIds: cycle.itemIds, repairOf: repairOf?.id ?? null, version: 1 });
    created++;
  }
  await evidence(client, workspace.session.id, repairOf ? "repair" : "solver", repairOf ? "A separate repair proposal" : "Deterministic exchange search", `${result.candidates.length} feasible cycles; ${result.selected.length} disjoint cycles selected from exact, active approvals.`, { method: result.method, objective: result.objective, cycleBounds: [2, 5], candidateCycles: result.candidates.length, selectedCycles: result.selected.length, excludedMemberIds, repairOf: repairOf?.id ?? null, consentCreated: false });
  return result.selected.length ? `${created ? "Created" : "Kept"} ${result.selected.length} exchange proposal${result.selected.length === 1 ? "" : "s"}. Each member still needs to confirm.` : "No complete exchange yet. Keep your exact approvals and explore another available copy; the system never invents consent.";
}

export async function executeCommand(token: string, command: Exclude<Command, { type: "startSession" | "reset" }>, idempotencyKey: string): Promise<ApiResult> {
  return withTransaction(async (client) => {
    const session = await lockSession(client, token);
    const scopedKey = session.mode === "private" ? `${session.memberId}:${idempotencyKey}` : idempotencyKey;
    const commandHash = hashValue(command);
    const replay = (await client.query<{ command_hash: string; notice: string | null }>("SELECT command_hash,notice FROM relay.idempotency_keys WHERE session_id=$1 AND key=$2", [session.id, scopedKey])).rows[0];
    if (replay) {
      assertDomain(replay.command_hash === commandHash, "IDEMPOTENCY_CONFLICT", "This request key was already used for another action. Refresh and retry with a new key.");
      await expireState(client, session.id, session.memberId);
      return { workspace: await loadWorkspace(client, session.id, session.memberId, session.credentialExpiresAt), ...(replay.notice ? { notice: replay.notice } : {}) };
    }
    await expireState(client, session.id, session.memberId);
    const workspace = await loadWorkspace(client, session.id, session.memberId, session.credentialExpiresAt);
    authorizeCommand(workspace, command);
    const notice = await applyCommand(client, workspace, command);
    await client.query("INSERT INTO relay.idempotency_keys(session_id,key,command_hash,notice) VALUES($1,$2,$3,$4)", [session.id, scopedKey, commandHash, notice ?? null]);
    return { workspace: await loadWorkspace(client, session.id, session.memberId, session.credentialExpiresAt), ...(notice ? { notice } : {}) };
  });
}

function authorizeCommand(workspace: Workspace, command: Exclude<Command, { type: "startSession" | "reset" }>) {
  if (workspace.session.mode === "sample") return;
  if (command.type === "receive" || command.type === "complete") {
    assertDomain(workspace.access.role === "coordinator", "COORDINATOR_REQUIRED", "Only an authenticated community coordinator may inspect copies or record release.", 403);
    return;
  }
  if (command.type === "createProposals" || command.type === "retryRepair") return;
  assertDomain(workspace.access.role === "member", "PARTICIPANT_REQUIRED", "Use an invited participant session for personal listings, taste, approvals, and confirmations. Coordinator access only operates the event.", 403);
  if (command.type === "confirm" || command.type === "withdraw") assertDomain(command.memberId === workspace.currentMemberId, "FORBIDDEN", "You can only confirm or withdraw your own part in this community.", 403);
}

async function applyCommand(client: PoolClient, workspace: Workspace, command: Exclude<Command, { type: "startSession" | "reset" }>): Promise<string | undefined> {
  const sessionId = workspace.session.id;
  const memberId = workspace.currentMemberId;
  switch (command.type) {
    case "preferences": {
      assertDomain(command.seedWorkIds.every((id) => workspace.works.some((work) => work.id === id)), "UNKNOWN_REFERENCE", "Choose and confirm references from your visible catalog.", 400);
      const version = workspace.preferences.version + 1;
      await client.query("INSERT INTO relay.preference_versions(session_id,member_id,version,seed_work_ids,novelty) VALUES($1,$2,$3,$4,$5)", [sessionId, memberId, version, JSON.stringify(command.seedWorkIds), command.novelty]);
      const evidenceId = await evidence(client, sessionId, "preferences", "Voluntary reference selection", "Only references selected by this member shape their discovery. Existing exact trade approvals stay explicit.", { memberId, version, seedWorkIds: command.seedWorkIds, novelty: command.novelty }, memberId);
      await event(client, sessionId, "preferences.updated", sessionId, "Saved a new preference version.", { version, evidenceId });
      return "Taste references saved. Refresh discovery to explore a new shelf.";
    }
    case "discover": return discover(client, workspace, command);
    case "cancelRun":
    case "retryRun": return controlRun(client, workspace, command);
    case "saveItem": {
      const item = itemById(workspace, command.itemId);
      assertDomain(item.ownerId !== memberId, "OWN_ITEM", "Your own copy already belongs on your shelf.", 400);
      await client.query("INSERT INTO relay.saved_items(session_id,member_id,item_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [sessionId, memberId, item.id]);
      await client.query("DELETE FROM relay.dismissals WHERE session_id=$1 AND member_id=$2 AND item_id=$3", [sessionId, memberId, item.id]);
      await event(client, sessionId, "item.saved", item.id, "Saved a copy for later. Saving is not approval to trade.");
      return "Saved to your collection. No trade has been approved.";
    }
    case "dismiss": {
      const item = itemById(workspace, command.itemId);
      assertDomain(item.ownerId !== memberId, "OWN_ITEM", "Choose another member's copy.", 400);
      await client.query("INSERT INTO relay.dismissals(session_id,member_id,item_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,member_id,item_id) DO UPDATE SET reason=EXCLUDED.reason,created_at=now()", [sessionId, memberId, item.id, command.reason]);
      await event(client, sessionId, "discovery.dismissed", item.id, "Dismissed a discovery without changing any trade approval.", { reason: command.reason });
      return "Preference noted. Refresh discovery for other copies.";
    }
    case "addItem": {
      const work = workspace.works.find((work) => work.id === command.workId);
      assertDomain(work, "WORK_NOT_FOUND", "Choose and confirm a visible catalog work before listing a copy.", 404);
      assertDomain(!work.referenceOnly, "RECORD_TITLE_REQUIRED", "This favorite identifies an artist, not an album. Find the artist for inventory and supply your physical record’s album title before listing it.", 422);
      assertDomain(command.attested, "OWNERSHIP_ATTESTATION_REQUIRED", "Confirm that you own this copy and can bring it to the handoff.", 400);
      assertDomain(workspace.items.filter((item) => item.ownerId === memberId).length < 20, "INVENTORY_LIMIT", "Your shelf supports up to twenty copies.", 422);
      // Listing is the explicit boundary that publishes a member-private resolved work to this community.
      await client.query("UPDATE relay.catalog_works SET visibility='shared' WHERE id=$1 AND session_id=$2 AND created_by_member_id=$3", [command.workId, sessionId, memberId]);
      const id = `item-${randomUUID()}`;
      await client.query("INSERT INTO relay.items(session_id,id,work_id,owner_id,edition,condition,notes,attested,state) VALUES($1,$2,$3,$4,$5,$6,$7,true,'available')", [sessionId, id, command.workId, memberId, command.edition, command.condition, command.notes]);
      const evidenceId = await evidence(client, sessionId, "inventory", "An explicitly offered copy", "A catalog work and an owned physical copy are separate records. Ownership is attested by the listing member; condition still requires hub inspection.", { itemId: id, memberId, workId: command.workId, edition: command.edition, condition: command.condition });
      await event(client, sessionId, "item.listed", id, "Added an attested copy to the community shelf.", { evidenceId, memberId });
      return "Your copy is available on the community shelf.";
    }
    case "updateItem": {
      const item = itemById(workspace, command.itemId);
      assertDomain(item.ownerId === memberId, "FORBIDDEN", "Only your own copy can be edited.", 403);
      checkItemVersion(item, command.expectedVersion);
      assertDomain(item.state === "available", "ITEM_HELD", "This copy is held or no longer available. Withdraw the exchange before changing its details.");
      await client.query("UPDATE relay.items SET edition=$3,condition=$4,notes=$5,version=version+1 WHERE session_id=$1 AND id=$2", [sessionId, item.id, command.edition ?? item.edition, command.condition ?? item.condition, command.notes ?? item.notes]);
      await client.query("UPDATE relay.approvals SET status='revoked' WHERE session_id=$1 AND status='active' AND (give_item_id=$2 OR receive_item_id=$2)", [sessionId, item.id]);
      await invalidateItemProposals(client, workspace, item.id, "A material copy detail changed. Prior exact approval and confirmations no longer apply.");
      await event(client, sessionId, "item.updated", item.id, "Updated copy details and invalidated its previous exact approvals.", { version: item.version + 1 });
      return "Copy updated. Any affected trade needs a new approval.";
    }
    case "withdrawItem": {
      const item = itemById(workspace, command.itemId);
      assertDomain(item.ownerId === memberId, "FORBIDDEN", "Only your own copy can be withdrawn.", 403);
      checkItemVersion(item, command.expectedVersion);
      assertDomain(!["at_hub", "disputed", "exchanged"].includes(item.state), "ITEM_IN_CUSTODY", "A copy at the hub or already exchanged cannot be silently relisted or withdrawn.");
      await invalidateItemProposals(client, workspace, item.id, command.reason ?? "The owner withdrew this offered copy.");
      await client.query("UPDATE relay.items SET state='withdrawn',held_by_proposal_id=NULL,version=version+1 WHERE session_id=$1 AND id=$2", [sessionId, item.id]);
      await client.query("UPDATE relay.approvals SET status='revoked' WHERE session_id=$1 AND status='active' AND (give_item_id=$2 OR receive_item_id=$2)", [sessionId, item.id]);
      await event(client, sessionId, "item.withdrawn", item.id, "Withdrew an offered copy and invalidated affected exact approvals.");
      return "Copy withdrawn. Affected exchanges were stopped explicitly.";
    }
    case "approve": return approve(client, workspace, command);
    case "revokeApproval": {
      const approval = workspace.approvals.find((entry) => entry.id === command.approvalId);
      assertDomain(approval, "APPROVAL_NOT_FOUND", "That approval is not in this community.", 404);
      assertDomain(approval.memberId === memberId, "FORBIDDEN", "Only your own exact approval can be revoked.", 403);
      assertDomain(approval.status !== "consumed", "ALREADY_COMPLETED", "A completed handoff cannot be undone by revoking a past approval.");
      await client.query("UPDATE relay.approvals SET status='revoked' WHERE session_id=$1 AND id=$2", [sessionId, approval.id]);
      for (const proposal of workspace.proposals.filter((entry) => ["proposed", "reserved", "handoff_ready"].includes(entry.status) && entry.legs.some((leg) => leg.approvalId === approval.id))) {
        await cancelProposal(client, sessionId, proposal, "withdrawn", command.reason, memberId);
      }
      await event(client, sessionId, "approval.revoked", approval.id, "Revoked your exact conditional approval.", { reason: command.reason });
      return "Approval withdrawn. Any affected exchange must be planned again.";
    }
    case "createProposals": return generateProposals(client, workspace);
    case "confirm": return confirm(client, workspace, command);
    case "withdraw": {
      const proposal = proposalById(workspace, command.proposalId);
      assertDomain(["proposed", "reserved", "handoff_ready"].includes(proposal.status), "PROPOSAL_NOT_ACTIVE", "This exchange is no longer open for withdrawal.");
      assertDomain(proposal.legs.some((leg) => leg.memberId === command.memberId), "FORBIDDEN", "Only an affected member may withdraw from this exchange.", 403);
      await client.query("UPDATE relay.approvals SET status='revoked' WHERE session_id=$1 AND member_id=$2 AND status='active'", [sessionId, command.memberId]);
      await cancelProposal(client, sessionId, proposal, "withdrawn", command.reason, command.memberId);
      await evidence(client, sessionId, "withdrawal", "A member explicitly withdrew", "The old exchange stops. A repair is a separate proposal and never inherits confirmations.", { proposalId: proposal.id, memberId: command.memberId, reason: command.reason, wasReserved: !!proposal.reservedAt });
      return proposal.receipts.length ? "The exchange is frozen because copies are already at the hub. The coordinator must resolve custody before a new exchange." : "Exchange withdrawn. Holds released; search for a separate repair when you are ready.";
    }
    case "receive": return receive(client, workspace, command);
    case "complete": return complete(client, workspace, command.proposalId);
    case "retryRepair": {
      const proposal = proposalById(workspace, command.proposalId);
      assertDomain(workspace.session.mode === "sample" || workspace.access.role === "coordinator" || proposal.legs.some((leg) => leg.memberId === memberId), "FORBIDDEN", "Only an affected participant or the coordinator may request repair.", 403);
      assertDomain(["withdrawn", "invalidated", "expired"].includes(proposal.status), "REPAIR_NOT_ALLOWED", "Repair is available after a withdrawal, invalidation, or expired hold. Items in coordinator custody must be resolved first.");
      return generateProposals(client, workspace, proposal);
    }
  }
}

async function discover(client: PoolClient, workspace: Workspace, command: Extract<Command, { type: "discover" }>) {
  if (command.mode === "live") return enqueueDiscovery(client, workspace, command);
  assertDomain(workspace.session.mode === "sample", "SAMPLE_ONLY", "Authored discovery belongs to the isolated sample. Choose live discovery for this private community.", 403);
  const dismissed = new Set(workspace.dismissals.map((entry) => entry.itemId));
  const candidates = workspace.items.filter((item) => item.ownerId !== workspace.currentMemberId && item.state === "available" && item.attested && !dismissed.has(item.id) && (!command.category || workspace.works.find((work) => work.id === item.workId)?.category === command.category));
  const seeds = workspace.works.filter((work) => workspace.preferences.seedWorkIds.includes(work.id));
  const seedTags = new Set(seeds.flatMap((work) => work.tags));
  const seedCategories = new Set(seeds.map((work) => work.category));
  // Authored example bridges supplement transparent tag overlap. They are never Qloo evidence.
  const bridges: Record<string, Record<string, number>> = {
    "work-creative-act": { "work-hades": 11, "work-nurture": 8, "work-piranesi": 7, "work-braiding-sweetgrass": 6, "work-journey": 8 },
    "work-kind-of-blue": { "work-blue-train": 11, "work-discovery": 6, "work-in-rainbows": 7, "work-nurture": 6 },
    "work-earthsea": { "work-hades": 10, "work-dispossessed": 9, "work-piranesi": 9, "work-journey": 7 },
    "work-invisible-cities": { "work-piranesi": 12, "work-journey": 11, "work-dispossessed": 7 },
    "work-stardew-valley": { "work-braiding-sweetgrass": 12, "work-journey": 7 },
    "work-in-rainbows": { "work-nurture": 11, "work-discovery": 8, "work-blue-train": 5 },
  };
  const ranked = candidates.map((item) => {
    const work = workspace.works.find((entry) => entry.id === item.workId)!;
    const shared = work.tags.filter((tag) => seedTags.has(tag));
    const curated = seeds.reduce((sum, seed) => sum + (bridges[seed.id]?.[work.id] ?? 0), 0);
    const categoryWeight = seedCategories.has(work.category) ? (100 - workspace.preferences.novelty) / 50 : workspace.preferences.novelty / 25;
    return { item, work, shared, score: shared.length * 2 + curated + categoryWeight };
  }).sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  const id = randomUUID();
  const candidateItemIds = candidates.map((item) => item.id).sort();
  const candidateSetHash = hashValue(candidates.map((item) => [item.id, item.version]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const evidenceId = await evidence(client, workspace.session.id, "discovery", "Authored sample discovery", "This ordering uses selected references, original metadata tags, and explicitly authored cultural bridges. It is not a Qloo result, an individual certainty, or consent to exchange.", { preferenceVersion: workspace.preferences.version, seedWorkIds: workspace.preferences.seedWorkIds, novelty: workspace.preferences.novelty, category: command.category ?? "all", candidateItemIds, candidateSetHash, method: "authored-bridges-plus-metadata-v1", adapterCalls: 0, consentCreated: false });
  const run = {
    id, status: "ready" as const, source: "authored-sample" as const, category: command.category ?? "all" as const,
    preferenceVersion: workspace.preferences.version, candidateItemIds, candidateSetHash,
    suggestions: ranked.slice(0, 6).map(({ item, work, shared }, index) => ({
      itemId: item.id, rank: index + 1,
      reason: shared.length ? `An authored connection through ${shared.slice(0, 2).join(" and ")}${seedCategories.has(work.category) ? ", in a format on your shelf." : ", in a new format to explore."}` : "An authored discovery beyond your selected references. Review the actual copy before deciding.",
      signals: shared.slice(0, 3), evidenceId, source: "authored-sample" as const,
    })),
    createdAt: new Date().toISOString(), disclosure: "Authored sample discovery · no live Qloo call · fictional available inventory",
  };
  await client.query("INSERT INTO relay.discovery_runs(session_id,id,member_id,data) VALUES($1,$2,$3,$4)", [workspace.session.id, id, workspace.currentMemberId, run]);
  await event(client, workspace.session.id, "discovery.completed", id, `Prepared ${run.suggestions.length} authored sample discoveries from ${candidateItemIds.length} eligible copies.`, { evidenceId, candidateSetHash, source: "authored-sample" });
  return run.suggestions.length ? "Your sample discoveries are ready. Choose an exact give/get pair when a copy interests you." : "No available copies match these filters. Try another category; existing approvals are preserved.";
}

async function approve(client: PoolClient, workspace: Workspace, command: Extract<Command, { type: "approve" }>) {
  const give = itemById(workspace, command.giveItemId);
  const receive = itemById(workspace, command.receiveItemId);
  assertDomain(give.ownerId === workspace.currentMemberId && receive.ownerId !== workspace.currentMemberId, "INVALID_OWNERSHIP", "Approve giving your own copy for another member's exact copy.", 403);
  checkItemVersion(give, command.expectedGiveVersion);
  checkItemVersion(receive, command.expectedReceiveVersion);
  assertDomain(give.state === "available" && receive.state === "available", "ITEM_UNAVAILABLE", "One of these copies is already held or unavailable. Choose an available copy.");
  assertDomain(give.attested && receive.attested, "OWNERSHIP_ATTESTATION_REQUIRED", "Both copies need an ownership attestation before approval.");
  const existing = workspace.approvals.find((approval) => approval.status === "active" && approval.giveItemId === give.id && approval.receiveItemId === receive.id && approval.giveVersion === give.version && approval.receiveVersion === receive.version && approval.termsHash === workspace.terms.hash);
  if (existing) return "This exact conditional trade is already approved. It still needs a complete proposal and every member's confirmation.";
  const id = randomUUID();
  const evidenceId = await evidence(client, workspace.session.id, "approval", "An exact conditional approval", "An authenticated session approved this specific give/get pair, current copy versions, and displayed hub terms. A saved item or discovery ranking cannot create this record.", { approvalId: id, memberId: workspace.currentMemberId, giveItemId: give.id, receiveItemId: receive.id, giveVersion: give.version, receiveVersion: receive.version, termsVersion: workspace.terms.version, termsHash: workspace.terms.hash, authoredMemberAction: false });
  await client.query("INSERT INTO relay.approvals(session_id,id,member_id,give_item_id,receive_item_id,give_version,receive_version,terms_version,terms_hash,preference_rank,status,authored,evidence_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',false,$11,$12)", [workspace.session.id, id, workspace.currentMemberId, give.id, receive.id, give.version, receive.version, workspace.terms.version, workspace.terms.hash, command.preferenceRank ?? 1, evidenceId, new Date(Date.now() + APPROVAL_LIFETIME_MS)]);
  await event(client, workspace.session.id, "approval.created", id, "Approved an exact conditional give/get pair. No items are reserved yet.", { evidenceId, giveItemId: give.id, receiveItemId: receive.id });
  return "Exact trade approved. Find an exchange to see whether everyone's approved wants can connect.";
}

async function confirm(client: PoolClient, workspace: Workspace, command: Extract<Command, { type: "confirm" }>) {
  const proposal = proposalById(workspace, command.proposalId);
  assertDomain(proposal.version === command.expectedVersion, "STALE_PROPOSAL_VERSION", "This proposal changed after you reviewed it. Review and confirm the current version.");
  const leg = proposal.legs.find((entry) => entry.memberId === command.memberId);
  assertDomain(leg, "FORBIDDEN", "Only a member of this exchange can confirm its terms.", 403);
  if (["reserved", "handoff_ready"].includes(proposal.status) && leg.confirmed) return "This member already confirmed. The exchange is reserved for handoff.";
  assertDomain(proposal.status === "proposed", proposal.status === "invalidated" ? "RESERVATION_CONFLICT" : "PROPOSAL_NOT_ACTIVE", proposal.status === "invalidated" ? "This proposal was invalidated by changed consent, copies, or a competing reservation. Request a fresh allocation." : "This exchange is no longer collecting confirmations.");
  validateProposal(workspace, proposal);
  const active = (await client.query<{ id: string }>("SELECT id FROM relay.members WHERE session_id=$1 AND active AND role='member' AND id=ANY($2::text[])", [workspace.session.id, proposal.legs.map((entry) => entry.memberId)])).rows;
  assertDomain(active.length === proposal.legs.length, "MEMBERSHIP_INACTIVE", "An affected member is no longer active. Reservation is blocked until a fresh exchange is planned.");
  const conflict = await client.query("SELECT 1 FROM relay.member_reservations WHERE session_id=$1 AND state='active' AND proposal_id<>$2 AND member_id=ANY($3::text[]) LIMIT 1", [workspace.session.id, proposal.id, proposal.legs.map((entry) => entry.memberId)]);
  assertDomain(!conflict.rows.length, "RESERVATION_CONFLICT", "A member already has an active exchange, even if another copy is available.");
  if (!leg.confirmed) {
    await client.query("INSERT INTO relay.confirmations(session_id,proposal_id,version,member_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [workspace.session.id, proposal.id, proposal.version, command.memberId]);
    const rolePlayed = workspace.session.mode === "sample" && command.memberId !== workspace.currentMemberId;
    const evidenceId = await evidence(client, workspace.session.id, "confirmation", rolePlayed ? "Explicit sample member role-play" : "A participant’s complete-exchange confirmation", workspace.session.mode === "sample" ? "This confirmation binds the exact displayed proposal version. Other sample members are fictional; their actions are explicit role-play by the session owner." : "The session authenticated for this member confirmed the exact displayed proposal version. Display names are self-reported; the record proves this scoped session action, not an independently verified identity.", { proposalId: proposal.id, proposalVersion: proposal.version, memberId: command.memberId, rolePlayed, authentication: workspace.access.authentication, termsHash: proposal.terms.hash });
    await event(client, workspace.session.id, "proposal.confirmed", proposal.id, `${workspace.members.find((entry) => entry.id === command.memberId)?.name ?? command.memberId} confirmed the exact exchange.`, { memberId: command.memberId, version: proposal.version, evidenceId });
  }
  const confirmed = (await client.query<{ count: string }>("SELECT count(*) FROM relay.confirmations WHERE session_id=$1 AND proposal_id=$2 AND version=$3", [workspace.session.id, proposal.id, proposal.version])).rows[0];
  if (Number(confirmed.count) < proposal.legs.length) return `Confirmation recorded. ${proposal.legs.length - Number(confirmed.count)} member${proposal.legs.length - Number(confirmed.count) === 1 ? " still needs" : "s still need"} to confirm.`;
  // All member and item holds are created in this transaction. Partial allocation never commits.
  for (const entry of proposal.legs) {
    await client.query("INSERT INTO relay.item_reservations(session_id,proposal_id,item_id,state,expires_at) VALUES($1,$2,$3,'active',$4)", [workspace.session.id, proposal.id, entry.giveItemId, proposal.expiresAt]);
    await client.query("INSERT INTO relay.member_reservations(session_id,proposal_id,member_id,state,expires_at) VALUES($1,$2,$3,'active',$4)", [workspace.session.id, proposal.id, entry.memberId, proposal.expiresAt]);
  }
  await client.query("UPDATE relay.items SET state='reserved',held_by_proposal_id=$2 WHERE session_id=$1 AND id=ANY($3::text[])", [workspace.session.id, proposal.id, proposal.legs.map((entry) => entry.giveItemId)]);
  await client.query("UPDATE relay.proposals SET status='reserved',reserved_at=now() WHERE session_id=$1 AND id=$2", [workspace.session.id, proposal.id]);
  for (const other of workspace.proposals.filter((entry) => entry.id !== proposal.id && entry.status === "proposed" && entry.legs.some((otherLeg) => proposal.legs.some((own) => own.memberId === otherLeg.memberId || own.giveItemId === otherLeg.giveItemId)))) {
    await cancelProposal(client, workspace.session.id, other, "invalidated", "Another fully confirmed exchange reserved a participating member or copy.");
  }
  const evidenceId = await evidence(client, workspace.session.id, "reservation", "All-party confirmation, atomic reservation", "Every affected member confirmed the same proposal version. Unique PostgreSQL constraints now hold every exact copy and every member together. Physical completion has not occurred.", { proposalId: proposal.id, version: proposal.version, memberIds: proposal.legs.map((entry) => entry.memberId), itemIds: proposal.legs.map((entry) => entry.giveItemId), itemAndMemberUniqueness: true });
  await event(client, workspace.session.id, "proposal.reserved", proposal.id, "All members confirmed; every copy and member is reserved atomically.", { evidenceId });
  return "Everyone confirmed. Copies are reserved; bring the whole set to the coordinator for inspection.";
}

async function receive(client: PoolClient, workspace: Workspace, command: Extract<Command, { type: "receive" }>) {
  const proposal = proposalById(workspace, command.proposalId);
  const conditionDispute = proposal.status === "disputed" && proposal.disputeKind === "condition";
  assertDomain(["reserved", "handoff_ready"].includes(proposal.status) || conditionDispute, "HANDOFF_NOT_READY", "All members must confirm and reserve this exchange before the coordinator receives copies. Withdrawal or expired custody requires coordinator review.");
  assertDomain(proposal.legs.some((leg) => leg.giveItemId === command.itemId), "ITEM_NOT_IN_EXCHANGE", "That copy is not part of this exchange.", 400);
  const inspectorId = workspace.session.mode === "sample" ? "jo" : workspace.currentMemberId;
  const coordinator = await client.query("SELECT 1 FROM relay.members WHERE session_id=$1 AND id=$2 AND role='coordinator' AND active", [workspace.session.id, inspectorId]);
  assertDomain(coordinator.rows.length, "COORDINATOR_UNAVAILABLE", "An active authenticated coordinator is required.");
  const existing = proposal.receipts.find((receipt) => receipt.itemId === command.itemId);
  if (existing) {
    if (existing.conditionAccepted === command.conditionAccepted) return "This copy is already recorded at the hub.";
    assertDomain(conditionDispute && !existing.conditionAccepted && command.conditionAccepted, "RECEIPT_CONFLICT", "The recorded inspection differs. Use explicit reinspection of a rejected copy; an accepted receipt cannot be silently changed.");
    assertDomain(proposal.expiresAt > new Date().toISOString(), "PROPOSAL_EXPIRED", "The reserved exchange window expired. Coordinator custody must be resolved before a new exchange.");
    const rejectedItem = itemById(workspace, command.itemId);
    assertDomain(rejectedItem.heldByProposalId === proposal.id && rejectedItem.state === "disputed", "RESERVATION_CONFLICT", "This rejected copy no longer belongs to the complete reserved exchange.");
    await client.query("UPDATE relay.handoff_receipts SET condition_accepted=true,received_at=now(),inspector_id=$4 WHERE session_id=$1 AND proposal_id=$2 AND item_id=$3 AND NOT condition_accepted", [workspace.session.id, proposal.id, command.itemId, inspectorId]);
  } else {
    await client.query("INSERT INTO relay.handoff_receipts(session_id,proposal_id,item_id,inspector_id,condition_accepted) VALUES($1,$2,$3,$4,$5)", [workspace.session.id, proposal.id, command.itemId, inspectorId, command.conditionAccepted]);
  }
  await client.query("UPDATE relay.items SET state=$3 WHERE session_id=$1 AND id=$2", [workspace.session.id, command.itemId, command.conditionAccepted ? "at_hub" : "disputed"]);
  const inspections = (await client.query<{ accepted: string; rejected: string }>("SELECT count(*) FILTER(WHERE condition_accepted) AS accepted,count(*) FILTER(WHERE NOT condition_accepted) AS rejected FROM relay.handoff_receipts WHERE session_id=$1 AND proposal_id=$2", [workspace.session.id, proposal.id])).rows[0];
  if (Number(inspections.rejected) > 0) {
    await client.query("UPDATE relay.proposals SET status='disputed',dispute_kind='condition',withdrawal_reason='A copy did not pass coordinator condition inspection.' WHERE session_id=$1 AND id=$2", [workspace.session.id, proposal.id]);
  } else {
    await client.query("UPDATE relay.proposals SET status=$3,withdrawal_reason=NULL,dispute_kind=NULL WHERE session_id=$1 AND id=$2", [workspace.session.id, proposal.id, Number(inspections.accepted) === proposal.legs.length ? "handoff_ready" : "reserved"]);
  }
  const evidenceId = await evidence(client, workspace.session.id, "receipt", existing ? "Explicit coordinator reinspection" : command.conditionAccepted ? "Coordinator receipt and inspection" : "Condition discrepancy freezes handoff", workspace.session.mode === "sample" ? "The session owner explicitly role-played Jo's receipt inspection. A recorded receipt is distinct from releasing the complete exchange. Previous failed inspection evidence remains in the audit trail." : "The coordinator’s authenticated session recorded inspection and receipt of this exact copy. It is a coordinator-attested record; prior failed inspections remain in the audit trail. Receipt alone does not release any copy.", { proposalId: proposal.id, itemId: command.itemId, inspectorId, conditionAccepted: command.conditionAccepted, previousConditionAccepted: existing?.conditionAccepted ?? null, reinspection: !!existing, rolePlayed: workspace.session.mode === "sample" });
  await event(client, workspace.session.id, existing ? "handoff.reinspected" : command.conditionAccepted ? "handoff.received" : "handoff.disputed", proposal.id, existing ? "The coordinator explicitly reinspected a rejected copy; the previous discrepancy remains in evidence." : command.conditionAccepted ? "The coordinator recorded inspection and receipt of one copy." : "A failed condition inspection froze redistribution for the whole exchange.", { itemId: command.itemId, evidenceId, inspectorId });
  return Number(inspections.rejected) ? "Condition discrepancy recorded. The whole exchange is frozen; no copies can be released." : Number(inspections.accepted) === proposal.legs.length ? "Every copy passed inspection. The coordinator can now release the complete set together." : "Receipt recorded. Keep all copies at the desk until the complete set is inspected.";
}

async function complete(client: PoolClient, workspace: Workspace, proposalId: string) {
  const proposal = proposalById(workspace, proposalId);
  if (proposal.status === "completed") return "This exchange is already complete.";
  assertDomain(proposal.status === "handoff_ready", "HANDOFF_INCOMPLETE", "The coordinator must inspect and receive every copy before releasing the exchange.");
  validateProposal(workspace, proposal);
  assertDomain(proposal.legs.every((leg) => leg.confirmed && proposal.receipts.some((receipt) => receipt.itemId === leg.giveItemId && receipt.conditionAccepted && !receipt.releasedAt)), "HANDOFF_INCOMPLETE", "Every exact copy needs an accepted, unreleased coordinator receipt.");
  const held = (await client.query<{ count: string }>("SELECT count(*) FROM relay.item_reservations WHERE session_id=$1 AND proposal_id=$2 AND state='active'", [workspace.session.id, proposal.id])).rows[0];
  assertDomain(Number(held.count) === proposal.legs.length, "RESERVATION_CONFLICT", "The full reservation is no longer valid. Coordinator review is required.");
  await client.query("UPDATE relay.handoff_receipts SET released_at=now() WHERE session_id=$1 AND proposal_id=$2", [workspace.session.id, proposal.id]);
  await client.query("UPDATE relay.items SET state='exchanged',held_by_proposal_id=NULL WHERE session_id=$1 AND id=ANY($2::text[])", [workspace.session.id, proposal.legs.map((leg) => leg.giveItemId)]);
  await client.query("UPDATE relay.item_reservations SET state='completed' WHERE session_id=$1 AND proposal_id=$2 AND state='active'", [workspace.session.id, proposal.id]);
  await client.query("UPDATE relay.member_reservations SET state='completed' WHERE session_id=$1 AND proposal_id=$2 AND state='active'", [workspace.session.id, proposal.id]);
  await client.query("UPDATE relay.approvals SET status=CASE WHEN id=ANY($3::uuid[]) THEN 'consumed' ELSE 'revoked' END WHERE session_id=$1 AND status='active' AND (give_item_id=ANY($2::text[]) OR receive_item_id=ANY($2::text[]))", [workspace.session.id, proposal.legs.map((leg) => leg.giveItemId), proposal.legs.map((leg) => leg.approvalId)]);
  await client.query("UPDATE relay.proposals SET status='completed',completed_at=now() WHERE session_id=$1 AND id=$2", [workspace.session.id, proposal.id]);
  const sample = workspace.session.mode === "sample";
  const evidenceId = await evidence(client, workspace.session.id, "release", sample ? "A completed sample handoff" : "Coordinator-attested complete handoff", sample ? "All exact copies were received, accepted, and then released together by the role-played coordinator. This is a fictional session outcome, not evidence of a real pilot or Qloo effectiveness." : "The coordinator’s scoped session recorded release of the complete inspected set to the assigned recipients. This is a coordinator-attested outcome, not an independently observed exchange or a measured Qloo effect.", { proposalId: proposal.id, memberCount: proposal.legs.length, itemIds: proposal.legs.map((leg) => leg.giveItemId), coordinatorId: sample ? "jo" : workspace.currentMemberId, rolePlayed: sample, dataOrigin: workspace.session.dataOrigin, independentlyObserved: false });
  await event(client, workspace.session.id, "handoff.completed", proposal.id, `Recorded release of the complete exchange for ${proposal.legs.length} members.`, { evidenceId, dataOrigin: workspace.session.dataOrigin });
  return sample ? "Sample exchange complete. Every copy was inspected before the whole set was released." : "Complete handoff recorded by the coordinator. Every copy passed inspection before release.";
}
