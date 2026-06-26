import { getOptionalEnv } from "./env";

export type ValidatedPreviewSql = {
  sql: string;
  limit: number;
};

const forbiddenKeywordPattern =
  /\b(insert|update|delete|drop|alter|create|copy|grant|revoke|call|do|set|vacuum|analyze|truncate|merge|refresh|listen|notify|execute|prepare|deallocate|lock|into)\b/i;
const unsafeFunctionPattern = /\b(pg_sleep|dblink|lo_import|lo_export|pg_read_file|pg_ls_dir)\b/i;

function getMaxPreviewRows(): number {
  const parsed = Number.parseInt(getOptionalEnv("MAX_PREVIEW_ROWS") ?? "100", 10);

  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 100;
}

export function getQueryTimeoutMs(): number {
  const parsed = Number.parseInt(getOptionalEnv("QUERY_TIMEOUT_MS") ?? "15000", 10);

  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 30000) : 15000;
}

function maskQuotedSql(sql: string): string {
  let masked = "";
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];

    if (char === "'") {
      masked += " ";
      index += 1;

      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          masked += "  ";
          index += 2;
          continue;
        }

        if (sql[index] === "'") {
          masked += " ";
          index += 1;
          break;
        }

        masked += " ";
        index += 1;
      }

      continue;
    }

    if (char === '"') {
      masked += " ";
      index += 1;

      while (index < sql.length) {
        if (sql[index] === '"' && sql[index + 1] === '"') {
          masked += "  ";
          index += 2;
          continue;
        }

        if (sql[index] === '"') {
          masked += " ";
          index += 1;
          break;
        }

        masked += " ";
        index += 1;
      }

      continue;
    }

    masked += char;
    index += 1;
  }

  return masked;
}

export function validatePreviewSql(rawSql: unknown, rawLimit: unknown): ValidatedPreviewSql {
  if (typeof rawSql !== "string") {
    throw new Error("SQL text is required.");
  }

  const trimmedSql = rawSql.trim();

  if (!trimmedSql) {
    throw new Error("SQL text is required.");
  }

  if (trimmedSql.length > 20000) {
    throw new Error("Preview SQL is too long.");
  }

  if (/--|\/\*|\*\//.test(trimmedSql)) {
    throw new Error("SQL comments are not allowed in preview queries.");
  }

  if (/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/.test(trimmedSql)) {
    throw new Error("Dollar-quoted SQL is not allowed in preview queries.");
  }

  const maskedSql = maskQuotedSql(trimmedSql);
  const semicolonIndex = maskedSql.indexOf(";");

  if (semicolonIndex !== -1 && maskedSql.slice(semicolonIndex + 1).trim()) {
    throw new Error("Preview SQL must contain one statement only.");
  }

  if (semicolonIndex !== -1 && !maskedSql.trimEnd().endsWith(";")) {
    throw new Error("Preview SQL must contain one statement only.");
  }

  const statement = semicolonIndex === -1 ? trimmedSql : trimmedSql.replace(/;\s*$/, "").trim();
  const maskedStatement = semicolonIndex === -1 ? maskedSql : maskedSql.replace(/;\s*$/, "").trim();
  const firstKeyword = maskedStatement.match(/^\s*([A-Za-z]+)/)?.[1]?.toLowerCase();

  if (firstKeyword !== "select" && firstKeyword !== "with") {
    throw new Error("Preview SQL must start with SELECT or WITH.");
  }

  if (forbiddenKeywordPattern.test(maskedStatement)) {
    throw new Error("Preview SQL can only read data. Write, admin, and SELECT INTO commands are blocked.");
  }

  if (unsafeFunctionPattern.test(maskedStatement)) {
    throw new Error("Preview SQL uses a blocked database function.");
  }

  const requestedLimit = typeof rawLimit === "number" && Number.isFinite(rawLimit) ? Math.floor(rawLimit) : getMaxPreviewRows();
  const limit = Math.max(1, Math.min(requestedLimit, getMaxPreviewRows()));

  return {
    sql: statement,
    limit,
  };
}
