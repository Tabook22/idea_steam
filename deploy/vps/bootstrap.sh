#!/usr/bin/env bash
set -euo pipefail
umask 077
APP_ROOT=/home/nasser/apps/idea-stream
PG_BIN=/usr/lib/postgresql/16/bin
test "$(id -un)" = nasser
test -d "$APP_ROOT/repo/.git"
mkdir -p "$APP_ROOT/private" "$APP_ROOT/uploads" "$APP_ROOT/backups" "$APP_ROOT/releases" "$APP_ROOT/run" "$HOME/.config/systemd/user"
if [ ! -f "$APP_ROOT/private/app.env" ]; then
  APP_ROOT="$APP_ROOT" node --input-type=module <<'JS'
import { randomBytes, scryptSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const root = process.env.APP_ROOT;
const databasePassword = randomBytes(32).toString('hex');
const password = randomBytes(18).toString('base64url');
const salt = randomBytes(16).toString('hex');
const env = {
  NODE_ENV:'production', HOST:'127.0.0.1', PORT:'5185', APP_BASE_PATH:'/ideas', APP_ORIGIN:'https://nasserdiary.com',
  DATABASE_URL:`postgresql://idea_stream:${databasePassword}@127.0.0.1:55432/idea_stream`,
  FRONTEND_DIST:`${root}/current/public`, LOCAL_STORAGE_DIR:`${root}/uploads`,
  UPLOAD_SIGNING_SECRET:randomBytes(32).toString('hex'), APP_REQUIRE_AUTH:'true', APP_USERNAME:'nasser',
  APP_PASSWORD_HASH:`${salt}:${scryptSync(password,salt,32).toString('hex')}`, OPENAI_TEXT_MODEL:'gpt-4.1-mini'
};
writeFileSync(`${root}/private/app.env`,Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
writeFileSync(`${root}/private/database-password`, databasePassword+'\n',{mode:0o600});
writeFileSync(`${root}/private/initial-password.txt`,password+'\n',{mode:0o600});
JS
fi
if [ ! -f "$APP_ROOT/postgres/PG_VERSION" ]; then
  "$PG_BIN/initdb" -D "$APP_ROOT/postgres" -U idea_stream --pwfile="$APP_ROOT/private/database-password" --auth-host=scram-sha-256 --auth-local=scram-sha-256 --encoding=UTF8 --locale=C.UTF-8
  cat >> "$APP_ROOT/postgres/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
port = 55432
unix_socket_directories = '$APP_ROOT/run'
shared_buffers = '64MB'
max_connections = 30
EOF
fi
cat > "$HOME/.config/systemd/user/idea-stream-db.service" <<EOF
[Unit]
Description=Idea Stream isolated PostgreSQL
[Service]
Type=simple
ExecStart=$PG_BIN/postgres -D $APP_ROOT/postgres
Restart=on-failure
RestartSec=5
KillSignal=SIGINT
TimeoutStopSec=120
UMask=0077
NoNewPrivileges=true
[Install]
WantedBy=default.target
EOF
cat > "$HOME/.config/systemd/user/idea-stream.service" <<EOF
[Unit]
Description=Idea Stream private notebook
Wants=idea-stream-db.service
After=idea-stream-db.service
[Service]
Type=simple
WorkingDirectory=$APP_ROOT/current/server
EnvironmentFile=$APP_ROOT/private/app.env
Environment=PATH=$APP_ROOT/tooling/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:/home/nasser/.local/bin
ExecStart=/usr/bin/node --enable-source-maps $APP_ROOT/current/server/index.mjs
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now idea-stream-db.service
export PGPASSWORD
PGPASSWORD=$(cat "$APP_ROOT/private/database-password")
for attempt in {1..30}; do "$PG_BIN/pg_isready" -h 127.0.0.1 -p 55432 -U idea_stream >/dev/null && break; sleep 1; done
if ! "$PG_BIN/psql" -h 127.0.0.1 -p 55432 -U idea_stream -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='idea_stream'" | grep -qx 1; then
  "$PG_BIN/createdb" -h 127.0.0.1 -p 55432 -U idea_stream idea_stream
fi
set -a
. "$APP_ROOT/private/app.env"
set +a
"$PG_BIN/psql" "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$APP_ROOT/repo/deploy/vps/initial-schema.sql"
"$PG_BIN/psql" "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$APP_ROOT/repo/lib/db/migrations/20260921_recording_capture.sql"
printf 'Isolated database and service configuration are ready. No Nginx or main-app files changed.\n'
