import { maskPiiText } from "./pii-guard";

export type DatasetRecipeRecord = {
  id: string;
  ownerUsername: string;
  title: string;
  naturalLanguageRequest: string;
  sqlText: string;
  rowGrain: string | null;
  status: "draft" | "ready" | "archived";
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
};

export type DatasetRecipeRow = {
  id: string;
  username: string;
  title: string;
  natural_language_request: string;
  sql_text: string;
  row_grain: string | null;
  status: "draft" | "ready" | "archived";
  created_at: string | Date;
  updated_at: string | Date;
};

export function sanitizeRecipeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const masked = maskPiiText(value).text;
  const cleaned = masked
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

  return cleaned || null;
}

export function toDatasetRecipeRecord(
  row: DatasetRecipeRow,
  viewerUsername: string,
  viewerRole: string,
): DatasetRecipeRecord {
  return {
    id: row.id,
    ownerUsername: row.username,
    title: row.title,
    naturalLanguageRequest: row.natural_language_request,
    sqlText: row.sql_text,
    rowGrain: row.row_grain,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    canEdit: viewerRole === "admin" || row.username === viewerUsername,
  };
}
