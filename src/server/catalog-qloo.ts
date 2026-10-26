import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { DomainError } from "../domain/errors";
import type { CatalogCandidate } from "../domain/catalog-search";
import type { Category } from "../domain/types";
import { requireQlooConfiguration } from "./qloo";

const runFile = promisify(execFile);
const entityTypes = { book: "urn:entity:book", record: "urn:entity:artist", game: "urn:entity:videogame" } as const;
const aliases = { book: "book", record: "artist", game: "videogame" } as const;
const rowsSchema = z.array(z.object({
  entity_id: z.uuid().transform(value => value.toLowerCase()), name: z.string().min(1).max(300),
  types: z.array(z.string()).min(1).max(10).optional(), type: z.string().optional(), subtype: z.string().optional(), disambiguation: z.string().max(1000).optional(),
  properties: z.object({ publication_year: z.number().int().optional(), release_year: z.number().int().optional(), publication_date: z.string().optional(), release_date: z.string().optional(), isbn13: z.string().max(64).optional(), isbn10: z.string().max(64).optional() }).optional(),
})).max(5);

export function parseCatalogSearchResponse(raw: unknown, category: Category): CatalogCandidate[] {
  const rows = rowsSchema.safeParse(raw);
  if (!rows.success) throw new DomainError("CATALOG_RESPONSE_INVALID", "Qloo returned an unsupported catalog response. No identity was selected.", 502);
  const seen = new Set<string>();
  return rows.data.map(row => {
    const declaredTypes = [...(row.types ?? []), ...(row.type ? [row.type] : []), ...(row.subtype ? [row.subtype] : [])];
    const expected = entityTypes[category];
    if (!declaredTypes.includes(expected) || declaredTypes.some(type => type !== expected && type !== "urn:entity") || seen.has(row.entity_id)) throw new DomainError("CATALOG_RESPONSE_INVALID", "A duplicate or wrong-category identity was rejected. Search again with a more specific title.", 502);
    seen.add(row.entity_id);
    const date = row.properties?.publication_date ?? row.properties?.release_date ?? row.disambiguation ?? "";
    const parsedYear = row.properties?.publication_year ?? row.properties?.release_year ?? (/^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);
    const isbn13 = category === "book" ? row.properties?.isbn13?.replace(/[\s-]/g, "") : undefined;
    const isbn10 = category === "book" ? row.properties?.isbn10?.replace(/[\s-]/g, "").toUpperCase() : undefined;
    return { entityId: row.entity_id, entityType: entityTypes[category], name: row.name, disambiguation: (row.disambiguation ?? "").slice(0, 300), year: category !== "record" && parsedYear && parsedYear > 0 && parsedYear <= new Date().getFullYear() + 3 ? parsedYear : null, ...(isbn13 && /^\d{13}$/.test(isbn13) ? { isbn13 } : {}), ...(isbn10 && /^\d{9}[\dX]$/.test(isbn10) ? { isbn10 } : {}) };
  });
}

export type CatalogTransport = (query: string, category: Category) => Promise<unknown>;
export function officialCatalogArguments(query: string, category: Category): string[] {
  return ["api", "search", "--query", query, "--type", aliases[category], "--take", "5", "--json"];
}
export const runOfficialCatalogSearch: CatalogTransport = async (query, category) => {
  const config = requireQlooConfiguration();
  try {
    const bin = fileURLToPath(new URL("./bin.js", import.meta.resolve("@qloo/qloo-harness")));
    const { stdout } = await runFile(process.execPath, ["--import", resolve("scripts/qloo-fetch-guard.mjs"), bin, ...officialCatalogArguments(query, category)], {
      timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 512_000, encoding: "utf8",
      env: { NODE_ENV: "production", PATH: process.env.PATH, QLOO_HOME: resolve(".data/qloo"), QLOO_API_KEY: config.apiKey, QLOO_BASE_URL: config.baseUrl, QLOO_TRUSTED_BASE_URL: config.baseUrl, RELAY_QLOO_FETCH_GUARD: "1", RELAY_QLOO_OPERATION: "search" },
    });
    return JSON.parse(stdout);
  } catch { throw new DomainError("CATALOG_UPSTREAM", "The catalog search could not finish within its single-request budget. Your choices are preserved; no identity was substituted.", 503); }
};
