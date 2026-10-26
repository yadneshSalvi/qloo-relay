#!/usr/bin/env bash
set -euo pipefail
# Run from RELAY. This runs deterministic schema changes without provider calls.
: "${RELAY_IMAGE:?Set RELAY_IMAGE to the release image}"
: "${RELAY_GCP_PROJECT:=relay-exchange-20261027}"
gc=./deploy/gcp/gcloud.sh
"$gc" run jobs deploy relay-migrate --region=us-central1 --image="$RELAY_IMAGE" \
  --service-account="relay-migrate@${RELAY_GCP_PROJECT}.iam.gserviceaccount.com" \
  --network=relay-private --subnet=relay-run --vpc-egress=private-ranges-only \
  --cpu=1 --memory=512Mi --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=120s \
  --command=node --args=--import,tsx,scripts/migrate.ts \
  --set-env-vars=RELAY_DB_POOL_MAX=2 \
  --set-secrets=DATABASE_URL=relay-migration-database-url:1,/secrets/sql-ca.pem=relay-sql-ca:1 --quiet
"$gc" run jobs execute relay-migrate --region=us-central1 --wait --quiet
