# Pre-Scaffold Audit Checklist

Use this checklist before creating or regenerating the application scaffold.

## Database Fit

- [x] Source database or representative export archive is available.
- [x] Source export size or source database total size is recorded.
- [x] Largest loaded table sizes are recorded.
- [x] Export archive contents and largest files are recorded.
- [x] Imported schema/table subset is chosen.
- [x] Target hosted database size is estimated after import.
- [x] Target hosted database loaded size is verified after import.
- [x] Neon Free viability is decided for the current unindexed import.
- [ ] Alternate path is chosen if the data does not fit the free tier.

## Read-Only Data Access

- [ ] `DATABASE_URL` is reserved for app metadata and migrations.
- [ ] `READONLY_DATABASE_URL` is reserved for intern-facing previews.
- [x] Read-only database role can connect.
- [x] Read-only database role has schema usage only for approved schemas.
- [x] Read-only database role has select privileges only.
- [x] Write-class statements fail when connected as the read-only role.
- [ ] Query preview timeout policy is selected.

## Hosting and Provider Fit

- [ ] Vercel Hobby vs Pro deployment posture is decided.
- [ ] Current Vercel terms and limits are checked and dated.
- [ ] Current Neon storage and compute limits are checked and dated.
- [ ] Artifact provider options are checked and dated.
- [ ] Provider assumptions are recorded in the dated audit report.

## Security Architecture

- [ ] No sensitive variable in `.env.example` uses `NEXT_PUBLIC_`.
- [ ] Fixed-user/no-signup auth posture is preserved.
- [ ] Passwords are hashes only.
- [ ] Password rotation has a server-side hash replacement workflow.
- [ ] Session cookies are HTTP-only and secure in deployed environments.
- [ ] Server-side authorization is required for all data access and route handlers.
- [ ] App-level SQL safety validation is required even with a read-only database role.
- [ ] Query preview logs exclude full raw result payloads by default.

## AI Proxy and Cost Controls

- [ ] Foundry/Azure endpoint is confirmed.
- [ ] API version is confirmed.
- [x] Cheap/default/code/strong/premium model deployments are confirmed.
- [ ] Input/output/cached-input prices are recorded from account-specific pricing.
- [ ] Token usage logging fields are defined.
- [ ] Daily per-user and monthly total budgets are selected.
- [ ] AI and premium-model kill switches are defined.
- [ ] Prompt policy excludes full row-level extracts by default.

## Artifact Workflow

- [ ] Expected artifact count is estimated.
- [ ] Maximum HTML artifact size is selected.
- [ ] Artifact storage provider is selected.
- [ ] Private draft visibility is the default.
- [ ] Shared final visibility is explicit.
- [ ] Admin visibility is defined.
- [ ] Uploaded HTML serving isolation is selected.
- [ ] Artifact-sharing rollback action is documented.

## Readiness Decision

- [ ] Dated audit report is written.
- [ ] Hard blockers are listed.
- [ ] Accepted assumptions are listed with owner and revisit condition.
- [ ] Planning docs are updated only where audited facts supersede prior assumptions.
- [ ] Final decision is one of: proceed, proceed with accepted assumptions, blocked.
