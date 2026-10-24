import { describe, expect, it } from "vitest";
import { parseCommand } from "../../src/domain/commands";

describe("strict command boundary", () => {
  it("rejects invented authorization, approval ownership, and extra agent instructions", () => {
    expect(() => parseCommand({ type: "createProposals", admin: true })).toThrow();
    expect(() => parseCommand({ type: "approve", memberId: "maya", giveItemId: "a", receiveItemId: "b", expectedGiveVersion: 1, expectedReceiveVersion: 1 })).toThrow();
    expect(() => parseCommand({ type: "receive", proposalId: "b1597853-a331-4414-b8c5-ec8f49a20c77", itemId: "a", conditionAccepted: true, autoRelease: true })).toThrow();
  });

  it("keeps saving, dismissing, exact approval, and confirmation as distinct intents", () => {
    expect(parseCommand({ type: "saveItem", itemId: "a" }).type).toBe("saveItem");
    expect(parseCommand({ type: "dismiss", itemId: "a", reason: "Not for this copy" }).type).toBe("dismiss");
    expect(() => parseCommand({ type: "approve", giveItemId: "a", receiveItemId: "b" })).toThrow();
    expect(() => parseCommand({ type: "preferences", seedWorkIds: ["a", "a"], novelty: 50 })).toThrow();
    expect(() => parseCommand({ type: "preferences", seedWorkIds: ["a"], novelty: 101 })).toThrow();
  });
});
