import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { DomainError } from "../domain/errors";
import type { Category, Item, Work } from "../domain/types";

export const QLOO_ADAPTER_VERSION = "relay-harness-0.1.26-v1";
export const QLOO_MAX_CANDIDATES = 10;
const entityId = z.uuid().transform(value => value.toLowerCase());
const entityTypes = { book: "urn:entity:book", game: "urn:entity:videogame", record: "urn:entity:artist" } as const;
const runFile = promisify(execFile);

interface Scope {
  scopeId: string;
  memberId: string;
  works: Work[];
  items: Item[];
  category: Category;
  seedWorkIds: string[];
  preferenceVersion: number;
}
export interface PreparedRank {
  adapterVersion: typeof QLOO_ADAPTER_VERSION;
  scopeHash: string;
  memberId: string;
  category: Category;
  request: { options: string[]; option_type: string; signals: string[] };
  copies: { itemId: string; workId: string; version: number; entityId: string }[];
  shortlist: { eligibleEntities: number; selectedEntities: number; policy: "entity-id-order" };
}

function mappedId(work: Work | undefined): string {
  const parsed = entityId.safeParse(work?.qlooEntityId);
  if (work?.mappingStatus !== "verified" || !parsed.success) throw new DomainError("VERIFIED_MAPPING_REQUIRED", "Live ranking needs verified Qloo identities for every selected signal and candidate. Authored identities cannot be sent to Qloo.", 422);
  return parsed.data;
}

/** One output category and at most ten unique entities. Copies stay application-owned. */
export function prepareRank(scope: Scope): PreparedRank {
  if (!scope.scopeId || !scope.memberId || scope.seedWorkIds.length < 1 || scope.seedWorkIds.length > 10) throw new DomainError("INVALID_RANK_SCOPE", "Provide an explicit community, member and one to ten taste signals.", 422);
  const works = new Map(scope.works.map(work => [work.id, work]));
  const signals = [...new Set(scope.seedWorkIds.map(id => mappedId(works.get(id))))].sort();
  const eligible = scope.items.filter(item => item.ownerId !== scope.memberId && item.attested && item.state === "available" && !item.heldByProposalId && works.get(item.workId)?.category === scope.category);
  const copies = eligible.map(item => ({ itemId: item.id, workId: item.workId, version: item.version, entityId: mappedId(works.get(item.workId)) })).sort((a, b) => a.itemId.localeCompare(b.itemId));
  const entities = [...new Set(copies.map(copy => copy.entityId))].sort();
  if (!entities.length) throw new DomainError("NO_ELIGIBLE_CANDIDATES", "There are no verified, available copies in this category to rank.", 422);
  const options = entities.slice(0, QLOO_MAX_CANDIDATES);
  const selectedCopies = copies.filter(copy => options.includes(copy.entityId));
  const request = { options, option_type: entityTypes[scope.category], signals };
  // Include all eligible copies, including shortlist exclusions, so coverage cannot silently change.
  const scopeHash = createHash("sha256").update(JSON.stringify({ adapter: QLOO_ADAPTER_VERSION, scopeId: scope.scopeId, memberId: scope.memberId, preferenceVersion: scope.preferenceVersion, category: scope.category, request, copies })).digest("hex");
  return { adapterVersion: QLOO_ADAPTER_VERSION, scopeHash, memberId: scope.memberId, category: scope.category, request, copies: selectedCopies, shortlist: { eligibleEntities: entities.length, selectedEntities: options.length, policy: "entity-id-order" } };
}

export function requireQlooConfiguration(env: Record<string, string | undefined> = process.env) {
  if (!env.QLOO_API_KEY?.trim()) throw new DomainError("MISSING_QLOO_KEY", "Live Qloo discovery is not configured. Add a server-side QLOO_API_KEY. Your sample workspace is preserved.", 503);
  const baseUrl = env.QLOO_BASE_URL ?? "https://api.qloo.com";
  const allowed = ["https://api.qloo.com", "https://hackathon.api.qloo.com"];
  if (!allowed.includes(baseUrl) || (baseUrl !== allowed[0] && env.QLOO_TRUSTED_BASE_URL !== baseUrl)) throw new DomainError("QLOO_CONFIGURATION", "Configure the official Qloo endpoint and explicitly match QLOO_TRUSTED_BASE_URL for the event gateway.", 503);
  return { apiKey: env.QLOO_API_KEY.trim(), baseUrl };
}

type Transport = (request: PreparedRank["request"], configuration: ReturnType<typeof requireQlooConfiguration>) => Promise<unknown>;

/** The CLI emits structured failures with a nonzero exit code and no status.
 * Normalize only that documented shape; diagnostics never become result prose.
 */
export function parseOfficialExecOutput(stdout: string): unknown {
  const raw: unknown = JSON.parse(stdout);
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "operation" in raw && raw.operation === "rank" && "error" in raw && !("status" in raw)) {
    return { ...raw, schema_version: "1.0-preview.1", status: "error", results: [] };
  }
  return raw;
}

/** Supported official `qloo exec` surface, no shell, 15-second deadline, no retries/fallback. */
export const runOfficialHarness: Transport = async (request, configuration) => {
  try {
    const bin = fileURLToPath(new URL("./bin.js", import.meta.resolve("@qloo/qloo-harness")));
    const { stdout } = await runFile(process.execPath, [bin, "exec", "rank", "--input", JSON.stringify(request)], {
      timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 512_000, encoding: "utf8",
      env: { NODE_ENV: "production", PATH: process.env.PATH, QLOO_HOME: resolve(".data/qloo"), QLOO_API_KEY: configuration.apiKey, QLOO_BASE_URL: configuration.baseUrl, QLOO_TRUSTED_BASE_URL: configuration.baseUrl },
    });
    return parseOfficialExecOutput(stdout);
  } catch (error) {
    const timedOut = !!error && typeof error === "object" && "killed" in error && error.killed;
    if (!timedOut && error && typeof error === "object" && "code" in error && [1, 2, 4, 130].includes(Number(error.code)) && "stdout" in error && typeof error.stdout === "string") {
      try { return parseOfficialExecOutput(error.stdout); } catch { /* Reject incomplete or non-JSON diagnostics. */ }
    }
    throw new DomainError(timedOut ? "QLOO_TIMEOUT" : "QLOO_UPSTREAM", timedOut ? "Qloo did not complete within the request deadline. No sample results were substituted." : "The official Qloo workflow did not complete. No sample results were substituted.", 503);
  }
};

const rankEnvelope = z.object({
  schema_version: z.literal("1.0-preview.1"), operation: z.literal("rank"), status: z.enum(["ok", "empty", "needs_input", "partial", "degraded", "error"]),
  results: z.array(z.object({ entity_id: entityId, type: z.string(), affinity: z.number().finite().optional() })).max(QLOO_MAX_CANDIDATES).default([]),
  result_count: z.number().int().nonnegative().optional(),
  error: z.object({ code: z.string(), layer: z.string(), retryable: z.boolean(), recovery: z.string() }).optional(),
}).superRefine((value, ctx) => {
  if (value.status === "error" && !value.error) ctx.addIssue({ code: "custom", message: "A workflow failure needs an error contract." });
  if (value.result_count !== undefined && value.result_count !== value.results.length) ctx.addIssue({ code: "custom", message: "The result count is inconsistent." });
  if (["empty", "needs_input", "error"].includes(value.status) && value.results.length) ctx.addIssue({ code: "custom", message: "This workflow state cannot release ranked results." });
});
const safeFailureCodes = new Set(["CANCELLED", "HARNESS_INTERNAL", "QLOO_AUTH", "QLOO_CONNECT", "QLOO_CONTRACT", "QLOO_DNS", "QLOO_RATE_LIMIT", "QLOO_TIMEOUT", "QLOO_TLS", "QLOO_UPSTREAM", "RESOLVER_AUTH", "RESOLVER_CONNECT", "RESOLVER_CONTRACT", "RESOLVER_TIMEOUT", "RESOLVER_UPSTREAM", "TOOL_INPUT"]);

/** Read-only integration boundary. Production discovery needs a durable job and mapping UI first. */
export async function rankVerifiedInventory(prepared: PreparedRank, current: Scope, options: { env?: Record<string, string | undefined>; transport?: Transport } = {}) {
  const configuration = requireQlooConfiguration(options.env);
  if (prepareRank(current).scopeHash !== prepared.scopeHash) throw new DomainError("STALE_CANDIDATES", "Inventory or preferences changed. Prepare a fresh candidate set before ranking.");
  const parsed = rankEnvelope.safeParse(await (options.transport ?? runOfficialHarness)(prepared.request, configuration));
  if (!parsed.success) throw new DomainError("QLOO_RESPONSE_INVALID", "Qloo returned a result outside the verified ranking contract. No results were substituted.", 502);
  const seen = new Set<string>();
  const rankings = parsed.data.results.map((row, index) => {
    if (!prepared.request.options.includes(row.entity_id) || row.type !== prepared.request.option_type || seen.has(row.entity_id)) throw new DomainError("QLOO_RESPONSE_INVALID", "Qloo returned an unrequested, duplicate or wrong-category entity. The result was rejected.", 502);
    seen.add(row.entity_id);
    return { entityId: row.entity_id, position: index + 1, affinity: row.affinity ?? null, itemIds: prepared.copies.filter(copy => copy.entityId === row.entity_id).map(copy => copy.itemId) };
  });
  const status = parsed.data.status;
  const warning = status === "partial" ? "Some Qloo evidence is unavailable." : status === "degraded" ? "Qloo reported reduced evidence quality." : status === "needs_input" ? "Review the confirmed cultural references or candidate mappings." : status === "error" ? "Qloo could not complete this request. No sample result was substituted." : null;
  const error = status === "error" && parsed.data.error ? { code: safeFailureCodes.has(parsed.data.error.code) ? parsed.data.error.code : "QLOO_UPSTREAM", retryable: parsed.data.error.retryable } : undefined;
  return { source: "live-qloo" as const, transport: "official-harness-exec" as const, adapterVersion: QLOO_ADAPTER_VERSION, scopeHash: prepared.scopeHash, generatedAt: new Date().toISOString(), shortlist: prepared.shortlist, status, warning, ...(error ? { error } : {}), rankings };
}
