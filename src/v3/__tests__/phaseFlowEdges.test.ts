import { derivePhaseFlowEdges, getArtifactInputFields, getFillableArtifactInputFields, getGuidanceInputFields, artifactReferenceSatisfied } from "@/v3/lib/phaseFlowEdges";
import { getPhaseArtifactIds } from "@/v3/lib/phaseArtifacts";
import { PHASE_INPUT_SCHEMAS, resolveRosterField } from "@/v3/lib/phaseInputSchema";
import { ATOS_STANDARD } from "@/v3/lib/methodology";

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
    // produces nothing rather than a dangling edge. operate is purely dynamic — no
    // static schema or flow — so without a store it has no artifacts to target.
    expect(derivePhaseFlowEdges("operate", ["someField"])).toEqual([]);
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
    // successMetric comes from the static field→artifact map; kpis and
    // validationApproach are declared in the methodology artifactInputFlow. All
    // must surface, deduped — the structured KPIs feed the outcome tree alongside
    // the headline metric and the de-risking ladder.
    expect(new Set(getArtifactInputFields("strategy", "outcome-framework"))).toEqual(
      new Set(["successMetric", "kpis", "validationApproach"]),
    );
  });

  it("returns no fields for a store-only phase with no store (nothing to wait on)", () => {
    // A phase carrying no static schema/flow (modelled here by a synthetic id so it
    // stays store-only even as real phases gain a static spine) has nothing
    // declared to wait on until the programme's dynamicSchema supplies it.
    expect(getArtifactInputFields("custom-phase", "runbook")).toEqual([]);
  });

  it("reads declared fields from the dynamic schema store for a store-only phase", () => {
    const store = { artifactInputFlow: { "custom-phase": { runbook: ["sponsorTier", "raciOwner"] } } };
    expect(new Set(getArtifactInputFields("custom-phase", "runbook", store))).toEqual(
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
    // A store-only phase (synthetic id so its grounding stays purely dynamic even
    // as real phases gain a static spine): the planner wired the artifact to two
    // owner/lead fields (roster-resolved, dropped from the rendered inputs) plus
    // one genuinely typed input.
    const store = {
      inputFields: {
        "custom-phase": [
          { id: "supportCadence", label: "Support cadence", type: "textarea" as const, required: true },
        ],
      },
      artifacts: {
        "custom-phase": [{ id: "runbook", label: "Runbook", description: "" }],
      },
      artifactInputFlow: {
        "custom-phase": { runbook: ["incidentOwner", "opsLead", "supportCadence"] },
      },
    };
    // Raw declared set includes the roster-resolved owner/lead fields…
    expect(new Set(getArtifactInputFields("custom-phase", "runbook", store))).toEqual(
      new Set(["incidentOwner", "opsLead", "supportCadence"]),
    );
    // …but only the genuinely fillable field gates generation.
    expect(getFillableArtifactInputFields("custom-phase", "runbook", store)).toEqual(["supportCadence"]);
  });

  it("returns nothing to gate when every grounding input is roster-resolved", () => {
    const store = {
      artifacts: { "custom-phase": [{ id: "runbook", label: "Runbook", description: "" }] },
      artifactInputFlow: { "custom-phase": { runbook: ["incidentOwner", "opsLead"] } },
    };
    expect(getFillableArtifactInputFields("custom-phase", "runbook", store)).toEqual([]);
  });

  it("keeps real static fields (parity with the declared set on a static phase)", () => {
    expect(new Set(getFillableArtifactInputFields("strategy", "charter"))).toEqual(
      new Set(getArtifactInputFields("strategy", "charter")),
    );
  });
});

// Guidance ("Improve quality") may point at ANY input a formal artifact is
// grounded on, because the edge flattens the whole phase's inputs into every
// formal document's prompt (buildGroundingFacts) — not just the narrower flow
// subset that gates generation. So a charter's guidance can name the cost and KPI
// inputs, not only industry/start/end.
describe("getGuidanceInputFields", () => {
  it("returns the FULL phase input set for a formal artifact, wider than the gating flow subset", () => {
    const guidance = new Set(getGuidanceInputFields("strategy", "charter"));
    const gating = new Set(getFillableArtifactInputFields("strategy", "charter"));
    // Cost and KPI inputs ground the charter but are NOT in its flow/gating subset —
    // guidance must still be able to name them as fields to strengthen.
    expect(guidance.has("costAssumption")).toBe(true);
    expect(guidance.has("kpis")).toBe(true);
    expect(gating.has("costAssumption")).toBe(false);
    // Guidance is a strict superset of the gating subset for a formal artifact.
    for (const id of gating) expect(guidance.has(id)).toBe(true);
    expect(guidance.size).toBeGreaterThan(gating.size);
    // It equals the phase's full fillable input schema.
    expect(guidance).toEqual(new Set(PHASE_INPUT_SCHEMAS.strategy.fields.map((f) => f.id)));
  });

  it("falls back to the flow subset for a non-formal (fall-through) artifact", () => {
    const store = {
      inputFields: {
        "custom-phase": [
          { id: "supportCadence", label: "Support cadence", type: "textarea" as const, required: true },
          { id: "unrelatedField", label: "Unrelated", type: "text" as const, required: false },
        ],
      },
      artifacts: { "custom-phase": [{ id: "custom-doc", label: "Custom doc", description: "" }] },
      artifactInputFlow: { "custom-phase": { "custom-doc": ["supportCadence"] } },
    };
    // custom-doc is not a formal artifact, so guidance stays scoped to its flow input.
    expect(getGuidanceInputFields("custom-phase", "custom-doc", store)).toEqual(["supportCadence"]);
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

  it("resolves the requirements-catalog edge from the methodology registry, but scope-map waits on the planner", () => {
    // requirements-catalog has a real producing agent, so it renders as a
    // methodology-declared fall-through chip and its stakeholder flow edge resolves
    // without a planner store. scope-map / stakeholder-map are declared flow targets
    // with no static producing agent, so they only render once the planner produces
    // them — the fall-through surfacing deliberately only lists renderable agents.
    expect(derivePhaseFlowEdges("discover", ["stakeholderList"])).toEqual([
      { from: "stakeholderList", to: "requirements-catalog" },
    ]);
    expect(new Set(getArtifactInputFields("discover", "scope-map"))).toEqual(
      new Set(["currentStateSummary", "currentStateMetrics", "scopeInclusions", "scopeExclusions", "stakeholderList"]),
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
    "functionalDesignSummary",
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
    // Regression: the functional/process design summary must reach the solution
    // design deliverable (and the operating-model / change-impact consumers) even
    // when the planner names the artifact "solution-design" rather than the
    // canonical "solution-architecture" the methodology flow targets.
    expect(targetsOf("functionalDesignSummary")).toEqual(
      expect.arrayContaining(["solution-design", "target-operating-model", "change-impact"]),
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

// A phase's inputs can feed an artifact a *recommended* agent produces (Design's
// solution-architecture / future-state-design are recommended, not required, and
// the planner need not declare them as dynamic artifacts). Such a produced
// artifact renders as a chip ("orphan") but is absent from getPhaseArtifactIds,
// so its incoming edge is dropped and the artifact shows with no flow — the bug.
// Passing the produced artifact ids as extra valid targets restores the edge.
describe("derivePhaseFlowEdges resolves produced (recommended-agent) artifacts", () => {
  it("drops the edge to a non-catalogued artifact without the produced set", () => {
    // solution-architecture is neither a Design requiredArtifact nor in any store,
    // so with no extra targets the declared functionalDesignSummary edge vanishes.
    const edges = derivePhaseFlowEdges("design", ["functionalDesignSummary"]);
    expect(edges.some((e) => e.to === "solution-architecture")).toBe(false);
  });

  it("resolves the declared edge once the artifact is passed as produced", () => {
    const edges = derivePhaseFlowEdges("design", ["functionalDesignSummary"], undefined, ["solution-architecture"]);
    expect(edges).toContainEqual({ from: "functionalDesignSummary", to: "solution-architecture" });
  });

  it("also resolves a planner-renamed produced artifact via intent keywords", () => {
    // The methodology flow targets canonical "solution-architecture"; a produced
    // "solution-design" is caught through the design intent keyword match now that
    // the produced set widens the intent candidate pool.
    const edges = derivePhaseFlowEdges("design", ["functionalDesignSummary"], undefined, ["solution-design"]);
    expect(edges.some((e) => e.to === "solution-design")).toBe(true);
  });
});

// Mobilise now carries a static input schema: the canonical coreTeamRoster grid
// (the single source every downstream owner/lead resolves against) and the
// governance cadence. Both ground the RACI and governance-model artifacts via a
// static artifactInputFlow, so generation never waits on the planner.
describe("mobilise static roster + governance schema", () => {
  it("declares the roster as grounding for raci-matrix and governance-model without a store", () => {
    expect(getArtifactInputFields("mobilise", "raci-matrix")).toEqual(["coreTeamRoster"]);
    expect(new Set(getArtifactInputFields("mobilise", "governance-model"))).toEqual(
      new Set(["coreTeamRoster", "governanceCadence"]),
    );
  });

  it("resolves the static coreTeamRoster grid as the roster field without a store", () => {
    const roster = resolveRosterField();
    expect(roster?.id).toBe("coreTeamRoster");
    expect(roster?.type).toBe("grid");
    // The grid carries both a name and a role column so findRosterGrid's shape
    // fallback also resolves it on programmes generated before the static seed.
    const keys = (roster?.columns ?? []).map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["role", "name"]));
  });

  it("keeps both static inputs fillable (they are real typed fields, not roster-resolved owners)", () => {
    expect(new Set(getFillableArtifactInputFields("mobilise", "governance-model"))).toEqual(
      new Set(["coreTeamRoster", "governanceCadence"]),
    );
  });

  it("resolves the static flow edges from the methodology registry even without a store", () => {
    // The RACI and governance-model deliverables are methodology-declared
    // fall-through artifacts (mobilise.artifactInputFlow), so they render as
    // optional chips and their input→artifact flow resolves without a planner store.
    expect(derivePhaseFlowEdges("mobilise", ["coreTeamRoster", "governanceCadence"])).toEqual(
      expect.arrayContaining([
        { from: "coreTeamRoster", to: "raci-matrix" },
        { from: "coreTeamRoster", to: "governance-model" },
        { from: "governanceCadence", to: "governance-model" },
      ]),
    );
  });

  it("wires the static inputs to the artifacts once they render", () => {
    const store = {
      artifacts: {
        mobilise: [
          { id: "raci-matrix", label: "RACI Matrix", description: "" },
          { id: "governance-model", label: "Governance Model", description: "" },
        ],
      },
    };
    const edges = derivePhaseFlowEdges("mobilise", ["coreTeamRoster", "governanceCadence"], store);
    expect(edges).toEqual(
      expect.arrayContaining([
        { from: "coreTeamRoster", to: "raci-matrix" },
        { from: "coreTeamRoster", to: "governance-model" },
        { from: "governanceCadence", to: "governance-model" },
      ]),
    );
  });

  it("keeps the seeded risk/assumption inputs fillable typed grids", () => {
    const fillable = new Set(getFillableArtifactInputFields("mobilise", "governance-model"));
    // They are real typed inputs, so they are fillable — but they ground the
    // program-level `risk` agent, not the governance-model chip, so they must NOT
    // appear as governance-model grounding.
    expect(fillable.has("initialRisks")).toBe(false);
    expect(fillable.has("initialAssumptions")).toBe(false);
    const roster = resolveRosterField(); // sanity: schema still resolves
    expect(roster?.id).toBe("coreTeamRoster");
  });

  it("draws no phase edge for the program-level risk inputs — risk is not a phase chip", () => {
    // Even with a `risk` artifact forced into the phase set, no edge is drawn: the
    // methodology deliberately omits a `risk` artifactInputFlow entry because the
    // risk agent writes the shared RAID log, not a phaseArtifacts stub. The inputs
    // reach it via the edge ARTIFACT_INPUT_FLOW, not a client phase edge.
    expect(getArtifactInputFields("mobilise", "risk")).toEqual([]);
    const store = { artifacts: { mobilise: [{ id: "risk", label: "Risk Register", description: "" }] } };
    const edges = derivePhaseFlowEdges("mobilise", ["initialRisks", "initialAssumptions"], store);
    expect(edges).toEqual([]);
  });

  it("leaves no orphaned input — each grounds a chip or names its non-chip consumer", () => {
    // Roster + cadence ground the RACI / governance chips; the risk & assumption
    // grids feed the program-level risk agent (declared via usedByArtifacts), which
    // is not a phase chip. No input is silently captured with no downstream reader.
    const grounded = new Set([
      ...getArtifactInputFields("mobilise", "raci-matrix"),
      ...getArtifactInputFields("mobilise", "governance-model"),
    ]);
    for (const field of PHASE_INPUT_SCHEMAS.mobilise.fields) {
      const hasConsumer = grounded.has(field.id) || (field.usedByArtifacts?.length ?? 0) > 0;
      expect(hasConsumer).toBe(true);
    }
  });
});

// Build now carries a static delivery schema: the increment plan the milestone
// agent forecasts against and the test strategy / environments / definition of
// done the test-plan agent maps requirements to. Both ground their artifacts via
// a static artifactInputFlow, so generation never waits on the planner.
describe("build static delivery schema", () => {
  it("declares the delivery inputs grounding test-plan and milestone without a store", () => {
    expect(new Set(getArtifactInputFields("build", "test-plan"))).toEqual(
      new Set(["testStrategy", "environmentsRelease", "definitionOfDone"]),
    );
    expect(new Set(getArtifactInputFields("build", "milestone"))).toEqual(
      new Set(["deliveryIncrements", "environmentsRelease"]),
    );
  });

  it("keeps the static inputs fillable (they are real typed fields, not roster-resolved owners)", () => {
    expect(new Set(getFillableArtifactInputFields("build", "test-plan"))).toEqual(
      new Set(["testStrategy", "environmentsRelease", "definitionOfDone"]),
    );
  });

  it("draws no flow edge until the artifacts actually render (dynamic artifact set)", () => {
    expect(derivePhaseFlowEdges("build", ["deliveryIncrements", "testStrategy"])).toEqual([]);
  });

  it("wires the static inputs to the artifacts once they render", () => {
    const store = {
      artifacts: {
        build: [
          { id: "test-plan", label: "Test Plan", description: "" },
          { id: "milestone", label: "Milestones", description: "" },
        ],
      },
    };
    const edges = derivePhaseFlowEdges(
      "build",
      ["deliveryIncrements", "testStrategy", "environmentsRelease", "definitionOfDone"],
      store,
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        { from: "deliveryIncrements", to: "milestone" },
        { from: "testStrategy", to: "test-plan" },
        { from: "environmentsRelease", to: "test-plan" },
        { from: "environmentsRelease", to: "milestone" },
        { from: "definitionOfDone", to: "test-plan" },
      ]),
    );
  });

  it("flows every static input field into at least one artifact — no dangling inputs", () => {
    // A static input that no artifact consumes is dead weight: the user fills it
    // and nothing downstream is grounded on it. Pin that every declared Build
    // field appears in some artifact's input flow.
    const grounded = new Set([
      ...getArtifactInputFields("build", "test-plan"),
      ...getArtifactInputFields("build", "milestone"),
    ]);
    for (const field of PHASE_INPUT_SCHEMAS.build.fields) {
      expect(grounded).toContain(field.id);
    }
  });
});

// Operate now carries a static go-live / support / adoption schema: the support
// model the support-model and runbook agents synthesise, and the adoption
// baseline the adoption reporting trends against. Each grounds a *renderable,
// fall-through* Operate agent via a static artifactInputFlow, so generation never
// waits on the planner even before the programme reaches Operate. health-heatmap
// is intentionally excluded — its agent grades health from phase/gate state, not
// from these inputs.
describe("operate static go-live schema", () => {
  it("declares the support/adoption inputs grounding the operate artifacts without a store", () => {
    expect(new Set(getArtifactInputFields("operate", "support-model"))).toEqual(
      new Set(["supportModel", "hyperCarePeriod"]),
    );
    expect(getArtifactInputFields("operate", "runbook")).toEqual(["supportModel"]);
    expect(new Set(getArtifactInputFields("operate", "adoption"))).toEqual(
      new Set(["adoptionBaseline", "goLiveDate"]),
    );
  });

  it("does not gate health-heatmap on the adoption inputs (it grades from phase/gate state)", () => {
    expect(getArtifactInputFields("operate", "health-heatmap")).toEqual([]);
  });

  it("keeps the static inputs fillable (they are real typed fields, not roster-resolved owners)", () => {
    expect(new Set(getFillableArtifactInputFields("operate", "support-model"))).toEqual(
      new Set(["supportModel", "hyperCarePeriod"]),
    );
  });

  it("resolves the static flow edges from the methodology registry even without a store", () => {
    // support-model, runbook and adoption are methodology-declared fall-through
    // Operate deliverables (operate.artifactInputFlow), so they render as optional
    // chips and their input→artifact flow resolves without a planner store.
    expect(derivePhaseFlowEdges("operate", ["supportModel", "adoptionBaseline"])).toEqual(
      expect.arrayContaining([
        { from: "supportModel", to: "support-model" },
        { from: "supportModel", to: "runbook" },
        { from: "adoptionBaseline", to: "adoption" },
      ]),
    );
  });

  it("wires the static inputs to the artifacts once they render", () => {
    const store = {
      artifacts: {
        operate: [
          { id: "support-model", label: "Support Model", description: "" },
          { id: "adoption", label: "Adoption", description: "" },
        ],
      },
    };
    const edges = derivePhaseFlowEdges("operate", ["supportModel", "hyperCarePeriod", "adoptionBaseline", "goLiveDate"], store);
    expect(edges).toEqual(
      expect.arrayContaining([
        { from: "supportModel", to: "support-model" },
        { from: "hyperCarePeriod", to: "support-model" },
        { from: "adoptionBaseline", to: "adoption" },
        { from: "goLiveDate", to: "adoption" },
      ]),
    );
  });

  it("flows every static input field into at least one artifact — no dangling inputs", () => {
    const grounded = new Set([
      ...getArtifactInputFields("operate", "support-model"),
      ...getArtifactInputFields("operate", "runbook"),
      ...getArtifactInputFields("operate", "adoption"),
    ]);
    for (const field of PHASE_INPUT_SCHEMAS.operate.fields) {
      expect(grounded).toContain(field.id);
    }
  });
});

// Value Realize now carries a static closure schema. Only benefits-tracker is
// wired into the phase-chip artifactInputFlow — it is the only renderable Value
// Realize deliverable. The closure inputs (lessons learned, sponsor sign-off)
// feed the program-level narrative, which is not a phase chip, so they are
// captured as inputs (documented via usedByArtifacts) rather than gating a chip.
describe("valuerealize static closure schema", () => {
  it("grounds the benefits-tracker on the realised-benefits baseline without a store", () => {
    expect(getArtifactInputFields("valuerealize", "benefits-tracker")).toEqual(["realisedBenefits"]);
  });

  it("keeps the realised-benefits input fillable (a real typed grid field)", () => {
    expect(getFillableArtifactInputFields("valuerealize", "benefits-tracker")).toEqual(["realisedBenefits"]);
  });

  it("wires the realised-benefits input to the tracker once it renders", () => {
    const store = {
      artifacts: {
        valuerealize: [{ id: "benefits-tracker", label: "Benefits Tracker", description: "" }],
      },
    };
    const edges = derivePhaseFlowEdges("valuerealize", ["realisedBenefits", "lessonsLearned", "closureApproval"], store);
    expect(edges).toEqual([{ from: "realisedBenefits", to: "benefits-tracker" }]);
  });

  it("leaves no orphaned input — each either grounds a chip or names its non-chip consumer", () => {
    // realisedBenefits grounds the benefits-tracker chip; the closure inputs feed
    // the program-level narrative (declared via usedByArtifacts), which is not a
    // phase chip. No input is silently captured with no downstream consumer.
    const grounded = new Set(getArtifactInputFields("valuerealize", "benefits-tracker"));
    for (const field of PHASE_INPUT_SCHEMAS.valuerealize.fields) {
      const hasConsumer = grounded.has(field.id) || (field.usedByArtifacts?.length ?? 0) > 0;
      expect(hasConsumer).toBe(true);
    }
  });
});

// Optimize now carries a static schema grounding the optimisation backlog on the
// current performance baseline and the captured improvement candidates — the one
// renderable, fall-through Optimize agent these inputs feed.
describe("optimize static improvement schema", () => {
  it("grounds the optimization-backlog on the baseline + candidates without a store", () => {
    expect(new Set(getArtifactInputFields("optimize", "optimization-backlog"))).toEqual(
      new Set(["optimisationBaseline", "improvementCandidates"]),
    );
  });

  it("keeps both static inputs fillable (real typed fields)", () => {
    expect(new Set(getFillableArtifactInputFields("optimize", "optimization-backlog"))).toEqual(
      new Set(["optimisationBaseline", "improvementCandidates"]),
    );
  });

  it("wires the static inputs to the backlog once it renders", () => {
    const store = {
      artifacts: {
        optimize: [{ id: "optimization-backlog", label: "Optimization Backlog", description: "" }],
      },
    };
    const edges = derivePhaseFlowEdges("optimize", ["optimisationBaseline", "improvementCandidates"], store);
    expect(edges).toEqual(
      expect.arrayContaining([
        { from: "optimisationBaseline", to: "optimization-backlog" },
        { from: "improvementCandidates", to: "optimization-backlog" },
      ]),
    );
  });

  it("flows every static input field into at least one artifact — no dangling inputs", () => {
    const grounded = new Set(getArtifactInputFields("optimize", "optimization-backlog"));
    for (const field of PHASE_INPUT_SCHEMAS.optimize.fields) {
      expect(grounded).toContain(field.id);
    }
  });
});

// Govern now captures the regulatory frameworks its compliance check verifies
// against — the one fact the compliance-checker needs but that had no home. Unlike
// the program-level risk agent, compliance-checker writes a real phase-artifact
// stub, so it renders as a chip and its flow edge anchors. (Its edge delivery is
// synced in the agent's dedicated context branch, not the fall-through map.)
describe("govern static compliance schema", () => {
  it("grounds compliance-checker on the regulatory frameworks without a store", () => {
    expect(getArtifactInputFields("govern", "compliance-checker")).toEqual(["regulatoryFrameworks"]);
  });

  it("keeps the frameworks input fillable (a real typed grid field)", () => {
    expect(getFillableArtifactInputFields("govern", "compliance-checker")).toEqual(["regulatoryFrameworks"]);
  });

  it("draws no flow edge until the compliance check renders (dynamic artifact set)", () => {
    expect(derivePhaseFlowEdges("govern", ["regulatoryFrameworks"])).toEqual([]);
  });

  it("wires the frameworks input to the compliance check once it renders", () => {
    const store = {
      artifacts: {
        govern: [{ id: "compliance-checker", label: "Compliance Check", description: "" }],
      },
    };
    const edges = derivePhaseFlowEdges("govern", ["regulatoryFrameworks"], store);
    expect(edges).toEqual([{ from: "regulatoryFrameworks", to: "compliance-checker" }]);
  });

  it("flows every static input field into at least one artifact — no dangling inputs", () => {
    const grounded = new Set(getArtifactInputFields("govern", "compliance-checker"));
    for (const field of PHASE_INPUT_SCHEMAS.govern.fields) {
      expect(grounded).toContain(field.id);
    }
  });
});

// The user's rule when building the static spine: "make sure the input to
// artifact flows also exist." Every artifactId a phase declares in its
// artifactInputFlow must be a *renderable* phase artifact — otherwise the flow
// dangles (no chip to anchor the edge, and the Generate gate can never clear).
// The one trap is the program-level narrative, which every phase's artifact set
// deliberately drops; wiring it would silently break the flow.
describe("static artifactInputFlow targets are renderable phase artifacts", () => {
  for (const phase of ATOS_STANDARD.phases) {
    const flow = phase.artifactInputFlow ?? {};
    for (const artifactId of Object.keys(flow)) {
      it(`${phase.id}: "${artifactId}" renders as a phase artifact`, () => {
        // Force the artifact into the phase's set the way the planner would, then
        // assert it survives — a non-renderable id (e.g. narrative) is dropped.
        const store = { artifacts: { [phase.id]: [{ id: artifactId, label: artifactId, description: "" }] } };
        expect(getPhaseArtifactIds(phase.id, store)).toContain(artifactId);
      });
    }
  }
});

// An artifact-reference input names an upstream deliverable the programme already
// produces; once that artifact exists the reference is satisfied without a manual
// re-selection, so it must not keep the Generate button locked.
describe("artifactReferenceSatisfied", () => {
  const titles = ["Requirements Catalog", "Solution Design Document", "Budget Report"];

  it("matches a reference label to an existing artifact ignoring approval phrasing", () => {
    expect(artifactReferenceSatisfied("Reference to approved must-have requirements catalog", titles)).toBe(true);
  });

  it("matches singular/plural forms via light stemming", () => {
    expect(artifactReferenceSatisfied("Link to requirement catalogs", titles)).toBe(true);
  });

  it("does not match when no artifact carries every content token", () => {
    expect(artifactReferenceSatisfied("Reference to approved data migration plan", titles)).toBe(false);
  });

  it("returns false when the label has no content tokens left after stripping phrasing", () => {
    expect(artifactReferenceSatisfied("Reference to the approved document", titles)).toBe(false);
  });

  it("returns false against an empty artifact set", () => {
    expect(artifactReferenceSatisfied("Reference to approved requirements catalog", [])).toBe(false);
  });
});
