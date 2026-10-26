# RELAY

**Discover new wants. Make exchanges happen.**

[Open the deployed RELAY app](https://relay-web-nm4t32wiiq-uc.a.run.app) · [Watch the 2:57 demo](https://relay-demo-641101150486.us-central1.run.app/) · [Release verification](docs/RELEASE-VERIFICATION.md) · [Submission overview](docs/SUBMISSION.md)

RELAY helps a small community exchange books, records, and physical games. Qloo discovers cultural connections inside offered inventory. A bounded OpenAI agent checks useful categories and possible exchange paths. People approve exact copies; a deterministic solver connects two to five members; each participant confirms separately; a coordinator inspects the complete set before recording its release.

The **sample neighborhood** contains fictional people, copies, and authored starting approvals. A **private community** starts empty, with individual invitations and separate participant/coordinator permissions. Live evidence can accompany either mode without changing the provenance of its inventory. Neither a model run nor a recorded sample handoff establishes a real participant outcome.

## Run locally

Use Node **22.22.3** (`.nvmrc`; minimum 22.19.0), pnpm 10.15.0, and PostgreSQL 17. The sample exchange needs no provider credentials.

```sh
nvm use
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
docker compose up -d --wait
pnpm db:migrate
pnpm dev
```

Open [http://127.0.0.1:3101](http://127.0.0.1:3101). The app and Compose database bind to loopback. PostgreSQL uses port 55432 and a persistent named volume. The example password is for local development only. With an existing dedicated database, skip Docker and set `DATABASE_URL`; never migrate an unrelated database.

`APP_ORIGIN` must match the browser origin, including its port. Mutations require same-origin JSON and an idempotency key. Refreshing or restarting Node preserves the workspace. **Start a fresh sample** creates another isolated fictional community. Access expires after seven days.

## Live discovery and catalog search

Set `QLOO_API_KEY` and `OPENAI_API_KEY` in the worker environment, with the official endpoint settings in `.env.example`. Start a second terminal:

```sh
pnpm worker
```

The local worker reads this project's optional `.env.local`; it never reads a parent project's credentials. The direct OpenAI Responses provider defaults to `gpt-6.1-sol`, configurable through `OPENAI_MODEL`. Secrets never enter browser code, model prompts, command arguments, or returned evidence.

On **Your taste**, choose **Find another favorite**. On **Your shelf → Add a copy**, choose **Find another title or artist**. Search explicitly for a book, game, or artist, inspect up to five identities, and confirm the one you recognize. Confirmation adds an identity to your private catalog; saving favorites and listing an attested physical copy remain separate actions. Available ISBN identifiers describe the catalog record, not a verified physical edition. An artist favorite cannot be listed as an album: record inventory requires a separately supplied album title, pressing, condition, and ownership attestation.

**Explore with live Qloo + AI** starts a durable discovery run. The UI shows stages, checked categories, source evidence, reserved provider requests, reported model tokens, and any unreported usage. A focused category action is also available. Cancel stops publication; retry uses saved evidence where valid. Uncertain provider attempts remain counted.

Live ranking requires verified identities for selected favorites and eligible offered copies. The repository's starter works deliberately contain **no Qloo response data or verified IDs**. An operator can independently resolve/review those identities, keep the result outside Git, and run:

```sh
pnpm catalog:import /absolute/private/path/reviewed-mappings.json
```

The importer validates categories; its schema is in [scripts/import-mappings.ts](scripts/import-mappings.ts). Alternatively, use participant-confirmed search and list those works in a private community. Missing credentials, mappings, responses, or budget produce visible failures; authored suggestions never substitute for live evidence.

## Try an exchange

For the authored sample, choose **Find your next favorite**, open **Hades**, and approve giving your **The Creative Act** for that exact game copy. Seeded approvals permit a three-person circle with Maya and Noah. Confirm your own part, then explicitly role-play the other sample members. These controls appear only in sample mode. Inspect every copy at **Jo's sample desk**, then record completion.

For independent access, open **Your community**, create a private event, and issue each participant a single-use invitation. Open them in separate browsers/profiles. Each member chooses favorites, lists owned copies, and approves only their own exact give/get terms. The coordinator organizes and inspects exchanges but cannot impersonate participant consent. Invitation/access tokens are hashed at rest; names and ownership remain self-reported.

The final confirmation reserves every copy atomically. Changed editions, conditions, copy versions, terms, expired approvals, or competing reservations invalidate stale actions. Withdrawal before receipt releases reservations and can lead to a repaired proposal requiring fresh confirmations. A condition mismatch blocks release until reinspection. Withdrawal or membership revocation after receipt freezes the entire allocation for manual custody review.

## Decision boundaries

| Decision | Authority |
| --- | --- |
| Cultural identity | Qloo result, explicitly confirmed by a participant or reviewed operator |
| Cultural affinity | Qloo ranking within the requested category and candidate set |
| Which categories/copies to inspect | Bounded OpenAI tool agent |
| Possible exchange path | Deterministic counterfactual calculation; no approval inserted |
| Exact give/get approval and final confirmation | Scoped participant session |
| Disjoint allocation and reservation | Deterministic solver and PostgreSQL transaction/constraints |
| Inspection and recorded release | Scoped coordinator plus all-copy settlement rules |

The solver enumerates two- to five-person cycles and selects an exact member- and item-disjoint set. It first maximizes participating members, then prefers lower-ranked explicit choices and simpler handoffs. Exhausting its search budget returns an honest error, never a partial claim of optimality.

Qloo affinity is not an acceptance probability, ownership proof, availability check, consent, or measured impact. Ranks remain within their category/query. Record evidence is artist-level. Display explanations come from verified IDs and current copies; catalog-theme interpretation is labeled separately. The agent has no approval, confirmation, reservation, messaging, inspection, or settlement tool.

## Architecture and limits

Next.js 16 App Router, React 19, TypeScript, PostgreSQL, Zod, Radix, custom CSS, the official Qloo harness, and Vercel AI SDK with direct OpenAI Responses. Fonts are local. The sample flow makes no provider request.

| Code | Responsibility |
| --- | --- |
| `src/components`, `src/domain` | Accessible UI, contracts, validation, consent windows, deterministic solver |
| `src/server/service.ts`, `membership.ts` | Transactional lifecycle and individual guest/coordinator access |
| `src/server/catalog-search.ts`, `catalog-qloo.ts` | Durable lookup and explicit identity disambiguation |
| `src/server/jobs.ts`, `agent.ts` | Fenced discovery, budgets, checkpoints, grounded tool agent |
| `src/server/qloo.ts` | Verified candidate boundary and low-level Insights transport |
| `src/server/worker.ts`, `dispatch.ts` | Persistent local processing or authenticated cloud dispatch |

Pinned `@qloo/qloo-harness` 0.1.26 uses `api search --query` for lookup and `api insights` for verified IDs, avoiding the high-level workflow's per-ID hydration calls. A fetch guard permits exactly one upstream GET on the approved endpoint, disables redirects and automatic retry fetches, and imposes a deadline. No shell is involved. Unknown IDs, duplicate entities, and wrong categories are rejected.

Provider attempts are precharged under a PostgreSQL advisory lock. A discovery permits at most 3 Qloo requests, 8 model steps, 14 tool calls, 1,000 output tokens per model step, and 120 seconds. Default UTC-day limits: **12 Qloo / 100 model requests globally**, **6 Qloo / 32 model requests per community**. Catalog lookup shares that Qloo ledger and permits one upstream attempt per explicit search. Server settings can lower/raise these bounds; requests outside this app are not covered.

Rank queries cache for six hours, with in-flight coalescing. Identical sample queries share cultural evidence; private communities have separate namespaces. No copy IDs or participant details enter the shared cache. Lookup results cache for 24 hours within their community. Publication rechecks membership, preference version, current eligibility, copy versions, and the worker's unexpired lease.

See [runtime details](docs/ARCHITECTURE.md), [deployment](deploy/gcp/README.md), and [reproducible evaluation](docs/EVALUATION.md).

## API

Responses are non-cacheable. Mutation routes require same-origin JSON, a valid scoped session, strict commands, and `Idempotency-Key`.

| Route | Purpose |
| --- | --- |
| `GET /api/workspace` | Create/load the sample or the browser's private actor scope |
| `POST /api/command` | Preferences, inventory, discovery, consent, allocation, handoff, repair |
| `GET/POST /api/membership` | Community creation, invitations, joining, revocation, browser exit |
| `GET/POST /api/catalog` | Actor-scoped lookup status, explicit search, exact confirmation |
| `GET /api/events?after=0` | Ordered event pagination, not SSE |
| `GET /api/health` | Minimal database-backed readiness and live availability |

`POST /work` belongs to the **private worker**. Cloud Run IAM authenticates Tasks/Scheduler invocation. Each request processes one saved catalog or discovery job; PostgreSQL fencing handles redelivery. Public responses never contain provider credentials or private deployment configuration.

## Verify

The 27 October 2026 release passed 81 domain/PostgreSQL tests and 13 local browser tests. Hosted verification passed two independent-session browser tests and 17 security checks. The structural evaluator checked 4,096 approval graphs against an independent oracle with zero disagreements across 8,192 comparisons. One observed hosted Games discovery used one Qloo HTTP request and four model steps; its dispatched worker task took about 15.1 seconds. These are integration and software-flow observations, not a real participant pilot or physical exchange. See the [dated verification record](docs/RELEASE-VERIFICATION.md) for scope and reproduction.

Create the dedicated test database once:

```sh
docker compose exec -T postgres createdb -U qloo relay_test
pnpm exec next typegen
pnpm typecheck
pnpm lint
pnpm test
pnpm exec tsx scripts/evaluate.ts
```

`RELAY_TEST_DATABASE_URL` must name a database ending in `_test`. With only a loopback development URL, tests derive `relay_test`. Remote servers require an explicit test URL. Tests remove provider keys and use synthetic transports. Actual PostgreSQL tests cover races, uniqueness, lease fencing, restart durability, scope, idempotency, budgets, inspection, withdrawal, and repair. Installed-CLI tests replace network access and verify actual argument parsing/request construction. Synthetic tests are not live-provider evidence.

Start the app separately, then run:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

`PLAYWRIGHT_CHANNEL=chrome` uses installed Chrome; `PLAYWRIGHT_BASE_URL` targets another local instance. Browser tests cover complete handoff, repair, reinspection, separate participant/coordinator sessions, catalog disambiguation, persistence, mobile/tablet layouts, keyboard navigation, and axe checks. Catalog fixtures are intercepted and explicitly synthetic. Automated accessibility checks do not establish complete conformance.

For a local production build, stop the dev server sharing `.next`, run `pnpm build`, then `pnpm start`. Cloud builds run in an isolated container.

## Hosting and scope

The deployable Google Cloud topology uses public Cloud Run web, a private worker, authenticated Cloud Tasks, scheduled recovery, and private-IP PostgreSQL with TLS. Provider keys are mounted only on the worker; web uses `RELAY_LIVE_DISCOVERY_ENABLED=true`. A runtime database role has application data access; a separate migration identity owns schema changes. [Deployment documentation](deploy/gcp/README.md) describes configuration and operation.

This is a bounded, invite-only event app: 30 active guest sessions per community, 20 copies per participant, seven-day access. It does not verify civil identity/physical ownership, send messages, process payments, scan photos, or independently observe a handoff. Lost browser credentials have no account-recovery flow. Custody disputes require human resolution and keep affected copies frozen. Expiry reconciles on reads/commands; operators must apply a retention policy for expired communities and provider evidence.

Live integration and independent-browser checks establish functionality, not a real participant pilot, recommendation acceptance uplift, physical exchange, environmental savings, or causal Qloo benefit. [Evaluation notes](docs/EVALUATION.md) separate exhaustive small-graph results from human outcomes still requiring study.

## Assets and license

Jackets, vinyl illustrations, the RELAY mark, and decorative diagrams are original SVG/CSS studies, not official covers. Cultural names identify works without implying endorsement. Starter descriptions and fictional biographies are authored. Qloo response data, reviewed mappings, participant records, and private traces stay outside the public repository.

Geist Variable and Fraunces Variable are locally bundled from Fontsource under their SIL Open Font License distributions. Icons are Lucide (ISC). Third-party packages retain their licenses. Application code: [MIT](LICENSE), copyright 2026 Yadnesh Salvi.
