#!/usr/bin/env bash
# End-to-end tests against a fresh database (open_erp_e2e, made again on every run), so they never
# touch development data. Playwright starts the API on 8011 and the app on 5174.
#   scripts/e2e.sh                  every test
#   scripts/e2e.sh e2e/returns.spec.ts --headed
# E2E_PG is the Postgres host:port (default the dev database's localhost:5440; CI: localhost:5432).
# PY runs Python in the project's environment (default: poetry run python).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG="${E2E_PG:-localhost:5440}"
DB=open_erp_e2e
PY="${PY:-poetry run python}"

psql "postgresql://open_erp:open_erp@$PG/postgres" -q \
  -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
export MAIN_CONFIG__DB__URL="postgresql+asyncpg://open_erp_app:open_erp_app@$PG/$DB"
export MAIN_CONFIG__DB__MIGRATION_URL="postgresql+asyncpg://open_erp:open_erp@$PG/$DB"
# quiet when it works; the whole output when it doesn't
log="$(mktemp)"
(cd "$ROOT/app" && $PY -m alembic upgrade head >"$log" 2>&1) || { cat "$log"; exit 1; }

export E2E_API_COMMAND="$PY -m uvicorn app.main:main_app --port 8011"
cd "$ROOT/frontend"
exec npx playwright test "$@"
