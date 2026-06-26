#!/usr/bin/env node
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL?.trim();
const rawUsers = process.env.INTERN_USERS_JSON?.trim();
const bcryptHashPattern = /^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to seed Neon users.");
  process.exit(1);
}

if (!rawUsers) {
  console.error("INTERN_USERS_JSON is required. Use passwordHash values only.");
  process.exit(1);
}

const users = JSON.parse(rawUsers);

if (!Array.isArray(users) || users.length === 0) {
  console.error("INTERN_USERS_JSON must be a non-empty JSON array.");
  process.exit(1);
}

const usernames = new Set();
const validatedUsers = [];

for (const user of users) {
  const username = typeof user?.username === "string" ? user.username.trim().toLowerCase() : "";
  const passwordHash = typeof user?.passwordHash === "string" ? user.passwordHash : "";
  const workflowMode = ["neon", "phi_local", "dual"].includes(user?.workflowMode) ? user.workflowMode : "dual";

  if (!username || usernames.has(username)) {
    throw new Error("Each user needs a unique non-empty username.");
  }

  usernames.add(username);

  if (typeof user?.displayName !== "string" || !user.displayName.trim()) {
    throw new Error(`User ${username} needs displayName.`);
  }

  if (!["intern", "admin"].includes(user?.role)) {
    throw new Error(`User ${username} needs role intern or admin.`);
  }

  if (user?.workflowMode !== undefined && !["neon", "phi_local", "dual"].includes(user.workflowMode)) {
    throw new Error(`User ${username} needs workflowMode neon, phi_local, or dual.`);
  }

  if (user?.isActive !== undefined && typeof user.isActive !== "boolean") {
    throw new Error(`User ${username} needs isActive to be a boolean when provided.`);
  }

  if (!bcryptHashPattern.test(passwordHash) || Object.hasOwn(user, "password")) {
    throw new Error(`User ${username} needs a bcrypt passwordHash and must not include a plaintext password.`);
  }

  validatedUsers.push({
    username,
    displayName: user.displayName.trim(),
    role: user.role,
    workflowMode,
    passwordHash,
    isActive: user.isActive ?? true,
  });
}

const activeAdmins = validatedUsers.filter((user) => user.role === "admin" && user.isActive !== false);
const activeInterns = validatedUsers.filter((user) => user.role === "intern" && user.isActive !== false);
const hasNeonIntern = activeInterns.some((user) => user.workflowMode === "neon" || user.workflowMode === "dual");
const hasPhiLocalIntern = activeInterns.some((user) => user.workflowMode === "phi_local" || user.workflowMode === "dual");

if (activeAdmins.length < 1) {
  throw new Error("INTERN_USERS_JSON must include at least one active admin account.");
}

if (activeInterns.length < 6) {
  throw new Error("INTERN_USERS_JSON must include at least six active intern accounts.");
}

if (!hasNeonIntern || !hasPhiLocalIntern) {
  throw new Error("INTERN_USERS_JSON must include at least one Neon-enabled intern and one PHI-local workflow intern.");
}

const sql = neon(databaseUrl);

await sql`create schema if not exists app_private`;
await sql`
  create table if not exists app_private.intern_users (
    username text primary key,
    display_name text not null,
    role text not null check (role in ('intern', 'admin')),
    workflow_mode text not null default 'dual' check (workflow_mode in ('neon', 'phi_local', 'dual')),
    password_hash text not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )
`;
await sql`alter table app_private.intern_users add column if not exists workflow_mode text not null default 'dual'`;
await sql`
  do $$
  begin
    alter table app_private.intern_users
      add constraint intern_users_workflow_mode_check
      check (workflow_mode in ('neon', 'phi_local', 'dual'));
  exception
    when duplicate_object then null;
  end $$;
`;
await sql`
  create table if not exists app_private.ai_usage_logs (
    id bigserial primary key,
    username text not null,
    model_tier text not null,
    model_route text not null,
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    total_tokens integer not null default 0,
    estimated_cost_usd numeric not null default 0,
    status text not null,
    created_at timestamptz not null default now()
  )
`;
await sql`
  create table if not exists app_private.query_runs (
    id bigserial primary key,
    username text not null,
    sql_text text not null,
    row_count integer not null default 0,
    duration_ms integer not null default 0,
    status text not null check (status in ('success', 'blocked', 'error')),
    error_message text,
    created_at timestamptz not null default now()
  )
`;
await sql`
  create table if not exists app_private.dataset_recipes (
    id text primary key,
    username text not null,
    title text not null,
    natural_language_request text not null,
    sql_text text not null,
    row_grain text,
    status text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )
`;
await sql`
  create table if not exists app_private.chat_sessions (
    id text not null,
    username text not null,
    title text not null,
    messages jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (username, id)
  )
`;
await sql`create index if not exists chat_sessions_username_updated_idx on app_private.chat_sessions (username, updated_at desc)`;
await sql`
  create table if not exists app_private.workspace_docs (
    id text primary key,
    username text not null,
    project_label text,
    doc_type text not null check (doc_type in ('brainstorm', 'plan', 'work_log', 'review', 'compound_learning', 'handoff')),
    title text not null,
    body_md text not null,
    source_command text,
    visibility text not null default 'private' check (visibility in ('private', 'shared')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )
`;
await sql`create index if not exists workspace_docs_username_updated_idx on app_private.workspace_docs (username, updated_at desc)`;
await sql`create index if not exists workspace_docs_shared_updated_idx on app_private.workspace_docs (visibility, updated_at desc)`;
await sql`
  create table if not exists app_private.file_uploads (
    id text primary key,
    username text not null,
    storage_path text not null unique,
    extension text not null,
    content_type text not null,
    size_bytes integer not null,
    artifact_kind text not null default 'data_file' check (artifact_kind in ('data_file', 'html_artifact', 'word_artifact', 'powerpoint_artifact')),
    visibility text not null default 'private' check (visibility in ('private', 'cohort')),
    display_name text,
    project_label text,
    status text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    published_at timestamptz
  )
`;
await sql`alter table app_private.file_uploads add column if not exists artifact_kind text not null default 'data_file'`;
await sql`alter table app_private.file_uploads add column if not exists visibility text not null default 'private'`;
await sql`alter table app_private.file_uploads add column if not exists display_name text`;
await sql`alter table app_private.file_uploads add column if not exists project_label text`;
await sql`alter table app_private.file_uploads add column if not exists updated_at timestamptz not null default now()`;
await sql`alter table app_private.file_uploads add column if not exists published_at timestamptz`;

for (const user of validatedUsers) {
  await sql`
    insert into app_private.intern_users (
      username,
      display_name,
      role,
      workflow_mode,
      password_hash,
      is_active,
      updated_at
    )
    values (
      ${user.username},
      ${user.displayName},
      ${user.role},
      ${user.workflowMode},
      ${user.passwordHash},
      ${user.isActive ?? true},
      now()
    )
    on conflict (username)
    do update set
      display_name = excluded.display_name,
      role = excluded.role,
      workflow_mode = excluded.workflow_mode,
      password_hash = excluded.password_hash,
      is_active = excluded.is_active,
      updated_at = now()
  `;
}

console.log(`Seeded ${validatedUsers.length} Neon auth user(s) into app_private.intern_users and ensured app_private metadata, chat, workspace, and upload tables exist.`);
