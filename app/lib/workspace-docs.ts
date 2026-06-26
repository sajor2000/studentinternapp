import { maskPiiText } from "./pii-guard";

export type WorkspaceDocType = "brainstorm" | "plan" | "work_log" | "review" | "compound_learning" | "handoff";
export type WorkspaceDocVisibility = "private" | "shared";

export type WorkspaceDocRecord = {
  id: string;
  ownerUsername: string;
  projectLabel: string | null;
  docType: WorkspaceDocType;
  title: string;
  bodyMd: string;
  sourceCommand: string | null;
  visibility: WorkspaceDocVisibility;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
};

export type WorkspaceDocRow = {
  id: string;
  username: string;
  project_label: string | null;
  doc_type: WorkspaceDocType;
  title: string;
  body_md: string;
  source_command: string | null;
  visibility: WorkspaceDocVisibility;
  created_at: string | Date;
  updated_at: string | Date;
};

const workspaceDocTypes = new Set<WorkspaceDocType>([
  "brainstorm",
  "plan",
  "work_log",
  "review",
  "compound_learning",
  "handoff",
]);

const shareableDocTypes = new Set<WorkspaceDocType>(["compound_learning", "handoff"]);

export function normalizeWorkspaceDocType(value: unknown): WorkspaceDocType {
  return typeof value === "string" && workspaceDocTypes.has(value as WorkspaceDocType)
    ? (value as WorkspaceDocType)
    : "work_log";
}

export function normalizeWorkspaceDocVisibility({
  value,
  docType,
}: {
  value: unknown;
  docType: WorkspaceDocType;
}): WorkspaceDocVisibility {
  if (value !== "shared") {
    return "private";
  }

  if (!shareableDocTypes.has(docType)) {
    throw new Error("Only compound learnings and handoffs can be shared with the cohort.");
  }

  return "shared";
}

export function sanitizeWorkspaceTitle(value: unknown): string {
  if (typeof value !== "string") {
    return "Untitled CE workspace doc";
  }

  const cleaned =
    value
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Untitled CE workspace doc";

  return maskPiiText(cleaned).text.slice(0, 160);
}

export function sanitizeWorkspaceText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value
    .replace(/\u0000/g, "")
    .trim();

  if (!cleaned) {
    return null;
  }

  return maskPiiText(cleaned).text.slice(0, maxLength);
}

export function toWorkspaceDocRecord(
  row: WorkspaceDocRow,
  viewerUsername: string,
  viewerRole: string,
): WorkspaceDocRecord {
  return {
    id: row.id,
    ownerUsername: row.username,
    projectLabel: row.project_label,
    docType: row.doc_type,
    title: row.title,
    bodyMd: row.body_md,
    sourceCommand: row.source_command,
    visibility: row.visibility,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    canEdit: viewerRole === "admin" || row.username === viewerUsername,
  };
}
