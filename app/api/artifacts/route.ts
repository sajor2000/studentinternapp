import { text as readStreamText } from "stream/consumers";
import { getSession } from "@/app/lib/auth";
import {
  getDefaultArtifactDisplayName,
  isPublishableArtifact,
  sanitizeArtifactLabel,
  validateArtifactMetadataRequestContentLength,
  validateGeneratedHtmlArtifactSafety,
  type ArtifactRecord,
  type ArtifactVisibility,
} from "@/app/lib/artifacts";
import { assertAzureBlobOwner, downloadAzureBlob } from "@/app/lib/azure-upload";
import { getAppSql } from "@/app/lib/db";
import { rejectCrossSiteRequest } from "@/app/lib/request-security";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

type ArtifactRow = {
  id: string;
  username: string;
  storage_path: string;
  extension: string;
  content_type: string;
  size_bytes: number;
  artifact_kind: ArtifactRecord["artifactKind"];
  visibility: ArtifactVisibility;
  status: string;
  display_name: string | null;
  project_label: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  published_at: string | Date | null;
};

type UpdateArtifactRequest = {
  fileId?: unknown;
  visibility?: unknown;
  displayName?: unknown;
  projectLabel?: unknown;
  reviewConfirmed?: unknown;
};

function isHtmlExtension(extension: string): boolean {
  return extension.toLowerCase() === ".html" || extension.toLowerCase() === ".htm";
}

function toArtifactRecord(row: ArtifactRow, viewerUsername: string, viewerRole: string): ArtifactRecord {
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

export async function GET() {
  const user = await getSession();

  if (!user) {
    return Response.json({ ok: false, error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
  }

  const sql = getAppSql();

  if (!sql) {
    return Response.json({ ok: false, error: "Artifact metadata database is not configured." }, { status: 503, headers: noStoreHeaders });
  }

  const rows = (user.role === "admin"
    ? await sql`
        select
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
        from app_private.file_uploads
        where artifact_kind <> 'data_file'
        order by coalesce(published_at, created_at) desc
        limit 100
      `
    : await sql`
        select
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
        from app_private.file_uploads
        where artifact_kind <> 'data_file'
          and (username = ${user.username} or visibility = 'cohort')
        order by coalesce(published_at, created_at) desc
        limit 100
      `) as ArtifactRow[];

  return Response.json(
    { ok: true, artifacts: rows.map((row) => toArtifactRecord(row, user.username, user.role)) },
    { headers: noStoreHeaders },
  );
}

export async function POST(request: Request) {
  const crossSiteResponse = rejectCrossSiteRequest(request);

  if (crossSiteResponse) {
    return crossSiteResponse;
  }

  const user = await getSession();

  if (!user) {
    return Response.json({ ok: false, error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
  }

  const sql = getAppSql();

  if (!sql) {
    return Response.json({ ok: false, error: "Artifact metadata database is not configured." }, { status: 503, headers: noStoreHeaders });
  }

  let body: UpdateArtifactRequest;

  try {
    validateArtifactMetadataRequestContentLength(request);
    body = (await request.json()) as UpdateArtifactRequest;
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Artifact metadata request is invalid." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  if (typeof body.fileId !== "string" || (body.visibility !== "private" && body.visibility !== "cohort")) {
    return Response.json({ ok: false, error: "fileId and visibility are required." }, { status: 400, headers: noStoreHeaders });
  }

  const existingRows = (await sql`
    select
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
    from app_private.file_uploads
    where id = ${body.fileId}
    limit 1
  `) as ArtifactRow[];
  const existing = existingRows[0];

  if (!existing) {
    return Response.json({ ok: false, error: "Artifact not found." }, { status: 404, headers: noStoreHeaders });
  }

  if (user.role !== "admin" && existing.username !== user.username) {
    return Response.json({ ok: false, error: "You can only publish your own artifacts." }, { status: 403, headers: noStoreHeaders });
  }

  if (existing.artifact_kind === "data_file") {
    return Response.json(
      { ok: false, error: "Private file records cannot be managed through artifact publishing." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  if (body.visibility === "cohort" && !isPublishableArtifact(existing.extension)) {
    return Response.json({ ok: false, error: "Only HTML, Word, and PowerPoint artifacts can be published." }, { status: 400, headers: noStoreHeaders });
  }

  if (body.visibility === "cohort" && body.reviewConfirmed !== true) {
    return Response.json(
      { ok: false, error: "Confirm the artifact was reviewed before publishing it to the cohort." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  if (body.visibility === "cohort") {
    try {
      await assertAzureBlobOwner({ storagePath: existing.storage_path, username: existing.username });
    } catch {
      return Response.json(
        { ok: false, error: "Artifact Blob ownership could not be verified." },
        { status: 502, headers: noStoreHeaders },
      );
    }

    if (isHtmlExtension(existing.extension)) {
      try {
        const blob = await downloadAzureBlob(existing.storage_path);
        const html = await readStreamText(blob.readableStreamBody);

        validateGeneratedHtmlArtifactSafety(html);
      } catch (error) {
        const message = error instanceof Error ? error.message : "HTML artifact privacy check failed.";

        if (/privacy-reviewed aggregate summaries/i.test(message)) {
          return Response.json({ ok: false, error: message }, { status: 400, headers: noStoreHeaders });
        }

        return Response.json(
          { ok: false, error: "HTML artifact privacy check could not be completed." },
          { status: 502, headers: noStoreHeaders },
        );
      }
    }
  }

  const displayName =
    sanitizeArtifactLabel(body.displayName) ??
    existing.display_name ??
    getDefaultArtifactDisplayName({ extension: existing.extension, createdAt: existing.created_at });
  const projectLabel = sanitizeArtifactLabel(body.projectLabel) ?? existing.project_label;

  const rows = (await sql`
    update app_private.file_uploads
    set
      visibility = ${body.visibility},
      status = ${body.visibility === "cohort" ? "published" : "uploaded"},
      display_name = ${displayName},
      project_label = ${projectLabel},
      published_at = case
        when ${body.visibility} = 'cohort' then coalesce(published_at, now())
        else null
      end,
      updated_at = now()
    where id = ${existing.id}
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
  `) as ArtifactRow[];

  return Response.json({ ok: true, artifact: toArtifactRecord(rows[0], user.username, user.role) }, { headers: noStoreHeaders });
}
