# CLAUDE.md — Project Context

This repo plans a summer intern data science agent portal.

## Core goal

Create a low-cost web app for 6 summer interns to use an AI-assisted workflow for SQL, Python, R, and marimo notebooks against a static read-only PostgreSQL teaching database.

## Key constraints

- The Microsoft Foundry/Azure API key must never be exposed to the browser.
- The database used by interns must be a static read-only copy.
- The current static copy is the readable Azure `healthmap_dev` PostGIS-shaped dump restored into Neon `public`; `HEALTHMAP_SCHEMA` should stay `public`.
- Intern users are predefined; no public signup.
- Passwords must be hashed.
- Queries should be preview-limited and read-only.
- Full analysis should run on interns' personal PCs in Python/R/marimo; the portal assists, previews, and publishes artifacts.
- De-identified data is still controlled research data.
- Context7 MCP is allowed only for public library/framework documentation lookups. Queries sent to Context7 must be generic and must not include PHI, PII, credentials, database URLs, row-level records, private source code, private file names, or controlled HealthMap data values.

## Preferred stack

- Next.js + TypeScript on Vercel.
- Neon Postgres Free if the dataset fits free-tier storage/compute limits.
- Server-side Foundry/Azure API proxy.
- Vercel Blob/Supabase Storage/Azure Blob for HTML artifacts depending on cost and limits.
- Local marimo notebooks for intern analysis.

## Important docs

- `docs/brainstorms/summer-intern-portal-requirements.md`
- `docs/planning/mvp-plan.md`
- `docs/architecture/free-tier-tech-stack-research.md`
- `docs/architecture/system-architecture.md`
- `docs/security/security-model.md`
- `docs/runbooks/data-migration.md`
- `docs/runbooks/deployment.md`

## Coding guidance

If implementation begins, keep the first version boring and secure:

1. Build auth first.
2. Add schema browser second.
3. Add SQL generation without execution third.
4. Add read-only preview fourth.
5. Add artifact uploads after core query flow works.
6. Add cost dashboard before handing to interns.

Avoid building a full browser IDE or arbitrary Python execution in the cloud for MVP.

Use Context7 for current framework or library behavior when it helps implementation, but redact project-specific details before querying it and keep any `CONTEXT7_API_KEY` out of committed files.
