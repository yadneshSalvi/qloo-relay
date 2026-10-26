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

Web keeps one minimum instance for responsive demo visits and is capped at two;
worker scales to zero and is capped at one,
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

Baseline infrastructure is the small database/storage and one warm web instance
(roughly $20–25/month in Iowa including light backup/registry use); active Run
processing, Tasks, builds, logs, and internet traffic add
usage charges. This is an estimate, not a hard spending cap. Provider API billing
is separate. Keep maximum instances and application provider budgets bounded.

Pricing references: [Cloud SQL](https://cloud.google.com/sql/pricing),
[Cloud Run](https://cloud.google.com/run/pricing),
[authenticated Tasks delivery](https://docs.cloud.google.com/run/docs/triggering/using-tasks).
