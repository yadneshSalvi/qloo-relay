import type { Category } from "./types";

export type AgentRunStatus = "queued" | "running" | "succeeded" | "partial" | "failed" | "cancelled" | "stale";

export interface AgentUsage {
  /** Reserved external requests, including requests whose outcome is uncertain. */
  qlooCalls: number;
  cacheHits: number;
  modelCalls: number;
  unreportedModelCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentTrace {
  sequence: number;
  stage: string;
  message: string;
  createdAt: string;
}

export interface DiscoveryDecision {
  itemId: string;
  giveItemId: string | null;
  evidenceId: string;
  category: Category;
  categoryRank: number;
  /** Deterministic possibilities under ONE hypothetical new approval, never consent. */
  possibleCycleSizes: number[];
  requiresApproval: true;
  explanation: string;
}

export interface AgentReport {
  headline: string;
  summary: string;
  nextAction: "review-trade" | "add-item" | "tune-taste" | "wait-for-inventory";
  decisions: DiscoveryDecision[];
  categoriesChecked: Category[];
  warnings: string[];
  model: string | null;
  /** AI selects where to look. Source ranks and all exchange transitions are validated code. */
  authority: "discovery-only";
}

export interface AgentRun {
  id: string;
  memberId: string;
  status: AgentRunStatus;
  stage: string;
  category: Category | "all";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  trace: AgentTrace[];
  usage: AgentUsage;
  report: AgentReport | null;
  canRetry: boolean;
  attempt: number;
}

export const EMPTY_USAGE: AgentUsage = { qlooCalls: 0, cacheHits: 0, modelCalls: 0, unreportedModelCalls: 0, inputTokens: 0, outputTokens: 0 };
export const ACTIVE_RUN_STATES: AgentRunStatus[] = ["queued", "running"];

export const RUN_LIMITS = {
  modelSteps: 8,
  qlooCalls: 3,
  toolCalls: 14,
  outputTokensPerStep: 1000,
  elapsedMs: 120_000,
  leaseMs: 45_000,
  cacheMs: 6 * 60 * 60 * 1000,
  maxAttempts: 3,
} as const;
