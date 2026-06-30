import { describe, it, expect } from "vitest";
import {
  getDynamicSchemaStore,
  mergeDynamicInputFields,
  dynamicArtifactDefs,
  dynamicFieldArtifacts,
  sanitizePlannerProposal,
  applyDynamicProposal,
  artifactGeneratorAgentId,
  type DynamicSchemaStore,
  type DynamicPhaseProposal,
} from "@/v3/lib/dynamicSchema";
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";
import { getPhaseArtifactIds } from "@/v3/lib/phaseArtifacts";
import { derivePhaseFlowEdges } from "@/v3/lib/phaseFlowEdges";
import type { PhaseInputField } from "@/v3/lib/methodology";

const aiField = (id: string): PhaseInputField => ({
  id,
  label: id,
  type: "textarea",
  required: false,
});

describe("getDynamicSchemaStore", () => {
  it("returns an empty store for malformed raw data", () => {
    expect(getDynamicSchemaStore(null)).toEqual({});
    expect(getDynamicSchemaStore(42)).toEqual({});
    expect(getDynamicSchemaStore({})).toEqual({});
    expect(getDynamicSchemaStore({ dynamicSchema: "nope" })).toEqual({});
  });

  it("extracts the three sub-stores when present", () => {
    const raw = {
      dynamicSchema: {
        inputFields: { design: [aiField("modelRouting")] },
        artifacts: { design: [{ id: "routing-policy", label: "Routing Policy", description: "x" }] },
        artifactInputFlow: { design: { "routing-policy": ["modelRouting"] } },
      },
    };
    const store = getDynamicSchemaStore(raw);
    expect(store.inputFields?.design?.[0].id).toBe("modelRouting");
    expect(store.artifacts?.design?.[0].id).toBe("routing-policy");
    expect(store.artifactInputFlow?.design?.["routing-policy"]).toEqual(["modelRouting"]);
  });
});

describe("mergeDynamicInputFields", () => {
  const staticFields = [aiField("solutionApproach")];

  it("returns static fields unchanged when no dynamic entries", () => {
    expect(mergeDynamicInputFields(staticFields, "design", {})).toBe(staticFields);
  });

  it("appends dynamic fields tagged ai-derived", () => {
    const store: DynamicSchemaStore = { inputFields: { design: [aiField("modelRouting")] } };
    const merged = mergeDynamicInputFields(staticFields, "design", store);
    expect(merged).toHaveLength(2);
    expect(merged[1].id).toBe("modelRouting");
    expect(merged[1].source).toBe("ai-derived");
  });

  it("static fields win on id collision (dynamic dropped)", () => {
    const store: DynamicSchemaStore = { inputFields: { design: [aiField("solutionApproach")] } };
    const merged = mergeDynamicInputFields(staticFields, "design", store);
    expect(merged).toBe(staticFields);
  });

  it("coerces a persisted column-less grid to a textarea (data-preserving repair)", () => {
    const grid: PhaseInputField = { id: "integrationCheckpoints", label: "Integration checkpoints", type: "grid", required: false };
    const store: DynamicSchemaStore = { inputFields: { mobilise: [grid] } };
    const merged = mergeDynamicInputFields(staticFields, "mobilise", store);
    const coerced = merged.find((f) => f.id === "integrationCheckpoints");
    expect(coerced?.type).toBe("textarea");
    expect(coerced?.columns).toBeUndefined();
  });

  it("preserves a grid that has usable columns", () => {
    const grid: PhaseInputField = {
      id: "roles", label: "Roles", type: "grid", required: false,
      columns: [{ key: "role", label: "Role" }, { key: "name", label: "Name" }],
    };
    const store: DynamicSchemaStore = { inputFields: { mobilise: [grid] } };
    const merged = mergeDynamicInputFields(staticFields, "mobilise", store);
    const kept = merged.find((f) => f.id === "roles");
    expect(kept?.type).toBe("grid");
    expect(kept?.columns?.map((c) => c.key)).toEqual(["role", "name"]);
  });
});

describe("dynamicArtifactDefs", () => {
  it("dedups and fills label/description defaults", () => {
    const store: DynamicSchemaStore = {
      artifacts: {
        design: [
          { id: "a", label: "", description: "" },
          { id: "a", label: "dup", description: "" },
          { id: "b", label: "B", description: "desc" },
        ],
      },
    };
    const defs = dynamicArtifactDefs("design", store);
    expect(defs.map((d) => d.id)).toEqual(["a", "b"]);
    expect(defs[0].label).toBe("a");
  });

  it("canonicalises a planner artifact-id synonym to its producing agent", () => {
    // The planner emitted the Risk Register under the synonym "risk-log" (and a
    // phase-prefixed variant); both must collapse to the canonical "risk" agent
    // id the run-agent edge accepts, so Generate doesn't 400 with Unknown agentId.
    const store: DynamicSchemaStore = {
      artifacts: {
        mobilise: [
          { id: "risk-log", label: "Risk Log", description: "" },
          { id: "mobilise-risk-log", label: "dup", description: "" },
        ],
      },
    };
    const defs = dynamicArtifactDefs("mobilise", store);
    expect(defs.map((d) => d.id)).toEqual(["risk"]);
  });

  it("canonicalises the risks-and-assumptions-log synonym to the risk agent", () => {
    // The Mobilise planner names the Risk Register "risks-assumptions-log"; it
    // must resolve to "risk" so Generate doesn't 400 with Unknown agentId.
    const store: DynamicSchemaStore = {
      artifacts: { mobilise: [{ id: "risks-assumptions-log", label: "Risks and Assumptions Log", description: "" }] },
    };
    expect(dynamicArtifactDefs("mobilise", store).map((d) => d.id)).toEqual(["risk"]);
  });

  it("strips a non-canonical (British) phase descriptor prefix to reach the agent", () => {
    // Phase id is "mobilise" but the planner wrote "mobilisation-stakeholder"; the
    // prefix doesn't equal "<phaseId>-", so the first-segment fallback must still
    // resolve it to the bare "stakeholder" agent.
    const store: DynamicSchemaStore = {
      artifacts: { mobilise: [{ id: "mobilisation-stakeholder", label: "Stakeholder Map", description: "" }] },
    };
    expect(dynamicArtifactDefs("mobilise", store).map((d) => d.id)).toEqual(["stakeholder"]);
  });

  it("drops narrative — a program-level briefing, never a phase deliverable", () => {
    // The planner proposes "Mobilisation Narrative" (canonical "narrative"), but
    // the narrative agent stores no phaseArtifacts stub, so the slot could never
    // be satisfied. It must not appear in any phase artifact list.
    const store: DynamicSchemaStore = {
      artifacts: {
        mobilise: [
          { id: "mobilisation-narrative", label: "Mobilisation Narrative", description: "" },
          { id: "narrative", label: "Narrative", description: "" },
          { id: "risk-log", label: "Risk Log", description: "" },
        ],
      },
    };
    expect(dynamicArtifactDefs("mobilise", store).map((d) => d.id)).toEqual(["risk"]);
  });

  it("drops narrative variants (current-/future-state) the planner invents per phase", () => {
    // These fold to the single program-level "narrative" agent; left in place they
    // would render as deliverables whose Generate 400s with `Unknown agentId`.
    const store: DynamicSchemaStore = {
      artifacts: {
        discover: [
          { id: "current-state-narrative", label: "Current State Narrative", description: "" },
          { id: "requirements-catalog", label: "Requirements Catalog", description: "" },
        ],
      },
    };
    expect(dynamicArtifactDefs("discover", store).map((d) => d.id)).toEqual(["requirements-catalog"]);
  });

  it("keeps custom planner artifacts that have no dedicated agent (scope-map)", () => {
    // scope-map has no AGENT_META producer, but it is a first-class custom
    // deliverable produced by the phase agent's generic branch — it must survive
    // and sit alongside named deliverables, not be dropped.
    const store: DynamicSchemaStore = {
      artifacts: {
        discover: [
          { id: "scope-map", label: "Scope Map", description: "" },
          { id: "stakeholder", label: "Stakeholder Map", description: "" },
        ],
      },
    };
    expect(dynamicArtifactDefs("discover", store).map((d) => d.id)).toEqual(["scope-map", "stakeholder"]);
  });

  it("drops a canonical formal artifact proposed outside its home phase", () => {
    // RACI is a Mobilise deliverable that writes the shared `raciMatrix` key.
    // The planner proposing a "Build Phase RACI Matrix" both duplicates it and
    // would overwrite the Mobilise document on generation — so it is dropped on
    // Build while the genuine Build deliverables survive.
    const store: DynamicSchemaStore = {
      artifacts: {
        build: [
          { id: "raci-matrix", label: "Build Phase RACI Matrix", description: "" },
          { id: "uat-plan", label: "UAT Plan", description: "" },
        ],
      },
    };
    expect(dynamicArtifactDefs("build", store).map((d) => d.id)).toEqual(["uat-plan"]);
  });

  it("keeps a formal artifact proposed on its own home phase", () => {
    const store: DynamicSchemaStore = {
      artifacts: { build: [{ id: "test-plan", label: "Test Plan", description: "" }] },
    };
    expect(dynamicArtifactDefs("build", store).map((d) => d.id)).toEqual(["test-plan"]);
  });
});

describe("artifactGeneratorAgentId", () => {
  it("routes a custom artifact with no dedicated agent to the phase agent", () => {
    // scope-map has no AGENT_META producer, so passing its own id as the agentId
    // would 400 with `Unknown agentId`; it must run the phase agent instead.
    expect(artifactGeneratorAgentId("discover", "scope-map")).toBe("discover");
  });

  it("routes a named deliverable to its own producing agent", () => {
    expect(artifactGeneratorAgentId("strategy", "charter")).toBe("charter");
  });

  it("canonicalizes a phase-prefixed named deliverable before routing", () => {
    expect(artifactGeneratorAgentId("design", "design-raci-matrix")).toBe("raci-matrix");
  });

  it("routes a retired-agent artifact to the phase agent, not the dead agent", () => {
    // critical-path still has an AGENT_META entry (so historical runs keep their
    // label), but its generator is retired. Routing to the retired id would make
    // Generate a silent no-op at the dispatch guard; it must run the phase agent.
    expect(artifactGeneratorAgentId("design", "critical-path")).toBe("design");
  });
});

describe("dynamicFieldArtifacts", () => {
  it("inverts artifact→fields into field→artifacts", () => {
    const store: DynamicSchemaStore = {
      artifactInputFlow: { design: { "routing-policy": ["modelRouting", "designConstraints"] } },
    };
    const inverted = dynamicFieldArtifacts("design", store);
    expect(inverted.modelRouting).toEqual(["routing-policy"]);
    expect(inverted.designConstraints).toEqual(["routing-policy"]);
  });
});

describe("resolvers honour the dynamic store end to end", () => {
  const store: DynamicSchemaStore = {
    inputFields: { design: [aiField("modelRouting")] },
    artifacts: { design: [{ id: "routing-policy", label: "Routing Policy", description: "" }] },
    artifactInputFlow: { design: { "routing-policy": ["modelRouting"] } },
  };

  it("getPhaseInputSchema merges dynamic fields only when store supplied", () => {
    const staticCount = getPhaseInputSchema("design").fields.length;
    const dynamicCount = getPhaseInputSchema("design", store).fields.length;
    expect(dynamicCount).toBe(staticCount + 1);
  });

  it("getPhaseArtifactIds includes the dynamic artifact when store supplied", () => {
    expect(getPhaseArtifactIds("design")).not.toContain("routing-policy");
    expect(getPhaseArtifactIds("design", store)).toContain("routing-policy");
  });

  it("derivePhaseFlowEdges wires the dynamic field to the dynamic artifact", () => {
    // Design is now a dynamic-only phase: narrative is no longer guaranteed, so
    // the only resolvable target is the dynamic artifact from the store.
    const edges = derivePhaseFlowEdges("design", ["modelRouting"], store);
    expect(edges).not.toContainEqual({ from: "modelRouting", to: "narrative" });
    expect(edges).toContainEqual({ from: "modelRouting", to: "routing-policy" });
  });

  it("derivePhaseFlowEdges yields no edges for a dynamic-only phase without the store", () => {
    const edges = derivePhaseFlowEdges("design", ["modelRouting"]);
    expect(edges).toEqual([]);
  });
});

describe("sanitizePlannerProposal", () => {
  it("returns null for non-objects and empty proposals", () => {
    expect(sanitizePlannerProposal(null)).toBeNull();
    expect(sanitizePlannerProposal({ inputFields: [], artifacts: [] })).toBeNull();
  });

  it("drops fields with no id or an unknown type, tags survivors ai-derived", () => {
    const out = sanitizePlannerProposal({
      inputFields: [
        { id: "modelRouting", label: "Model routing", type: "textarea", required: true },
        { id: "", label: "no id", type: "text" },
        { id: "bad", label: "bad type", type: "wysiwyg" },
        { id: "modelRouting", label: "dup", type: "text" },
      ],
      artifacts: [],
    });
    expect(out?.inputFields.map((f) => f.id)).toEqual(["modelRouting"]);
    expect(out?.inputFields[0].source).toBe("ai-derived");
    expect(out?.inputFields[0].required).toBe(true);
  });

  it("accepts the semantic reference types (stakeholder/organization/document/artifact-reference)", () => {
    const out = sanitizePlannerProposal({
      inputFields: [
        { id: "phaseSponsor", label: "Phase sponsor", type: "stakeholder", required: true },
        { id: "implPartner", label: "Implementation partner", type: "organization", required: false },
        { id: "sourceContract", label: "Source contract", type: "document", required: false },
        { id: "upstreamDesign", label: "Upstream solution doc", type: "artifact-reference", required: false },
      ],
      artifacts: [],
    });
    expect(out?.inputFields.map((f) => f.type)).toEqual([
      "stakeholder", "organization", "document", "artifact-reference",
    ]);
    expect(out?.inputFields.every((f) => f.source === "ai-derived")).toBe(true);
  });

  it("carries valid grid columns through and keeps the field a grid", () => {
    const out = sanitizePlannerProposal({
      inputFields: [{
        id: "roles", label: "Roles", type: "grid", required: true,
        columns: [
          { key: "role", label: "Role" },
          { key: "name", label: "Name", type: "text" },
          { label: "no key — dropped" },
          { key: "role", label: "dup key — dropped" },
        ],
      }],
      artifacts: [],
    });
    const field = out?.inputFields[0];
    expect(field?.type).toBe("grid");
    expect(field?.columns?.map((c) => c.key)).toEqual(["role", "name"]);
  });

  it("demotes a column-less grid to a textarea and warns", () => {
    const out = sanitizePlannerProposal({
      inputFields: [{ id: "integrationCheckpoints", label: "Integration checkpoints", type: "grid", required: true }],
      artifacts: [],
    });
    expect(out?.inputFields[0].type).toBe("textarea");
    expect(out?.inputFields[0].columns).toBeUndefined();
    expect(out?.planMeta.warnings?.some((w) => /column-less grid/i.test(w))).toBe(true);
  });

  it("keeps only flow entries that reference declared dynamic field + artifact ids", () => {
    const out = sanitizePlannerProposal({
      inputFields: [{ id: "modelRouting", label: "x", type: "text" }],
      artifacts: [{ id: "routing-policy", label: "Routing Policy", description: "" }],
      artifactInputFlow: {
        "routing-policy": ["modelRouting", "ghostField"],
        "ghost-artifact": ["modelRouting"],
      },
    });
    expect(out?.artifactInputFlow).toEqual({ "routing-policy": ["modelRouting"] });
  });
});

describe("applyDynamicProposal", () => {
  it("replaces only the target phase's dynamic entries", () => {
    const store: DynamicSchemaStore = {
      inputFields: { strategy: [aiField("keep")] },
    };
    const next = applyDynamicProposal(store, "design", {
      inputFields: [aiField("modelRouting")],
      artifacts: [{ id: "routing-policy", label: "Routing Policy", description: "" }],
      artifactInputFlow: { "routing-policy": ["modelRouting"] },
    } as unknown as DynamicPhaseProposal);
    expect(next.inputFields?.strategy?.[0].id).toBe("keep");
    expect(next.inputFields?.design?.[0].id).toBe("modelRouting");
    expect(next.artifacts?.design?.[0].id).toBe("routing-policy");
  });
});
