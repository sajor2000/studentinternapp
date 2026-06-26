#!/usr/bin/env python3
"""Import the HealthMap CSV/Parquet export archive into Postgres.

The script intentionally reads the database URL from TARGET_DATABASE_URL so
credentials are not stored in the repository or command-line arguments.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import tempfile
import zipfile
from pathlib import Path

import psycopg2
from psycopg2 import sql
import pyarrow.parquet as pq


NESTED_PREFIXES = ("list<", "struct<")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("--schema", default="healthmap")
    parser.add_argument("--replace", action="store_true")
    return parser.parse_args()


def pg_type(arrow_type: object) -> str:
    type_name = str(arrow_type)
    if type_name == "bool":
        return "boolean"
    if type_name == "int64":
        return "bigint"
    if type_name == "double":
        return "double precision"
    if type_name == "string":
        return "text"
    if type_name == "date32[day]":
        return "date"
    if type_name.startswith("timestamp["):
        return "timestamptz" if "tz=" in type_name else "timestamp"
    if type_name == "null" or type_name.startswith(NESTED_PREFIXES):
        return "text"
    raise ValueError(f"Unhandled Arrow type: {type_name}")


def load_manifest(zip_path: Path) -> dict:
    with zipfile.ZipFile(zip_path) as archive:
        with archive.open("manifest.json") as fh:
            return json.load(fh)


def table_names(zip_path: Path, manifest: dict) -> list[str]:
    with zipfile.ZipFile(zip_path) as archive:
        parquet_tables = {
            Path(name).stem
            for name in archive.namelist()
            if name.startswith("parquet/") and name.endswith(".parquet")
        }
        csv_tables = {
            Path(name).stem
            for name in archive.namelist()
            if name.startswith("csv/") and name.endswith(".csv")
        }
    manifest_tables = set(manifest["tables"].keys())
    missing = sorted(manifest_tables - parquet_tables - csv_tables)
    if missing:
        raise RuntimeError(f"Manifest tables missing data files: {missing}")
    return sorted(manifest_tables & parquet_tables & csv_tables)


def read_csv_columns(path: Path) -> list[str]:
    with path.open(newline="") as fh:
        return next(csv.reader(fh))


def create_table(cur, schema: str, table: str, fields) -> None:
    columns = [
        sql.SQL("{} {}").format(sql.Identifier(field.name), sql.SQL(pg_type(field.type)))
        for field in fields
    ]
    cur.execute(
        sql.SQL("create table {}.{} ({})").format(
            sql.Identifier(schema),
            sql.Identifier(table),
            sql.SQL(", ").join(columns),
        )
    )


def copy_csv(cur, schema: str, table: str, columns: list[str], path: Path) -> None:
    stmt = sql.SQL(
        "copy {}.{} ({}) from stdin with (format csv, header true, null '')"
    ).format(
        sql.Identifier(schema),
        sql.Identifier(table),
        sql.SQL(", ").join(sql.Identifier(column) for column in columns),
    )
    with path.open("r", newline="") as fh:
        cur.copy_expert(stmt.as_string(cur), fh)


def main() -> None:
    args = parse_args()
    db_url = os.environ.get("TARGET_DATABASE_URL")
    if not db_url:
        raise SystemExit("TARGET_DATABASE_URL is required")

    manifest = load_manifest(args.archive)
    tables = table_names(args.archive, manifest)

    with tempfile.TemporaryDirectory(prefix="healthmap-import-") as tmp_dir:
        tmp = Path(tmp_dir)
        with zipfile.ZipFile(args.archive) as archive:
            for name in archive.namelist():
                if name.startswith("csv/") or name.startswith("parquet/"):
                    archive.extract(name, tmp)

        with psycopg2.connect(db_url) as conn:
            conn.autocommit = False
            with conn.cursor() as cur:
                if args.replace:
                    cur.execute(
                        sql.SQL("drop schema if exists {} cascade").format(
                            sql.Identifier(args.schema)
                        )
                    )
                cur.execute(
                    sql.SQL("create schema if not exists {}").format(
                        sql.Identifier(args.schema)
                    )
                )

                for index, table in enumerate(tables, start=1):
                    parquet_path = tmp / "parquet" / f"{table}.parquet"
                    csv_path = tmp / "csv" / f"{table}.csv"
                    schema = pq.read_schema(parquet_path)
                    csv_columns = read_csv_columns(csv_path)
                    parquet_columns = [field.name for field in schema]
                    if csv_columns != parquet_columns:
                        raise RuntimeError(f"Column mismatch for {table}")

                    create_table(cur, args.schema, table, schema)
                    copy_csv(cur, args.schema, table, csv_columns, csv_path)
                    expected_rows = manifest["tables"][table]["rows"]
                    cur.execute(
                        sql.SQL("select count(*) from {}.{}").format(
                            sql.Identifier(args.schema), sql.Identifier(table)
                        )
                    )
                    loaded_rows = cur.fetchone()[0]
                    if loaded_rows != expected_rows:
                        raise RuntimeError(
                            f"{table}: expected {expected_rows}, loaded {loaded_rows}"
                        )
                    print(f"loaded {index:02d}/{len(tables)} {table} rows={loaded_rows}", flush=True)

                cur.execute(
                    """
                    select
                      pg_database_size(current_database()),
                      coalesce(sum(pg_total_relation_size(c.oid)), 0)
                    from pg_class c
                    join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = %s
                      and c.relkind in ('r', 'p', 'm')
                    """,
                    (args.schema,),
                )
                database_bytes, schema_bytes = cur.fetchone()
                print(f"database_bytes={database_bytes}", flush=True)
                print(f"schema_bytes={schema_bytes}", flush=True)
            conn.commit()

if __name__ == "__main__":
    main()
