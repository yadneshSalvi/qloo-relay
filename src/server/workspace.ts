import type { PoolClient } from "pg";
import { DomainError } from "../domain/errors";
import type { Approval, DiscoveryRun, DomainEvent, Evidence, ExchangeTerms, HandoffReceipt, Item, Member, Preferences, Proposal, ProposalLeg, Work, Workspace } from "../domain/types";

export interface SessionRow {
  id: string; token_hash: string; display_name: string; terms: ExchangeTerms;
  created_at: Date; expires_at: Date; next_sequence: string;
}
interface ItemRow {
  id: string; work_id: string; owner_id: string; edition: string; condition: Item["condition"]; notes: string;
  attested: boolean; version: number; state: Item["state"]; held_by_proposal_id: string | null; created_at: Date;
}
interface ApprovalRow {
  id: string; member_id: string; give_item_id: string; receive_item_id: string; give_version: number; receive_version: number;
  terms_version: string; terms_hash: string; preference_rank: number; status: Approval["status"];
  expires_at: Date; created_at: Date; authored: boolean; evidence_id: string | null;
}
interface ProposalRow {
  id: string; version: number; status: Proposal["status"]; terms: ExchangeTerms; expires_at: Date; created_at: Date;
  reserved_at: Date | null; completed_at: Date | null; withdrawn_by: string | null; withdrawal_reason: string | null; repair_of: string | null; dispute_kind: Proposal["disputeKind"];
}
interface LegRow {
  proposal_id: string; member_id: string; give_item_id: string; receive_item_id: string; approval_id: string;
  give_version: number; receive_version: number; confirmed_at: Date | null;
}
interface ReceiptRow { proposal_id: string; item_id: string; received_at: Date; inspector_id: string; condition_accepted: boolean; released_at: Date | null }
const iso = (date: Date) => date.toISOString();

export async function loadWorkspace(client: PoolClient, sessionId: string): Promise<Workspace> {
  const session = (await client.query<SessionRow>("SELECT * FROM relay.sessions WHERE id=$1", [sessionId])).rows[0];
  if (!session) throw new DomainError("SESSION_EXPIRED", "This sample session has ended. Start a fresh exchange.", 401);
  const works = (await client.query<{ data: Work }>("SELECT data FROM relay.catalog_works ORDER BY id")).rows.map((row) => row.data);
  const members: Member[] = (await client.query<{ id: string; name: string; initials: string; bio: string; color: string; role: Member["role"] }>(
    "SELECT id,name,initials,bio,color,role FROM relay.members WHERE session_id=$1 ORDER BY CASE WHEN id='you' THEN 0 WHEN role='coordinator' THEN 2 ELSE 1 END,id", [sessionId],
  )).rows.map((row) => ({ ...row, isYou: row.id === "you", dataOrigin: "authored-sample" }));
  const items: Item[] = (await client.query<ItemRow>("SELECT * FROM relay.items WHERE session_id=$1 ORDER BY created_at,id", [sessionId])).rows.map((row) => ({
    id: row.id, workId: row.work_id, ownerId: row.owner_id, edition: row.edition, condition: row.condition, notes: row.notes,
    attested: row.attested, version: row.version, state: row.state, heldByProposalId: row.held_by_proposal_id,
    createdAt: iso(row.created_at), dataOrigin: "authored-sample",
  }));
  const preference = (await client.query<{ version: number; seed_work_ids: string[]; novelty: number; created_at: Date }>(
    "SELECT * FROM relay.preference_versions WHERE session_id=$1 ORDER BY version DESC LIMIT 1", [sessionId],
  )).rows[0];
  const preferences: Preferences = { version: preference.version, seedWorkIds: preference.seed_work_ids, novelty: preference.novelty, updatedAt: iso(preference.created_at) };
  const approvals: Approval[] = (await client.query<ApprovalRow>("SELECT * FROM relay.approvals WHERE session_id=$1 ORDER BY created_at,id", [sessionId])).rows.map((row) => ({
    id: row.id, memberId: row.member_id, giveItemId: row.give_item_id, receiveItemId: row.receive_item_id,
    giveVersion: row.give_version, receiveVersion: row.receive_version, termsVersion: row.terms_version, termsHash: row.terms_hash,
    preferenceRank: row.preference_rank, status: row.status, expiresAt: iso(row.expires_at), createdAt: iso(row.created_at),
    authored: row.authored, evidenceId: row.evidence_id,
  }));
  const legs = (await client.query<LegRow>(`
    SELECT l.*,c.created_at AS confirmed_at FROM relay.proposal_legs l
    JOIN relay.proposals p ON p.session_id=l.session_id AND p.id=l.proposal_id
    LEFT JOIN relay.confirmations c ON c.session_id=l.session_id AND c.proposal_id=l.proposal_id AND c.member_id=l.member_id AND c.version=p.version
    WHERE l.session_id=$1 ORDER BY l.proposal_id,l.ordinal`, [sessionId])).rows;
  const receipts = (await client.query<ReceiptRow>("SELECT * FROM relay.handoff_receipts WHERE session_id=$1 ORDER BY received_at,item_id", [sessionId])).rows;
  const proposals: Proposal[] = (await client.query<ProposalRow>("SELECT * FROM relay.proposals WHERE session_id=$1 ORDER BY created_at DESC,id", [sessionId])).rows.map((row) => ({
    id: row.id, version: row.version, status: row.status, terms: row.terms, expiresAt: iso(row.expires_at), createdAt: iso(row.created_at),
    reservedAt: row.reserved_at ? iso(row.reserved_at) : null, completedAt: row.completed_at ? iso(row.completed_at) : null,
    withdrawnBy: row.withdrawn_by, withdrawalReason: row.withdrawal_reason, disputeKind: row.dispute_kind, repairOf: row.repair_of, dataOrigin: "authored-sample",
    legs: legs.filter((leg) => leg.proposal_id === row.id).map((leg): ProposalLeg => ({
      memberId: leg.member_id, giveItemId: leg.give_item_id, receiveItemId: leg.receive_item_id, approvalId: leg.approval_id,
      giveVersion: leg.give_version, receiveVersion: leg.receive_version, confirmed: !!leg.confirmed_at, confirmedAt: leg.confirmed_at ? iso(leg.confirmed_at) : null,
    })),
    receipts: receipts.filter((receipt) => receipt.proposal_id === row.id).map((receipt): HandoffReceipt => ({
      itemId: receipt.item_id, receivedAt: iso(receipt.received_at), inspectorId: receipt.inspector_id,
      conditionAccepted: receipt.condition_accepted, releasedAt: receipt.released_at ? iso(receipt.released_at) : null,
    })),
  }));
  const discovery = (await client.query<{ data: DiscoveryRun }>("SELECT data FROM relay.discovery_runs WHERE session_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [sessionId])).rows[0]?.data ?? null;
  const evidence: Evidence[] = (await client.query<{ id: string; kind: Evidence["kind"]; source: Evidence["source"]; title: string; summary: string; details: Record<string, unknown>; created_at: Date }>(
    "SELECT * FROM relay.evidence WHERE session_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100", [sessionId],
  )).rows.map((row) => ({ id: row.id, kind: row.kind, source: row.source, title: row.title, summary: row.summary, details: row.details, createdAt: iso(row.created_at) }));
  const events: DomainEvent[] = (await client.query<{ id: string; sequence: string; type: string; aggregate_id: string; summary: string; created_at: Date }>(
    "SELECT * FROM relay.domain_events WHERE session_id=$1 ORDER BY sequence DESC LIMIT 100", [sessionId],
  )).rows.map((row) => ({ id: row.id, sequence: Number(row.sequence), type: row.type, aggregateId: row.aggregate_id, summary: row.summary, createdAt: iso(row.created_at) })).reverse();
  const savedItemIds = (await client.query<{ item_id: string }>("SELECT item_id FROM relay.saved_items WHERE session_id=$1 ORDER BY created_at,item_id", [sessionId])).rows.map((row) => row.item_id);
  const dismissals = (await client.query<{ item_id: string; reason: string; created_at: Date }>("SELECT * FROM relay.dismissals WHERE session_id=$1 ORDER BY created_at,item_id", [sessionId])).rows.map((row) => ({ itemId: row.item_id, reason: row.reason, createdAt: iso(row.created_at) }));
  return {
    session: { id: session.id, displayName: session.display_name, mode: "sample", dataOrigin: "authored-sample", canRolePlay: true, createdAt: iso(session.created_at), expiresAt: iso(session.expires_at) },
    currentMemberId: "you", members, works, items, preferences, terms: session.terms, approvals, savedItemIds, dismissals, proposals, discovery, evidence, events,
    stats: {
      offeredItems: items.length, availableItems: items.filter((item) => item.state === "available").length,
      activeApprovals: approvals.filter((approval) => approval.status === "active").length,
      proposedCycles: proposals.filter((proposal) => proposal.status === "proposed").length,
      reservedCycles: proposals.filter((proposal) => ["reserved", "handoff_ready", "disputed"].includes(proposal.status)).length,
      completedCycles: proposals.filter((proposal) => proposal.status === "completed").length,
      completedMembers: new Set(proposals.filter((proposal) => proposal.status === "completed").flatMap((proposal) => proposal.legs.map((leg) => leg.memberId))).size,
      confirmedMembers: proposals.filter((proposal) => ["proposed", "reserved", "handoff_ready"].includes(proposal.status)).flatMap((proposal) => proposal.legs).filter((leg) => leg.confirmed).length,
      dataOrigin: "authored-sample",
    },
    capabilities: { discovery: "authored-sample", liveQloo: process.env.QLOO_API_KEY ? "mapping-required" : "unconfigured", rolePlay: true, outboundMessaging: false },
  };
}
