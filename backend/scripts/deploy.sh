#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/../scripts/network-env.sh"

if [ ! -f ".env" ]; then
  GENERATED_SYNC_TOKEN="$(generate_random_secret)"
  cat > ".env" <<EOF
PORT=4000
POSTGRES_DB=worldscheckin
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_PORT=5432
DATABASE_URL=postgresql://postgres:postgres@db:5432/worldscheckin
CORS_ALLOWED_ORIGINS=http://localhost:5173
ROBOTEVENTS_API_KEY=
ROBOTEVENTS_SYNC_TOKEN=${GENERATED_SYNC_TOKEN}
EOF
  echo "Created backend/.env with generated local secrets"
fi

set -a
. ".env"
set +a

if [ -z "${ROBOTEVENTS_SYNC_TOKEN:-}" ]; then
  ROBOTEVENTS_SYNC_TOKEN="$(generate_random_secret)"
  upsert_env_var ".env" "ROBOTEVENTS_SYNC_TOKEN" "$ROBOTEVENTS_SYNC_TOKEN"
  export ROBOTEVENTS_SYNC_TOKEN
  echo "Generated missing ROBOTEVENTS_SYNC_TOKEN"
fi

set_userscript_config_value \
  "$ROOT_DIR/../scripts/tampermonkey-checkin-sync.user.js" \
  "syncToken" \
  "$ROBOTEVENTS_SYNC_TOKEN"
echo "Updated Tampermonkey template syncToken"

CURRENT_FRONTEND_PORT="8080"
if [ -f "$ROOT_DIR/../frontend/.env" ]; then
  CURRENT_FRONTEND_PORT="$(
    awk -F= '/^FRONTEND_PORT=/{print $2}' "$ROOT_DIR/../frontend/.env" | tail -n 1
  )"
  CURRENT_FRONTEND_PORT="${CURRENT_FRONTEND_PORT:-8080}"
fi

echo "Configure CORS_ALLOWED_ORIGINS"
SELECTED_CORS_IPS="$(choose_multiple_ips "Available interfaces for frontend origins:")"

declare -a cors_origins=(
  "http://localhost:5173"
)

if [ -n "${SELECTED_CORS_IPS:-}" ]; then
  while IFS= read -r ip; do
    [ -n "$ip" ] || continue
    cors_origins+=("http://${ip}:${CURRENT_FRONTEND_PORT}")
  done <<< "$SELECTED_CORS_IPS"
fi

declare -a unique_cors_origins=()
for origin in "${cors_origins[@]}"; do
  skip_origin=false
  for existing_origin in "${unique_cors_origins[@]}"; do
    if [ "$existing_origin" = "$origin" ]; then
      skip_origin=true
      break
    fi
  done

  if [ "$skip_origin" = false ]; then
    unique_cors_origins+=("$origin")
  fi
done

CORS_ALLOWED_ORIGINS=""
for origin in "${unique_cors_origins[@]}"; do
  if [ -n "$CORS_ALLOWED_ORIGINS" ]; then
    CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS},${origin}"
  else
    CORS_ALLOWED_ORIGINS="$origin"
  fi
done

upsert_env_var ".env" "CORS_ALLOWED_ORIGINS" "$CORS_ALLOWED_ORIGINS"
export CORS_ALLOWED_ORIGINS
echo "Using CORS_ALLOWED_ORIGINS=$CORS_ALLOWED_ORIGINS"

if [ -z "${ROBOTEVENTS_API_KEY:-}" ]; then
  echo "ROBOTEVENTS_API_KEY is empty in backend/.env. Event imports will not work until you set a real key."
fi

if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD=(docker-compose)
else
  echo "Docker Compose is not available. Install Docker Desktop or docker-compose."
  exit 1
fi

echo "Installing backend dependencies on the host..."
npm ci --omit=dev

if [ ! -f "node_modules/pg/package.json" ]; then
  echo "Dependency install failed: node_modules/pg/package.json was not created"
  exit 1
fi

echo "Starting PostgreSQL..."
"${DOCKER_COMPOSE_CMD[@]}" up -d db

echo "Waiting for PostgreSQL to become healthy..."
DB_CONTAINER_ID="$("${DOCKER_COMPOSE_CMD[@]}" ps -q db)"
if [ -z "$DB_CONTAINER_ID" ]; then
  echo "PostgreSQL container failed to start"
  exit 1
fi

until [ "$(docker inspect -f '{{.State.Health.Status}}' "$DB_CONTAINER_ID")" = "healthy" ]; do
  sleep 2
done

echo "Building backend image..."
"${DOCKER_COMPOSE_CMD[@]}" build app

echo "Running migrations..."
"${DOCKER_COMPOSE_CMD[@]}" run --rm app npm run migrate

echo "Starting backend app..."
"${DOCKER_COMPOSE_CMD[@]}" up -d app

echo "Deployment complete"
echo "Backend: http://localhost:${PORT:-4000}"
echo "Tampermonkey script: $ROOT_DIR/../scripts/tampermonkey-checkin-sync.user.js"
echo "To install: open Tampermonkey, create a new script, and paste in that file's contents."
