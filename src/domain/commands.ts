import { z } from "zod";
import type { Command } from "./types";

const id = z.string().min(1).max(120);
const version = z.number().int().positive();
const reason = z.string().trim().min(1).max(500);
const displayName = z.string().trim().min(1).max(40).optional();
const category = z.enum(["book", "record", "game"]);
const condition = z.enum(["like-new", "good", "fair"]);

export const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("startSession"), displayName }),
  z.strictObject({ type: z.literal("reset"), displayName }),
  z.strictObject({ type: z.literal("preferences"), seedWorkIds: z.array(id).min(1).max(5).refine((ids) => new Set(ids).size === ids.length, "Choose each reference once."), novelty: z.number().int().min(0).max(100) }),
  z.strictObject({ type: z.literal("discover"), category: category.optional(), mode: z.enum(["sample", "live"]).optional() }),
  z.strictObject({ type: z.literal("saveItem"), itemId: id }),
  z.strictObject({ type: z.literal("dismiss"), itemId: id, reason }),
  z.strictObject({ type: z.literal("addItem"), workId: id, edition: z.string().trim().min(2).max(160), condition, notes: z.string().trim().max(500), attested: z.boolean() }),
  z.strictObject({ type: z.literal("updateItem"), itemId: id, expectedVersion: version, edition: z.string().trim().min(2).max(160).optional(), condition: condition.optional(), notes: z.string().trim().max(500).optional() }).refine((value) => value.edition !== undefined || value.condition !== undefined || value.notes !== undefined, "Include an item change."),
  z.strictObject({ type: z.literal("withdrawItem"), itemId: id, expectedVersion: version, reason: reason.optional() }),
  z.strictObject({ type: z.literal("approve"), giveItemId: id, receiveItemId: id, expectedGiveVersion: version, expectedReceiveVersion: version, preferenceRank: z.number().int().min(1).max(100).optional() }),
  z.strictObject({ type: z.literal("revokeApproval"), approvalId: z.uuid(), reason }),
  z.strictObject({ type: z.literal("createProposals") }),
  z.strictObject({ type: z.literal("confirm"), proposalId: z.uuid(), memberId: id, expectedVersion: version }),
  z.strictObject({ type: z.literal("withdraw"), proposalId: z.uuid(), memberId: id, reason }),
  z.strictObject({ type: z.literal("receive"), proposalId: z.uuid(), itemId: id, conditionAccepted: z.boolean() }),
  z.strictObject({ type: z.literal("complete"), proposalId: z.uuid() }),
  z.strictObject({ type: z.literal("retryRepair"), proposalId: z.uuid() }),
]);

export function parseCommand(value: unknown): Command { return commandSchema.parse(value); }
