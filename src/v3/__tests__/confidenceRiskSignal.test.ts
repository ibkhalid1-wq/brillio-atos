import { describe, it, expect } from "vitest";
import { computeConfidenceScore } from "@/v3/lib/confidenceScore";

/**
 * The risk-posture signal's explanation must never contradict its own score. The
 * prior message branched solely on critical-risk count, so a programme carrying
 * open high/medium/low risks (posture well below 100) still read "No critical or
 * high risks open. Risk posture is healthy." These tests pin that the explanation
 * names whatever severities are actually open and that a degraded posture always
 * yields a remediation action.
 */
function riskSignal(over: Partial<Parameters<typeof computeConfidenceScore>[0]>) {
  const result = computeConfidenceScore({
    gateReadiness: 50,
    riskPosture: 100,
    milestoneHealth: 100,
    scheduleAdherence: 100,
    openDecisionCount: 0,
    inputCompleteness: 100,
    ...over,
  });
  return result.signals.find((s) => s.category === "risk")!;
}

describe("confidence risk-posture signal", () => {
  it("does not claim 'healthy' when lower-severity risks weigh on posture", () => {
    const sig = riskSignal({ riskPosture: 52, openCriticalRisks: 0, openHighRisks: 0, openRiskCount: 5 });
    expect(sig.explanation).not.toMatch(/healthy/i);
    expect(sig.explanation).toMatch(/5 lower-severity risk/);
    // A degraded posture must offer an action, even with no critical/high risks.
    expect(sig.topAction).toBeTruthy();
  });

  it("names both critical and high counts when present", () => {
    const sig = riskSignal({ riskPosture: 40, openCriticalRisks: 2, openHighRisks: 3, openRiskCount: 5 });
    expect(sig.explanation).toBe("2 critical and 3 high risk(s) open and unmitigated.");
    expect(sig.topAction).toMatch(/2 critical/);
  });

  it("names only high when no critical risks are open", () => {
    const sig = riskSignal({ riskPosture: 60, openCriticalRisks: 0, openHighRisks: 4, openRiskCount: 4 });
    expect(sig.explanation).toBe("4 high risk(s) open and unmitigated.");
    expect(sig.topAction).toMatch(/4 high/);
  });

  it("reads healthy only when there are genuinely no open risks", () => {
    const sig = riskSignal({ riskPosture: 100, openCriticalRisks: 0, openHighRisks: 0, openRiskCount: 0 });
    expect(sig.explanation).toBe("No open risks. Risk posture is healthy.");
    expect(sig.topAction).toBeUndefined();
  });
});
