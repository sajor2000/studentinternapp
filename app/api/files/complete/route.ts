import { randomUUID } from "crypto";
import { canUsePhiLocalWorkflow, getSession } from "@/app/lib/auth";
import { getAppSql } from "@/app/lib/db";
import {
  deleteAzureBlobIfExists,
  getAzureBlobProperties,
  getSafeStorageUsername,
  hasAzureControlledMetadata,
  isAzureStoragePathForUser,
  normalizeContentType,
  validateUploadMetadataRequestContentLength,
  validateUploadRequest,
} from "@/app/lib/azure-upload";
import {
  getArtifactKind,
  getDefaultArtifactDisplayName,
  isPublishableArtifact,
  type ArtifactRecord,
} from "@/app/lib/artifacts";
import { checkUploadRequestRateLimit } from "@/app/lib/rate-limit";
import { rejectCrossSiteRequest } from "@/app/lib/request-security";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

type CompleteUploadRequest = {
  storagePath?: unknown;
};

type FileUploadRow = {
  id: string;
  username: string;
  storage_path: string;
  extension: string;
  content_type: string;
  size_bytes: number;
  artifact_kind: ArtifactRecord["artifactKind"];
  visibility: ArtifactRecord["visibility"];
  status: string;
  display_name: string | null;
  project_label: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  published_at: string | Date | null;
};

function toArtifactRecord(row: FileUploadRow, viewerUsername: string, viewerRole: string): ArtifactRecord {
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

function getStoragePathExtension(storagePath: string): string {
  const normalized = storagePath.trim().toLowerCase();
  const lastSlashIndex = normalized.lastIndexOf("/");
  const lastDotIndex = normalized.lastIndexOf(".");

  return lastDotIndex > lastSlashIndex ? normalized.slice(lastDotIndex) : "";
}

export async function POST(request: Request) {
  let ownedUploadPathForCleanup: string | null = null;

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
        { ok: false, error: "Too many upload completion requests. Try again shortly.", retryAfterSeconds: rateLimit.retryAfterSeconds },
        {
          status: 429,
          headers: {
            ...noStoreHeaders,
            "retry-after": String(rateLimit.retryAfterSeconds ?? 60),
          },
        },
      );
    }

    validateUploadMetadataRequestContentLength(request);

    const body = (await request.json()) as CompleteUploadRequest;

    if (typeof body.storagePath !== "string") {
      return Response.json({ ok: false, error: "Upload metadata is incomplete." }, { status: 400, headers: noStoreHeaders });
    }

    const safeUsername = getSafeStorageUsername(user.username);

    if (!isAzureStoragePathForUser({ storagePath: body.storagePath, prefix: "uploads", username: user.username })) {
      return Response.json({ ok: false, error: "Upload path does not match the signed-in user." }, { status: 403, headers: noStoreHeaders });
    }

    const extension = getStoragePathExtension(body.storagePath);
    const blobProperties = await getAzureBlobProperties(body.storagePath);

    if (blobProperties.metadata.owner !== safeUsername) {
      return Response.json({ ok: false, error: "Upload owner metadata does not match the signed-in user." }, { status: 403, headers: noStoreHeaders });
    }

    ownedUploadPathForCleanup = body.storagePath;

    if (!hasAzureControlledMetadata(blobProperties.metadata)) {
      await deleteAzureBlobIfExists(body.storagePath);

      return Response.json(
        { ok: false, error: "Upload metadata does not match the portal-controlled Blob policy." },
        { status: 403, headers: noStoreHeaders },
      );
    }

    validateUploadRequest({ fileName: `file${extension}`, sizeBytes: blobProperties.contentLength });
    const contentType = normalizeContentType(extension);

    const sql = getAppSql();

    if (!sql) {
      await deleteAzureBlobIfExists(body.storagePath);

      return Response.json(
        { ok: false, error: "File metadata database is not configured." },
        { status: 503, headers: noStoreHeaders },
      );
    }

    const artifactKind = getArtifactKind(extension);

    if (artifactKind === "data_file" && !canUsePhiLocalWorkflow(user)) {
      await deleteAzureBlobIfExists(body.storagePath);

      return Response.json(
        { ok: false, error: "Private file uploads are enabled for PHI-local workflow accounts." },
        { status: 403, headers: noStoreHeaders },
      );
    }

    const displayName = getDefaultArtifactDisplayName({ extension });

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
        status,
        created_at,
        updated_at
      )
      values (
        ${randomUUID()},
        ${user.username},
        ${body.storagePath},
        ${extension},
        ${contentType},
        ${blobProperties.contentLength},
        ${artifactKind},
        'private',
        ${displayName},
        'uploaded',
        now(),
        now()
      )
      on conflict (storage_path)
      do update set
        status = 'uploaded',
        content_type = excluded.content_type,
        size_bytes = excluded.size_bytes,
        artifact_kind = excluded.artifact_kind,
        display_name = coalesce(app_private.file_uploads.display_name, excluded.display_name),
        updated_at = now()
      where app_private.file_uploads.username = excluded.username
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

    if (!rows[0]) {
      throw new Error("Upload metadata insert did not return a file record.");
    }

    const file = toArtifactRecord(rows[0], user.username, user.role);
    ownedUploadPathForCleanup = null;

    return Response.json({ ok: true, file, publishable: isPublishableArtifact(extension) }, { headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (ownedUploadPathForCleanup) {
      await deleteAzureBlobIfExists(ownedUploadPathForCleanup).catch(() => undefined);
    }

    if (
      message.includes("Supported uploads") ||
      message.includes("File size") ||
      message.includes("larger than the configured") ||
      message.includes("Upload metadata request is larger") ||
      message.includes("Upload metadata request size is invalid")
    ) {
      return Response.json({ ok: false, error: message }, { status: 400, headers: noStoreHeaders });
    }

    return Response.json(
      { ok: false, error: "Upload metadata could not be recorded; the uploaded blob was removed." },
      { status: 502, headers: noStoreHeaders },
    );
  }
}
