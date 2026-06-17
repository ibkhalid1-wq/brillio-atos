import { describe, it, expect } from "vitest";
import {
  getDynamicSchemaStore,
  mergeDynamicInputFields,
  dynamicArtifactDefs,
  dynamicFieldArtifacts,
  sanitizePlannerProposal,
  applyDynamicProposal,
  type DynamicSchemaStore,
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
    });
    expect(next.inputFields?.strategy?.[0].id).toBe("keep");
    expect(next.inputFields?.design?.[0].id).toBe("modelRouting");
    expect(next.artifacts?.design?.[0].id).toBe("routing-policy");
  });
});
