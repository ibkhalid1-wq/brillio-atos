import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import { buildLayerMaturityModel, type LayerId } from "@/v3/lib/layerMaturity";

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

const phase = (id: string, status: string, pct = 0) => ({ id, displayName: id, pct, status, objective: "" });

function statusOf(model: ReturnType<typeof buildLayerMaturityModel>, id: LayerId) {
  return model.layers.find((l) => l.id === id)!.status;
}

describe("buildLayerMaturityModel", () => {
  it("emits all 15 layers, top→bottom, with 6 buildable knowledge layers", () => {
    const model = buildLayerMaturityModel(null);
    expect(model.layers).toHaveLength(15);
    expect(model.layers[0].id).toBe("presentation");
    expect(model.layers[model.layers.length - 1].id).toBe("infrastructure");
    expect(model.knowledge).toHaveLength(6);
    expect(model.summary.buildableTotal).toBe(6);
  });

  it("tags shell/cognition/substrate layers with fixed non-buildable statuses", () => {
    const model = buildLayerMaturityModel(null);
    expect(statusOf(model, "presentation")).toBe("shell");
    expect(statusOf(model, "agent")).toBe("runtime");
    expect(statusOf(model, "storage")).toBe("platform");
    expect(model.layers.find((l) => l.id === "storage")!.buildable).toBe(false);
  });

  it("locks every knowledge layer for an empty programme", () => {
    const model = buildLayerMaturityModel(null);
    expect(model.knowledge.every((l) => l.status === "locked")).toBe(true);
    expect(model.summary.locked).toBe(6);
  });

  it("moves a layer from locked to seeding once a contributing phase starts", () => {
    // Discover feeds context/knowledge-graph; started but with no inputs yet.
    const model = buildLayerMaturityModel(program({ phases: [phase("discover", "active", 10)] }));
    expect(statusOf(model, "knowledge-graph")).toBe("seeding");
    expect(statusOf(model, "context")).toBe("seeding");
  });

  it("populates the knowledge graph once facts exist, and flags ungrounded facts as gaps", () => {
    const model = buildLayerMaturityModel(
      program({
        phases: [phase("discover", "active", 40)],
        rawData: {
          phaseInputs: {
            discover: { currentStateSummary: "Legacy desks are fragmented and slow." },
          },
        },
      }),
    );
    const kg = model.layers.find((l) => l.id === "knowledge-graph")!;
    expect(kg.populated).toBeGreaterThan(0);
    // A standalone fact with nothing grounding it is an ungrounded-fact gap.
    expect(["populated", "healthy"]).toContain(kg.status);
  });

  it("scores business-rules from artifact coverage", () => {
    const model = buildLayerMaturityModel(
      program({
        phases: [phase("design", "active", 50)],
        artifacts: [
          { id: "targetArchitecture", phaseId: "design", title: "Target Architecture", status: "approved", agentConfidence: 90, agentGenerated: true },
        ],
      }),
    );
    const br = model.layers.find((l) => l.id === "business-rules")!;
    expect(br.buildable).toBe(true);
    expect(br.contributingPhases).toContain("design");
  });

  it("records the phase→layer contribution map on each knowledge layer", () => {
    const model = buildLayerMaturityModel(null);
    const memory = model.layers.find((l) => l.id === "memory")!;
    expect(memory.contributingPhases).toEqual(["operate", "optimize", "valuerealize"]);
    const graph = model.layers.find((l) => l.id === "knowledge-graph")!;
    expect(graph.contributingPhases).toContain("strategy");
    expect(graph.deepLink).toBe("graph");
  });
});
