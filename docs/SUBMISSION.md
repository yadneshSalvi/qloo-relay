# RELAY — Good things come around

**Your next favorite is already on someone's shelf.**

[Try the deployed app](https://relay-web-nm4t32wiiq-uc.a.run.app) · [Dated release verification](RELEASE-VERIFICATION.md)

## What it does

A direct swap asks for a coincidence: I must want your thing, and you must want mine. RELAY helps a small community discover new wants, then connects exact, explicitly approved trades into circles of two to five people.

Members offer books, records, and physical games, describe the actual copies, and choose cultural favorites. A bounded discovery agent consults Qloo within available community inventory, checks possible exchange paths, and presents specific give/get choices. The person decides whether to approve. Every member then confirms the complete proposal; a coordinator inspects the whole set before recording its release.

When someone withdraws, the old arrangement closes. RELAY can find a different valid circle, but the new proposal starts with fresh confirmations. It does not treat an old yes as permission for new terms.

## Where Qloo makes the difference

The difficult part is often discovering an object you had not thought to ask for. Qloo supplies cultural affinity across selected references and a fixed candidate set. RELAY turns that evidence into a question a person can answer: “Would you give this exact copy for that one?”

Catalog search supports books, games, and artists outside the starter collection. The participant confirms the returned identity before using it. Physical record titles and pressings remain separate from artist-level affinity. Category ranks are never treated as comparable probabilities across books, games, and music.

The source view preserves the chain from confirmed cultural identities to Qloo rankings, candidate copies, a person's exact approval, a computed proposal, and recorded handoff actions. Authored sample data, cached evidence, live provider requests, and participant attestations have distinct labels.

## How we built it

RELAY uses Next.js, React, TypeScript, PostgreSQL, the official Qloo harness, and an OpenAI Responses tool-loop agent through the Vercel AI SDK. The agent can inspect inventory, choose category searches, and inspect hypothetical exchange paths. It has no tools to approve, confirm, reserve, or release goods.

PostgreSQL holds jobs, leases, checkpoints, provider budgets, private caches, exact item versions, and an event trail. Paid requests reserve budget before execution. Already verified IDs use the official Insights command with one guarded HTTP request. Current inventory and preferences are checked again before results are published. Deterministic transaction rules protect consent and reservations even when model output is invalid or a worker restarts.

The interface uses an original illustrated shelf, editorial typography, a readable exchange circle, and a list alternative. Private invited communities give members separate sessions and give coordinators a separate handoff role.

## What we can demonstrate

We verified live catalog lookup, all three ranking categories, an adaptive OpenAI discovery run, exact approval, all-party reservation, individual inspection, recorded sample completion, and withdrawal followed by a fresh repair. On the hosted release, one observed Games discovery used one Qloo HTTP request and four model steps; its automatically dispatched worker task took about 15.1 seconds. The actual hosted UI workflow reached recorded completion with fictional sample characters and goods.

Verification passed 81 domain/PostgreSQL tests, 13 local browser tests, two hosted browser tests using separate participant/coordinator sessions, and 17 hosted security checks. These checks establish software behavior and integration; no real human pilot or physical handoff has been observed. The [release record](RELEASE-VERIFICATION.md) identifies the tested image and limits.

The public [structural evaluation](EVALUATION.md) exhaustively compares pairwise and multi-person matching on all 4,096 four-member approval graphs. Both solvers agree with an independent reference calculation across 8,192 comparisons. This validates small-graph mechanics; it does not measure Qloo lift or human acceptance.

The next evidence to collect is real participants' independently expressed willingness and observed physical handoffs. We claim no measured environmental savings, pilot conversion, or causal recommendation improvement.

## Try the story

Open [RELAY](https://relay-web-nm4t32wiiq-uc.a.run.app) in a fresh browser session to begin an authored sample. Choose a few favorites, or explicitly search and confirm an outside title. On Discover, select a category and request live Qloo discovery. Review a returned copy and its evidence, then approve an exact give/get pair. If it closes a circle, confirm each fictional member through the visibly labeled sample controls. Inspect every copy at the sample desk before recording completion.

For a deterministic recovery rehearsal, the authored Hades / The Creative Act approval can create a three-person circle. Withdraw Maya before receipt, then choose **Find another way**. The alternative is a new proposal with zero confirmations. Browsing an authored copy is distinct from receiving it as a live Qloo suggestion; the interface shows the actual source.

The public repository contains setup, verification, deployment instructions, and the MIT license. No private planning files, provider keys, participant records, or Qloo response dumps are required or published.
