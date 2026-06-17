import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import {
  buildFactGraph,
  factsForPhase,
  factsByStatus,
  factsForArtifact,
  compressFactCitation,
  type Fact,
} from "@/v3/lib/factGraph";

/** Minimal ProgramSummary stub — buildFactGraph only reads rawData. */
function programWith(phaseInputs: Record<string, Record<string, unknown>>): ProgramSummary {
  return { rawData: { phaseInputs } } as unknown as ProgramSummary;
}

const importedProvenance = JSON.stringify({
  businessObjective: { source: "Strategy Deck p.4", confidence: 0.9, extractionType: "extracted", value: "Improve commercial execution velocity" },
});

describe("buildFactGraph", () => {
  it("returns an empty graph for a program with no inputs", () => {
    const graph = buildFactGraph(programWith({}));
    expect(graph.facts).toHaveLength(0);
    expect(graph.stats.factCount).toBe(0);
  });

  it("derives one fact per filled atomic field, skipping empties", () => {
    const graph = buildFactGraph(programWith({
      strategy: {
        sponsor: "Jane Doe, CIO",
        businessObjective: "Improve commercial execution velocity",
        industry: "", // empty — no fact
      },
    }));
    expect(graph.stats.factCount).toBe(2);
    const types = graph.facts.map((f) => f.factType).sort();
    expect(types).toEqual(["businessObjective", "sponsor"]);
  });

  it("assigns stable sequential short ids in phase/field order", () => {
    const graph = buildFactGraph(programWith({
      strategy: { sponsor: "Jane Doe, CIO", businessObjective: "Velocity" },
    }));
    expect(graph.facts.map((f) => f.id)).toEqual(["F1", "F2"]);
    expect(graph.byId.F1).toBeDefined();
  });

  it("treats user input as confirmed with confidence 1", () => {
    const graph = buildFactGraph(programWith({ strategy: { sponsor: "Jane Doe, CIO" } }));
    const fact = graph.facts[0];
    expect(fact.sourceType).toBe("user_input");
    expect(fact.confidence).toBe(1);
    expect(fact.status).toBe("confirmed");
    expect(fact.factText).toBe("Executive sponsor: Jane Doe, CIO");
  });

  it("honours import provenance when the value still matches the snapshot", () => {
    const graph = buildFactGraph(programWith({
      strategy: {
        businessObjective: "Improve commercial execution velocity",
        _provenance: importedProvenance,
      },
    }));
    const fact = graph.facts.find((f) => f.factType === "businessObjective") as Fact;
    expect(fact.sourceType).toBe("imported_document");
    expect(fact.confidence).toBe(0.9);
    expect(fact.sourceLocation).toBe("Strategy Deck p.4");
  });

  it("drops provenance once the field is hand-edited away from the snapshot", () => {
    const graph = buildFactGraph(programWith({
      strategy: {
        businessObjective: "A different, hand-edited objective",
        _provenance: importedProvenance,
      },
    }));
    const fact = graph.facts.find((f) => f.factType === "businessObjective") as Fact;
    expect(fact.sourceType).toBe("user_input");
    expect(fact.confidence).toBe(1);
  });

  it("counts orphan facts (no impacted artifact) in stats", () => {
    const graph = buildFactGraph(programWith({ strategy: { sponsor: "Jane Doe, CIO" } }));
    // Static strategy fields declare no usedByArtifacts, so this is an orphan.
    expect(graph.stats.orphans).toBe(1);
  });
});

describe("fact accessors", () => {
  const graph = buildFactGraph(programWith({
    strategy: { sponsor: "Jane Doe, CIO", businessObjective: "Velocity" },
  }));

  it("factsForPhase returns facts originating in the phase", () => {
    expect(factsForPhase(graph, "strategy")).toHaveLength(2);
    expect(factsForPhase(graph, "mobilise")).toHaveLength(0);
  });

  it("factsByStatus filters by status", () => {
    expect(factsByStatus(graph, "confirmed")).toHaveLength(2);
    expect(factsByStatus(graph, "stale")).toHaveLength(0);
  });

  it("factsForArtifact returns only facts feeding that artifact", () => {
    expect(factsForArtifact(graph, "any-artifact")).toHaveLength(0);
  });
});

describe("compressFactCitation", () => {
  it("formats a compact, prompt-ready citation line", () => {
    const graph = buildFactGraph(programWith({ strategy: { sponsor: "Jane Doe, CIO" } }));
    const line = compressFactCitation(graph.facts[0]);
    expect(line).toBe("F1: Executive sponsor: Jane Doe, CIO. Source: User input. Confidence: high.");
  });
});
