# MVP Plan

## Objective

Create a secure, low-cost prototype for six summer interns to build read-only ward health snapshot artifacts from a static PostgreSQL database using AI-assisted SQL/Python/R/Jupyter/marimo workflows, plus approved PHI-scrubbed local analysis workflows that produce reviewed artifacts.

## Phase 1 — Repo and infrastructure decisions

- [x] Create planning repository.
- [x] Capture requirements.
- [x] Research free-tier stack.
- [x] Create pre-scaffold audit plan.
- [x] Create pre-scaffold audit report and checklist.
- [x] Receive full HealthMap export archive for import planning.
- [x] Measure static database size.
- [x] Import export archive into a target hosted Postgres database.
- [ ] Resolve pre-scaffold audit blockers before creating the app scaffold.
- [ ] Decide whether Vercel Hobby is prototype-only or whether to use Vercel Pro for deployed internship use.
- [x] Confirm Foundry/Azure model base names and deployment names from the Azure resource group.
- [ ] Confirm Foundry/Azure per-token pricing for the selected region/agreement.
- [x] Choose artifact storage provider: private Azure Blob with per-user generated paths.
- [x] Choose uploaded HTML artifact serving isolation model: authenticated app route plus sandboxed/locked-down HTML response controls.

## Phase 2 — Data copy

- [x] Export static source database/tables.
- [x] Use provisioned Neon project.
- [x] Import static teaching copy.
- [x] Verify loaded DB size.
- [x] Create `intern_reader` role.
- [x] Confirm `intern_reader` cannot write.
- [ ] Generate schema summary cache.

## Phase 3 — Application scaffold

- [x] Confirm pre-scaffold audit decision allows limited student-guide scaffolding.
- [x] Create Next.js TypeScript app shell.
- [x] Add built-in student guide for Neon MCP and Compound Engineering setup.
- [x] Convert first screen to chat-first assistant UI.
- [x] Embed native assistant skill launchers into the chat interface.
- [x] Focus embedded skills on aldermanic ward health snapshot artifacts.
- [x] Embed the full 27-skill Compound Engineering plugin catalog in the chat interface.
- [x] Add Vercel AI SDK chat route.
- [x] Add Neon serverless schema route.
- [x] Add Neon serverless ward index route.
- [x] Add Neon-backed fixed-user credentials auth.
- [x] Add sandboxed HTML side-panel preview for generated artifacts.
- [ ] Add environment variable validation.
- [x] Add Postgres client.
- [ ] Add app metadata migrations.
- [x] Add seed script for 6 interns and admin.
- [x] Add session auth.

## Phase 4 — AI proxy and usage logging

- [x] Implement server-side Foundry/Azure API client.
- [ ] Add `/api/ai` route.
- [x] Add workflow/task model routing.
- [x] Add token and cost logging.
- [x] Add per-user daily/monthly budget checks.

## Phase 5 — Dataset builder

- [ ] Schema browser.
- [ ] Ward selector.
- [ ] Natural-language dataset request form.
- [ ] SQL generation prompt with row-grain discipline.
- [ ] SQL explanation panel.
- [ ] SQL safety validator.
- [ ] Limited read-only preview endpoint.
- [ ] Save dataset recipe.
- [ ] Generate Python/R/Jupyter/marimo starter code.
- [ ] Generate Word brief outline.
- [ ] Generate PowerPoint deck outline.
- [ ] Generate HTML snapshot scaffold.
- [x] Preview generated fenced HTML artifacts in the portal.

## Phase 6 — Artifact workflow

- [x] HTML artifact upload.
- [x] CSV/XLSX/Parquet/Word/PowerPoint controlled file upload.
- [x] Draft/private artifact state.
- [x] Publish/share artifact state.
- [x] Cohort artifact gallery.
- [ ] Admin artifact view.

## Phase 7 — Admin dashboard

- [ ] User list.
- [ ] Per-user token usage.
- [ ] Per-user query count.
- [ ] Recent failed queries.
- [ ] Export count/size.
- [ ] Budget warnings.

## Phase 8 — Intern pilot

- [ ] Create one test intern account.
- [ ] Run one sample dataset-building task.
- [ ] Export a marimo HTML artifact.
- [ ] Confirm no secrets in browser/network responses.
- [ ] Confirm DB remains unchanged.
- [ ] Confirm admin usage dashboard works.

## MVP acceptance criteria

- Six interns can log in separately.
- Intern can ask for a dataset in plain English.
- Assistant can identify likely tables and generate explained SQL.
- Portal can run a limited read-only preview.
- Portal can save dataset recipes.
- Portal can generate Python/R/Jupyter/marimo code for local or approved Rush-machine analysis.
- Intern can upload and publish HTML artifact.
- Admin can view usage by intern.
- Foundry/Azure key and database credentials are server-side only.

## Deferred

- Cloud Python execution.
- Full browser IDE.
- OAuth/SSO.
- Automated password reset.
- Complex role-based collaboration.
- Advanced PHI/redaction tooling.
- Multi-database support.
