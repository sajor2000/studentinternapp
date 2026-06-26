# Data Migration Runbook

Goal: copy the static HealthMap-style PostgreSQL dataset into a free/cheap hosted Postgres teaching database, preferably Neon Free if it fits.

Current source of truth for live-DB parity:

- `/Users/JCR/Downloads/Other/healthmap_azure_dev_live_2026-06-25.dump`
- PostgreSQL custom-format dump created 2026-06-25 directly from Azure `healthmap_dev`.
- Dumped with table data, schema, indexes, constraints, and PostGIS-shaped column/index definitions. Neon must have `postgis` and `pg_trgm` enabled before restore.
- Sequence data was excluded because the live Entra user has table read access but not sequence read access; this does not affect the read-only intern teaching copy.
- Native schema is `public`.

Use this dump for the Neon teaching copy when the requirement is “same as the readable Azure DB.” The older ZIP export remains useful as a portable CSV/Parquet artifact, but it cannot preserve exact PostgreSQL DDL, constraints, indexes, defaults, extension-owned objects, or sequence definitions. The older `/Users/JCR/Downloads/Other/healthmap_pg_prod (1).dump` is stale relative to current live `healthmap_dev` and should not be used for the intern Neon copy.

## 1. Measure source database size

Run against the source database:

```sql
select pg_size_pretty(pg_database_size(current_database())) as database_size;

select
  schemaname,
  relname as table_name,
  pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, relname))) as total_size,
  pg_total_relation_size(format('%I.%I', schemaname, relname)) as bytes
from pg_stat_user_tables
order by bytes desc;
```

Free-tier target check:

- Neon Free currently has about 0.5 GB storage/project.
- Supabase Free also has about 500 MB database size.
- If the loaded copy plus indexes exceeds that, curate a subset or move to paid Postgres.

## 2. Export static data

Preferred export for full PostgreSQL copy:

```bash
pg_dump "$SOURCE_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file=healthmap_static.dump
```

For selected schemas only:

```bash
pg_dump "$SOURCE_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema=public \
  --file=healthmap_static.dump
```

Do not commit `.dump`, `.csv`, `.parquet`, or private data files.

Current export artifact:

- `healthmap_dev_export_2026-06-04.zip` is a portable export, not a `pg_dump`.
- It contains `manifest.json`, 34 CSV data files, and 34 Parquet data files.
- The manifest records table names, row counts, and column names, but not complete Postgres column types.
- Use this artifact for a CSV or Parquet-derived import path. Do not run `pg_restore` against it.

Archive-based import outline:

1. Extract the archive outside the repository.
2. Create target table DDL from the source schema, Parquet schema inference, or an audited generated DDL file.
3. Load CSV data into the target tables with `\copy` or a controlled loader.
4. Add only necessary indexes and constraints for intern queries.
5. Measure loaded size before deciding Neon Free fit.

## 3. Create hosted Postgres target

Create Neon project/database, then initialize shared local access:

```bash
npm run neon:access-init
```

Fill `/Users/JCR/.config/healthmap-neon/env` with:

- `TARGET_DATABASE_URL`: direct, unpooled owner URL for restore/grant/verify.
- `DATABASE_URL`: direct owner URL for local metadata/admin work, usually same as `TARGET_DATABASE_URL`.
- `READONLY_DATABASE_URL`: pooled `-pooler` URL for the `intern_reader` role and app runtime.
- `HEALTHMAP_SCHEMA=public`.

Validate and sync the repo-local ignored `.env.local`:

```bash
npm run neon:access-status
npm run neon:access-sync -- --yes
npm run neon:access-check
```

Use Neon's direct, unpooled connection string for restore operations. Do not use a `-pooler` host for `pg_restore`. Use the pooled `READONLY_DATABASE_URL` for app/runtime intern access.

For `pg_dump` artifacts, restore:

```bash
pg_restore \
  --dbname "$TARGET_DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  healthmap_static.dump
```

For the older `healthmap_dev_export_2026-06-04.zip` artifact, use the archive-based import outline above instead.

Production-dump restore path:

```bash
npm run db:inspect-dump -- "/Users/JCR/Downloads/Other/healthmap_azure_dev_live_2026-06-25.dump" --count-rows

npm run db:restore-neon -- "/Users/JCR/Downloads/Other/healthmap_azure_dev_live_2026-06-25.dump" --yes

npm run db:verify-neon -- "/Users/JCR/Downloads/Other/healthmap_azure_dev_live_2026-06-25.dump"
```

The verification command compares the dump TOC against Neon for tables, sequences, indexes, constraints, and row counts parsed from dump `COPY` sections. Check required extensions separately with `select extname from pg_extension order by extname;`.

Historical 2026-06-25 ZIP-derived import result, superseded for live-DB parity:

- Imported 34 base tables into an older teaching-friendly schema shape.
- Converted geometry to WKT/text-style export columns instead of preserving native PostGIS types.
- This import was removed from active Neon production when the Azure PostGIS-shaped copy was restored.

Current Azure PostGIS-shaped Neon result, verified 2026-06-25:

- Target schema: `public`.
- Imported 34 HealthMap user tables plus PostGIS extension metadata.
- Required extensions: `postgis`, `pg_trgm`, `plpgsql`.
- Dump parity: 34 tables, 7 sequences, 57 indexes, 64 constraints, and all 34 table row counts pass.
- Full live Azure `healthmap_dev` audit against Neon passes for all 34 readable user tables.
- Measured database size: 297,238,528 bytes, about 283 MB.
- This fits under Neon Free's 512 MB project limit only while avoiding a second full backup branch in the same project.

## 4. Create read-only role

Run as database owner/admin:

```sql
create role intern_reader login password 'replace-with-generated-password';

-- Replace `healthmap_intern_2026_summer` with the actual Neon database name.
grant connect on database healthmap_intern_2026_summer to intern_reader;
grant usage on schema public to intern_reader;
grant select on all tables in schema public to intern_reader;
grant select on all sequences in schema public to intern_reader;

alter default privileges in schema public grant select on tables to intern_reader;
alter default privileges in schema public grant select on sequences to intern_reader;
```

The scripted setup below discovers the current database name automatically.

Scripted setup:

```bash
READONLY_PASSWORD='replace-with-generated-password' \
python3 tools/neon_healthmap_sync.py grant-readonly
```

Set the application environment to:

```text
HEALTHMAP_SCHEMA=public
READONLY_DATABASE_URL=<pooled Neon URL for the intern_reader role>
```

## 5. Verify no writes

Connect using `READONLY_DATABASE_URL`, then test:

```sql
select 1;

-- This should fail:
create table should_fail (id int);

-- This should fail:
delete from some_table where false;
```

Scripted verification:

```bash
READONLY_DATABASE_URL='<pooled Neon URL for the intern_reader role>' \
npm run db:verify-readonly
```

## 6. Generate schema summary

The application should cache:

- schemas,
- tables,
- columns,
- data types,
- approximate row counts,
- primary/foreign keys if available,
- short admin-written descriptions where possible.

Useful SQL:

```sql
select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema not in ('pg_catalog', 'information_schema')
order by table_schema, table_name, ordinal_position;
```

## 7. Refresh policy

Because the teaching data is static, prefer explicit admin refreshes rather than live sync.

Suggested naming:

```text
healthmap_intern_2026_summer
```

Record source extraction date and source database in an admin-only metadata table.
