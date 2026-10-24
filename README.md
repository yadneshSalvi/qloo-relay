# RELAY

Discover new wants. Make exchanges happen.

RELAY is a working local exchange app for books, records, and physical games. It takes an exact “I would give this copy for that copy,” finds a compatible exchange of two to five people, collects everyone's confirmation, and records an inspected handoff at one neighborhood desk.

The current experience is an **explicitly authored sample community**, with real PostgreSQL persistence and isolated browser sessions. Taste suggestions, fictional members, and their prewritten approvals are not Qloo responses. No live Qloo result, AI model run, real-world exchange, deployment, or measured product impact is claimed.

## Run locally

Use Node **22.22.3** (`.nvmrc`; supported minimum 22.19.0), pnpm 10.15.0, and PostgreSQL 17. A Qloo key is not needed for the sample experience.

```sh
nvm use
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
docker compose up -d --wait
pnpm db:migrate
pnpm dev
```

Open [http://127.0.0.1:3101](http://127.0.0.1:3101). Both the app and the compose database bind only to loopback. PostgreSQL uses `127.0.0.1:55432` and a named data volume. The example password is for local development only. If a dedicated database already exists, skip Docker and set `DATABASE_URL` instead. Do not migrate an unrelated database.

`APP_ORIGIN` must match the browser's public origin, including its port. It allows the explicitly configured origin when Next.js or a proxy normalizes the internal host. JSON mutations still require an allowed `Origin`, reject `Sec-Fetch-Site: cross-site`, and require an idempotency key.

The migration creates the `relay` schema and shared cultural catalog. Each new browser cookie creates its own fictional members, copies, approvals, and events. Refreshing or restarting Node preserves state. **Your workspace → Start a fresh sample** creates a new community without erasing another browser's state. The cookie expires after seven days.

## Try the complete exchange

1. On **Discover**, choose **Find your next favorite**. Explore categories, save a copy, or inspect its edition and condition. Saving never approves a trade.
2. Open **Hades**, select your **The Creative Act**, review the exact give/get and hub terms, check the consent box, and choose **I'd make this trade**.
3. A three-person circle links you, Maya, and Noah. Confirm your part, then open **Try a member's view** and explicitly confirm as Maya and Noah. These controls role-play fictional people; they are not real authentication.
4. After the last confirmation, all three copies become reserved in one transaction. Open **Your handoff details**, then **Open Jo's sample desk**.
5. Inspect and accept each copy separately. Only after all three pass can you acknowledge the complete set and **Record handoff completion**. Results and evidence reflect those recorded sample actions.

For a repair, withdraw as Maya **before hub receipt**, then choose **Find another way**. A new two-person proposal needs fresh confirmations. For a condition problem, report a mismatch; release freezes until a successful explicit reinspection. Withdrawal or expiry after physical receipt creates a custody dispute and leaves the allocation frozen for manual review.

## What works

- Responsive discovery and global keyboard search; categories, condition filters, saved items, dismissals, and meaningful empty states.
- Eighteen cultural works separated from sixteen initial physical copies. Your shelf supports adding copies, ownership attestation, versioned edition/condition edits, and withdrawal.
- Versioned taste preferences with one to five favorites and a curiosity control. Sample suggestions use authored tags and preference weights with visible provenance.
- Exact approvals tied to both item versions and hub terms, valid for 48 hours. Proposed/reserved exchanges have a separate two-hour window.
- Deterministic enumeration of two- to five-person cycles and exact member- and item-disjoint selection. Selection first maximizes participating members, then prefers explicit lower-ranked choices and simpler handoffs. Search budgets fail honestly instead of returning a partial “optimal” result.
- All-party confirmation; PostgreSQL locks, constraints, and unique active reservations; idempotent commands and safe replay. Changed versions, expired consent, and conflicts are rejected.
- Coordinator inspection, condition disputes/reinspection, atomic completion, withdrawal, fresh repair, ordered events, inspectable/exportable provenance, and sample outcome counts.
- Keyboard-operable Radix dialogs, trapped mobile navigation, reduced-motion support, and automated contrast/accessibility coverage.

## Architecture and API

Next.js 16 App Router, React 19, TypeScript, PostgreSQL, Zod, Radix, and custom CSS. Fonts are local; the sample flow makes no external service call.

| Boundary | Responsibility |
| --- | --- |
| `src/components` | Product UI and shared workspace state |
| `src/domain` | Contracts, catalog, command validation, consent windows, deterministic solver |
| `src/server/service.ts` | Session-scoped transactional commands and lifecycle rules |
| `src/server/schema.ts` | Schema, foreign keys, reservation constraints |
| `src/server/qloo.ts` | Guarded official-harness integration boundary |
| `tests` | Domain, actual PostgreSQL, API, browser, accessibility verification |

- `GET /api/workspace` creates/loads the cookie's private workspace.
- `POST /api/command` accepts the command contract in `src/domain/commands.ts` with `Idempotency-Key` and same-origin JSON headers. Same key/payload replays safely; a different payload using that key is rejected.
- `GET /api/events?after=0` returns ordered events and a continuation sequence. This is JSON pagination, not server-sent events.
- `GET /api/health` checks database connectivity.

Every mutation locks its community session row. Active reservation uniqueness independently protects copies and members. An append-only event log and transactional outbox accompany successful changes. The browser refreshes authoritative state on focus and after an uncertain command, retaining the idempotency key for an exact retry. There is no background message-delivery worker.

## Qloo boundary and limitations

**Check live discovery** fails explicitly when the key is missing or the catalog lacks verified identities. It preserves sample state and never substitutes authored suggestions into a live result. Supplying a key alone does not enable live discovery.

The prepared server adapter uses pinned official `@qloo/qloo-harness` 0.1.26 `qloo exec rank`. It requires verified UUID mappings, separates categories, deduplicates entities, and shortlists at most ten candidates with recorded coverage. Evidence binds to community/member scope, preference version, signal IDs, and copy versions. It rejects unsolicited, duplicate, or wrong-category results and fans ranked entities back to exact eligible copies. Record discovery maps to a verified **artist** identity, not a pressing-level similarity claim. The child process has a 15-second deadline, bounded output, no shell, and no silent retry or transport/sample fallback. Keys remain in its environment, never command arguments or returned evidence.

Set `QLOO_API_KEY` server-side when available. The event gateway requires matching `QLOO_BASE_URL` and `QLOO_TRUSTED_BASE_URL` as in `.env.example`. The adapter preserves `ok`, `empty`, `needs_input`, `partial`, `degraded`, and `error`, including structured failures from nonzero CLI exits; private recovery prose is suppressed. Adapter tests inject responses. **No authenticated Qloo call has been tested.** The live adapter is not connected to user discovery yet: verified identity resolution, ambiguity confirmation, durable external-call jobs, and a final inventory recheck after the external response remain required. There is no enabled LLM agent or invented model identifier.

This is a local sample product, not an open public marketplace. Real member authentication, membership permissions, messaging, photos/scanning, real coordinator accounts, custody-dispute resolution, scheduled expiry/cleanup, notifications, a real-world pilot, and production rate limiting are not implemented. Expiry reconciles on workspace reads/commands; no scheduler runs. Expired sessions remain stored until an operator applies a retention policy. Workspace evidence shows the latest 100 records/events; the event endpoint supports pagination. Shelf additions use the curated catalog. User consent and deterministic constraints remain authoritative regardless of a future model.

## Verify

With `.env.local` configured and PostgreSQL available:

```sh
pnpm db:migrate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm test` includes actual PostgreSQL integration tests. They create isolated session records and clean them up; no in-memory substitute is used. Coverage includes a brute-force graph oracle, solver exhaustion, competing final confirmations, reservation uniqueness/rollback, approval/item withdrawal races, pool restart durability, idempotent reset, expiry, repair, inspection disputes, and Qloo boundary validation.

Start the app separately, then run:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

If Chrome is installed, `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e` uses it. `PLAYWRIGHT_BASE_URL` can target another local instance. Seven browser tests cover completed handoff, repair, reinspection, shelf/taste persistence, honest live failures, 390px/768px layouts, keyboard search/navigation, and axe scans across principal pages and flow states. Automated accessibility checks supplement a manual audit; they do not establish complete accessibility conformance.

## Production build

Stop the development server on port 3101, then run `pnpm build` and `pnpm start`. Use persistent Node 22.19+ and PostgreSQL for any private hosted evaluation. Set `DATABASE_URL` and the exact HTTPS `APP_ORIGIN`, migrate before startup, and terminate TLS at the host/proxy. Secure cookies follow the request protocol; validate forwarded HTTPS configuration before hosting. The prepared CLI adapter requires Node process execution and its installed package; it is not an Edge integration. No deployment or production readiness is claimed.

## Assets and license

Jackets, vinyl illustrations, the RELAY mark, and decorative diagrams are original SVG/CSS studies, not official product covers. Work/artist names identify cultural works without implying endorsement. Descriptions and fictional biographies are authored. Geist Variable and Fraunces Variable are locally bundled from Fontsource under their SIL Open Font License distributions. Icons are Lucide (ISC). Third-party packages retain their licenses.

Application code: [MIT](LICENSE), copyright 2026 Yadnesh Salvi.

