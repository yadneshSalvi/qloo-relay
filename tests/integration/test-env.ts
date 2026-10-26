import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

// Never let the live discovery worker claim an integration fixture or let a test
// unexpectedly spend provider credit. Tests use a dedicated database and fakes.
if (existsSync(".env.local")) loadEnvFile(".env.local");
const explicit = process.env.RELAY_TEST_DATABASE_URL;
if (explicit) {
  const url = new URL(explicit);
  if (!decodeURIComponent(url.pathname).endsWith("_test")) throw new Error("RELAY_TEST_DATABASE_URL must name a dedicated database ending in _test.");
  process.env.DATABASE_URL = explicit;
} else if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Set RELAY_TEST_DATABASE_URL to a dedicated test database before running integration tests against a remote server.");
  url.pathname = "/relay_test";
  process.env.DATABASE_URL = url.toString();
}
delete process.env.QLOO_API_KEY;
delete process.env.OPENAI_API_KEY;
