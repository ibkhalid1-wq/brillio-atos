import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import {
  buildFactGraph,
  factsForPhase,
  factsByStatus,
  factsForArtifact,
  compressFactCitation,
  selectFactsForArtifacts,
  type Fact,
  type FactGraph,
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

/** Hand-built facts with explicit impactedArtifacts — static schema fields declare
 *  none, so we construct a graph directly to exercise the artifact-scoped slice. */
function fact(id: string, factType: string, artifacts: string[]): Fact {
  return {
    id,
    factId: `strategy:${factType}`,
    factType,
    factText: `${factType}: value ${id}`,
    normalizedValue: `value ${id}`,
    sourceType: "user_input",
    sourceId: "strategy",
    sourceName: "User input",
    sourceLocation: "",
    confidence: 1,
    status: "confirmed",
    impactedArtifacts: artifacts,
    impactedPhases: ["strategy"],
  };
}

function graphOf(facts: Fact[]): FactGraph {
  const byId: Record<string, Fact> = {};
  for (const f of facts) byId[f.id] = f;
  return {
    facts,
    byId,
    stats: {
      factCount: facts.length,
      byStatus: { proposed: 0, confirmed: facts.length, conflicted: 0, rejected: 0, stale: 0 },
      bySourceType: { user_input: facts.length, imported_document: 0, prior_artifact: 0, inferred: 0 },
      orphans: facts.filter((f) => f.impactedArtifacts.length === 0).length,
    },
  };
}

describe("selectFactsForArtifacts", () => {
  const graph = graphOf([
    fact("F1", "sponsor", ["charter", "businessCase"]),
    fact("F2", "businessObjective", ["charter"]),
    fact("F3", "industry", ["marketScan"]),
    fact("F4", "budget", []), // orphan — feeds nothing
  ]);

  it("keeps only facts feeding an in-scope artifact", () => {
    const sel = selectFactsForArtifacts(graph, ["charter"]);
    expect(sel.facts.map((f) => f.id)).toEqual(["F1", "F2"]);
  });

  it("unions facts across multiple in-scope artifacts, no duplicates", () => {
    const sel = selectFactsForArtifacts(graph, ["charter", "marketScan"]);
    expect(sel.facts.map((f) => f.id)).toEqual(["F1", "F2", "F3"]);
  });

  it("reports a positive reduction when the scope is a strict subset", () => {
    const sel = selectFactsForArtifacts(graph, ["charter"]);
    expect(sel.reduction.scopedChars).toBeLessThan(sel.reduction.fullChars);
    expect(sel.reduction.reductionPct).toBeGreaterThan(0);
    expect(sel.reduction.droppedChars).toBe(sel.reduction.fullChars - sel.reduction.scopedChars);
  });

  it("returns an empty slice with 100% reduction when no artifact matches", () => {
    const sel = selectFactsForArtifacts(graph, ["nonexistent"]);
    expect(sel.facts).toHaveLength(0);
    expect(sel.citations).toBe("");
    expect(sel.reduction.reductionPct).toBe(100);
  });

  it("citations are the compressed form of the selected facts", () => {
    const sel = selectFactsForArtifacts(graph, ["businessCase"]);
    expect(sel.citations).toBe(compressFactCitation(graph.byId.F1));
  });
});

describe("compressFactCitation", () => {
  it("formats a compact, prompt-ready citation line", () => {
    const graph = buildFactGraph(programWith({ strategy: { sponsor: "Jane Doe, CIO" } }));
    const line = compressFactCitation(graph.facts[0]);
    expect(line).toBe("F1: Executive sponsor: Jane Doe, CIO. Source: User input. Confidence: high.");
  });
});
