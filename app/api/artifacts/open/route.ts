import { Readable } from "stream";
import { getSession } from "@/app/lib/auth";
import { assertAzureBlobOwner, downloadAzureBlob } from "@/app/lib/azure-upload";
import { getAppSql } from "@/app/lib/db";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

const privateArtifactHeaders = {
  ...noStoreHeaders,
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
};

type ArtifactBlobRow = {
  id: string;
  username: string;
  storage_path: string;
  extension: string;
  content_type: string;
  visibility: "private" | "cohort";
  display_name: string | null;
  artifact_kind: "data_file" | "html_artifact" | "word_artifact" | "powerpoint_artifact";
};

function sanitizeDownloadName(displayName: string | null, extension: string): string {
  const baseName =
    displayName
      ?.replace(/[^a-zA-Z0-9._ -]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "artifact";
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;

  return `${baseName}${baseName.toLowerCase().endsWith(normalizedExtension.toLowerCase()) ? "" : normalizedExtension}`;
}

export async function GET(request: Request) {
  const user = await getSession();

  if (!user) {
    return Response.json({ ok: false, error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
  }

  const artifactId = new URL(request.url).searchParams.get("id");

  if (!artifactId) {
    return Response.json({ ok: false, error: "Artifact id is required." }, { status: 400, headers: noStoreHeaders });
  }

  const sql = getAppSql();

  if (!sql) {
    return Response.json({ ok: false, error: "Artifact metadata database is not configured." }, { status: 503, headers: noStoreHeaders });
  }

  const rows = (await sql`
    select
      id,
      username,
      storage_path,
      extension,
      content_type,
      visibility,
      display_name,
      artifact_kind
    from app_private.file_uploads
    where id = ${artifactId}
      and artifact_kind <> 'data_file'
    limit 1
  `) as ArtifactBlobRow[];
  const artifact = rows[0];

  if (!artifact) {
    return Response.json({ ok: false, error: "Artifact not found." }, { status: 404, headers: noStoreHeaders });
  }

  const canOpen = user.role === "admin" || artifact.username === user.username || artifact.visibility === "cohort";

  if (!canOpen) {
    return Response.json({ ok: false, error: "Artifact is private." }, { status: 403, headers: noStoreHeaders });
  }

  try {
    await assertAzureBlobOwner({ storagePath: artifact.storage_path, username: artifact.username });

    const blob = await downloadAzureBlob(artifact.storage_path);
    const isHtml = artifact.extension === ".html" || artifact.extension === ".htm";
    const headers = new Headers(privateArtifactHeaders);

    headers.set("Content-Type", isHtml ? "text/html; charset=utf-8" : artifact.content_type || blob.contentType);
    headers.set("Content-Disposition", `${isHtml ? "inline" : "attachment"}; filename="${sanitizeDownloadName(artifact.display_name, artifact.extension)}"`);
    headers.set("X-Content-Type-Options", "nosniff");

    if (typeof blob.contentLength === "number") {
      headers.set("Content-Length", String(blob.contentLength));
    }

    if (isHtml) {
      headers.set(
        "Content-Security-Policy",
        "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      );
    }

    return new Response(Readable.toWeb(blob.readableStreamBody) as ReadableStream, { headers });
  } catch {
    return Response.json({ ok: false, error: "Artifact file could not be opened." }, { status: 502, headers: noStoreHeaders });
  }
}
