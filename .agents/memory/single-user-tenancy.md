---
name: Single-user tenancy
description: Why Idea Stream currently uses authentication without record-level ownership.
---

Idea Stream is intentionally a single-user personal application. Clerk protects access, but subjects, ideas, stored attachments, and idea chats do not currently carry per-user ownership fields.

**Why:** The product was explicitly scoped as a single-user authentication gate, and existing records were not migrated to ownership fields.

**How to apply:** Preserve this model for personal use. Before allowing multiple users or sharing the deployment, add ownership to subjects and enforce it transitively across ideas, chats, compilations, and private attachment access.