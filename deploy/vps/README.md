# Hostinger: Idea Stream at /ideas

This setup leaves the existing main app, its /api routes, and its database untouched. Idea Stream runs as user `nasser`, listens on `127.0.0.1:5185`, and has a separate PostgreSQL cluster on `127.0.0.1:55432`. The only shared-server change is a new Nginx location for `/ideas/` and an exact redirect from `/ideas`.

## Initial setup

The checkout lives at `/home/nasser/apps/idea-stream/repo`. Its locked dependencies use a dedicated pnpm 11.25.0 installed in the sibling `tooling` directory. Secrets, uploads, PostgreSQL data, and backups stay outside the Git checkout with private permissions.

As `nasser`, run:

```sh
bash /home/nasser/apps/idea-stream/repo/deploy/vps/bootstrap.sh
bash /home/nasser/apps/idea-stream/repo/deploy/vps/update.sh
```

Then, once the loopback app is healthy, activate the new route:

```sh
sudo python3 /home/nasser/apps/idea-stream/repo/deploy/vps/activate-nginx.py
```

The activation script backs up the original Nginx configuration, adds only the new include, checks `nginx -t`, gracefully reloads Nginx, compares the main homepage hash, and verifies the Idea Stream password gate. On a failed check it restores the original configuration. It does not restart the main app.

## Sign in and configure AI

The initial username is `nasser`. Read the generated password in your SSH terminal:

```sh
cat /home/nasser/apps/idea-stream/private/initial-password.txt
```

This is a separate application password, not the VPS sudo password. It protects the entire app and uploads over HTTPS. This gate is for one owner; it does not implement separate accounts or shared notebooks. Local browser recordings are available to people using that same browser profile.

Notes, recordings, and uploads work without an AI key. To enable real transcription and writing, edit the private `app.env` file and add `OPENAI_API_KEY`. Do not place it in Git or a frontend Vite variable. Optionally set `OPENAI_TEXT_MODEL` and `OPENAI_BASE_URL`. Restart only Idea Stream:

```sh
systemctl --user restart idea-stream.service
```

The direct API default is `gpt-4.1-mini`, which supports Chat Completions ([official model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini)). Existing Replit configurations retain their provider/model behavior. If AI is unavailable, the UI says so and keeps original recordings.

## Future updates: local → GitHub → VPS

After committing and pushing local changes to `main`:

```sh
ssh nasser@76.13.243.173
bash /home/nasser/apps/idea-stream/repo/deploy/vps/update.sh
```

The updater refuses dirty checkouts, pulls with `--ff-only`, installs the lockfile, typechecks/tests/builds on the VPS, backs up the dedicated database, creates a release, and restarts only Idea Stream. Failed health checks restore the previous release. Existing releases are retained; periodically review old releases and backups rather than deleting them blindly. Future incompatible database changes need their own reviewed migrations; do not automatically run destructive schema synchronization.

## Operational notes

- The web service uses `Wants=idea-stream-db.service` with startup ordering. A database restart must not stop the web service: `Requires=` propagates a database stop to the app, and `Restart=on-failure` does not recover that dependency-driven stop. The database service still starts automatically and the connection pool reconnects after recovery.
- A 502 means Nginx could not reach the app. Check both service logs for forced exits or `oom-kill`. Server-wide memory exhaustion can also kill the user service manager; app restart settings cannot fully protect against this. Reading kernel OOM logs requires administrator access: `sudo journalctl -k --since "2 hours ago" --no-pager -g 'oom|Out of memory|Killed process'`. Diagnose the memory-consuming workload before changing other applications.
- `systemctl --user status idea-stream idea-stream-db` shows the two isolated services. `journalctl --user -u idea-stream -n 100` shows app logs.
- Uploads live in `/home/nasser/apps/idea-stream/uploads`, independent of builds. They use signed, bounded upload URLs; files are published after the full upload completes.
- Database backups are under `/home/nasser/apps/idea-stream/backups`. These are on the same VPS: copy database backups and uploads to your own separate backup destination for disaster recovery.
- Keep the private password file and `APP_PASSWORD_HASH` synchronized if changing credentials; the health check uses that file. Do not reuse your SSH password.
- `ffmpeg` is needed for audio conversion. YouTube captions require `yt-dlp`; PDF/DOC extraction needs `pdftotext`/`antiword`/`unzip`; PDF export needs Chromium. Missing optional utilities affect those features, not ordinary notes and recording uploads.
- The service worker stays scoped to `/ideas/` and excludes both `/api/` and `/ideas/api/`. It cannot take control of the main website.
