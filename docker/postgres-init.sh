#!/bin/sh
# Runs once, when the production database is first created (docker-compose.prod.yml).
# The app connects as this role: it owns no tables, so row-level security applies to it.
# Migrations (as the owner) grant it what it needs.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v pw="$APP_PASSWORD" <<'SQL'
CREATE ROLE open_erp_app LOGIN PASSWORD :'pw';
SQL
