import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import {
  buildProgramGraph,
  selectGraphForPhase,
  compressProgramNode,
  type ProgramGraph,
  type ProgramDocument,
} from "@/v3/lib/programGraph";
import type { DocumentIntelligence } from "@/new/lib/documentIntelligenceTypes";

function doc(over: Partial<DocumentIntelligence>, fileName = "deck.pdf", id = "doc1"): ProgramDocument {
  return {
    id,
    fileName,
    intelligence: {
      documentType: "business-case",
      summary: "A deck",
      primaryPhase: "strategy",
      relevantPhases: ["strategy"],
      overallConfidence: 0.8,
      entities: {
        objectives: [], outcomes: [], successMetrics: [], constraints: [], assumptions: [],
        risks: [], stakeholders: [], milestones: [], budget: [], requirements: [],
        decisions: [], actions: [], technologies: [], integrations: [], gaps: [], recommendations: [],
      },
      methodologyMappings: {},
      gaps: "",
      ...over,
    },
  };
}

/**
 * The Program Graph is a pure selector over ProgramSummary. These stubs carry
 * only the fields buildProgramGraph reads; everything else is cast away.
 */
function program(over: Record<string, unknown>): ProgramSummary {
  return {
    phases: [],
    artifacts: [],
    raidEntries: [],
    decisionQueue: [],
    stakeholders: [],
    rawData: {},
    ...over,
  } as unknown as ProgramSummary;
}

const phases = [
  { id: "strategy", displayName: "Strategy", pct: 100, status: "complete", objective: "" },
  { id: "discover", displayName: "Discover", pct: 40, status: "active", objective: "" },
  { id: "build", displayName: "Build", pct: 0, status: "inactive", objective: "" },
];

describe("buildProgramGraph", () => {
  it("returns an empty graph for a null program", () => {
    const graph = buildProgramGraph(null);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.stats.nodeCount).toBe(0);
  });

  it("lays a phase spine with sequence edges", () => {
    const graph = buildProgramGraph(program({ phases }));
    expect(graph.stats.byKind.phase).toBe(3);
    const seq = graph.edges.filter((e) => e.type === "sequence");
    expect(seq).toHaveLength(2);
    expect(seq[0]).toMatchObject({ from: "phase:strategy", to: "phase:discover" });
  });

  it("derives facts, links them to their phase, and grounds them into artifacts", () => {
    const graph = buildProgramGraph(program({
      phases,
      artifacts: [
        { id: "raci-matrix", phaseId: "mobilise", title: "RACI Matrix", status: "draft", agentGenerated: true, lastEditedBy: "agent", lastEditedAt: "", contentSummary: "", versionNumber: 1 },
      ],
      rawData: {
        phaseInputs: { mobilise: { coreTeamRoster: JSON.stringify([{ id: "r1", role: "Lead", name: "Ana" }]) } },
        dynamicSchema: { inputFields: { mobilise: [{ id: "coreTeamRoster", label: "Roster", type: "grid", required: false, columns: [{ key: "role", label: "Role" }, { key: "name", label: "Name" }], usedByArtifacts: ["raci-matrix"] }] } },
      },
    }));

    expect(graph.stats.byKind.fact).toBe(1);
    const grounds = graph.edges.filter((e) => e.type === "grounds");
    expect(grounds).toHaveLength(1);
    expect(grounds[0].to).toBe("artifact:raci-matrix");
  });

  it("creates a document node with an extracted_to edge for imported facts", () => {
    const provenance = JSON.stringify({
      businessObjective: { source: "Deck p.4", documentName: "strategy.pdf", confidence: 0.9, extractionType: "extracted", value: "Grow velocity" },
    });
    const graph = buildProgramGraph(program({
      phases,
      rawData: { phaseInputs: { strategy: { businessObjective: "Grow velocity", _provenance: provenance } } },
    }));

    expect(graph.stats.documentCount).toBe(1);
    const ext = graph.edges.filter((e) => e.type === "extracted_to");
    expect(ext[0].from).toBe("doc:strategy.pdf");
  });

  it("adds a planned-artifact placeholder so a grounds edge never dangles", () => {
    const graph = buildProgramGraph(program({
      phases,
      rawData: {
        phaseInputs: { mobilise: { roster: JSON.stringify([{ id: "r1", role: "Lead" }]) } },
        dynamicSchema: { inputFields: { mobilise: [{ id: "roster", label: "Roster", type: "grid", required: false, columns: [{ key: "role", label: "Role" }], usedByArtifacts: ["not-yet-built"] }] } },
      },
    }));
    const planned = graph.nodes.find((n) => n.id === "artifact:not-yet-built");
    expect(planned).toBeDefined();
    expect(planned!.properties!.status).toBe("planned");
  });

  it("turns strategy KPI rows into kpi nodes scoped to strategy", () => {
    const graph = buildProgramGraph(program({
      phases,
      rawData: { phaseInputs: { strategy: { kpis: JSON.stringify([{ id: "k1", name: "Accuracy", baseline: "55%", target: "80%", unit: "%" }]) } } },
    }));
    const kpi = graph.nodes.find((n) => n.type === "kpi");
    expect(kpi).toMatchObject({ phaseCreated: "strategy", label: "Accuracy: 55% → 80% → %" });
  });

  it("includes open risks and decisions but excludes closed ones", () => {
    const graph = buildProgramGraph(program({
      phases,
      raidEntries: [
        { id: "x1", type: "risk", title: "Vendor slip", description: "", severity: "high", phase: "discover", owner: null, mitigation: null, status: "open", source: "agent", createdAt: "", closedAt: null },
        { id: "x2", type: "blocker", title: "Resolved", description: "", severity: "low", phase: "discover", owner: null, mitigation: null, status: "closed", source: "agent", createdAt: "", closedAt: null },
      ],
      decisionQueue: [
        { id: "d1", title: "Pick vendor", type: "decision", priority: "high", phaseId: "discover", question: "?", options: [], createdAt: "", status: "open" },
      ],
    }));
    expect(graph.stats.byKind.risk).toBe(1);
    expect(graph.stats.byKind.decision).toBe(1);
    expect(graph.nodes.find((n) => n.id === "risk:x2")).toBeUndefined();
  });

  it("adds stakeholders as global nodes with no phase", () => {
    const graph = buildProgramGraph(program({
      phases,
      stakeholders: [
        { id: "s1", name: "Jane", role: "CIO", organisation: null, influence: "high", interest: "high", currentEngagement: "champion", targetEngagement: "champion", sentiment: "positive", riskOfDisengagement: "low", recommendedActions: [], owner: null },
      ],
    }));
    const node = graph.nodes.find((n) => n.type === "stakeholder");
    expect(node!.label).toBe("Jane (CIO)");
    expect(node!.phaseCreated).toBeUndefined();
  });
});

describe("document insights (A2)", () => {
  it("turns unmapped entities into insight nodes anchored at the primary phase", () => {
    const graph = buildProgramGraph(
      program({ phases }),
      [doc({
        primaryPhase: "discover",
        entities: {
          objectives: [], outcomes: [], successMetrics: [], assumptions: [], risks: [], stakeholders: [],
          milestones: [], budget: [], requirements: [], decisions: [], actions: [], technologies: [],
          integrations: [], gaps: [],
          constraints: [{ text: "Must reuse the legacy ERP", source: "p.3", confidence: 0.7, extractionType: "extracted" }],
          recommendations: [{ text: "Phase the rollout by region", source: "p.9", confidence: 0.6, extractionType: "inferred", priority: "high" }],
        },
      })],
    );
    const insights = graph.nodes.filter((n) => n.type === "insight");
    expect(insights).toHaveLength(2);
    expect(insights.every((n) => n.phaseCreated === "discover")).toBe(true);
    expect(insights.map((n) => n.label).sort()).toEqual(["Must reuse the legacy ERP", "Phase the rollout by region"]);
  });

  it("links the document to its insights and the insight to its phase", () => {
    const graph = buildProgramGraph(
      program({ phases }),
      [doc({ entities: { ...doc({}).intelligence.entities, assumptions: [{ text: "Budget approved", source: "p.1", confidence: 0.9, extractionType: "extracted" }] } })],
    );
    expect(graph.edges.find((e) => e.type === "mentions")).toMatchObject({ from: "doc:deck.pdf" });
    expect(graph.edges.find((e) => e.type === "in_phase" && e.from.startsWith("insight:"))).toMatchObject({ to: "phase:strategy" });
  });

  it("a rich document node from a processed doc wins over the provenance-only node", () => {
    const provenance = JSON.stringify({
      businessObjective: { source: "p.4", documentName: "deck.pdf", confidence: 0.9, extractionType: "extracted", value: "Grow" },
    });
    const graph = buildProgramGraph(
      program({ phases, rawData: { phaseInputs: { strategy: { businessObjective: "Grow", _provenance: provenance } } } }),
      [doc({ summary: "Full strategy deck" })],
    );
    const docNode = graph.nodes.find((n) => n.id === "doc:deck.pdf");
    expect(docNode!.properties!.summary).toBe("Full strategy deck");
  });

  it("flows a strategy insight forward into a later phase slice", () => {
    const graph = buildProgramGraph(
      program({ phases }),
      [doc({ primaryPhase: "strategy", entities: { ...doc({}).intelligence.entities, constraints: [{ text: "GDPR applies", source: "p.2", confidence: 0.8, extractionType: "extracted" }] } })],
    );
    const sel = selectGraphForPhase(graph, "build");
    expect(sel.nodes.find((n) => n.type === "insight" && n.label === "GDPR applies")).toBeDefined();
  });
});

describe("selectGraphForPhase", () => {
  function richGraph(): ProgramGraph {
    return buildProgramGraph(program({
      phases,
      artifacts: [
        { id: "charter", phaseId: "strategy", title: "Charter", status: "approved", agentGenerated: true, lastEditedBy: "agent", lastEditedAt: "", contentSummary: "", versionNumber: 1 },
        { id: "arch", phaseId: "build", title: "Architecture", status: "draft", agentGenerated: true, lastEditedBy: "agent", lastEditedAt: "", contentSummary: "", versionNumber: 1 },
      ],
      stakeholders: [
        { id: "s1", name: "Jane", role: "CIO", organisation: null, influence: "high", interest: "high", currentEngagement: "champion", targetEngagement: "champion", sentiment: "positive", riskOfDisengagement: "low", recommendedActions: [], owner: null },
      ],
      rawData: { phaseInputs: { strategy: { sponsor: "Jane, CIO" } } },
    }));
  }

  it("includes the target phase and all prior phases, excluding later ones", () => {
    const sel = selectGraphForPhase(richGraph(), "discover");
    const phaseNodes = sel.nodes.filter((n) => n.type === "phase").map((n) => n.phaseCreated);
    expect(phaseNodes).toEqual(["strategy", "discover"]);
    // The build-phase architecture artifact is downstream and must be excluded.
    expect(sel.nodes.find((n) => n.id === "artifact:arch")).toBeUndefined();
    // The strategy charter is prior context and must be included.
    expect(sel.nodes.find((n) => n.id === "artifact:charter")).toBeDefined();
  });

  it("always carries programme-global stakeholders into the slice", () => {
    const sel = selectGraphForPhase(richGraph(), "strategy");
    expect(sel.nodes.find((n) => n.type === "stakeholder")).toBeDefined();
  });

  it("keeps only edges whose endpoints are both in the slice", () => {
    const sel = selectGraphForPhase(richGraph(), "strategy");
    for (const edge of sel.edges) {
      const ids = new Set(sel.nodes.map((n) => n.id));
      expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true);
    }
  });

  it("reports a positive reduction when the slice is a strict subset", () => {
    const sel = selectGraphForPhase(richGraph(), "strategy");
    expect(sel.reduction.scopedChars).toBeLessThan(sel.reduction.fullChars);
    expect(sel.reduction.reductionPct).toBeGreaterThan(0);
  });

  it("falls back to global-only context for an unknown phase", () => {
    const sel = selectGraphForPhase(richGraph(), "nonexistent");
    expect(sel.nodes.every((n) => n.phaseCreated === undefined)).toBe(true);
    expect(sel.nodes.find((n) => n.type === "stakeholder")).toBeDefined();
  });
});

describe("compressProgramNode", () => {
  it("formats a fact line with phase and confidence", () => {
    const graph = buildProgramGraph(program({
      phases,
      rawData: { phaseInputs: { strategy: { sponsor: "Jane, CIO" } } },
    }));
    const fact = graph.nodes.find((n) => n.type === "fact")!;
    expect(compressProgramNode(fact)).toBe("fact [strategy]: Executive sponsor: Jane, CIO (confidence: high)");
  });
});
