import type { ModelTier } from "./ai-model";
import { getAppSql } from "./db";
import { getOptionalEnv } from "./env";
import { maskPiiText } from "./pii-guard";

type UsageLike = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
};

type BudgetResult = {
  allowed: boolean;
  reason?: string;
};

type UsageLogInput = {
  username: string;
  modelTier: ModelTier;
  modelRouteLabel: string;
  usage: UsageLike | undefined;
  status: "success" | "blocked" | "error";
};

type QueryRunInput = {
  username: string;
  sqlText: string;
  rowCount: number;
  durationMs: number;
  status: "success" | "blocked" | "error";
  errorMessage?: string;
};

const modelPricingPerMillion: Record<string, { input: number; output: number }> = {
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.3-codex": { input: 1.75, output: 14.0 },
  "gpt-5.4": { input: 2.5, output: 15.0 },
  "gpt-5.5": { input: 5.0, output: 30.0 },
};

function parseBudgetEnv(name: string): number | null {
  const value = Number(getOptionalEnv(name));

  return Number.isFinite(value) && value > 0 ? value : null;
}

function inferModelName(modelRouteLabel: string): string {
  const knownModel = Object.keys(modelPricingPerMillion).find((model) =>
    modelRouteLabel.includes(model),
  );

  return knownModel ?? modelRouteLabel;
}

function parsePriceEnv(name: string): number | null {
  const value = Number(getOptionalEnv(name));

  return Number.isFinite(value) && value >= 0 ? value : null;
}

function getTierPricingFromEnv(modelTier: ModelTier): { input: number; output: number } | null {
  const tierPrefix = modelTier.toUpperCase();
  const input = parsePriceEnv(`AZURE_AI_${tierPrefix}_INPUT_USD_PER_1M`);
  const output = parsePriceEnv(`AZURE_AI_${tierPrefix}_OUTPUT_USD_PER_1M`);

  return input !== null && output !== null ? { input, output } : null;
}

function getTokenCount(usage: UsageLike | undefined, keys: Array<keyof UsageLike>): number {
  for (const key of keys) {
    const value = usage?.[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

export function sanitizeSqlTextForActivityLog(sqlText: string): string {
  return maskPiiText(sqlText)
    .text.replace(/'(?:''|[^'])*'/g, "'[MASKED_SQL_LITERAL]'")
    .replace(/--[^\r\n]*/g, "-- [MASKED_SQL_COMMENT]")
    .replace(/\/\*[\s\S]*?\*\//g, "/* [MASKED_SQL_COMMENT] */")
    .slice(0, 20000);
}

export function estimateCostUsd({
  modelTier,
  modelRouteLabel,
  usage,
}: {
  modelTier: ModelTier;
  modelRouteLabel: string;
  usage: UsageLike | undefined;
}): number {
  const modelName = inferModelName(modelRouteLabel);
  const pricing = getTierPricingFromEnv(modelTier) ?? modelPricingPerMillion[modelName];

  if (!pricing) {
    return 0;
  }

  const inputTokens = getTokenCount(usage, ["inputTokens", "promptTokens"]);
  const outputTokens = getTokenCount(usage, ["outputTokens", "completionTokens"]);

  return ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1_000_000;
}

export async function checkAiBudget(username: string): Promise<BudgetResult> {
  const sql = getAppSql();

  if (!sql) {
    return { allowed: true };
  }

  const dailyBudget = parseBudgetEnv("PER_USER_DAILY_BUDGET_USD");
  const monthlyBudget = parseBudgetEnv("MONTHLY_TOKEN_BUDGET_USD");

  if (!dailyBudget && !monthlyBudget) {
    return { allowed: true };
  }

  let usage: {
    user_daily_cost: number;
    monthly_cost: number;
  };

  try {
    [usage] = (await sql`
      select
        coalesce(sum(estimated_cost_usd) filter (
          where username = ${username}
            and created_at >= date_trunc('day', now())
        ), 0)::float8 as user_daily_cost,
        coalesce(sum(estimated_cost_usd) filter (
          where created_at >= date_trunc('month', now())
        ), 0)::float8 as monthly_cost
      from app_private.ai_usage_logs
    `) as Array<{
      user_daily_cost: number;
      monthly_cost: number;
    }>;
  } catch {
    console.error("AI usage budget table is not available. Run npm run init-app-db.");
    return { allowed: true };
  }

  if (dailyBudget && usage.user_daily_cost >= dailyBudget) {
    return {
      allowed: false,
      reason: "Daily model budget reached for this user.",
    };
  }

  if (monthlyBudget && usage.monthly_cost >= monthlyBudget) {
    return {
      allowed: false,
      reason: "Monthly model budget reached for this portal.",
    };
  }

  return { allowed: true };
}

export async function recordAiUsage(input: UsageLogInput): Promise<void> {
  const sql = getAppSql();

  if (!sql) {
    return;
  }

  const inputTokens = getTokenCount(input.usage, ["inputTokens", "promptTokens"]);
  const outputTokens = getTokenCount(input.usage, ["outputTokens", "completionTokens"]);
  const totalTokens = getTokenCount(input.usage, ["totalTokens"]) || inputTokens + outputTokens;
  const estimatedCost = estimateCostUsd({
    modelTier: input.modelTier,
    modelRouteLabel: input.modelRouteLabel,
    usage: input.usage,
  });

  await sql`
    insert into app_private.ai_usage_logs (
      username,
      model_tier,
      model_route,
      input_tokens,
      output_tokens,
      total_tokens,
      estimated_cost_usd,
      status
    )
    values (
      ${input.username},
      ${input.modelTier},
      ${input.modelRouteLabel},
      ${inputTokens},
      ${outputTokens},
      ${totalTokens},
      ${estimatedCost},
      ${input.status}
    )
  `;
}

export async function recordAiPreRoutingBlock(username: string): Promise<void> {
  await recordAiUsage({
    username,
    modelTier: "cheap",
    modelRouteLabel: "blocked before routing",
    usage: undefined,
    status: "blocked",
  });
}

export async function recordQueryRun(input: QueryRunInput): Promise<void> {
  const sql = getAppSql();

  if (!sql) {
    return;
  }

  await sql`
    insert into app_private.query_runs (
      username,
      sql_text,
      row_count,
      duration_ms,
      status,
      error_message
    )
    values (
      ${input.username},
      ${sanitizeSqlTextForActivityLog(input.sqlText)},
      ${input.rowCount},
      ${input.durationMs},
      ${input.status},
      ${input.errorMessage?.slice(0, 500) ?? null}
    )
  `;
}
