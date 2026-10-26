# Release verification — 27 October 2026

Public application: [RELAY](https://relay-web-nm4t32wiiq-uc.a.run.app).

Verified container image digest: `sha256:ab21fc82a844f313a8bb6b79727d1bb37738501e342020c47e209a9994b3cbe1`. The web and private worker use this release. This record describes observed checks on that date, not a continuing availability guarantee.

## Checks and observations

| Check | Observed result | Scope |
| --- | --- | --- |
| Domain and PostgreSQL suite | 81 tests passed | Deterministic rules, transactional lifecycle, jobs, authorization, catalog and provider guards; synthetic provider transports |
| Local browser suite | 13 tests passed | Exchange, recovery, catalog, participant access, responsive UI and accessibility checks |
| Hosted participant browser suite | 2/2 passed | Fresh empty community, three independently scoped participants and a separate coordinator; exact approvals, confirmations, reservation, inspections and recorded completion |
| Hosted security probe | 17/17 passed | HTTPS cookies, one-use/revoked invitations, authority boundaries, origin checks, ownership attestation, revocation and browser exit |
| Structural evaluator | 4,096 graphs; 8,192 oracle comparisons; zero disagreements | Exhaustive four-member synthetic approval graphs, comparing pairwise and multi-person allocation |
| Hosted live Games discovery | One Qloo HTTP request; four model steps | One observed provider-backed discovery; automatically dispatched worker task duration about 15.1 seconds |
| Hosted sample UI workflow | Reached recorded completion | Fictional sample participants and goods; explicit sample controls for other-member confirmations and coordinator actions |
| Hosted infrastructure | Public page and readiness HTTP 200; unauthenticated worker HTTP 403 | Schema v7 migration, authenticated task dispatch and scheduled recovery succeeded |

The hosted participant browser flow also rejected another member's forged confirmation and a participant's attempted coordinator receipt. Its mobile community view had no horizontal overflow and zero axe violations; no browser page errors were recorded. Automated accessibility checks do not establish complete conformance.

The 17 additional hosted checks verified `Secure`, `HttpOnly`, `SameSite=Lax`, and `/` scope on session cookies; rejection of used and revoked invitations; denial of member-created coordinator invitations and foreign-copy edits; same-origin acceptance and cross-origin/cross-site rejection; mandatory ownership attestation; coordinator/participant separation; denial of private-session sample reset; revoked access returning HTTP 401; and successful browser exit after revocation. This targeted probe is not a comprehensive security audit.

The worker duration includes the dispatched task's processing; it is one observation, not a latency benchmark. A provider request and a model step are different accounting units. Broader local integration checks covered books, games and artist-level record affinity. No raw Qloo responses, reviewed identity mappings, private community identifiers, invitation codes or credentials are included here.

## Published release artifacts

The source release `11727dccb06ed0ee73534bd60821a7a4a35d2790` passed [clean GitHub CI](https://github.com/yadneshSalvi/qloo-relay/actions/runs/40394439374), including the production build, type/lint checks, all 81 domain/PostgreSQL tests, structural evaluation and all 13 browser tests. CI uses no provider credentials.

The [public demo film](https://relay-demo-641101150486.us-central1.run.app/) is 177 seconds, 1920×1080 at 30 fps, with Gemini 3.1 TTS narration, Deepgram word-timed captions and actual application captures. It uses clearly labelled fictional sample rehearsals. The MP4 SHA-256 is `d46debf070bff0b155450c81d0855a7b8013db74f2fc0f415197bc051a149950`. Final decoded frames and encoded audio checks passed; audio was measured and transcript-checked, not independently listened to. The separate static viewing service exposes only the selected film, poster and WebVTT captions; private source and raw captures are excluded.

## Reproduce

Follow the [README setup and verification instructions](../README.md#verify) with a dedicated PostgreSQL test database. Run `pnpm test`, `pnpm test:e2e`, and `pnpm exec tsx scripts/evaluate.ts`. The structural evaluator needs no database or provider credentials; [evaluation notes](EVALUATION.md) explain its independent oracle and limitations.

To repeat the hosted participant tests against an authorized deployment, run:

```sh
PLAYWRIGHT_BASE_URL=https://relay-web-nm4t32wiiq-uc.a.run.app pnpm exec playwright test tests/e2e/participants.spec.ts --output=/absolute/private/path/relay-participants
```

These tests create a fresh private community and synthetic participant records on the target deployment. Invitation entry traces are disabled in the test. Keep screenshots and other participant evidence outside public Git. They do not call Qloo or OpenAI. Live discovery requires configured worker credentials, reviewed/participant-confirmed cultural identities and available provider budget; repeating it may consume provider quota.

## What remains unestablished

Independent browser sessions establish scoped software authority, not independent human judgments. Ownership, inspection and release are attestations. Neither the hosted UI rehearsal nor the private automated exchange observed real goods changing hands. No real human pilot, measured recommendation acceptance, causal Qloo benefit, environmental saving or production-scale reliability is claimed.
