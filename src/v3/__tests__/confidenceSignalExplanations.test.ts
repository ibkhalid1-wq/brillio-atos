import { describe, it, expect } from "vitest";
import { computeConfidenceScore } from "@/v3/lib/confidenceScore";

/**
 * Consistency sweep: a signal's explanation must never contradict its own score
 * (the same class of bug fixed on risk posture). These pin the two remaining
 * offenders — milestone health claiming "all on track" when nothing is in flight
 * (a neutral 70 reads "warn"), and schedule adherence whose "N phases behind"
 * line was dead because the count was never supplied.
 */
function signal(category: string, over: Partial<Parameters<typeof computeConfidenceScore>[0]>) {
  const result = computeConfidenceScore({
    gateReadiness: 50,
    riskPosture: 100,
    milestoneHealth: 100,
    scheduleAdherence: 100,
    openDecisionCount: 0,
    inputCompleteness: 100,
    ...over,
  });
  return result.signals.find((s) => s.category === category)!;
}

describe("milestone-health signal explanation", () => {
  it("does not claim 'on track' when there are no in-flight milestones", () => {
    // Neutral default (70) renders as a "warn" chip — an "all on track" line here
    // would contradict the status badge.
    const sig = signal("milestone", { milestoneHealth: 70, milestonesInFlight: 0, milestonesAtRisk: 0 });
    expect(sig.status).toBe("warn");
    expect(sig.explanation).toBe("No in-flight milestones to track.");
    expect(sig.explanation).not.toMatch(/on track/i);
  });

  it("counts at-risk milestones against the in-flight total", () => {
    const sig = signal("milestone", { milestoneHealth: 50, milestonesInFlight: 4, milestonesAtRisk: 2 });
    expect(sig.explanation).toBe("2 of 4 in-flight milestone(s) at risk or delayed.");
  });

  it("reads on-track only when in-flight milestones exist and none are at risk", () => {
    const sig = signal("milestone", { milestoneHealth: 100, milestonesInFlight: 3, milestonesAtRisk: 0 });
    expect(sig.explanation).toBe("All 3 in-flight milestone(s) on track.");
  });
});

describe("schedule-adherence signal explanation", () => {
  it("names the count of phases behind pace when supplied", () => {
    const sig = signal("schedule", { scheduleAdherence: 40, phasesBehindSchedule: 2 });
    expect(sig.explanation).toBe("2 in-flight phase(s) are behind their planned pace.");
    expect(sig.topAction).toBeTruthy();
  });

  it("reads on-pace when nothing is behind", () => {
    const sig = signal("schedule", { scheduleAdherence: 100, phasesBehindSchedule: 0 });
    expect(sig.explanation).toBe("In-flight phases are keeping pace with the plan.");
  });
});

// Regression guards for the three signals audited clean: their qualitative
// "clear/healthy" phrasing must only ever appear alongside a "good" status, so
// the explanation can never contradict its own chip (the bug class fixed on
// risk/milestone/schedule).
describe("decision-backlog signal explanation", () => {
  it("only reads 'clear' when there are zero open decisions (a good status)", () => {
    const sig = signal("decision", { openDecisionCount: 0 });
    expect(sig.status).toBe("good");
    expect(sig.explanation).toBe("No open decisions. Decision backlog is clear.");
  });

  it("never claims 'clear' once a decision is open", () => {
    const sig = signal("decision", { openDecisionCount: 3 });
    expect(sig.status).not.toBe("good");
    expect(sig.explanation).not.toMatch(/clear/i);
  });

  it("names the overdue count when supplied", () => {
    const sig = signal("decision", { openDecisionCount: 5, overdueDecisions: 2 });
    expect(sig.explanation).toBe("5 open decision(s), 2 overdue (≥14 days).");
  });
});

describe("input-completeness signal explanation", () => {
  it("never reads 'low' once quality clears the warn threshold", () => {
    const sig = signal("input", { inputCompleteness: 80 });
    expect(sig.status).toBe("good");
    expect(sig.explanation).not.toMatch(/low/i);
  });

  it("calls quality 'low' only below the good threshold", () => {
    const sig = signal("input", { inputCompleteness: 45 });
    expect(sig.status).not.toBe("good");
    expect(sig.explanation).toMatch(/low/i);
  });
});

describe("gate-readiness signal explanation", () => {
  it("stays factual — no health claim that could contradict a poor status", () => {
    const sig = signal("gate", { gateReadiness: 30, approvedGates: 1, totalGates: 6 });
    expect(sig.status).toBe("poor");
    expect(sig.explanation).toBe("1 of 6 phase gates approved.");
    expect(sig.explanation).not.toMatch(/healthy|on track|clear/i);
  });
});
