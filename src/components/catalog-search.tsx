"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CircleAlert, Clock3, LoaderCircle, Search, ShieldCheck } from "lucide-react";
import type { CatalogCandidate, CatalogSearch as CatalogSearchRecord } from "@/domain/catalog-search";
import type { Category, Work, Workspace } from "@/domain/types";
import { useRelay } from "./relay-provider";
import { BusyLabel, CategoryIcon, Modal, niceDate } from "./ui";

type CatalogAction = { type: "search"; query: string; category: Category } | { type: "confirm"; searchId: string; entityId: string; use: "reference" | "inventory"; recordTitle?: string };
const categoryNames: Record<Category, string> = { book: "Books", record: "Artists", game: "Games" };

/** A search is explicit and durable. Only a checked human choice catalogs an identity. */
export function CatalogSearch({ open, onClose, purpose, initialCategory = "book", initialQuery = "", onSelect }: {
  open: boolean; onClose: () => void; purpose: "reference" | "inventory";
  initialCategory?: Category; initialQuery?: string; onSelect: (work: Work) => void;
}) {
  const { workspace, acceptWorkspace, notify, busy: workspaceBusy } = useRelay();
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<Category>(initialCategory);
  const [search, setSearch] = useState<CatalogSearchRecord | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [recognized, setRecognized] = useState(false);
  const [recordTitle, setRecordTitle] = useState("");
  const [pending, setPending] = useState<CatalogAction["type"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingKeys = useRef(new Map<string, string>());
  const requestPending = useRef(false);
  const generation = useRef(0);
  const sessionId = workspace?.session.id;
  const memberId = workspace?.currentMemberId;
  const configured = workspace?.capabilities.liveQloo !== "unconfigured";

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const version = generation.current;
    void fetch("/api/catalog", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Your saved catalog search could not be loaded.");
      if (controller.signal.aborted || generation.current !== version || !body.search) return;
      const latest = body.search as CatalogSearchRecord;
      setSearch(latest);
      if (!initialQuery) { setQuery(latest.query); setCategory(latest.category); }
    }).catch((cause) => { if (!controller.signal.aborted && generation.current === version) setError(cause instanceof Error ? cause.message : "Your saved catalog search could not be loaded."); });
    return () => controller.abort();
  }, [open, sessionId, memberId, initialQuery]);

  const active = search?.status === "queued" || search?.status === "running";
  useEffect(() => {
    if (!open || !search?.id || !active) return;
    const controller = new AbortController();
    let polling = false;
    const searchId = search.id;
    const version = generation.current;
    const timer = setInterval(() => {
      if (polling || document.visibilityState !== "visible") return;
      polling = true;
      void fetch(`/api/catalog?searchId=${encodeURIComponent(searchId)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "Search progress could not be loaded.");
        if (!controller.signal.aborted && generation.current === version) { setSearch(body.search); setError(null); }
      }).catch((cause) => { if (!controller.signal.aborted && generation.current === version) setError(cause instanceof Error ? cause.message : "Search progress could not be loaded."); }).finally(() => { polling = false; });
    }, 1500);
    return () => { clearInterval(timer); controller.abort(); };
  }, [open, search?.id, active]);

  const post = async (action: CatalogAction) => {
    if (requestPending.current || workspaceBusy) return;
    requestPending.current = true;
    ++generation.current;
    setPending(action.type); setError(null);
    const serialized = JSON.stringify(action);
    const key = pendingKeys.current.get(serialized) ?? crypto.randomUUID();
    pendingKeys.current.set(serialized, key);
    try {
      const response = await fetch("/api/catalog", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: serialized, signal: AbortSignal.timeout(20_000) });
      const body = await response.json();
      pendingKeys.current.delete(serialized);
      if (!response.ok) throw new Error(body.error?.message ?? "The catalog request could not be completed.");
      if (action.type === "search") { setSearch(body.search); setSelectedEntityId(null); setRecognized(false); }
      else {
        const next = body.workspace as Workspace;
        const work = next.works.find((entry) => entry.id === body.workId);
        if (!work) throw new Error("The confirmed work is missing from your visible catalog. Refresh your workspace before trying again.");
        acceptWorkspace(next); onSelect(work);
        notify(body.notice ?? "Cultural identity confirmed. Your listing or favorites still need their own save.");
        onClose();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That request is not yet confirmed. Retrying the same choice reuses its request reference."); }
    finally { requestPending.current = false; setPending(null); }
  };

  const selected = search?.status === "succeeded" ? search.candidates.find((candidate) => candidate.entityId === selectedEntityId) : null;
  const expired = !!search && new Date(search.expiresAt) <= new Date();
  const recordInventory = purpose === "inventory" && search?.category === "record";
  const candidateLabels = search?.candidates.map((candidate) => JSON.stringify([candidate.name.trim().toLowerCase(), candidate.year, candidate.disambiguation.trim().toLowerCase()])) ?? [];
  const matchingDisplayDetails = new Set(candidateLabels).size < candidateLabels.length;
  return <Modal open={open} onOpenChange={(value) => { if (!value) onClose(); }} title={purpose === "reference" ? "Find a favorite, beyond the starter shelf." : "Find the work behind your copy."} description="Search Qloo’s cultural catalog, review the identifying details, and confirm the exact work yourself." className="catalog-search-modal">
    <form className="catalog-search-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void post({ type: "search", query: query.trim(), category }); }}>
      <div className="category-choice" aria-label="Search category">{(["book", "record", "game"] as const).map((value) => <button key={value} type="button" className={category === value ? "active" : ""} aria-pressed={category === value} onClick={() => { setCategory(value); setSelectedEntityId(null); setRecognized(false); }}><CategoryIcon category={value}/>{categoryNames[value]}</button>)}</div>
      <label className="field-label" htmlFor="catalog-query">{category === "record" ? "Artist or band name" : category === "game" ? "Game title" : "Book title or author"}</label><div className="catalog-query-row"><input id="catalog-query" value={query} onChange={(event) => setQuery(event.target.value)} minLength={2} maxLength={120} required autoComplete="off" placeholder={category === "record" ? "e.g. Joni Mitchell" : category === "game" ? "e.g. Hollow Knight" : "e.g. The Left Hand of Darkness"}/><button className="button primary" type="submit" disabled={!!pending || !!workspaceBusy || active || !configured || query.trim().length < 2}><BusyLabel busy={pending === "search"}><Search size={15}/>Search Qloo</BusyLabel></button></div>
      <p className="fine-print">Only pressing Search sends this query. Music resolves an artist identity; a physical record’s title and pressing stay separate.</p>
    </form>
    {!configured ? <div className="callout caution"><CircleAlert size={19}/><div><strong>Live catalog lookup isn’t configured here.</strong><p>You can keep using the starter catalog. A configured Qloo worker is needed to search for another identity.</p></div></div> : null}
    {error ? <div className="callout caution" role="alert"><CircleAlert size={19}/><p>{error}</p></div> : null}
    {active ? <div className="catalog-search-progress" role="status"><LoaderCircle size={23} className="spin"/><div><strong>{search.status === "queued" ? "Your search is saved and waiting to start." : "Looking for the right cultural identity."}</strong><p>“{search.query}” · {categoryNames[search.category]}. You can close this dialog and reopen it to resume the saved search.</p></div></div> : null}
    {search?.status === "failed" ? <div className="catalog-search-failed" role="status"><CircleAlert size={24}/><div><h3>This search couldn’t produce a confirmed result.</h3><p>{search.errorMessage ?? "The catalog service could not finish this lookup. Try again when it is available."}</p>{search.errorCode ? <small>Reference: {search.errorCode}</small> : null}</div></div> : null}
    {search?.status === "succeeded" ? <section className="catalog-search-results"><div className="catalog-results-heading"><div><span className="eyebrow">{search.cache === "hit" ? "SAVED QLOO LOOKUP" : "QLOO SEARCH RESULTS"}</span><h3>{search.candidates.length ? "Which one did you mean?" : "No clear match this time."}</h3></div><span>{search.candidates.length} of at most 5 choices</span></div><p className="catalog-result-query">Results for “{search.query}” · {categoryNames[search.category]}</p>
      {matchingDisplayDetails ? <p className="catalog-result-query" role="note">Distinct catalog records can describe the same cultural work. These entries have matching display details; RELAY does not infer a physical edition from either. You describe and attest your own copy separately.</p> : null}
      {search.candidates.length ? <div className="catalog-candidates">{search.candidates.slice(0, 5).map((candidate) => <CandidateCard key={candidate.entityId} candidate={candidate} category={search.category} selected={selectedEntityId === candidate.entityId} onSelect={() => { setSelectedEntityId(candidate.entityId); setRecognized(false); }}/>)}</div> : <p className="catalog-no-results">Try a more specific title, creator, or category. RELAY won’t substitute an invented match.</p>}
      {selected ? <div className="catalog-selection-review"><span className="eyebrow">YOUR SELECTED IDENTITY</span><strong>{selected.name}</strong><p>{selected.disambiguation || "Review the name and category carefully; no further identifying details were supplied."}</p>{selected.isbn13 || selected.isbn10 ? <p className="catalog-isbn">Catalog {selected.isbn13 ? `ISBN-13: ${selected.isbn13}` : `ISBN-10: ${selected.isbn10}`} · This does not verify your physical edition.</p> : null}{recordInventory ? <div className="form-field"><label className="field-label" htmlFor="record-title">Your record’s album title</label><input id="record-title" value={recordTitle} onChange={(event) => setRecordTitle(event.target.value)} required minLength={2} maxLength={160} placeholder="The title on your physical record"/><small>You supply this title. The verified Qloo identity is the artist, not the album or pressing.</small></div> : null}<label className="check-label"><input type="checkbox" checked={recognized} onChange={(event) => setRecognized(event.target.checked)}/><span>I recognize this {search.category === "record" ? "artist" : search.category === "game" ? "game" : "book"} and confirm it is the cultural identity I intended.</span></label><button className="button primary full-width" disabled={!!pending || !!workspaceBusy || !recognized || expired || (recordInventory && recordTitle.trim().length < 2)} onClick={() => void post({ type: "confirm", searchId: search.id, entityId: selected.entityId, use: purpose, ...(recordInventory ? { recordTitle: recordTitle.trim() } : {}) })}><BusyLabel busy={pending === "confirm"}>Confirm {purpose === "reference" ? "this favorite" : "this work"}<ArrowRight size={15}/></BusyLabel></button></div> : null}
      <p className="catalog-search-stamp"><Clock3 size={13}/>Requested {niceDate(search.createdAt)} · choices expire {niceDate(search.expiresAt)}{expired ? " · Search again to confirm a fresh result." : ""}</p>
    </section> : null}
    {!search && !error && configured ? <div className="catalog-search-intro"><Search size={30} strokeWidth={1.3}/><h3>A title is a starting point.</h3><p>Choose a category, search once, then review up to five possible identities. No result is selected for you.</p></div> : null}
    <div className="catalog-search-footer"><ShieldCheck size={15}/><span>Confirming an identity does not list an item, save your favorites, or approve a trade.</span></div>
  </Modal>;
}

function CandidateCard({ candidate, category, selected, onSelect }: { candidate: CatalogCandidate; category: Category; selected: boolean; onSelect: () => void }) {
  return <button className={`catalog-candidate ${selected ? "selected" : ""}`} type="button" aria-pressed={selected} onClick={onSelect}><span className="catalog-candidate-icon"><CategoryIcon category={category} size={21}/></span><span><strong>{candidate.name}</strong><small>{category === "record" ? "Artist reference" : category === "game" ? "Game" : "Book"}{candidate.year !== null ? ` · ${candidate.year}` : ""}</small><span className="catalog-disambiguation">{candidate.disambiguation || "No additional identifying details supplied."}</span>{candidate.isbn13 || candidate.isbn10 ? <span className="catalog-isbn">Catalog {candidate.isbn13 ? `ISBN-13: ${candidate.isbn13}` : `ISBN-10: ${candidate.isbn10}`}<span>Identifier for disambiguation · physical edition unverified</span></span> : null}</span><span className="catalog-candidate-check">{selected ? <Check size={15}/> : null}</span></button>;
}
