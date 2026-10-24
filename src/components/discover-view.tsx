"use client";

import { useMemo, useState } from "react";
import { APPROVAL_LIFETIME_HOURS } from "@/domain/policy";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownUp, ArrowLeftRight, ArrowRight, ArrowUpRight, Bookmark, Check, ChevronDown, CircleHelp, Heart, Leaf, MapPin, Search, ShieldCheck, SlidersHorizontal, Sparkles, X } from "lucide-react";
import type { Category, Item, Workspace, Work } from "@/domain/types";
import { useRelay, WorkspaceBoundary } from "./relay-provider";
import { CoverArt, heroWorks } from "./art";
import { Avatar, BusyLabel, CategoryIcon, EmptyState, Modal, SampleNote, categoryLabels, conditionLabels } from "./ui";

type Filter = "for-you" | "all" | Category | "saved";

export function DiscoverView({ initialItemId }: { initialItemId?: string }) {
  return <WorkspaceBoundary>{workspace => <DiscoverContent key={initialItemId ?? "collection"} workspace={workspace} initialItemId={initialItemId} />}</WorkspaceBoundary>;
}

function DiscoverContent({ workspace, initialItemId }: { workspace: Workspace; initialItemId?: string }) {
  const [filter, setFilter] = useState<Filter>("for-you");
  const [search, setSearch] = useState("");
  const [condition, setCondition] = useState("all");
  const [sort, setSort] = useState("suggested");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItemId ?? null);
  const [helpOpen, setHelpOpen] = useState(false);
  const { command, busy } = useRelay();
  const workMap = useMemo(() => new Map(workspace.works.map(work => [work.id, work])), [workspace.works]);
  const suggestionMap = new Map(workspace.discovery?.suggestions.map(s => [s.itemId, s]) ?? []);
  const dismissed = new Set(workspace.dismissals.map(d => d.itemId));
  const eligible = workspace.items.filter(item => item.ownerId !== workspace.currentMemberId && item.state === "available");
  const items = eligible.filter(item => {
    const work = workMap.get(item.workId)!;
    if (filter === "saved" && !workspace.savedItemIds.includes(item.id)) return false;
    if (filter === "for-you" && dismissed.has(item.id)) return false;
    if (["book", "record", "game"].includes(filter) && work.category !== filter) return false;
    if (condition !== "all" && item.condition !== condition) return false;
    return `${work.title} ${work.author} ${work.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase());
  }).sort((a,b) => sort === "title" ? workMap.get(a.workId)!.title.localeCompare(workMap.get(b.workId)!.title) : sort === "newest" ? b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id) : (suggestionMap.get(a.id)?.rank ?? 99) - (suggestionMap.get(b.id)?.rank ?? 99));
  const selected = workspace.items.find(item => item.id === selectedItemId);
  const taste = workspace.preferences.seedWorkIds.map(id => workMap.get(id)).filter((w): w is Work => !!w);
  const findFavorites = async () => { await command({ type: "discover", mode: "sample" }); document.getElementById("collection")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  return <div className="discover-page page-enter">
    <section className="discovery-hero">
      <div className="hero-copy"><div className="hero-kicker"><span className="little-star">✳</span> GOOD THINGS COME AROUND</div><h1>Your next favorite.<br/>Already on<br/><em>someone’s shelf.</em></h1><p>Trade the things you’ve loved for something<br className="desktop-break"/> you’re about to. A good story deserves a sequel.</p><button className="button primary hero-button" onClick={() => void findFavorites()} disabled={!!busy}><BusyLabel busy={busy === "discover"}>Find your next favorite <ArrowRight size={17}/></BusyLabel></button><div className="hero-community"><div className="avatar-stack">{workspace.members.filter(m => !m.isYou && m.role !== "coordinator").slice(0,3).map(m => <Avatar key={m.id} member={m} size="small"/>)}</div><span><strong>{eligible.length} good things.</strong> One shared neighborhood.</span></div></div>
      <div className="hero-art" aria-hidden="true"><div className="hero-orbit"/><div className="hero-paper-note"><span>OLD FAVORITES.<br/>NEW POSSIBILITIES.</span><svg viewBox="0 0 60 35"><path d="M7 7q26 29 45 5m-13 0 15-3-2 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></div><CoverArt work={heroWorks.record} className="hero-record"/><CoverArt work={heroWorks.book} className="hero-book"/><CoverArt work={heroWorks.game} className="hero-game"/><div className="hero-sticker"><span>LESS BUYING</span><ArrowDownUp size={22}/><span>MORE FINDING</span></div><div className="hero-art-caption">A new chapter, a B-side, one more adventure.</div><span className="hero-spark spark-one">✧</span><span className="hero-spark spark-two">✦</span></div>
    </section>
    <div className="how-strip"><span><span className="step-number">01</span> Make a little room</span><ArrowRight size={15}/><span><span className="step-number">02</span> Find a new favorite</span><ArrowRight size={15}/><span><span className="step-number">03</span> Pass the good things on</span><button onClick={() => setHelpOpen(true)} aria-label="How an exchange works"><CircleHelp size={17}/></button></div>
    <section className="collection-section" id="collection">
      <div className="section-heading"><div><span className="eyebrow">THE NEIGHBORHOOD COLLECTION</span><h2>A little curiosity goes a long way.</h2></div><Link className="text-link" href="/onboarding"><SlidersHorizontal size={15}/>Tune your taste<ArrowUpRight size={14}/></Link></div>
      <div className="taste-context"><span className="taste-symbol"><Sparkles size={17}/></span><span>Starting with what you love:</span><div className="taste-chip-group">{taste.slice(0,3).map(work => <Link key={work.id} href="/onboarding" className="taste-chip">{work.title}</Link>)}</div><button className="source-label" onClick={() => setHelpOpen(true)}>Authored discoveries <CircleHelp size={12}/></button></div>
      <div className="collection-toolbar"><div className="category-tabs" aria-label="Filter collection">{([{ id: "for-you", label: "For you", icon: <Sparkles size={14}/> }, { id: "all", label: "Everything" }, { id: "book", label: "Books" }, { id: "record", label: "Records" }, { id: "game", label: "Games" }, { id: "saved", label: "Saved", icon: <Bookmark size={13}/> }] as {id: Filter;label: string;icon?:React.ReactNode}[]).map(tab => <button key={tab.id} className={filter === tab.id ? "active" : ""} onClick={() => setFilter(tab.id)} aria-pressed={filter === tab.id}>{tab.icon}{tab.label}{tab.id === "saved" && workspace.savedItemIds.length ? <small>{workspace.savedItemIds.length}</small> : null}</button>)}</div><button className={`button filter-button ${filtersOpen || condition !== "all" ? "selected" : ""}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={15}/>Filters{condition !== "all" ? <span className="filter-dot"/> : null}</button></div>
      {filtersOpen ? <div className="filter-panel"><label className="search-field"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search this shelf" aria-label="Search this shelf"/></label><label className="inline-field">Condition<select value={condition} onChange={e => setCondition(e.target.value)}><option value="all">Any condition</option><option value="like-new">Like new</option><option value="good">Good condition</option><option value="fair">Well loved</option></select></label><label className="inline-field">Order<select value={sort} onChange={e => setSort(e.target.value)}><option value="suggested">Suggested for you</option><option value="title">Title, A–Z</option><option value="newest">Recently offered</option></select></label><button className="text-button" onClick={() => { setSearch(""); setCondition("all"); setSort("suggested"); }}>Clear filters</button></div> : null}
      <div className="collection-summary"><span>{items.length} things with a next chapter{filter === "for-you" ? " · picked from the sample shelf" : ""}</span><span className="collection-location"><MapPin size={12}/>The Reading Room</span></div>
      {items.length ? <div className="item-grid">{items.map((item,index) => <ItemCard key={item.id} item={item} work={workMap.get(item.workId)!} workspace={workspace} suggested={filter === "for-you" && suggestionMap.has(item.id)} index={index} onSelect={() => setSelectedItemId(item.id)}/>)}</div> : <EmptyState icon={<Bookmark size={29}/>} eyebrow={filter === "saved" ? "YOUR POCKET COLLECTION" : "ROOM FOR A LITTLE MORE"} title={filter === "saved" ? "Keep the good ones close." : "Nothing on this shelf just yet."} action={<button className="button secondary" onClick={() => { setFilter("all");setCondition("all");setSearch(""); }}>Explore everything <ArrowRight size={15}/></button>}><p>{filter === "saved" ? "Tap the bookmark on anything that catches your eye. Saving keeps it here; it doesn’t approve a trade." : "Try a different category or condition. The best things sometimes take a second look."}</p></EmptyState>}
      <div className="collection-bottom"><span><Leaf size={16}/> Good taste. A lighter footprint.</span><span>Original RELAY illustrations · Authored sample copies</span></div>
    </section>
    <section className="exchange-invitation"><div className="invitation-icon"><ArrowLeftRight size={29} strokeWidth={1.2}/></div><div><span className="eyebrow">A BETTER KIND OF CIRCULAR</span><h2>It doesn’t have to be a two-way street.</h2><p>You want Noah’s game. Noah wants Maya’s book. Maya wants yours.<br/>RELAY finds the way around—then everyone gets the final say.</p></div><Link className="button secondary" href="/exchanges">See your exchanges <ArrowRight size={16}/></Link></section>
    <SampleNote compact/>
    <ItemDrawer item={selected ?? null} workspace={workspace} onClose={() => setSelectedItemId(null)}/>
    <Modal open={helpOpen} onOpenChange={setHelpOpen} title="A good match starts with you." description="Taste is a starting point. You always choose the exact trade."><div className="explanation-body"><span className="source-pill"><Sparkles size={14}/> Authored sample discovery</span><p>The recommendations in this workspace use hand-written cultural themes and your chosen favorites. Changing your favorites changes the ordering.</p><p>Live Qloo discovery is prepared for a future connection. It needs a server-side API key and verified cultural identities. This sample doesn’t make Qloo calls.</p><div className="callout"><ShieldCheck size={20}/><span>Saving an item expresses curiosity. Only <strong>“I’d make this trade”</strong> approves the specific copies and terms you see.</span></div><Link className="button primary" href="/how-it-works" onClick={() => setHelpOpen(false)}>The whole story <ArrowRight size={15}/></Link></div></Modal>
  </div>;
}

export function ItemCard({ item, work, workspace, suggested = false, index = 0, onSelect }: { item: Item; work: Work; workspace: Workspace; suggested?: boolean; index?: number; onSelect: () => void }) {
  const { command, busy } = useRelay();
  const member = workspace.members.find(m => m.id === item.ownerId);
  const saved = workspace.savedItemIds.includes(item.id);
  const backgrounds = ["#e8e9dc", "#eadfd3", "#e1e5de", "#e9e3d5", "#e4ddd7", "#e0e4df"];
  return <article className="item-card">
    <div className="item-art-area" style={{ background: backgrounds[index % backgrounds.length] }}><button className="art-select" onClick={onSelect} aria-label={`View ${work.title}, ${item.edition}`}><CoverArt work={work}/></button><span className="category-badge"><CategoryIcon category={work.category} size={12}/>{categoryLabels[work.category]}</span><button className={`save-button ${saved ? "saved" : ""}`} disabled={!!busy} onClick={() => void command({ type: "saveItem", itemId: item.id })} aria-label={`${saved ? "Unsave" : "Save"} ${work.title}`} aria-pressed={saved}><Bookmark size={17} fill={saved ? "currentColor" : "none"}/></button>{suggested ? <button className="why-badge" onClick={onSelect}><Sparkles size={12}/>A little like you<ArrowUpRight size={11}/></button> : null}<button className="card-hover-action" onClick={onSelect}>Take a closer look<ArrowUpRight size={15}/></button></div>
    <button className="item-title-button" onClick={onSelect}><h3>{work.title}</h3><ArrowUpRight size={15}/></button><p className="item-author">{work.author}</p><div className="item-meta"><span className={`condition-dot condition-${item.condition}`}/><span>{conditionLabels[item.condition]}</span><span className="meta-separator">·</span><span>{work.category === "game" ? item.edition.split(" · ")[0] : work.category === "record" ? "Vinyl" : item.edition.toLowerCase().includes("hardcover") ? "Hardcover" : "Paperback"}</span></div><div className="card-owner"><span><Avatar member={member} size="small"/>{member?.name}’s shelf</span><button onClick={onSelect} aria-label={`Consider a trade for ${work.title}`}><ArrowLeftRight size={16}/></button></div>
  </article>;
}

function ItemDrawer({ item, workspace, onClose }: { item: Item | null; workspace: Workspace; onClose: () => void }) {
  const { command, busy, online } = useRelay();
  const router = useRouter();
  const [selectedGiveId, setSelectedGiveId] = useState("");
  const [termsChecked, setTermsChecked] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState("Not my kind of thing");
  const [approvedId, setApprovedId] = useState<string | null>(null);
  if (!item) return <Modal open={false} onOpenChange={() => undefined} title="Consider this exchange">{null}</Modal>;
  const work = workspace.works.find(w => w.id === item.workId)!;
  const member = workspace.members.find(m => m.id === item.ownerId)!;
  const yourItems = workspace.items.filter(i => i.ownerId === workspace.currentMemberId && i.state === "available");
  const give = yourItems.find(i => i.id === selectedGiveId) ?? yourItems[0];
  const giveWork = workspace.works.find(w => w.id === give?.workId);
  const suggestion = workspace.discovery?.suggestions.find(s => s.itemId === item.id);
  const existing = workspace.approvals.find(a => a.memberId === workspace.currentMemberId && a.giveItemId === give?.id && a.receiveItemId === item.id && a.status === "active");
  const handleApprove = async () => {
    if (!give) return;
    const next = await command({ type: "approve", giveItemId: give.id, receiveItemId: item.id, expectedGiveVersion: give.version, expectedReceiveVersion: item.version });
    if (!next) return;
    setApprovedId(item.id);
    const proposed = await command({ type: "createProposals" });
    const proposal = proposed?.proposals.find(p => p.status === "proposed" && p.legs.some(l => l.memberId === workspace.currentMemberId && l.receiveItemId === item.id));
    if (proposal) { onClose(); router.push(`/exchanges/${proposal.id}`); }
  };
  return <Modal open onOpenChange={open => { if (!open) { onClose(); setTermsChecked(false); setApprovedId(null); } }} title="A new chapter for both of you." description="A closer look at the exact copy—and what you’d give for it." drawer className="offer-drawer">
    <div className="offer-main"><div className="offer-feature"><div className="offer-cover"><CoverArt work={work}/></div><div><span className="eyebrow"><CategoryIcon category={work.category} size={12}/>{categoryLabels[work.category]} · {work.year}</span><h2>{work.title}</h2><p>{work.author}</p><div className="offer-owner"><Avatar member={member} size="small"/><span>From {member.name}’s shelf</span></div><span className="condition-tag"><span className={`condition-dot condition-${item.condition}`}/>{conditionLabels[item.condition]}</span></div></div><p className="object-description">{work.description}</p><div className="copy-details"><div><span>THE ACTUAL COPY</span><strong>{item.edition}</strong></div><div><span>A NOTE FROM {member.name.toUpperCase()}</span><p>“{item.notes}”</p></div></div>
    <div className="why-panel"><div><Sparkles size={17}/><strong>Why it might be your kind of thing</strong></div><p>{suggestion?.reason ?? `A new way into ${work.tags.slice(0,2).join(" and ")}, offered by someone in your sample community.`}</p><div className="why-footer"><span>Authored suggestion · a possibility, not a promise</span><Link href={suggestion ? `/evidence/${suggestion.evidenceId}` : "/evidence"} onClick={onClose}>See the source <ArrowUpRight size={12}/></Link></div></div>
    {item.state !== "available" ? <div className="callout caution"><ShieldCheck size={20}/><span>This copy is {item.state.replaceAll("_", " ")}. Pick another available item from the collection.</span></div> : yourItems.length && giveWork && give ? <div className="exact-offer"><div className="mini-section-heading"><span className="eyebrow">MAKE IT AN EXCHANGE</span><ArrowLeftRight size={16}/></div><label className="field-label" htmlFor="give-item">What would you pass on?</label><div className="select-wrap"><select id="give-item" value={give.id} onChange={e => { setSelectedGiveId(e.target.value); setTermsChecked(false); }} disabled={!!busy}>{yourItems.map(i => <option key={i.id} value={i.id}>{workspace.works.find(w => w.id === i.workId)?.title} · {conditionLabels[i.condition]}</option>)}</select><ChevronDown size={16}/></div><div className="give-get-comparison"><div><span>YOU GIVE</span><strong>{giveWork.title}</strong><small>{give.edition}</small></div><span className="comparison-arrow"><ArrowRight size={19}/></span><div><span>YOU GET</span><strong>{work.title}</strong><small>{item.edition}</small></div></div><div className="offer-terms"><MapPin size={16}/><div><strong>{workspace.terms.hubName}</strong><span>{workspace.terms.location}</span><span>{workspace.terms.handoffWindow}</span></div></div><label className="check-label"><input type="checkbox" checked={termsChecked} onChange={e => setTermsChecked(e.target.checked)}/><span>I’d give this copy of <strong>{giveWork.title}</strong> for this copy of <strong>{work.title}</strong>. I’ve reviewed both conditions and the handoff terms.</span></label><p className="fine-print">Approval lasts {APPROVAL_LIFETIME_HOURS} hours. Nothing is reserved until the complete exchange is confirmed by everyone.</p></div> : <div className="callout"><BookShelfIcon/><div>Add an available item to your shelf before making a trade.<Link href="/inventory/new" onClick={onClose}>Offer your first item <ArrowRight size={13}/></Link></div></div>}
    {dismissOpen ? <div className="dismiss-form"><label className="field-label" htmlFor="dismiss-reason">A little feedback helps your shelf.</label><select id="dismiss-reason" value={dismissReason} onChange={e => setDismissReason(e.target.value)}><option>Not my kind of thing</option><option>I already have this</option><option>The condition doesn’t suit me</option><option>I need a different edition or platform</option></select><button className="button secondary" disabled={!!busy} onClick={async () => { const result = await command({ type: "dismiss", itemId: item.id, reason: dismissReason }); if (result) { setDismissOpen(false);onClose(); } }}>Save feedback</button></div> : <button className="text-button subtle dismiss-link" onClick={() => setDismissOpen(true)}><X size={13}/>Not for me this time</button>}
    </div><div className="offer-bottom">{approvedId === item.id || existing ? <div className="approval-saved"><Check size={20}/><div><strong>Your exact trade is approved.</strong><small>We’ll keep it on the board while a complete exchange comes together.</small></div><Link href="/exchanges" className="button primary" onClick={onClose}>View exchanges <ArrowRight size={14}/></Link></div> : <><span><ShieldCheck size={15}/>Your choice. Every step of the way.</span><button className="button primary full-width" disabled={!!busy || !online || !termsChecked || !give || item.state !== "available"} onClick={() => void handleApprove()}><BusyLabel busy={!!busy}>I’d make this trade <ArrowRight size={17}/></BusyLabel></button></>}</div>
  </Modal>;
}
function BookShelfIcon() { return <Heart size={22}/>; }
