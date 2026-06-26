import { randomUUID } from "crypto";
import { getSession } from "@/app/lib/auth";
import { getAppSql } from "@/app/lib/db";
import { rejectCrossSiteRequest } from "@/app/lib/request-security";
import { validateAppMetadataRequestContentLength } from "@/app/lib/request-size";
import {
  normalizeWorkspaceDocType,
  normalizeWorkspaceDocVisibility,
  sanitizeWorkspaceText,
  sanitizeWorkspaceTitle,
  toWorkspaceDocRecord,
  type WorkspaceDocRow,
} from "@/app/lib/workspace-docs";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

type SaveWorkspaceDocRequest = {
  docId?: unknown;
  docType?: unknown;
  title?: unknown;
  bodyMd?: unknown;
  sourceCommand?: unknown;
  projectLabel?: unknown;
  visibility?: unknown;
};

export async function GET(request: Request) {
  const user = await getSession();

  if (!user) {
    return Response.json({ ok: false, error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
  }

  const sql = getAppSql();

  if (!sql) {
    return Response.json({ ok: false, error: "Workspace document database is not configured." }, { status: 503, headers: noStoreHeaders });
  }

  const scope = new URL(request.url).searchParams.get("scope");
  const rows = (user.role === "admin" && scope === "admin"
    ? await sql`
        select
          id,
          username,
          project_label,
          doc_type,
          title,
          body_md,
          source_command,
          visibility,
          created_at,
          updated_at
        from app_private.workspace_docs
        order by updated_at desc
        limit 200
      `
    : await sql`
        select
          id,
          username,
          project_label,
          doc_type,
          title,
          body_md,
          source_command,
          visibility,
          created_at,
          updated_at
        from app_private.workspace_docs
        where username = ${user.username}
          or visibility = 'shared'
        order by updated_at desc
        limit 100
      `) as WorkspaceDocRow[];

  return Response.json(
    { ok: true, docs: rows.map((row) => toWorkspaceDocRecord(row, user.username, user.role)) },
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
    return Response.json({ ok: false, error: "Workspace document database is not configured." }, { status: 503, headers: noStoreHeaders });
  }

  try {
    validateAppMetadataRequestContentLength(request);
    const body = (await request.json().catch(() => ({}))) as SaveWorkspaceDocRequest;
    const docType = normalizeWorkspaceDocType(body.docType);
    const visibility = normalizeWorkspaceDocVisibility({ value: body.visibility, docType });
    const title = sanitizeWorkspaceTitle(body.title);
    const bodyMd = sanitizeWorkspaceText(body.bodyMd, 50000);
    const sourceCommand = sanitizeWorkspaceText(body.sourceCommand, 240);
    const projectLabel = sanitizeWorkspaceText(body.projectLabel, 120);

    if (!bodyMd) {
      return Response.json({ ok: false, error: "Workspace document body is required." }, { status: 400, headers: noStoreHeaders });
    }

    if (typeof body.docId === "string" && body.docId.trim()) {
      const docId = body.docId.trim();
      const existingRows = (await sql`
        select username
        from app_private.workspace_docs
        where id = ${docId}
        limit 1
      `) as Array<{ username: string }>;
      const existing = existingRows[0];

      if (!existing) {
        return Response.json({ ok: false, error: "Workspace document not found." }, { status: 404, headers: noStoreHeaders });
      }

      if (user.role !== "admin" && existing.username !== user.username) {
        return Response.json({ ok: false, error: "You can only update your own workspace documents." }, { status: 403, headers: noStoreHeaders });
      }

      const rows = (await sql`
        update app_private.workspace_docs
        set
          project_label = ${projectLabel},
          doc_type = ${docType},
          title = ${title},
          body_md = ${bodyMd},
          source_command = ${sourceCommand},
          visibility = ${visibility},
          updated_at = now()
        where id = ${docId}
        returning
          id,
          username,
          project_label,
          doc_type,
          title,
          body_md,
          source_command,
          visibility,
          created_at,
          updated_at
      `) as WorkspaceDocRow[];

      return Response.json(
        { ok: true, doc: toWorkspaceDocRecord(rows[0], user.username, user.role) },
        { headers: noStoreHeaders },
      );
    }

    const rows = (await sql`
      insert into app_private.workspace_docs (
        id,
        username,
        project_label,
        doc_type,
        title,
        body_md,
        source_command,
        visibility,
        created_at,
        updated_at
      )
      values (
        ${randomUUID()},
        ${user.username},
        ${projectLabel},
        ${docType},
        ${title},
        ${bodyMd},
        ${sourceCommand},
        ${visibility},
        now(),
        now()
      )
      returning
        id,
        username,
        project_label,
        doc_type,
        title,
        body_md,
        source_command,
        visibility,
        created_at,
        updated_at
    `) as WorkspaceDocRow[];

    return Response.json(
      { ok: true, doc: toWorkspaceDocRecord(rows[0], user.username, user.role) },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Workspace document could not be saved." },
      { status: 400, headers: noStoreHeaders },
    );
  }
}
