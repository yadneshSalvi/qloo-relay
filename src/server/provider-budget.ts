import { DomainError } from "../domain/errors";

export function configuredLimit(name: string, fallback: number, maximum: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) throw new DomainError("BUDGET_CONFIGURATION", "A server-side provider usage limit is invalid.", 503);
  return number;
}
