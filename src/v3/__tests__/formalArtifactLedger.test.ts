import { describe, it, expect } from "vitest";
import { reconcileFormalArtifactLedger } from "@/v3/lib/formalArtifactLedger";

/**
 * The reconciler backfills phaseArtifacts ledger stubs from top-level formal
 * mirrors. It must be additive (never touch existing stubs), idempotent (a second
 * pass changes nothing), and skip mirrors with no renderable body.
 */

describe("reconcileFormalArtifactLedger", () => {
  it("backfills a stub for a mirror with content and an empty ledger bucket", () => {
    const result = reconcileFormalArtifactLedger({
      phaseArtifacts: { strategy: {} },
      transformationCharter: {
        purpose: "Modernise CRM",
        generatedAt: "2026-06-01T00:00:00Z",
        confidence: 0.82,
      },
    });
    expect(result.changed).toBe(true);
    expect(result.added).toContainEqual({ phaseId: "strategy", artifactId: "charter" });

    const stub = (result.data.phaseArtifacts as Record<string, Record<string, Record<string, unknown>>>)
      .strategy.charter;
    expect(stub.status).toBe("draft");
    expect(stub.agentDrafted).toBe(true);
    expect(stub.agentDraftedAt).toBe("2026-06-01T00:00:00Z");
    expect(stub.confidence).toBeCloseTo(0.82);
    expect(stub.agentConfidence).toBe(82);
    expect(stub.content).toEqual({
      purpose: "Modernise CRM",
      generatedAt: "2026-06-01T00:00:00Z",
      confidence: 0.82,
    });
  });

  it("places each formal artifact under its methodology phase", () => {
    const result = reconcileFormalArtifactLedger({
      transformationCharter: { purpose: "x" },
      governanceModel: { options: [{ name: "Lean" }] },
      testPlan: { scope: "regression" },
    });
    const added = result.added.reduce<Record<string, string>>((acc, a) => {
      acc[a.artifactId] = a.phaseId;
      return acc;
    }, {});
    expect(added["charter"]).toBe("strategy");
    expect(added["governance-model"]).toBe("mobilise");
    expect(added["test-plan"]).toBe("build");
  });

  it("never overwrites an existing ledger stub", () => {
    const existing = { title: "Charter", status: "approved", agentConfidence: 95 };
    const result = reconcileFormalArtifactLedger({
      phaseArtifacts: { strategy: { charter: existing } },
      transformationCharter: { purpose: "Modernise CRM", confidence: 0.5 },
    });
    expect(result.changed).toBe(false);
    expect(result.added).toEqual([]);
    expect((result.data.phaseArtifacts as Record<string, Record<string, unknown>>).strategy.charter).toBe(
      existing,
    );
  });

  it("is idempotent — a second pass adds nothing", () => {
    const data = {
      phaseArtifacts: { strategy: {} },
      transformationCharter: { purpose: "Modernise CRM", confidence: 0.82 },
    };
    const first = reconcileFormalArtifactLedger(data);
    const second = reconcileFormalArtifactLedger(first.data);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.added).toEqual([]);
  });

  it("skips a mirror with no renderable body", () => {
    const result = reconcileFormalArtifactLedger({
      phaseArtifacts: { strategy: {} },
      transformationCharter: { confidence: 0.7, generatedAt: "2026-06-01T00:00:00Z" },
    });
    expect(result.changed).toBe(false);
    expect(result.added).toEqual([]);
  });

  it("preserves co-located buckets and other top-level fields", () => {
    const result = reconcileFormalArtifactLedger({
      phaseArtifacts: {
        mobilise: { "core-team": { title: "Roster", status: "draft" } },
      },
      transformationCharter: { purpose: "Modernise CRM" },
    });
    const pa = result.data.phaseArtifacts as Record<string, Record<string, unknown>>;
    expect(pa.mobilise["core-team"]).toEqual({ title: "Roster", status: "draft" });
    expect(pa.strategy.charter).toBeDefined();
  });
});
