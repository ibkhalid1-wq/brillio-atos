import { describe, it, expect } from "vitest";
import { buildPhaseSchedule, buildMethodologyPhaseSchedule } from "@/v3/lib/phaseSchedule";
import { getMethodology } from "@/v3/lib/methodology";

/**
 * The roadmap window split must be deterministic and total-conserving: the first
 * phase opens on the programme start, the last closes exactly on the target end,
 * phases are contiguous (no gaps, no overlaps), and bad inputs degrade to [] so
 * the caller can leave the artifact's own dates untouched rather than fabricate.
 */
describe("buildPhaseSchedule", () => {
  it("splits a window evenly across equal-weight phases", () => {
    const schedule = buildPhaseSchedule("2026-01-01", "2026-01-05", [
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
      { id: "c", weight: 1 },
      { id: "d", weight: 1 },
    ]);
    expect(schedule).toHaveLength(4);
    expect(schedule[0].start).toBe("2026-01-01");
    expect(schedule[3].end).toBe("2026-01-05");
    // Contiguous: each phase starts where the previous ended.
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].start).toBe(schedule[i - 1].end);
    }
  });

  it("weights longer phases with a larger slice of the window", () => {
    const schedule = buildPhaseSchedule("2026-01-01", "2026-01-11", [
      { id: "short", weight: 1 },
      { id: "long", weight: 9 },
    ]);
    const shortDays = (Date.parse(schedule[0].end) - Date.parse(schedule[0].start)) / 86_400_000;
    const longDays = (Date.parse(schedule[1].end) - Date.parse(schedule[1].start)) / 86_400_000;
    expect(longDays).toBeGreaterThan(shortDays);
    expect(schedule[0].start).toBe("2026-01-01");
    expect(schedule[1].end).toBe("2026-01-11");
  });

  it("always anchors the endpoints exactly regardless of rounding", () => {
    const schedule = buildPhaseSchedule("2026-04-20", "2027-07-26", [
      { id: "p1", weight: 2 },
      { id: "p2", weight: 3 },
      { id: "p3", weight: 5 },
      { id: "p4", weight: 7 },
    ]);
    expect(schedule[0].start).toBe("2026-04-20");
    expect(schedule[schedule.length - 1].end).toBe("2027-07-26");
  });

  it("falls back to equal weighting when all weights are non-positive", () => {
    const schedule = buildPhaseSchedule("2026-01-01", "2026-01-05", [
      { id: "a", weight: 0 },
      { id: "b", weight: -3 },
    ]);
    expect(schedule).toHaveLength(2);
    expect(schedule[0].start).toBe("2026-01-01");
    expect(schedule[1].end).toBe("2026-01-05");
    expect(schedule[0].end).toBe(schedule[1].start);
  });

  it("returns [] for invalid, missing, or inverted dates", () => {
    expect(buildPhaseSchedule("", "2026-01-05", [{ id: "a", weight: 1 }])).toEqual([]);
    expect(buildPhaseSchedule("not a date", "2026-01-05", [{ id: "a", weight: 1 }])).toEqual([]);
    expect(buildPhaseSchedule(undefined, null, [{ id: "a", weight: 1 }])).toEqual([]);
    // End on/before start can't yield a forward window.
    expect(buildPhaseSchedule("2026-01-05", "2026-01-05", [{ id: "a", weight: 1 }])).toEqual([]);
    expect(buildPhaseSchedule("2026-01-06", "2026-01-05", [{ id: "a", weight: 1 }])).toEqual([]);
  });

  it("returns [] when there are no phases", () => {
    expect(buildPhaseSchedule("2026-01-01", "2026-12-31", [])).toEqual([]);
  });
});

describe("buildMethodologyPhaseSchedule", () => {
  it("schedules every phase of the methodology in registry order", () => {
    const variant = "atos-standard" as const;
    const ids = getMethodology(variant).phases.map((p) => p.id);
    const schedule = buildMethodologyPhaseSchedule("2026-04-20", "2027-07-26", variant);
    expect(schedule.map((s) => s.id)).toEqual(ids);
    expect(schedule[0].start).toBe("2026-04-20");
    expect(schedule[schedule.length - 1].end).toBe("2027-07-26");
  });

  it("returns [] when the programme window is unusable", () => {
    expect(buildMethodologyPhaseSchedule("", "", "atos-standard")).toEqual([]);
  });
});
