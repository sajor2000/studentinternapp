#!/usr/bin/env python3
"""Shared local Neon access helper for Codex and Claude Code.

Stores no secrets by default. Use `init` to create a private env template, then
fill it in manually. Other commands read that ignored file and validate/sync it.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from urllib.parse import urlparse

import psycopg2


DEFAULT_SHARED_ENV = Path.home() / ".config" / "healthmap-neon" / "env"
REPO_ENV = Path(".env.local")


PRIVATE_TEMPLATE = """# HealthMap Neon access for local agents.
# This file is intentionally outside git. Do not paste these values into chat.

# Direct, unpooled owner URL for restore, grants, schema verification, and migrations.
# Host must NOT contain -pooler.
TARGET_DATABASE_URL=""

# Optional direct owner URL alias for tools that expect DATABASE_URL.
# Usually same as TARGET_DATABASE_URL for local admin work.
DATABASE_URL=""

# Pooled read-only intern URL for app/runtime queries.
# Host should contain -pooler and user should be intern_reader.
READONLY_DATABASE_URL=""

# Optional password used by `npm run db:grant-readonly`.
# Leave blank after the role has been created/rotated if you prefer.
READONLY_PASSWORD=""

HEALTHMAP_SCHEMA="public"
"""


def parse_env(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def quote_env(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def write_env(path: Path, values: dict[str, str]) -> None:
    lines = [
        "# Synced from ~/.config/healthmap-neon/env by tools/neon_access.py.",
        "# Do not commit this file.",
    ]
    for key in [
        "TARGET_DATABASE_URL",
        "DATABASE_URL",
        "READONLY_DATABASE_URL",
        "READONLY_PASSWORD",
        "HEALTHMAP_SCHEMA",
    ]:
        if key in values:
            lines.append(f"{key}={quote_env(values[key])}")
    path.write_text("\n".join(lines) + "\n")
    path.chmod(0o600)


def merge_env_file(path: Path, updates: dict[str, str]) -> None:
    existing_lines = path.read_text().splitlines() if path.exists() else []
    seen: set[str] = set()
    output: list[str] = []

    for line in existing_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            output.append(line)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in updates:
            output.append(f"{key}={quote_env(updates[key])}")
            seen.add(key)
        else:
            output.append(line)

    if output and output[-1].strip():
        output.append("")
    for key, value in updates.items():
        if key not in seen:
            output.append(f"{key}={quote_env(value)}")

    path.write_text("\n".join(output) + "\n")
    path.chmod(0o600)


def redact_url(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.hostname or "unknown-host"
    db = parsed.path.lstrip("/") or "unknown-db"
    user = parsed.username or "unknown-user"
    return f"{user}@{host}/{db}"


def is_pooled(url: str) -> bool:
    return "-pooler." in (urlparse(url).hostname or "")


def validate_values(values: dict[str, str]) -> list[str]:
    problems: list[str] = []
    target = values.get("TARGET_DATABASE_URL") or values.get("DATABASE_URL") or ""
    readonly = values.get("READONLY_DATABASE_URL") or ""

    if not target:
        problems.append("TARGET_DATABASE_URL is required for restore/grant/verify admin work.")
    elif is_pooled(target):
        problems.append("TARGET_DATABASE_URL must be direct/unpooled; remove -pooler or copy the direct Neon URL.")

    if not readonly:
        problems.append("READONLY_DATABASE_URL is required for app/runtime intern access.")
    elif not is_pooled(readonly):
        problems.append("READONLY_DATABASE_URL should be the pooled -pooler URL for app/runtime use.")

    return problems


def load_values(args: argparse.Namespace) -> dict[str, str]:
    env_file = args.env_file
    values = parse_env(env_file)
    for key in [
        "TARGET_DATABASE_URL",
        "DATABASE_URL",
        "READONLY_DATABASE_URL",
        "READONLY_PASSWORD",
        "HEALTHMAP_SCHEMA",
    ]:
        if os.environ.get(key):
            values[key] = os.environ[key]
    return values


def init(args: argparse.Namespace) -> None:
    path = args.env_file
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not args.force:
        print(f"exists={path}")
        print("Use --force to overwrite the template.")
        return
    path.write_text(PRIVATE_TEMPLATE)
    path.chmod(0o600)
    print(f"created={path}")


def status(args: argparse.Namespace) -> None:
    values = load_values(args)
    print(f"shared_env={args.env_file}")
    for key in [
        "TARGET_DATABASE_URL",
        "DATABASE_URL",
        "READONLY_DATABASE_URL",
        "READONLY_PASSWORD",
        "HEALTHMAP_SCHEMA",
    ]:
        value = values.get(key, "")
        if key.endswith("URL") and value:
            print(f"{key}=<set {redact_url(value)} pooled={is_pooled(value)}>")
        elif value:
            print(f"{key}=<set>")
        else:
            print(f"{key}=<empty>")
    problems = validate_values(values)
    if problems:
        for problem in problems:
            print(f"problem={problem}")
        raise SystemExit(1)
    print("status=ok")


def sync_repo(args: argparse.Namespace) -> None:
    values = load_values(args)
    problems = validate_values(values)
    if problems:
        for problem in problems:
            print(f"problem={problem}")
        raise SystemExit(1)
    if not args.yes:
        print("This writes ignored .env.local with Neon access values. Re-run with --yes.")
        raise SystemExit(1)
    repo_values = {
        "TARGET_DATABASE_URL": values.get("TARGET_DATABASE_URL") or values.get("DATABASE_URL", ""),
        "DATABASE_URL": values.get("DATABASE_URL") or values.get("TARGET_DATABASE_URL", ""),
        "READONLY_DATABASE_URL": values.get("READONLY_DATABASE_URL", ""),
        "HEALTHMAP_SCHEMA": values.get("HEALTHMAP_SCHEMA", "public"),
    }
    if values.get("READONLY_PASSWORD"):
        repo_values["READONLY_PASSWORD"] = values["READONLY_PASSWORD"]
    merge_env_file(args.repo_env, repo_values)
    print(f"synced={args.repo_env}")


def check_connection(label: str, url: str, schema: str) -> None:
    with psycopg2.connect(url, connect_timeout=20) as conn, conn.cursor() as cur:
        cur.execute("select current_database(), current_user")
        database, user = cur.fetchone()
        cur.execute(
            """
            select count(*)
            from information_schema.tables
            where table_schema = %s
              and table_type = 'BASE TABLE'
              and table_name not in (
                'spatial_ref_sys',
                'geometry_columns',
                'geography_columns',
                'raster_columns',
                'raster_overviews'
              )
            """,
            (schema,),
        )
        schema_tables = cur.fetchone()[0]
        print(f"{label}=ok database={database} user={user} schema={schema} schema_tables={schema_tables}")


def check(args: argparse.Namespace) -> None:
    values = load_values(args)
    problems = validate_values(values)
    if problems:
        for problem in problems:
            print(f"problem={problem}")
        raise SystemExit(1)
    target = values.get("TARGET_DATABASE_URL") or values["DATABASE_URL"]
    readonly = values["READONLY_DATABASE_URL"]
    schema = values.get("HEALTHMAP_SCHEMA", "public")
    check_connection("target_direct", target, schema)
    check_connection("readonly_pooled", readonly, schema)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_SHARED_ENV)
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init")
    init_parser.add_argument("--force", action="store_true")
    init_parser.set_defaults(func=init)

    status_parser = subparsers.add_parser("status")
    status_parser.set_defaults(func=status)

    sync_parser = subparsers.add_parser("sync-repo")
    sync_parser.add_argument("--repo-env", type=Path, default=REPO_ENV)
    sync_parser.add_argument("--yes", action="store_true")
    sync_parser.set_defaults(func=sync_repo)

    check_parser = subparsers.add_parser("check")
    check_parser.set_defaults(func=check)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
