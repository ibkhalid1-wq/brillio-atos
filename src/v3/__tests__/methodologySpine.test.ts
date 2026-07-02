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

  it("surfaces the distinct roles of the backing fields (Option B), deduped and role-less filtered", () => {
    // Two fields overlap the sponsor criterion: one tagged mandate, one
    // governance-signoff; a third overlapping field carries no role and a fourth
    // repeats governance-signoff. backingRoles must be the DISTINCT set, in
    // field-declaration order, with the role-less field contributing nothing.
    const coverage = analyzeExitCriteriaCoverage(
      phase({
        id: "strategy",
        inputFields: [
          { id: "sponsor", label: "Executive sponsor", type: "text", required: true, role: "mandate" },
          { id: "sponsorDate", label: "Sponsor sign-off date", type: "date", required: false, role: "governance-signoff" },
          { id: "sponsorNote", label: "Sponsor note", type: "text", required: false },
          { id: "sponsorRef", label: "Sponsor approval reference", type: "text", required: false, role: "governance-signoff" },
        ],
      }),
    );
    const sponsorCriterion = coverage.find((c) => c.criterionId === "strategy-3");
    expect(sponsorCriterion?.backingRoles).toEqual(["mandate", "governance-signoff"]);
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

describe("Semantic field roles (Option B)", () => {
  const phasesById = Object.fromEntries(
    getMethodology("atos-lite").phases.map((p) => [p.id, p]),
  );
  const roleOf = (phaseId: string, fieldId: string) =>
    phasesById[phaseId]?.inputFields?.find((f) => f.id === fieldId)?.role;

  // Pins the role tags the spine relies on. A role is the field's KIND of
  // evidence (orthogonal to its editor `type`); dropping or mistagging one
  // silently weakens role-based coverage, so lock the mapping here.
  it.each([
    ["strategy", "sponsor", "mandate"],
    ["strategy", "sponsorSignOffDate", "governance-signoff"],
    ["strategy", "costAssumption", "cost"],
    ["strategy", "constraints", "constraint"],
    ["strategy", "successMetric", "measure"],
    ["strategy", "kpis", "measure"],
    ["strategy", "businessCaseApproval", "governance-signoff"],
    ["mobilise", "budgetBaselineApproval", "governance-signoff"],
    ["mobilise", "initialRisks", "risk"],
    ["mobilise", "initialAssumptions", "risk"],
    ["valuerealize", "realisedBenefits", "measure"],
    ["valuerealize", "closureApproval", "governance-signoff"],
    ["valuerealize", "bauHandoverConfirmation", "governance-signoff"],
  ] as const)("tags %s.%s with role %s", (phaseId, fieldId, role) => {
    expect(roleOf(phaseId, fieldId)).toBe(role);
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
    // The budget approval field carries a governance-signoff role, so the
    // financial gate is grounded by meaning, not just by the word "budget".
    expect(covered?.backingRoles).toContain("governance-signoff");
  });
});

describe("Value Realize governance-evidence fields (Option A)", () => {
  const vr = getMethodology("atos-lite").phases.find((p) => p.id === "valuerealize")!;

  // "Handover to BAU confirmed" (valuerealize-4) asks for a BAU handover
  // confirmation naming the BAU owner — closureApproval (sponsor sign-off) does
  // not hold it — so it now has a backing input and drops from the inventory.
  it("declares an optional BAU handover confirmation field", () => {
    const f = vr.inputFields?.find((x) => x.id === "bauHandoverConfirmation");
    expect(f?.type).toBe("text");
    expect(f?.required).toBe(false);
  });

  it("makes valuerealize-4 covered in the spine report", () => {
    const covered = analyzeMethodologySpine("atos-lite").exitCriteriaCoverage.find(
      (c) => c.criterionId === "valuerealize-4",
    );
    expect(covered?.covered).toBe(true);
    expect(covered?.backingFieldIds).toContain("bauHandoverConfirmation");
    expect(covered?.backingRoles).toContain("governance-signoff");
  });
});
