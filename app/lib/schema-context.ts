import { getOptionalEnv } from "./env";
import { getReadOnlySql } from "./db";

export type SchemaTable = {
  tableName: string;
  rowEstimate: number;
  columns: Array<{
    columnName: string;
    dataType: string;
  }>;
};

export type WardSummary = {
  wardId: string;
  wardName: string | null;
  aldermanName: string | null;
  totalPopulation: number | null;
};

type SchemaRow = {
  table_name: string;
  row_estimate: number | string | null;
  column_name: string;
  data_type: string;
};

type CacheEntry<T> = {
  key: string;
  expiresAt: number;
  value: T;
};

type HealthmapSchemaSummary = {
  schema: string;
  tables: SchemaTable[];
};

type WardSummaryIndex = {
  schema: string;
  wards: WardSummary[];
};

const defaultSchemaCacheTtlSeconds = 60 * 60;
const maxSchemaCacheTtlSeconds = 24 * 60 * 60;

let healthmapSchemaCache: CacheEntry<HealthmapSchemaSummary> | null = null;
let wardSummaryCache: CacheEntry<WardSummaryIndex> | null = null;

function readNonnegativeIntegerEnv(name: string, fallback: number, maxValue: number): number {
  const rawValue = getOptionalEnv(name);

  if (rawValue === undefined) {
    return fallback;
  }

  const value = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.min(value, maxValue);
}

function getHealthmapSchemaName(): string {
  const schemaName = getOptionalEnv("HEALTHMAP_SCHEMA") ?? "public";

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaName)) {
    throw new Error("HEALTHMAP_SCHEMA must be a valid Postgres identifier");
  }

  return schemaName;
}

function getCachedValue<T>(entry: CacheEntry<T> | null, key: string): T | null {
  if (!entry || entry.key !== key || entry.expiresAt <= Date.now()) {
    return null;
  }

  return entry.value;
}

function createCacheEntry<T>(key: string, value: T): CacheEntry<T> | null {
  const ttlMs = getSchemaCacheTtlMs();

  if (ttlMs <= 0) {
    return null;
  }

  return {
    key,
    value,
    expiresAt: Date.now() + ttlMs,
  };
}

export function getSchemaCacheTtlMs(): number {
  return readNonnegativeIntegerEnv(
    "SCHEMA_CACHE_TTL_SECONDS",
    defaultSchemaCacheTtlSeconds,
    maxSchemaCacheTtlSeconds,
  ) * 1000;
}

export function clearSchemaContextCache(): void {
  healthmapSchemaCache = null;
  wardSummaryCache = null;
}

export async function getHealthmapSchema(): Promise<HealthmapSchemaSummary> {
  const schemaName = getHealthmapSchemaName();
  const cached = getCachedValue(healthmapSchemaCache, schemaName);

  if (cached) {
    return cached;
  }

  const sql = getReadOnlySql();

  const rows = (await sql`
    select
      pc.relname as table_name,
      coalesce(pc.reltuples::bigint, 0) as row_estimate,
      pa.attname as column_name,
      format_type(pa.atttypid, pa.atttypmod) as data_type
    from pg_class pc
    join pg_namespace pn
      on pn.oid = pc.relnamespace
    join pg_attribute pa
      on pa.attrelid = pc.oid
     and pa.attnum > 0
     and not pa.attisdropped
    where pn.nspname = ${schemaName}
      and pc.relkind in ('r', 'p')
      and pc.relname not in (
        'spatial_ref_sys',
        'geometry_columns',
        'geography_columns',
        'raster_columns',
        'raster_overviews'
      )
    order by pc.relname, pa.attnum
  `) as SchemaRow[];

  const tableMap = new Map<string, SchemaTable>();

  for (const row of rows) {
    const existing =
      tableMap.get(row.table_name) ??
      ({
        tableName: row.table_name,
        rowEstimate: Number(row.row_estimate ?? 0),
        columns: [],
      } satisfies SchemaTable);

    existing.columns.push({
      columnName: row.column_name,
      dataType: row.data_type,
    });
    tableMap.set(row.table_name, existing);
  }

  const summary = {
    schema: schemaName,
    tables: [...tableMap.values()],
  };

  healthmapSchemaCache = createCacheEntry(schemaName, summary);

  return summary;
}

export async function getWardSummaries(): Promise<WardSummaryIndex> {
  const schemaName = getHealthmapSchemaName();
  const cached = getCachedValue(wardSummaryCache, schemaName);

  if (cached) {
    return cached;
  }

  const sql = getReadOnlySql();

  const rows = (await sql`
    select
      ward_id,
      ward_name,
      alderman_name,
      total_population
    from ${sql.unsafe(schemaName)}.dim_aldermanic_wards
    order by ward_id::int
  `) as Array<{
    ward_id: string;
    ward_name: string | null;
    alderman_name: string | null;
    total_population: number | string | null;
  }>;

  const summary = {
    schema: schemaName,
    wards: rows.map((row) => ({
      wardId: row.ward_id,
      wardName: row.ward_name,
      aldermanName: row.alderman_name,
      totalPopulation:
        row.total_population === null ? null : Number(row.total_population),
    })),
  };

  wardSummaryCache = createCacheEntry(schemaName, summary);

  return summary;
}

export function formatSchemaForPrompt(tables: SchemaTable[]): string {
  return tables
    .map((table) => {
      const columns = table.columns
        .slice(0, 24)
        .map((column) => `${column.columnName} ${column.dataType}`)
        .join(", ");
      const suffix = table.columns.length > 24 ? ", ..." : "";
      return `- ${table.tableName} (${table.rowEstimate} rows): ${columns}${suffix}`;
    })
    .join("\n")
    .slice(0, 12000);
}
