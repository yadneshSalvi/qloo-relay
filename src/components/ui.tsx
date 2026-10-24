"use client";
import { Dialog } from "radix-ui";
import { X, ArrowUpRight, Check, Disc3, BookOpen, Gamepad2, LoaderCircle } from "lucide-react";
import type { Category, ItemCondition, Member, ProposalStatus } from "@/domain/types";

export function Modal({ open, onOpenChange, title, description, children, className = "", drawer = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: React.ReactNode; className?: string; drawer?: boolean;
}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="modal-overlay" /><Dialog.Content className={`modal-content ${drawer ? "drawer" : ""} ${className}`}><div className="modal-heading"><div><Dialog.Title className="modal-title">{title}</Dialog.Title><Dialog.Description className={description ? "modal-description" : "sr-only"}>{description ?? title}</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Close dialog"><X size={20} /></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export const categoryLabels: Record<Category, string> = { book: "Book", record: "Record", game: "Game" };
export const categoryPlural: Record<Category, string> = { book: "Books", record: "Records", game: "Games" };
export const conditionLabels: Record<ItemCondition, string> = { "like-new": "Like new", good: "Good condition", fair: "Well loved" };
export function CategoryIcon({ category, size = 16 }: { category: Category; size?: number }) {
  const Icon = category === "book" ? BookOpen : category === "record" ? Disc3 : Gamepad2;
  return <Icon size={size} strokeWidth={1.6} aria-hidden="true" />;
}
export function Avatar({ member, size = "normal" }: { member?: Member; size?: "small" | "normal" | "large" }) {
  const background = member?.color ?? "#e0e7cc";
  const rgb = [1, 3, 5].map(offset => parseInt(background.slice(offset, offset + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  return <span className={`avatar avatar-${size}`} style={{ background, color: luminance > .183 ? "#000000" : "#ffffff" }} title={member?.name}>{member?.initials ?? "YS"}</span>;
}
export function ArrowLink({ children }: { children: React.ReactNode }) { return <span className="arrow-label">{children}<ArrowUpRight size={16} /></span>; }
export function BusyLabel({ busy, children }: { busy: boolean; children: React.ReactNode }) { return <>{busy ? <LoaderCircle size={17} className="spin" /> : null}{children}</>; }
const statusLabels: Record<ProposalStatus, string> = { proposed: "Awaiting confirmations", reserved: "Reserved for handoff", handoff_ready: "Ready to pass on", completed: "Exchange complete", withdrawn: "Exchange withdrawn", expired: "Proposal expired", invalidated: "Needs a new plan", disputed: "Handoff paused" };
export function StatusBadge({ status }: { status: ProposalStatus }) {
  return <span className={`status-badge status-${status}`}>{status === "completed" ? <Check size={13} /> : <span className="status-dot" />}{statusLabels[status]}</span>;
}
export function EmptyState({ icon, eyebrow, title, children, action }: { icon?: React.ReactNode; eyebrow?: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty-state">{icon ? <div className="empty-icon">{icon}</div> : null}{eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}<h2>{title}</h2><div className="empty-description">{children}</div>{action}</div>;
}
export function SampleNote({ compact = false }: { compact?: boolean }) {
  return <div className={`sample-note ${compact ? "compact" : ""}`}><span className="sample-dot" /><span>{compact ? "Sample community · Your own private workspace" : "You’re in a sample community. People, copies, and taste connections are authored for this experience. Your choices are saved only in this workspace."}</span></div>;
}
export function niceDate(value: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) {
  return new Intl.DateTimeFormat("en", options).format(new Date(value));
}
