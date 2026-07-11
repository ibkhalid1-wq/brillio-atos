import { normalizeProgram } from "@/new/lib/programData";
import {
  derivePhaseStatusRings,
  ringsFromReadiness,
  ringTone,
  ringToneColor,
  ringColor,
} from "@/v3/lib/phaseStatusRings";
import type { PhaseReadinessResult } from "@/v3/lib/phaseReadiness";

function readiness(partial: Partial<PhaseReadinessResult>): PhaseReadinessResult {
  return {
    score: 0,
    gateScore: null,
    artifactScore: 0,
    inputScore: 0,
    artifactsComplete: 0,
    canApproveGate: false,
    threshold: 70,
    missing: [],
    reviewScoresCount: 0,
    recommendedActions: [],
    dependencyCheckPassed: null,
    dependencyBlockingIssues: 0,
    ...partial,
  };
}

describe("phaseStatusRings — tone bands", () => {
  it("maps green ≥75, amber ≥50, red below, muted for null", () => {
    expect(ringTone(90)).toBe("green");
    expect(ringTone(75)).toBe("green");
    expect(ringTone(74)).toBe("amber");
    expect(ringTone(50)).toBe("amber");
    expect(ringTone(49)).toBe("red");
    expect(ringTone(0)).toBe("red");
    expect(ringTone(null)).toBe("muted");
  });

  it("maps tones and raw values to CSS custom properties", () => {
    expect(ringToneColor("green")).toBe("var(--v3-green)");
    expect(ringToneColor("amber")).toBe("var(--v3-amber)");
    expect(ringToneColor("red")).toBe("var(--v3-red)");
    expect(ringToneColor("muted")).toBe("var(--v3-border)");
    expect(ringColor(80)).toBe("var(--v3-green)");
    expect(ringColor(null)).toBe("var(--v3-border)");
  });
});

describe("phaseStatusRings — canonical KPI mapping", () => {
  it("maps inner=input, middle=artifact, and gate=overall=score", () => {
    const r = ringsFromReadiness(
      readiness({ inputScore: 40, artifactScore: 60, gateScore: 80, score: 71, canApproveGate: true }),
    );
    expect(r.input).toBe(40);
    expect(r.artifact).toBe(60);
    // Gate score is the readiness composite (score), not the LLM gateScore.
    expect(r.gate).toBe(71);
    expect(r.overall).toBe(71);
    expect(r.hasGate).toBe(true);
    expect(r.canApproveGate).toBe(true);
  });

  it("derives the gate score from the composite even with no gate review", () => {
    const r = ringsFromReadiness(readiness({ inputScore: 30, artifactScore: 20, gateScore: null, score: 23 }));
    expect(r.gate).toBe(23);
    expect(r.hasGate).toBe(true);
  });

  it("clamps and rounds out-of-range values", () => {
    const r = ringsFromReadiness(readiness({ inputScore: 142.6, artifactScore: -10, gateScore: 99.4, score: 50.5 }));
    expect(r.input).toBe(100);
    expect(r.artifact).toBe(0);
    // Gate tracks the composite score, not gateScore.
    expect(r.gate).toBe(51);
    expect(r.overall).toBe(51);
  });
});

describe("phaseStatusRings — end to end via computePhaseReadiness", () => {
  it("derives a low composite gate ring for a barely-started phase", () => {
    const program = normalizeProgram({
      id: "p1",
      name: "ERP",
      data: { methodology: "atos-standard", phases: [{ id: "mobilise", pct: 10 }] },
    });
    const r = derivePhaseStatusRings(program, "mobilise");
    expect(r.hasGate).toBe(true);
    expect(r.gate).not.toBeNull();
    expect(r.gate).toBe(r.overall);
    expect(r.input).toBeGreaterThanOrEqual(0);
    expect(r.input).toBeLessThanOrEqual(100);
  });

  it("surfaces the gate score once a gate review is approved", () => {
    // Strategy must also be approved so Mobilise is reachable (not locked behind an
    // open upstream gate) — a locked phase mutes to zero regardless of its own gate.
    const program = normalizeProgram({
      id: "p1",
      name: "ERP",
      data: { methodology: "atos-standard",
        phases: [{ id: "mobilise", pct: 100 }],
        gateReviews: {
          strategy: { status: "approved", readinessScore: 90 },
          mobilise: { status: "approved", readinessScore: 88 },
        },
      },
    });
    const r = derivePhaseStatusRings(program, "mobilise");
    expect(r.hasGate).toBe(true);
    expect(r.gate).toBe(88);
    expect(r.overall).toBe(88);
    expect(ringTone(r.gate)).toBe("green");
  });

  it("mutes a previously-approved phase once an upstream gate is reopened", () => {
    // Strategy → Mobilise both approved, then Strategy is reopened
    // (remediation-requested). Strict sequential gating now cascade-locks Mobilise
    // even though it still carries its own approved gate. Its rings must read as
    // "not started", not keep showing the old green 88% — the approval is stale and
    // pending re-approval behind the reopened upstream gate.
    const program = normalizeProgram({
      id: "p1",
      name: "ERP",
      data: { methodology: "atos-standard",
        phases: [{ id: "mobilise", pct: 100 }],
        gateReviews: {
          strategy: { status: "remediation-requested", readinessScore: 90, reopenedAt: "2026-06-17T00:00:00Z" },
          mobilise: { status: "approved", readinessScore: 88 },
        },
      },
    });
    const r = derivePhaseStatusRings(program, "mobilise");
    expect(r.gate).toBe(0);
    expect(r.artifact).toBe(0);
    expect(r.input).toBe(0);
    expect(r.overall).toBe(0);
  });

  it("mutes an unreached phase even when an artifact was force-routed into its slot", () => {
    // Strategy is the open frontier (no gate approved), so every later phase is
    // locked. A program-level agent (e.g. adoption → operate) pre-drafted an
    // artifact into Operate's slot, which would otherwise score the phase ~44%.
    // The rings must show it as not-started (all zero), exactly like the other
    // unreached phases — the programme has not reached nor activated Operate.
    const program = normalizeProgram({
      id: "p1",
      name: "ERP",
      data: { methodology: "atos-standard",
        phaseArtifacts: {
          operate: {
            adoption: { title: "Adoption Plan", status: "draft", agentDrafted: true, agentConfidence: 97 },
          },
        },
      },
    });
    const r = derivePhaseStatusRings(program, "operate");
    expect(r.gate).toBe(0);
    expect(r.artifact).toBe(0);
    expect(r.input).toBe(0);
    expect(r.overall).toBe(0);
    expect(r.canApproveGate).toBe(false);
  });
});
