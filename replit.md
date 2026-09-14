# Idea Stream

A personal workspace for capturing ideas over time and compiling them into finished drafts.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/idea-stream` — React web application
- `artifacts/api-server/src/routes/idea-stream.ts` — subject, idea, and compilation API
- `lib/api-spec/openapi.yaml` — API contract
- `lib/db/src/schema/subjects.ts` and `ideas.ts` — persistent data model

## Architecture decisions

- Voice capture produces an editable transcript before saving so imperfect recognition can be corrected.
- AI compilation preserves the original fragments and stores the generated draft separately.
- Idea fragments are displayed newest-first, while AI compilation receives them oldest-first.

## Product

- Create, search, open, edit, and delete subjects.
- Add timestamped text or voice-transcribed idea fragments over time.
- Edit and delete individual fragments.
- Compile all fragments into an editable draft with clear, conversational, academic, or cinematic tone.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
