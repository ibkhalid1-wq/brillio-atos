import { derivePhaseFlowEdges, getArtifactInputFields, getFillableArtifactInputFields } from "@/v3/lib/phaseFlowEdges";
import { getPhaseArtifactIds } from "@/v3/lib/phaseArtifacts";
import { PHASE_INPUT_SCHEMAS } from "@/v3/lib/phaseInputSchema";

// Strategy is the only static phase (a hand-declared field→artifact map +
// methodology artifactInputFlow), so the static-target behaviour is asserted
// there. Nothing is hard-coded: edges come only from declared flow. Every later
// phase is dynamic-only: its edges come entirely from the programme's
// dynamicSchema store (covered in dynamicSchema.test.ts), so without a store a
// dynamic phase yields no edges at all.
describe("derivePhaseFlowEdges", () => {
  it("wires each field to its declared artifact targets", () => {
    const edges = derivePhaseFlowEdges("strategy", ["businessObjective", "sponsor"]);
    expect(edges.filter((e) => e.from === "businessObjective")).toEqual([
      { from: "businessObjective", to: "charter" },
      { from: "businessObjective", to: "business-case" },
      { from: "businessObjective", to: "strategic-roadmap" },
    ]);
    expect(edges.some((e) => e.from === "sponsor" && e.to === "charter")).toBe(true);
  });

  it("adds declared phase-specific targets (e.g. charter) without duplicating", () => {
    const edges = derivePhaseFlowEdges("strategy", ["sponsor"]);
    // sponsor feeds the charter (static map) and the strategic roadmap (it is
    // declared in the roadmap's methodology artifactInputFlow).
    expect(edges).toEqual([
      { from: "sponsor", to: "charter" },
      { from: "sponsor", to: "strategic-roadmap" },
    ]);
  });

  it("yields no edges for a field with no declared targets on a static phase", () => {
    expect(derivePhaseFlowEdges("strategy", ["unmappedField"])).toEqual([]);
  });

  it("yields no edges for a dynamic-only phase or unknown phase without a store", () => {
    // A phase with no resolvable artifacts (no store, empty artifact set)
    // produces nothing rather than a dangling edge.
    expect(derivePhaseFlowEdges("mobilise", ["governanceModel"])).toEqual([]);
    expect(derivePhaseFlowEdges("unknown-phase", ["whatever"])).toEqual([]);
  });

  it("wires methodology-declared flow fields (e.g. industry) to their artifacts", () => {
    // industry feeds the roadmap, charter, and business-case — emitted in the
    // methodology's artifactInputFlow declaration order (roadmap first).
    expect(derivePhaseFlowEdges("strategy", ["industry"])).toEqual([
      { from: "industry", to: "strategic-roadmap" },
      { from: "industry", to: "charter" },
      { from: "industry", to: "business-case" },
    ]);
  });

  it("only ever targets artifacts that exist in the phase's artifact set", () => {
    for (const phaseId of Object.keys(PHASE_INPUT_SCHEMAS)) {
      const valid = new Set<string>(getPhaseArtifactIds(phaseId));
      const fieldIds = PHASE_INPUT_SCHEMAS[phaseId].fields.map((f) => f.id);
      for (const edge of derivePhaseFlowEdges(phaseId, fieldIds)) {
        expect(valid.has(edge.to)).toBe(true);
      }
    }
  });
});

describe("getArtifactInputFields", () => {
  it("unions methodology artifactInputFlow with the static field→artifact map (deduped)", () => {
    // charter is fed by methodology (industry, startDate, targetEndDate) AND the
    // static map (sponsor, businessObjective) — every id must be a real strategy
    // input field, so the quality modal can resolve each to a label, never a raw id.
    const fields = getArtifactInputFields("strategy", "charter");
    expect(new Set(fields)).toEqual(
      new Set(["industry", "startDate", "targetEndDate", "businessObjective", "sponsor"]),
    );
    expect(fields.length).toBe(new Set(fields).size);
  });

  it("merges both sources for business-case", () => {
    expect(new Set(getArtifactInputFields("strategy", "business-case"))).toEqual(
      new Set(["industry", "costAssumption", "businessObjective", "constraints"]),
    );
  });

  it("merges the static success-metric edge with the methodology flow for outcome-framework", () => {
    // successMetric comes from the static field→artifact map; validationApproach is
    // declared in the methodology artifactInputFlow. Both must surface, deduped.
    expect(new Set(getArtifactInputFields("strategy", "outcome-framework"))).toEqual(
      new Set(["successMetric", "validationApproach"]),
    );
  });

  it("returns no fields for a dynamic phase with no store (nothing to wait on)", () => {
    expect(getArtifactInputFields("mobilise", "governance-model")).toEqual([]);
  });

  it("reads declared fields from the dynamic schema store for a dynamic phase", () => {
    const store = { artifactInputFlow: { mobilise: { "governance-model": ["sponsorTier", "raciOwner"] } } };
    expect(new Set(getArtifactInputFields("mobilise", "governance-model", store))).toEqual(
      new Set(["sponsorTier", "raciOwner"]),
    );
  });
});

// A dynamic artifactInputFlow can name owner/lead grounding fields the
// roster-owner guardrail drops from the rendered inputs (they resolve from the
// Mobilise roster, never typed). Gating the Generate button on those would lock
// it permanently — no field can ever fill them. getFillableArtifactInputFields
// returns only the grounding inputs that exist as fillable fields in the schema.
describe("getFillableArtifactInputFields", () => {
  it("drops grounding inputs that have no fillable field in the phase schema", () => {
    // Mobilise is a purely dynamic phase (no static schema/flow), so the only
    // grounding comes from the store. The planner wired the artifact to two
    // owner/lead fields (roster-resolved, dropped from the rendered inputs) plus
    // one genuinely typed input.
    const store = {
      inputFields: {
        mobilise: [
          { id: "governanceCadence", label: "Governance cadence", type: "textarea" as const, required: true },
        ],
      },
      artifacts: {
        mobilise: [{ id: "governance-model", label: "Governance Model", description: "" }],
      },
      artifactInputFlow: {
        mobilise: { "governance-model": ["criticalPathOwner", "qaLead", "governanceCadence"] },
      },
    };
    // Raw declared set includes the roster-resolved owner/lead fields…
    expect(new Set(getArtifactInputFields("mobilise", "governance-model", store))).toEqual(
      new Set(["criticalPathOwner", "qaLead", "governanceCadence"]),
    );
    // …but only the genuinely fillable field gates generation.
    expect(getFillableArtifactInputFields("mobilise", "governance-model", store)).toEqual(["governanceCadence"]);
  });

  it("returns nothing to gate when every grounding input is roster-resolved", () => {
    const store = {
      artifacts: { mobilise: [{ id: "governance-model", label: "Governance Model", description: "" }] },
      artifactInputFlow: { mobilise: { "governance-model": ["criticalPathOwner", "qaLead"] } },
    };
    expect(getFillableArtifactInputFields("mobilise", "governance-model", store)).toEqual([]);
  });

  it("keeps real static fields (parity with the declared set on a static phase)", () => {
    expect(new Set(getFillableArtifactInputFields("strategy", "charter"))).toEqual(
      new Set(getArtifactInputFields("strategy", "charter")),
    );
  });
});

// The Discover stakeholder list feeds the scope map and requirements catalog by
// semantics, not by a planner-declared flow — both synthesise who the programme
// serves. The edge is resolved by the stakeholder grid's shape, so it holds for
// any column set the planner emitted, with no parallel hand-maintained map.
describe("stakeholder list → scope-map / requirements-catalog (semantic flow)", () => {
  const discoverStore = {
    inputFields: {
      discover: [
        {
          id: "stakeholderList",
          label: "Stakeholders",
          type: "grid" as const,
          required: true,
          columns: [
            { key: "name", label: "Name" },
            { key: "influence", label: "Influence" },
          ],
        },
      ],
    },
    artifacts: {
      discover: [
        { id: "scope-map", label: "Scope Map", description: "" },
        { id: "requirements-catalog", label: "Requirements Catalog", description: "" },
      ],
    },
  };

  it("wires the resolved stakeholder field to both consumer artifacts", () => {
    const edges = derivePhaseFlowEdges("discover", ["stakeholderList"], discoverStore);
    expect(edges).toEqual([
      { from: "stakeholderList", to: "scope-map" },
      { from: "stakeholderList", to: "requirements-catalog" },
    ]);
  });

  it("surfaces the stakeholder field as an input feeding each consumer artifact", () => {
    expect(getArtifactInputFields("discover", "scope-map", discoverStore)).toContain("stakeholderList");
    expect(getArtifactInputFields("discover", "requirements-catalog", discoverStore)).toContain("stakeholderList");
  });

  it("only targets consumer artifacts that exist in the phase", () => {
    // Store with the stakeholder grid but no scope-map artifact: the catalog edge
    // survives, the scope-map edge is dropped (no dangling target).
    const onlyCatalog = {
      inputFields: discoverStore.inputFields,
      artifacts: { discover: [{ id: "requirements-catalog", label: "Requirements Catalog", description: "" }] },
    };
    expect(derivePhaseFlowEdges("discover", ["stakeholderList"], onlyCatalog)).toEqual([
      { from: "stakeholderList", to: "requirements-catalog" },
    ]);
  });

  it("declares scope-map inputs statically but draws no edge until the artifacts render", () => {
    // Discover now carries a static input schema + artifactInputFlow, so the
    // scope-map's declared inputs resolve without a store. The flow edge still
    // needs the artifact to actually render (dynamic artifact set), so without a
    // store there is no valid target and no edge is drawn.
    expect(derivePhaseFlowEdges("discover", ["stakeholderList"])).toEqual([]);
    expect(new Set(getArtifactInputFields("discover", "scope-map"))).toEqual(
      new Set(["currentStateSummary", "scopeInclusions", "scopeExclusions", "stakeholderList"]),
    );
  });
});

// Design's static solution-design inputs feed its architecture deliverables by
// intent, so every input flows to at least one artifact even when the planner
// invented its own artifact ids ("solution-design", "architecture-decisions")
// rather than using the canonical agent ids ("solution-architecture", …).
describe("design static inputs → solution-design artifacts (semantic flow)", () => {
  // A planner-divergent programme: the architecture deliverable is "solution-design"
  // and decisions live in "architecture-decisions" — neither is the canonical
  // "solution-architecture" agent id the methodology flow targets.
  const designStore = {
    artifacts: {
      design: [
        { id: "solution-design", label: "Solution Design", description: "" },
        { id: "architecture-decisions", label: "Architecture Decisions", description: "" },
        { id: "critical-path", label: "Critical Path", description: "" },
        { id: "target-operating-model", label: "Target Operating Model", description: "" },
        { id: "change-impact", label: "Change Impact", description: "" },
      ],
    },
  };

  const DESIGN_INPUTS = [
    "solutionApproach",
    "targetArchitecture",
    "keyDesignDecisions",
    "nonFunctionalRequirements",
    "integrationDataConstraints",
  ];

  it("connects every static design input to at least one rendered artifact", () => {
    const edges = derivePhaseFlowEdges("design", DESIGN_INPUTS, designStore);
    for (const field of DESIGN_INPUTS) {
      expect(edges.some((e) => e.from === field)).toBe(true);
    }
  });

  it("wires the architecture/decision/NFR inputs that the canonical flow misses", () => {
    const edges = derivePhaseFlowEdges("design", DESIGN_INPUTS, designStore);
    const targetsOf = (field: string) => edges.filter((e) => e.from === field).map((e) => e.to);
    expect(targetsOf("targetArchitecture")).toEqual(
      expect.arrayContaining(["solution-design", "architecture-decisions"]),
    );
    expect(targetsOf("keyDesignDecisions")).toContain("architecture-decisions");
    expect(targetsOf("nonFunctionalRequirements")).toEqual(
      expect.arrayContaining(["solution-design", "architecture-decisions"]),
    );
  });

  it("only targets artifacts that exist in the phase", () => {
    const valid = new Set(getPhaseArtifactIds("design", designStore));
    for (const edge of derivePhaseFlowEdges("design", DESIGN_INPUTS, designStore)) {
      expect(valid.has(edge.to)).toBe(true);
    }
  });

  it("surfaces the input as feeding the artifact in getArtifactInputFields", () => {
    expect(getArtifactInputFields("design", "architecture-decisions", designStore)).toEqual(
      expect.arrayContaining(["targetArchitecture", "keyDesignDecisions"]),
    );
  });
});
