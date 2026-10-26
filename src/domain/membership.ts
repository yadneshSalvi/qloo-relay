import { z } from "zod";

const name = z.string().trim().min(2).max(60);
const label = z.string().trim().min(3).max(160);
export const membershipSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("createCommunity"), communityName: name, displayName: name, location: label, handoffWindow: label, acceptedRules: z.literal(true) }),
  z.strictObject({ type: z.literal("joinCommunity"), inviteCode: z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/), displayName: name, acceptedRules: z.literal(true) }),
  z.strictObject({ type: z.literal("createInvite"), label: name, role: z.enum(["member", "coordinator"]), expiresInHours: z.number().int().min(1).max(72) }),
  z.strictObject({ type: z.literal("revokeInvite"), inviteId: z.uuid() }),
  z.strictObject({ type: z.literal("revokeMember"), memberId: z.string().min(1).max(120), reason: z.string().trim().min(5).max(500) }),
  z.strictObject({ type: z.literal("leaveBrowser") }),
]);
export type MembershipCommand = z.infer<typeof membershipSchema>;
export interface CommunityInvite {
  id: string;
  label: string;
  role: "member" | "coordinator";
  createdAt: string;
  expiresAt: string;
  status: "available" | "used" | "revoked" | "expired";
}
