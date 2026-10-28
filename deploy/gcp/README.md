# RELAY on Google Cloud

Live demo: https://relay-web-nm4t32wiiq-uc.a.run.app

The demo uses a dedicated project, `relay-exchange-20261027`, in `us-central1`.
Public HTTPS terminates at Cloud Run. The web service uses Google’s documented
public-access setting (`--no-invoker-iam-check`); worker IAM checks stay enabled. A separate private Cloud Run service handles
one durable PostgreSQL discovery job per authenticated Cloud Tasks request.
Cloud Scheduler supplies recovery kicks; job leases and provider budgets live in
PostgreSQL. Worker endpoints require Cloud Run IAM authentication.

Cloud SQL PostgreSQL 17 uses a zonal `db-f1-micro`, 10 GiB SSD, encrypted
connections, private IP only, and three daily backups. Cloud Run reaches it through
Direct VPC egress on `relay-private/relay-run`; no paid VPC connector is required.
This shared CPU demo database has no high availability or Cloud SQL SLA.

The deployment default lets web scale to zero and caps it at two instances;
worker also scales to zero and is capped at one,
with one request at a time. The discovery queue also serializes delivery. Worker
requests have a 180 second deadline; database fencing makes redelivery safe.
Server-side provider limits remain authoritative even when deliveries retry.

Runtime database credentials have only application schema data access. A separate
migration identity owns schema changes and can grant new table privileges.

Secrets are stored in Secret Manager and mounted as environment variables only
on the service that needs them. The web service has no provider API keys. Do not
put `.env`, database URLs, catalog mappings, participant data, or provider results
in the image, build arguments, shell arguments, Git, or log output.

## Image

Set `RELAY_GCP_ACCOUNT` to your authorized Google Cloud account.
Run Cloud Build from the RELAY directory:

```sh
./deploy/gcp/gcloud.sh builds submit . \
  --config=deploy/gcp/cloudbuild.yaml \
  --service-account=projects/relay-exchange-20261027/serviceAccounts/relay-build@relay-exchange-20261027.iam.gserviceaccount.com \
  --substitutions=_IMAGE=us-central1-docker.pkg.dev/relay-exchange-20261027/relay/app:RELEASE
```

`gcloud.sh` always supplies an explicit account, project, and quota project. Set
`GCLOUD_BIN` to an installed gcloud executable if it is not on PATH. It never
changes the active shared gcloud configuration.

The same Node 22 image runs `pnpm start:hosted` for web or `pnpm worker:http` for
worker. The worker needs `WORKER_HOST=0.0.0.0`; Run supplies `PORT=8080`.
Run `RELAY_IMAGE=... ./deploy/gcp/migrate.sh` before `./deploy/gcp/deploy.sh`.
Migrations run as a separate private Cloud Run Job before serving new revisions.
`grant-runtime.mjs` removes the runtime role’s Cloud SQL administrative membership
and grants application data access; run it using the migration identity after
creating a fresh database.
Reviewed catalog mappings are imported through a temporary Secret Manager mount,
then removed from the job configuration and Secret Manager.

## Cost and operation

The deployment script sets both service-level and revision-level minimum instances
to zero and retains request-based CPU billing. After idle instances are removed,
the next visit or worker request can incur a cold start. On 28 October 2026, the live web service minimum was changed to zero without
changing its application revision, revision specification, or traffic assignment.
The deployment script preserves this setting for future releases.

Scale-to-zero removes the configured warm-instance baseline, not all costs.
Provisioned Cloud SQL compute, database storage, and retained backups continue
to incur charges. Active Cloud Run requests (including recovery requests),
Tasks, Scheduler, Secret Manager, builds, artifact/media storage, logs, and network traffic add
usage charges; provider API billing is separate. Actual charges depend on usage,
retention, applicable free tiers and discounts. Instance and provider limits are
not a hard spending cap. Keep maximum instances and application provider budgets bounded.

Pricing references: [Cloud SQL](https://cloud.google.com/sql/pricing),
[Cloud Run](https://cloud.google.com/run/pricing),
[authenticated Tasks delivery](https://docs.cloud.google.com/run/docs/triggering/using-tasks).

Pricing examples checked 28 October 2026, conditional on the stated sizing rather
than a verified live configuration or current bill: at 730 hours, a warm 1-vCPU,
512-MiB web instance costs about US$9.86/month at idle CPU and memory rates of
US$0.0000025 per vCPU-second and GiB-second respectively, before shared free tiers
and discounts. Minimum zero removes that warm-instance baseline, not all charges.
An Iowa non-HA `db-f1-micro` at US$0.0105/hour plus 10 GiB SSD at
US$0.000232877/GiB-hour costs about US$9.37/month for compute and disk
(`730 × 0.0105 + 10 × 730 × 0.000232877`), excluding backups, other services,
provider usage, tax and discounts. See [Cloud Run rates](https://cloud.google.com/run/pricing)
and [Cloud SQL rates](https://cloud.google.com/sql/pricing).
