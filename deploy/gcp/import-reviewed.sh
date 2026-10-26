#!/usr/bin/env bash
set -euo pipefail
# Reviewed mappings must already be uploaded privately into a temporary secret.
: "${RELAY_IMAGE:?Set RELAY_IMAGE to the release image}"
: "${RELAY_IMPORT_SECRET:?Set the temporary reviewed-mapping secret name}"
: "${RELAY_GCP_PROJECT:=relay-exchange-20261027}"
gc=./deploy/gcp/gcloud.sh
"$gc" run jobs deploy relay-mapping-import --region=us-central1 --image="$RELAY_IMAGE" \
  --service-account="relay-migrate@${RELAY_GCP_PROJECT}.iam.gserviceaccount.com" \
  --network=relay-private --subnet=relay-run --vpc-egress=private-ranges-only \
  --cpu=1 --memory=512Mi --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=120s \
  --command=node --args=--import,tsx,scripts/import-mappings.ts,/catalog-import/mappings.json \
  --set-env-vars=RELAY_DB_POOL_MAX=2 \
  --set-secrets="DATABASE_URL=relay-migration-database-url:1,/secrets/sql-ca.pem=relay-sql-ca:1,/catalog-import/mappings.json=$RELAY_IMPORT_SECRET:1" --quiet
"$gc" run jobs execute relay-mapping-import --region=us-central1 --wait --quiet
"$gc" run jobs delete relay-mapping-import --region=us-central1 --quiet
"$gc" secrets delete "$RELAY_IMPORT_SECRET" --quiet
