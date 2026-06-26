# System Architecture

## Target architecture

```text
Intern Browser
  |
  | HTTPS
  v
Vercel Next.js App
  |-- Login/session UI
  |-- Native Vercel AI SDK chat-first intern assistant UI
  |-- Sandboxed HTML artifact preview panel
  |-- Ward snapshot artifact workspace
  |-- Dataset builder UI
  |-- Chat/coding assistant UI
  |-- Artifact gallery
  |-- Admin dashboard
  |
  | Server-side API routes only
  v
Application Backend
  |-- Auth/session validation
  |-- Vercel AI SDK chat route
  |-- Server-side Microsoft Foundry/Azure provider configuration
  |-- Cheap/default/code/strong/premium model router
  |-- SQL safety validator
  |-- Query preview executor
  |-- Token/cost logger
  |-- Artifact metadata manager
  |
  +--> Microsoft Foundry/Azure AI
  |
  +--> Neon Postgres
  |      |-- Static teaching data
  |      |-- App metadata
  |      |-- Users/password hashes
  |      |-- Dataset recipes
  |      |-- CE workspace documents
  |      |-- AI usage logs
  |      |-- Query run logs
  |
  +--> Artifact storage
         |-- Per-user private uploads
         |-- HTML, Word, and PowerPoint reports
         |-- Optional CSV, XLSX, Parquet, notebook/source, screenshots, and assets

Intern Personal PC
  |-- Python/R
  |-- marimo notebooks
  |-- local CSV/Parquet analysis files
```

## Component responsibilities

### Next.js frontend

- Login page.
- Neon-backed credentials login for predefined intern/admin accounts.
- Native Next.js/Vercel chat-first assistant interface using `@ai-sdk/react`.
- ChatGPT-style message surface with copyable code blocks and a sandboxed HTML preview panel.
- Embedded assistant skills for ward snapshots, Word briefs, PowerPoint decks, HTML snapshots, ward SQL, and artifact review.
- Embedded full Compound Engineering plugin catalog with all 27 skill launchers.
- CE workspace surface for brainstorm notes, plans, work logs, reviews, and compound learnings.
- Ward index and ward snapshot artifact controls.
- Built-in student setup guide for Neon MCP and Compound Engineering plugin workflows.
- Project selector.
- Dataset request form.
- Schema browser.
- SQL explanation and preview display.
- Saved recipe list.
- Python/R/Jupyter/marimo code display.
- Artifact upload/publish UI.
- Admin usage dashboard.

A SellChat-style frontend should be treated as a future wrapper or replacement only if it preserves the same Vercel deployment, server-side session checks, Foundry/Azure routing, Neon read-only query path, and private Azure Blob upload contract. The current MVP should keep the native Next.js/Vercel chat code so interns do not need to configure model routes or API keys.

### Server-side API routes

- `/api/login` — verifies credentials against Neon metadata users and creates a session.
- `/api/logout` — clears session.
- `/api/me` — returns the current signed-in user.
- `/api/schema` — returns approved schema metadata from Neon through `READONLY_DATABASE_URL`.
- `/api/wards` — returns aldermanic ward IDs, names, alderman names, and population from Neon.
- `/api/chat` — streams assistant responses through Vercel AI SDK and the configured Microsoft Foundry/Azure provider; production/Vercel deployments reject OpenAI routing.
- `/api/ai` — authenticated lower-level generation route for non-chat automation; applies server-side Foundry/Azure routing, prompt limits, PII masking, per-user rate limits, budget checks, and usage logging.
- `/api/dataset-recipes` — create/list/update saved SQL recipes.
- `/api/workspace-docs` — create/list/update CE workspace documents such as brainstorms, plans, reviews, and compound learnings.
- `/api/query-preview` — validates and runs read-only limited SQL previews.
- `/api/files/upload-url` — creates authenticated, short-lived Azure Blob SAS upload targets under the signed-in user's generated prefix.
- `/api/files/complete` — records uploaded file metadata for the signed-in user.
- `/api/artifacts` — list/publish artifact metadata.
- `/api/artifacts/open` — streams private Blob artifacts only when the signed-in user is the owner, an admin, or the artifact is cohort-published.
- `/api/admin/usage` — admin-only token and query usage.

### Neon Postgres

Use one database if free-tier simplicity matters:

- `app_private.intern_users` stores predefined intern/admin accounts, bcrypt password hashes, role, active flag, and timestamps.
- `app_private.ai_usage_logs` stores model route, tokens, estimated cost, status, and timestamp for budget checks.
- `app_private` also holds recipes, CE workspace documents, and artifact metadata.

- `app` schema for metadata.
- `public` schema for the static HealthMap Azure copy.

Use separate roles:

- `app_owner`: migrations and metadata writes.
- `intern_reader`: select-only static data role for query previews.
- Optional `admin_loader`: data import/refresh role.

The HealthMap teaching copy is static for the internship run, so schema summaries
and ward index lookups are cached in the server process for `SCHEMA_CACHE_TTL_SECONDS`
seconds. A value of `0` disables the cache for troubleshooting; normal deployments
should use the default one-hour TTL or higher after data refreshes are complete.

### AI proxy and model routing

The frontend never calls Foundry, Azure, or any model provider directly. The backend:

1. Authenticates the intern session.
2. Applies the AI kill switch and prompt size limits.
3. Applies per-user request rate limits.
4. Applies budget limits from `app_private.ai_usage_logs`.
5. Chooses a model tier by task type.
6. Sends minimal necessary context.
7. Logs tokens/model/cost estimate when chat streaming or direct generation finishes.
8. Returns response to browser.

The Azure/Foundry route uses the Foundry Responses REST contract:

- Endpoint: `https://equityclaudeagent.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview`
- Auth: `Authorization: Bearer <AZURE_AI_API_KEY or AZURE_API_KEY>`
- Request model field: the selected model base name, such as `gpt-5.3-codex`

Current Azure route policy, based on the resource group deployments visible on 2026-06-25:

Available Azure model base names/deployments in this resource group:

- `gpt-4.1`
- `gpt-5-mini`
- `gpt-5.3-codex`
- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5.5`

| Tier | Azure deployment | Use for |
|---|---|---|
| `cheap` | `gpt-5.4-mini` | Lightweight summaries, outlines, quick explanations, and cached schema utility work |
| `default` | `gpt-5.3-codex` | Routine intern chat, ward artifact drafts, dataset recipe generation, ordinary SQL/code help, and most CE skills |
| `code` | `gpt-5.3-codex` | Python/R/Jupyter/marimo generation, SQL debugging, code review, optimization, repeated failures, and autonomous CE commands |
| `strong` | `gpt-5.4` | Complex joins, statistical reasoning, analysis planning, cross-table synthesis |
| `premium` | `gpt-5.5` | Explicit final QA, second-pass review, red-team review, or admin review only |

`AI_MAX_MODEL_TIER` can cap the selected tier server-side. For example, `AI_MAX_MODEL_TIER=code` preserves CE and notebook coding help while preventing strong/premium escalation; `AI_MAX_MODEL_TIER=cheap` is an emergency low-cost mode. `AI_CHAT_ENABLED=false` disables `/api/chat` before prompts, schema context, or model calls are processed. `AI_MAX_CHAT_MESSAGES` and `AI_MAX_CHAT_TEXT_CHARS` reject oversized chat histories before schema lookup, model routing, or Foundry/Azure calls. `AI_RATE_LIMIT_REQUESTS` and `AI_RATE_LIMIT_WINDOW_SECONDS` throttle authenticated AI calls before provider work; `QUERY_RATE_LIMIT_REQUESTS` and `QUERY_RATE_LIMIT_WINDOW_SECONDS` do the same for read-only preview queries. `UPLOAD_RATE_LIMIT_REQUESTS` and `UPLOAD_RATE_LIMIT_WINDOW_SECONDS` throttle upload URL issuance and generated artifact saves before new Blob write opportunities are created. Interns do not see or manage these settings.

Keep the deployed `gpt-5-mini` and `gpt-4.1` models as manual fallbacks if active deployments have an incident or compatibility issue. Do not route normal intern traffic to either by default.

## Suggested database metadata tables

```sql
users (
  id uuid primary key,
  username text unique not null,
  display_name text not null,
  password_hash text not null,
  role text not null check (role in ('intern', 'admin')),
  workflow_mode text not null default 'dual' check (workflow_mode in ('neon', 'phi_local', 'dual')),
  token_budget_usd numeric,
  created_at timestamptz default now()
);

projects (
  id uuid primary key,
  name text not null,
  description text,
  created_by uuid references users(id),
  created_at timestamptz default now()
);

dataset_recipes (
  id uuid primary key,
  user_id uuid references users(id),
  project_id uuid references projects(id),
  title text not null,
  natural_language_request text not null,
  sql_text text not null,
  row_grain text,
  status text not null default 'draft',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

workspace_docs (
  id uuid primary key,
  user_id uuid references users(id),
  project_id uuid references projects(id),
  doc_type text not null check (
    doc_type in (
      'brainstorm',
      'plan',
      'work_log',
      'review',
      'compound_learning',
      'handoff'
    )
  ),
  title text not null,
  body_md text not null,
  source_command text,
  visibility text not null default 'private' check (visibility in ('private', 'shared')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

query_runs (
  id uuid primary key,
  user_id uuid references users(id),
  recipe_id uuid references dataset_recipes(id),
  sql_text text not null,
  row_count integer,
  status text not null,
  error_message text,
  duration_ms integer,
  created_at timestamptz default now()
);

ai_usage (
  id uuid primary key,
  user_id uuid references users(id),
  workflow text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  estimated_cost numeric,
  created_at timestamptz default now()
);

artifacts (
  id uuid primary key,
  user_id uuid references users(id),
  project_id uuid references projects(id),
  title text not null,
  storage_path text not null,
  visibility text not null check (visibility in ('private', 'shared')),
  artifact_type text not null default 'html',
  created_at timestamptz default now()
);
```

The implementation stores uploaded files in `app_private.file_uploads` with username, private Blob storage path, extension, content type, size, artifact kind, visibility, status, display name, project label, and publish timestamps. Blob paths are generated per user and do not expose original file names. User path segments use a readable username slug plus a short stable hash so distinct accounts that sanitize to the same label still have separate Blob namespaces.

## SQL preview flow

1. User submits SQL or asks agent to generate SQL.
2. Backend validates session.
3. Backend parses SQL.
4. Backend rejects anything except one `SELECT` statement.
5. Backend injects or enforces preview limit.
6. Backend runs query using `intern_reader` connection.
7. Backend returns rows and column metadata.
8. Backend logs metadata only.

## Why no cloud Python execution in MVP

Cloud Python execution would require sandboxing, dependency management, file isolation, resource limits, and stronger abuse controls. For six interns, local marimo notebooks are cheaper and safer.

MVP should generate code and artifacts, not run arbitrary intern code in the cloud.
