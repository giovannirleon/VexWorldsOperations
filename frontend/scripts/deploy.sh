#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/../scripts/network-env.sh"

if [ ! -f ".env" ]; then
  cat > ".env" <<EOF
FRONTEND_PORT=8080
VITE_API_BASE_URL=
EOF
  echo "Created frontend/.env with deploy defaults"
fi

set -a
. ".env"
set +a

CURRENT_API_BASE_URL="${VITE_API_BASE_URL:-}"
CURRENT_BACKEND_PORT="4000"

if [ -f "$ROOT_DIR/../backend/.env" ]; then
  CURRENT_BACKEND_PORT="$(
    awk -F= '/^PORT=/{print $2}' "$ROOT_DIR/../backend/.env" | tail -n 1
  )"
  CURRENT_BACKEND_PORT="${CURRENT_BACKEND_PORT:-4000}"
fi

CURRENT_API_IP="${CURRENT_API_BASE_URL#http://}"
CURRENT_API_IP="${CURRENT_API_IP#https://}"
CURRENT_API_IP="${CURRENT_API_IP%%:*}"

echo "Configure VITE_API_BASE_URL"
SELECTED_API_IP="$(
  choose_single_ip \
    "Available interfaces for the backend API base URL:" \
    "$CURRENT_API_IP"
)"

if [ -n "$SELECTED_API_IP" ]; then
  VITE_API_BASE_URL="http://${SELECTED_API_IP}:${CURRENT_BACKEND_PORT}"
  upsert_env_var ".env" "VITE_API_BASE_URL" "$VITE_API_BASE_URL"
  export VITE_API_BASE_URL
  echo "Using VITE_API_BASE_URL=$VITE_API_BASE_URL"

  set_userscript_config_value \
    "$ROOT_DIR/../scripts/tampermonkey-checkin-sync.user.js" \
    "backendBaseUrl" \
    "$VITE_API_BASE_URL"
  echo "Updated Tampermonkey template backendBaseUrl"
fi

if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD=(docker-compose)
else
  echo "Docker Compose is not available. Install Docker Desktop or docker-compose."
  exit 1
fi

echo "Installing frontend dependencies on the host..."
npm ci

if [ ! -f "node_modules/vite/package.json" ]; then
  echo "Dependency install failed: node_modules/vite/package.json was not created"
  exit 1
fi

echo "Building frontend assets on the host..."
npm run build

echo "Building frontend image..."
"${DOCKER_COMPOSE_CMD[@]}" build web

echo "Starting Nginx frontend..."
"${DOCKER_COMPOSE_CMD[@]}" up -d web

echo "Deployment complete"
echo "Frontend: http://localhost:${FRONTEND_PORT:-8080}"
echo "Tampermonkey script: $ROOT_DIR/../scripts/tampermonkey-checkin-sync.user.js"
echo "To install: open Tampermonkey, create a new script, and paste in that file's contents."
