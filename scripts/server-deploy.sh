#!/usr/bin/env bash

# Pull-based HamLog deployment, run on the production server by systemd timers.
#
#   server-deploy.sh deploy   Deploy the published image if it differs from the
#                             running container (hamlog-deploy.timer).
#   server-deploy.sh backup   Create the scheduled verified backup
#                             (hamlog-backup.timer).
#
# GitHub only builds, tests, and publishes the image. Nothing on GitHub can run
# commands on this host: the server decides when to pull and deploy.

set -euo pipefail

COMMAND="${1:-deploy}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ENV_FILE="${HAMLOG_DEPLOY_ENV_FILE:-/etc/hamlog/deploy.env}"

if [ -f "$DEPLOY_ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$DEPLOY_ENV_FILE"
  set +a
fi

APP_NAME="${HAMLOG_CONTAINER_NAME:-hamlog}"
IMAGE="${HAMLOG_IMAGE:-ghcr.io/jangmalza/hamlog:latest}"
APP_ENV_FILE="${HAMLOG_APP_ENV_FILE:-/etc/hamlog/hamlog.env}"
DATA_ROOT="${HAMLOG_DATA_ROOT:-$HOME/hamlog-data}"
BACKUP_ROOT="${HAMLOG_BACKUP_DIR:-$HOME/hamlog-backups}"
STATE_DIR="${HAMLOG_STATE_DIR:-${STATE_DIRECTORY:-$HOME/.local/state/hamlog}}"
BIND_ADDRESS="${HAMLOG_BIND_ADDRESS:-127.0.0.1}"
PUBLIC_URL="${HAMLOG_PUBLIC_URL:-}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
FAILED_IMAGE_FILE="$STATE_DIR/failed-image"
LAST_FAILURE_FILE="$STATE_DIR/last-failure"

if [ -z "$IMAGE" ] || [[ "$IMAGE" =~ [[:space:]] ]]; then
  echo "Invalid container image reference: $IMAGE" >&2
  exit 1
fi

mkdir -p "$STATE_DIR"

# Telegram is optional. The token is passed through curl's config on stdin so
# it never appears in the process list.
notify() {
  local message="$1"
  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
    return 0
  fi
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_BOT_TOKEN" \
    | curl -fsS --max-time 10 -K - \
      --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" \
      --data-urlencode "text=$message" >/dev/null 2>&1 || true
}

# The timer retries every few minutes; report each distinct failure once.
notify_failure() {
  local key="$1"
  local message="$2"
  echo "$message" >&2
  if [ "$(cat "$LAST_FAILURE_FILE" 2>/dev/null || true)" != "$key" ]; then
    printf '%s' "$key" > "$LAST_FAILURE_FILE"
    notify "❌ HamLog: $message"
  fi
}

run_backup() {
  BACKUP_RETENTION_DAYS="$RETENTION_DAYS" \
    HAMLOG_CONTAINER_NAME="$APP_NAME" \
    HAMLOG_VERIFY_DATA=true \
    bash "$SCRIPT_DIR/backup-data.sh" "$DATA_ROOT" "$BACKUP_ROOT"
}

# Deploys and scheduled backups share one lock so they never overlap.
exec 9>"$STATE_DIR/deploy.lock"

if [ "$COMMAND" = "backup" ]; then
  flock 9
  if ! run_backup; then
    notify_failure "backup:$(date -u +%F)" "scheduled backup failed on $(hostname). Check: journalctl -u hamlog-backup"
    exit 1
  fi
  exit 0
fi

if [ "$COMMAND" != "deploy" ]; then
  echo "Usage: server-deploy.sh [deploy|backup]" >&2
  exit 2
fi

if ! flock -n 9; then
  echo "Another deployment or backup is running; skipping this check."
  exit 0
fi

# Docker reads --env-file literally: KEY=VALUE per line, no quotes or expansion.
env_file_value() {
  grep -E "^$1=" "$APP_ENV_FILE" | tail -n 1 | cut -d= -f2-
}

validate_app_env() {
  if [ ! -r "$APP_ENV_FILE" ]; then
    echo "Application environment file is not readable: $APP_ENV_FILE" >&2
    return 1
  fi
  if [ -z "$(env_file_value JWT_SECRET)" ]; then
    echo "JWT_SECRET is required in $APP_ENV_FILE" >&2
    return 1
  fi
  case "$(env_file_value AUTH_MODE)" in
    ''|password)
      if [ -z "$(env_file_value ADMIN_PASSWORD)" ]; then
        echo "ADMIN_PASSWORD is required in $APP_ENV_FILE" >&2
        return 1
      fi
      ;;
    cloudflare-access)
      if [ -z "$(env_file_value CLOUDFLARE_ACCESS_TEAM_DOMAIN)" ] \
        || [ -z "$(env_file_value CLOUDFLARE_ACCESS_AUD)" ]; then
        echo "Cloudflare Access team domain and AUD are required in $APP_ENV_FILE" >&2
        return 1
      fi
      ;;
    *)
      echo "Unsupported AUTH_MODE in $APP_ENV_FILE" >&2
      return 1
      ;;
  esac
}

if ! docker pull -q "$IMAGE" >/dev/null; then
  echo "Could not pull $IMAGE; will retry on the next check." >&2
  exit 1
fi

NEW_IMAGE_ID="$(docker image inspect --format='{{.Id}}' "$IMAGE")"
PREVIOUS_IMAGE_ID=""
PREVIOUS_CONTAINER_EXISTS=false
if docker inspect "$APP_NAME" >/dev/null 2>&1; then
  PREVIOUS_IMAGE_ID="$(docker inspect --format='{{.Image}}' "$APP_NAME")"
  PREVIOUS_CONTAINER_EXISTS=true
fi

if [ "$NEW_IMAGE_ID" = "$PREVIOUS_IMAGE_ID" ]; then
  exit 0
fi

# A release that failed health checks is not retried until a newer image is
# published; retrying would cut over and roll back every few minutes.
if [ "$NEW_IMAGE_ID" = "$(cat "$FAILED_IMAGE_FILE" 2>/dev/null || true)" ]; then
  exit 0
fi

REVISION="$(docker image inspect --format='{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE" 2>/dev/null || true)"
APP_VERSION="${REVISION:0:7}"
if [ -z "$APP_VERSION" ] || [ "$REVISION" = "<no value>" ]; then
  APP_VERSION="${NEW_IMAGE_ID#sha256:}"
  APP_VERSION="${APP_VERSION:0:7}"
fi

echo "Deploying $IMAGE ($APP_VERSION)..."

if ! validate_app_env; then
  notify_failure "config:$NEW_IMAGE_ID" "deployment of $APP_VERSION stopped: invalid $APP_ENV_FILE"
  exit 1
fi

DATA_GID="$(id -g)"
ROLLBACK_CONTAINER="$APP_NAME-rollback-$$"
PREVIOUS_CONTAINER_PRESERVED=false
PREVIOUS_CONTAINER_STOPPED=false
DEPLOYMENT_COMMITTED=false

PUBLISH_BIND_ADDRESS="$BIND_ADDRESS"
LOCAL_HEALTH_ADDRESS="$BIND_ADDRESS"
if [[ "$PUBLISH_BIND_ADDRESS" == *:* ]]; then
  PUBLISH_BIND_ADDRESS="[$PUBLISH_BIND_ADDRESS]"
fi
case "$LOCAL_HEALTH_ADDRESS" in
  0.0.0.0) LOCAL_HEALTH_ADDRESS="127.0.0.1" ;;
  ::) LOCAL_HEALTH_ADDRESS="::1" ;;
esac
if [[ "$LOCAL_HEALTH_ADDRESS" == *:* ]]; then
  LOCAL_HEALTH_ADDRESS="[$LOCAL_HEALTH_ADDRESS]"
fi
LOCAL_HEALTH_URL="http://$LOCAL_HEALTH_ADDRESS:4000"

# Back up before touching the running container. A failed backup leaves
# production untouched and is retried on the next check.
if [ "$PREVIOUS_CONTAINER_EXISTS" = true ]; then
  echo "Creating and verifying a pre-deployment backup..."
  if ! run_backup; then
    notify_failure "backup:$NEW_IMAGE_ID" "deployment of $APP_VERSION stopped: pre-deployment backup failed"
    exit 1
  fi
fi

prepare_persistent_directories() {
  local image="$1"
  local runtime_user
  local data_owner
  runtime_user=$(docker image inspect --format='{{.Config.User}}' "$image")

  case "$runtime_user" in
    ''|root|0|0:0|root:root) data_owner='root' ;;
    node|node:node|1000|1000:1000) data_owner='node' ;;
    *)
      echo "Unsupported container runtime user for persistent data: $runtime_user" >&2
      return 1
      ;;
  esac

  mkdir -p "$DATA_ROOT/data" "$DATA_ROOT/uploads"
  docker run --rm \
    --user root \
    --network none \
    --cap-drop ALL \
    --cap-add CHOWN \
    --cap-add DAC_OVERRIDE \
    --cap-add FOWNER \
    --cap-add FSETID \
    --security-opt no-new-privileges \
    --entrypoint sh \
    -v "$DATA_ROOT/data:/app/server/data" \
    -v "$DATA_ROOT/uploads:/app/server/uploads" \
    "$image" \
    -c 'set -e
        chown -R "$1:$2" /app/server/data /app/server/uploads
        chmod -R u=rwX,g=rX,o= /app/server/data /app/server/uploads
        find /app/server/data /app/server/uploads -type d -exec chmod g+s {} +' \
    sh "$data_owner" "$DATA_GID"
}

run_container() {
  local image="$1"
  local app_version="$2"
  # Secrets come from the env file, so they never appear in the process list.
  docker run -d \
    --name "$APP_NAME" \
    --restart unless-stopped \
    --log-driver json-file \
    --log-opt max-size=10m \
    --log-opt max-file=3 \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    -p "$PUBLISH_BIND_ADDRESS:4000:4000" \
    -v "$DATA_ROOT/data:/app/server/data" \
    -v "$DATA_ROOT/uploads:/app/server/uploads" \
    --env-file "$APP_ENV_FILE" \
    -e NODE_ENV=production \
    -e PORT=4000 \
    -e APP_VERSION="$app_version" \
    "$image"
}

wait_for_health() {
  local health_url="$1"
  local expected_version="${2:-}"
  local attempt=0
  while [ "$attempt" -lt 15 ]; do
    local response
    response=$(curl -fsS --max-time 5 "$health_url" 2>/dev/null || true)

    if [[ "$response" == *'"status":"ok"'* ]]; then
      if [ -z "$expected_version" ] || [[ "$response" == *"\"version\":\"$expected_version\""* ]]; then
        return 0
      fi
    fi

    attempt=$((attempt + 1))
    sleep 2
  done
  return 1
}

verify_persistent_writes() {
  docker exec "$APP_NAME" node -e \
    "const fs = require('node:fs'); const created = []; try { for (const dir of ['/app/server/data', '/app/server/uploads']) created.push(fs.mkdtempSync(dir + '/.hamlog-write-check-')); } finally { for (const path of created.reverse()) fs.rmSync(path, { recursive: true, force: true }); }"
}

wait_for_deployment_health() {
  local expected_version="$1"

  wait_for_health "$LOCAL_HEALTH_URL/api/health" "$expected_version" || return 1
  verify_persistent_writes || return 1

  if [ -z "$PUBLIC_URL" ]; then
    return 0
  fi

  wait_for_health "${PUBLIC_URL%/}/api/health" "$expected_version" || return 1
  curl -fsS --max-time 10 "${PUBLIC_URL%/}/" >/dev/null
}

wait_for_container_health() {
  local attempt=0
  while [ "$attempt" -lt 15 ]; do
    if docker exec "$APP_NAME" node -e \
      "fetch('http://127.0.0.1:4000/api/health').then(async (response) => { const body = await response.json(); if (!response.ok || body.status !== 'ok') process.exit(1); }).catch(() => process.exit(1))"; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  return 1
}

preserve_previous_container() {
  if [ "$PREVIOUS_CONTAINER_EXISTS" != true ]; then
    return 0
  fi

  if docker inspect "$ROLLBACK_CONTAINER" >/dev/null 2>&1; then
    echo "Rollback container name already exists: $ROLLBACK_CONTAINER" >&2
    return 1
  fi

  # Arm restoration before stop so an interrupt during `docker stop`
  # still restarts the container under its original name.
  PREVIOUS_CONTAINER_STOPPED=true
  docker stop "$APP_NAME" || return 1
  if ! docker rename "$APP_NAME" "$ROLLBACK_CONTAINER"; then
    if docker start "$APP_NAME"; then
      PREVIOUS_CONTAINER_STOPPED=false
    fi
    return 1
  fi

  PREVIOUS_CONTAINER_PRESERVED=true
}

rollback_to_previous() {
  if [ "$PREVIOUS_CONTAINER_PRESERVED" != true ]; then
    echo "No preserved container is available for rollback." >&2
    return 1
  fi

  echo "Restoring the preserved container ($PREVIOUS_IMAGE_ID)"
  prepare_persistent_directories "$PREVIOUS_IMAGE_ID" || return 1
  docker rename "$ROLLBACK_CONTAINER" "$APP_NAME" || return 1
  # The previous container is back under its canonical name. From this point
  # an exit handler must start it, not remove it as the new one.
  PREVIOUS_CONTAINER_PRESERVED=false
  docker start "$APP_NAME" || return 1

  if ! wait_for_container_health || ! verify_persistent_writes; then
    echo "Rollback health check failed." >&2
    docker logs "$APP_NAME" || true
    return 1
  fi

  PREVIOUS_CONTAINER_STOPPED=false
}

restore_interrupted_cutover() {
  local exit_code=$?
  local rollback_container_exists=false
  local canonical_image_id=""
  local canonical_is_previous=false

  # Avoid recursive traps and let the recovery attempt finish when systemd
  # sends more termination signals.
  trap - EXIT
  trap '' HUP INT TERM

  if [ "$DEPLOYMENT_COMMITTED" != true ]; then
    # A signal may arrive after `docker rename` succeeds but before the next
    # shell assignment. Reconcile actual Docker names and image IDs so that the
    # preserved container is never mistaken for the new one.
    if [ "$PREVIOUS_CONTAINER_STOPPED" = true ] \
      || [ "$PREVIOUS_CONTAINER_PRESERVED" = true ]; then
      if docker inspect "$ROLLBACK_CONTAINER" >/dev/null 2>&1; then
        rollback_container_exists=true
      fi
      canonical_image_id=$(docker inspect --format='{{.Image}}' "$APP_NAME" 2>/dev/null || true)
      if [ -n "$PREVIOUS_IMAGE_ID" ] && [ "$canonical_image_id" = "$PREVIOUS_IMAGE_ID" ]; then
        canonical_is_previous=true
      fi
    fi

    if [ "$rollback_container_exists" = true ]; then
      echo "Deployment interrupted; restoring the preserved container." >&2
      PREVIOUS_CONTAINER_PRESERVED=true
      docker rm -f "$APP_NAME" >/dev/null 2>&1 || true
      if ! rollback_to_previous; then
        echo "Interrupted deployment rollback failed; $ROLLBACK_CONTAINER remains for manual recovery when available." >&2
      fi
    elif [ "$canonical_is_previous" = true ]; then
      echo "Deployment interrupted while the previous container was stopped; restarting it." >&2
      PREVIOUS_CONTAINER_PRESERVED=false
      if docker start "$APP_NAME" >/dev/null 2>&1 \
        && wait_for_container_health \
        && verify_persistent_writes; then
        PREVIOUS_CONTAINER_STOPPED=false
      else
        echo "Could not confirm recovery of the previous $APP_NAME container." >&2
        docker logs "$APP_NAME" || true
      fi
    elif [ "$PREVIOUS_CONTAINER_STOPPED" = true ] \
      || [ "$PREVIOUS_CONTAINER_PRESERVED" = true ]; then
      echo "Could not locate the previous container under $APP_NAME or $ROLLBACK_CONTAINER; leaving any current container untouched." >&2
    fi
  fi

  exit "$exit_code"
}

# Only arm the recovery handler immediately before the destructive cutover.
# Failures during pull, validation, or backup leave production intact.
trap restore_interrupted_cutover EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if ! preserve_previous_container; then
  notify_failure "preserve:$NEW_IMAGE_ID" "deployment of $APP_VERSION aborted before cutover: could not preserve the current container"
  exit 1
fi

if ! prepare_persistent_directories "$NEW_IMAGE_ID" \
  || ! run_container "$NEW_IMAGE_ID" "$APP_VERSION" \
  || ! wait_for_deployment_health "$APP_VERSION"; then
  echo "New deployment failed during preparation, startup, or verification." >&2
  docker logs "$APP_NAME" || true
  docker rm -f "$APP_NAME" || true
  printf '%s' "$NEW_IMAGE_ID" > "$FAILED_IMAGE_FILE"

  if [ "$PREVIOUS_CONTAINER_EXISTS" = true ] && ! rollback_to_previous; then
    echo "Automatic rollback did not restore a healthy writable container." >&2
    notify_failure "deploy:$NEW_IMAGE_ID" "deployment of $APP_VERSION failed and ROLLBACK FAILED. Check the server now."
    exit 1
  fi

  notify_failure "deploy:$NEW_IMAGE_ID" "deployment of $APP_VERSION failed; the previous version was restored"
  exit 1
fi

# The new container is healthy and writable. Disable automatic rollback before
# deleting the preserved container so an interrupt cannot remove the healthy
# release after its rollback source has gone away.
DEPLOYMENT_COMMITTED=true
trap - EXIT HUP INT TERM

if [ "$PREVIOUS_CONTAINER_PRESERVED" = true ]; then
  if ! docker rm "$ROLLBACK_CONTAINER" >/dev/null; then
    echo "WARNING: new deployment is healthy, but rollback container cleanup failed: $ROLLBACK_CONTAINER" >&2
  fi
fi

rm -f "$FAILED_IMAGE_FILE" "$LAST_FAILURE_FILE"

# The previous release image is no longer needed; ignore it if still in use.
if [ -n "$PREVIOUS_IMAGE_ID" ]; then
  docker image rm "$PREVIOUS_IMAGE_ID" >/dev/null 2>&1 || true
fi

echo "Deployed $APP_VERSION."
notify "✅ HamLog $APP_VERSION deployed."
