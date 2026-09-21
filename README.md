# Idea Stream

A bilingual creative notebook: capture text, voice, and source links; develop a stream of ideas; turn them into articles, research drafts, video scripts, or broadcasts.

## Try the design preview

Use Node.js 22.17+ (Node 24 recommended) and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm dev:preview
```

Open http://127.0.0.1:5173. Alternatively run `node scripts/preview.mjs` after installing dependencies.

The preview is explicitly labeled. It uses synthetic notebooks and an in-memory API on 127.0.0.1:5174. Text capture, notebook editing, link capture, and draft editing can be exercised. Caption imports and generated drafts are simulated. Recording uploads are held in memory and transcripts are clearly marked simulations. AI conversations and document exports require the real backend. Preview server records reset when the process stops; local recordings remain in a separate preview IndexedDB database. Unfinished capture text is stored in this browser; it is not a cloud backup. Do not enter sensitive material in the sample preview.

## Run with the real services

For Hostinger or another Linux VPS, use the isolated deployment described in [deploy/vps/README.md](deploy/vps/README.md). It supports `/ideas/`, a private password gate, its own PostgreSQL database, disk uploads, and an optional direct OpenAI API key. The Replit configuration below remains available for existing installations.

The current backend expects an existing PostgreSQL database, the Replit OpenAI integration, and Replit object storage. The frontend can run on Windows; the external backend services still need provisioning.

Configure these environment variables in the API server's environment:

- `PORT=5000`
- `DATABASE_URL`
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`
- `PRIVATE_OBJECT_DIR` and, when serving public assets, `PUBLIC_OBJECT_SEARCH_PATHS`

The storage implementation uses Replit's credential sidecar on localhost:1106. Supplying an arbitrary local directory does not replace that service. For deployment elsewhere, implement a storage adapter with that provider's credentials and signed URLs.

Then run in separate terminals:

```sh
pnpm --filter @workspace/api-server dev
pnpm --filter @workspace/idea-stream dev
```

The frontend defaults to port 5173 and proxies `/api` to localhost:5000. Set `API_PROXY_TARGET` to change the target. Keep frontend and backend `PORT` values separate. Existing deployments can still supply `BASE_PATH` and `PORT`.

Before deploying the recording API, apply `lib/db/migrations/20260921_recording_capture.sql` to the intended database. It adds a nullable, unique capture ID so retrying a recording does not create duplicate ideas. This migration has not been applied automatically. For a fresh development database, review the schema and use `pnpm --filter @workspace/db push`.

Optional backend tools used by existing features: `yt-dlp` for available YouTube captions (no video download), `pdftotext`, `antiword`, and `unzip` for document text, and `chromium` for PDF export. Transcription may also require the audio conversion tools used by the integration. These tools have not been installed by this UI update.

## Checks

```sh
pnpm typecheck
pnpm --filter @workspace/idea-stream build
pnpm --filter @workspace/api-server build
pnpm test:youtube-url
pnpm test:recording
pnpm --filter @workspace/api-spec codegen
```

The OpenAPI specification in `lib/api-spec/openapi.yaml` is the source of truth for generated client types and validators.

## Structure

- `artifacts/idea-stream`: React / Vite interface
- `artifacts/api-server`: Express API and source-processing routes
- `lib/db`: PostgreSQL / Drizzle schema
- `lib/api-spec`: OpenAPI contract and code generator
- `scripts/preview.mjs`: isolated design-preview server
- `docs/PRODUCT_REVIEW.md`: findings, changes, and proposed next steps

The default development API is unauthenticated. The VPS configuration adds a single-owner password gate. Add accounts, record ownership, storage authorization, and usage limits before turning this into a public multi-user service.

## Capture now, organize later

Open **Recorder & inbox** or **Record a thought**. Tap the microphone, speak, and stop. Audio chunks are written to IndexedDB during recording; stopping saves without a title or subject. The app retains the original after syncing, with playback and download in the recorder. Browser storage can be cleared or evicted; download important originals. Pending recordings retry while the app is open and connected, not while it is closed.

Choose a notebook later using **Save under**, or use **Move to notebook** on any idea. Its timestamp, audio, attachments, and conversation stay with it. Existing generated drafts do not change. Recording inside a notebook files directly into that notebook. Otherwise, a leading command such as “Save this under Education. My idea is…” or “احفظ في التعليم. فكرتي هي…” files into a single exact matching notebook after transcription. Ambiguous or missing matches go to the Idea inbox. This is transcript-based routing, not live voice control.

**Alt + R** starts/stops while the app has focus. The quick-start URL is /record?start=1&limit=60; it can be used in a bookmark or a phone's Open URL shortcut. Microphone permission and browser support are still required. Select automatic stop after 30 seconds, 1, 2, 5, or 15 minutes. Keep the page open. Use screen controls only when parked; this web app is not a native car/lock-screen recorder. Phone calls, screen locks, and browser suspension can interrupt recording. See [MediaRecorder browser behavior](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event).

Production builds register an offline service worker after the first successful visit. It caches the application shell only, never API responses or audio. HTTPS (or localhost) is required. Development preview does not install a service worker. Audio larger than 12 MB syncs without automatic transcription to stay within the existing JSON API limit.

### Recorder validation

pnpm test:recording checks chunk order, recovery, rescue replacement, explicit subject routing, upload checkpoints, retry IDs, transcript outages, and offline-shell cache isolation. A development-only browser fixture at /recorder-test.html provides generated audio and a simulated connection outage; it never opens a physical microphone. Use localhost for this fixture to keep its device database separate from the normal 127.0.0.1 preview. It is not included in the production build.
