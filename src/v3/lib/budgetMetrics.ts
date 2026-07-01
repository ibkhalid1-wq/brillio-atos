/**
 * Budget & benefits derivations — cost variance, benefit realization, net value,
 * and benefit-milestone timing.
 *
 * The stored figures (projectedCost/actualSpend/projectedBenefits/realisedBenefits)
 * previously only surfaced as editable form fields; BudgetView never turned them
 * into variance or realization insight, and overdue benefit milestones were shown
 * with the same styling as on-track ones. Centralising the maths here keeps it
 * pure and unit-testable and out of the component.
 */
import type { BudgetTracking, BenefitMilestone } from "@/new/types";

/** Utilization within ±5% of budget counts as on-budget rather than over/under. */
export const BUDGET_TOLERANCE = 0.05;

export type CostVariance =
  | { kind: "unknown" }
  | {
      kind: "known";
      spent: number;
      budgeted: number;
      /** actualSpend / projectedCost (1 = exactly on budget). */
      utilization: number;
      /** projectedCost − actualSpend (positive = under budget). */
      variance: number;
      status: "under" | "on-budget" | "over";
    };

export function costVariance(budget: BudgetTracking): CostVariance {
  const { projectedCost, actualSpend } = budget;
  if (projectedCost === null || actualSpend === null || projectedCost <= 0) {
    return { kind: "unknown" };
  }
  const utilization = actualSpend / projectedCost;
  const status =
    utilization > 1 + BUDGET_TOLERANCE ? "over" : utilization < 1 - BUDGET_TOLERANCE ? "under" : "on-budget";
  return { kind: "known", spent: actualSpend, budgeted: projectedCost, utilization, variance: projectedCost - actualSpend, status };
}

export type BenefitRealization =
  | { kind: "unknown" }
  | {
      kind: "known";
      realised: number;
      projected: number;
      /** realisedBenefits / projectedBenefits (0..1+). */
      ratio: number;
      /** projectedBenefits − realisedBenefits (value still to capture). */
      remaining: number;
    };

export function benefitRealization(budget: BudgetTracking): BenefitRealization {
  const { projectedBenefits, realisedBenefits } = budget;
  if (projectedBenefits === null || realisedBenefits === null || projectedBenefits <= 0) {
    return { kind: "unknown" };
  }
  return {
    kind: "known",
    realised: realisedBenefits,
    projected: projectedBenefits,
    ratio: realisedBenefits / projectedBenefits,
    remaining: projectedBenefits - realisedBenefits,
  };
}

/** Value captured net of money spent (realisedBenefits − actualSpend), or null if either is unknown. */
export function netValue(budget: BudgetTracking): number | null {
  if (budget.realisedBenefits === null || budget.actualSpend === null) return null;
  return budget.realisedBenefits - budget.actualSpend;
}

/** Past its target date and not yet realised. */
export function isMilestoneOverdue(milestone: BenefitMilestone, now: number = Date.now()): boolean {
  if (milestone.status === "realised" || !milestone.targetDate) return false;
  const target = new Date(milestone.targetDate).getTime();
  return Number.isFinite(target) && target < now;
}

export interface MilestoneSummary {
  total: number;
  realised: number;
  atRisk: number;
  overdue: number;
  pending: number;
}

/** Bucket benefit milestones; overdue takes precedence over the raw at-risk/pending status. */
export function summariseMilestones(milestones: BenefitMilestone[], now: number = Date.now()): MilestoneSummary {
  let realised = 0;
  let atRisk = 0;
  let overdue = 0;
  let pending = 0;
  for (const milestone of milestones) {
    if (milestone.status === "realised") realised += 1;
    else if (isMilestoneOverdue(milestone, now)) overdue += 1;
    else if (milestone.status === "at-risk") atRisk += 1;
    else pending += 1;
  }
  return { total: milestones.length, realised, atRisk, overdue, pending };
}

/** Chronological by target date; undated milestones sort last. */
export function sortMilestonesByTarget(milestones: BenefitMilestone[]): BenefitMilestone[] {
  return [...milestones].sort((a, b) => {
    const ta = a.targetDate ? new Date(a.targetDate).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.targetDate ? new Date(b.targetDate).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
}
