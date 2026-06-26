#!/usr/bin/env node
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is required to initialize app_private tables.");
  process.exit(1);
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
await sql`
  do $$
  begin
    alter table app_private.file_uploads
      add constraint file_uploads_artifact_kind_check
      check (artifact_kind in ('data_file', 'html_artifact', 'word_artifact', 'powerpoint_artifact'));
  exception
    when duplicate_object then null;
  end $$;
`;
await sql`
  do $$
  begin
    alter table app_private.file_uploads
      add constraint file_uploads_visibility_check
      check (visibility in ('private', 'cohort'));
  exception
    when duplicate_object then null;
  end $$;
`;
await sql`
  do $$
  begin
    alter table app_private.file_uploads
      add constraint file_uploads_status_check
      check (status in ('uploaded', 'published'));
  exception
    when duplicate_object then null;
  end $$;
`;
await sql`
  do $$
  begin
    alter table app_private.file_uploads
      add constraint file_uploads_size_bytes_check
      check (size_bytes > 0);
  exception
    when duplicate_object then null;
  end $$;
`;

console.log("Initialized app_private.intern_users, app_private.ai_usage_logs, app_private.query_runs, app_private.dataset_recipes, app_private.chat_sessions, app_private.workspace_docs, and app_private.file_uploads.");
