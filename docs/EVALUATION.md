# What the evidence establishes

RELAY separates provider integration, exchange correctness, and observed human outcomes. A successful Qloo request establishes the first. Synthetic graph comparisons establish properties of the second. Neither establishes real-world recommendation acceptance or physical exchange.

## Reproduce the structural comparison

```sh
pnpm install --frozen-lockfile
pnpm exec tsx scripts/evaluate.ts
```

No database, credentials, network, or private planning files are needed. The script enumerates all **4,096 directed approval graphs on four members**, with one available copy per member and equal preference ranks. It runs both pairwise-only and two-to-five-member allocation on the **same exact approvals**. A separate permutation-and-bitset oracle checks each result. Failed agreement causes a nonzero exit.

Verified on 27 October 2026:

| Structural result | Graph count |
| --- | ---: |
| More members allocated with multi-person exchange | 1,874 |
| Same number allocated | 2,222 |
| Fewer members allocated | 0 |
| Oracle disagreements across 8,192 allocation comparisons | 0 |

This is exhaustive **small-graph coverage**, not a population study. Real approval graphs are not uniformly distributed; these counts must not be described as expected conversion lift, Qloo lift, or a forecast of community participation. The test does not establish large-community scale. Separate tests cover five-member rings, invalid/stale consent, repeated owners, deterministic search limits, database races, and reservations.

The included three-member illustration makes the mechanism explicit:

| Exact approvals | Pairwise allocation | Multi-person allocation |
| --- | ---: | ---: |
| B wants A's copy; C wants B's copy | 0 members | 0 members |
| A also approves giving A's copy for C's copy | 0 members | 3 members |
| A revokes that new approval | 0 members | 0 members |

The added approval is **authored**, not a model-created action or an observed human preference. Qloo may help a person discover C's copy; that person still has to approve the exact give/get terms. Only then may the solver use that edge. A feasible allocation also requires separate participant confirmations and coordinator inspection before a recorded handoff.

## Live integration evidence

The integration validates cultural IDs, output category, membership in the requested candidate set, current item versions, and preference version. Record recommendations concern the artist, not the particular album or pressing. Provider scores stay within each category and query; they are not individual acceptance probabilities.

The running application's evidence view records source, query scope, eligible copies, category ranking, timestamp, cache origin, and the agent's restricted authority. Its usage ledger counts reserved provider attempts, including uncertain outcomes; reported model tokens are distinguished from requests with unreported usage. Private caches and provider responses are deliberately excluded from this public repository.

Automated provider tests use synthetic responses. A live run must be assessed from the actual deployment's dated evidence, not inferred from tests, installed dependencies, or this document.

## Human evaluation still required

No measured recommendation acceptance, real participant pilot, physical handoff, environmental saving, or causal Qloo benefit is claimed. The sample community's people, copies, and starting approvals are authored. Independent browser sessions verify authorization and workflow behavior, not independent human judgments.

A future pilot should compare Qloo-assisted discovery with a capable metadata/model baseline using the same voluntary favorites, offered copies, presentation, and exposure budget. Measure exact new approvals separately from saves or interest; compare pairwise and multi-person allocation on the same resulting graph. Record withdrawals, mapping failures, and rejected suggestions. Cluster assignment and analysis by community/session to account for network effects, and document actual handoff outcomes separately. Publish counts, denominators, the protocol, and uncertainty rather than using Qloo's own scores as ground truth.
