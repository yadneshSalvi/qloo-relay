import type { Approval, Item } from "./types";
import { DomainError } from "./errors";

export interface FeasibleCycle {
  key: string;
  approvals: Approval[];
  memberIds: string[];
  itemIds: string[];
  preferenceCost: number;
}

export interface SolverResult {
  candidates: FeasibleCycle[];
  selected: FeasibleCycle[];
  objective: { participatingMembers: number; preferenceCost: number; handoffComplexity: number };
  method: "exact-enumeration-and-set-packing";
}

/** Edges point from the exact offered copy to the exact desired copy. */
export function enumerateCycles(input: {
  items: Item[];
  approvals: Approval[];
  now: Date;
  termsHash: string;
  maxLength?: number;
  excludedMemberIds?: string[];
}): FeasibleCycle[] {
  const maxLength = input.maxLength ?? 5;
  if (maxLength < 2 || maxLength > 5) throw new DomainError("INVALID_CYCLE_BOUND", "Cycles must contain between two and five members.", 400);
  const items = new Map(input.items.map((item) => [item.id, item]));
  const excluded = new Set(input.excludedMemberIds ?? []);
  const edges = input.approvals.filter((approval) => {
    const give = items.get(approval.giveItemId);
    const receive = items.get(approval.receiveItemId);
    return approval.status === "active" && new Date(approval.expiresAt) > input.now &&
      approval.termsHash === input.termsHash && give?.state === "available" && receive?.state === "available" &&
      give.attested && receive.attested && give.ownerId === approval.memberId && give.ownerId !== receive.ownerId &&
      !excluded.has(give.ownerId) && !excluded.has(receive.ownerId) &&
      give.version === approval.giveVersion && receive.version === approval.receiveVersion;
  }).sort((a, b) => a.giveItemId.localeCompare(b.giveItemId) || a.receiveItemId.localeCompare(b.receiveItemId) || a.preferenceRank - b.preferenceRank || a.id.localeCompare(b.id));

  // Multiple clicks for the same current exact pair are a single graph edge.
  const byGive = new Map<string, Approval[]>();
  const pairs = new Set<string>();
  for (const edge of edges) {
    const pair = `${edge.giveItemId}\u0000${edge.receiveItemId}`;
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    byGive.set(edge.giveItemId, [...(byGive.get(edge.giveItemId) ?? []), edge]);
  }
  const found = new Map<string, FeasibleCycle>();
  const starts = [...byGive.keys()].sort();
  for (const start of starts) {
    const visit = (current: string, path: Approval[], usedItems: Set<string>, usedMembers: Set<string>) => {
      for (const edge of byGive.get(current) ?? []) {
        if (usedMembers.has(edge.memberId)) continue;
        const nextPath = [...path, edge];
        if (edge.receiveItemId === start && nextPath.length >= 2) {
          const key = nextPath.map((leg) => `${leg.giveItemId}>${leg.receiveItemId}`).join("|");
          found.set(key, {
            key,
            approvals: nextPath,
            memberIds: nextPath.map((leg) => leg.memberId),
            itemIds: nextPath.map((leg) => leg.giveItemId),
            preferenceCost: nextPath.reduce((sum, leg) => sum + leg.preferenceRank, 0),
          });
          if (found.size > 5000) throw new DomainError("SOLVER_LIMIT", "This sample exceeds the verified exact solver limit. Narrow the inventory before trying again.", 422);
        } else if (nextPath.length < maxLength && !usedItems.has(edge.receiveItemId) && edge.receiveItemId > start) {
          visit(edge.receiveItemId, nextPath, new Set([...usedItems, edge.receiveItemId]), new Set([...usedMembers, edge.memberId]));
        }
      }
    };
    visit(start, [], new Set([start]), new Set());
  }
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Exact set packing for the small, isolated community. No greedy allocation. */
export function selectDisjointCycles(candidates: FeasibleCycle[], options: { maxSearchNodes?: number } = {}): SolverResult {
  const ordered = [...candidates].sort((a, b) => a.key.localeCompare(b.key));
  const maxSearchNodes = options.maxSearchNodes ?? 250_000;
  let searchNodes = 0;
  let best: FeasibleCycle[] = [];
  let bestScore = { participatingMembers: 0, preferenceCost: 0, handoffComplexity: 0 };
  let bestKey = "";
  const search = (index: number, selected: FeasibleCycle[], members: Set<string>, items: Set<string>, preferenceCost: number, handoffComplexity: number) => {
    if (++searchNodes > maxSearchNodes) throw new DomainError("SOLVER_LIMIT", "The exact allocation search reached its verified operation budget. No partial allocation was applied; narrow the inventory and retry.", 422);
    const score = { participatingMembers: members.size, preferenceCost, handoffComplexity };
    const key = selected.map((cycle) => cycle.key).join("||");
    const better = score.participatingMembers > bestScore.participatingMembers ||
      (score.participatingMembers === bestScore.participatingMembers && (score.preferenceCost < bestScore.preferenceCost ||
        (score.preferenceCost === bestScore.preferenceCost && (score.handoffComplexity < bestScore.handoffComplexity ||
          (score.handoffComplexity === bestScore.handoffComplexity && key < bestKey)))));
    if (better) { best = [...selected]; bestScore = score; bestKey = key; }
    for (let i = index; i < ordered.length; i++) {
      const cycle = ordered[i];
      if (cycle.memberIds.some((id) => members.has(id)) || cycle.itemIds.some((id) => items.has(id))) continue;
      search(i + 1, [...selected, cycle], new Set([...members, ...cycle.memberIds]), new Set([...items, ...cycle.itemIds]),
        preferenceCost + cycle.preferenceCost, handoffComplexity + cycle.memberIds.length ** 2);
    }
  };
  search(0, [], new Set(), new Set(), 0, 0);
  return { candidates: ordered, selected: best, objective: bestScore, method: "exact-enumeration-and-set-packing" };
}

export function solveCycles(input: Parameters<typeof enumerateCycles>[0]): SolverResult {
  return selectDisjointCycles(enumerateCycles(input));
}
