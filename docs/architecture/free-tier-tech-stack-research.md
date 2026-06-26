# Free-Tier Tech Stack Research

Date: 2026-06-24

## Recommendation

Use this stack for the cheapest practical MVP:

```text
Vercel Hobby/Free for prototype only
  or Vercel Pro for actual institutional intern deployment

Neon Free for static PostgreSQL teaching copy
  if loaded database fits the free storage/compute limits

Microsoft Foundry/Azure AI
  server-side proxy; token cost is the main variable cost

Azure Blob Storage
  for all controlled uploads and final artifacts, with private per-user paths

Local or approved Rush-machine Python/R/Jupyter/marimo
  for full analysis execution
```

## Best overall MVP stack

| Layer | Recommended choice | Why |
|---|---|---|
| Frontend/app | Next.js on Vercel | Implemented path with serverless API routes, easy auth/session implementation, and no client-side secrets |
| Database | Neon Postgres Free | Simple Postgres, good Vercel fit, enough if static dataset is small |
| AI | Microsoft Foundry/Azure AI through backend proxy | Uses existing API plan/key while protecting secrets |
| Auth | Custom credentials or Auth.js Credentials | Six fixed users; no need for OAuth/signup complexity |
| Artifacts and uploads | Azure Blob private container | One provider for CSV, XLSX, Parquet, notebook/source, HTML, Word, and PowerPoint uploads with per-user generated paths |
| Local analysis | Python/R/Jupyter/marimo on personal or approved Rush machines | Avoids expensive and risky cloud code execution |

Frontend note: a SellChat-style frontend can replace or wrap the Next.js UI only if it keeps the same Vercel deployment boundary, authenticated server routes, server-side Foundry/Azure model routing, Neon read-only access, and private Azure Blob upload contract. It should not require interns to configure API keys or model deployments.

## Vercel notes

Public pricing check showed:

- Hobby: free.
- Pro: approximately `$20/user/month`.
- Hobby includes useful free allowances for hosting, CDN, functions, and small blob usage.
- The app no longer depends on Vercel Blob for current uploads because Azure Blob is the selected controlled storage path.

Important terms caveat:

- Vercel Hobby is described in Vercel terms as for personal or non-commercial use.
- For an organized institutional summer intern program, use Hobby only for local/prototype validation unless legal/organizational review says otherwise.
- Budgeting assumption for real use: one Vercel Pro owner/project at about `$20/month`. Interns are app users, not necessarily Vercel seats.

## Neon notes

Public pricing check showed Neon Free as a permanent free plan with no credit card required. Observed free-tier highlights:

- `$0/month`.
- 100 projects.
- 10 branches per project.
- 100 CU-hours/project.
- 0.5 GB storage/project.
- 5 GB public egress included.
- Scale-to-zero after inactivity.
- Postgres extensions and connection pooling are included.

Main limitation:

> The teaching database must fit in about 0.5 GB per project to stay fully free.

If the HealthMap static copy exceeds that limit, options are:

1. Curate a smaller summer-intern subset.
2. Reduce indexes and load only required schemas.
3. Keep large tables as Parquet/DuckDB for local work and only metadata/samples in Neon.
4. Move to Neon Launch/pay-as-you-go.
5. Use Supabase Free if its project shape fits better, though it also has about 500 MB database limit.

## Supabase comparison

Public pricing check showed Supabase Free with:

- `$0/month`.
- 500 MB database size.
- 5 GB egress.
- 1 GB file storage.
- 50,000 monthly active users.
- Limit of 2 active projects.
- Free projects may pause after inactivity.

Supabase is attractive if built-in auth/storage/admin UI are worth using. For this project, Neon is simpler if the main need is a PostgreSQL teaching copy. Azure Blob is already selected for controlled uploads and final artifacts, so Supabase is not needed for MVP storage.

## Microsoft Foundry/Azure AI cost notes

Token costs are excluded from the free-tier hosting goal. Treat model usage as the main variable cost.

Because exact prices depend on the Azure region, deployed model, SKU, and institutional agreement, the app should not hard-code pricing assumptions. Instead:

- Store model price configuration in a database table or env-config file.
- Log input tokens and output tokens for every request.
- Estimate cost from configurable per-1M-token prices.
- Allow admin to update prices without code changes.

Production and Vercel deployments use Microsoft Foundry/Azure routing only. OpenAI environment variables are kept only as a local development fallback and are rejected by production runtime checks.

Selected Azure model-routing policy, based on the resource group deployments visible on 2026-06-25:

| Task | Route | Azure deployment |
|---|---|---|
| Lightweight summaries and outlines | `cheap` | `gpt-5.4-mini` |
| Cached schema utility work | `cheap` | `gpt-5.4-mini` |
| SQL explanation | `code` | `gpt-5.3-codex` |
| Routine intern chat and artifact drafting | `default` | `gpt-5.3-codex` |
| Dataset recipe generation | `default` | `gpt-5.3-codex` |
| Python/R/Jupyter/marimo generation | `code` | `gpt-5.3-codex` |
| Debugging failed SQL or code | `code` | `gpt-5.3-codex` |
| Most Compound Engineering plugin skills | `code` | `gpt-5.3-codex` |
| Code review / optimization / autonomous CE workflow | `code` | `gpt-5.3-codex` |
| Complex SQL joins and statistical synthesis | `strong` | `gpt-5.4` |
| Final QA / second-pass review / admin review | `premium` | `gpt-5.5` |

Keep `gpt-5-mini` and `gpt-4.1` deployed as manual fallbacks if the active deployments fail or regress. Do not route normal intern traffic to either by default.

Cost savers:

- Cache schema summaries.
- Cache table/column descriptions.
- Cache successful dataset recipes.
- Do not send full row-level datasets to the model.
- Send schema plus small samples only when necessary.
- Summarize long chat history.
- Use budget warnings per intern.

## Estimated monthly cost scenarios

These are planning estimates only. Verify current pricing before deployment.

### Scenario A: strict free prototype

| Item | Cost |
|---|---:|
| Vercel Hobby | $0 |
| Neon Free | $0 |
| Artifact storage within free tier | $0 |
| Foundry/Azure tokens | variable |

Use for demo/prototype only.

### Scenario B: recommended real internship MVP

| Item | Cost |
|---|---:|
| Vercel Pro project owner | about $20/month |
| Neon Free | $0 if DB fits |
| Artifact storage | $0 if small |
| Foundry/Azure tokens | variable |

This is the best low-risk plan if Vercel Hobby terms are not appropriate.

### Scenario C: dataset too large

| Item | Cost |
|---|---:|
| Vercel Pro | about $20/month |
| Neon Launch or other paid Postgres | pay-as-you-go |
| Artifact storage | free tier or pay-as-you-go |
| Foundry/Azure tokens | variable |

Use if static database exceeds free-tier database size or query workload exceeds free compute.

## Tech stack decision

Recommended first build:

```text
Next.js + TypeScript
Postgres via Neon
Drizzle or Prisma for app metadata
node-postgres for controlled query execution against read-only role
Auth.js Credentials or simple custom cookie sessions
bcrypt/argon2 for password hashes
Vercel API routes for Foundry proxy and query endpoints
Azure Blob private container for CSV, XLSX, Parquet, notebook/source, HTML, Word, and PowerPoint uploads
```

Do not build cloud Python execution in MVP. Use generated Jupyter/marimo notebooks and local or approved Rush-machine execution.

## Gating checks before implementation

1. Export size of HealthMap static copy.
2. Loaded Neon database size after import.
3. Expected number and size of uploaded files and final artifacts.
4. Foundry model names, regions, and token prices available to the account.
5. Whether Vercel Hobby can be used for prototype only or Pro is required.
6. Azure Blob retention, lifecycle, and access review policy.
