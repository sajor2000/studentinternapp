import { hasPastedRowLevelExtract, maskPiiText } from "./pii-guard";
import { getOptionalEnv } from "./env";

export type ArtifactKind = "data_file" | "html_artifact" | "word_artifact" | "powerpoint_artifact";
export type ArtifactVisibility = "private" | "cohort";

export type ArtifactRecord = {
  id: string;
  ownerUsername: string;
  storagePath: string | null;
  extension: string;
  contentType: string;
  sizeBytes: number;
  artifactKind: ArtifactKind;
  visibility: ArtifactVisibility;
  status: string;
  displayName: string;
  projectLabel: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  canEdit: boolean;
};

export type FileUploadRow = {
  id: string;
  username: string;
  storage_path: string;
  extension: string;
  content_type: string;
  size_bytes: number;
  artifact_kind: ArtifactKind;
  visibility: ArtifactVisibility;
  status: string;
  display_name: string | null;
  project_label: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  published_at: string | Date | null;
};

const artifactExtensions = new Set([".html", ".htm", ".docx", ".pptx"]);
const defaultMaxArtifactMetadataBytes = 16 * 1024;
const generatedHtmlPrivacyError =
  "Generated HTML artifacts must contain only privacy-reviewed aggregate summaries. Remove row-level identifiers or direct contact details before saving.";

const htmlIdentifierHeaderPattern =
  /<(?:th|td)\b[^>]*>\s*(?:mrn|medical\s*record(?:\s*number)?|patient[_\s-]*id|member[_\s-]*id|subscriber[_\s-]*id|account[_\s-]*number|dob|date[_\s-]*of[_\s-]*birth|full[_\s-]*name|first[_\s-]*name|last[_\s-]*name|patient[_\s-]*name|member[_\s-]*name|address|phone|email)\s*<\/(?:th|td)>/i;
const htmlDataCellPattern = /<td\b[^>]*>\s*(?!\[MASKED_)[^<]{3,}\s*<\/td>/i;

function stripHtmlForPrivacyCheck(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'");
}

function hasIdentifierHtmlTable(html: string): boolean {
  if (!htmlIdentifierHeaderPattern.test(html)) {
    return false;
  }

  return htmlDataCellPattern.test(html);
}

export function getArtifactKind(extension: string): ArtifactKind {
  const normalized = extension.toLowerCase();

  if (normalized === ".html" || normalized === ".htm") {
    return "html_artifact";
  }

  if (normalized === ".docx") {
    return "word_artifact";
  }

  if (normalized === ".pptx") {
    return "powerpoint_artifact";
  }

  return "data_file";
}

export function isPublishableArtifact(extension: string): boolean {
  return artifactExtensions.has(extension.toLowerCase());
}

export function getDefaultArtifactDisplayName({
  extension,
  createdAt,
}: {
  extension: string;
  createdAt?: string | Date | null;
}): string {
  const date = createdAt ? new Date(createdAt) : new Date();
  const dateLabel = Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
  const kind = getArtifactKind(extension);

  if (kind === "html_artifact") {
    return `HTML artifact ${dateLabel}`;
  }

  if (kind === "word_artifact") {
    return `Word artifact ${dateLabel}`;
  }

  if (kind === "powerpoint_artifact") {
    return `PowerPoint artifact ${dateLabel}`;
  }

  return `Private file ${dateLabel}`;
}

export function sanitizeArtifactLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return null;
  }

  return maskPiiText(cleaned).text.slice(0, 120);
}

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(getOptionalEnv(name) ?? "", 10);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function validateArtifactMetadataRequestContentLength(request: Request): void {
  const rawContentLength = request.headers.get("content-length");

  if (!rawContentLength) {
    return;
  }

  const contentLength = Number(rawContentLength);
  const maxBytes = getPositiveIntegerEnv("ARTIFACT_METADATA_MAX_BYTES", defaultMaxArtifactMetadataBytes);

  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new Error("Artifact metadata request size is invalid.");
  }

  if (contentLength > maxBytes) {
    throw new Error(`Artifact metadata request is larger than the ${Math.round(maxBytes / 1024)} KB limit.`);
  }
}

export function validateGeneratedHtmlArtifactSafety(html: string): void {
  const plainText = stripHtmlForPrivacyCheck(html);

  if (maskPiiText(html).masked || hasPastedRowLevelExtract(plainText) || hasIdentifierHtmlTable(html)) {
    throw new Error(generatedHtmlPrivacyError);
  }
}

export function toArtifactRecord(row: FileUploadRow, viewerUsername: string, viewerRole: string): ArtifactRecord {
  const canEdit = viewerRole === "admin" || row.username === viewerUsername;

  return {
    id: row.id,
    ownerUsername: row.username,
    storagePath: null,
    extension: row.extension,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    artifactKind: row.artifact_kind,
    visibility: row.visibility,
    status: row.status,
    displayName: row.display_name ?? getDefaultArtifactDisplayName({ extension: row.extension, createdAt: row.created_at }),
    projectLabel: row.project_label,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    canEdit,
  };
}
