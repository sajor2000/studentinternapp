# Pre-Scaffold Audit

Date: 2026-06-25

Plan: `docs/plans/2026-06-24-001-chore-pre-scaffold-audit-gate-plan.md`

## Readiness Decision

**Decision:** superseded for the database gate; remaining non-database gates are conditional or blocked as noted below.

The original pre-scaffold audit captured the ZIP-derived teaching import. The current database state has since been replaced with a PostGIS-shaped copy dumped directly from the readable Azure `healthmap_dev` database and restored into Neon `public`. The remaining hard gates are outside the database copy: Foundry/Azure pricing, artifact storage, and artifact serving isolation.

## Evidence Summary

| Gate | Status | Evidence | Scaffold impact |
|---|---|---|---|
| Static database fit | Verified | Azure-sourced dump `/Users/JCR/Downloads/Other/healthmap_azure_dev_live_2026-06-25.dump` is restored into Neon `public`. Verified size is 297,238,528 bytes, about 283 MB. | Current PostGIS-shaped copy fits Neon Free's 512 MB project limit only if a second full backup branch is not kept in the same project. |
| Read-only role | Verified | `intern_reader` can `SELECT` from `public.fact_tract_condition_stats`; `CREATE TABLE` and `DELETE` attempts fail through `npm run db:verify-readonly`. | App runtime uses pooled `READONLY_DATABASE_URL` and `HEALTHMAP_SCHEMA=public`. |
| Hosting terms | Conditional | Vercel Hobby docs checked 2026-06-25 state Hobby is for non-commercial, personal use only. | Prototype can use Hobby; institutional intern deployment needs Pro or explicit approval. |
| Provider limits | Conditional | Neon docs checked 2026-06-25 report Free storage at 0.5 GB/project and 100 CU-hours/month/project. | Neon Free remains viable only if the imported static copy fits. |
| Artifact storage | Blocked | Expected artifact count and HTML sizes are unknown; no storage env var is present. | Provider selection remains open. |
| Artifact serving isolation | Blocked | Uploaded HTML may contain scripts; no serving model is selected. | Must choose separate-origin serving or sandboxed rendering before implementation. |
| Secret handling | Conditional | `.env.example` uses server-side names for sensitive values; current environment has no live values. | Scaffold must preserve server-only secret boundaries. |
| Auth/session approach | Conditional | Next.js auth docs checked 2026-06-25 recommend server-side validation, secure cookies, and authorization near data access. | Scaffold can proceed after hard gates, using server-side auth checks. |
| SQL safety | Conditional | `docs/security/security-model.md` requires single-statement `SELECT`, row limits, timeout, and metadata-only logging. | Scaffold must implement app-level SQL validation in addition to DB role limits. |
| Foundry/Azure model and pricing | Partial | Azure endpoint is `https://equityclaudeagent.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview` with Bearer key authentication. Available model base names/deployments are `gpt-4.1`, `gpt-5-mini`, `gpt-5.3-codex`, `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.5`. Active routes use `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.4`, and `gpt-5.5`; `gpt-5-mini` and `gpt-4.1` are kept as manual fallbacks. API key and account-specific pricing remain absent in the current environment. Azure pricing docs checked 2026-06-25 state pricing varies by agreement, date, currency, region, and deployment type. | AI proxy can be configured by model base name, but cost dashboard cannot be final until prices are confirmed. |

## Environment Presence Check

The check only recorded whether values exist. It did not print secret values.

| Variable or tool | Status |
|---|---|
| Source export archive | Superseded by Azure pg_dump `/Users/JCR/Downloads/Other/healthmap_azure_dev_live_2026-06-25.dump` |
| `SOURCE_DATABASE_URL` | Not stored; Azure dump created through Entra token auth |
| `TARGET_DATABASE_URL` | Present in ignored local env files; direct Neon owner URL |
| `DATABASE_URL` | Present in ignored local env files; direct Neon owner URL |
| `READONLY_DATABASE_URL` | Present in ignored local env files; pooled `intern_reader` URL |
| `AZURE_AI_ENDPOINT` | Selected: `https://equityclaudeagent.cognitiveservices.azure.com`; env value not present locally |
| `AZURE_AI_API_KEY` | Missing; same value as Foundry sample `AZURE_API_KEY` |
| `AZURE_AI_API_VERSION` | Selected: `2025-04-01-preview`; env value not present locally |
| Available Azure model base names | `gpt-4.1`, `gpt-5-mini`, `gpt-5.3-codex`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.5` |
| `AZURE_AI_CHEAP_DEPLOYMENT` | Deployment name selected: `gpt-5.4-mini`; env value not present locally |
| `AZURE_AI_DEFAULT_DEPLOYMENT` | Deployment name selected: `gpt-5.3-codex`; env value not present locally |
| `AZURE_AI_CODE_DEPLOYMENT` | Deployment name selected: `gpt-5.3-codex`; env value not present locally |
| `AZURE_AI_STRONG_DEPLOYMENT` | Deployment name selected: `gpt-5.4`; env value not present locally |
| `AZURE_AI_PREMIUM_DEPLOYMENT` | Deployment name selected: `gpt-5.5`; env value not present locally |
| `BLOB_READ_WRITE_TOKEN` | Missing |
| `SUPABASE_URL` | Missing |
| `SUPABASE_SERVICE_ROLE_KEY` | Missing |
| `AZURE_STORAGE_CONNECTION_STRING` | Missing |
| `psql` | Missing |

## Database Fit Gate

The database-fit gate is complete for the current Azure PostGIS-shaped HealthMap teaching copy.

Historical ZIP archive evidence, superseded:

- `healthmap_dev_export_2026-06-04.zip` was extracted from `healthmap_dev` on 2026-06-04.
- The archive contains `README.md`, `manifest.json`, 34 CSV data files, and 34 Parquet data files.
- Total archive content is 226,447,902 bytes uncompressed and 73,799,317 bytes compressed.
- CSV data totals 181,462,586 bytes uncompressed; Parquet data totals 44,952,620 bytes uncompressed.
- The largest CSV table is `fact_tract_condition_stats.csv` at 101,061,770 bytes and 342,273 manifest rows.
- The manifest records 34 logical tables. Geometry columns were exported as WKT text, with lon/lat numeric columns for point layers.

Current Neon import evidence:

- Imported into schema `public` on 2026-06-25.
- Loaded 34 HealthMap user tables plus PostGIS extension metadata.
- Required extensions verified: `postgis`, `pg_trgm`, `plpgsql`.
- Dump parity verified: 34 tables, 7 sequences, 57 indexes, 64 constraints, and all 34 row counts.
- Full live Azure `healthmap_dev` audit against Neon passed for all 34 readable `public` user tables.
- Measured database size: 297,238,528 bytes, about 283 MB.
- Key row counts:
  - `fact_tract_condition_stats`: 342,273 rows.
  - `fact_zcta_condition_stats`: 66,903 rows.
  - `dim_census_tracts`: 3,265 rows.
  - `fact_community_area_condition_stats`: 17,836 rows.

Interpretation: the current imported data fits under Neon Free's 512 MB project storage limit. Headroom is limited, so do not keep a second full backup branch in the same free project.

Minimum evidence needed:

- Keep `READONLY_DATABASE_URL` configured outside committed files.
- Avoid adding large derived tables or a second full database branch unless moving to a paid tier.
- App metadata storage estimate.

Current decision: **verified for the current Azure PostGIS-shaped teaching copy.**

## Hosting and Provider Gate

Checked 2026-06-25:

- Neon Free remains constrained by storage size. The current public docs report 0.5 GB/project and 100 CU-hours/month/project.
- Vercel Hobby remains appropriate for a prototype only unless institutional review approves it. The current Hobby docs state non-commercial, personal-use restrictions.
- Vercel Blob is available on all plans, with Hobby usage limits and rate limits. This is plausible for small artifacts but cannot be selected until expected artifact sizes are known.
- Supabase remains a possible alternate if bundled storage/auth materially simplifies the MVP, but the current repo direction still favors Neon for Postgres simplicity.
- Azure Foundry model prices must be confirmed from the account/region/deployment because public pricing is not sufficient for a hard-coded cost model.

Current decision: **conditional for hosting, blocked for artifact provider selection.**

## Security Architecture Gate

The future scaffold must keep these controls as hard requirements:

- Sensitive environment variables must remain server-only and must not use the `NEXT_PUBLIC_` prefix.
- Authentication must use fixed predefined users, no public signup, and password hashes only.
- Session cookies must be HTTP-only, secure in deployed environments, and same-site scoped.
- Authorization must run in server-side data access paths and route handlers, not only in client UI.
- `DATABASE_URL` and `READONLY_DATABASE_URL` must remain separate.
- Intern-facing preview queries must be app-validated as single-statement `SELECT` and must run through the read-only role.
- Query previews must enforce row limits and statement timeouts.
- Logs must capture metadata, cost, SQL text for recipes/runs, and error summaries without full raw row payloads by default.
- Admin password rotation must be a server-side hash replacement workflow.

Current decision: **conditional; architecture is clear enough, but implementation must not begin until hard provider/data gates close or are explicitly accepted as assumptions.**

## AI Proxy and Cost Gate

The future scaffold must use a server-side Foundry/Azure proxy. The frontend must never call Foundry/Azure directly.

Minimum evidence needed:

- Confirmed endpoint and API version.
- Available deployment/model names for cheap, default, code, strong, and premium model roles.
- Input, output, and cached-input token prices from the Azure account or pricing calculator.
- Daily per-user budget defaults and monthly total budget defaults.
- Kill-switch policy for AI, premium model, query preview, and artifact upload.

Current decision: **partially unblocked. Model base names, deployment names, endpoint, and API version are selected; price configuration still must be confirmed before intern launch.**

## Artifact Gate

The artifact workflow is not ready for scaffold decisions.

Minimum evidence needed:

- Expected number of intern artifacts.
- Expected maximum HTML file size and asset strategy.
- Storage provider choice.
- Private draft access model.
- Shared final gallery access model.
- Admin visibility model.
- Serving isolation for active HTML.
- Rollback action for privacy issues.

Serving isolation decision required:

- Preferred direction: serve uploaded final HTML from a storage origin that does not share portal cookies or privileged APIs.
- Acceptable alternate: render artifacts in a sandboxed iframe without same-origin privilege and with a separate download/open flow.
- Avoid: serving intern-uploaded HTML directly under the authenticated app origin with portal cookies in scope.

Current decision: **blocked until artifact provider and serving isolation are selected.**

## Scaffold Readiness

The scaffold may begin only after one of these happens:

1. **Proceed:** database fit, read-only role, provider choices, model pricing, and artifact isolation are all verified.
2. **Proceed with accepted assumptions:** unresolved non-hard items are documented with an owner and revisit condition.
3. **Remain blocked:** model pricing or artifact isolation remain unresolved.

Current outcome: **remain blocked.**

## Smallest Next Decisions

1. Rotate the exposed Neon owner password and set a fresh `intern_reader` password for app configuration.
2. Decide whether the internship deployment will use Vercel Pro or whether Hobby is only for prototype validation.
3. Confirm Foundry/Azure model deployments and pricing inputs.
4. Estimate artifact count and maximum HTML size.
5. Choose separate-origin artifact serving or sandboxed artifact rendering.

## Sources

- `AGENTS.md`
- `.env.example`
- `docs/brainstorms/summer-intern-portal-requirements.md`
- `docs/architecture/free-tier-tech-stack-research.md`
- `docs/security/security-model.md`
- `docs/runbooks/data-migration.md`
- `docs/runbooks/deployment.md`
- `docs/planning/token-cost-control.md`
- [Neon plan docs](https://neon.tech/docs/introduction/plans), checked 2026-06-25
- [Vercel Hobby docs](https://vercel.com/docs/plans/hobby), checked 2026-06-25
- [Vercel Blob pricing docs](https://vercel.com/docs/vercel-blob/usage-and-pricing), checked 2026-06-25
- [Supabase pricing](https://supabase.com/pricing), checked 2026-06-25
- [Azure Foundry pricing docs](https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/aoai), checked 2026-06-25
- [Next.js authentication docs](https://nextjs.org/docs/app/guides/authentication#how-to-implement-authentication-in-next-js), checked 2026-06-25
- [Next.js environment-variable docs](https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/environment-variables.mdx?plain=1#L194#runtime-environment-variables), checked 2026-06-25
