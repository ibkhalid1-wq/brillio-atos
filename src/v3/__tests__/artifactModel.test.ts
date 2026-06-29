import { describe, it, expect } from "vitest";
import { normalizeProgram } from "@/new/lib/programData";
import { buildPhaseArtifacts, buildArtifactModel } from "@/v3/lib/artifactModel";

/**
 * Read-path resilience: a formal document lives both as a top-level mirror (the
 * real body) and a phaseArtifacts ledger stub. An older edge build wrote only the
 * mirror, leaving the ledger empty — which made present documents read as
 * "missing". buildArtifactModel must treat the required formal artifact as present
 * when its mirror has content, while still preferring the ledger stub when one
 * exists.
 */

function charterNode(data: Record<string, unknown>) {
  const program = normalizeProgram({ id: "p1", name: "CRM", data });
  const strategy = buildPhaseArtifacts(program, "strategy")!;
  return strategy.artifacts.find((n) => n.key === "charter")!;
}

describe("buildArtifactModel — formal mirror read-path resilience", () => {
  it("treats a required formal artifact as present from its top-level mirror when the ledger is empty", () => {
    const node = charterNode({
      phases: [{ id: "strategy", pct: 50 }],
      phaseArtifacts: { strategy: {} },
      transformationCharter: {
        purpose: "Modernise CRM",
        generatedAt: "2026-06-01T00:00:00Z",
        confidence: 0.82,
      },
    });
    expect(node.present).toBe(true);
    expect(node.origin).toBe("generated");
    expect(node.quality).toBe(82);
    expect(node.updatedAt).toBe("2026-06-01T00:00:00Z");
    expect(node.state).not.toBe("missing");
  });

  it("prefers the ledger stub over the mirror when a real artifact exists", () => {
    const node = charterNode({
      phases: [{ id: "strategy", pct: 50 }],
      phaseArtifacts: {
        strategy: {
          charter: { title: "Charter", status: "approved", agentDrafted: true, agentConfidence: 95 },
        },
      },
      transformationCharter: { purpose: "Modernise CRM", confidence: 0.5 },
    });
    expect(node.present).toBe(true);
    expect(node.state).toBe("approved");
    expect(node.quality).toBe(95);
  });

  it("stays missing when neither a ledger stub nor a mirror with content exists", () => {
    const node = charterNode({
      phases: [{ id: "strategy", pct: 50 }],
      phaseArtifacts: { strategy: {} },
    });
    expect(node.present).toBe(false);
    expect(node.state).toBe("missing");
  });

  it("ignores an empty mirror (no renderable content)", () => {
    const node = charterNode({
      phases: [{ id: "strategy", pct: 50 }],
      phaseArtifacts: { strategy: {} },
      transformationCharter: { confidence: 0.7, generatedAt: "2026-06-01T00:00:00Z" },
    });
    expect(node.present).toBe(false);
    expect(node.state).toBe("missing");
  });
});

describe("buildArtifactModel — phase avgQuality scoping", () => {
  it("averages only required present artifacts, ignoring additional ad-hoc ones", () => {
    const program = normalizeProgram({
      id: "p1",
      name: "CRM",
      data: {
        phases: [{ id: "strategy", pct: 50 }],
        phaseArtifacts: {
          strategy: {
            charter: { title: "Charter", status: "approved", agentDrafted: true, agentConfidence: 80 },
            "ad-hoc-note": { title: "Ad hoc note", status: "draft", agentDrafted: true, agentConfidence: 20 },
          },
        },
      },
    });
    const model = buildArtifactModel(program);
    const strategy = model.phases.find((p) => p.phaseId === "strategy")!;
    const adHoc = strategy.artifacts.find((n) => n.label === "Ad hoc note")!;
    expect(adHoc.required).toBe(false);
    expect(adHoc.quality).toBe(20);
    // The low-quality additional artifact must not drag the phase score to 50.
    expect(strategy.avgQuality).toBe(80);
  });
});
