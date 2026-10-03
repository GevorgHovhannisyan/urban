#!/usr/bin/env bash
# Runs ON THE SERVER as root or gev (called by GitHub Actions).
# Updates /var/www/urban IN PLACE (no folder restructuring needed).
# Steps: unpack to staging -> install deps -> back up DB + current app
#        -> copy new files in -> restart -> health check -> auto rollback.
set -euo pipefail

# ---------- settings (edit these) ----------
APP_DIR=/var/www/urban
SERVICE=urban-phoenix
APP_USER=gev                                   # user the service runs as
DB_NAME=urban
APP_PORT=4173                                  # port your server.mjs listens on
HEALTH_URL="http://127.0.0.1:${APP_PORT}/"     # better: add /api/health to your app
KEEP_BACKUPS=14
# Files/folders on the server that a deploy must NEVER overwrite or delete:
PROTECT=(".env" "uploads")
# -------------------------------------------

SHA="${1:?commit SHA required}"
SHORT="${SHA:0:7}"
WORK="$HOME/deploy"
ARCHIVE="$WORK/incoming/$SHA.tar.gz"
STAGING="$WORK/staging"
PREVIOUS="$WORK/previous"

log() { echo "[deploy] $*"; }

# When running as root, make sure the app files belong to the service user
fix_owner() {
  if [ "$(id -u)" -eq 0 ]; then
    chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  fi
}

EXCLUDES=()
for p in "${PROTECT[@]}"; do EXCLUDES+=(--exclude "/$p"); done

# 1. Unpack the new version into a staging folder (live app keeps running)
log "Unpacking $SHORT"
rm -rf "$STAGING"
mkdir -p "$STAGING" "$WORK/backups"
tar --no-same-owner -xzf "$ARCHIVE" -C "$STAGING"
rm -f "$ARCHIVE"

# 2. Install production dependencies in staging
log "Installing dependencies"
cd "$STAGING"
npm ci --omit=dev --no-audit --no-fund

# 3. Back up the database
log "Backing up database"
mysqldump --no-tablespaces --single-transaction "$DB_NAME" \
  | gzip > "$WORK/backups/${DB_NAME}-$(date +%F-%H%M%S)-${SHORT}.sql.gz"
ls -1t "$WORK"/backups/*.sql.gz | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm --

# 4. Save a copy of the current live app for rollback
log "Saving current version for rollback"
rsync -a --delete "$APP_DIR/" "$PREVIOUS/"

# 5. Copy the new version over the live folder (protected files untouched)
log "Updating $APP_DIR"
rsync -a --delete "${EXCLUDES[@]}" "$STAGING/" "$APP_DIR/"
fix_owner

log "Restarting $SERVICE"
sudo /usr/bin/systemctl restart "$SERVICE"

# 6. Health check: up to ~40 seconds
healthy=false
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null --max-time 3 "$HEALTH_URL"; then
    healthy=true
    break
  fi
  sleep 2
done

# 7. Roll back automatically if the new version is broken
if [ "$healthy" != true ]; then
  log "Health check FAILED - rolling back"
  rsync -a --delete "$PREVIOUS/" "$APP_DIR/"
  fix_owner
  sudo /usr/bin/systemctl restart "$SERVICE"
  exit 1
fi

rm -rf "$STAGING"
log "Deployed $SHORT successfully"
