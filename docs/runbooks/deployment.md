# Deployment Runbook

## Prototype deployment

Use this only for a proof of concept or demo:

```text
Vercel Hobby
Neon Free
Foundry/Azure token usage
```

Caveat: Vercel Hobby is intended for personal/non-commercial use. Confirm whether it is acceptable for your prototype. For an actual institutional summer intern deployment, use Vercel Pro unless cleared otherwise.

## Production-like internship deployment

Recommended low-cost setup:

```text
Vercel Pro for app hosting
Neon Free if database fits
Azure Blob in resource group RU-A-Prod-RHEADS-RG for uploads and artifacts
Microsoft Foundry/Azure AI paid by token usage
```

Azure target:

```text
Resource group: RU-A-Prod-RHEADS-RG
Storage account: rheasinternblob
Storage tier: Standard Hot, LRS to start
Container: summer-intern-uploads
Access: private container, short-lived per-blob SAS uploads only
```

## Environment variables

Set these in Vercel project settings, not in committed files:

```text
SESSION_SECRET
AUTH_ALLOW_ENV_FALLBACK=false
LOGIN_MAX_FAILED_ATTEMPTS=5
LOGIN_RATE_LIMIT_WINDOW_SECONDS=900
LOGIN_LOCK_SECONDS=900
LOGIN_REQUEST_MAX_BYTES=4096
DATABASE_URL
READONLY_DATABASE_URL
SCHEMA_CACHE_TTL_SECONDS=3600
AI_CHAT_ENABLED=true
AI_MAX_CHAT_MESSAGES=40
AI_MAX_CHAT_TEXT_CHARS=20000
AI_RATE_LIMIT_REQUESTS=20
AI_RATE_LIMIT_WINDOW_SECONDS=60
AI_PROVIDER=azure
AI_MAX_MODEL_TIER=premium
AZURE_AI_ENDPOINT=https://equityclaudeagent.cognitiveservices.azure.com
AZURE_AI_API_KEY
AZURE_AI_API_VERSION=2025-04-01-preview
AZURE_AI_CHEAP_DEPLOYMENT=gpt-5.4-mini
AZURE_AI_DEFAULT_DEPLOYMENT=gpt-5.3-codex
AZURE_AI_CODE_DEPLOYMENT=gpt-5.3-codex
AZURE_AI_STRONG_DEPLOYMENT=gpt-5.4
AZURE_AI_PREMIUM_DEPLOYMENT=gpt-5.5
AZURE_AI_CHEAP_INPUT_USD_PER_1M
AZURE_AI_CHEAP_OUTPUT_USD_PER_1M
AZURE_AI_DEFAULT_INPUT_USD_PER_1M
AZURE_AI_DEFAULT_OUTPUT_USD_PER_1M
AZURE_AI_CODE_INPUT_USD_PER_1M
AZURE_AI_CODE_OUTPUT_USD_PER_1M
AZURE_AI_STRONG_INPUT_USD_PER_1M
AZURE_AI_STRONG_OUTPUT_USD_PER_1M
AZURE_AI_PREMIUM_INPUT_USD_PER_1M
AZURE_AI_PREMIUM_OUTPUT_USD_PER_1M
AZURE_STORAGE_CONNECTION_STRING
AZURE_STORAGE_CONTAINER=summer-intern-uploads
CONTEXT7_ENABLED=false
CONTEXT7_API_KEY
PUBMED_MCP_ENABLED=false
PUBMED_MCP_URL=https://pubmed.caseyjhand.com/mcp
MONTHLY_TOKEN_BUDGET_USD
PER_USER_DAILY_BUDGET_USD
MAX_PREVIEW_ROWS
MAX_EXPORT_ROWS
QUERY_RATE_LIMIT_REQUESTS
QUERY_RATE_LIMIT_WINDOW_SECONDS
QUERY_TIMEOUT_MS
UPLOAD_RATE_LIMIT_REQUESTS=20
UPLOAD_RATE_LIMIT_WINDOW_SECONDS=300
APP_METADATA_MAX_BYTES=524288
ARTIFACT_METADATA_MAX_BYTES=16384
AZURE_UPLOAD_METADATA_MAX_BYTES=16384
AZURE_UPLOAD_MAX_BYTES=104857600
AZURE_UPLOAD_SAS_MINUTES=10 # direct-upload SAS expiry, 1-15 minutes
```

`SESSION_SECRET` must be a random value of at least 32 characters. The example
placeholder is rejected by both preflight and runtime session signing.

`READONLY_DATABASE_URL` must use the approved read-only role, for example
`intern_reader`. Do not set it to owner, admin, loader, write, root, superuser,
or service-role URLs; preflight checks the username, and the Neon verification
step still needs to prove the role cannot write.

`CONTEXT7_ENABLED=true` allows the server-side chat route to call Context7 for
generic public library documentation. Keep it `false` until you intentionally
want docs lookup in the deployed app. `CONTEXT7_API_KEY` is required for the
server-side SDK when Context7 is enabled; use a free Context7 key if appropriate.
Never put Context7 values in `NEXT_PUBLIC_*`.

For production PubMed literature lookup, the simplest setup is to enable the
hosted PubMed MCP endpoint as server-side Vercel env only:

```bash
PUBMED_MCP_ENABLED=true
PUBMED_MCP_URL=https://pubmed.caseyjhand.com/mcp
```

Do not prefix these with `NEXT_PUBLIC_`. The app only exposes PubMed MCP tools
for literature-like prompts from server routes. After redeployment, log in and
ask a literature-style question, for example:

```text
Search PubMed for recent studies on asthma disparities and give PMID/DOI citations.
```

For a more controlled production setup, self-host `cyanheads/pubmed-mcp-server`
and point `PUBMED_MCP_URL` at your own HTTPS endpoint:

```bash
MCP_TRANSPORT_TYPE=http
MCP_HTTP_PORT=3010
MCP_HTTP_ENDPOINT_PATH=/mcp
NCBI_API_KEY=optional-but-recommended
NCBI_ADMIN_EMAIL=your-admin-email
```

Then set:

```bash
PUBMED_MCP_ENABLED=true
PUBMED_MCP_URL=https://your-pubmed-mcp-host.example.org/mcp
```

Keep `NCBI_API_KEY` only on the PubMed MCP host, not in browser code. Treat
PubMed MCP as an external public-literature service only. Do not send PHI,
private file names, database URLs, Blob paths, SAS URLs, row-level records, or
controlled dataset values.

Legacy or alternate storage env vars are not required for the current Azure Blob path:

```text
BLOB_READ_WRITE_TOKEN
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

## Preflight checklist

- [ ] `npm run preflight` passes with the same environment variables that Vercel will use.
- [ ] Vercel is using the repo `vercel.json` build command, `npm run build:vercel`, so strict preflight runs before `next build`.
- [ ] `.env` is not committed.
- [ ] Six intern accounts are seeded with hashed passwords.
- [ ] Admin account is seeded with hashed password.
- [ ] `npm run init-app-db` has been run after the artifact metadata columns were added.
- [ ] `app_private.workspace_docs` exists for private CE notes, plans, work logs, reviews, and shared compound learnings.
- [ ] `AUTH_ALLOW_ENV_FALLBACK` is unset or `false`.
- [ ] Login throttling env vars are set so repeated failed sign-ins lock by username and client IP.
- [ ] Foundry/Azure calls work from the server-side route using Bearer auth against `/openai/responses?api-version=2025-04-01-preview`.
- [ ] `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.4`, and `gpt-5.5` route names match the Azure deployment names.
- [ ] Azure per-token prices are entered in cost configuration before intern access; strict `npm run preflight` checks the per-tier input/output price env vars.
- [ ] `npm run db:verify-neon` confirms the restored static teaching copy fits the selected Neon plan, or an approved paid/curated database path is documented.
- [ ] Browser network tab never shows Foundry key or DB credentials.
- [ ] `READONLY_DATABASE_URL` cannot write.
- [ ] SQL safety validator blocks non-SELECT statements.
- [ ] Query previews enforce row limit, timeout, and per-user rate limit.
- [ ] Schema and ward summary endpoints use an appropriate `SCHEMA_CACHE_TTL_SECONDS` for the static teaching copy.
- [ ] AI routes enforce per-user rate limits before Foundry/Azure calls.
- [ ] Upload URL and generated artifact routes enforce per-user rate limits before Blob writes.
- [ ] Metadata request size env vars are set or left at safe defaults so oversized JSON is rejected before parsing.
- [ ] AI usage logging works.
- [ ] Admin dashboard shows usage.
- [ ] Admin dashboard shows budget warnings when daily or monthly model spend reaches at least 80% of configured limits.
- [ ] Artifact upload/publish workflow works.
- [ ] Private file and artifact open routes verify Blob owner metadata before streaming content.
- [ ] Published HTML artifacts are served from a separate origin or sandboxed without portal-cookie access.
- [ ] Published artifact open route works for owner, cohort viewer, and admin.
- [ ] Azure Blob storage is created in `RU-A-Prod-RHEADS-RG` with public access disabled.
- [ ] Azure Storage CORS allows only local development and the production Vercel origin.
- [ ] Azure budget alerts and lifecycle policy are configured.
- [ ] If `CONTEXT7_ENABLED=true`, verify a generic public docs lookup works and a sensitive-looking query is blocked before intern access.
- [ ] If `PUBMED_MCP_ENABLED=true`, verify an authenticated literature-style chat prompt returns PMID/DOI citations and sensitive-looking PubMed MCP input is blocked before intern access.

The preflight command checks only configuration shape and secret presence. It does not print secret values and does not replace live smoke tests for Foundry calls, Neon read-only access, or Azure Blob upload/open behavior.

## Smoke test script outline

Use the automated runtime smoke test against local dev or Vercel:

Run the credential-free public auth-boundary smoke first. It does not need seeded
intern passwords and checks oversized login rejection; unauthenticated GET and
POST blocks for schema, wards, query preview, upload target/completion, file
open/list, artifact save/open/list/update, chat, non-chat AI, saved chat
sessions, dataset recipes, CE workspace docs, and admin usage; plus cross-site
POST rejection for state-changing login, logout, chat, AI, upload, artifact,
recipe, workspace document, and query-preview routes:

```bash
SMOKE_TEST_PUBLIC=1 APP_BASE_URL="https://your-vercel-app.example" npm run smoke:runtime
```

When creating the seeded users, `npm run generate-users -- --smoke-env` prints
the matching `SMOKE_*` exports from the one-time generated passwords. Do not
commit that output; store it only in the approved password handoff path.

```bash
APP_BASE_URL="https://your-vercel-app.example" \
SMOKE_NEON_USERNAME="intern01" \
SMOKE_NEON_PASSWORD="..." \
SMOKE_NEON_WORKFLOW_MODE="neon" \
SMOKE_PHI_USERNAME="intern02" \
SMOKE_PHI_PASSWORD="..." \
SMOKE_PHI_WORKFLOW_MODE="phi_local" \
SMOKE_ADMIN_USERNAME="admin" \
SMOKE_ADMIN_PASSWORD="..." \
SMOKE_ADMIN_WORKFLOW_MODE="dual" \
npm run smoke:runtime
```

If credentials are missing, the script fails before login and prints every
missing `SMOKE_*` variable so the seeded Neon, PHI-local, and admin accounts can
be configured in one pass.

Add `SMOKE_TEST_UPLOAD=1` to also confirm that a Neon-only account cannot request
a data-file upload target, upload and complete a small CSV file through the
signed-in PHI-local account's private Blob-backed file record, and verify
generated HTML artifact private owner/admin access, cross-intern list/open
blocking, and cohort publish/list isolation:

```bash
SMOKE_TEST_UPLOAD=1 npm run smoke:runtime
```

Add `SMOKE_TEST_CHAT=1` to make one small authenticated chat request through the
server-side Foundry/Azure route and verify that the response stream starts:

```bash
SMOKE_TEST_CHAT=1 npm run smoke:runtime
```

If Context7 is enabled, use a generic public-docs prompt for the smoke pass, such
as “Use current public docs to explain a Next.js route handler.” Do not include
project data, PHI, PII, secrets, file names, database URLs, or controlled dataset
values in Context7 smoke prompts.

If PubMed MCP is enabled, run a live authenticated chat smoke test after
deployment with a public-literature prompt:

```text
Search PubMed for recent studies on asthma disparities and give PMID/DOI citations.
```

Do not include PHI, private file names, database URLs, Blob paths, SAS URLs,
row-level records, or controlled dataset values in PubMed smoke prompts.

The script verifies login, `/api/me`, Neon schema access for a Neon-enabled intern,
Neon blocking for a PHI-local intern, limited SELECT-only query preview, unsafe
SQL blocking, dataset recipe save/list/admin listing, admin-only usage dashboard
access, CE workspace document owner isolation and shared-learning visibility,
active user workflow summaries, optional per-user Blob upload/completion,
optional `/api/files` persistence for private data-file metadata, cross-intern
download blocking, admin file listing/download, and optional server-side
Foundry/Azure chat streaming. It does not print passwords, cookies, SAS URLs, or
API keys. The chat smoke consumes a small model call.

Manual smoke pass after the script:

1. Login as the Neon-enabled intern.
2. Ask: “Create a dataset of asthma-related measures by geography.”
3. Confirm assistant asks about row grain if unclear.
4. Generate SQL or a dataset recipe plan.
5. Save the SQL as a dataset recipe and copy Python, R, Jupyter, or marimo starter code from the recipe panel.
6. Login as the PHI-local intern and confirm the UI shows PHI local mode instead of Neon setup.
7. Ask for a PHI-scrubbed local notebook workflow.
8. Upload a test CSV and confirm it appears under Private files.
9. Upload test `report.html`.
10. Publish artifact.
11. Login as another intern and confirm the published artifact is visible but private files/chats are not.
12. Login as admin and confirm all usage is visible.

## Rollback

If token usage spikes:

1. Set `AI_CHAT_ENABLED=false` to stop `/api/chat` before prompts, schema, or model calls are processed.
2. Lower `AI_MAX_CHAT_MESSAGES` or `AI_MAX_CHAT_TEXT_CHARS` if oversized prompts are driving spend.
3. Lower `AI_RATE_LIMIT_REQUESTS` or increase `AI_RATE_LIMIT_WINDOW_SECONDS`.
4. Lower per-user budget.
5. Set `AI_MAX_MODEL_TIER=cheap` for emergency low-cost mode, or `AI_MAX_MODEL_TIER=code` to preserve CE/notebook coding help while disabling strong/premium escalation.
6. Disable premium routing before disabling all AI.
7. Review `app_private.ai_usage_logs`.

If unsafe query behavior appears:

1. Disable `/api/query-preview` route via environment flag.
2. Lower `QUERY_RATE_LIMIT_REQUESTS` or increase `QUERY_RATE_LIMIT_WINDOW_SECONDS`.
3. Rotate `READONLY_DATABASE_URL` password.

If Blob upload or artifact-save usage spikes:

1. Lower `UPLOAD_RATE_LIMIT_REQUESTS` or increase `UPLOAD_RATE_LIMIT_WINDOW_SECONDS`.
2. Lower `AZURE_UPLOAD_MAX_BYTES`.
3. Rotate `AZURE_STORAGE_CONNECTION_STRING` if a storage key or SAS URL pattern is exposed.
3. Confirm DB has no writes.
4. Fix SQL validator.
5. Redeploy.

If artifact privacy issue appears:

1. Disable artifact gallery sharing.
2. Mark all artifacts private in database.
3. Review storage bucket access policy.
4. Review HTML serving isolation so uploaded scripts cannot run with portal privileges.
5. Re-enable only after permissions and isolation tests pass.
