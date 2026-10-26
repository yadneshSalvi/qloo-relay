"use client";
import { displayWorkCreator } from "@/domain/work-labels";

import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDownUp, ArrowRight, BookOpen, ChevronRight, Compass, HeartHandshake, Info, LayoutGrid, MapPin, Menu, Plus, Search, Settings2, Sparkles, X, ReceiptText, BarChart3, Users } from "lucide-react";
import { useRelay } from "./relay-provider";
import { Avatar, Modal, categoryLabels } from "./ui";
import { CoverArt } from "./art";

const navigation = [
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/inventory", label: "Your shelf", icon: BookOpen },
  { href: "/exchanges", label: "Your exchanges", icon: ArrowDownUp },
  { href: "/onboarding", label: "Your taste", icon: Sparkles },
];
const communityNavigation = [
  { href: "/community", label: "Your community", icon: Users },
  { href: "/organizer", label: "Handoff desk", icon: HeartHandshake },
  { href: "/results", label: "Handoff records", icon: BarChart3 },
  { href: "/evidence", label: "Behind the exchange", icon: ReceiptText },
];

export function RelayMark({ size = 30 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M25 6.5A13 13 0 0 0 5 19" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round"/><path d="m1 14 4 6 6-4M11 29.5A13 13 0 0 0 31 17" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"/><path d="m35 22-4-6-6 4" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { workspace } = useRelay();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const active = (href: string) => href === "/discover" ? pathname === "/" || pathname.startsWith("/discover") || pathname.startsWith("/offers") : pathname.startsWith(href);
  const current = [...navigation, ...communityNavigation, { href: "/how-it-works", label: "How RELAY works" }, { href: "/settings", label: "Your workspace" }].find(item => active(item.href));
  const pending = workspace?.proposals.filter(p => p.status === "proposed" && p.legs.some(l => l.memberId === workspace.currentMemberId && !l.confirmed)).length ?? 0;
  const you = workspace?.members.find(m => m.isYou);
  const coordinator = workspace?.session.mode === "private" && workspace.access.role === "coordinator";
  const visibleNavigation = coordinator ? navigation.filter(item => item.href !== "/inventory" && item.href !== "/onboarding") : navigation;
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === "k") { event.preventDefault(); setMenuOpen(false); setSearchOpen(value => !value); } };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 961px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => { if (event.matches) setMenuOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  const renderLinks = (items: typeof navigation) => items.map(({ href, label, icon: Icon }) => <Link className={`nav-link ${active(href) ? "active" : ""}`} key={href} href={href} onClick={() => setMenuOpen(false)} aria-current={active(href) ? "page" : undefined}><Icon size={19} strokeWidth={1.7} /><span>{label}</span>{href === "/exchanges" && pending > 0 ? <span className="nav-count">{pending}</span> : null}{href === "/inventory" && workspace ? <span className="nav-meta">{workspace.items.filter(i => i.ownerId === workspace.currentMemberId && i.state !== "withdrawn").length}</span> : null}</Link>);
  const sidebarContent = <>
      <Link href="/discover" className="wordmark" onClick={() => setMenuOpen(false)}><RelayMark />RELAY</Link>
      <Link href="/community" className="hub-switcher" onClick={() => setMenuOpen(false)}><span className="hub-icon"><LayoutGrid size={18}/></span><span><strong>{workspace?.terms.hubName ?? "Your community"}</strong><small>{workspace?.session.mode === "private" ? "Private invited exchange" : "Authored sample exchange"}</small></span><ChevronRight size={14}/></Link>
      <div className="nav-section-label">YOUR CORNER</div>
      <nav aria-label="Your corner">{renderLinks(visibleNavigation)}</nav>
      <div className="nav-section-label community-label">THE COMMUNITY</div>
      <nav aria-label="The community">{renderLinks(communityNavigation)}</nav>
      <div className="sidebar-bottom">
        <div className="next-gathering"><span className="gathering-flower">✳</span><span className="eyebrow">A PLACE TO PASS IT ON</span><h3>One place.<br/>Every exchange.</h3><p><MapPin size={13}/> One hub. Every exchange.</p><Link href="/how-it-works" onClick={() => setMenuOpen(false)}>See how it works <ArrowRight size={14}/></Link></div>
        <Link href="/settings" className="profile-link" onClick={() => setMenuOpen(false)}><Avatar member={you} /><span><strong>{you?.name ?? "Your corner"}</strong><small>{workspace?.session.mode === "private" ? coordinator ? "Invited coordinator" : "Invited participant" : "Sample member"}</small></span><Settings2 size={16}/></Link>
      </div>
    </>;
  return <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}><div className="app-shell">
    <aside className="sidebar desktop-sidebar" aria-label="Main navigation">{sidebarContent}</aside>
    <Dialog.Portal><Dialog.Overlay className="mobile-menu-scrim"/><Dialog.Content className="sidebar mobile-sidebar mobile-open"><Dialog.Title className="sr-only">Main navigation</Dialog.Title><Dialog.Description className="sr-only">Your shelf, exchanges, taste, and neighborhood handoff desk.</Dialog.Description><Dialog.Close className="icon-button mobile-close" aria-label="Close navigation"><X size={20}/></Dialog.Close>{sidebarContent}</Dialog.Content></Dialog.Portal>
    <div className="workspace-shell">
      <header className="topbar">
        <div className="topbar-left"><Dialog.Trigger asChild><button className="icon-button mobile-menu" aria-label="Open navigation"><Menu size={21}/></button></Dialog.Trigger><span className="breadcrumb-root">Your neighborhood</span><ChevronRight className="breadcrumb-chevron" size={12}/><span className="breadcrumb-current">{current?.label ?? "Discover"}</span></div>
        <div className="topbar-actions"><button className="search-trigger" aria-label="Search the collection" onClick={() => setSearchOpen(true)}><Search size={16}/><span>Find something good</span><kbd>⌘ K</kbd></button><Link className="sample-pill" href="/community"><span/>{workspace?.session.mode === "private" ? "Private community" : "Sample exchange"}</Link>{coordinator ? <Link className="button small primary add-item-header" href="/community"><Users size={16}/>Invite participants</Link> : <Link className="button small primary add-item-header" href="/inventory/new"><Plus size={16}/>Offer an item</Link>}</div>
      </header>
      <main id="main-content" className="main-content">{children}</main>
      <footer className="app-footer"><span><RelayMark size={16}/> A little less new. A little more you.</span><Link href="/evidence">Made to be transparent <ArrowUpRightIcon/></Link></footer>
    </div>
    <SearchDialog open={searchOpen} onOpenChange={setSearchOpen}/>
  </div></Dialog.Root>;
}

function ArrowUpRightIcon() { return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 10 10 2M3 2h7v7" stroke="currentColor" strokeWidth="1.3"/></svg>; }

function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { workspace } = useRelay();
  const [query, setQuery] = useState("");
  const router = useRouter();
  const results = workspace?.items.filter(item => item.state === "available" && item.ownerId !== workspace.currentMemberId).map(item => ({ item, work: workspace.works.find(w => w.id === item.workId)! })).filter(({ work }) => `${work.title} ${displayWorkCreator(work)} ${work.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8) ?? [];
  return <Modal open={open} onOpenChange={onOpenChange} title="Find your next favorite" description="Search the things already in your community." className="search-dialog"><label className="search-field large"><Search size={19}/><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="A title, an artist, a little curiosity…" aria-label="Search books, records, and games"/></label><div className="search-results">{results.map(({ item, work }) => <button className="search-result" key={item.id} onClick={() => { onOpenChange(false); router.push(`/offers/${item.id}`); }}><CoverArt work={work} flat/><span><strong>{work.title}</strong><small>{displayWorkCreator(work)} · {categoryLabels[work.category]}</small></span><ArrowRight size={16}/></button>)}{results.length === 0 ? <p className="search-empty">Nothing on this shelf yet. Try another title, artist, or theme.</p> : null}</div><p className="fine-print"><Info size={13}/> Search matches the copies currently offered within your community.</p></Modal>;
}
