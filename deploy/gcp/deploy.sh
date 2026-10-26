#!/usr/bin/env bash
set -euo pipefail
# Run from the RELAY directory after provisioning the documented foundation.
: "${RELAY_IMAGE:?Set RELAY_IMAGE to an immutable image digest or release tag}"
: "${RELAY_GCP_PROJECT:=relay-exchange-20261027}"
: "${RELAY_REGION:=us-central1}"
gc=./deploy/gcp/gcloud.sh
worker_sa="relay-worker@${RELAY_GCP_PROJECT}.iam.gserviceaccount.com"
web_sa="relay-web@${RELAY_GCP_PROJECT}.iam.gserviceaccount.com"
invoker_sa="relay-invoker@${RELAY_GCP_PROJECT}.iam.gserviceaccount.com"
common=(--image="$RELAY_IMAGE" --region="$RELAY_REGION" --network=relay-private --subnet=relay-run --vpc-egress=private-ranges-only --cpu=1 --cpu-throttling --execution-environment=gen2 --min-instances=0 --quiet)
"$gc" run deploy relay-worker "${common[@]}" \
  --service-account="$worker_sa" --memory=1Gi --max=1 --max-instances=1 --concurrency=1 \
  --timeout=180 --invoker-iam-check --no-allow-unauthenticated --command=node --args=--import,tsx,scripts/worker-http.ts \
  --set-env-vars=WORKER_HOST=0.0.0.0,RELAY_DB_POOL_MAX=2,OPENAI_MODEL=gpt-6.1-sol,QLOO_BASE_URL=https://hackathon.api.qloo.com,QLOO_TRUSTED_BASE_URL=https://hackathon.api.qloo.com,RELAY_QLOO_DAILY_LIMIT=12,RELAY_QLOO_SESSION_DAILY_LIMIT=6,RELAY_MODEL_DAILY_LIMIT=100,RELAY_MODEL_SESSION_DAILY_LIMIT=32 \
  --set-secrets=DATABASE_URL=relay-database-url:2,/secrets/sql-ca.pem=relay-sql-ca:1,QLOO_API_KEY=relay-qloo-api-key:1,OPENAI_API_KEY=relay-openai-api-key:1
"$gc" run services add-iam-policy-binding relay-worker --region="$RELAY_REGION" \
  --member="serviceAccount:$invoker_sa" --role=roles/run.invoker --quiet
worker_url=$("$gc" run services describe relay-worker --region="$RELAY_REGION" --format='value(status.url)')
"$gc" run deploy relay-web "${common[@]}" \
  --service-account="$web_sa" --memory=512Mi --min=1 --max=2 --max-instances=2 --concurrency=20 \
  --timeout=60 --no-invoker-iam-check \
  --set-secrets=DATABASE_URL=relay-database-url:2,/secrets/sql-ca.pem=relay-sql-ca:1 \
  --set-env-vars="RELAY_DB_POOL_MAX=4,RELAY_LIVE_DISCOVERY_ENABLED=true,GOOGLE_CLOUD_PROJECT=$RELAY_GCP_PROJECT,RELAY_TASKS_LOCATION=$RELAY_REGION,RELAY_TASKS_QUEUE=relay-discovery,RELAY_WORKER_URL=$worker_url,RELAY_TASKS_INVOKER_SERVICE_ACCOUNT=$invoker_sa"
web_url=$("$gc" run services describe relay-web --region="$RELAY_REGION" --format='value(status.url)')
"$gc" run services update relay-web --region="$RELAY_REGION" --update-env-vars="APP_ORIGIN=$web_url" --quiet
printf '%s\n' "$web_url"
