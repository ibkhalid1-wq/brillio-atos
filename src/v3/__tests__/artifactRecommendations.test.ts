import { describe, it, expect } from "vitest";
import {
  artifactFieldKeysFor,
  selectFindingsForArtifact,
  findingsToRecommendations,
  reviewImprovementsToRecommendations,
  selfReportedGapRecommendations,
  groundingGapRecommendations,
  groupRecommendationsByCategory,
  matchGroundingFields,
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

describe("groundingGapRecommendations", () => {
  it("emits a high-severity Completeness gap carrying the fieldId for each EMPTY input", () => {
    const recs = groundingGapRecommendations([
      { id: "costAssumption", label: "Cost assumption", filled: false, requirement: "Per-line estimates." },
      { id: "sponsor", label: "Executive sponsor", filled: true },
    ]);
    expect(recs).toEqual([
      {
        title: 'Add "Cost assumption"',
        detail: "Per-line estimates.",
        severity: "high",
        category: "Completeness",
        fieldId: "costAssumption",
      },
    ]);
  });

  it("falls back to a generic requirement when none is supplied", () => {
    const [rec] = groundingGapRecommendations([{ id: "industry", label: "Industry", filled: false }]);
    expect(rec.detail).toBe("Provide Industry.");
  });

  it("keeps the fieldId resolvable so the rail can filter its grounding fields to a chip", () => {
    // The rail resolves a deterministic gap by id (not prose), so the fieldId must
    // always match a real grounding field — mirrors the Improve modal's chip path.
    const fields = [{ id: "kpis", label: "Success KPIs" }];
    const [rec] = groundingGapRecommendations([{ id: "kpis", label: "Success KPIs", filled: false }]);
    expect(fields.filter((f) => f.id === rec.fieldId).map((f) => f.id)).toEqual(["kpis"]);
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

  it("matches grounding fields named in a free-form recommendation", () => {
    const fields = [
      { id: "costAssumption", label: "Cost assumption", filled: true },
      { id: "executiveSponsor", label: "Executive sponsor", filled: true },
      { id: "industry", label: "Industry", filled: true },
      { id: "successMetric", label: "Primary success metric", filled: true },
    ];
    // Names two fields in prose → both surfaced, in original order.
    const matched = matchGroundingFields(
      "Add per-line estimates to the Cost assumption input, confirmed by the executive sponsor.",
      fields,
    );
    expect(matched.map((f) => f.id)).toEqual(["costAssumption", "executiveSponsor"]);
  });

  it("matches a field named by its raw id, bare or phase-qualified", () => {
    const fields = [
      { id: "costAssumption", label: "Cost assumption", filled: true },
      { id: "investmentAsk", label: "Investment ask", filled: true },
      { id: "industry", label: "Industry", filled: true },
    ];
    // Reviewers frequently cite the id, not the label — bare and dotted forms.
    const matched = matchGroundingFields(
      "Add per-line estimates in the strategy.costAssumption input, and specify the investmentAsk.",
      fields,
    );
    expect(matched.map((f) => f.id)).toEqual(["costAssumption", "investmentAsk"]);
  });

  it("surfaces a field on subject-token overlap when the label is not named verbatim", () => {
    const fields = [
      { id: "costAssumption", label: "Cost assumption", filled: true },
      { id: "successMetric", label: "Primary success metric", filled: true },
      { id: "industry", label: "Industry", filled: true },
    ];
    // Reviewer prose cites the artifact-body key "costs", not the label "Cost
    // assumption" — the plural stems to "cost" and overlaps the field's subject.
    const matched = matchGroundingFields("Trim the costs array to per-line entries.", fields);
    expect(matched.map((f) => f.id)).toEqual(["costAssumption"]);
  });

  it("does not over-match on generic governance filler alone", () => {
    const fields = [{ id: "costAssumption", label: "Cost assumption", filled: true }];
    // "review", "approve", "document" are all stopwords → no subject overlap.
    expect(matchGroundingFields("Review and approve the document.", fields)).toEqual([]);
  });

  it("does not fire an id on a substring (whole-word only)", () => {
    const fields = [{ id: "kpis", label: "Success KPIs", filled: true }];
    // "kpistan" contains "kpis" but not as a whole word.
    expect(matchGroundingFields("Roll out to Kpistan region.", fields)).toEqual([]);
    expect(matchGroundingFields("Populate the kpis grid.", fields).map((f) => f.id)).toEqual(["kpis"]);
  });

  it("matches a field label as a whole word, not a substring", () => {
    const fields = [{ id: "industry", label: "Industry", filled: true }];
    // "industrialisation" contains "industr…" but not the whole word "industry".
    expect(matchGroundingFields("Plan the industrialisation rollout.", fields)).toEqual([]);
    expect(matchGroundingFields("Specify the Industry vertical.", fields).map((f) => f.id)).toEqual(["industry"]);
  });

  it("returns [] when no field is named or text is empty", () => {
    const fields = [{ id: "costAssumption", label: "Cost assumption", filled: true }];
    expect(matchGroundingFields("Review and approve the document.", fields)).toEqual([]);
    expect(matchGroundingFields("", fields)).toEqual([]);
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
