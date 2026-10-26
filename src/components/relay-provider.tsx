"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, WifiOff, X } from "lucide-react";
import type { ApiResult, Command, Workspace } from "@/domain/types";
import type { CommunityInvite, MembershipCommand } from "@/domain/membership";
import Link from "next/link";

type Toast = { message: string; kind: "success" | "error" };
type MembershipResult = ApiResult & { invite?: CommunityInvite & { code: string } };
type RelayContextValue = {
  workspace: Workspace | null;
  loading: boolean;
  busy: string | null;
  error: string | null;
  online: boolean;
  command: (command: Command) => Promise<Workspace | null>;
  membership: (command: MembershipCommand) => Promise<MembershipResult | null>;
  refresh: () => Promise<void>;
  acceptWorkspace: (workspace: Workspace) => void;
  notify: (message: string, kind?: "success" | "error") => void;
};
const RelayContext = createContext<RelayContextValue | null>(null);

export function RelayProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const sequence = useRef(0);
  const activeMutation = useRef(false);
  const pendingKeys = useRef(new Map<string, string>());

  const notify = useCallback((message: string, kind: "success" | "error" = "success") => setToast({ message, kind }), []);
  // A mutation can return a newer workspace while a background read is still in flight.
  const acceptWorkspace = useCallback((next: Workspace) => {
    ++sequence.current;
    setWorkspace(next); setError(null); setOnline(true); setLoading(false);
  }, []);
  const refresh = useCallback(async () => {
    if (activeMutation.current) return;
    const request = ++sequence.current;
    try {
      const response = await fetch("/api/workspace", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (!response.ok) { if (response.status === 401 && request === sequence.current) setWorkspace(null); throw new Error(body.error?.message ?? "The shelf is taking a moment. Please try again."); }
      if (request === sequence.current) { setWorkspace(body.workspace); setError(null); setOnline(true); }
    } catch (cause) {
      if (request === sequence.current) { setError(cause instanceof Error ? cause.message : "Could not reconnect."); setOnline(false); }
    } finally { if (request === sequence.current) setLoading(false); }
  }, []);

  useEffect(() => {
    // An external-store fetch has an asynchronous lifecycle; schedule it after subscription.
    const initialLoad = setTimeout(() => void refresh(), 0);
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { clearTimeout(initialLoad); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [refresh]);

  const activeRun = workspace?.agentRuns.some((run) => run.status === "queued" || run.status === "running") ?? false;
  const collaborative = workspace?.session.mode === "private";
  useEffect(() => {
    if (!activeRun && !collaborative) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, activeRun ? 1800 : 5000);
    return () => clearInterval(timer);
  }, [activeRun, collaborative, refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(timer);
  }, [toast]);

  const submit = useCallback(async (endpoint: "/api/command" | "/api/membership", action: Command | MembershipCommand): Promise<MembershipResult | null> => {
    if (activeMutation.current) return null;
    if (!online && endpoint === "/api/command") { notify("Reconnect to verify the latest saved state before taking another action.", "error"); void refresh(); return null; }
    activeMutation.current = true;
    ++sequence.current;
    setBusy(action.type);
    const serializedAction = JSON.stringify(action);
    const pendingAction = `${endpoint}:${serializedAction}`;
    const idempotencyKey = pendingKeys.current.get(pendingAction) ?? crypto.randomUUID();
    pendingKeys.current.set(pendingAction, idempotencyKey);
    let responseReceived = false;
    let reconcile = false;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: serializedAction,
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      responseReceived = true;
      pendingKeys.current.delete(pendingAction);
      if (!response.ok) throw new Error(body.error?.message ?? "That action could not be completed. Please refresh and try again.");
      const result = body as MembershipResult;
      setWorkspace(result.workspace);
      setOnline(true);
      setError(null);
      setLoading(false);
      if (result.notice) notify(result.notice);
      return result;
    } catch (cause) {
      reconcile = true;
      if (!responseReceived) {
        setOnline(false);
        notify("We haven’t confirmed that action yet. Reconnecting to check what was saved; retrying the same action will reuse its reference.", "error");
      } else notify(cause instanceof Error ? cause.message : "We couldn’t save that change.", "error");
      return null;
    } finally { activeMutation.current = false; setBusy(null); if (reconcile) void refresh(); }
  }, [notify, refresh, online]);

  const command = useCallback(async (action: Command) => (await submit("/api/command", action))?.workspace ?? null, [submit]);
  const membership = useCallback((action: MembershipCommand) => submit("/api/membership", action), [submit]);

  return (
    <RelayContext.Provider value={{ workspace, loading, busy, error, online, command, membership, refresh, acceptWorkspace, notify }}>
      {children}
      {!online && workspace ? <div className="connection-banner" role="status"><WifiOff size={16} /> Reconnect to check the latest exchange state.<button onClick={() => void refresh()}>Reconnect</button></div> : null}
      {toast ? <div className={`toast ${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>{toast.kind === "error" ? <CircleAlert size={21} /> : <CheckCircle2 size={21} />}<span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16} /></button></div> : null}
    </RelayContext.Provider>
  );
}

export function useRelay() {
  const context = useContext(RelayContext);
  if (!context) throw new Error("RELAY must be used inside its provider.");
  return context;
}

export function WorkspaceBoundary({ children }: { children: (workspace: Workspace) => React.ReactNode }) {
  const { workspace, error, refresh } = useRelay();
  if (workspace) return <>{children(workspace)}</>;
  if (error) return <div className="error-state"><CircleAlert size={32} /><span className="eyebrow">The shelf is temporarily unavailable</span><h1>A little pause.</h1><p>{error}</p><button className="button primary" onClick={() => void refresh()}>Try again</button><Link className="text-link" href="/community">Manage community access</Link></div>;
  return <div className="page-skeleton" aria-busy="true" aria-label="Opening your exchange"><div className="skeleton short" /><div className="skeleton title" /><div className="skeleton subtitle" /><div className="skeleton-grid">{[1,2,3,4].map(i => <div key={i} className="skeleton card" />)}</div><span className="loading-label"><LoaderCircle size={16} className="spin" /> Opening the neighborhood shelf…</span></div>;
}
