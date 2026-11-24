#!/usr/bin/env bash
# Backend tests against their own fresh database (open_erp_test, made again on every run): they never
# write into development data, and nothing else (the dev server, a browser) writes into theirs.
#   scripts/test.sh                            every test
#   scripts/test.sh app.tests.test_returns     one module (or class, or test)
#   COVERAGE=1 scripts/test.sh                 with the coverage report
# TEST_PG is the Postgres host:port (default the dev database's localhost:5440; CI: localhost:5432).
# PY runs Python in the project's environment (default: poetry run python).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG="${TEST_PG:-localhost:5440}"
DB=open_erp_test
PY="${PY:-poetry run python}"

psql "postgresql://open_erp:open_erp@$PG/postgres" -q \
  -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
export MAIN_CONFIG__DB__URL="postgresql+asyncpg://open_erp_app:open_erp_app@$PG/$DB"
export MAIN_CONFIG__DB__MIGRATION_URL="postgresql+asyncpg://open_erp:open_erp@$PG/$DB"
export TEST_DATABASE=1
# quiet when it works; the whole output when it doesn't
log="$(mktemp)"
(cd "$ROOT/app" && $PY -m alembic upgrade head >"$log" 2>&1 && $PY -m alembic check >>"$log" 2>&1) ||
  { cat "$log"; exit 1; }

cd "$ROOT"
if [ $# -eq 0 ]; then set -- discover -s app/tests -t .; fi
if [ -n "${COVERAGE:-}" ]; then
  $PY -m coverage run -m unittest "$@"
  $PY -m coverage report
else
  $PY -m unittest "$@"
fi
