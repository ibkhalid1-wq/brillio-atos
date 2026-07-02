import { describe, it, expect } from "vitest";
import { getMethodology, type PhaseDefinition } from "@/v3/lib/methodology";
import {
  findFlowFieldGaps,
  analyzeExitCriteriaCoverage,
  analyzeMethodologySpine,
} from "@/v3/lib/methodologySpine";

// A minimal phase stub — only the fields the spine analyzer reads.
function phase(over: Partial<PhaseDefinition> = {}): PhaseDefinition {
  return {
    id: "strategy",
    displayName: "Strategy",
    description: "",
    requiredArtifacts: [],
    mandatoryExitCriteriaTemplates: [],
    entryGuards: [],
    recommendedAgents: [],
    typicalDurationWeeks: 1,
    inputFields: [],
    artifactInputFlow: {},
    ...over,
  } as PhaseDefinition;
}

describe("findFlowFieldGaps (structural invariant)", () => {
  it("flags a flow entry that points at an undeclared input field", () => {
    const gaps = findFlowFieldGaps(
      phase({
        id: "strategy",
        inputFields: [{ id: "sponsor", label: "Executive sponsor", type: "text", required: true }],
        artifactInputFlow: { charter: ["sponsor", "typoField"] },
      }),
    );
    expect(gaps).toEqual([{ phaseId: "strategy", artifactId: "charter", missingFieldId: "typoField" }]);
  });

  it("returns [] when every flow field id resolves to a declared input", () => {
    const gaps = findFlowFieldGaps(
      phase({
        inputFields: [
          { id: "sponsor", label: "Executive sponsor", type: "text", required: true },
          { id: "industry", label: "Industry", type: "text", required: true },
        ],
        artifactInputFlow: { charter: ["sponsor"], "business-case": ["industry", "sponsor"] },
      }),
    );
    expect(gaps).toEqual([]);
  });
});

describe("analyzeExitCriteriaCoverage (subject-overlap heuristic)", () => {
  it("backs a criterion with the fields whose subject text shares a noun", () => {
    // "sponsor" is a real strategy criterion; the sponsor field's subject text
    // carries the noun, so it should back strategy-3 (among others).
    const coverage = analyzeExitCriteriaCoverage(
      phase({
        id: "strategy",
        inputFields: [{ id: "sponsor", label: "Executive sponsor", type: "text", required: true, hint: "Name and title of the sponsor" }],
      }),
    );
    const sponsorCriterion = coverage.find((c) => c.criterionId === "strategy-3");
    expect(sponsorCriterion?.covered).toBe(true);
    expect(sponsorCriterion?.backingFieldIds).toContain("sponsor");
  });

  it("marks a criterion uncovered when no field's subject text overlaps it", () => {
    const coverage = analyzeExitCriteriaCoverage(
      phase({
        id: "strategy",
        inputFields: [{ id: "industry", label: "Industry", type: "text", required: true }],
      }),
    );
    // "Industry" carries no sponsor/business-case/objective noun.
    expect(coverage.every((c) => c.backingFieldIds.every((id) => id === "industry"))).toBe(true);
  });
});

describe("analyzeMethodologySpine (whole-registry coherence)", () => {
  // HARD INVARIANT — a flow entry that references a non-existent input field is
  // always a bug (rename/typo). It must be zero across every shipped variant.
  it.each(["atos-lite", "atos-standard", "atos-regulated"] as const)(
    "has no structural flow-field gaps in %s",
    (variant) => {
      expect(analyzeMethodologySpine(variant).flowFieldGaps).toEqual([]);
    },
  );

  // LOCKED INVENTORY — mandatory exit criteria with no input field that can hold
  // their evidence. These are methodology-design gaps (a criterion the phase can
  // only prove via an artifact/approval, never via a captured input). The list is
  // pinned so a NEW gap — or an accidental regression that drops a backing field —
  // surfaces in review instead of drifting silently. Work an item down by adding
  // the backing input field to the phase in methodology.ts, then delete it here.
  it("pins the exit-criteria coverage gaps for the default (atos-lite) variant", () => {
    const uncovered = analyzeMethodologySpine("atos-lite").uncoveredCriteria.map((c) => c.criterionId);
    expect(uncovered).toEqual([
      // Remaining gaps are ARTIFACT-derived by design — a deliverable proves them,
      // not a captured atomic fact — so they are intentionally left uncovered:
      "discover-1", // As-is assessment complete — proven by the current-state artifact
      "discover-2", // Stakeholder interviews completed — proven by the interview-log artifact
      "build-3", // Training material ready — proven by the training-pack artifact
      "operate-3", // KPIs being measured — proven by the KPI tracking artifact
      "valuerealize-4", // Handover to BAU confirmed — no BAU handover input yet
    ]);
  });

  it("keeps every pinned gap genuinely uncovered (no backing field ids)", () => {
    const report = analyzeMethodologySpine("atos-lite");
    for (const criterion of report.uncoveredCriteria) {
      expect(criterion.covered).toBe(false);
      expect(criterion.backingFieldIds).toEqual([]);
    }
  });
});

describe("Strategy governance-evidence fields (Option A)", () => {
  const strategy = getMethodology("atos-lite").phases.find((p) => p.id === "strategy")!;
  const field = (id: string) => strategy.inputFields?.find((f) => f.id === id);

  // These two fields give a home to the exact facts the Strategy exit criteria
  // demand as evidence — "date of sign-off" (strategy-3) and a "reference to the
  // approved business case" (strategy-1) — which previously no input could hold,
  // so the artifact reviewer pointed at a non-existent "relevant input".
  it("declares a sponsor sign-off date field for the sponsor-committed criterion", () => {
    const f = field("sponsorSignOffDate");
    expect(f?.type).toBe("date");
    // Optional so it never retroactively fails an in-flight programme's gate.
    expect(f?.required).toBe(false);
  });

  it("declares a business-case approval reference field for the business-case criterion", () => {
    const f = field("businessCaseApproval");
    expect(f?.type).toBe("text");
    expect(f?.required).toBe(false);
  });
});

describe("Mobilise governance-evidence fields (Option A)", () => {
  const mobilise = getMethodology("atos-lite").phases.find((p) => p.id === "mobilise")!;

  // "Budget baseline confirmed" (mobilise-4) asks for a budget approval reference —
  // the Strategy cost grid holds the estimate, not the approved baseline — so it
  // now has a backing input and is no longer in the uncovered inventory above.
  it("declares an optional budget baseline approval reference field", () => {
    const f = mobilise.inputFields?.find((x) => x.id === "budgetBaselineApproval");
    expect(f?.type).toBe("text");
    expect(f?.required).toBe(false);
  });

  it("makes mobilise-4 covered in the spine report", () => {
    const covered = analyzeMethodologySpine("atos-lite").exitCriteriaCoverage.find(
      (c) => c.criterionId === "mobilise-4",
    );
    expect(covered?.covered).toBe(true);
    expect(covered?.backingFieldIds).toContain("budgetBaselineApproval");
  });
});
