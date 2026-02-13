#!/bin/bash
set -e

# Persist pi credentials on the volume (pi hardcodes /root/.pi)
mkdir -p /data/.pi
ln -sfn /data/.pi /root/.pi

if [ -n "$GIT_REPO_URL" ] && [ ! -d "/data/repo/.git" ]; then
  REDACTED_URL="$(printf '%s' "$GIT_REPO_URL" | sed -E 's#(https?://)[^/@]+@#\1***@#')"
  echo "Cloning repo from $REDACTED_URL..."
  git clone "$GIT_REPO_URL" /data/repo
fi

exec node dist/index.js
