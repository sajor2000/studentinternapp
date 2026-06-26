import { canUsePhiLocalWorkflow, getSession } from "@/app/lib/auth";
import { toArtifactRecord, type FileUploadRow } from "@/app/lib/artifacts";
import { getAppSql } from "@/app/lib/db";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

export async function GET() {
  const user = await getSession();

  if (!user) {
    return Response.json({ ok: false, error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
  }

  if (user.role !== "admin" && !canUsePhiLocalWorkflow(user)) {
    return Response.json(
      { ok: false, error: "Private file records are enabled for PHI-local workflow accounts." },
      { status: 403, headers: noStoreHeaders },
    );
  }

  const sql = getAppSql();

  if (!sql) {
    return Response.json({ ok: false, error: "File metadata database is not configured." }, { status: 503, headers: noStoreHeaders });
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
        where artifact_kind = 'data_file'
        order by created_at desc
        limit 200
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
        where username = ${user.username}
          and artifact_kind = 'data_file'
        order by created_at desc
        limit 200
      `) as FileUploadRow[];

  return Response.json(
    {
      ok: true,
      files: rows.map((row) => toArtifactRecord(row, user.username, user.role)),
    },
    { headers: noStoreHeaders },
  );
}
