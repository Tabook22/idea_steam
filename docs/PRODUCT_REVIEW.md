# Product review — Idea Stream

## Product direction

The strongest version of this product is a notebook that helps thoughts mature into work. Its central journey should be **capture → develop → create → review**. Capture must be immediate; organization can follow later. Generated work should remain connected to its original ideas and source material.

## What is already here

The application is a React/Vite frontend backed by Express, PostgreSQL, Drizzle, and generated OpenAPI clients. It already provides subject notebooks, timestamped ideas, editable voice transcripts and audio references, media/document/link attachments, English and Arabic interfaces, per-idea AI conversations, and several output formats. Drafts can be edited, annotated in a reader, and exported to Word or PDF through the backend.

This is a substantial starting point. The main product problem was discoverability and continuity: a user first created a subject, then found the capture controls, then navigated a large output dropdown. Switching capture tabs discarded unfinished text. The list of notebooks did not refresh its idea counts after capture. Generation used the main idea text but omitted attachment transcripts and notes.

## Implemented in this enhancement

- Replaced the generic home hero with a creative workspace: a quiet sidebar, warm paper palette, original CSS notebook illustration, recent notebooks, colored notebook cards, and a creation studio.
- Added text and link shortcuts into an Idea inbox, plus a dedicated voice recorder that starts without a network request or subject selection.
- Kept notebook search, sorting, list/card views, and confirmed deletion. The default sort now uses the latest update time. Empty states offer a useful next action.
- Preserved text across capture modes and recovered unfinished text/link fields from local storage. Switching modes keeps uploaded sources in the same session, and all those sources are included when saving.
- Added a persistent recorder with IndexedDB chunk storage, interrupted-session recovery, original-audio playback/download, upload checkpoints and retry IDs, timed stopping, optional spoken subject routing, and later notebook assignment. Typed drafts stay separate from automatically saved voice ideas. Recording continues during in-app navigation.
- Connected YouTube caption extraction directly to link capture, with editable imported text and a fallback message when captions are unavailable. The original link and transcript remain attached.
- Added dedicated YouTube and broadcast/podcast formats to the contract, generated types, validators, interface, and generation instructions. The homepage can carry a selected format into a chosen notebook's studio.
- Included available attachment notes, transcripts, extracted document text, and source URLs in compilation context. Unread attachments are identified as unread rather than treated as evidence.
- Improved keyboard access to notebook editing, labels and selected states, Arabic dialog alignment, mobile layout, loading failures, and reduced-motion behavior. The draft editor loads separately from the initial workspace.
- Added strict YouTube URL normalization and tests, a labeled preview with synthetic data, Windows build dependencies, and portable package scripts.

## Highest-value next improvements

| Priority          | Improvement                       | Why it matters                                                                        | Suggested implementation                                                                                                                                                                         |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Before public use | Private accounts and ownership    | Current API routes and upload endpoints are open; records have no per-user isolation. | Add server-enforced authentication, owner IDs, ownership checks on every read/write/export, scoped storage access, rate limits, and an explicit CORS allowlist.                                  |
| Later             | Native voice capture              | Browser screen locks and calls can interrupt recording.                               | Add native shortcuts and supported car integration; validate on real phones. IndexedDB recovery and retries are now implemented.                                                                 |
| Next              | Connect ideas                     | Single-idea moves are now implemented; related ideas still need richer organization.  | Add multi-select actions, tags, and explicit links between ideas.                                                                                                                                |
| Next              | A writing brief before generation | A format alone does not describe the user's intent.                                   | Ask for audience, purpose, target length, output language, and which ideas to include. Offer an outline before producing a full draft.                                                           |
| Next              | Research with traceable evidence  | An academic style is not a verified scientific paper.                                 | Track source title, author, URL/DOI, citation locations, and timestamps. Separate observations, hypotheses, and verified claims. Flag missing evidence; never manufacture citations or findings. |
| Later             | Idea connections and resurfacing  | Accumulation becomes more useful when older thoughts reappear at the right moment.    | Suggest related notes with a short explanation and links to the originals. Let users accept or reject grouping. Surface a few overlooked ideas rather than a noisy dashboard.                    |
| Later             | Draft history and project status  | Users need to know what changed and what is ready.                                    | Add draft versions and diffs, autosaved edits, and explicit collecting/outlining/drafting/ready states. Keep AI rewrites reversible.                                                             |

## Remaining limits

Text recovery is local to a browser and notebook; it is neither encrypted storage nor cross-device synchronization. Unsaved attachment references from manual uploads are not restored after closing the form. Recorder audio is stored in IndexedDB and retained across reloads, but browser eviction or clearing site data can erase local copies. Recovery preserves chunks already committed, not audio that the browser had not delivered. Download important recordings. The current extraction pipeline still depends on external tools and caption availability. Long recordings need chunked upload/transcription; the API has a 20 MB JSON request limit.

The inbox is currently an ordinary notebook identified by its default English/Arabic title. A durable system-inbox identifier and database uniqueness constraint would be preferable once accounts and notebook metadata are added.

Compilation now sees attachment content but still needs a total input budget, source selection, and a staged summarization strategy for very large collections. Existing rich-text draft editing does not yet provide persistent version history or reliable autosave across every editing surface.

## Validation

The interface was exercised in a labeled local preview with synthetic data: quick capture creates/reuses the inbox; text survives mode changes and closing/reopening; saving refreshes counts; a YouTube link exposes caption import; imported text saves; selecting a YouTube output opens the correct notebook with that format selected; and a simulated generation opens an editable draft. Arabic desktop and 390-pixel mobile layouts were inspected, with no horizontal overflow in the mobile workspace.

Actual database persistence, microphone capture, real transcription, real YouTube captions, uploads, AI generation quality, and Word/PDF exports require configured services and were not verified end to end in this checkout. Preview responses must not be mistaken for those integrations working in production.

Final verification: the complete `pnpm run build` succeeded (library and application type checks plus all workspace builds), and `pnpm run test:youtube-url` passed both test groups. The production frontend still reports a bundle-size advisory for its main JavaScript chunk; further route/vendor splitting is a performance follow-up. The browser reported no console errors during the final preview check. Search recovery and whitespace-only notebook-title rejection were also verified.

## Recording follow-up validation

The full workspace build and all 12 automated tests passed. A browser test used a synthetic MediaStream through the real MediaRecorder pipeline: local capture survived reopening during a simulated API outage, the resulting audio reached playable readyState 4, reconnect/retry synced to the preview inbox, and both recorder assignment and the idea's move dialog changed notebooks while retaining the audio. Physical microphone behavior, phone lock-screen recording, real AI/storage services, and live PostgreSQL concurrency still require validation in the deployment environment. Apply the included capture-ID migration before running the updated real API.
