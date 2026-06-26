import { canAccessNeon, getSession } from "@/app/lib/auth";
import { getReadOnlySql } from "@/app/lib/db";
import { checkQueryPreviewRateLimit } from "@/app/lib/rate-limit";
import { rejectCrossSiteRequest } from "@/app/lib/request-security";
import { validateAppMetadataRequestContentLength } from "@/app/lib/request-size";
import { getQueryTimeoutMs, validatePreviewSql } from "@/app/lib/sql-preview";
import { recordQueryRun } from "@/app/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 20;

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

type QueryPreviewRequest = {
  sql?: unknown;
  limit?: unknown;
};

function serializeRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Date ? value.toISOString() : value,
      ]),
    ),
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
    await recordQueryRun({
      username: user.username,
      sqlText: "[blocked before SQL parsing: Neon workflow access required]",
      rowCount: 0,
      durationMs: 0,
      status: "blocked",
      errorMessage: "Neon query preview is not enabled for this account.",
    }).catch(() => undefined);

    return Response.json({ ok: false, error: "Neon query preview is not enabled for this account." }, { status: 403, headers: noStoreHeaders });
  }

  const rateLimit = checkQueryPreviewRateLimit(user.username);

  if (!rateLimit.allowed) {
    await recordQueryRun({
      username: user.username,
      sqlText: "[blocked before SQL parsing: query preview rate limit]",
      rowCount: 0,
      durationMs: 0,
      status: "blocked",
      errorMessage: "Too many query previews.",
    }).catch(() => undefined);

    return Response.json(
      { ok: false, error: "Too many query previews. Try again shortly.", retryAfterSeconds: rateLimit.retryAfterSeconds },
      {
        status: 429,
        headers: {
          ...noStoreHeaders,
          "retry-after": String(rateLimit.retryAfterSeconds ?? 60),
        },
      },
    );
  }

  let body: QueryPreviewRequest;

  try {
    validateAppMetadataRequestContentLength(request);
    body = (await request.json().catch(() => ({}))) as QueryPreviewRequest;
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Query preview request is invalid." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const startedAt = Date.now();

  try {
    const preview = validatePreviewSql(body.sql, body.limit);
    const readOnlySql = getReadOnlySql();
    const timeoutMs = getQueryTimeoutMs();
    const [, rows] = (await readOnlySql.transaction(
      (transaction) => [
        transaction`select set_config('statement_timeout', ${String(timeoutMs)}, true)`,
        transaction`
          select *
          from (${transaction.unsafe(preview.sql)}) as preview_query
          limit ${preview.limit}
        `,
      ],
      {
        readOnly: true,
      },
    )) as [unknown, Array<Record<string, unknown>>];
    const durationMs = Date.now() - startedAt;

    await recordQueryRun({
      username: user.username,
      sqlText: preview.sql,
      rowCount: rows.length,
      durationMs,
      status: "success",
    }).catch(() => undefined);

    return Response.json(
      {
        ok: true,
        columns: rows[0] ? Object.keys(rows[0]) : [],
        rows: serializeRows(rows),
        rowCount: rows.length,
        limit: preview.limit,
        timeoutMs,
        durationMs,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Query preview failed.";
    const blocked = /must|only|blocked|not allowed/i.test(message);

    await recordQueryRun({
      username: user.username,
      sqlText: typeof body.sql === "string" ? body.sql : "",
      rowCount: 0,
      durationMs: Date.now() - startedAt,
      status: blocked ? "blocked" : "error",
      errorMessage: message,
    }).catch(() => undefined);

    return Response.json(
      { ok: false, error: blocked ? message : "Query preview failed. Check table names, columns, filters, and row grain." },
      { status: blocked ? 400 : 422, headers: noStoreHeaders },
    );
  }
}
