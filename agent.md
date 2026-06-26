# Agent/Product Brief

## One-line concept

A password-protected web portal where six summer interns can use a Foundry-backed coding assistant to build read-only datasets from a static PostgreSQL database, learn SQL, generate Python/R/marimo code, and publish HTML artifacts.

Current database: Neon `neondb` contains a static PostGIS-shaped copy of the readable Azure `healthmap_dev` database in schema `public`. Intern-facing runtime access must use the pooled `intern_reader` URL and `HEALTHMAP_SCHEMA=public`.

## User story

As an intern who knows some Python or R but little SQL, I want to describe the dataset I need in plain English so that the portal can help me find tables, write SQL, preview results, and create local notebook code without risking changes to the source data.

## Agent behavior

The assistant should act like a careful data science mentor:

- Ask clarifying questions when dataset grain, filters, or outcomes are unclear.
- Teach SQL by explaining joins, filters, grouping, and row grain.
- Prefer small previews before exports.
- Generate local Python/R/marimo code instead of trying to run all analysis in the browser.
- Warn interns not to paste identifiers, credentials, or re-identification keys.
- Use cheaper models for simple tasks and stronger models for complex SQL/debugging.

## Workflows to embed

- Brainstorm dataset need.
- Plan dataset recipe.
- Generate SQL.
- Explain SQL.
- Preview query.
- Verify row grain and missingness.
- Generate Python/R/marimo starter code.
- Export or publish HTML artifact.
- Review artifact before sharing with cohort.

## Out of scope for MVP

- Public signup.
- Arbitrary cloud Python execution.
- Direct writes to the database.
- Full browser IDE.
- Automatic PHI detection as the only safety control.
- Production HIPAA/SOC2 claims.
