#!/usr/bin/env bash
set -euo pipefail
# Invoke after release review checks the final media and publication is authorized.
: "${RELAY_MEDIA_BUILD_DIR:?Set RELAY_MEDIA_BUILD_DIR to the exact prepared build directory}"
: "${RELAY_MEDIA_IMAGE:?Set RELAY_MEDIA_IMAGE to a unique Artifact Registry release tag}"
: "${RELAY_GCP_PROJECT:=relay-exchange-20261027}"
: "${RELAY_REGION:=us-central1}"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
gc="$script_dir/../gcloud.sh"
"$gc" builds submit "$RELAY_MEDIA_BUILD_DIR" --config="$script_dir/cloudbuild.yaml" \
  --service-account="projects/$RELAY_GCP_PROJECT/serviceAccounts/relay-build@$RELAY_GCP_PROJECT.iam.gserviceaccount.com" \
  --substitutions="_IMAGE=$RELAY_MEDIA_IMAGE" --quiet
"$gc" run deploy relay-demo --region="$RELAY_REGION" --image="$RELAY_MEDIA_IMAGE" \
  --service-account="relay-media@$RELAY_GCP_PROJECT.iam.gserviceaccount.com" \
  --port=8080 --cpu=1 --memory=512Mi --cpu-throttling --execution-environment=gen2 \
  --min=0 --min-instances=0 --max=1 --max-instances=1 --concurrency=40 --timeout=300 \
  --no-invoker-iam-check --quiet
"$gc" run services describe relay-demo --region="$RELAY_REGION" --format='value(status.url)'
