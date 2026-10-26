#!/usr/bin/env bash
set -euo pipefail
: "${GCLOUD_BIN:=gcloud}"
: "${RELAY_GCP_PROJECT:=relay-exchange-20261027}"
: "${RELAY_GCP_ACCOUNT:?Set RELAY_GCP_ACCOUNT to the authorized Google Cloud account}"
exec "$GCLOUD_BIN" --account="$RELAY_GCP_ACCOUNT" --project="$RELAY_GCP_PROJECT" --billing-project="$RELAY_GCP_PROJECT" "$@"
