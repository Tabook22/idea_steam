#!/usr/bin/env bash
set -euo pipefail
umask 077
APP_ROOT=/home/nasser/apps/idea-stream
export PATH="$APP_ROOT/tooling/node_modules/.bin:$PATH"
cd "$APP_ROOT/repo"
test -z "$(git status --porcelain)" || { echo 'Checkout has local edits; update stopped.'; exit 1; }
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm typecheck
node --experimental-strip-types --test scripts/recording.test.mjs scripts/offline-recorder.test.mjs
(cd scripts && node --import tsx --test vps.test.mjs)
BASE_PATH=/ideas/ PORT=5185 pnpm --filter @workspace/idea-stream build
pnpm --filter @workspace/api-server build
set -a
. "$APP_ROOT/private/app.env"
set +a
release="$APP_ROOT/releases/$(git rev-parse --short=12 HEAD)-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$release"
cp -a artifacts/api-server/dist "$release/server"
cp -a artifacts/idea-stream/dist/public "$release/public"
ln -s "$APP_ROOT/repo/artifacts/api-server/node_modules" "$release/server/node_modules"
previous=$(readlink "$APP_ROOT/current" || true)
/usr/lib/postgresql/16/bin/pg_dump "$DATABASE_URL" --format=custom --file="$APP_ROOT/backups/database-$(date -u +%Y%m%dT%H%M%SZ).dump"
/usr/lib/postgresql/16/bin/psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/20260921_recording_capture.sql
ln -s "$release" "$APP_ROOT/current.next"
mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
systemctl --user enable idea-stream.service
systemctl --user restart idea-stream.service
healthy=false
for attempt in {1..30}; do
  if node deploy/vps/healthcheck.mjs; then healthy=true; break; fi
  sleep 1
done
if [ "$healthy" != true ]; then
  if [ -n "$previous" ]; then
    ln -s "$previous" "$APP_ROOT/rollback.next"
    mv -Tf "$APP_ROOT/rollback.next" "$APP_ROOT/current"
    systemctl --user restart idea-stream.service
    echo 'Health check failed; previous release restored.'
  else
    systemctl --user stop idea-stream.service
    echo 'Initial health check failed; service stopped.'
  fi
  exit 1
fi
printf 'Idea Stream release is running on loopback port 5185. Main application unchanged.\n'
