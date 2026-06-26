# AGENTS.md — Summer Intern Portal

## Mission

Build a low-cost, safe web portal for 6 summer interns to use an AI-assisted data science workflow against a static, de-identified PostgreSQL dataset.

The portal should help interns who know some Python or R but little SQL:

- discover available tables and columns,
- describe desired datasets in plain English,
- generate and explain safe SQL,
- preview small read-only query results,
- save reusable dataset recipes,
- generate Python/R/marimo code,
- upload or publish HTML artifacts,
- track token usage and query activity by intern.

## Product decisions already made

- Six individual intern accounts, predefined by admin.
- Passwords must be stored as hashes only.
- Mixed visibility model:
  - intern chats/workspaces private by default,
  - final published artifacts shared with the cohort,
  - admin can see all usage and outputs.
- Data is de-identified but controlled.
- Interns must never be able to modify source data.
- Use one shared read-only database identity for the portal.
- Use a hosted static copy of the database, preferably Neon Free if the dataset fits.
- Use Vercel for the web app if feasible.
- Foundry/Azure model API key is paid token cost and must stay server-side.

## Security rules for coding agents

1. Do not place API keys, DB URLs, passwords, or tokens in committed files.
2. Do not implement frontend code that calls Foundry/Azure directly with a secret.
3. Do not implement database queries with a write-capable role for intern-facing endpoints.
4. Do not log full query result datasets unless an explicit approved artifact workflow requires it.
5. Default query previews to `LIMIT 50` or `LIMIT 100`.
6. Enforce read-only SQL safety in app code even when the DB role is read-only.
7. Treat de-identified data as controlled research data: no PHI, credentials, re-identification keys, or row-level extracts in prompts by default.
8. Prefer server-side validation and rate limits over trusting client-side controls.

## External documentation MCP policy

Context7 MCP may be used for public library and framework documentation, such as Next.js, Vercel AI SDK, Neon client libraries, Azure SDKs, bcrypt, or TypeScript APIs.

Treat Context7 as an external third-party service. Never send PHI, PII, direct identifiers, credentials, API keys, database URLs, row-level records, private source code, proprietary project details, private file names, or controlled HealthMap data values to Context7. Context7 queries must be generic documentation lookups, with project-specific or sensitive details redacted or summarized locally first.

Do not commit a `CONTEXT7_API_KEY` or generated MCP credentials. If Context7 is configured, keep credentials in the user's local/global MCP configuration or local environment only.

## Preferred implementation shape

- Framework: Next.js / TypeScript.
- Hosting: Vercel.
- Database: Neon Postgres for static teaching copy and metadata if free tier fits.
- Auth: simple custom credentials auth or Auth.js credentials provider; no public signup.
- Password hashing: bcrypt or argon2.
- SQL parsing/safety: allow single-statement `SELECT` only; block DDL/DML and dangerous commands.
- AI access: server-side `/api/ai` route proxies to Microsoft Foundry/Azure.
- Artifacts: HTML uploads stored in Vercel Blob, Supabase Storage, Azure Blob, or local-first fallback depending on free-tier fit.

## Planning-first instruction

This repository currently contains planning documents. Before implementing code:

1. Read `docs/brainstorms/summer-intern-portal-requirements.md`.
2. Read `docs/architecture/free-tier-tech-stack-research.md`.
3. Read `docs/security/security-model.md`.
4. Check whether the static database fits Neon Free limits.
5. Only then create the application scaffold.

## Definition of done for MVP

- Admin can create/seed 6 intern accounts.
- Intern can log in.
- Intern can browse database schema summaries.
- Intern can describe a dataset and receive explained SQL.
- Portal can run a read-only limited preview query.
- Intern can save a dataset recipe.
- Intern can generate Python, R, and marimo starter code for the recipe.
- Intern can upload/publish an HTML artifact.
- Admin can view token usage and query metadata by intern.
- Foundry/Azure and database secrets remain server-side.
