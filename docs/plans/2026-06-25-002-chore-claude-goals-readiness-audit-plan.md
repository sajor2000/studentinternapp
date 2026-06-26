---
title: "chore: CLAUDE goals readiness audit"
type: "chore"
date: "2026-06-25"
origin: "CLAUDE.md"
execution: knowledge-work
---

# CLAUDE goals readiness audit plan

## Summary

Check whether the current RHEAS Intern AI Chat app satisfies the goals and
constraints in `CLAUDE.md`, then produce a durable audit that separates complete
capabilities, partial capabilities, blockers, and next implementation work.

## Problem Frame

`CLAUDE.md` defines the app as a low-cost intern portal for AI-assisted SQL,
Python, R, and marimo workflows against a static read-only PostgreSQL teaching
database. The app has grown quickly through auth, chat, Neon, Azure Blob, and
artifact work. Before continuing deployment, the team needs a clear readiness
check against those stated goals.

## Requirements

R1. Check the app against every core goal in `CLAUDE.md`.

R2. Check security and implementation constraints: server-only Foundry key,
read-only intern database access, predefined users, hashed passwords, preview
limits, and controlled-data posture.

R3. Verify implemented behavior from code, docs, and available local runtime
checks instead of assuming feature completeness from plans.

R4. Identify missing or partial MVP capabilities with concrete files or modules
that must be added next.

R5. Produce a durable audit document under `docs/audits/` that the next work
cycle can use.

R6. Run project verification after the audit and any small fixes.

## Key Technical Decisions

KTD1. Treat this as knowledge-work execution.

Rationale: The user asked to check readiness against `CLAUDE.md`, not to build
all remaining MVP features in one pass. The output should be an evidence-backed
audit and next-step map.

KTD2. Use the existing repo docs as goal sources.

Rationale: `CLAUDE.md` is the primary goal file, while `docs/planning/mvp-plan.md`,
`docs/architecture/system-architecture.md`, `docs/security/security-model.md`,
and `README.md` provide current status and implementation expectations.

KTD3. Mark a goal complete only when implementation exists.

Rationale: Some goals are planned in docs but not implemented in app routes or
UI. The audit should distinguish planned, partial, and complete states.

## Implementation Units

### U1. Establish evidence matrix

Goal: Build a goal-by-goal matrix from `CLAUDE.md`.

Requirements: R1, R2, R3

Dependencies: none

Files:

- `CLAUDE.md`
- `docs/planning/mvp-plan.md`
- `docs/architecture/system-architecture.md`
- `README.md`
- `docs/security/security-model.md`
- `app/**`
- `components/**`
- `tools/**`

Approach: Map each CLAUDE goal and constraint to implemented files, planned-only
docs, or missing app surfaces.

Patterns to follow: Existing audit style in `docs/audits/`.

Test scenarios: Test expectation: none -- this unit is evidence gathering.

Verification: Each goal has a status, evidence path, and short rationale.

### U2. Write readiness audit

Goal: Create the durable audit report with findings and next work.

Requirements: R4, R5

Dependencies: U1

Files:

- `docs/audits/2026-06-25-claude-goals-readiness-audit.md`

Approach: Summarize readiness by goal area, call out blockers, and list the
smallest next implementation units needed for MVP readiness.

Patterns to follow: Existing markdown audit reports in `docs/audits/`.

Test scenarios: Test expectation: none -- markdown audit only.

Verification: Audit is specific enough that the next implementation pass can
start without re-discovering missing MVP surfaces.

### U3. Verify project health

Goal: Confirm the current app still builds after the audit and recent artifact
work.

Requirements: R6

Dependencies: U2

Files:

- `package.json`
- `app/**`
- `components/**`

Approach: Run the project typecheck and build. Also smoke-test unauthenticated
artifact endpoints for protected behavior.

Patterns to follow: Existing verification commands in `package.json`.

Test scenarios:

- TypeScript compile succeeds.
- Production build succeeds.
- Unauthenticated artifact endpoints return `401`.

Verification: Commands pass or failures are recorded with exact blocker.

## Scope Boundaries

Included:

- Readiness audit against `CLAUDE.md`.
- Evidence-backed status for current app capabilities.
- Small safe fixes only if discovered during audit.

Deferred to Follow-Up Work:

- Building all missing dataset recipe, query preview, and admin dashboard
  features.
- Creating a Vercel deployment or PR if repository remotes are not configured.
- Formal HIPAA or compliance attestation.

## Risks and Dependencies

- The repository is currently fully untracked, so normal branch-diff review and
  PR automation may not work as intended.
- Some local secrets exist in `.env.local`; audits and reports must avoid
  copying secret values.
- Azure and Vercel production readiness depends on adding the final deployed
  Vercel origin to Azure Storage CORS after deployment.
