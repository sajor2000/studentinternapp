# Summer Intern Data Science Agent Portal — Requirements

Date: 2026-06-24

## Summary

Build a password-protected web portal for six summer interns working on aldermanic ward health snapshot projects. The portal helps interns use a static, de-identified PostgreSQL dataset by generating and explaining SQL, creating dataset recipes, producing Word/PowerPoint/HTML artifact drafts, producing Python/R/Jupyter/marimo starter code, and publishing uploaded artifacts.

The portal is not intended to be a full cloud IDE. Full analysis execution should happen locally on interns' personal computers using Python, R, and marimo notebooks.

The current implementation target is a Next.js frontend on Vercel. A SellChat-style frontend is acceptable only if it preserves the same server-side auth, Foundry/Azure routing, Neon access controls, and private Azure Blob upload model. Interns should not manage API keys, deployment routing, or model selection.

## Goals

- Give each intern an individual login.
- Let interns ask plain-English questions about the database.
- Help interns build datasets even if they do not know SQL.
- Help interns produce leader-facing ward health snapshots for aldermanic audiences.
- Support Word brief, PowerPoint deck, and HTML snapshot outputs.
- Keep source data read-only and static.
- Use Microsoft Foundry/Azure AI through a server-side proxy.
- Track token usage and query activity by intern.
- Keep infrastructure free-tier or near-free except model token costs.
- Support publishing final HTML artifacts for cohort/admin review.
- Keep all uploaded files in private Azure Blob storage under per-user generated paths.
- Support two intern tracks:
  - Neon-enabled HealthMap work for interns approved to explore the read-only teaching database.
  - PHI-scrubbed/local analysis work where interns use AI-generated Python, R, Jupyter, or marimo code on an approved Rush/local machine.

## Users

### Intern

- Has a predefined username and password.
- Can see own chats, dataset recipes, and project workspace.
- Can browse the static database schema.
- Can request SQL/Python/R/Jupyter/marimo help.
- Can request Word, PowerPoint, and HTML ward snapshot artifact drafts.
- Can run limited read-only query previews through the portal.
- Can download or copy code to run locally.
- Can upload files to private per-user Azure Blob paths.
- Can publish reviewed HTML, Word, or PowerPoint artifacts to the cohort.
- Can see published artifacts from other interns.

### Admin

- Can see all intern users.
- Can see all chats, recipes, query metadata, artifacts, and token usage.
- Can rotate passwords.
- Can refresh/reload the static teaching database.
- Can adjust per-user token budgets and limits.

## Data assumptions

- The dataset is de-identified.
- The dataset is static for the internship period or refreshed intentionally by admin.
- Interns cannot change the data.
- The safest initial target is a copy of HealthMap-like tables in hosted PostgreSQL.
- Neon Free is viable only if the loaded teaching copy fits the free storage/compute limits.

## Core workflow

1. Intern logs in.
2. Intern chooses a project/workspace or starts a dataset request.
3. Portal anchors the task in the Compound Engineering loop: brainstorm, plan, work, review, and compound.
4. Intern describes the dataset they want in plain English.
5. Assistant searches schema summaries and proposes candidate tables.
6. Assistant asks for the missing design decision if needed, especially row grain.
7. Assistant generates SQL and explains:
   - row grain,
   - joins,
   - filters,
   - aggregation,
   - limitations and pitfalls.
8. Portal runs a limited read-only preview.
9. Intern confirms or revises.
10. Portal saves the final SQL as a dataset recipe.
11. Portal saves CE workflow notes and compound learnings in the intern's workspace.
12. Portal helps draft Word brief, PowerPoint deck, and HTML snapshot content for the selected ward.
13. Portal generates Python, R, Jupyter, and marimo starter code.
14. Intern runs full analysis locally or on an approved Rush machine.
15. Intern uploads files to the private Azure Blob workflow and publishes reviewed artifacts only when ready.

## Key features

### Authentication

- Predefined intern and admin accounts.
- No signup.
- Password hashes only.
- Server-side session cookie.

### Dataset builder

- Schema browser.
- Plain-English dataset request form.
- SQL generation and explanation.
- Ward health snapshot artifact drafting.
- Word brief, PowerPoint deck, and HTML snapshot structure generation.
- Query preview with row limit.
- Saved dataset recipes.
- Python/R/Jupyter/marimo code generation.

### CE workspace documents

- Each intern has private workspace documents for CE-style work: brainstorm notes, plans, work logs, review checklists, and compound learnings.
- Store these documents as portal metadata, scoped by `user_id` and optional `project_id`, not as files in the application repository.
- Admin can view all workspace documents for mentoring, QA, and usage review.
- Published final artifacts are separate from workspace documents and use the artifact gallery workflow.
- Cohort-shared learnings should be explicitly promoted from private workspace documents; private chats and drafts remain private by default.

### Artifact gallery

- Upload CSV, XLSX, Parquet, Jupyter notebook, Python/R/Quarto source, HTML, Word, and PowerPoint files to private Azure Blob storage through authenticated, short-lived per-user upload URLs.
- Mark artifacts as private draft or shared final.
- Shared final HTML, Word, and PowerPoint artifacts visible to all interns after explicit publish.
- Admin can see all artifacts.

### Cost dashboard

- Per-user token usage.
- Per-workflow model usage.
- Estimated cost.
- Daily and monthly budget warnings.

## Safety requirements

- Foundry/Azure API key stays server-side.
- Database connection used for intern previews is read-only.
- App allows single-statement `SELECT` only for intern query execution.
- Preview queries have default row limits.
- Query execution has timeouts.
- Exports have size limits.
- App logs query metadata, not full raw result payloads by default.
- Intern UI warns against entering PHI, credentials, or re-identification keys.
- Uploaded files are owned by the signed-in user; other interns cannot open private uploads.

## Success criteria

- Six interns can log in with individual accounts.
- An intern can generate a useful SQL dataset recipe without writing SQL manually.
- The portal can preview a small result safely.
- The intern can take generated Python/R/Jupyter/marimo code and run locally or on an approved Rush machine.
- Admin can see token usage and query activity by intern.
- Files can be uploaded per user to private Azure Blob storage.
- Final HTML, Word, or PowerPoint artifacts can be shared with the cohort after review.
- No API keys or write-capable DB credentials are exposed to the browser.

## Non-goals for MVP

- Browser-based arbitrary Python execution.
- Full VS Code/Claude Code clone in the browser.
- Public user registration.
- Real-time collaborative editing.
- Production HIPAA/SOC2 compliance claim.
- Giving interns direct credentials to the source institutional database.

## Open questions

1. Does the static database fit Neon Free's current storage limit after import and indexes?
2. Is Vercel Hobby acceptable for a prototype only, or should the deployed internship app use Vercel Pro for terms/compliance posture?
3. What are the account-specific token prices for the selected Azure deployments?
4. What retention/lifecycle policy should Azure Blob use for uploaded files after the internship ends?
5. What is the maximum row count/file size interns should be allowed to export?
