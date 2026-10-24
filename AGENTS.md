# RELAY development instructions

This directory is an independent repository. Keep changes scoped to this product unless the user explicitly requests work elsewhere.

- Read `plans/README.md` and the relevant local planning documents when present. They are working design specifications, not evidence that functionality exists.
- The entire `plans/` directory must remain local and Git-ignored. Never force-add it or copy private strategy into public documentation. Publish the implementation documentation needed to build and use the product separately.
- Check current installed package documentation before using framework or model APIs. Pin compatible versions when implementation starts; do not assume remembered API signatures or model identifiers.
- Keep credentials server-side and out of prompts, logs, browser bundles, commits, and screenshots.
- Preserve distinctions among Qloo evidence, application interpretation, authored demonstration data, user approvals, and observed outcomes.
- Qloo affinity is not individual certainty, operational availability, consent, or a measured conversion probability.
- Implement the product's critical invariants in deterministic code and database constraints. Models may propose actions but cannot bypass those invariants.
- Build accessible, responsive interfaces with deliberate loading, empty, error, recovery, and reduced-motion states. The product's visual identity must remain distinct from its sibling projects.
- Verify the meaningful end-to-end user flow and the material failure cases before claiming a feature is complete.
- Keep the public README accurate and add reproducible setup, licensing/attribution, testing instructions, and deployment details as the application is implemented.

