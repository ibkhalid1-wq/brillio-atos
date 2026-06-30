import { describe, it, expect } from "vitest";
import type { DecisionSummary, ProgramSummary } from "@/new/types";
import {
  buildPlanGroundingIndex,
  claimsMissing,
  isGroundedFalsePositiveDecision,
  type PlanGrounding,
} from "@/v3/lib/decisionGrounding";

function pcr(overrides: Partial<DecisionSummary> = {}): DecisionSummary {
  return {
    id: "pcr_x",
    title: "",
    type: "pcr-review",
    priority: "medium",
    phaseId: "strategy",
    question: "",
    options: [],
    createdAt: "2026-07-01T00:00:00Z",
    ...overrides,
  } as DecisionSummary;
}

const GROUNDED: PlanGrounding = { hasTimeline: true, hasOwners: true, hasObjective: true, hasKpis: true };
const UNGROUNDED: PlanGrounding = { hasTimeline: false, hasOwners: false, hasObjective: false, hasKpis: false };

describe("claimsMissing", () => {
  it("detects 'no objectives are defined' phrasing", () => {
    expect(claimsMissing("no objectives are defined at the program level", "(?:objectives?)", true)).toBe(true);
  });

  it("detects 'objectives ... not defined' phrasing", () => {
    expect(claimsMissing("program objectives have not been defined", "(?:objectives?)", true)).toBe(true);
  });

  it("does not fire when the noun is present without an absence claim", () => {
    expect(claimsMissing("objectives are clearly defined and approved", "(?:objectives?)", true)).toBe(false);
  });
});

describe("buildPlanGroundingIndex", () => {
  it("reads grounding from nested Strategy/Mobilise inputs", () => {
    const program = {
      rawData: {
        data: {
          phaseInputs: {
            strategy: {
              businessObjective: "Transform fragmented commercial execution into a growth engine.",
              successMetric: "Reduce CRM licensing costs by 30% within twelve months.",
              startDate: "2026-01-01",
              targetEndDate: "2026-12-31",
            },
            mobilise: {
              coreTeam: [{ role: "Sponsor", name: "Dana Reed" }],
            },
          },
        },
      },
    } as unknown as ProgramSummary;
    expect(buildPlanGroundingIndex(program)).toEqual({
      hasTimeline: true,
      hasOwners: true,
      hasObjective: true,
      hasKpis: true,
    });
  });

  it("reports ungrounded for an empty programme", () => {
    expect(buildPlanGroundingIndex({ rawData: {} } as unknown as ProgramSummary)).toEqual({
      hasTimeline: false,
      hasOwners: false,
      hasObjective: false,
      hasKpis: false,
    });
  });

  it("handles a flat (non-nested) rawData shape and JSON-encoded roster", () => {
    const program = {
      rawData: {
        phaseInputs: {
          strategy: { objective: "Establish a unified delivery operating model across regions." },
          mobilise: { roster: JSON.stringify([{ role: "Lead", name: "Sam" }]) },
        },
      },
    } as unknown as ProgramSummary;
    const grounding = buildPlanGroundingIndex(program);
    expect(grounding.hasObjective).toBe(true);
    expect(grounding.hasOwners).toBe(true);
  });
});

describe("isGroundedFalsePositiveDecision", () => {
  it("suppresses a missing-objectives PCR when objectives are grounded", () => {
    const decision = pcr({ title: "No objectives are defined at the program or phase level" });
    expect(isGroundedFalsePositiveDecision(decision, GROUNDED)).toBe(true);
  });

  it("keeps a missing-objectives PCR when objectives are NOT grounded", () => {
    const decision = pcr({ title: "No objectives are defined at the program or phase level" });
    expect(isGroundedFalsePositiveDecision(decision, UNGROUNDED)).toBe(false);
  });

  it("suppresses an exit-criteria PCR unconditionally (criteria are gate-derived)", () => {
    const decision = pcr({ title: "Define phase exit criteria for the Discover phase" });
    expect(isGroundedFalsePositiveDecision(decision, UNGROUNDED)).toBe(true);
  });

  it("suppresses a missing-timeline PCR when the timeline is grounded", () => {
    const decision = pcr({ title: "No milestones or estimated target dates have been defined" });
    expect(isGroundedFalsePositiveDecision(decision, GROUNDED)).toBe(true);
  });

  it("never touches a non-PCR decision even when it mentions objectives", () => {
    const decision = pcr({ type: "gate_approval", title: "No objectives are defined" });
    expect(isGroundedFalsePositiveDecision(decision, GROUNDED)).toBe(false);
  });

  it("leaves a substantive PCR (draft artifacts) alone — not an absence claim", () => {
    const decision = pcr({ title: "Three deliverables remain in draft and need review" });
    expect(isGroundedFalsePositiveDecision(decision, GROUNDED)).toBe(false);
  });
});
