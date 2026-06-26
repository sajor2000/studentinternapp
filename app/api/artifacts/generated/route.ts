import { randomUUID } from "crypto";
import { getSession } from "@/app/lib/auth";
import { getAppSql } from "@/app/lib/db";
import {
  getDefaultArtifactDisplayName,
  sanitizeArtifactLabel,
  toArtifactRecord,
  validateGeneratedHtmlArtifactSafety,
  type FileUploadRow,
} from "@/app/lib/artifacts";
import {
  deleteAzureBlobIfExists,
  uploadAzureGeneratedArtifact,
  validateUploadRequest,
  type AzureStoredBlob,
} from "@/app/lib/azure-upload";
import { checkUploadRequestRateLimit } from "@/app/lib/rate-limit";
import { rejectCrossSiteRequest } from "@/app/lib/request-security";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

type SaveGeneratedArtifactRequest = {
  html?: unknown;
  displayName?: unknown;
  projectLabel?: unknown;
};

function normalizeHtml(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("HTML artifact content is required.");
  }

  const html = value.trim();

  if (!html) {
    throw new Error("HTML artifact content is required.");
  }

  return html;
}

function validateGeneratedArtifactRequestContentLength(request: Request): void {
  const rawContentLength = request.headers.get("content-length");

  if (!rawContentLength) {
    return;
  }

  validateUploadRequest({
    fileName: "artifact.html",
    sizeBytes: Number(rawContentLength),
  });
}

export async function POST(request: Request) {
  let stored: AzureStoredBlob | null = null;

  try {
    const crossSiteResponse = rejectCrossSiteRequest(request);

    if (crossSiteResponse) {
      return crossSiteResponse;
    }

    const user = await getSession();

    if (!user) {
      return Response.json({ ok: false, error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
    }

    const rateLimit = checkUploadRequestRateLimit(user.username);

    if (!rateLimit.allowed) {
      return Response.json(
        { ok: false, error: "Too many artifact save requests. Try again shortly.", retryAfterSeconds: rateLimit.retryAfterSeconds },
        {
          status: 429,
          headers: {
            ...noStoreHeaders,
            "retry-after": String(rateLimit.retryAfterSeconds ?? 60),
          },
        },
      );
    }

    const sql = getAppSql();

    if (!sql) {
      return Response.json({ ok: false, error: "Artifact metadata database is not configured." }, { status: 503, headers: noStoreHeaders });
    }

    validateGeneratedArtifactRequestContentLength(request);

    const body = (await request.json().catch(() => ({}))) as SaveGeneratedArtifactRequest;
    const html = normalizeHtml(body.html);
    validateGeneratedHtmlArtifactSafety(html);
    stored = await uploadAzureGeneratedArtifact({ username: user.username, html });
    const displayName = sanitizeArtifactLabel(body.displayName) ?? getDefaultArtifactDisplayName({ extension: stored.extension });
    const projectLabel = sanitizeArtifactLabel(body.projectLabel);

    const rows = (await sql`
      insert into app_private.file_uploads (
        id,
        username,
        storage_path,
        extension,
        content_type,
        size_bytes,
        artifact_kind,
        visibility,
        display_name,
        project_label,
        status,
        created_at,
        updated_at
      )
      values (
        ${randomUUID()},
        ${user.username},
        ${stored.storagePath},
        ${stored.extension},
        ${stored.contentType},
        ${stored.sizeBytes},
        'html_artifact',
        'private',
        ${displayName},
        ${projectLabel},
        'uploaded',
        now(),
        now()
      )
      returning
        id,
        username,
        storage_path,
        extension,
        content_type,
        size_bytes,
        artifact_kind,
        visibility,
        status,
        display_name,
        project_label,
        created_at,
        updated_at,
        published_at
    `) as FileUploadRow[];

    const row = rows[0];

    if (!row) {
      throw new Error("Generated artifact metadata was not recorded.");
    }

    const artifact = toArtifactRecord(row, user.username, user.role);

    stored = null;

    return Response.json({ ok: true, artifact }, { headers: noStoreHeaders });
  } catch (error) {
    if (stored) {
      await deleteAzureBlobIfExists(stored.storagePath).catch(() => undefined);
    }

    const message = error instanceof Error ? error.message : "Generated artifact could not be saved.";
    const status =
      message.includes("configured") || message.includes("AZURE_STORAGE")
        ? 503
        : message.includes("Supported uploads") || message.includes("File size") || message.includes("larger than")
          ? 400
          : 422;

    return Response.json({ ok: false, error: message }, { status, headers: noStoreHeaders });
  }
}
