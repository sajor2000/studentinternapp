import { getSession } from "@/app/lib/auth";
import { buildBudgetWarnings } from "@/app/lib/admin-usage";
import { getAppSql } from "@/app/lib/db";
import { getOptionalEnv } from "@/app/lib/env";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

type UsageSummaryRow = {
  username: string;
  display_name: string;
  role: "intern" | "admin";
  workflow_mode: "neon" | "phi_local" | "dual" | null;
  request_count: number | string;
  failed_request_count: number | string;
  input_tokens: number | string;
  output_tokens: number | string;
  total_tokens: number | string;
  estimated_cost_usd: number | string;
  daily_estimated_cost_usd: number | string;
  monthly_estimated_cost_usd: number | string;
  last_used_at: string | Date | null;
  upload_count: number | string;
  upload_bytes: number | string;
  chat_session_count: number | string;
  last_chat_at: string | Date | null;
  query_count: number | string;
  failed_query_count: number | string;
  last_query_at: string | Date | null;
};

function parseBudget(name: string): number | null {
  const value = Number(getOptionalEnv(name));

  return Number.isFinite(value) && value > 0 ? value : null;
}

function toNumber(value: number | string | null): number {
  if (value === null) {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeWorkflowMode(value: UsageSummaryRow["workflow_mode"]): "neon" | "phi_local" | "dual" {
  return value === "neon" || value === "phi_local" || value === "dual" ? value : "dual";
}

async function tableExists(sql: ReturnType<typeof getAppSql>, tableName: string): Promise<boolean> {
  if (!sql) {
    return false;
  }

  const rows = (await sql`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'app_private'
        and table_name = ${tableName}
    ) as exists
  `) as Array<{ exists: boolean }>;

  return rows[0]?.exists === true;
}

export async function GET() {
  const user = await getSession();

  if (!user) {
    return Response.json({ ok: false, error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
  }

  if (user.role !== "admin") {
    return Response.json({ ok: false, error: "Admin access required." }, { status: 403, headers: noStoreHeaders });
  }

  const sql = getAppSql();

  if (!sql) {
    return Response.json({ ok: false, error: "Usage database is not configured." }, { status: 503, headers: noStoreHeaders });
  }

  const workflowModeColumnRows = (await sql`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'app_private'
        and table_name = 'intern_users'
        and column_name = 'workflow_mode'
    ) as has_workflow_mode
  `) as Array<{ has_workflow_mode: boolean }>;
  const hasWorkflowModeColumn = workflowModeColumnRows[0]?.has_workflow_mode === true;
  const hasAiUsageLogs = await tableExists(sql, "ai_usage_logs");
  const hasFileUploads = await tableExists(sql, "file_uploads");
  const hasChatSessions = await tableExists(sql, "chat_sessions");
  const hasQueryRuns = await tableExists(sql, "query_runs");
  const workflowModeSelect = hasWorkflowModeColumn ? "users.workflow_mode" : "null::text as workflow_mode";
  const usageCte = hasAiUsageLogs
    ? `
      select
        username,
        count(*) as request_count,
        count(*) filter (where status <> 'success') as failed_request_count,
        coalesce(sum(input_tokens), 0) as input_tokens,
        coalesce(sum(output_tokens), 0) as output_tokens,
        coalesce(sum(total_tokens), 0) as total_tokens,
        coalesce(sum(estimated_cost_usd), 0)::float8 as estimated_cost_usd,
        coalesce(sum(estimated_cost_usd) filter (
          where created_at >= date_trunc('day', now())
        ), 0)::float8 as daily_estimated_cost_usd,
        coalesce(sum(estimated_cost_usd) filter (
          where created_at >= date_trunc('month', now())
        ), 0)::float8 as monthly_estimated_cost_usd,
        max(created_at) as last_used_at
      from app_private.ai_usage_logs
      where created_at >= now() - interval '30 days'
      group by username
    `
    : `
      select
        null::text as username,
        0::bigint as request_count,
        0::bigint as failed_request_count,
        0::bigint as input_tokens,
        0::bigint as output_tokens,
        0::bigint as total_tokens,
        0::float8 as estimated_cost_usd,
        0::float8 as daily_estimated_cost_usd,
        0::float8 as monthly_estimated_cost_usd,
        null::timestamptz as last_used_at
      where false
    `;
  const uploadsCte = hasFileUploads
    ? `
      select
        username,
        count(*) as upload_count,
        coalesce(sum(size_bytes), 0) as upload_bytes
      from app_private.file_uploads
      where created_at >= now() - interval '30 days'
      group by username
    `
    : `
      select
        null::text as username,
        0::bigint as upload_count,
        0::bigint as upload_bytes
      where false
    `;
  const queriesCte = hasQueryRuns
    ? `
      select
        username,
        count(*) as query_count,
        count(*) filter (where status <> 'success') as failed_query_count,
        max(created_at) as last_query_at
      from app_private.query_runs
      where created_at >= now() - interval '30 days'
      group by username
    `
    : `
      select
        null::text as username,
        0::bigint as query_count,
        0::bigint as failed_query_count,
        null::timestamptz as last_query_at
      where false
    `;
  const chatsCte = hasChatSessions
    ? `
      select
        username,
        count(*) as chat_session_count,
        max(updated_at) as last_chat_at
      from app_private.chat_sessions
      where updated_at >= now() - interval '30 days'
      group by username
    `
    : `
      select
        null::text as username,
        0::bigint as chat_session_count,
        null::timestamptz as last_chat_at
      where false
    `;
  const rows = (await sql.query(`
    with usage_30d as (${usageCte}),
    uploads_30d as (${uploadsCte}),
    queries_30d as (${queriesCte}),
    chats_30d as (${chatsCte})
    select
      users.username,
      users.display_name,
      users.role,
      ${workflowModeSelect},
      coalesce(usage_30d.request_count, 0) as request_count,
      coalesce(usage_30d.failed_request_count, 0) as failed_request_count,
      coalesce(usage_30d.input_tokens, 0) as input_tokens,
      coalesce(usage_30d.output_tokens, 0) as output_tokens,
      coalesce(usage_30d.total_tokens, 0) as total_tokens,
      coalesce(usage_30d.estimated_cost_usd, 0)::float8 as estimated_cost_usd,
      coalesce(usage_30d.daily_estimated_cost_usd, 0)::float8 as daily_estimated_cost_usd,
      coalesce(usage_30d.monthly_estimated_cost_usd, 0)::float8 as monthly_estimated_cost_usd,
      usage_30d.last_used_at,
      coalesce(uploads_30d.upload_count, 0) as upload_count,
      coalesce(uploads_30d.upload_bytes, 0) as upload_bytes,
      coalesce(chats_30d.chat_session_count, 0) as chat_session_count,
      chats_30d.last_chat_at,
      coalesce(queries_30d.query_count, 0) as query_count,
      coalesce(queries_30d.failed_query_count, 0) as failed_query_count,
      queries_30d.last_query_at
    from app_private.intern_users users
    left join usage_30d
      on usage_30d.username = users.username
    left join uploads_30d
      on uploads_30d.username = users.username
    left join queries_30d
      on queries_30d.username = users.username
    left join chats_30d
      on chats_30d.username = users.username
    where users.is_active = true
    order by users.role desc, users.username asc
  `)) as UsageSummaryRow[];

  const users = rows.map((row) => ({
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    workflowMode: normalizeWorkflowMode(row.workflow_mode),
    requestCount: toNumber(row.request_count),
    failedRequestCount: toNumber(row.failed_request_count),
    inputTokens: toNumber(row.input_tokens),
    outputTokens: toNumber(row.output_tokens),
    totalTokens: toNumber(row.total_tokens),
    estimatedCostUsd: toNumber(row.estimated_cost_usd),
    dailyEstimatedCostUsd: toNumber(row.daily_estimated_cost_usd),
    monthlyEstimatedCostUsd: toNumber(row.monthly_estimated_cost_usd),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    uploadCount: toNumber(row.upload_count),
    uploadBytes: toNumber(row.upload_bytes),
    chatSessionCount: toNumber(row.chat_session_count),
    lastChatAt: row.last_chat_at ? new Date(row.last_chat_at).toISOString() : null,
    queryCount: toNumber(row.query_count),
    failedQueryCount: toNumber(row.failed_query_count),
    lastQueryAt: row.last_query_at ? new Date(row.last_query_at).toISOString() : null,
  }));

  const budgets = {
    perUserDailyUsd: parseBudget("PER_USER_DAILY_BUDGET_USD"),
    monthlyUsd: parseBudget("MONTHLY_TOKEN_BUDGET_USD"),
  };
  const totals = {
    requestCount: users.reduce((total, current) => total + current.requestCount, 0),
    failedRequestCount: users.reduce((total, current) => total + current.failedRequestCount, 0),
    totalTokens: users.reduce((total, current) => total + current.totalTokens, 0),
    estimatedCostUsd: users.reduce((total, current) => total + current.estimatedCostUsd, 0),
    monthlyEstimatedCostUsd: users.reduce((total, current) => total + current.monthlyEstimatedCostUsd, 0),
    uploadCount: users.reduce((total, current) => total + current.uploadCount, 0),
    uploadBytes: users.reduce((total, current) => total + current.uploadBytes, 0),
    chatSessionCount: users.reduce((total, current) => total + current.chatSessionCount, 0),
    queryCount: users.reduce((total, current) => total + current.queryCount, 0),
    failedQueryCount: users.reduce((total, current) => total + current.failedQueryCount, 0),
  };
  const budgetWarnings = buildBudgetWarnings({ budgets, totals, users });

  return Response.json(
    {
      ok: true,
      windowDays: 30,
      budgets,
      totals,
      budgetWarnings,
      users,
    },
    { headers: noStoreHeaders },
  );
}
