---
name: YouTube transcript extraction
description: Reliable caption extraction behavior for YouTube attachments in this Replit environment.
---

Use `yt-dlp` subtitle downloads for YouTube transcript extraction rather than fetching caption-track `baseUrl` values directly.

**Why:** YouTube watch pages exposed caption-track URLs, but direct timed-text requests returned successful responses with empty bodies. `yt-dlp` successfully downloaded VTT captions in the same environment.

**How to apply:** Keep `yt-dlp` as a system dependency for transcript features. Treat partial subtitle-download failures as recoverable when at least one VTT file was produced, and report videos without available captions clearly.