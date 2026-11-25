#!/usr/bin/env bash
# Sends the committed code (HEAD) to the server and starts it: scripts/deploy.sh [ssh host]
# (default: open-erp, an entry in ~/.ssh/config). The server was prepared once by
# scripts/server-setup.sh. The frontend is built here: its build doesn't fit in a 1 GB server.
set -euo pipefail
cd "$(dirname "$0")/.."
host=${1:-open-erp}
dir=/opt/open-erp

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# what's committed, nothing else: no .env, no half-done edits
git archive HEAD | tar -x -C "$tmp"
(cd "$tmp/frontend" && npm ci --silent && npm run build)

# owned by root there: rsync would otherwise keep this machine's user number, and whoever got
# that number on the server later would own scripts that root runs every night
rsync -az --delete --chown=root:root "$tmp/frontend/dist/" "$host:$dir/site/"
# the server's own .env and the site just sent are excluded, so --delete leaves them alone
rsync -az --delete --chown=root:root --exclude /.env --exclude /site --exclude /frontend --exclude /docs \
    --exclude /.github "$tmp/" "$host:$dir/"
# migrations run first (the migrate service), then the API restarts on the new code. Caddy is
# restarted because a running container keeps reading the Caddyfile it started with
ssh "$host" "cd $dir && docker compose -f docker-compose.prod.yml up -d --build --remove-orphans \
    && docker compose -f docker-compose.prod.yml restart caddy \
    && docker image prune -f > /dev/null"

site=$(ssh "$host" "sed -n 's/^SITE_ADDRESS=//p' $dir/.env")
code=none
for _ in $(seq 30); do
    # nobody is logged in, so a working API answers 401
    code=$(curl -s -o /dev/null -w '%{http_code}' "https://$site/api/v1/auth/me" || true)
    [ "$code" = 401 ] && break
    sleep 2
done
if [ "$code" != 401 ]; then
    echo "The API doesn't answer at https://$site (got $code). On the server:" >&2
    echo "  cd $dir && docker compose -f docker-compose.prod.yml logs --tail 50" >&2
    exit 1
fi
curl -fsS -o /dev/null "https://$site/"
echo "Deployed $(git rev-parse --short HEAD) to https://$site"
