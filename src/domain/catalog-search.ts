import type { Category } from "./types";

export interface CatalogCandidate {
  entityId: string;
  name: string;
  entityType: "urn:entity:book" | "urn:entity:artist" | "urn:entity:videogame";
  disambiguation: string;
  year: number | null;
  /** Catalog identifiers aid disambiguation; they do not verify a participant's physical edition. */
  isbn13?: string;
  isbn10?: string;
}
export interface CatalogSearch {
  id: string;
  query: string;
  category: Category;
  status: "queued" | "running" | "succeeded" | "failed";
  candidates: CatalogCandidate[];
  createdAt: string;
  expiresAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  cache: "hit" | "miss" | null;
}
