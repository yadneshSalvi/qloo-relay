"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Copy, DoorOpen, KeyRound, Link2, LockKeyhole, MapPin, ShieldCheck, UserRoundPlus, Users, X } from "lucide-react";
import type { CommunityInvite } from "@/domain/membership";
import type { Workspace } from "@/domain/types";
import { useRelay } from "./relay-provider";
import { Avatar, BusyLabel, Modal, niceDate } from "./ui";

export function CommunityView() {
  const { workspace, membership, busy, error } = useRelay();
  const [inviteCode, setInviteCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinedTerms, setJoinedTerms] = useState(false);
  const [creating, setCreating] = useState(false);
  const [communityName, setCommunityName] = useState("");
  const [coordinatorName, setCoordinatorName] = useState("");
  const [location, setLocation] = useState("");
  const [handoffWindow, setHandoffWindow] = useState("");
  const [createTerms, setCreateTerms] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const code = new URLSearchParams(window.location.hash.slice(1)).get("invite");
    if (!code) return;
    // Fragments stay out of request logs. Remove the capability from browser history after capture.
    const timer = setTimeout(() => {
      setInviteCode(code);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const signedIn = workspace?.session.mode === "private";
  const leave = async () => { const result = await membership({ type: "leaveBrowser" }); if (result) { setLeaveOpen(false); router.push("/discover"); } };

  return <div className="community-page page-enter">
    <header className="page-header"><div><span className="eyebrow">GOOD THINGS. YOUR PEOPLE.</span><h1>{signedIn ? <>One community.<br/><em className="soft-em">Everyone’s own choice.</em></> : <>Make room<br/><em className="soft-em">for your people.</em></>}</h1><p>{signedIn ? "A shared shelf, individual decisions, and one careful handoff. Every participant acts through their own invited browser session." : "Join an invited exchange, or bring a small community together. Start with your own copies and discover what could come around."}</p></div><span className="community-seal"><Users size={31} strokeWidth={1.2}/><span>INVITE ONLY<br/>PERSON BY PERSON</span></span></header>

    {error && !workspace ? <div className="callout caution"><LockKeyhole size={20}/><div><strong>Your previous session is unavailable.</strong><p>{error}</p><button className="text-link" disabled={!!busy} onClick={() => void leave()}>Return to the isolated sample <ArrowRight size={14}/></button></div></div> : null}

    {signedIn && workspace ? <CommunityMembers workspace={workspace} onLeave={() => setLeaveOpen(true)}/> : null}

    {!signedIn || inviteCode ? <section className="community-entry-grid">
      <div className="community-entry-card"><span className="settings-icon"><KeyRound size={23}/></span><span className="eyebrow">AN INVITATION TO SOMETHING GOOD</span><h2>Join your community.</h2><p>Use the one-use invitation your coordinator shared with you. Your session only controls the member created when you join.</p><form className="item-form" onSubmit={async (event) => { event.preventDefault(); const result = await membership({ type: "joinCommunity", inviteCode: inviteCode.trim(), displayName: joinName.trim(), acceptedRules: true }); if (result) { setInviteCode(""); router.push(result.workspace.access.role === "coordinator" ? "/community" : "/inventory"); } }}>
        <div className="form-field"><label className="field-label" htmlFor="invite-code">Your invitation code</label><input id="invite-code" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} autoComplete="off" spellCheck={false} required pattern="[A-Za-z0-9_-]{43}" maxLength={43} placeholder="Paste your private code"/><small>Invite links fill this in for you. Never post your code publicly.</small></div>
        <div className="form-field"><label className="field-label" htmlFor="join-name">What should your community call you?</label><input id="join-name" value={joinName} onChange={(event) => setJoinName(event.target.value)} autoComplete="nickname" required minLength={2} maxLength={60} placeholder="Your display name"/></div>
        <div className="community-join-terms"><strong>A clear yes, at every step.</strong><p>Community members see your display name, listings, and exact exchange decisions. Your favorites and saved items stay scoped to your session. Approving a trade, confirming a circle, and recording a handoff are separate actions.</p><label className="check-label"><input type="checkbox" checked={joinedTerms} onChange={(event) => setJoinedTerms(event.target.checked)}/><span>I understand the community visibility and will only list copies I own and can bring. I will review the event’s location and terms before approving a trade.</span></label></div>
        <button className="button primary full-width" disabled={!!busy || !joinedTerms}><BusyLabel busy={busy === "joinCommunity"}>Join with my own session <ArrowRight size={16}/></BusyLabel></button>
      </form><p className="fine-print"><ShieldCheck size={14}/>Invited guest access. Display names and ownership are self-reported.</p></div>
      {!signedIn ? <div className="community-create-card"><span className="community-flower">✳</span><span className="eyebrow">START A SMALL CIRCLE</span><h2>A new chapter.<br/>For your community.</h2><p>Organize a private exchange for people you invite. Your shelf starts empty. Every listing, approval, and confirmation comes from its own participant.</p><ul className="community-principles"><li><Check size={17}/>Single-use invitations with a clear role and expiry.</li><li><Check size={17}/>Individual participant sessions; separate coordinator controls.</li><li><Check size={17}/>No release before every exact copy passes inspection.</li></ul><button className="button primary" onClick={() => setCreating(true)}>Create a private community <UserRoundPlus size={16}/></button><div className="community-sample-link"><span>Just looking around?</span><Link className="text-link" href="/discover">Explore the authored sample <ArrowRight size={14}/></Link></div></div> : null}
    </section> : null}

    <div className="community-limits"><ShieldCheck size={19}/><p><strong>Small, private, and honest about access.</strong> This is invite-based guest access for up to thirty active members. A browser session lasts up to seven days and has no email verification, cross-device account, or account recovery. Losing or signing out of it requires a new invitation; ask your coordinator to revoke the old member. Recorded handoffs are coordinator attestations.</p></div>

    <Modal open={creating} onOpenChange={setCreating} title="A place for good things to come around." description="You’ll coordinate the event. Invite participants separately; coordinator access cannot approve or confirm their trades."><form className="item-form" onSubmit={async (event) => { event.preventDefault(); const result = await membership({ type: "createCommunity", communityName: communityName.trim(), displayName: coordinatorName.trim(), location: location.trim(), handoffWindow: handoffWindow.trim(), acceptedRules: true }); if (result) { setCreating(false); router.push("/community"); } }}>
      <div className="form-field"><label className="field-label" htmlFor="community-name">Community name</label><input id="community-name" value={communityName} onChange={(event) => setCommunityName(event.target.value)} required minLength={2} maxLength={60} placeholder="The Saturday Shelf"/></div>
      <div className="form-field"><label className="field-label" htmlFor="coordinator-name">Your coordinator display name</label><input id="coordinator-name" value={coordinatorName} onChange={(event) => setCoordinatorName(event.target.value)} required minLength={2} maxLength={60} autoComplete="nickname"/></div>
      <div className="form-field"><label className="field-label" htmlFor="community-location">Shared handoff location</label><input id="community-location" value={location} onChange={(event) => setLocation(event.target.value)} required minLength={3} maxLength={160} placeholder="Library foyer · exchange desk"/></div>
      <div className="form-field"><label className="field-label" htmlFor="community-window">Handoff date and time</label><input id="community-window" value={handoffWindow} onChange={(event) => setHandoffWindow(event.target.value)} required minLength={3} maxLength={160} placeholder="31 October, 5–7 pm IST"/><small>Use a date and timezone everyone can understand. Event access expires after seven days.</small></div>
      <label className="check-label"><input type="checkbox" checked={createTerms} onChange={(event) => setCreateTerms(event.target.checked)}/><span>I will share invitations privately, verify copies at the desk, and only record release after the complete set is present and accepted.</span></label>
      <div className="dialog-actions"><button className="button secondary" type="button" onClick={() => setCreating(false)}>Go back</button><button className="button primary" disabled={!!busy || !createTerms}><BusyLabel busy={busy === "createCommunity"}>Create community <ArrowRight size={15}/></BusyLabel></button></div>
    </form></Modal>
    <Modal open={leaveOpen} onOpenChange={setLeaveOpen} title="Leave this browser session?" description="This signs out and revokes this browser’s private access. There is no account recovery. A fresh invitation creates a new member; existing listings and approvals remain under your old member until the coordinator revokes them."><div className="dialog-actions"><button className="button secondary" onClick={() => setLeaveOpen(false)}>Keep my session</button><button className="button danger" disabled={!!busy} onClick={() => void leave()}><BusyLabel busy={busy === "leaveBrowser"}>Sign out of this community <DoorOpen size={16}/></BusyLabel></button></div></Modal>
  </div>;
}

function CommunityMembers({ workspace, onLeave }: { workspace: Workspace; onLeave: () => void }) {
  const { membership, busy, notify } = useRelay();
  const [invites, setInvites] = useState<CommunityInvite[]>([]);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<"member" | "coordinator">("member");
  const [hours, setHours] = useState(24);
  const [newInvite, setNewInvite] = useState<{ code: string; link: string } | null>(null);
  const [revokeMemberId, setRevokeMemberId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const coordinator = workspace.access.role === "coordinator";
  const me = workspace.members.find((member) => member.isYou)!;
  useEffect(() => {
    if (!coordinator) return;
    const controller = new AbortController();
    void fetch("/api/membership", { cache: "no-store", signal: controller.signal }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Invitations could not be loaded."); setInvites(body.invites); setInviteError(null); }).catch((cause) => { if (!controller.signal.aborted) setInviteError(cause instanceof Error ? cause.message : "Invitations could not be loaded."); });
    return () => controller.abort();
  }, [coordinator, workspace.session.id, reload]);
  const copyLink = async () => { if (!newInvite) return; try { await navigator.clipboard.writeText(newInvite.link); notify("Private one-use invitation link copied."); } catch { notify("Clipboard access is unavailable. Select and copy the link below.", "error"); } };
  return <>
    <section className="community-summary"><div><span className="source-pill neutral"><LockKeyhole size={13}/>Private invited community</span><h2>{workspace.session.displayName}</h2><p><MapPin size={15}/>{workspace.terms.location}</p><p>{workspace.terms.handoffWindow}</p></div><div><Avatar member={me}/><span><strong>{me.name}</strong><small>{coordinator ? "Coordinator session" : "Participant session"} · self-reported name</small><small>Access until {niceDate(workspace.access.expiresAt)}</small></span><button className="text-button subtle" onClick={onLeave}>Leave this browser</button></div></section>
    <div className="community-manage-grid"><section className="community-roster"><div className="section-heading"><div><span className="eyebrow">A SMALL CIRCLE OF PEOPLE</span><h2>Everyone has their own part.</h2></div><span className="source-pill neutral">{workspace.members.filter((member) => member.active !== false).length} active</span></div><p>{coordinator ? "Each member’s invitation creates a separate session. Revoking access also stops their active exchanges; copies already at the desk stay frozen." : "Only your session can approve or confirm your trades. Coordinators inspect copies and record handoff release."}</p><div className="member-roster">{workspace.members.map((member) => <div className={`community-member ${member.active === false ? "inactive" : ""}`} key={member.id}><Avatar member={member}/><span><strong>{member.name}{member.isYou ? " (you)" : ""}</strong><small>{member.active === false ? "Access revoked" : member.role === "coordinator" ? "Coordinator" : "Participant"} · guest</small></span>{coordinator && !member.isYou && member.active !== false ? <button className="text-button subtle" onClick={() => { setRevokeMemberId(member.id); setReason(""); }}>Revoke access</button> : null}</div>)}</div><div className="settings-actions"><Link className="button primary" href={coordinator ? "/organizer" : "/inventory"}>{coordinator ? "Open the handoff desk" : "Visit your shelf"}<ArrowRight size={15}/></Link><Link className="text-link" href="/exchanges">View exchanges <ArrowRight size={13}/></Link></div></section>
      {coordinator ? <section className="community-invites"><span className="settings-icon"><Link2 size={23}/></span><span className="eyebrow">PERSON BY PERSON</span><h2>Invite someone in.</h2><p>A one-use link grants the role you choose. Share it directly with its intended guest.</p><form className="item-form" onSubmit={async (event) => { event.preventDefault(); const result = await membership({ type: "createInvite", label: label.trim(), role, expiresInHours: hours }); if (result?.invite) { setNewInvite({ code: result.invite.code, link: `${window.location.origin}/community#invite=${result.invite.code}` }); setLabel(""); setReload((value) => value + 1); } }}>
        <div className="form-field"><label className="field-label" htmlFor="invite-label">A label for your records</label><input id="invite-label" value={label} onChange={(event) => setLabel(event.target.value)} required minLength={2} maxLength={60} placeholder="Saturday guest 1"/></div><div className="community-form-row"><div className="form-field"><label className="field-label" htmlFor="invite-role">Access role</label><select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as "member" | "coordinator")}><option value="member">Participant</option><option value="coordinator">Coordinator</option></select></div><div className="form-field"><label className="field-label" htmlFor="invite-expiry">Invitation expires in</label><select id="invite-expiry" value={hours} onChange={(event) => setHours(Number(event.target.value))}><option value={1}>1 hour</option><option value={24}>24 hours</option><option value={72}>72 hours</option></select></div></div><p className="fine-print">{role === "member" ? "Participants list their own copies and make their own exact trade decisions." : "Coordinators manage invitations, revoke access, inspect copies, and record release. They cannot consent for participants."}</p><button className="button primary full-width" disabled={!!busy}><BusyLabel busy={busy === "createInvite"}>Create one-use invitation <UserRoundPlus size={15}/></BusyLabel></button>
      </form>{newInvite ? <div className="created-invite"><div><strong>Your private invitation is ready.</strong><button className="icon-button" aria-label="Hide invitation code" onClick={() => setNewInvite(null)}><X size={15}/></button></div><label htmlFor="created-invite-link">Share this link privately</label><input id="created-invite-link" value={newInvite.link} readOnly onFocus={(event) => event.target.select()}/><button className="button secondary full-width" onClick={() => void copyLink()}><Copy size={14}/>Copy invitation link</button><details><summary>Copy the code manually</summary><code>{newInvite.code}</code></details><small>Keep this link safe. You can revoke it here; its code will not appear in the invitation list.</small></div> : null}</section> : <aside className="community-next-card"><span className="community-flower">✳</span><span className="eyebrow">YOUR NEXT CHAPTER</span><h2>A shelf to start.<br/>A story to share.</h2><p>List a copy you own, choose your favorites, then explore what other members offer. Every “yes” belongs to you.</p><Link className="button primary" href="/onboarding">Choose your favorites <ArrowRight size={15}/></Link></aside>}
    </div>
    {coordinator ? <section className="community-invite-history"><div className="section-heading"><div><span className="eyebrow">KEEP THE DOOR THOUGHTFUL</span><h2>Your invitations.</h2></div><button className="text-link" onClick={() => setReload((value) => value + 1)}>Refresh</button></div>{inviteError ? <p role="alert">{inviteError}</p> : invites.length ? invites.map((invite) => <div className="community-invite-row" key={invite.id}><span><strong>{invite.label}</strong><small>{invite.role === "member" ? "Participant" : "Coordinator"} · expires {niceDate(invite.expiresAt)}</small></span><span className={`invite-status ${invite.status}`}>{invite.status}</span>{invite.status === "available" ? <button className="text-button subtle" disabled={!!busy} onClick={async () => { if (await membership({ type: "revokeInvite", inviteId: invite.id })) { setNewInvite(null); setReload((value) => value + 1); } }}>Revoke invite</button> : null}</div>) : <p>No invitations yet. Create one for each person you intend to invite.</p>}</section> : null}
    <Modal open={!!revokeMemberId} onOpenChange={(open) => { if (!open) setRevokeMemberId(null); }} title="Revoke this member’s community access?" description="Their browser session will stop working. Their approvals are withdrawn and affected exchanges stop; any received copies remain frozen for coordinator custody review."><form className="item-form" onSubmit={async (event) => { event.preventDefault(); if (!revokeMemberId) return; if (await membership({ type: "revokeMember", memberId: revokeMemberId, reason })) setRevokeMemberId(null); }}><div className="form-field"><label className="field-label" htmlFor="revoke-reason">Reason for the community record</label><textarea id="revoke-reason" value={reason} onChange={(event) => setReason(event.target.value)} required minLength={5} maxLength={500}/></div><div className="dialog-actions"><button className="button secondary" type="button" onClick={() => setRevokeMemberId(null)}>Keep access</button><button className="button danger" disabled={!!busy}><BusyLabel busy={busy === "revokeMember"}>Revoke member access</BusyLabel></button></div></form></Modal>
  </>;
}
