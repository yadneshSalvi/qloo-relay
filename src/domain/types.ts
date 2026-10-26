import type { AgentRun } from "./runtime";

/** Public, serializable contracts. All people and inventory in sample mode are fictional. */
export type Category = "book" | "record" | "game";
export type DataOrigin = "authored-sample" | "live-qloo" | "participant-recorded";
export type ItemCondition = "like-new" | "good" | "fair";
export type ItemState = "available" | "reserved" | "at_hub" | "exchanged" | "withdrawn" | "disputed";
export type ProposalStatus = "proposed" | "reserved" | "handoff_ready" | "completed" | "withdrawn" | "expired" | "invalidated" | "disputed";

export interface Work {
  id: string;
  title: string;
  author: string;
  subtitle: string;
  category: Category;
  year: number;
  tags: string[];
  description: string;
  colors: { background: string; foreground: string; accent: string };
  mappingStatus: "authored" | "unresolved" | "verified";
  qlooEntityId: string | null;
  /** Cultural references such as artists cannot be listed as a physical album without a separate title confirmation. */
  referenceOnly?: boolean;
  dataOrigin: DataOrigin;
}

export interface Member {
  id: string;
  name: string;
  initials: string;
  bio: string;
  color: string;
  role: "member" | "coordinator";
  isYou: boolean;
  dataOrigin: "authored-sample" | "participant-recorded";
  active?: boolean;
}

export interface Item {
  id: string;
  workId: string;
  ownerId: string;
  edition: string;
  condition: ItemCondition;
  notes: string;
  attested: boolean;
  version: number;
  state: ItemState;
  heldByProposalId: string | null;
  createdAt: string;
  dataOrigin: "authored-sample" | "participant-recorded";
}

export interface Preferences {
  version: number;
  seedWorkIds: string[];
  /** 0 = familiar; 50 = balanced; 100 = adventurous. */
  novelty: number;
  updatedAt: string;
}

export interface ExchangeTerms {
  version: string;
  hash: string;
  hubName: string;
  location: string;
  handoffWindow: string;
  rules: string[];
}

export interface Approval {
  id: string;
  memberId: string;
  giveItemId: string;
  receiveItemId: string;
  giveVersion: number;
  receiveVersion: number;
  termsVersion: string;
  termsHash: string;
  preferenceRank: number;
  status: "active" | "revoked" | "consumed" | "expired";
  expiresAt: string;
  createdAt: string;
  /** Seeded sample-member approvals are visibly authored; user clicks are session actions. */
  authored: boolean;
  evidenceId: string | null;
}

export interface ProposalLeg {
  memberId: string;
  giveItemId: string;
  receiveItemId: string;
  approvalId: string;
  giveVersion: number;
  receiveVersion: number;
  confirmed: boolean;
  confirmedAt: string | null;
}

export interface HandoffReceipt {
  itemId: string;
  receivedAt: string;
  inspectorId: string;
  conditionAccepted: boolean;
  releasedAt: string | null;
}

export interface Proposal {
  id: string;
  /** Immutable displayed terms version; confirmation does not change this number. */
  version: number;
  status: ProposalStatus;
  legs: ProposalLeg[];
  terms: ExchangeTerms;
  expiresAt: string;
  createdAt: string;
  reservedAt: string | null;
  completedAt: string | null;
  withdrawnBy: string | null;
  withdrawalReason: string | null;
  disputeKind: "condition" | "custody" | null;
  repairOf: string | null;
  receipts: HandoffReceipt[];
  dataOrigin: "authored-sample" | "participant-recorded";
}

export interface DiscoverySuggestion {
  itemId: string;
  rank: number;
  reason: string;
  signals: string[];
  evidenceId: string;
  source: DataOrigin;
}

export interface DiscoveryRun {
  id: string;
  status: "ready";
  source: DataOrigin;
  category: Category | "all";
  preferenceVersion: number;
  candidateItemIds: string[];
  candidateSetHash: string;
  suggestions: DiscoverySuggestion[];
  createdAt: string;
  disclosure: string;
}

export interface Evidence {
  id: string;
  kind: "session" | "preferences" | "discovery" | "approval" | "solver" | "confirmation" | "reservation" | "receipt" | "release" | "withdrawal" | "repair" | "inventory";
  source: DataOrigin;
  title: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface DomainEvent {
  id: string;
  sequence: number;
  type: string;
  aggregateId: string;
  summary: string;
  createdAt: string;
}

export interface WorkspaceStats {
  offeredItems: number;
  availableItems: number;
  activeApprovals: number;
  proposedCycles: number;
  reservedCycles: number;
  completedCycles: number;
  completedMembers: number;
  confirmedMembers: number;
  /** These counters describe this fictional session, never a real-world pilot. */
  dataOrigin: "authored-sample" | "participant-recorded";
}

export interface Workspace {
  session: {
    id: string;
    displayName: string;
    mode: "sample" | "private";
    dataOrigin: "authored-sample" | "participant-recorded";
    canRolePlay: boolean;
    createdAt: string;
    expiresAt: string;
  };
  currentMemberId: string;
  access: {
    role: "member" | "coordinator";
    authentication: "sample-role-play" | "invite-session";
    canCoordinate: boolean;
    expiresAt: string;
  };
  members: Member[];
  works: Work[];
  items: Item[];
  preferences: Preferences;
  terms: ExchangeTerms;
  approvals: Approval[];
  savedItemIds: string[];
  dismissals: { itemId: string; reason: string; createdAt: string }[];
  proposals: Proposal[];
  discovery: DiscoveryRun | null;
  agentRuns: AgentRun[];
  evidence: Evidence[];
  events: DomainEvent[];
  stats: WorkspaceStats;
  capabilities: {
    discovery: "authored-sample" | "live-qloo";
    liveQloo: "unconfigured" | "mapping-required" | "ready";
    agent: "unconfigured" | "ready";
    rolePlay: boolean;
    outboundMessaging: false;
  };
}

export type Command =
  | { type: "startSession"; displayName?: string }
  | { type: "reset"; displayName?: string }
  | { type: "preferences"; seedWorkIds: string[]; novelty: number }
  | { type: "discover"; category?: Category; mode?: "sample" | "live" }
  | { type: "cancelRun"; runId: string }
  | { type: "retryRun"; runId: string }
  | { type: "saveItem"; itemId: string }
  | { type: "dismiss"; itemId: string; reason: string }
  | { type: "addItem"; workId: string; edition: string; condition: ItemCondition; notes: string; attested: boolean }
  | { type: "updateItem"; itemId: string; expectedVersion: number; edition?: string; condition?: ItemCondition; notes?: string }
  | { type: "withdrawItem"; itemId: string; expectedVersion: number; reason?: string }
  | { type: "approve"; giveItemId: string; receiveItemId: string; expectedGiveVersion: number; expectedReceiveVersion: number; preferenceRank?: number }
  | { type: "revokeApproval"; approvalId: string; reason: string }
  | { type: "createProposals" }
  | { type: "confirm"; proposalId: string; memberId: string; expectedVersion: number }
  | { type: "withdraw"; proposalId: string; memberId: string; reason: string }
  | { type: "receive"; proposalId: string; itemId: string; conditionAccepted: boolean }
  | { type: "complete"; proposalId: string }
  | { type: "retryRepair"; proposalId: string };

export interface ApiResult { workspace: Workspace; notice?: string }
export interface ApiError { error: { code: string; message: string; details?: unknown } }
