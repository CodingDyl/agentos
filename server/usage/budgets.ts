import type {
  BudgetState,
  UsageBudget,
  UsageRecord,
} from "../../shared/usage-types";
import { usageDatabase } from "./db";

/**
 * Spending ceilings.
 *
 * Advisory, and staying that way for now. Crossing a budget produces a warning
 * and then an attention item; it never kills a running job. A worker
 * terminated halfway through an implementation because a counter crossed
 * $50.01 costs far more than the dollar it saved — the work is lost, the
 * worktree is orphaned, and the operator has to reconstruct what it was doing.
 *
 * The hard limit that does exist is Claude's per-job budget, and that is the
 * right shape for one: it is scoped to a single run, known before the run
 * starts, and enforced by the runner that can stop cleanly. A global monthly
 * cap has none of those properties.
 */

/** The default when nothing has been configured. Advisory, like the rest. */
const DEFAULT_WARNING_PERCENT = 80;

interface BudgetRow {
  scope: string;
  scope_id: string;
  monthly_usd: number;
  warning_percent: number;
}

export function listBudgets(): UsageBudget[] {
  try {
    const rows = usageDatabase()
      .prepare("SELECT * FROM budgets ORDER BY scope, scope_id")
      .all() as unknown as BudgetRow[];

    return rows.map((row) => ({
      scope: row.scope as UsageBudget["scope"],
      scopeId: row.scope_id || undefined,
      monthlyUsd: row.monthly_usd,
      warningPercent: row.warning_percent,
    }));
  } catch (error) {
    console.error("[agentos] could not read budgets:", error);
    return [];
  }
}

/** Sets one budget. Scope plus id is the key, so this is an upsert. */
export function saveBudget(budget: UsageBudget): UsageBudget | undefined {
  try {
    usageDatabase()
      .prepare(
        `INSERT INTO budgets (scope, scope_id, monthly_usd, warning_percent)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (scope, scope_id) DO UPDATE SET
           monthly_usd = excluded.monthly_usd,
           warning_percent = excluded.warning_percent`,
      )
      .run(
        budget.scope,
        budget.scopeId ?? "",
        budget.monthlyUsd,
        budget.warningPercent ?? DEFAULT_WARNING_PERCENT,
      );

    return budget;
  } catch (error) {
    console.error("[agentos] could not save a budget:", error);
    return undefined;
  }
}

export function deleteBudget(scope: string, scopeId = ""): boolean {
  try {
    const result = usageDatabase()
      .prepare("DELETE FROM budgets WHERE scope = ? AND scope_id = ?")
      .run(scope, scopeId);

    return Number(result.changes) > 0;
  } catch (error) {
    console.error("[agentos] could not delete a budget:", error);
    return false;
  }
}

/** Whether a record counts against a given budget. */
function applies(budget: UsageBudget, record: UsageRecord): boolean {
  if (budget.scope === "global") return true;
  if (budget.scope === "project") return record.project === budget.scopeId;

  return record.agent === budget.scopeId;
}

/**
 * Measures budgets against the month's spend.
 *
 * Only *measured* cost counts. A month where half the runs reported no price
 * will read as under budget, and that is the honest reading — the alternative
 * is estimating the unmeasured half and then warning someone about a number
 * AgentOS invented. The coverage gap is visible on the same screen, in the
 * totals that say how many records carried a cost.
 */
export function evaluateBudgets(
  budgets: readonly UsageBudget[],
  records: readonly UsageRecord[],
): BudgetState[] {
  return budgets.map((budget) => {
    const spentUsd = records
      .filter((record) => applies(budget, record))
      .reduce(
        (sum, record) =>
          typeof record.costUsd === "number" ? sum + record.costUsd : sum,
        0,
      );

    const fraction = budget.monthlyUsd > 0 ? spentUsd / budget.monthlyUsd : 0;
    const warnAt = (budget.warningPercent ?? DEFAULT_WARNING_PERCENT) / 100;

    return {
      budget,
      spentUsd,
      fraction,
      state: fraction >= 1 ? "exceeded" : fraction >= warnAt ? "warning" : "ok",
    };
  });
}
