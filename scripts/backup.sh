#!/usr/bin/env bash
# On the server, every night (cron, from server-setup.sh): a dump of the database into
# /var/backups/open-erp, 14 days kept. To restore one (it replaces what's in the database):
#   docker compose -f docker-compose.prod.yml exec -T db \
#       pg_restore -U open_erp -d open_erp --clean --if-exists < /var/backups/open-erp/<day>.dump
# shortcut: the dumps sit on the same server and a failed night only shows in
# /var/log/open-erp-backup.log; copy them off the server and alert on failure before a real
# firm's data lives here
set -euo pipefail
cd "$(dirname "$0")/.."
out=/var/backups/open-erp
file=$out/$(date +%F).dump

# to a .part first: a dump that fails halfway never looks like a good one
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U open_erp -Fc open_erp > "$file.part"
mv "$file.part" "$file"
find "$out" -name '*.dump' -mtime +14 -delete
echo "$(date -Is) $file $(du -h "$file" | cut -f1)"
