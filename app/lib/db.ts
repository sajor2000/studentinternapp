import { neon } from "@neondatabase/serverless";
import { getOptionalEnv, getRequiredEnv } from "./env";

export function getAppSql() {
  const databaseUrl = getOptionalEnv("DATABASE_URL");

  if (!databaseUrl) {
    return null;
  }

  return neon(databaseUrl);
}

export function getReadOnlySql() {
  return neon(getRequiredEnv("READONLY_DATABASE_URL"));
}
