# CLAUDE.md goals readiness audit

Date: 2026-06-25

Scope: current local app state in this repository, checked against `CLAUDE.md`,
`docs/planning/mvp-plan.md`, `docs/architecture/system-architecture.md`,
`docs/security/security-model.md`, `README.md`, and implemented files under
`app/`, `components/`, and `tools/`.

## Executive Status

Overall readiness: partial MVP, not intern-pilot ready.

The app now has a credible secure foundation: fixed-user Neon auth, server-side
Foundry/Azure chat, HealthMap schema/ward context through read-only Neon access,
token logging and budget checks, Azure Blob upload, private artifact metadata,
publish/share controls, and an authenticated artifact open route.

The largest remaining gaps are the dataset-builder workflow and admin dashboard:
there is no `/api/query-preview`, SQL safety validator, saved dataset recipe
API, dedicated SQL explanation/preview UI, or admin usage dashboard. Those are
core `CLAUDE.md` goals and MVP acceptance criteria, so the app should not be
treated as complete for summer interns yet.

## Goal Matrix

| CLAUDE.md goal or constraint | Status | Evidence | Notes |
|---|---|---|---|
| Low-cost web app for six interns | Partial | `app/`, `README.md`, `docs/runbooks/deployment.md` | Next.js/Vercel-oriented app exists; Vercel production project is not linked yet. |
| Static read-only PostgreSQL teaching database | Mostly met | `app/lib/db.ts`, `app/api/schema/route.ts`, `app/api/wards/route.ts`, `tools/neon_healthmap_sync.py` | App uses `READONLY_DATABASE_URL` for schema/ward routes; query preview route is missing. |
| Server-side Foundry/Azure API proxy | Met | `app/api/chat/route.ts`, `app/lib/ai-model.ts` | Browser does not call Foundry directly; chat route owns model selection. |
| Foundry/Azure key never exposed to browser | Met in code | `app/api/chat/route.ts`, `app/lib/ai-model.ts`, `.gitignore` | Secrets are server env vars. Local `.env.local` contains real secrets and must stay uncommitted. |
| Predefined users, no public signup | Met | `app/lib/auth.ts`, `app/api/login/route.ts`, `tools/seed_neon_users.mjs` | Neon-backed username/password login with env fallback disabled for deployment. |
| Passwords hashed | Met | `tools/hash_password.mjs`, `tools/seed_neon_users.mjs`, `app/lib/auth.ts` | Uses bcrypt hashes and `bcrypt.compare`. |
| Interns can discover tables/columns | Partial | `app/api/schema/route.ts`, `components/chat/shell.tsx` | Schema endpoint and right-pane schema summary exist; no full schema browser page yet. |
| Interns can ask for datasets in plain English | Partial | `components/chat/shell.tsx`, `app/api/chat/route.ts` | Chat supports this, but there is no structured dataset request form or saved recipe flow. |
| Assistant generates/explains safe SQL | Partial | `app/api/chat/route.ts`, `app/data/student-agent-guide.ts` | Prompt instructs SELECT-only SQL with LIMIT and row grain, but there is no SQL validator/execution contract. |
| Limited read-only query preview | Missing | No `app/api/query-preview` route | Core MVP gap. |
| Saved reusable dataset recipes | Missing | No `app/api/dataset-recipes` route or metadata table | Core MVP gap. |
| Generate Python/R/marimo starter code | Partial | `app/api/chat/route.ts`, `app/data/student-agent-guide.ts` | Chat can generate code; no dedicated recipe-to-code workflow or persisted outputs. |
| Upload/publish HTML artifacts | Met for upload/open/publish metadata | `app/api/files/upload-url/route.ts`, `app/api/files/complete/route.ts`, `app/api/artifacts/route.ts`, `app/api/artifacts/open/route.ts` | Private Azure Blob upload and authenticated artifact open route exist. |
| Track token usage by intern | Met for chat usage logs | `app/lib/usage.ts`, `tools/init_app_private.mjs` | Logs model/tokens/cost/status and enforces daily/monthly budgets. |
| Track query activity by intern | Missing | No query preview or query log route | Depends on dataset-builder work. |
| Admin can view usage/output | Partial | `app/api/artifacts/route.ts`, `app/lib/usage.ts` | Admin can receive all artifact metadata through API; no admin dashboard UI/API for usage. |
| De-identified data treated as controlled | Mostly met | `docs/security/security-model.md`, `app/lib/pii-guard.ts`, `app/api/chat/route.ts` | Prompt and PII guard reduce unnecessary identifiers; no formal compliance claim. |
| Full analysis runs locally in Python/R/marimo | Mostly met by guidance | `agent.md`, `app/api/chat/route.ts`, `app/data/student-agent-guide.ts` | Chat guidance steers interns to local/approved compute; no cloud Python execution. |
| Avoid full browser IDE/cloud Python | Met | App route list | No arbitrary code execution surface exists. |

## Security and Privacy Readiness

Ready foundations:

- Fixed users with hashed passwords and signed HTTP-only session cookie.
- Server-side Foundry/Azure calls only.
- `READONLY_DATABASE_URL` split from `DATABASE_URL`.
- PII guard masks common direct identifiers before model calls when not needed.
- Azure Blob container is private; app issues upload-only SAS URLs.
- Published artifact opening is authenticated and visibility-checked.
- Uploaded HTML is rendered in a sandboxed iframe.

Remaining concerns:

- `.env.local` contains real secrets locally. It is ignored by git, but any
  secrets exposed in logs or chat should be rotated before pilot use.
- Production Vercel origin has not been added to Azure Storage CORS because the
  Vercel project is not linked yet.
- No SQL validator or query preview route exists, so read-only SQL execution is
  not yet available to interns.
- No admin usage dashboard exists.

## MVP Gap List

### G1. Query preview and SQL safety

Missing:

- `app/api/query-preview/route.ts`
- SQL validator for single SELECT statement, blocked write/admin commands,
  enforced LIMIT, row cap, and timeout.
- Query activity logging.
- UI surface for preview results and SQL explanation.

Why it matters: `CLAUDE.md` says interns should preview small read-only results.
The database role is read-only, but the app still needs app-level SQL safety.

### G2. Dataset recipes

Missing:

- `app_private.dataset_recipes` or equivalent metadata table.
- `/api/dataset-recipes` create/list/update route.
- UI to save a natural-language request, SQL, row grain, and generated code.

Why it matters: saved reusable recipes are in the core product goal and MVP
acceptance criteria.

### G3. Admin usage dashboard

Missing:

- Admin-only usage route, such as `app/api/admin/usage/route.ts`.
- Admin UI for per-user token usage, query count, failed queries, exports, and
  budget warnings.

Why it matters: `CLAUDE.md` requires usage tracking by intern and admin
visibility before pilot.

### G4. Full schema browser and dataset-builder UI

Missing or partial:

- Full schema browser page or panel beyond the current compact summary.
- Dataset request form with row-grain prompts.
- Dedicated SQL explanation and preview panel.

Why it matters: the current chat can teach SQL, but interns who know little SQL
need explicit workflow scaffolding.

### G5. Pilot/deployment readiness

Missing:

- Vercel project linkage and production env var setup.
- Production Vercel origin in Azure Storage CORS.
- One end-to-end test intern workflow.
- Browser-network check confirming no secrets are exposed.

Why it matters: the local app builds, but it has not been verified as a deployed
intern pilot.

## Suggested Next Implementation Order

1. Build `/api/query-preview` and SQL safety validation.
2. Add query logging and basic admin usage route.
3. Add dataset recipe metadata and API.
4. Add a compact dataset-builder/preview UI in the existing chat right pane.
5. Add admin dashboard page for usage and artifacts.
6. Link/deploy to Vercel, add production CORS origin, and run pilot smoke tests.

## Verification Performed

- Inspected app routes and helpers under `app/`.
- Inspected active chat UI under `components/chat/shell.tsx`.
- Inspected setup scripts under `tools/`.
- Inspected `README.md`, `docs/security/security-model.md`,
  `docs/planning/mvp-plan.md`, and `docs/architecture/system-architecture.md`.
- Project verification is recorded in the LFG run summary after this audit.
