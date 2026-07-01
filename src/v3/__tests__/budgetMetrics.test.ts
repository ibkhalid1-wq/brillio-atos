import { describe, it, expect } from "vitest";
import type { BudgetTracking, BenefitMilestone } from "@/new/types";
import {
  costVariance,
  benefitRealization,
  netValue,
  isMilestoneOverdue,
  summariseMilestones,
  sortMilestonesByTarget,
} from "@/v3/lib/budgetMetrics";

function budget(overrides: Partial<BudgetTracking> = {}): BudgetTracking {
  return {
    projectedCost: 1000,
    actualSpend: 800,
    projectedBenefits: 2000,
    realisedBenefits: 500,
    roi: 2,
    burnRate: "healthy",
    valueDeliveryRate: "on-track",
    phaseSpend: [],
    benefitMilestones: [],
    healthSignal: "green",
    healthReason: "",
    confidence: 0.8,
    ...overrides,
  };
}

function milestone(overrides: Partial<BenefitMilestone> = {}): BenefitMilestone {
  return {
    id: "m1",
    title: "Go-live value",
    targetDate: "2026-01-01",
    estimatedValue: "$500K",
    status: "pending",
    phaseId: "deploy",
    ...overrides,
  };
}

describe("costVariance", () => {
  it("is unknown when cost or spend is missing or budget is zero", () => {
    expect(costVariance(budget({ projectedCost: null })).kind).toBe("unknown");
    expect(costVariance(budget({ actualSpend: null })).kind).toBe("unknown");
    expect(costVariance(budget({ projectedCost: 0 })).kind).toBe("unknown");
  });

  it("computes utilization and positive variance when under budget", () => {
    expect(costVariance(budget({ projectedCost: 1000, actualSpend: 800 }))).toEqual({
      kind: "known",
      spent: 800,
      budgeted: 1000,
      utilization: 0.8,
      variance: 200,
      status: "under",
    });
  });

  it("flags overspend past the tolerance band", () => {
    const v = costVariance(budget({ projectedCost: 1000, actualSpend: 1200 }));
    expect(v.kind === "known" && v.status).toBe("over");
    expect(v.kind === "known" && v.variance).toBe(-200);
  });

  it("treats spend within ±5% of budget as on-budget", () => {
    expect((costVariance(budget({ projectedCost: 1000, actualSpend: 1030 })) as { status: string }).status).toBe("on-budget");
    expect((costVariance(budget({ projectedCost: 1000, actualSpend: 970 })) as { status: string }).status).toBe("on-budget");
  });
});

describe("benefitRealization / netValue", () => {
  it("is unknown when projected or realised is missing", () => {
    expect(benefitRealization(budget({ projectedBenefits: null })).kind).toBe("unknown");
    expect(benefitRealization(budget({ realisedBenefits: null })).kind).toBe("unknown");
  });

  it("computes capture ratio and remaining value", () => {
    expect(benefitRealization(budget({ projectedBenefits: 2000, realisedBenefits: 500 }))).toEqual({
      kind: "known",
      realised: 500,
      projected: 2000,
      ratio: 0.25,
      remaining: 1500,
    });
  });

  it("netValue subtracts spend from realised benefits, or null if unknown", () => {
    expect(netValue(budget({ realisedBenefits: 900, actualSpend: 800 }))).toBe(100);
    expect(netValue(budget({ realisedBenefits: null }))).toBeNull();
    expect(netValue(budget({ actualSpend: null }))).toBeNull();
  });
});

describe("milestone timing", () => {
  const now = new Date("2026-06-01").getTime();

  it("isMilestoneOverdue: past target and not realised", () => {
    expect(isMilestoneOverdue(milestone({ targetDate: "2026-01-01", status: "pending" }), now)).toBe(true);
    expect(isMilestoneOverdue(milestone({ targetDate: "2026-12-01", status: "pending" }), now)).toBe(false);
    expect(isMilestoneOverdue(milestone({ targetDate: "2026-01-01", status: "realised" }), now)).toBe(false);
    expect(isMilestoneOverdue(milestone({ targetDate: null }), now)).toBe(false);
  });

  it("summariseMilestones buckets with overdue taking precedence over status", () => {
    const summary = summariseMilestones(
      [
        milestone({ id: "a", status: "realised" }),
        milestone({ id: "b", status: "at-risk", targetDate: "2026-12-01" }),
        milestone({ id: "c", status: "pending", targetDate: "2026-01-01" }), // overdue
        milestone({ id: "d", status: "at-risk", targetDate: "2026-01-01" }), // overdue wins
        milestone({ id: "e", status: "pending", targetDate: "2026-12-01" }),
      ],
      now,
    );
    expect(summary).toEqual({ total: 5, realised: 1, atRisk: 1, overdue: 2, pending: 1 });
  });

  it("sortMilestonesByTarget orders chronologically with undated last", () => {
    const sorted = sortMilestonesByTarget([
      milestone({ id: "late", targetDate: "2026-12-01" }),
      milestone({ id: "none", targetDate: null }),
      milestone({ id: "early", targetDate: "2026-01-01" }),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["early", "late", "none"]);
  });
});
