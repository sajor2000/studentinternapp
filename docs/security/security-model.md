# Security Model

## Data classification

The teaching dataset is de-identified but controlled. It should not be treated as public data.

Controls should assume interns may accidentally paste sensitive text, credentials, or row-level extracts unless the UI discourages it and backend limits reduce blast radius.

Supported data modes:

- **Chicago Health Map / HealthMap:** built-in Neon read-only schema for de-identified ward, condition, 311, crime, and artifact workflows.
- **Approved PHI file:** local-first or approved Azure Blob workflow for CSV, XLSX, Parquet, Jupyter notebooks, Python/R/Quarto source files, HTML, Word, and PowerPoint files. The portal may coach analysis design and generate Python/R/Jupyter/marimo code using the minimum PHI needed for the coding task. Use approved secure storage/compute, prefer schema or masked examples when original values are not needed, and apply aggregate-output privacy rules when publishing.

HHS guidance describes two HIPAA de-identification approaches, Expert Determination and Safe Harbor. HHS Security Rule guidance also describes administrative, physical, and technical safeguards for electronic protected health information. This portal does not make PHI de-identification determinations; it should guide interns toward approved local workflows and administrative review.

## Threats

| Threat | Mitigation |
|---|---|
| Foundry/Azure API key leaked in browser | Keep all AI calls server-side; never expose key in frontend bundle |
| Intern modifies data | Use read-only DB role; app blocks non-SELECT SQL |
| Intern exports too much data | Row limits, export confirmation, admin-configured max export size |
| Prompt includes sensitive data | UI warning; send schema/samples not full datasets; avoid raw result logging |
| Token bill spike | Per-user budgets, model routing, rate limits, usage dashboard |
| Shared account hides accountability | Individual fixed accounts for all 6 interns |
| SQL injection / unsafe SQL execution | Parse SQL; allow one SELECT statement; parameterize app queries; separate metadata and query roles |
| Artifact leaks private work | Draft artifacts private by default; explicit publish action |
| Uploaded HTML runs with portal privileges | Serve artifacts from a separate origin or sandbox them without portal-cookie access |
| Azure upload token reused or spammed | Issue short-lived SAS URLs for one private blob path only; no list/read/delete permissions; throttle per-user upload and generated-artifact write requests |
| PHI file names leak identifiers | Store blobs under generated UUID paths; do not put original file names in blob paths or model context |
| Password list leaks | Hash passwords; do not commit `.env`; rotate passwords if exposed |
| External documentation MCP receives sensitive context | Use Context7 only for generic public library documentation lookups; do not send PHI, PII, credentials, database URLs, row-level records, private source code, private file names, or controlled data values |
| External literature MCP receives sensitive context | Use PubMed MCP only for public biomedical literature, citation, MeSH, PMID/PMCID/DOI, PubMed Central, and Europe PMC lookups; do not send PHI, PII, credentials, private URLs, database URLs, Blob paths, SAS URLs, row-level records, controlled dataset values, or private project details |

## Authentication

MVP auth model:

- Admin seeds 6 intern users into Neon.
- No signup.
- No reset flow initially.
- Store password hashes only in `app_private.intern_users`.
- Store each account's `workflow_mode` as `neon`, `phi_local`, or `dual`.
- Use secure HTTP-only session cookie.
- Revalidate signed sessions against active Neon users before protected API access.
- Disable env-user auth fallback in deployed environments.
- Throttle failed login attempts by client IP and username; configure failed-attempt, window, and lockout thresholds in deployment env.
- Admin account required for usage dashboard and data refresh functions.
- Admin password rotation must replace password hashes server-side; plaintext temporary passwords must not be committed or logged.

Workflow access:

- `neon` accounts can use the HealthMap/Neon schema and ward endpoints.
- `phi_local` accounts are restricted from Neon schema and ward endpoints and should use PHI-scrubbed local/Rush-machine notebook workflows.
- `dual` accounts can use both modes.
- Admin accounts can review all modes.

## Database access

Use separate connection strings:

- `DATABASE_URL`: app metadata and migrations; server-side only.
- `READONLY_DATABASE_URL`: intern query previews; select-only role; server-side only.

The read-only role should have:

- `CONNECT` on database.
- `USAGE` on approved schemas.
- `SELECT` on static data tables/views.
- No DDL/DML privileges.

## SQL safety policy

Intern-facing query execution must enforce:

- single SQL statement only,
- `SELECT` only,
- default `LIMIT 50` or `LIMIT 100`,
- max row/export limits,
- statement timeout,
- per-user short-window preview rate limits,
- blocked commands: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `COPY`, `GRANT`, `REVOKE`, `VACUUM`, `ANALYZE`, `CALL`, `DO`, `SET ROLE`.

Even though the DB role is read-only, the app must still validate SQL before execution.

## AI prompt policy

`/api/chat` applies the server-side AI kill switch, per-user request rate limit, and configured prompt size limits before schema lookup, model routing, or Foundry/Azure calls. It then inspects user chat text before model routing. If a message contains direct identifier values that are not needed for coding help, the route replaces those values with mask tokens before calling the model provider. For pasted delimited row examples, the route preserves headers, shape, and non-identifier values while masking cells under obvious identifier columns such as MRN, DOB, name, address, phone, and email. The route does not hard-block PHI prompts; it sends the minimum sanitized context it can produce. This guard is intended to reduce unnecessary disclosure at the model boundary; it is not a de-identification engine and does not replace project approval, data governance review, or approved secure analysis environments.

`/api/chat-sessions` applies the same masking helper before saving durable chat sessions. It masks saved message text and titles across message roles while preserving non-identifier table shape. The browser may still keep the active local working copy during the session; the database-backed copy is the masked version.

Send the model:

- table names,
- column names,
- column descriptions if available,
- row counts,
- small synthetic or approved samples,
- error messages,
- saved recipe context.

Avoid sending:

- large row-level extracts,
- credentials,
- direct identifiers,
- re-identification keys,
- full private chat logs when a summary is enough.

For PHI file workflows, prefer sending:

- approved project context,
- local file path pattern without secrets,
- private metadata record id for files uploaded through the approved portal workflow,
- column names and data types,
- row count and missingness summary,
- intended output goal,
- direct identifiers to exclude from unnecessary outputs,
- minimum cell-size rule for shared aggregate artifacts,
- masked or representative row examples when row shape is needed for code.

Do not send original names, MRNs, addresses, dates of birth, contact information, free-text clinical notes, row-level records, or unique patient/device identifiers unless that exact context is needed to produce correct code. When it is not needed, rely on masking, schema, or representative examples.

## External documentation MCP policy

Context7 MCP may be used by coding agents to retrieve current public documentation for frameworks and libraries, including Next.js, Vercel AI SDK, Neon client libraries, Azure SDKs, bcrypt, TypeScript, Python, R, and marimo.

Context7 is not an approved destination for PHI, PII, controlled row-level extracts, credentials, database URLs, private file names, private source code, or proprietary project details. Documentation queries must be generic, for example "Next.js route handler file upload limits" rather than a query containing a real storage path, patient column, intern name, or dataset value.

Context7 credentials, if used, belong in local MCP configuration or environment variables only. They must not be committed to this repository.

## External literature MCP policy

PubMed MCP may be enabled server-side for public biomedical literature lookup
through cyanheads/pubmed-mcp-server. It is an external MCP boundary, not a place
for controlled data. The app only exposes its tools for literature-like prompts
and blocks obvious identifiers, credentials, database URLs, private URLs, Blob
paths, and SAS tokens in tool inputs.

For the simplest production setup, enable the hosted PubMed MCP endpoint with
server-side Vercel env vars only:

```text
PUBMED_MCP_ENABLED=true
PUBMED_MCP_URL=https://pubmed.caseyjhand.com/mcp
```

Do not use `NEXT_PUBLIC_` for PubMed MCP configuration. If the team self-hosts
`cyanheads/pubmed-mcp-server`, keep `NCBI_API_KEY` only on that MCP host and
point `PUBMED_MCP_URL` at the host's HTTPS `/mcp` endpoint.

Do not send PHI, PII, row-level records, controlled HealthMap data values,
private file names, private project details, credentials, database URLs, Blob
paths, or SAS URLs to PubMed MCP. Prefer public biomedical concepts, citation
metadata, PMID/PMCID/DOI values, MeSH terms, and publication filters.

## Logging policy

Log:

- user id,
- workflow,
- model,
- input/output token counts,
- estimated cost,
- SQL text for saved/query recipes,
- row count,
- status/error summary,
- duration.

The MVP writes model usage to `app_private.ai_usage_logs` from the AI SDK streaming `onFinish` hook and checks configured per-user daily and monthly budget limits before new chat calls. Create this table during admin setup with `npm run init-app-db` or `npm run seed-users`; intern-facing runtime requests must not need schema-creation privileges.

Do not log by default:

- full returned rows,
- uploaded private data files,
- plaintext passwords,
- API keys,
- connection strings.

## CE workspace document controls

CE workspace documents are stored as app metadata, not repository files. Brainstorms,
plans, work logs, reviews, and ordinary handoff notes default to the owner only,
with admin visibility for mentoring and accountability. Cohort visibility must be
explicit and is limited to compound learnings and handoffs that are suitable to
share. Other interns cannot edit shared CE workspace documents owned by another
intern.

## Azure Blob upload controls

The portal uses Azure Blob for approved controlled uploads and final artifacts. The
browser never receives `AZURE_STORAGE_CONNECTION_STRING`. The authenticated server
route creates a short-lived SAS URL scoped to one generated blob path under the
signed-in user prefix. The SAS grants create/write only, not read/list/delete. The
chat receives only minimal metadata plus a private metadata record id; Blob paths,
original filenames, and file contents are not automatically sent to the model.
After upload completion, the browser chat state uses generated metadata labels
instead of retaining original local filenames.
Upload URL issuance and generated HTML artifact saves are per-user rate-limited
before new Blob write opportunities are created.

Authenticated download and artifact-open routes authorize against the metadata
row and then verify the Blob path namespace and Blob `owner` metadata still match
the recorded owner before streaming content. This keeps owner/admin access and
cohort-published artifact sharing from relying only on database metadata.
Artifact publish/update routes reject metadata rows marked as `data_file`, keeping
private analysis inputs, notebooks, and code files out of artifact workflows even
when the caller owns the upload.

Required operational controls:

- Use a private container with public access disabled.
- Configure Azure Storage CORS only for local development and production app origins.
- Use an Azure subscription/resource covered by the organization’s Microsoft BAA before uploading PHI.
- Keep storage account keys server-side in Vercel env vars only.
- Prefer generated UUID blob paths over original file names.
- Treat SAS URLs as sensitive while they are valid.
- Add lifecycle/retention policy before long-running production use.

## Artifact serving policy

HTML artifacts are user-generated content. The app must not serve intern-uploaded HTML in the same trust context as the authenticated portal unless that risk is explicitly accepted and mitigated.

Preferred MVP controls:

- store private drafts with non-public access,
- publish final artifacts only through an explicit action,
- serve published HTML from a storage origin that does not share portal cookies or privileged APIs,
- or render artifacts in a sandboxed iframe without same-origin privilege,
- keep a rollback action that can mark all artifacts private or disable gallery sharing.

## Admin checklist before intern access

- [ ] Confirm all secrets are in Vercel environment variables.
- [ ] Confirm `.env` is not committed.
- [ ] Confirm DB role used by query preview is read-only.
- [ ] Confirm non-SELECT SQL is blocked by app.
- [ ] Confirm query timeout is enabled.
- [ ] Confirm per-user token budget is configured.
- [ ] Confirm artifact visibility defaults to private.
- [ ] Confirm uploaded HTML cannot access portal cookies or privileged APIs.
- [ ] Confirm warning banner says not to paste identifiers, credentials, or re-identification keys.
