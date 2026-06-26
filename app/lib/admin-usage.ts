export type BudgetWarningLevel = "warning" | "critical";

export type BudgetWarning = {
  level: BudgetWarningLevel;
  message: string;
};

export type AdminUsageBudgetConfig = {
  perUserDailyUsd: number | null;
  monthlyUsd: number | null;
};

export type AdminUsageUserBudgetSummary = {
  displayName: string;
  dailyEstimatedCostUsd: number;
};

export type AdminUsageTotalsBudgetSummary = {
  monthlyEstimatedCostUsd: number;
};

function warningLevel(ratio: number): BudgetWarningLevel {
  return ratio >= 1 ? "critical" : "warning";
}

function percentLabel(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function buildBudgetWarnings({
  budgets,
  totals,
  users,
}: {
  budgets: AdminUsageBudgetConfig;
  totals: AdminUsageTotalsBudgetSummary;
  users: AdminUsageUserBudgetSummary[];
}): BudgetWarning[] {
  const warnings: BudgetWarning[] = [];

  if (budgets.monthlyUsd !== null && budgets.monthlyUsd > 0) {
    const ratio = totals.monthlyEstimatedCostUsd / budgets.monthlyUsd;

    if (ratio >= 0.8) {
      warnings.push({
        level: warningLevel(ratio),
        message: `Portal monthly model spend is at ${percentLabel(ratio)} of the configured budget.`,
      });
    }
  }

  if (budgets.perUserDailyUsd !== null && budgets.perUserDailyUsd > 0) {
    for (const user of users) {
      const ratio = user.dailyEstimatedCostUsd / budgets.perUserDailyUsd;

      if (ratio >= 0.8) {
        warnings.push({
          level: warningLevel(ratio),
          message: `${user.displayName} is at ${percentLabel(ratio)} of the daily model budget.`,
        });
      }
    }
  }

  return warnings;
}
