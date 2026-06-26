import { randomUUID } from "crypto";
import { canAccessNeon, getSession } from "@/app/lib/auth";
import {
  sanitizeRecipeText,
  toDatasetRecipeRecord,
  type DatasetRecipeRow,
} from "@/app/lib/dataset-recipes";
import { getAppSql } from "@/app/lib/db";
import { rejectCrossSiteRequest } from "@/app/lib/request-security";
import { validateAppMetadataRequestContentLength } from "@/app/lib/request-size";
import { validatePreviewSql } from "@/app/lib/sql-preview";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

type SaveRecipeRequest = {
  recipeId?: unknown;
  title?: unknown;
  naturalLanguageRequest?: unknown;
  sqlText?: unknown;
  rowGrain?: unknown;
  status?: unknown;
};

function normalizeRecipeStatus(value: unknown): "draft" | "ready" | "archived" {
  return value === "ready" || value === "archived" ? value : "draft";
}

export async function GET() {
  const user = await getSession();

  if (!user) {
    return Response.json({ ok: false, error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
  }

  if (!canAccessNeon(user)) {
    return Response.json({ ok: false, error: "Dataset recipes are enabled for Neon workflow accounts." }, { status: 403, headers: noStoreHeaders });
  }

  const sql = getAppSql();

  if (!sql) {
    return Response.json({ ok: false, error: "Recipe metadata database is not configured." }, { status: 503, headers: noStoreHeaders });
  }

  const rows = (user.role === "admin"
    ? await sql`
        select
          id,
          username,
          title,
          natural_language_request,
          sql_text,
          row_grain,
          status,
          created_at,
          updated_at
        from app_private.dataset_recipes
        order by updated_at desc
        limit 200
      `
    : await sql`
        select
          id,
          username,
          title,
          natural_language_request,
          sql_text,
          row_grain,
          status,
          created_at,
          updated_at
        from app_private.dataset_recipes
        where username = ${user.username}
        order by updated_at desc
        limit 100
      `) as DatasetRecipeRow[];

  return Response.json(
    { ok: true, recipes: rows.map((row) => toDatasetRecipeRecord(row, user.username, user.role)) },
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

  if (!canAccessNeon(user)) {
    return Response.json({ ok: false, error: "Dataset recipes are enabled for Neon workflow accounts." }, { status: 403, headers: noStoreHeaders });
  }

  const sql = getAppSql();

  if (!sql) {
    return Response.json({ ok: false, error: "Recipe metadata database is not configured." }, { status: 503, headers: noStoreHeaders });
  }

  let body: SaveRecipeRequest;

  try {
    validateAppMetadataRequestContentLength(request);
    body = (await request.json().catch(() => ({}))) as SaveRecipeRequest;
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Recipe metadata request is invalid." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const title = sanitizeRecipeText(body.title, 120) ?? "Untitled dataset recipe";
  const naturalLanguageRequest = sanitizeRecipeText(body.naturalLanguageRequest, 1000) ?? "Saved from SQL preview.";
  const rowGrain = sanitizeRecipeText(body.rowGrain, 200);
  const status = normalizeRecipeStatus(body.status);
  let validatedSql: string;

  try {
    validatedSql = validatePreviewSql(body.sqlText, 50).sql;
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Recipe SQL is not safe to save." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  if (typeof body.recipeId === "string" && body.recipeId.trim()) {
    const existingRows = (await sql`
      select username
      from app_private.dataset_recipes
      where id = ${body.recipeId.trim()}
      limit 1
    `) as Array<{ username: string }>;
    const existing = existingRows[0];

    if (!existing) {
      return Response.json({ ok: false, error: "Recipe not found." }, { status: 404, headers: noStoreHeaders });
    }

    if (user.role !== "admin" && existing.username !== user.username) {
      return Response.json({ ok: false, error: "You can only update your own recipes." }, { status: 403, headers: noStoreHeaders });
    }

    const rows = (await sql`
      update app_private.dataset_recipes
      set
        title = ${title},
        natural_language_request = ${naturalLanguageRequest},
        sql_text = ${validatedSql},
        row_grain = ${rowGrain},
        status = ${status},
        updated_at = now()
      where id = ${body.recipeId.trim()}
      returning
        id,
        username,
        title,
        natural_language_request,
        sql_text,
        row_grain,
        status,
        created_at,
        updated_at
    `) as DatasetRecipeRow[];

    return Response.json(
      { ok: true, recipe: toDatasetRecipeRecord(rows[0], user.username, user.role) },
      { headers: noStoreHeaders },
    );
  }

  const rows = (await sql`
    insert into app_private.dataset_recipes (
      id,
      username,
      title,
      natural_language_request,
      sql_text,
      row_grain,
      status,
      created_at,
      updated_at
    )
    values (
      ${randomUUID()},
      ${user.username},
      ${title},
      ${naturalLanguageRequest},
      ${validatedSql},
      ${rowGrain},
      ${status},
      now(),
      now()
    )
    returning
      id,
      username,
      title,
      natural_language_request,
      sql_text,
      row_grain,
      status,
      created_at,
      updated_at
  `) as DatasetRecipeRow[];

  return Response.json(
    { ok: true, recipe: toDatasetRecipeRecord(rows[0], user.username, user.role) },
    { headers: noStoreHeaders },
  );
}
