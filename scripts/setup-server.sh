#!/bin/bash

# HamLog Server Setup & Deploy Script
# Usage: ./setup-server.sh

set -e

APP_NAME="hamlog"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEGACY_IMAGE_OVERRIDE="${IMAGE_NAME:-}"
IMAGE_NAME="${HAMLOG_IMAGE:-${LEGACY_IMAGE_OVERRIDE}}"

if [ -z "$IMAGE_NAME" ]; then
    # Never fall back to a hard-coded owner: a renamed or deleted GitHub account can
    # be registered again by someone else, whose image would then run with our secrets.
    REPOSITORY_NAME="${HAMLOG_GITHUB_REPOSITORY:-${GITHUB_REPOSITORY:-}}"
    if [ -z "$REPOSITORY_NAME" ]; then
        ORIGIN_URL="$(git -C "$SCRIPT_DIR/.." remote get-url origin 2>/dev/null || true)"
        if [[ "$ORIGIN_URL" =~ github\.com[:/]([^/]+/[^/]+)$ ]]; then
            REPOSITORY_NAME="${BASH_REMATCH[1]%.git}"
        fi
    fi
    if [ -z "$REPOSITORY_NAME" ]; then
        echo "Set HAMLOG_IMAGE or HAMLOG_GITHUB_REPOSITORY (owner/repo) to choose the image to deploy." >&2
        exit 1
    fi

    NORMALIZED_REPOSITORY_NAME="$(printf '%s' "$REPOSITORY_NAME" | tr '[:upper:]' '[:lower:]')"
    if [[ ! "$NORMALIZED_REPOSITORY_NAME" =~ ^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$ ]]; then
        echo "Invalid GitHub repository name: $REPOSITORY_NAME" >&2
        exit 1
    fi
    IMAGE_NAME="ghcr.io/${NORMALIZED_REPOSITORY_NAME}:latest"
fi

if [ -z "$IMAGE_NAME" ] || [[ "$IMAGE_NAME" =~ [[:space:]] ]]; then
    echo "Invalid container image reference: $IMAGE_NAME" >&2
    exit 1
fi

DATA_DIR="$HOME/hamlog-data"
BACKUP_DIR="${HAMLOG_BACKUP_DIR:-$HOME/hamlog-backups}"

echo "🐹 HamLog Server Setup Starting..."

# 1. Install Docker if not exists
if ! command -v docker &> /dev/null; then
    echo "📦 Docker not found. Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo "✅ Docker installed successfully."
    echo "⚠️  Please logout and login again to apply Docker group changes, then run this script again."
    exit 1
fi

# 2. Setup Data Directories
echo "b  Setting up data directories at $DATA_DIR..."
mkdir -p "$DATA_DIR/data"
mkdir -p "$DATA_DIR/uploads"

# 3. Authentication
echo "🔐 Authenticating with GitHub Container Registry..."
read -p "Enter GitHub Username: " GH_USER
echo "Please enter your GitHub Personal Access Token (PAT) with 'read:packages' scope."
read -sp "GitHub Token: " CR_PAT
echo ""
echo "$CR_PAT" | docker login ghcr.io -u "$GH_USER" --password-stdin
# Note: User needs to provide their GitHub username, or we can prompt for it.
# Let's prompt for username to be safe.

# 4. Environment Variables
echo "⚙️  Configuring Environment..."
AUTH_MODE="${AUTH_MODE:-password}"
ADMIN_PWD=""
case "$AUTH_MODE" in
    password)
        read -sp "Enter Admin Password for the Blog: " ADMIN_PWD
        echo ""
        ;;
    cloudflare-access)
        : "${CLOUDFLARE_ACCESS_TEAM_DOMAIN:?Cloudflare Access team domain is required}"
        : "${CLOUDFLARE_ACCESS_AUD:?Cloudflare Access application AUD is required}"
        ;;
    *) echo "Unsupported AUTH_MODE" >&2; exit 1 ;;
esac
read -sp "Enter JWT Secret (random string recommended): " JWT_SEC
echo ""
if [ -z "$JWT_SEC" ] || { [ "$AUTH_MODE" = password ] && [ -z "$ADMIN_PWD" ]; }; then
    echo "❌ Admin password and JWT secret are required."
    exit 1
fi
read -p "Enter allowed frontend origin(s) for cross-site admin access (optional, comma-separated): " CORS_ORIGINS
read -p "Trusted proxy hops [0/1/2...] (default: 0): " TRUST_PROXY
read -p "Cookie SameSite policy [auto/lax/strict/none] (default: auto): " COOKIE_SAME_SITE_INPUT
read -p "Force secure cookies? [auto/true/false] (default: auto): " COOKIE_SECURE_INPUT
PORT=4000
BIND_ADDRESS="${HAMLOG_BIND_ADDRESS:-127.0.0.1}"
PUBLISH_BIND_ADDRESS="$BIND_ADDRESS"
DATA_GID="$(id -g)"

if [[ "$PUBLISH_BIND_ADDRESS" == *:* ]]; then
  PUBLISH_BIND_ADDRESS="[$PUBLISH_BIND_ADDRESS]"
fi

COOKIE_SAME_SITE=""
COOKIE_SECURE=""
TRUST_PROXY="${TRUST_PROXY:-0}"

if [[ "$COOKIE_SAME_SITE_INPUT" != "" && "$COOKIE_SAME_SITE_INPUT" != "auto" ]]; then
  COOKIE_SAME_SITE="$COOKIE_SAME_SITE_INPUT"
fi

if [[ "$COOKIE_SECURE_INPUT" == "true" || "$COOKIE_SECURE_INPUT" == "false" ]]; then
  COOKIE_SECURE="$COOKIE_SECURE_INPUT"
fi

# 5. Deploy
ROLLBACK_NAME="${APP_NAME}-rollback-$$"
PREVIOUS_IMAGE=""
PREVIOUS_RUNTIME_USER=""
PREVIOUS_CONTAINER_ID=""
ROLLBACK_ARMED=false
DEPLOYMENT_COMMITTED=false

if docker inspect "$APP_NAME" >/dev/null 2>&1; then
  PREVIOUS_CONTAINER_ID="$(docker inspect --format='{{.Id}}' "$APP_NAME")"
  PREVIOUS_IMAGE="$(docker inspect --format='{{.Image}}' "$APP_NAME")"
  PREVIOUS_RUNTIME_USER="$(docker inspect --format='{{.Config.User}}' "$APP_NAME")"
fi

echo "🚀 Pulling latest image..."
docker pull "$IMAGE_NAME"
NEW_RUNTIME_USER="$(docker image inspect --format='{{.Config.User}}' "$IMAGE_NAME")"

resolve_data_ownership() {
  case "$1" in
    ''|root|0|0:0|root:root) printf '%s\n' 'root' ;;
    node|node:node|1000|1000:1000) printf '%s\n' 'node' ;;
    *)
      echo "Unsupported container runtime user for persistent data: $1" >&2
      return 1
      ;;
  esac
}

prepare_data_for_image() {
  local image="$1"
  local runtime_user="$2"
  local data_owner
  data_owner="$(resolve_data_ownership "$runtime_user")" || return 1

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
    -v "$DATA_DIR/data:/app/server/data" \
    -v "$DATA_DIR/uploads:/app/server/uploads" \
    "$image" \
    -c 'set -e
        chown -R "$1:$2" /app/server/data /app/server/uploads
        chmod -R u=rwX,g=rX,o= /app/server/data /app/server/uploads
        find /app/server/data /app/server/uploads -type d -exec chmod g+s {} +' \
    sh "$data_owner" "$DATA_GID"
}

wait_for_new_container() {
  local attempt=0

  until docker exec "$APP_NAME" node -e \
    "fetch('http://127.0.0.1:4000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 20 ]; then
      return 1
    fi
    sleep 1
  done

  docker exec "$APP_NAME" node -e \
    "const fs = require('node:fs'); const created = []; try { for (const dir of ['/app/server/data', '/app/server/uploads']) created.push(fs.mkdtempSync(dir + '/.hamlog-write-check-')); } finally { for (const path of created.reverse()) fs.rmSync(path, { recursive: true, force: true }); }"
}

rollback_previous_container() {
  local current_app_id=""
  local previous_name=""
  local previous_running="false"

  if [ -z "$PREVIOUS_CONTAINER_ID" ] || [ -z "$PREVIOUS_IMAGE" ]; then
    echo "No previous container is available for rollback." >&2
    return 1
  fi

  current_app_id="$(docker inspect --format='{{.Id}}' "$APP_NAME" 2>/dev/null || true)"
  if [ -n "$current_app_id" ] && [ "$current_app_id" != "$PREVIOUS_CONTAINER_ID" ]; then
    echo "Removing failed replacement container $current_app_id..." >&2
    docker rm -f "$APP_NAME" >/dev/null 2>&1 || return 1
    current_app_id=""
  fi

  if ! docker inspect "$PREVIOUS_CONTAINER_ID" >/dev/null 2>&1; then
    echo "Preserved container no longer exists: $PREVIOUS_CONTAINER_ID" >&2
    return 1
  fi

  previous_name="$(docker inspect --format='{{.Name}}' "$PREVIOUS_CONTAINER_ID" | sed 's#^/##')"
  previous_running="$(docker inspect --format='{{.State.Running}}' "$PREVIOUS_CONTAINER_ID")"

  if [ "$previous_name" = "$APP_NAME" ] && [ "$previous_running" = "true" ]; then
    wait_for_new_container
    return $?
  fi

  prepare_data_for_image "$PREVIOUS_IMAGE" "$PREVIOUS_RUNTIME_USER" || return 1

  if [ "$previous_name" != "$APP_NAME" ]; then
    docker rename "$PREVIOUS_CONTAINER_ID" "$APP_NAME" || return 1
  fi

  docker start "$APP_NAME" || return 1
  wait_for_new_container || return 1
}

handle_deploy_exit() {
  local exit_status=$?
  local rollback_status=0

  trap - EXIT
  trap '' TERM HUP INT

  if [ "$ROLLBACK_ARMED" = "true" ] && [ "$DEPLOYMENT_COMMITTED" != "true" ]; then
    set +e
    echo "Deployment did not commit; restoring the previous container..." >&2
    rollback_previous_container
    rollback_status=$?

    if [ "$rollback_status" -eq 0 ]; then
      echo "↩️ Previous container restored." >&2
    else
      echo "❌ Automatic rollback failed; preserved container ID: $PREVIOUS_CONTAINER_ID" >&2
      if [ "$exit_status" -eq 0 ]; then
        exit_status=1
      fi
    fi
  fi

  exit "$exit_status"
}

handle_deploy_signal() {
  local signal_name="$1"
  local exit_status="$2"
  echo "Received $signal_name during deployment; stopping cutover." >&2
  exit "$exit_status"
}

# Validate the new runtime user before stopping the currently healthy container.
resolve_data_ownership "$NEW_RUNTIME_USER" >/dev/null

echo "🛑 Stopping existing container..."
if [ -n "$PREVIOUS_IMAGE" ]; then
  if docker inspect "$ROLLBACK_NAME" >/dev/null 2>&1; then
    echo "Rollback container name already exists: $ROLLBACK_NAME" >&2
    exit 1
  fi

  echo "💾 Creating and verifying a pre-deployment backup..."
  BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}" \
    HAMLOG_CONTAINER_NAME="$APP_NAME" \
    HAMLOG_VERIFY_DATA=true \
    bash "$SCRIPT_DIR/backup-data.sh" "$DATA_DIR" "$BACKUP_DIR"

  ROLLBACK_ARMED=true
  trap 'handle_deploy_exit' EXIT
  trap 'handle_deploy_signal TERM 143' TERM
  trap 'handle_deploy_signal HUP 129' HUP
  trap 'handle_deploy_signal INT 130' INT

  docker stop "$APP_NAME"
  docker rename "$APP_NAME" "$ROLLBACK_NAME"
fi

echo "▶️  Starting new container..."
if ! prepare_data_for_image "$IMAGE_NAME" "$NEW_RUNTIME_USER" \
  || ! docker run -d \
    --name "$APP_NAME" \
    --restart unless-stopped \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    -p "$PUBLISH_BIND_ADDRESS:$PORT:4000" \
    -v "$DATA_DIR/data":/app/server/data \
    -v "$DATA_DIR/uploads":/app/server/uploads \
    -e NODE_ENV=production \
    -e PORT=4000 \
    -e JWT_SECRET="$JWT_SEC" \
    -e ADMIN_PASSWORD="$ADMIN_PWD" \
    -e AUTH_MODE="$AUTH_MODE" \
    -e CLOUDFLARE_ACCESS_TEAM_DOMAIN="${CLOUDFLARE_ACCESS_TEAM_DOMAIN:-}" \
    -e CLOUDFLARE_ACCESS_AUD="${CLOUDFLARE_ACCESS_AUD:-}" \
    -e CORS_ORIGINS="$CORS_ORIGINS" \
    -e COOKIE_SAME_SITE="$COOKIE_SAME_SITE" \
    -e COOKIE_SECURE="$COOKIE_SECURE" \
    -e TRUST_PROXY="$TRUST_PROXY" \
    "$IMAGE_NAME" \
  || ! wait_for_new_container; then
  echo "❌ New container failed preparation, startup, or verification." >&2
  docker logs "$APP_NAME" || true
  if [ -z "$PREVIOUS_CONTAINER_ID" ]; then
    docker rm -f "$APP_NAME" >/dev/null 2>&1 || true
  fi
  exit 1
fi

DEPLOYMENT_COMMITTED=true
ROLLBACK_ARMED=false
trap - EXIT TERM HUP INT

if [ -n "$PREVIOUS_IMAGE" ]; then
  if ! docker rm "$ROLLBACK_NAME" >/dev/null; then
    echo "WARNING: new deployment is healthy, but rollback container cleanup failed: $ROLLBACK_NAME" >&2
  fi
fi

echo "✅ Deployment Complete!"
echo "🌍 Blog is running at http://$BIND_ADDRESS:$PORT"
