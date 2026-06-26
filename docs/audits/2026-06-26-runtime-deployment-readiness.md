# Runtime deployment readiness

Date: 2026-06-26

Scope: current local worktree for the Summer Intern Portal, checked against
`docs/plans/2026-06-26-001-chore-runtime-deployment-readiness-plan.md`.

## Executive Status

Local readiness: mostly green.

Live intern deployment readiness: blocked on seeded smoke credentials and live
service configuration. The app should not be called pilot-ready until the
runtime smoke suite has been run against the deployed Vercel URL with one
Neon-enabled intern, one PHI-local intern, and one admin.

## Proven Locally

- Vercel build configuration is repo-controlled through `vercel.json`.
- Vercel deploys use `npm run build:vercel`, which runs strict preflight before
  the Next.js build.
- Local `npm run build` remains a no-secret Next.js build path.
- Strict preflight includes Foundry/Azure, Neon, Blob, account, workflow-mode,
  budget, request-size, SAS expiry, and read-only database-role checks.
- Runtime smoke reports all missing seeded credential variables before making
  login requests.
- Public smoke mode exists for credential-free auth-boundary checks.
- Local invariants cover workflow-mode boundaries, query safety, dataset recipe
  starters, PHI-local private file uploads, Blob path isolation, generated HTML
  artifact safety, and metadata fail-closed behavior.
- `db:verify-neon` now enforces a default restored-database size gate for the
  Neon Free fit check and exposes an explicit override for approved paid or
  curated database paths.

## Remaining Live Proof

- Run strict `npm run preflight` with the same environment variables Vercel will
  use.
- Run `npm run db:verify-neon` against the restored static teaching copy and
  confirm the database fits the selected Neon plan or has an approved paid or
  curated alternative.
- Run `npm run db:verify-readonly` with `READONLY_DATABASE_URL`.
- Run credential-free public smoke against the Vercel URL.
- Run seeded runtime smoke with `SMOKE_NEON_*`, `SMOKE_PHI_*`, and
  `SMOKE_ADMIN_*`.
- Run `SMOKE_TEST_UPLOAD=1` after Azure Blob storage and CORS are configured for
  the deployed origin.
- Run `SMOKE_TEST_CHAT=1` after Foundry/Azure endpoint, API key, route names,
  model prices, and budget settings are configured.

## Current Blocker

`npm run smoke:runtime` cannot complete in this environment because the seeded
credential variables are not set:

- `SMOKE_NEON_USERNAME`
- `SMOKE_NEON_PASSWORD`
- `SMOKE_PHI_USERNAME`
- `SMOKE_PHI_PASSWORD`
- `SMOKE_ADMIN_USERNAME`
- `SMOKE_ADMIN_PASSWORD`

Use `npm run generate-users -- --smoke-env`, set `INTERN_USERS_JSON`, seed the
users, and reuse the generated smoke exports only through the approved password
handoff path.

## Verification Run

- `python3 -m py_compile tools/neon_healthmap_sync.py` passed.
- `node --check tools/local_invariants.mjs` passed.
- `node --check tools/runtime_smoke.mjs` passed.
- `python3 tools/neon_healthmap_sync.py verify --help` showed the
  `--max-database-bytes` option.
- `npm run test:local` passed.

## Operator Notes

- Do not disable the Neon size gate unless an approved paid or curated database
  path replaces Neon Free.
- Do not expose Foundry/Azure keys, Neon URLs, Blob paths, SAS URLs, passwords,
  or connection strings in browser-visible output or PR text.
- Do not treat local green checks as live proof. The live Vercel URL, live Neon
  roles, live Blob metadata, and live Foundry/Azure route still need smoke
  evidence.
