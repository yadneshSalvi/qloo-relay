"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Compass, Search, Sparkles } from "lucide-react";
import type { Category, Workspace } from "@/domain/types";
import { useRelay, WorkspaceBoundary } from "./relay-provider";
import { CoverArt } from "./art";
import { BusyLabel, SampleNote, categoryLabels } from "./ui";

export function TasteView() { return <WorkspaceBoundary>{workspace => <TasteContent workspace={workspace}/>}</WorkspaceBoundary>; }

function TasteContent({ workspace }: { workspace: Workspace }) {
  const { command, busy, notify } = useRelay();
  const [selected, setSelected] = useState<string[]>(workspace.preferences.seedWorkIds);
  const [novelty, setNovelty] = useState(workspace.preferences.novelty);
  const [filter, setFilter] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const router = useRouter();
  const toggle = (id: string) => { if (selected.includes(id)) setSelected(selected.filter(s => s !== id)); else if (selected.length < 5) setSelected([...selected,id]); else notify("Five favorites gives us a good starting point. Remove one to make room.", "error"); };
  const save = async () => { const result = await command({ type:"preferences", seedWorkIds:selected, novelty }); if (!result) return; const ranked = await command({type:"discover",mode:"sample"}); if (ranked) router.push("/discover"); };
  const works = workspace.works.filter(work => (filter === "all" || work.category === filter) && `${work.title} ${work.author}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="taste-page page-enter"><header className="page-header"><div><span className="eyebrow">A FEW THINGS THAT FEEL LIKE YOU</span><h1>Your taste has range.<br/><em className="soft-em">Let’s follow it.</em></h1><p>Pick a few books, records, or games you love. We’ll use them as a starting point for a little serendipity.</p></div><span className="taste-count"><span>{selected.length}</span> of 5 favorites</span></header><div className="taste-layout"><section className="taste-catalog"><div className="taste-catalog-header"><div className="category-tabs">{(["all","book","record","game"] as const).map(c => <button key={c} onClick={() => setFilter(c)} className={filter === c ? "active" : ""}>{c === "all" ? "A little of everything" : `${categoryLabels[c]}s`}</button>)}</div><label className="search-field"><Search size={15}/><input aria-label="Find a favorite" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a favorite"/></label></div><div className="taste-work-grid">{works.map(work => <button className={`taste-work ${selected.includes(work.id) ? "selected" : ""}`} key={work.id} onClick={() => toggle(work.id)} aria-pressed={selected.includes(work.id)}><div className="taste-art"><CoverArt work={work} flat/><span className="taste-check">{selected.includes(work.id) ? <Check size={13}/> : <span/>}</span></div><strong>{work.title}</strong><span>{work.author}</span></button>)}</div>{!works.length ? <p className="search-empty">No matching title in the sample collection. Try another favorite.</p> : null}</section><aside className="taste-side"><div className="taste-compass"><Compass size={33} strokeWidth={1.2}/></div><span className="eyebrow">HOW FAR SHOULD WE WANDER?</span><h2>A familiar feeling.<br/>An unexpected find.</h2><p>Keep close to what you love, or let a few more surprises into the mix.</p><div className="novelty-control"><label htmlFor="novelty">Your curiosity dial <strong>{novelty < 34 ? "Close to home" : novelty < 67 ? "A little curious" : "Surprise me"}</strong></label><input id="novelty" type="range" min="0" max="100" step="25" value={novelty} onChange={e => setNovelty(Number(e.target.value))}/><div><span>Familiar</span><span>Adventurous</span></div></div><div className="chosen-favorites"><span className="eyebrow">YOUR STARTING POINTS</span>{selected.length ? selected.map(id => <span key={id}><Sparkles size={12}/>{workspace.works.find(w => w.id === id)?.title}</span>) : <p>Choose at least one favorite to get started.</p>}</div><button className="button primary full-width" disabled={!!busy || !selected.length} onClick={() => void save()}><BusyLabel busy={!!busy}>Find my next discovery<ArrowRight size={15}/></BusyLabel></button><p className="taste-disclosure">Sample suggestions use authored cultural themes. Live Qloo discovery is awaiting connection and identity verification.</p></aside></div><SampleNote compact/></div>;
}
