#!/usr/bin/env bash
# Prepares a fresh Debian or Ubuntu server for open-erp. Once, as root (safe to run again):
#   ssh open-erp 'bash -s -- erp.example.uz' < scripts/server-setup.sh
# An optional second argument lists the names that redirect to it ("example.uz, www.example.uz").
# Then scripts/deploy.sh sends the code and starts it.
set -euo pipefail
site=${1:?the name the app will live at, e.g. erp.example.uz}
redirects=${2:-}
dir=/opt/open-erp

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq docker.io docker-compose rsync ufw unattended-upgrades openssl
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' \
    > /etc/apt/apt.conf.d/20auto-upgrades

# 1 GB of swap: building the image next to a running Postgres can pass a small server's memory
if [ -z "$(swapon --show)" ]; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile > /dev/null
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# from outside: SSH and the web only (SSH first, or enabling the firewall would lock us out)
ufw allow 22/tcp > /dev/null
ufw allow 80,443/tcp > /dev/null
ufw allow 443/udp > /dev/null
ufw --force enable > /dev/null

mkdir -p "$dir" /var/backups/open-erp
chmod 700 /var/backups/open-erp
# the secrets are made here and stay here: never in the repo. Hex, so they fit in a database URL
if [ ! -f "$dir/.env" ]; then
    (
        umask 077
        cat > "$dir/.env" << EOF
SITE_ADDRESS=$site
REDIRECT_ADDRESSES=$redirects
DB_OWNER_PASSWORD=$(openssl rand -hex 24)
DB_APP_PASSWORD=$(openssl rand -hex 24)
DEMO_PASSWORD=$(openssl rand -hex 8)
EOF
    )
fi

echo "15 3 * * * root $dir/scripts/backup.sh >> /var/log/open-erp-backup.log 2>&1" \
    > /etc/cron.d/open-erp-backup
echo "Ready: $dir/.env written for $site. Now run scripts/deploy.sh from your own machine."
