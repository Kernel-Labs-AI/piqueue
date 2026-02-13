#!/bin/bash
set -euo pipefail

APP_NAME="${1:-pi-queue}"
REGION="${2:-ord}"

# Source .env if it exists
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

echo "==> Deploying $APP_NAME to Fly.io (region: $REGION)"

# Verify required env vars
for var in GIT_REPO_URL DASHBOARD_USER DASHBOARD_PASSWORD; do
  if [ -z "${!var:-}" ]; then
    echo "Error: $var is not set"
    exit 1
  fi
done

PUBLIC_ORIGIN_VALUE="${PUBLIC_ORIGIN:-https://$APP_NAME.fly.dev}"

# Create app if it doesn't exist
if ! flyctl apps list --json | grep -q "\"$APP_NAME\""; then
  echo "==> Creating app $APP_NAME"
  flyctl apps create "$APP_NAME" --org personal
fi

# Create volume if it doesn't exist
if ! flyctl volumes list -a "$APP_NAME" --json | grep -q "pi_queue_data"; then
  echo "==> Creating volume pi_queue_data"
  flyctl volumes create pi_queue_data --app "$APP_NAME" --region "$REGION" --size 10 -y
fi

# Set secrets
echo "==> Setting secrets"
flyctl secrets set \
  ${ANTHROPIC_API_KEY:+ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
  WEBHOOK_SECRET="${WEBHOOK_SECRET:-$(openssl rand -hex 32)}" \
  GIT_REPO_URL="$GIT_REPO_URL" \
  PUBLIC_ORIGIN="$PUBLIC_ORIGIN_VALUE" \
  DASHBOARD_USER="$DASHBOARD_USER" \
  DASHBOARD_PASSWORD="$DASHBOARD_PASSWORD" \
  --app "$APP_NAME" --stage

# Deploy
echo "==> Deploying"
flyctl deploy --app "$APP_NAME"

echo ""
echo "==> Deployed! Your app is at: https://$APP_NAME.fly.dev"
echo "    Dashboard: https://$APP_NAME.fly.dev/"
echo "    Webhook:   POST https://$APP_NAME.fly.dev/api/tasks"
