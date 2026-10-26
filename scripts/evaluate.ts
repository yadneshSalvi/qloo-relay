import { solveCycles } from "../src/domain/solver";
import type { Approval, Item } from "../src/domain/types";

// Exhaustive structural benchmark, not a recommendation or human-impact study.
// Every directed exact-approval graph on four participants appears once.
const now = new Date("2030-01-01T00:00:00.000Z");
const members = ["a", "b", "c", "d"];
const items: Item[] = members.map(id => ({
  id, ownerId: id, workId: "synthetic-work", edition: "Synthetic copy", condition: "good",
  notes: "Structural benchmark fixture", attested: true, version: 1, state: "available",
  heldByProposalId: null, createdAt: now.toISOString(), dataOrigin: "authored-sample",
}));
const possibleEdges = members.flatMap(give => members.filter(receive => receive !== give).map(receive => [give, receive] as const));
const approval = (give: string, receive: string): Approval => ({
  id: `${give}-${receive}`, memberId: give, giveItemId: give, receiveItemId: receive,
  giveVersion: 1, receiveVersion: 1, termsVersion: "fixture-v1", termsHash: "fixture-terms",
  preferenceRank: 1, status: "active", expiresAt: "2031-01-01T00:00:00.000Z",
  createdAt: now.toISOString(), authored: true, evidenceId: null,
});
const countBits = (mask: number) => mask.toString(2).replaceAll("0", "").length;

/** Independent oracle: permutations establish cycles; bitsets establish allocations. */
function oracle(edges: Set<string>, maxLength: number): number {
  const cycleMasks = new Set<number>();
  function permute(path: number[], remaining: number[]) {
    if (path.length >= 2 && edges.has(`${members[path.at(-1)!]}>${members[path[0]]}`)) {
      cycleMasks.add(path.reduce((mask, index) => mask | (1 << index), 0));
    }
    if (path.length === maxLength) return;
    for (const next of remaining) {
      if (!path.length || edges.has(`${members[path.at(-1)!]}>${members[next]}`)) {
        permute([...path, next], remaining.filter(index => index !== next));
      }
    }
  }
  permute([], [0, 1, 2, 3]);
  const allocations = new Set([0]);
  for (let mask = 0; mask < 16; mask++) {
    if (allocations.has(mask)) for (const cycle of cycleMasks) if (!(cycle & mask)) allocations.add(mask | cycle);
  }
  return Math.max(...[...allocations].map(countBits));
}

let strictImprovements = 0;
let equal = 0;
let pairwiseParticipation = 0;
let multiParticipation = 0;
const distribution: Record<string, number> = {};
const graphCount = 2 ** possibleEdges.length;
for (let mask = 0; mask < graphCount; mask++) {
  const approvals = possibleEdges.filter((_, bit) => mask & (1 << bit)).map(([give, receive]) => approval(give, receive));
  const graph = { items, approvals, now, termsHash: "fixture-terms" };
  const pairwise = solveCycles({ ...graph, maxLength: 2 }).objective.participatingMembers;
  const multi = solveCycles({ ...graph, maxLength: 5 }).objective.participatingMembers;
  const edges = new Set(approvals.map(edge => `${edge.giveItemId}>${edge.receiveItemId}`));
  if (pairwise !== oracle(edges, 2) || multi !== oracle(edges, 4)) throw new Error(`Oracle disagreement for synthetic graph ${mask}`);
  if (multi < pairwise) throw new Error(`Participation regression for synthetic graph ${mask}`);
  strictImprovements += Number(multi > pairwise);
  equal += Number(multi === pairwise);
  pairwiseParticipation += pairwise;
  multiParticipation += multi;
  const key = `${pairwise}->${multi}`;
  distribution[key] = (distribution[key] ?? 0) + 1;
}

const narrativeItems = items.slice(0, 3);
const initial = [approval("b", "a"), approval("c", "b")];
const willingness = [...initial, approval("a", "c")];
const scenario = (approvals: Approval[], maxLength: number) => solveCycles({ items: narrativeItems, approvals, now, termsHash: "fixture-terms", maxLength }).objective.participatingMembers;

console.log(JSON.stringify({
  schema: "relay-structural-evaluation/v1",
  origin: "entirely synthetic; no provider calls or participant observations",
  method: "Exhaustive four-member directed graphs, one available attested copy per member, current exact approvals, equal preference ranks. Same graph supplied to both solvers.",
  population: { membersPerGraph: 4, possibleDirectedEdges: possibleEdges.length, graphs: graphCount, allocationComparisonsAgainstIndependentOracle: graphCount * 2 },
  results: { oracleDisagreements: 0, strictImprovements, equal, regressions: 0, pairwiseParticipation, multiParticipation, distribution },
  threeMemberIllustration: {
    beforeAdditionalApproval: { pairwise: scenario(initial, 2), multi: scenario(initial, 5) },
    afterAdditionalApproval: { pairwise: scenario(willingness, 2), multi: scenario(willingness, 5) },
    afterApprovalRevoked: { pairwise: scenario(initial, 2), multi: scenario(initial, 5) },
  },
  limits: [
    "Graphs are enumerated uniformly for coverage, not sampled from real communities; the frequency is not expected product lift.",
    "This evaluates allocation mechanics, not Qloo relevance, human acceptance, physical handoff, or causal impact.",
    "The new approval is an authored example. A provider ranking alone never creates willingness.",
    "Four-member enumeration does not establish performance or correctness at all larger sizes; separate invariants, five-member cases, and database races are tested elsewhere.",
  ],
}, null, 2));
