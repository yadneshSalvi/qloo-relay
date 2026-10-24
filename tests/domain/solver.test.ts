import { describe, expect, it } from "vitest";
import { enumerateCycles, selectDisjointCycles, solveCycles, type FeasibleCycle } from "../../src/domain/solver";
import type { Approval, Item } from "../../src/domain/types";

const now = new Date("2030-01-01T00:00:00Z");
const item = (id: string, ownerId = id): Item => ({ id, ownerId, workId: "work", edition: "copy", condition: "good", notes: "", attested: true, version: 1, state: "available", heldByProposalId: null, createdAt: now.toISOString(), dataOrigin: "authored-sample" });
const edge = (give: string, receive: string, memberId = give, overrides: Partial<Approval> = {}): Approval => ({ id: `${give}-${receive}`, memberId, giveItemId: give, receiveItemId: receive, giveVersion: 1, receiveVersion: 1, termsVersion: "v1", termsHash: "terms", preferenceRank: 1, status: "active", expiresAt: "2031-01-01T00:00:00Z", createdAt: now.toISOString(), authored: true, evidenceId: null, ...overrides });
const input = (items: Item[], approvals: Approval[]) => ({ items, approvals, now, termsHash: "terms" });
const ring = (ids: string[]) => ids.map((id, index) => edge(id, ids[(index + 1) % ids.length]));

describe("exact conditional cycle engine", () => {
  it("finds two-, three-, and five-member cycles with one giver and receiver per copy", () => {
    for (const length of [2, 3, 5]) {
      const ids = Array.from({ length }, (_, index) => String(index));
      const result = solveCycles(input(ids.map((id) => item(id)), ring(ids)));
      expect(result.candidates).toHaveLength(1);
      expect(result.selected[0].memberIds).toHaveLength(length);
      expect(new Set(result.selected[0].itemIds)).toEqual(new Set(ids));
    }
    const ids = ["a", "b", "c", "d", "e", "f"];
    expect(enumerateCycles(input(ids.map((id) => item(id)), ring(ids)))).toHaveLength(0);
  });

  it("rejects stale, expired, revoked, wrong-owner, changed-terms, and unavailable edges", () => {
    const clean = input([item("a"), item("b")], [edge("a", "b"), edge("b", "a")]);
    const variants: Partial<Approval>[] = [{ giveVersion: 2 }, { receiveVersion: 2 }, { status: "revoked" }, { expiresAt: now.toISOString() }, { memberId: "intruder" }, { termsHash: "changed" }];
    for (const variant of variants) expect(enumerateCycles({ ...clean, approvals: [edge("a", "b", "a", variant), edge("b", "a")] })).toHaveLength(0);
    expect(enumerateCycles({ ...clean, items: [item("a"), { ...item("b"), state: "reserved" }] })).toHaveLength(0);
    expect(enumerateCycles({ ...clean, items: [item("a"), { ...item("b"), attested: false }] })).toHaveLength(0);
    expect(enumerateCycles({ ...clean, excludedMemberIds: ["a"] })).toHaveLength(0);
  });

  it("never trades with self or repeats an owner through a different physical copy", () => {
    expect(enumerateCycles(input([item("a")], [edge("a", "a")]))).toHaveLength(0);
    const items = [item("a1", "alice"), item("b", "bob"), item("a2", "alice")];
    const approvals = [edge("a1", "b", "alice"), edge("b", "a2", "bob"), edge("a2", "a1", "alice")];
    expect(enumerateCycles(input(items, approvals))).toHaveLength(0);
  });

  it("selects globally member-disjoint cycles even when their physical copies do not overlap", () => {
    const items = [item("a1", "alice"), item("a2", "alice"), item("b", "bob"), item("c", "carol")];
    const approvals = [edge("a1", "b", "alice"), edge("b", "a1", "bob"), edge("a2", "c", "alice"), edge("c", "a2", "carol")];
    const result = solveCycles(input(items, approvals));
    expect(result.candidates).toHaveLength(2);
    expect(result.selected).toHaveLength(1);
    expect(result.objective.participatingMembers).toBe(2);
  });

  it("maximizes participation before preference and avoids a greedy largest-cycle allocation", () => {
    const cycle = (key: string, members: string[], cost = members.length): FeasibleCycle => ({ key, memberIds: members, itemIds: members.map((id) => `item-${id}`), approvals: [], preferenceCost: cost });
    const result = selectDisjointCycles([cycle("a", ["1", "2", "3"]), cycle("b", ["1", "4"]), cycle("c", ["2", "5"])]);
    expect(result.selected.map((entry) => entry.key)).toEqual(["b", "c"]);
    expect(result.objective.participatingMembers).toBe(4);
    expect(selectDisjointCycles([cycle("a", ["1", "2"], 5), cycle("b", ["1", "2"], 2)]).selected[0].key).toBe("b");
  });

  it("returns the same canonical allocation under reordered input and duplicate exact edges", () => {
    const items = ["a", "b", "c"].map((id) => item(id));
    const approvals = [...ring(["a", "b", "c"]), edge("a", "b", "a", { id: "duplicate", preferenceRank: 9 }), edge("b", "a")];
    const first = solveCycles(input(items, approvals));
    const second = solveCycles(input([...items].reverse(), [...approvals].reverse()));
    expect(first).toEqual(second);
    expect(first.selected[0].memberIds).toHaveLength(3);
  });

  it("stops at a deterministic search budget and never returns a partial optimum", () => {
    const candidates: FeasibleCycle[] = Array.from({ length: 8 }, (_, index) => ({ key: String(index), memberIds: [`a${index}`, `b${index}`], itemIds: [`x${index}`, `y${index}`], approvals: [], preferenceCost: 2 }));
    expect(() => selectDisjointCycles(candidates, { maxSearchNodes: 3 })).toThrowError(expect.objectContaining({ code: "SOLVER_LIMIT" }));
  });

  it("agrees with an independent permutation-and-bitmask oracle on 128 tiny graphs", () => {
    const ids = ["a", "b", "c", "d", "e"];
    let randomState = 78219;
    const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 2 ** 32; };
    for (let run = 0; run < 128; run++) {
      const approvals = ids.flatMap((give) => ids.filter((receive) => receive !== give && random() < 0.35).map((receive) => edge(give, receive)));
      const pairs = new Set(approvals.map((approval) => `${approval.giveItemId}${approval.receiveItemId}`));
      const masks = new Set<number>();
      const permutations = (chosen: number[], remaining: number[]) => {
        if (chosen.length >= 2 && pairs.has(`${ids[chosen.at(-1)!]}${ids[chosen[0]]}`)) masks.add(chosen.reduce((mask, index) => mask | (1 << index), 0));
        for (const next of remaining) if (!chosen.length || pairs.has(`${ids[chosen.at(-1)!]}${ids[next]}`)) permutations([...chosen, next], remaining.filter((index) => index !== next));
      };
      permutations([], [0, 1, 2, 3, 4]);
      const feasible = new Set([0]);
      for (let mask = 0; mask < 32; mask++) if (feasible.has(mask)) for (const cycle of masks) if (!(mask & cycle)) feasible.add(mask | cycle);
      const oracle = Math.max(...[...feasible].map((mask) => mask.toString(2).replaceAll("0", "").length));
      expect(solveCycles(input(ids.map((id) => item(id)), approvals)).objective.participatingMembers).toBe(oracle);
    }
  });
});
