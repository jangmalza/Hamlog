#!/usr/bin/env bash

# Installs the pull-based deployment agent on the production server.
#
#   sudo bash scripts/install-server-agent.sh [deploy-user]
#
# - Copies the deploy/backup scripts to /opt/hamlog/bin (root-owned, so the
#   deploy user cannot change what the timers run).
# - Creates /etc/hamlog/deploy.env and /etc/hamlog/hamlog.env if missing. The
#   application file is seeded from the running `hamlog` container so the
#   current secrets carry over unchanged.
# - Installs and starts hamlog-deploy.timer (every 2 minutes) and
#   hamlog-backup.timer (daily 03:17 Asia/Seoul).
#
# Re-running it updates the scripts and units and keeps existing env files.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash scripts/install-server-agent.sh [deploy-user]" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_USER="${1:-${SUDO_USER:-}}"
INSTALL_DIR="${HAMLOG_INSTALL_DIR:-/opt/hamlog/bin}"
CONFIG_DIR="${HAMLOG_CONFIG_DIR:-/etc/hamlog}"
SYSTEMD_DIR="${HAMLOG_SYSTEMD_DIR:-/etc/systemd/system}"
CONTAINER_NAME="${HAMLOG_CONTAINER_NAME:-hamlog}"

if [ -z "$DEPLOY_USER" ] || [ "$DEPLOY_USER" = root ] || ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "Pass the non-root user that owns ~/hamlog-data and can run docker." >&2
  exit 1
fi

DEPLOY_GROUP="$(id -gn "$DEPLOY_USER")"
DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"

if ! id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qx docker; then
  echo "$DEPLOY_USER must be in the docker group." >&2
  exit 1
fi

for tool in docker flock curl systemctl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Required command not found: $tool" >&2
    exit 1
  fi
done

install -d -o root -g root -m 755 "$INSTALL_DIR"
install -o root -g root -m 755 "$SOURCE_DIR/server-deploy.sh" "$INSTALL_DIR/server-deploy.sh"
install -o root -g root -m 755 "$SOURCE_DIR/backup-data.sh" "$INSTALL_DIR/backup-data.sh"
install -o root -g root -m 644 "$SOURCE_DIR/verify-data.js" "$INSTALL_DIR/verify-data.js"

# Secrets are readable by the deploy user (docker --env-file) but not writable.
install -d -o root -g "$DEPLOY_GROUP" -m 750 "$CONFIG_DIR"

if [ ! -f "$CONFIG_DIR/deploy.env" ]; then
  install -o root -g "$DEPLOY_GROUP" -m 640 /dev/null "$CONFIG_DIR/deploy.env"
  cat > "$CONFIG_DIR/deploy.env" <<'EOF'
# HamLog deployment agent settings (sourced by server-deploy.sh).
HAMLOG_IMAGE=ghcr.io/jangmalza/hamlog:latest
HAMLOG_PUBLIC_URL=https://tech.hamwoo.co.kr
HAMLOG_BIND_ADDRESS=127.0.0.1
BACKUP_RETENTION_DAYS=30
# Absolute path of an off-site backup hook (see README "Backup and Restore").
HAMLOG_BACKUP_HOOK=
# Optional Telegram notifications for deployments and failed backups.
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EOF
  echo "Created $CONFIG_DIR/deploy.env"
fi

APP_ENV_KEYS='JWT_SECRET ADMIN_PASSWORD AUTH_MODE CLOUDFLARE_ACCESS_TEAM_DOMAIN CLOUDFLARE_ACCESS_AUD ANALYTICS_SECRET ANALYTICS_TIME_ZONE CORS_ORIGINS COOKIE_SAME_SITE COOKIE_SECURE TRUST_PROXY SITE_URL GOOGLE_SITE_VERIFICATION NAVER_SITE_VERIFICATION DAUM_SITE_VERIFICATION DAUM_WEBMASTER_PIN'

if [ ! -f "$CONFIG_DIR/hamlog.env" ]; then
  install -o root -g "$DEPLOY_GROUP" -m 640 /dev/null "$CONFIG_DIR/hamlog.env"
  {
    echo '# HamLog application environment (docker --env-file: KEY=VALUE, no quotes).'
    if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
      echo "# Seeded from the running $CONTAINER_NAME container on $(date -u +%FT%TZ)."
      docker inspect --format='{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER_NAME" \
        | while IFS= read -r line; do
          key="${line%%=*}"
          value="${line#*=}"
          if [ -n "$value" ] && [[ " $APP_ENV_KEYS " == *" $key "* ]]; then
            printf '%s\n' "$line"
          fi
        done
    else
      echo 'JWT_SECRET='
      echo 'ADMIN_PASSWORD='
      echo 'AUTH_MODE=password'
    fi
  } > "$CONFIG_DIR/hamlog.env"
  echo "Created $CONFIG_DIR/hamlog.env"
fi

cat > "$SYSTEMD_DIR/hamlog-deploy.service" <<EOF
[Unit]
Description=Deploy the published HamLog image when it changes
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=oneshot
User=$DEPLOY_USER
Group=$DEPLOY_GROUP
Environment=HOME=$DEPLOY_HOME
StateDirectory=hamlog
ExecStart=$INSTALL_DIR/server-deploy.sh deploy
TimeoutStartSec=30min
EOF

cat > "$SYSTEMD_DIR/hamlog-deploy.timer" <<'EOF'
[Unit]
Description=Check for a new HamLog release every 2 minutes

[Timer]
OnBootSec=2min
OnUnitInactiveSec=2min

[Install]
WantedBy=timers.target
EOF

cat > "$SYSTEMD_DIR/hamlog-backup.service" <<EOF
[Unit]
Description=Create a verified HamLog data backup
After=docker.service

[Service]
Type=oneshot
User=$DEPLOY_USER
Group=$DEPLOY_GROUP
Environment=HOME=$DEPLOY_HOME
StateDirectory=hamlog
ExecStart=$INSTALL_DIR/server-deploy.sh backup
TimeoutStartSec=30min
EOF

cat > "$SYSTEMD_DIR/hamlog-backup.timer" <<'EOF'
[Unit]
Description=Daily HamLog backup at 03:17 Asia/Seoul

[Timer]
OnCalendar=*-*-* 03:17:00 Asia/Seoul
Persistent=true

[Install]
WantedBy=timers.target
EOF

if [ "${HAMLOG_SKIP_SYSTEMCTL:-false}" != true ]; then
  # The old GitHub runner logged in with short-lived job tokens. Stale ghcr.io
  # credentials make pulls of the public image fail, so pull anonymously.
  sudo -u "$DEPLOY_USER" -H docker logout ghcr.io >/dev/null 2>&1 || true
  systemctl daemon-reload
  systemctl enable --now hamlog-deploy.timer hamlog-backup.timer
fi

cat <<EOF

HamLog deployment agent installed for $DEPLOY_USER.
1. Review $CONFIG_DIR/hamlog.env and $CONFIG_DIR/deploy.env.
2. Check the first run:   journalctl -u hamlog-deploy -n 50
3. Timers:                systemctl list-timers 'hamlog-*'
EOF
