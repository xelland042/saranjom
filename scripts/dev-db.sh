#!/usr/bin/env bash
# A development database without Docker: Postgres from this machine, data kept in your home folder
# (it survives reboots and branch switches). Docker users run `docker compose up -d` instead.
#
#   scripts/dev-db.sh start    create it the first time, start it, apply migrations
#   scripts/dev-db.sh stop
#   scripts/dev-db.sh status
#
# It listens on port 5440 (the compose database keeps 5432) and trusts local connections:
# development only. A missing .env is written to point the app at it.
set -euo pipefail

DATA="${OPEN_ERP_PGDATA:-$HOME/.local/share/open-erp-dev/pg}"
PORT="${OPEN_ERP_PGPORT:-5440}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pg() { pg_ctl -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/../postgres.log" "$@"; }

case "${1:-start}" in
  start)
    if [ ! -f "$DATA/PG_VERSION" ]; then
      mkdir -p "$DATA"
      initdb -D "$DATA" -U open_erp --auth=trust -E UTF8 >/dev/null
      pg start >/dev/null
      sleep 1
      psql -h localhost -p "$PORT" -U open_erp -d postgres -qc "CREATE DATABASE open_erp"
      psql -h localhost -p "$PORT" -U open_erp -d open_erp -qf "$ROOT/docker/postgres-init.sql"
      echo "created $DATA"
    elif ! pg status >/dev/null 2>&1; then
      pg start >/dev/null
      sleep 1
    fi
    if [ ! -f "$ROOT/.env" ]; then
      sed "s/@localhost:5432/@localhost:$PORT/" "$ROOT/.env.template" >"$ROOT/.env"
      echo "wrote .env for port $PORT"
    fi
    (cd "$ROOT/app" && poetry run alembic upgrade head >/dev/null)
    echo "database ready on localhost:$PORT (migrations applied)"
    ;;
  stop) pg stop ;;
  status) pg status ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
