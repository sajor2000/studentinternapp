# RHEAS Intern AI Chat

Planning and application repository for a low-cost web portal that helps 6 summer interns create aldermanic ward health snapshot artifacts from a static HealthMap-style PostgreSQL database, get SQL/Python/R/Jupyter/marimo coding help through a server-side Microsoft Foundry API proxy, upload files to per-user private Blob storage, and publish reviewed analysis artifacts.

## Current product direction

- **Users:** 6 predefined intern accounts plus admin.
- **Auth:** no public signup; server-side username/password login backed by a Neon metadata table with bcrypt password hashes and HTTP-only signed session cookies.
- **Data:** Chicago Health Map uses a de-identified, static, read-only database copy. Approved PHI file work can use Azure Blob private uploads for CSV, XLSX, Parquet, Jupyter notebooks, Python/R/Quarto source files, HTML, Word, and PowerPoint files: the app coaches coding and analysis with the minimum PHI needed for the task and masks direct identifier values that are not needed before model calls.
- **Database hosting target:** Neon Free if the loaded database fits the free limits.
- **Frontend hosting target:** Vercel Hobby for prototype only; Vercel Pro if this is run as an institutional/non-personal program.
- **Frontend:** Native Next.js App Router and Vercel AI SDK chat interface on Vercel. Keep interns inside the portal; do not require them to manage API keys or model routes.
- **AI provider:** Microsoft Foundry/Azure AI via Vercel AI SDK server routes only; `/api/chat` streams the native chat UI and `/api/ai` handles authenticated non-chat generation automation. OpenAI env vars remain only as a local development fallback; production and Vercel runtimes reject OpenAI routing.
- **Model routing:** use Azure `gpt-5.3-codex` as the default workhorse for intern-facing portal tasks and most plugin skills, `gpt-5.4-mini` only for lightweight utility work, `gpt-5.4` for complex analysis, and `gpt-5.5` only for premium final review.
- **Model cost controls:** `AI_MAX_MODEL_TIER` can cap routing server-side, `AI_CHAT_ENABLED=false` stops `/api/chat`, `AI_MAX_CHAT_MESSAGES` / `AI_MAX_CHAT_TEXT_CHARS` reject oversized prompts before schema or model work, and `AI_RATE_LIMIT_*` throttles authenticated AI requests before provider calls.
- **Admin cost visibility:** the admin usage panel reports 30-day spend, month-to-date model spend, today's per-user spend, and budget warnings when configured daily or monthly limits reach 80% or more.
- **Database client:** Neon serverless driver using server-side `READONLY_DATABASE_URL` for schema context.
- **Schema context:** static HealthMap schema and ward summaries are cached server-side with `SCHEMA_CACHE_TTL_SECONDS` to reduce repeated Neon catalog reads.
- **Live-DB parity source:** `/Users/JCR/Downloads/Other/healthmap_azure_dev_live_2026-06-25.dump`; restore it into Neon as the native `public` schema.
- **Embedded skills:** Ward Snapshot artifact skills plus the full 27-skill Compound Engineering plugin catalog are available directly in the chat UI.
- **External docs MCP:** Context7 MCP is allowed for generic public library/framework documentation lookups only. Do not send PHI, PII, credentials, database URLs, row-level records, private source code, private file names, or controlled HealthMap data values to Context7.
- **CE workspace docs:** brainstorms, plans, work logs, reviews, and compound learnings are stored per intern/project in portal metadata; private by default, admin-visible, and promotable to shared cohort-safe learnings.
- **Artifact preview and publishing:** generated fenced HTML artifacts open in a sandboxed side panel. All uploaded files go to private Azure Blob paths owned by the signed-in user. Uploaded HTML, Word, and PowerPoint files become private draft artifact records that owners/admins can publish to the cohort.
- **Intern workflow:** guided ward snapshot builder, SQL explanation, saved dataset recipes, Word/PPT/HTML artifact drafts, deterministic Python/R/Jupyter/marimo recipe starters, approved local or Rush-machine notebooks, exported HTML reports, and approved PHI-scrubbed data, notebook, and code files uploaded to private Azure Blob storage.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Generate the six intern accounts plus admin:

```bash
npm run generate-users
```

The generator prints a ready-to-set `INTERN_USERS_JSON` value plus one-time
temporary passwords. Do not commit the output. Store the temporary passwords in
an approved handoff path, set `INTERN_USERS_JSON` in Vercel/server env, and then
rotate as needed. By default it creates three `neon` interns, three `phi_local`
interns, and one `dual` admin. Custom counts must still create at least six
interns with at least one Neon-enabled intern and one PHI-local intern. You can
also run `npm run generate-users -- --smoke-env` to print runtime smoke exports
for the generated Neon, PHI-local, and admin accounts. Still hash an individual
replacement password with
`npm run hash-password -- 'temporary-password-here'`.

3. `INTERN_USERS_JSON` must contain password hashes only:

```bash
INTERN_USERS_JSON='[{"username":"intern01","displayName":"Intern 01","role":"intern","workflowMode":"neon","passwordHash":"$2b$..."},{"username":"intern02","displayName":"Intern 02","role":"intern","workflowMode":"phi_local","passwordHash":"$2b$..."},{"username":"admin","displayName":"Admin","role":"admin","workflowMode":"dual","passwordHash":"$2b$..."}]'
```

4. Add `DATABASE_URL`, then initialize the app-private tables and seed the Neon user table:

```bash
npm run init-app-db
npm run seed-users
```

This creates `app_private.intern_users`, `app_private.ai_usage_logs`, `app_private.query_runs`, `app_private.dataset_recipes`, `app_private.chat_sessions`, `app_private.workspace_docs`, and `app_private.file_uploads`, then upserts users into `app_private.intern_users`. Each user can be seeded with `workflowMode`: `neon` for HealthMap/Neon work, `phi_local` for PHI-scrubbed local/Rush-machine notebook workflows, or `dual` for both. Runtime chat requests only read/insert usage rows, query metadata, dataset recipes, chat session metadata, CE workspace documents, and upload metadata; they do not create tables. After Neon auth is seeded, leave `AUTH_ALLOW_ENV_FALLBACK="false"` for deployment so disabled Neon users cannot sign in through stale env data.
`seed-users` refuses to seed a deployment account list unless it includes at
least one active admin, at least six active interns, at least one Neon-enabled
intern, and at least one PHI-local intern.
Login attempts are throttled by client IP and username. Use
`LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_RATE_LIMIT_WINDOW_SECONDS`, and
`LOGIN_LOCK_SECONDS` to tune the default five failed attempts within 15 minutes
followed by a 15-minute lockout. `LOGIN_REQUEST_MAX_BYTES` rejects oversized
credential JSON before parsing.

Run `npm run init-app-db` again after artifact workflow changes. The script is
idempotent and adds metadata columns for artifact kind, visibility, display name,
project label, and publish timestamps.

5. Add server-side database/model env vars, then run:

```bash
npm run preflight
npm run dev
```

For local checks without real secrets, run `npm run test:local` and `npm run preflight -- --allow-missing-secrets`. `test:local` verifies SQL safety, model routing, and upload invariants. Vercel uses `npm run build:vercel`, which runs strict `npm run preflight` before `next build` so missing Foundry, Neon, Blob, user-mode, and budget settings fail before interns use the app.

After deployment, `SMOKE_TEST_PUBLIC=1 npm run smoke:runtime` verifies
credential-free auth barriers: oversized login rejection; unauthenticated GET
and POST blocks for schema, wards, query preview, upload target/completion,
file open/list, artifact save/open/list/update, chat, non-chat AI, saved chat
sessions, dataset recipes, CE workspace docs, and admin usage; plus cross-site
POST rejection for state-changing login, logout, chat, AI, upload, artifact,
recipe, workspace document, and query-preview routes.
Then run `npm run smoke:runtime` with `APP_BASE_URL`, `SMOKE_NEON_*`,
`SMOKE_PHI_*`, and `SMOKE_ADMIN_*` credentials. The seeded smoke checks login,
workflow mode, schema access, SELECT-only preview, PHI-local Neon blocking,
unsafe SQL blocking, dataset recipe save/list/admin listing, private chat session
save/list isolation, CE workspace document isolation/shared-learning visibility,
and admin usage visibility. Add `SMOKE_TEST_UPLOAD=1` to verify per-user Blob
upload, owner download, cross-intern blocking, admin file access, authenticated
download/header isolation, and generated HTML artifact private owner/admin
access, cross-intern list/open blocking, and cohort publish/list isolation; add
`SMOKE_TEST_CHAT=1` to verify the server-side
Foundry/Azure chat stream and authenticated `/api/ai` generation route. If
required smoke credentials are missing, the script reports the complete missing
variable list before making any login request.

## Azure Blob uploads

Azure Blob is the selected storage path for controlled file uploads and final artifacts.
The app does not expose the storage connection string to the browser. Instead, an
authenticated API route creates a short-lived, upload-only SAS URL for one private
blob path. The browser uploads directly to Azure, and the chat receives only
minimal file metadata plus the private metadata record id; Blob paths and
original filenames are not appended to model prompts or retained in completed
upload chat state.

Uploaded CSV, XLSX, Parquet, Jupyter notebook, Python, R, R Markdown, and Quarto
files are tracked as private file records and are accepted only for accounts with
`phi_local` or `dual` workflow access. Uploaded HTML, Word, and PowerPoint files
are tracked as private draft artifacts for any authenticated workflow account.
Owners and admins can publish draft artifacts to cohort visibility from the
right pane after confirming review; publishing updates Neon metadata and does
not make the entire Blob container public.
Published artifacts open through an authenticated app route that checks owner,
admin, or cohort visibility before streaming the private Blob object. Uploaded
HTML previews render inside a sandboxed iframe; Word and PowerPoint artifacts open
as downloads.

All uploaded file metadata is available through the authenticated `/api/files`
route for the signed-in owner, or for admins across users. Owners and admins can
download private uploads through `/api/files/open`; responses are attachments, so
uploaded HTML is not executed through the private-file route. The artifact gallery
uses `/api/artifacts` and intentionally excludes private data files from cohort
sharing. The artifact publish/update API also rejects `data_file` records so
private analysis inputs cannot be repurposed through artifact workflows. The chat
output pane shows a private file library for uploaded data, notebook, and code
files and a separate artifact library for HTML, Word, and PowerPoint outputs.
Private file records also expose deterministic Python, R, Jupyter, and marimo
local starter templates that read from a local path placeholder after the file is
downloaded to an approved local or Rush machine.
Upload completion requires the Neon metadata database; if metadata cannot be
recorded after Azure owner verification, the app removes the uploaded blob and
returns an error instead of leaving an unlisted private file.
Upload target creation also requires the metadata database, so the app does not
issue a browser SAS URL for a file it cannot later list, open, or audit.
File and artifact listings also return a configuration error when metadata is
unavailable, so broken storage setup is visible during testing and deployment.
Completed upload chips use generated metadata labels, not original local
filenames that may contain identifiers.

Required env vars:

```bash
AZURE_STORAGE_CONNECTION_STRING=""
AZURE_STORAGE_CONTAINER="summer-intern-uploads"
AZURE_UPLOAD_MAX_BYTES="104857600"
AZURE_UPLOAD_METADATA_MAX_BYTES="16384"
AZURE_UPLOAD_SAS_MINUTES="10" # direct-upload SAS expiry, 1-15 minutes
```

## Model price configuration

Deployment must set per-tier Azure/Foundry price estimates in USD per 1M tokens.
These values are used only for budget checks and admin cost summaries; interns do
not see or manage model routes or keys.

```bash
AZURE_AI_CHEAP_INPUT_USD_PER_1M=""
AZURE_AI_CHEAP_OUTPUT_USD_PER_1M=""
AZURE_AI_DEFAULT_INPUT_USD_PER_1M=""
AZURE_AI_DEFAULT_OUTPUT_USD_PER_1M=""
AZURE_AI_CODE_INPUT_USD_PER_1M=""
AZURE_AI_CODE_OUTPUT_USD_PER_1M=""
AZURE_AI_STRONG_INPUT_USD_PER_1M=""
AZURE_AI_STRONG_OUTPUT_USD_PER_1M=""
AZURE_AI_PREMIUM_INPUT_USD_PER_1M=""
AZURE_AI_PREMIUM_OUTPUT_USD_PER_1M=""
```

Use the actual Rush/Azure agreement prices for the region and deployment type.
The app keeps model routing server-side and estimates cost from the selected
route, input tokens, and output tokens.

Set `AI_MAX_MODEL_TIER` when you need an admin-controlled cap without changing
the intern UI:

```bash
AI_CHAT_ENABLED="true"      # normal chat operation
AI_CHAT_ENABLED="false"     # emergency stop for model calls
AI_MAX_CHAT_MESSAGES="40"   # reject long chat histories before model calls
AI_MAX_CHAT_TEXT_CHARS="20000" # reject oversized pasted prompts before model calls
AI_RATE_LIMIT_REQUESTS="20" # per-user authenticated AI requests per window
AI_RATE_LIMIT_WINDOW_SECONDS="60"
AI_MAX_MODEL_TIER="premium" # normal routing
AI_MAX_MODEL_TIER="code"    # disable strong/premium escalation
AI_MAX_MODEL_TIER="cheap"   # emergency low-cost mode
```

Query previews are also per-user throttled with `QUERY_RATE_LIMIT_REQUESTS` and
`QUERY_RATE_LIMIT_WINDOW_SECONDS` before any read-only SQL is executed. Blob
upload targets and generated HTML artifact saves are per-user throttled with
`UPLOAD_RATE_LIMIT_REQUESTS` and `UPLOAD_RATE_LIMIT_WINDOW_SECONDS` before new
Blob write opportunities are created. Metadata save routes also reject oversized
JSON before parsing with `APP_METADATA_MAX_BYTES`,
`ARTIFACT_METADATA_MAX_BYTES`, and `AZURE_UPLOAD_METADATA_MAX_BYTES`.

## Context7 documentation lookup

The chat route can use Context7 server-side for current public library and framework documentation. This is for docs only, not project data. It is disabled unless explicitly enabled:

```bash
CONTEXT7_ENABLED="true"
CONTEXT7_API_KEY=""
```

Set these as Vercel environment variables, not browser-exposed variables. `CONTEXT7_API_KEY` is required when `CONTEXT7_ENABLED=true`; use a free Context7 key if appropriate. The route blocks sensitive-looking Context7 queries and the system prompt instructs the model to use generic documentation lookups only.

Current Azure target:

```text
Resource group: RU-A-Prod-RHEADS-RG
Storage account: rheasinternblob
Container: summer-intern-uploads
```

Azure storage account requirements:

- Keep the container private. Do not enable public blob or container access.
- Configure Azure Storage CORS for the app origins, for example `http://localhost:3000`
  and the production Vercel URL. Allow method `PUT`; allow headers `content-type`,
  `x-ms-blob-type`, and `x-ms-meta-*`; expose `etag` if you later add completion checks.
- Use a storage account and Azure subscription covered by the organization’s Microsoft
  Business Associate Agreement before putting PHI in the container.
- Keep encryption at rest enabled and restrict access to the storage account/key.
- Rotate the storage key if it is exposed and prefer a dedicated storage account for
  this internship workflow.

This is HIPAA-ready plumbing, not a compliance guarantee by itself. Microsoft documents
that Azure can support HIPAA/HITECH obligations through in-scope services and a BAA,
but the tenant configuration, access policy, audit controls, retention, and user
training still determine whether the workflow is compliant.

## Neon live-DB parity

Use one private local env file for both Codex and Claude Code:

```bash
npm run neon:access-init
```

Fill `/Users/JCR/.config/healthmap-neon/env` with the direct owner URL and pooled read-only URL from Neon. Then validate and sync the repo-local ignored env:

```bash
npm run neon:access-status
npm run neon:access-sync -- --yes
npm run neon:access-check
```

The exact Neon teaching copy should be restored from the live `pg_dump`, not regenerated from CSV/Parquet:

```bash
npm run db:inspect-dump -- "/Users/JCR/Downloads/Other/healthmap_azure_dev_live_2026-06-25.dump" --count-rows

npm run db:restore-neon -- "/Users/JCR/Downloads/Other/healthmap_azure_dev_live_2026-06-25.dump" --yes

npm run db:verify-neon -- "/Users/JCR/Downloads/Other/healthmap_azure_dev_live_2026-06-25.dump"
```

Use Neon's direct, unpooled URL for restore and verification. Use `READONLY_DATABASE_URL` with the `intern_reader` role for the app; preflight rejects obvious owner/admin/loader/write/service-role usernames, and `npm run db:verify-neon` should still confirm the role cannot write before intern access. `db:verify-neon` also fails by default when the restored database exceeds the configured 500 MB Neon Free fit check; pass `-- --max-database-bytes 0` only when an approved paid or curated database path replaces the free-tier gate.

Current verified state, checked 2026-06-25:

- Neon project `misty-bonus-94904719`, production branch, database `neondb`.
- Source database: readable Azure `healthmap_dev`; current account cannot read user tables in `healthmap_prod`.
- Active schema: `public`.
- HealthMap user tables: 34.
- Required extensions: `postgis`, `pg_trgm`, `plpgsql`.
- Restored database size: about 283 MB, which keeps the project within Neon Free's 500 MB limit.
- `intern_reader` uses the pooled read-only URL and passes write-block verification.

## Repository map

```text
AGENTS.md                                      Coding-agent operating rules
CLAUDE.md                                      Claude-specific project context
agent.md                                      Human-readable agent/product brief
.env.example                                  Environment variable template
docs/brainstorms/summer-intern-portal-requirements.md
docs/audits/2026-06-25-pre-scaffold-audit.md
docs/audits/pre-scaffold-audit-checklist.md
docs/planning/mvp-plan.md
docs/architecture/free-tier-tech-stack-research.md
docs/architecture/system-architecture.md
docs/security/security-model.md
docs/runbooks/data-migration.md
docs/runbooks/deployment.md
app/                                          Next.js App Router portal shell
tools/import_healthmap_archive.py             HealthMap archive import helper
tools/neon_healthmap_sync.py                  Neon pg_dump restore and parity verifier
```

## Non-negotiable constraints

1. Never expose Microsoft Foundry/Azure API keys in frontend JavaScript.
2. Never give interns write access to the teaching database.
3. Treat de-identified data as controlled research data, not public data.
4. Store intern passwords as hashes only.
5. Log token and query metadata, but avoid logging raw row-level result data.
6. Use local Python/R/Jupyter/marimo for full analysis execution; the portal should do small previews and guided code generation.
7. For PHI file projects, use only approved secure storage and local/approved compute. Share the minimum context needed for correct code; prefer schema, structure, and masked examples when original values are not needed.
8. `/api/chat` masks likely direct identifier values before model calls when they are not necessary for the coding task. It does not hard-block PHI prompts. This is defense-in-depth, not a substitute for project approval or HIPAA review.
9. Use Context7 MCP only for public documentation lookups with generic, redacted queries. Keep `CONTEXT7_API_KEY` in local MCP configuration or local environment only; never commit it.

## Recommended MVP stack

```text
Next.js on Vercel
  + Neon-backed custom credentials auth
  + bcrypt password hashes for MVP seeding
  + Vercel AI SDK chat route
  + server-side Foundry/Azure provider
  + cheap/default/code/strong/premium model routing by task
  + chat-first ward snapshot artifact UI

Neon Postgres Free, if dataset <= free storage limit
  + static HealthMap copy
  + app metadata tables
  + read-only query role
  + server-side schema context through @neondatabase/serverless
  + app_private.ai_usage_logs for model usage and budget checks

Azure Blob Storage
  + private controlled file uploads
  + final HTML/Word/PowerPoint artifacts
  + short-lived upload-only SAS URLs issued by the server

Local intern PCs
  + Python/R
  + marimo notebooks
  + optional CSV/Parquet downloads
```

See `docs/architecture/free-tier-tech-stack-research.md` for the pricing and hosting comparison.
