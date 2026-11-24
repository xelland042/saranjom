#!/usr/bin/env bash
# Retakes the README's screenshots (.github/screenshots): the built app in a browser, logged in
# to a freshly seeded demo company, so they show the app as it is today. Needs the dev Postgres
# running (scripts/dev-db.sh start); makes its own database next to it, like the tests do.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG="${E2E_PG:-localhost:5440}"
DB=open_erp_shots
PY="${PY:-poetry run python}"
API=8013
APP=5176

psql "postgresql://open_erp:open_erp@$PG/postgres" -q \
  -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
export MAIN_CONFIG__DB__URL="postgresql+asyncpg://open_erp_app:open_erp_app@$PG/$DB"
export MAIN_CONFIG__DB__MIGRATION_URL="postgresql+asyncpg://open_erp:open_erp@$PG/$DB"
log="$(mktemp)"
(cd "$ROOT/app" && $PY -m alembic upgrade head > "$log" 2>&1) || { cat "$log"; exit 1; }
(cd "$ROOT" && $PY -m app.scripts.seed_demo > "$log" 2>&1) || { cat "$log"; exit 1; }

trap 'kill $(jobs -p) 2> /dev/null' EXIT
(cd "$ROOT" && exec $PY -m uvicorn app.main:main_app --port $API > /dev/null 2>&1) &
cd "$ROOT/frontend"
npx vite build > "$log" 2>&1 || { cat "$log"; exit 1; }
# vite itself, not through npx: the process to stop afterwards is then the one we started
OPEN_ERP_API="http://localhost:$API" node node_modules/vite/bin/vite.js preview \
  --port $APP --strictPort > /dev/null 2>&1 &
code=none
for _ in $(seq 60); do
  # through the app's own address, so both servers are up; nobody is logged in, hence 401
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$APP/api/v1/auth/me" || true)
  [ "$code" = 401 ] && break
  sleep 1
done
[ "$code" = 401 ] || { echo "The app didn't start (got $code)" >&2; exit 1; }

mkdir -p "$ROOT/.github/screenshots"
node e2e/screenshots.mjs "http://localhost:$APP" "$ROOT/.github/screenshots"
