import { describe, it, expect } from "vitest";
import {
  artifactFieldKeysFor,
  selectFindingsForArtifact,
  findingsToRecommendations,
  reviewImprovementsToRecommendations,
  selfReportedGapRecommendations,
  groupRecommendationsByCategory,
  type ArtifactRecommendation,
} from "@/v3/lib/artifactRecommendations";
import type { ValidationFinding } from "@/v3/lib/crossArtifactValidation";

function finding(over: Partial<ValidationFinding> = {}): ValidationFinding {
  return {
    findingId: "f1",
    severity: "medium",
    domain: "requirements-coverage",
    sourceArtifact: "",
    targetArtifact: "",
    sourceItem: "",
    issue: "REQ-14 has no design element",
    recommendation: "Add a design element that satisfies REQ-14.",
    confidence: 0.7,
    evidence: [],
    ...over,
  };
}

describe("artifactFieldKeysFor", () => {
  it("returns the formal mirror key plus the raw def id for a formal artifact", () => {
    // charter's stored body lives under transformationCharter, not "charter".
    expect(artifactFieldKeysFor("charter")).toEqual(["transformationCharter", "charter"]);
  });
  it("returns just the def id for a non-formal (custom) artifact", () => {
    expect(artifactFieldKeysFor("scope-map")).toEqual(["scope-map"]);
  });
});

describe("selectFindingsForArtifact", () => {
  const findings = [
    finding({ findingId: "a", sourceArtifact: "transformationCharter", phaseId: "strategy" }),
    finding({ findingId: "b", targetArtifact: "transformationCharter", phaseId: "strategy" }),
    finding({ findingId: "c", sourceArtifact: "raidEntries", phaseId: "strategy" }),
    finding({ findingId: "d", sourceItem: "charter" }), // program-wide, cites raw id
  ];

  it("keeps findings citing the artifact's mirror key or raw id in any slot", () => {
    const picked = selectFindingsForArtifact(findings, "charter", "strategy").map((f) => f.findingId);
    expect(picked).toEqual(["a", "b", "d"]);
  });

  it("keeps a program-wide (no-phase) finding regardless of the requested phase", () => {
    const picked = selectFindingsForArtifact(findings, "charter", "mobilise").map((f) => f.findingId);
    expect(picked).toEqual(["d"]);
  });

  it("drops findings citing a different artifact", () => {
    expect(selectFindingsForArtifact(findings, "raci-matrix", "mobilise")).toEqual([]);
  });
});

describe("findingsToRecommendations", () => {
  it("maps issue → title, recommendation → detail, and rolls domain up to a category", () => {
    const [rec] = findingsToRecommendations([finding({ domain: "benefits-traceability" })]);
    expect(rec.title).toBe("REQ-14 has no design element");
    expect(rec.detail).toBe("Add a design element that satisfies REQ-14.");
    expect(rec.category).toBe("Ontology"); // benefits-traceability rolls up to Ontology
  });

  it("falls back to the first evidence line when the recommendation is blank", () => {
    const [rec] = findingsToRecommendations([
      finding({ recommendation: "", evidence: ["transformationCharter.gaps[0] — self-reported"] }),
    ]);
    expect(rec.detail).toBe("transformationCharter.gaps[0] — self-reported");
  });

  it("collapses critical severity onto the panel's high level and drops blank issues", () => {
    const recs = findingsToRecommendations([
      finding({ severity: "critical" }),
      finding({ issue: "   " }),
    ]);
    expect(recs).toHaveLength(1);
    expect(recs[0].severity).toBe("high");
  });
});

describe("reviewImprovementsToRecommendations", () => {
  it("maps free-text improvements to low-severity Completeness recommendations, dropping blanks", () => {
    const recs = reviewImprovementsToRecommendations(["Name the sponsor", "  ", ""]);
    expect(recs).toEqual([
      { title: "Name the sponsor", detail: "", severity: "low", category: "Completeness" },
    ]);
  });
});

describe("selfReportedGapRecommendations", () => {
  it("reads a formal mirror's gaps as low-severity Completeness recommendations", () => {
    const source = {
      transformationCharter: { confidence: 0.9, gaps: ["Executive sponsor not yet named", "   ", "No KPI baseline"] },
    };
    const recs = selfReportedGapRecommendations(source, "charter");
    expect(recs).toHaveLength(2); // blank dropped by listFormalArtifactGaps
    expect(recs[0]).toEqual({
      title: "Self-reported gap",
      detail: "Executive sponsor not yet named",
      severity: "low",
      category: "Completeness",
    });
  });

  it("returns [] for a non-formal artifact (no mirror)", () => {
    expect(selfReportedGapRecommendations({ scopeMapQuality: { gaps: ["x"] } }, "scope-map")).toEqual([]);
  });
});

describe("groupRecommendationsByCategory", () => {
  const recs: ArtifactRecommendation[] = [
    { title: "gap", detail: "d", severity: "low", category: "Completeness" },
    { title: "trace", detail: "d", severity: "high", category: "Ontology" },
    { title: "approve", detail: "d", severity: "low", category: "Governance" },
    { title: "trace2", detail: "d", severity: "medium", category: "Ontology" },
  ];

  it("groups in canonical class order and drops empty categories", () => {
    const groups = groupRecommendationsByCategory(recs);
    expect(groups.map((g) => g.category)).toEqual(["Ontology", "Governance", "Completeness"]);
    expect(groups[0].description.length).toBeGreaterThan(0);
  });

  it("sorts each group's items by severity, high first", () => {
    const groups = groupRecommendationsByCategory(recs);
    expect(groups[0].items.map((i) => i.severity)).toEqual(["high", "medium"]);
  });

  it("returns [] for no recommendations", () => {
    expect(groupRecommendationsByCategory([])).toEqual([]);
  });

  it("preserves caller-specific extra fields on grouped items", () => {
    // The Improve modal passes recommendations carrying a `fieldId` so it can
    // render a jump-to-field chip inline with each issue. Grouping must keep that
    // extra property (and its type) intact, not narrow items back to the base shape.
    const enriched = [
      { title: 'Add "Cost assumption"', detail: "d", severity: "high" as const, category: "Completeness" as const, fieldId: "costAssumption" },
      { title: "trace", detail: "d", severity: "high" as const, category: "Ontology" as const },
    ];
    const groups = groupRecommendationsByCategory(enriched);
    const completeness = groups.find((g) => g.category === "Completeness");
    expect(completeness?.items[0].fieldId).toBe("costAssumption");
  });
});
