#!/usr/bin/env python3
"""Restore and verify the HealthMap production pg_dump in Neon.

Secrets must be supplied through environment variables or an ignored env file.
The script never prints connection strings or passwords.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

import psycopg2
from psycopg2 import sql


DEFAULT_SCHEMA = "public"
DEFAULT_READONLY_ROLE = "intern_reader"
DEFAULT_DUMP = Path("/Users/JCR/Downloads/Other/healthmap_azure_dev_live_2026-06-25.dump")
DEFAULT_SHARED_ENV = Path.home() / ".config" / "healthmap-neon" / "env"
DEFAULT_NEON_FREE_DATABASE_LIMIT_BYTES = 500_000_000
SYSTEM_SCHEMAS = {"information_schema", "pg_catalog"}


@dataclass
class DumpToc:
    extensions: set[str] = field(default_factory=set)
    tables: set[tuple[str, str]] = field(default_factory=set)
    data_tables: set[tuple[str, str]] = field(default_factory=set)
    sequences: set[tuple[str, str]] = field(default_factory=set)
    indexes: set[tuple[str, str]] = field(default_factory=set)
    constraints: set[tuple[str, str, str]] = field(default_factory=set)


def parse_single_env_file(path: Path | None) -> dict[str, str]:
    if not path or not path.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def parse_env_files(*paths: Path | None) -> dict[str, str]:
    values: dict[str, str] = {}
    for path in paths:
        values.update(parse_single_env_file(path))
    return values


def env_value(name: str, env_file: dict[str, str]) -> str | None:
    return os.environ.get(name) or env_file.get(name) or None


def require_db_url(args: argparse.Namespace, env_file: dict[str, str]) -> str:
    url = args.db_url or env_value("TARGET_DATABASE_URL", env_file) or env_value("DATABASE_URL", env_file)
    if not url:
        raise SystemExit("Set TARGET_DATABASE_URL or DATABASE_URL, or pass --db-url.")
    return url


def find_binary(name: str, override: str | None = None) -> str:
    if override:
        return override

    from_path = shutil.which(name)
    if from_path:
        return from_path

    candidates = sorted(
        Path("/opt/homebrew/Cellar").glob(f"*/**/bin/{name}"),
        key=lambda candidate: str(candidate),
        reverse=True,
    )
    if candidates:
        return str(candidates[0])

    option_name = name.replace("_", "-")
    raise SystemExit(f"{name} was not found. Install libpq/postgresql or pass --{option_name}-bin.")


def ensure_direct_neon_url(url: str) -> None:
    host = urlparse(url).hostname or ""
    if "-pooler." in host:
        raise SystemExit("Use Neon's direct, unpooled connection string for restore/verification, not the -pooler host.")


def run_pg_restore(args: list[str], pg_restore_bin: str) -> str:
    proc = subprocess.run(
        [pg_restore_bin, *args],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return proc.stdout


def parse_toc(dump_path: Path, pg_restore_bin: str) -> DumpToc:
    output = run_pg_restore(["--list", str(dump_path)], pg_restore_bin)
    toc = DumpToc()

    for line in output.splitlines():
        if not line or line.startswith(";") or "; " not in line:
            continue

        entry = line.split("; ", 1)[1].split()
        if len(entry) < 3:
            continue

        kind = entry[2]
        offset = 3
        if kind == "TABLE" and len(entry) > 3 and entry[3] == "DATA":
            kind = "TABLE DATA"
            offset = 4
        elif kind == "FK" and len(entry) > 3 and entry[3] == "CONSTRAINT":
            kind = "FK CONSTRAINT"
            offset = 4
        elif kind == "SEQUENCE" and len(entry) > 3 and entry[3] == "OWNED":
            continue

        if kind == "EXTENSION" and len(entry) > 4:
            toc.extensions.add(entry[4])
        elif kind == "TABLE" and len(entry) > offset + 1:
            toc.tables.add((entry[offset], entry[offset + 1]))
        elif kind == "TABLE DATA" and len(entry) > offset + 1:
            toc.data_tables.add((entry[offset], entry[offset + 1]))
        elif kind == "SEQUENCE" and len(entry) > offset + 1:
            toc.sequences.add((entry[offset], entry[offset + 1]))
        elif kind == "INDEX" and len(entry) > offset + 1:
            toc.indexes.add((entry[offset], entry[offset + 1]))
        elif kind in {"CONSTRAINT", "FK CONSTRAINT"} and len(entry) > offset + 2:
            toc.constraints.add((entry[offset], entry[offset + 1], entry[offset + 2]))

    return toc


def parse_dump_row_counts(dump_path: Path, pg_restore_bin: str) -> dict[tuple[str, str], int]:
    output = run_pg_restore(["--data-only", "--file", "-", str(dump_path)], pg_restore_bin)
    counts: dict[tuple[str, str], int] = defaultdict(int)
    current_table: tuple[str, str] | None = None
    copy_re = re.compile(r"^COPY (?:(?P<schema>[A-Za-z_][A-Za-z0-9_]*)\.)?(?P<table>[A-Za-z_][A-Za-z0-9_]*) ")

    for line in output.splitlines():
        if current_table:
            if line == r"\.":
                current_table = None
            else:
                counts[current_table] += 1
            continue

        match = copy_re.match(line)
        if match:
            current_table = (match.group("schema") or DEFAULT_SCHEMA, match.group("table"))

    return dict(counts)


def connect(url: str):
    return psycopg2.connect(url)


def fetch_set(cur, query: str, params: tuple = ()) -> set:
    cur.execute(query, params)
    return {tuple(row) if len(row) > 1 else row[0] for row in cur.fetchall()}


def restore_dump(args: argparse.Namespace, env_file: dict[str, str]) -> None:
    dump_path = args.dump.resolve()
    if not dump_path.exists():
        raise SystemExit(f"Dump file not found: {dump_path}")
    if not args.yes:
        raise SystemExit("Restore is destructive. Re-run with --yes after confirming the target database is correct.")

    db_url = require_db_url(args, env_file)
    ensure_direct_neon_url(db_url)
    pg_restore_bin = find_binary("pg_restore", args.pg_restore_bin)

    command = [
        "--dbname",
        db_url,
        "--no-owner",
        "--no-privileges",
        "--clean",
        "--if-exists",
        "--exit-on-error",
        "--verbose",
        str(dump_path),
    ]
    if args.single_transaction:
        command.insert(0, "--single-transaction")

    try:
        subprocess.run([pg_restore_bin, *command], check=True)
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"pg_restore failed with exit code {exc.returncode}.") from None

    with connect(db_url) as conn, conn.cursor() as cur:
        cur.execute("analyze")

    print("restore_complete")


def grant_readonly(args: argparse.Namespace, env_file: dict[str, str]) -> None:
    db_url = require_db_url(args, env_file)
    role = args.readonly_role or env_value("READONLY_ROLE", env_file) or DEFAULT_READONLY_ROLE
    password = args.readonly_password or env_value("READONLY_PASSWORD", env_file)
    schema_name = args.schema

    with connect(db_url) as conn, conn.cursor() as cur:
        cur.execute("select 1 from pg_roles where rolname = %s", (role,))
        exists = cur.fetchone() is not None

        if not exists and not password:
            raise SystemExit("READONLY_PASSWORD or --readonly-password is required when creating the role.")

        if exists and password:
            cur.execute(sql.SQL("alter role {} login password %s").format(sql.Identifier(role)), (password,))
        elif not exists:
            cur.execute(sql.SQL("create role {} login password %s").format(sql.Identifier(role)), (password,))

        cur.execute("select current_database()")
        database_name = cur.fetchone()[0]
        cur.execute(
            sql.SQL("grant connect on database {} to {}").format(
                sql.Identifier(database_name),
                sql.Identifier(role),
            )
        )
        cur.execute(sql.SQL("grant usage on schema {} to {}").format(sql.Identifier(schema_name), sql.Identifier(role)))
        cur.execute(
            sql.SQL("grant select on all tables in schema {} to {}").format(
                sql.Identifier(schema_name),
                sql.Identifier(role),
            )
        )
        cur.execute(
            sql.SQL("grant select on all sequences in schema {} to {}").format(
                sql.Identifier(schema_name),
                sql.Identifier(role),
            )
        )
        cur.execute(
            sql.SQL("alter default privileges in schema {} grant select on tables to {}").format(
                sql.Identifier(schema_name),
                sql.Identifier(role),
            )
        )
        cur.execute(
            sql.SQL("alter default privileges in schema {} grant select on sequences to {}").format(
                sql.Identifier(schema_name),
                sql.Identifier(role),
            )
        )

    print(f"readonly_role_ready role={role} schema={schema_name}")


def verify_dump(args: argparse.Namespace, env_file: dict[str, str]) -> None:
    dump_path = args.dump.resolve()
    if not dump_path.exists():
        raise SystemExit(f"Dump file not found: {dump_path}")

    db_url = require_db_url(args, env_file)
    ensure_direct_neon_url(db_url)
    pg_restore_bin = find_binary("pg_restore", args.pg_restore_bin)
    toc = parse_toc(dump_path, pg_restore_bin)
    expected_row_counts = parse_dump_row_counts(dump_path, pg_restore_bin)
    expected_tables = toc.tables | toc.data_tables
    schema_names = sorted({schema for schema, _ in expected_tables})

    failures: list[str] = []
    warnings: list[str] = []

    with connect(db_url) as conn, conn.cursor() as cur:
        actual_extensions = fetch_set(cur, "select extname from pg_extension")
        missing_extensions = toc.extensions - actual_extensions
        if missing_extensions:
            failures.append(f"missing extensions: {sorted(missing_extensions)}")

        actual_tables = fetch_set(
            cur,
            """
            select table_schema, table_name
            from information_schema.tables
            where table_type = 'BASE TABLE'
              and table_schema <> all(%s)
            """,
            (list(SYSTEM_SCHEMAS),),
        )
        missing_tables = expected_tables - actual_tables
        extra_tables = actual_tables - expected_tables
        if missing_tables:
            failures.append(f"missing tables: {sorted(missing_tables)}")
        if extra_tables:
            warnings.append(f"extra non-system tables: {sorted(extra_tables)}")

        actual_sequences = fetch_set(
            cur,
            """
            select sequence_schema, sequence_name
            from information_schema.sequences
            where sequence_schema = any(%s)
            """,
            (schema_names,),
        )
        missing_sequences = toc.sequences - actual_sequences
        if missing_sequences:
            failures.append(f"missing sequences: {sorted(missing_sequences)}")

        actual_indexes = fetch_set(
            cur,
            """
            select schemaname, indexname
            from pg_indexes
            where schemaname = any(%s)
            """,
            (schema_names,),
        )
        missing_indexes = toc.indexes - actual_indexes
        if missing_indexes:
            failures.append(f"missing indexes: {sorted(missing_indexes)}")

        actual_constraints = fetch_set(
            cur,
            """
            select n.nspname, c.relname, con.conname
            from pg_constraint con
            join pg_class c on c.oid = con.conrelid
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = any(%s)
            """,
            (schema_names,),
        )
        missing_constraints = toc.constraints - actual_constraints
        if missing_constraints:
            failures.append(f"missing constraints: {sorted(missing_constraints)}")

        for schema_name, table_name in sorted(expected_row_counts):
            cur.execute(
                sql.SQL("select count(*) from {}.{}").format(
                    sql.Identifier(schema_name),
                    sql.Identifier(table_name),
                )
            )
            actual_count = cur.fetchone()[0]
            expected_count = expected_row_counts[(schema_name, table_name)]
            if actual_count != expected_count:
                failures.append(f"row count mismatch {schema_name}.{table_name}: expected {expected_count}, got {actual_count}")

        cur.execute("select pg_database_size(current_database())")
        database_bytes = cur.fetchone()[0]

    print(f"dump={dump_path}")
    print(f"expected_extensions={len(toc.extensions)}")
    print(f"expected_tables={len(expected_tables)}")
    print(f"expected_sequences={len(toc.sequences)}")
    print(f"expected_indexes={len(toc.indexes)}")
    print(f"expected_constraints={len(toc.constraints)}")
    print(f"row_count_tables_checked={len(expected_row_counts)}")
    print(f"database_bytes={database_bytes}")
    if args.max_database_bytes > 0:
        print(f"database_limit_bytes={args.max_database_bytes}")
        if database_bytes > args.max_database_bytes:
            failures.append(
                "database size exceeds configured limit: "
                f"{database_bytes} bytes > {args.max_database_bytes} bytes"
            )

    for warning in warnings:
        print(f"warning: {warning}")

    if failures:
        for failure in failures:
            print(f"failure: {failure}", file=sys.stderr)
        raise SystemExit(1)

    print("parity_check=pass")


def verify_readonly(args: argparse.Namespace, env_file: dict[str, str]) -> None:
    readonly_url = args.db_url or env_value("READONLY_DATABASE_URL", env_file)
    if not readonly_url:
        raise SystemExit("Set READONLY_DATABASE_URL or pass --db-url.")

    schema_name = args.schema
    with connect(readonly_url) as conn, conn.cursor() as cur:
        cur.execute("select 1")

        for statement in [
            sql.SQL("create table {}.__readonly_should_fail (id int)").format(sql.Identifier(schema_name)),
            sql.SQL("delete from {}.dim_conditions where false").format(sql.Identifier(schema_name)),
        ]:
            try:
                cur.execute(statement)
            except Exception:
                conn.rollback()
            else:
                conn.rollback()
                with connect(readonly_url) as cleanup_conn, cleanup_conn.cursor() as cleanup_cur:
                    cleanup_cur.execute(
                        sql.SQL("drop table if exists {}.__readonly_should_fail").format(sql.Identifier(schema_name))
                    )
                raise SystemExit("READONLY_DATABASE_URL can write; rotate/fix the role before intern access.")

    print(f"readonly_check=pass schema={schema_name}")


def inspect_dump(args: argparse.Namespace, _env_file: dict[str, str]) -> None:
    dump_path = args.dump.resolve()
    if not dump_path.exists():
        raise SystemExit(f"Dump file not found: {dump_path}")

    pg_restore_bin = find_binary("pg_restore", args.pg_restore_bin)
    toc = parse_toc(dump_path, pg_restore_bin)
    row_counts = parse_dump_row_counts(dump_path, pg_restore_bin) if args.count_rows else {}

    print(f"dump={dump_path}")
    print(f"extensions={sorted(toc.extensions)}")
    print(f"tables={len(toc.tables)}")
    print(f"data_tables={len(toc.data_tables)}")
    print(f"sequences={len(toc.sequences)}")
    print(f"indexes={len(toc.indexes)}")
    print(f"constraints={len(toc.constraints)}")
    if row_counts:
        print(f"row_count_tables={len(row_counts)}")
        for (schema_name, table_name), count in sorted(row_counts.items()):
            print(f"{schema_name}.{table_name}={count}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    parser.add_argument("--shared-env-file", type=Path, default=DEFAULT_SHARED_ENV)
    parser.add_argument("--db-url")
    parser.add_argument("--schema", default=DEFAULT_SCHEMA)
    parser.add_argument("--pg-restore-bin")

    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect_parser = subparsers.add_parser("inspect-dump")
    inspect_parser.add_argument("dump", nargs="?", type=Path, default=DEFAULT_DUMP)
    inspect_parser.add_argument("--count-rows", action="store_true")
    inspect_parser.set_defaults(func=inspect_dump)

    restore_parser = subparsers.add_parser("restore")
    restore_parser.add_argument("dump", nargs="?", type=Path, default=DEFAULT_DUMP)
    restore_parser.add_argument("--yes", action="store_true")
    restore_parser.add_argument("--single-transaction", action="store_true", default=True)
    restore_parser.set_defaults(func=restore_dump)

    grant_parser = subparsers.add_parser("grant-readonly")
    grant_parser.add_argument("--readonly-role")
    grant_parser.add_argument("--readonly-password")
    grant_parser.set_defaults(func=grant_readonly)

    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("dump", nargs="?", type=Path, default=DEFAULT_DUMP)
    verify_parser.add_argument(
        "--max-database-bytes",
        type=int,
        default=DEFAULT_NEON_FREE_DATABASE_LIMIT_BYTES,
        help="Fail verification when the restored database is larger than this limit; use 0 to disable.",
    )
    verify_parser.set_defaults(func=verify_dump)

    readonly_parser = subparsers.add_parser("verify-readonly")
    readonly_parser.set_defaults(func=verify_readonly)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    env_file = parse_env_files(args.shared_env_file, args.env_file)
    args.func(args, env_file)


if __name__ == "__main__":
    main()
