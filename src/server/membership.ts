import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CommunityInvite, MembershipCommand } from "../domain/membership";
import { assertDomain } from "../domain/errors";
import type { ExchangeTerms } from "../domain/types";
import { withTransaction } from "./db";
import { cancelProposal, event, resolveSessionAccess, SESSION_LIFETIME_SECONDS, type SessionAccess } from "./service";
import { loadWorkspace } from "./workspace";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const digestObject = (value: unknown) => digest(JSON.stringify(value));
const derive = (secret: string, purpose: string) => createHmac("sha256", secret).update(purpose).digest("base64url");
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase();

interface InviteRow {
  id: string; session_id: string; token_hash: string; label: string; role: "member" | "coordinator";
  created_at: Date; expires_at: Date; revoked_at: Date | null; used_at: Date | null; used_by: string | null;
  access_id: string | null; join_key_hash: string | null; join_command_hash: string | null; command_hash: string;
}

function publicInvite(row: InviteRow): CommunityInvite {
  return { id: row.id, label: row.label, role: row.role, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(), status: row.revoked_at ? "revoked" : row.used_at ? "used" : row.expires_at <= new Date() ? "expired" : "available" };
}

function assertCoordinator(access: SessionAccess) {
  assertDomain(access.mode === "private" && access.role === "coordinator", "COORDINATOR_REQUIRED", "Only an authenticated coordinator can manage this private community.", 403);
}

async function addAccess(client: PoolClient, sessionId: string, memberId: string, displayName: string, role: "member" | "coordinator", token: string, expiresAt: Date) {
  const id = randomUUID();
  await client.query("INSERT INTO relay.members(session_id,id,name,initials,bio,color,role) VALUES($1,$2,$3,$4,$5,$6,$7)", [sessionId, memberId, displayName, initials(displayName), "Invited guest · self-reported display name", role === "coordinator" ? "#626d51" : "#164c37", role]);
  await client.query("INSERT INTO relay.access_sessions(id,session_id,member_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)", [id, sessionId, memberId, digest(token), expiresAt]);
  return id;
}

export async function createPrivateCommunity(sourceToken: string, command: Extract<MembershipCommand, { type: "createCommunity" }>, key: string) {
  return withTransaction(async (client) => {
    const source = await resolveSessionAccess(client, sourceToken);
    const commandHash = digestObject(command);
    const nextToken = derive(sourceToken, `relay-private-create-v1:${key}:${commandHash}`);
    const replay = (await client.query<{ command_hash: string; target_session_id: string; access_id: string }>("SELECT * FROM relay.access_bootstraps WHERE source_token_hash=$1 AND key=$2", [digest(sourceToken), key])).rows[0];
    if (replay) {
      assertDomain(replay.command_hash === commandHash, "IDEMPOTENCY_CONFLICT", "That request key was already used for another community.");
      const credential = (await client.query<{ token_hash: string; member_id: string }>("SELECT token_hash,member_id FROM relay.access_sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>now()", [replay.access_id])).rows[0];
      assertDomain(credential, "ACCESS_REVOKED", "The created community access has expired or was revoked.", 401);
      const token = credential.token_hash === digest(sourceToken) ? sourceToken : nextToken;
      assertDomain(credential.token_hash === digest(token), "IDEMPOTENCY_CONFLICT", "Use the original browser session to retry community creation.");
      return { token, workspace: await loadWorkspace(client, replay.target_session_id, credential.member_id) };
    }
    const sessionId = randomUUID();
    const memberId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_SECONDS * 1000);
    const rawTerms: Omit<ExchangeTerms, "hash"> = {
      version: "relay-private-v1", hubName: command.communityName, location: command.location, handoffWindow: command.handoffWindow,
      rules: [
        "Exchange only the exact copies, editions, and conditions shown in your approval.",
        "An approval states a possible trade. Every participant must separately confirm the complete exchange before reservation.",
        "Bring each copy to the community coordinator. No copy is released before the whole set passes inspection.",
        "You may withdraw. A changed exchange needs fresh confirmation; withdrawal after receipt freezes release for coordinator review.",
        "Names and ownership are self-reported. Share this community only with people you intend to invite.",
      ],
    };
    const terms = { ...rawTerms, hash: digestObject(rawTerms) };
    await client.query("INSERT INTO relay.sessions(id,token_hash,display_name,terms,created_at,expires_at,mode) VALUES($1,$2,$3,$4,$5,$6,'private')", [sessionId, digest(randomBytes(32).toString("base64url")), command.communityName, terms, now, expiresAt]);
    const credentialId = await addAccess(client, sessionId, memberId, command.displayName, "coordinator", nextToken, expiresAt);
    for (const tokenHash of [digest(sourceToken), digest(nextToken)]) await client.query("INSERT INTO relay.access_bootstraps(source_token_hash,key,command_hash,target_session_id,access_id) VALUES($1,$2,$3,$4,$5)", [tokenHash, key, commandHash, sessionId, credentialId]);
    await client.query("INSERT INTO relay.evidence(session_id,id,kind,source,title,summary,details) VALUES($1,$2,'session','participant-recorded',$3,$4,$5)", [sessionId, randomUUID(), "A private, invite-only community", "The community began empty. Each member joins through their own single-use invitation; all listings, exact approvals, and confirmations must be recorded by that member’s scoped session. Guest display names are self-reported.", { createdBy: memberId, initialItems: 0, initialApprovals: 0, authentication: "invite-session", identityVerified: false, sourceSessionMode: source.mode }]);
    await event(client, sessionId, "community.created", sessionId, "Created a private community with no seeded inventory or approvals.", { coordinatorId: memberId });
    return { token: nextToken, workspace: await loadWorkspace(client, sessionId, memberId) };
  });
}

export async function joinPrivateCommunity(command: Extract<MembershipCommand, { type: "joinCommunity" }>, key: string) {
  return withTransaction(async (client) => {
    assertDomain(/^[A-Za-z0-9_-]{43}$/.test(command.inviteCode), "INVITE_UNAVAILABLE", "This invitation is invalid, expired, already used, or revoked.", 403);
    const invitation = (await client.query<{ session_id: string }>("SELECT session_id FROM relay.community_invites WHERE token_hash=$1", [digest(command.inviteCode)])).rows[0];
    assertDomain(invitation, "INVITE_UNAVAILABLE", "This invitation is invalid, expired, already used, or revoked.", 403);
    const session = (await client.query<{ expires_at: Date }>("SELECT expires_at FROM relay.sessions WHERE id=$1 AND mode='private' FOR UPDATE", [invitation.session_id])).rows[0];
    assertDomain(session && session.expires_at > new Date(), "INVITE_UNAVAILABLE", "This invitation is invalid, expired, already used, or revoked.", 403);
    const invite = (await client.query<InviteRow>("SELECT * FROM relay.community_invites WHERE token_hash=$1 FOR UPDATE", [digest(command.inviteCode)])).rows[0];
    const commandHash = digestObject({ displayName: command.displayName, acceptedRules: command.acceptedRules });
    const token = derive(command.inviteCode, `relay-private-join-v1:${key}:${commandHash}`);
    assertDomain(invite && !invite.revoked_at, "INVITE_UNAVAILABLE", "This invitation is invalid, expired, already used, or revoked.", 403);
    if (invite.used_at) {
      assertDomain(invite.join_key_hash === digest(key) && invite.join_command_hash === commandHash && invite.used_by, "INVITE_UNAVAILABLE", "This invitation is invalid, expired, already used, or revoked.", 403);
      const access = await resolveSessionAccess(client, token);
      return { token, workspace: await loadWorkspace(client, access.id, access.memberId, access.credentialExpiresAt) };
    }
    assertDomain(invite.expires_at > new Date(), "INVITE_UNAVAILABLE", "This invitation is invalid, expired, already used, or revoked.", 403);
    const memberCount = Number((await client.query<{ count: string }>("SELECT count(*) FROM relay.members WHERE session_id=$1 AND active", [invite.session_id])).rows[0].count);
    assertDomain(memberCount < 30, "COMMUNITY_LIMIT", "This private event supports up to thirty active guest sessions.", 422);
    const memberId = randomUUID();
    const credentialId = await addAccess(client, invite.session_id, memberId, command.displayName, invite.role, token, session.expires_at);
    await client.query("UPDATE relay.community_invites SET used_at=now(),used_by=$2,access_id=$3,join_key_hash=$4,join_command_hash=$5 WHERE id=$1", [invite.id, memberId, credentialId, digest(key), commandHash]);
    await event(client, invite.session_id, "member.joined", memberId, `${command.displayName} joined through an individual invitation.`, { memberId, role: invite.role, identityVerified: false });
    return { token, workspace: await loadWorkspace(client, invite.session_id, memberId) };
  });
}

export async function listCommunityInvites(token: string) {
  return withTransaction(async (client) => {
    const access = await resolveSessionAccess(client, token);
    assertCoordinator(access);
    const rows = (await client.query<InviteRow>("SELECT * FROM relay.community_invites WHERE session_id=$1 ORDER BY created_at DESC LIMIT 100", [access.id])).rows;
    return { invites: rows.map(publicInvite) };
  });
}

export async function manageCommunity(token: string, command: Extract<MembershipCommand, { type: "createInvite" | "revokeInvite" | "revokeMember" }>, key: string) {
  return withTransaction(async (client) => {
    const access = await resolveSessionAccess(client, token);
    assertCoordinator(access);
    if (command.type === "createInvite") {
      const creationKey = digest(`${access.memberId}:${key}`);
      const commandHash = digestObject(command);
      const code = derive(token, `relay-private-invite-v1:${key}:${commandHash}`);
      let invite = (await client.query<InviteRow>("SELECT * FROM relay.community_invites WHERE session_id=$1 AND creation_key=$2", [access.id, creationKey])).rows[0];
      if (invite) assertDomain(invite.command_hash === commandHash, "IDEMPOTENCY_CONFLICT", "That request key was already used for another invitation.");
      else {
        const available = Number((await client.query<{ count: string }>("SELECT count(*) FROM relay.community_invites WHERE session_id=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now()", [access.id])).rows[0].count);
        assertDomain(available < 30, "INVITE_LIMIT", "Revoke an unused invitation before creating more than thirty open invites.", 422);
        const expiresAt = new Date(Math.min(access.expires_at.getTime(), Date.now() + command.expiresInHours * 3_600_000));
        invite = (await client.query<InviteRow>("INSERT INTO relay.community_invites(id,session_id,token_hash,label,role,created_by,creation_key,command_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *", [randomUUID(), access.id, digest(code), command.label, command.role, access.memberId, creationKey, commandHash, expiresAt])).rows[0];
        await event(client, access.id, "invite.created", invite.id, `Created a single-use ${command.role} invitation.`, { inviteId: invite.id, createdBy: access.memberId, expiresAt: expiresAt.toISOString() });
      }
      return { workspace: await loadWorkspace(client, access.id, access.memberId), invite: { ...publicInvite(invite), code }, notice: "Invitation created. Share this one-use link privately; it grants the stated role." };
    }
    if (command.type === "revokeInvite") {
      const changed = await client.query("UPDATE relay.community_invites SET revoked_at=now() WHERE session_id=$1 AND id=$2 AND used_at IS NULL AND revoked_at IS NULL RETURNING id", [access.id, command.inviteId]);
      const exists = await client.query("SELECT 1 FROM relay.community_invites WHERE session_id=$1 AND id=$2", [access.id, command.inviteId]);
      assertDomain(exists.rows.length, "INVITE_NOT_FOUND", "That invitation is not in this community.", 404);
      if (changed.rows.length) await event(client, access.id, "invite.revoked", command.inviteId, "Revoked an unused community invitation.", { revokedBy: access.memberId });
      return { workspace: await loadWorkspace(client, access.id, access.memberId), notice: "Unused invitation revoked. Used invitations are managed through member access." };
    }
    assertDomain(command.memberId !== access.memberId, "CANNOT_REVOKE_SELF", "Use Leave this browser to sign out. You cannot revoke your own coordinator membership.", 403);
    const target = (await client.query<{ active: boolean; role: "member" | "coordinator" }>("SELECT active,role FROM relay.members WHERE session_id=$1 AND id=$2", [access.id, command.memberId])).rows[0];
    assertDomain(target, "MEMBER_NOT_FOUND", "That member is not in this community.", 404);
    if (target.active) {
      const workspace = await loadWorkspace(client, access.id, access.memberId);
      for (const proposal of workspace.proposals.filter((entry) => ["proposed", "reserved", "handoff_ready"].includes(entry.status) && entry.legs.some((leg) => leg.memberId === command.memberId))) await cancelProposal(client, access.id, proposal, "withdrawn", "The coordinator revoked a participating membership. Fresh consent is required.", command.memberId);
      await client.query("UPDATE relay.members SET active=false WHERE session_id=$1 AND id=$2", [access.id, command.memberId]);
      await client.query("UPDATE relay.access_sessions SET revoked_at=now() WHERE session_id=$1 AND member_id=$2 AND revoked_at IS NULL", [access.id, command.memberId]);
      await client.query("UPDATE relay.community_invites SET revoked_at=now() WHERE session_id=$1 AND created_by=$2 AND used_at IS NULL AND revoked_at IS NULL", [access.id, command.memberId]);
      await client.query("UPDATE relay.approvals SET status='revoked' WHERE session_id=$1 AND status='active' AND (member_id=$2 OR give_item_id IN (SELECT id FROM relay.items WHERE session_id=$1 AND owner_id=$2) OR receive_item_id IN (SELECT id FROM relay.items WHERE session_id=$1 AND owner_id=$2))", [access.id, command.memberId]);
      await client.query("UPDATE relay.items SET state='withdrawn',held_by_proposal_id=NULL,version=version+1 WHERE session_id=$1 AND owner_id=$2 AND state='available'", [access.id, command.memberId]);
      await client.query("UPDATE relay.agent_jobs SET cancel_requested=true WHERE session_id=$1 AND member_id=$2 AND status IN ('queued','running')", [access.id, command.memberId]);
      await event(client, access.id, "member.revoked", command.memberId, "The coordinator revoked a member’s access and stopped affected exchanges.", { memberId: command.memberId, revokedBy: access.memberId, reason: command.reason });
    }
    return { workspace: await loadWorkspace(client, access.id, access.memberId), notice: "Member access revoked. Affected exchanges were stopped; received copies remain frozen for custody review." };
  });
}

export async function endBrowserAccess(token: string) {
  await withTransaction(async (client) => {
    // Signing out must still work for an already revoked/expired capability.
    const row = (await client.query<{ session_id: string }>("SELECT session_id FROM relay.access_sessions WHERE token_hash=$1", [digest(token)])).rows[0];
    if (!row) return;
    await client.query("SELECT 1 FROM relay.sessions WHERE id=$1 FOR UPDATE", [row.session_id]);
    await client.query("UPDATE relay.access_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE token_hash=$1", [digest(token)]);
  });
}
