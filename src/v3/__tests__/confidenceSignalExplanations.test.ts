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
