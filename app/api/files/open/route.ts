import { Readable } from "stream";
import { canUsePhiLocalWorkflow, getSession } from "@/app/lib/auth";
import { assertAzureBlobOwner, downloadAzureBlob } from "@/app/lib/azure-upload";
import { getAppSql } from "@/app/lib/db";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

const privateFileHeaders = {
  ...noStoreHeaders,
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
};

type FileBlobRow = {
  id: string;
  username: string;
  storage_path: string;
  extension: string;
  content_type: string;
  display_name: string | null;
  artifact_kind: "data_file" | "html_artifact" | "word_artifact" | "powerpoint_artifact";
};

function sanitizeDownloadName(displayName: string | null, extension: string): string {
  const baseName =
    displayName
      ?.replace(/[^a-zA-Z0-9._ -]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "file";
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;

  return `${baseName}${baseName.toLowerCase().endsWith(normalizedExtension.toLowerCase()) ? "" : normalizedExtension}`;
}

export async function GET(request: Request) {
  const user = await getSession();

  if (!user) {
    return Response.json({ ok: false, error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
  }

  const fileId = new URL(request.url).searchParams.get("id");

  if (!fileId) {
    return Response.json({ ok: false, error: "File id is required." }, { status: 400, headers: noStoreHeaders });
  }

  const sql = getAppSql();

  if (!sql) {
    return Response.json({ ok: false, error: "File metadata database is not configured." }, { status: 503, headers: noStoreHeaders });
  }

  const rows = (await sql`
    select
      id,
      username,
      storage_path,
      extension,
      content_type,
      display_name,
      artifact_kind
    from app_private.file_uploads
    where id = ${fileId}
      and artifact_kind = 'data_file'
    limit 1
  `) as FileBlobRow[];
  const file = rows[0];

  if (!file) {
    return Response.json({ ok: false, error: "File not found." }, { status: 404, headers: noStoreHeaders });
  }

  if (user.role !== "admin" && file.username !== user.username) {
    return Response.json({ ok: false, error: "File is private." }, { status: 403, headers: noStoreHeaders });
  }

  if (file.artifact_kind !== "data_file") {
    return Response.json({ ok: false, error: "File not found." }, { status: 404, headers: noStoreHeaders });
  }

  if (user.role !== "admin" && !canUsePhiLocalWorkflow(user)) {
    return Response.json(
      { ok: false, error: "Private file records are enabled for PHI-local workflow accounts." },
      { status: 403, headers: noStoreHeaders },
    );
  }

  try {
    await assertAzureBlobOwner({ storagePath: file.storage_path, username: file.username });

    const blob = await downloadAzureBlob(file.storage_path);
    const headers = new Headers(privateFileHeaders);

    headers.set("Content-Type", file.content_type || blob.contentType);
    headers.set("Content-Disposition", `attachment; filename="${sanitizeDownloadName(file.display_name, file.extension)}"`);
    headers.set("X-Content-Type-Options", "nosniff");

    if (typeof blob.contentLength === "number") {
      headers.set("Content-Length", String(blob.contentLength));
    }

    return new Response(Readable.toWeb(blob.readableStreamBody) as ReadableStream, { headers });
  } catch {
    return Response.json({ ok: false, error: "File could not be opened." }, { status: 502, headers: noStoreHeaders });
  }
}
