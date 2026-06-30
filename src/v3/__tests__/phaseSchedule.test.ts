import { describe, it, expect } from "vitest";
import {
  buildPhaseSchedule,
  buildMethodologyPhaseSchedule,
  buildRoadmapRows,
  computeScheduleAdherence,
  computeScheduleAdherenceDetail,
  isRoadmapBaselineLocked,
  layoutGantt,
  shiftIsoDate,
  daysBetween,
} from "@/v3/lib/phaseSchedule";
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

describe("layoutGantt", () => {
  it("pads the axis to whole months and positions bars as percentages", () => {
    const layout = layoutGantt([
      { id: "a", name: "Alpha", start: "2026-01-15", end: "2026-02-15" },
      { id: "b", name: "Beta", start: "2026-02-15", end: "2026-03-10" },
    ]);
    expect(layout).not.toBeNull();
    // Span pads out to Jan 1 → Apr 1 (the month after the latest end).
    expect(layout!.rangeStart).toBe("2026-01-01");
    expect(layout!.rangeEnd).toBe("2026-04-01");
    expect(layout!.bars[0].offsetPct).toBeGreaterThan(0);
    expect(layout!.bars[0].widthPct).toBeGreaterThan(0);
    // The first bar starts after the padded range start, so it has a left offset.
    expect(layout!.bars[0].offsetPct).toBeCloseTo((14 / 90) * 100, 1);
    // One tick per month in the padded span: Jan, Feb, Mar.
    expect(layout!.months.map((m) => m.label)).toEqual(["Jan 2026", "Feb 2026", "Mar 2026"]);
    expect(layout!.months[0].offsetPct).toBe(0);
  });

  it("drops rows with invalid or inverted dates and returns null when none survive", () => {
    const layout = layoutGantt([
      { id: "good", name: "Good", start: "2026-01-01", end: "2026-02-01" },
      { id: "inverted", name: "Bad", start: "2026-03-01", end: "2026-02-01" },
      { id: "junk", name: "Junk", start: "nope", end: "2026-02-01" },
    ]);
    expect(layout!.bars.map((b) => b.id)).toEqual(["good"]);
    expect(layoutGantt([{ id: "x", name: "X", start: "bad", end: "worse" }])).toBeNull();
    expect(layoutGantt([])).toBeNull();
  });
});

describe("shiftIsoDate / daysBetween", () => {
  it("shifts dates forward and backward across month and year boundaries", () => {
    expect(shiftIsoDate("2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIsoDate("2026-03-01", 0)).toBe("2026-03-01");
    expect(shiftIsoDate("not a date", 5)).toBe("not a date");
  });

  it("counts whole days between dates", () => {
    expect(daysBetween("2026-01-01", "2026-01-08")).toBe(7);
    expect(daysBetween("2026-02-01", "2026-01-01")).toBe(-31);
    expect(daysBetween("bad", "2026-01-01")).toBe(0);
  });
});

/**
 * Roadmap progress is completion against each phase's *expected* deliverables —
 * its required artifacts plus the planner's declared dynamic artifacts — not the
 * average state of whatever sits in the bucket. This guards the regression where
 * a stray program-level agent output (an "adoption" draft) bucketed under the
 * locked Operate phase made it read 50% complete, ahead of the active phases.
 */
describe("buildRoadmapRows — progress scoping", () => {
  const phases = [
    { id: "strategy" }, { id: "mobilise" }, { id: "discover" },
    { id: "design" }, { id: "build" }, { id: "operate" },
  ];
  const rawData = {
    phaseInputs: { strategy: { startDate: "2026-01-01", targetEndDate: "2027-01-01" } },
    dynamicSchema: {
      artifacts: {
        discover: [
          { id: "current-state-narrative", label: "Narrative", description: "" },
          { id: "scope-map", label: "Scope Map", description: "" },
          { id: "requirements-catalog", label: "Requirements", description: "" },
          { id: "stakeholder-map", label: "Stakeholder Map", description: "" },
        ],
        mobilise: [
          { id: "raci-matrix", label: "RACI", description: "" },
          { id: "governance-model", label: "Governance", description: "" },
          { id: "risks-assumptions-log", label: "Risks", description: "" },
          { id: "mobilisation-narrative", label: "Narrative", description: "" },
        ],
      },
    },
    phaseArtifacts: {
      strategy: {
        charter: { status: "approved" }, "business-case": { status: "approved" },
        "outcome-framework": { status: "approved" }, "strategic-roadmap": { status: "approved" },
        risk: { status: "approved" }, "completion-estimate": { status: "approved" },
      },
      // Mobilise deliverables landed under the producing-agent ids (risk, narrative),
      // not the planner's synonyms (risks-assumptions-log, mobilisation-narrative);
      // the alias/canonicalisation must still credit them.
      mobilise: {
        "raci-matrix": { status: "approved" }, "governance-model": { status: "approved" },
        risk: { status: "approved" }, narrative: { status: "approved" },
        "capacity-assessor": { status: "approved" },
      },
      discover: { "scope-map": { status: "draft" }, "requirements-catalog": { status: "stale" } },
      operate: { adoption: { status: "draft" } },
    },
  };

  const pctById = () => {
    const rows = buildRoadmapRows(rawData, phases);
    return Object.fromEntries(rows.map((r) => [r.id, r.progressPct]));
  };

  it("scores a fully-approved required phase at 100%", () => {
    expect(pctById().strategy).toBe(100);
  });

  it("credits deliverables stored under aliased producing-agent ids", () => {
    // raci-matrix + governance-model + (risks-assumptions-log→risk), all approved.
    // narrative/capacity-assessor are not expected deliverables and don't dilute.
    expect(pctById().mobilise).toBe(100);
  });

  it("measures a dynamic phase against its declared deliverables, not just generated ones", () => {
    // scope-map(draft .5) + requirements-catalog(stale .4) + stakeholder-map(0), ÷3.
    expect(pctById().discover).toBe(30);
  });

  it("ignores a stray agent output bucketed under a phase with no expected deliverables", () => {
    expect(pctById().operate).toBe(0);
    expect(pctById().build).toBe(0);
  });

  it("reads a gate-approved (complete) phase as 100% even if an artifact is still draft", () => {
    // Discover's ledger is only 30% by artifact tally, but once its gate is
    // approved the phase is done — the gate is authoritative over a stray draft.
    const completed = [
      { id: "strategy", status: "complete" }, { id: "mobilise", status: "complete" },
      { id: "discover", status: "complete" }, { id: "design", status: "complete" },
      { id: "build", status: "active" }, { id: "operate", status: "inactive" },
    ];
    const rows = buildRoadmapRows(rawData, completed);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.progressPct]));
    expect(byId.discover).toBe(100);
    expect(byId.strategy).toBe(100);
    expect(byId.mobilise).toBe(100);
  });
});

/**
 * Schedule adherence is the confidence model's "are we on time?" signal: it only
 * judges in-flight phases (started, not yet complete) and compares each phase's
 * actual progress to the pace its elapsed window implies. Far-past / far-future
 * windows keep these cases deterministic regardless of the real "today".
 */
describe("computeScheduleAdherence", () => {
  it("returns null when there is no parseable schedule", () => {
    // strategy inputs exist but carry no dates → no roadmap rows → no signal.
    expect(computeScheduleAdherence({ phaseInputs: { strategy: {} } }, [{ id: "build" }])).toBeNull();
    expect(computeScheduleAdherence({}, [{ id: "build" }])).toBeNull();
  });

  it("returns 100 when no phase has started yet (nothing can be behind)", () => {
    const rawData = { phaseInputs: { strategy: { startDate: "2099-01-01", targetEndDate: "2099-12-31" } } };
    expect(computeScheduleAdherence(rawData, [{ id: "build" }, { id: "operate" }])).toBe(100);
  });

  it("scores a started phase with no progress against its elapsed window as behind", () => {
    // Whole window is in the past with zero artifacts produced → fully behind.
    const rawData = { phaseInputs: { strategy: { startDate: "2020-01-01", targetEndDate: "2020-12-31" } } };
    const score = computeScheduleAdherence(rawData, [{ id: "build" }]);
    expect(score).not.toBeNull();
    expect(score).toBeLessThanOrEqual(10);
  });

  it("excludes complete phases so finished work never drags the pace", () => {
    // A fully-approved (100%) past phase is excluded; the only other phase is in
    // the future and also excluded → nothing in-flight → fully on schedule.
    const rawData = {
      phaseInputs: { strategy: { startDate: "2020-01-01", targetEndDate: "2020-12-31" } },
      phaseArtifacts: {
        strategy: {
          charter: { status: "approved" }, "business-case": { status: "approved" },
          "outcome-framework": { status: "approved" }, "strategic-roadmap": { status: "approved" },
          risk: { status: "approved" }, "completion-estimate": { status: "approved" },
        },
      },
    };
    expect(computeScheduleAdherence(rawData, [{ id: "strategy" }])).toBe(100);
  });
});

/**
 * The detail variant also reports HOW MANY in-flight phases are behind pace, so
 * the confidence breakdown can say "N phase(s) behind" rather than restate the
 * percentage. The count is derived from the same per-phase comparison as the
 * score, so the two can never disagree.
 */
describe("computeScheduleAdherenceDetail", () => {
  it("reports no usable schedule with a zero behind-count", () => {
    expect(computeScheduleAdherenceDetail({}, [{ id: "build" }])).toEqual({
      score: null,
      phasesBehind: 0,
      inFlight: 0,
    });
  });

  it("counts a started, zero-progress phase as behind", () => {
    const rawData = { phaseInputs: { strategy: { startDate: "2020-01-01", targetEndDate: "2020-12-31" } } };
    const detail = computeScheduleAdherenceDetail(rawData, [{ id: "build" }]);
    expect(detail.inFlight).toBe(1);
    expect(detail.phasesBehind).toBe(1);
    expect(detail.score).toBeLessThanOrEqual(10);
  });

  it("reports zero behind when nothing is in flight", () => {
    const rawData = { phaseInputs: { strategy: { startDate: "2099-01-01", targetEndDate: "2099-12-31" } } };
    expect(computeScheduleAdherenceDetail(rawData, [{ id: "build" }])).toEqual({
      score: 100,
      phasesBehind: 0,
      inFlight: 0,
    });
  });
});

/**
 * The roadmap is a Strategy deliverable, so it locks the moment the Strategy
 * gate is approved — after that the timeline is read-only and changes go through
 * change control. The owning phase comes from the formal-artifact registry.
 */
describe("isRoadmapBaselineLocked", () => {
  it("is locked once the Strategy gate is approved", () => {
    expect(isRoadmapBaselineLocked({ strategy: { status: "approved" } })).toBe(true);
  });

  it("is unlocked while Strategy is still in review", () => {
    expect(isRoadmapBaselineLocked({ strategy: { status: "pending-review" } })).toBe(false);
    expect(isRoadmapBaselineLocked({ strategy: { status: "ready" } })).toBe(false);
  });

  it("ignores approvals on other phases", () => {
    expect(isRoadmapBaselineLocked({ mobilise: { status: "approved" }, design: { status: "approved" } })).toBe(false);
  });

  it("is unlocked for empty or missing gate reviews", () => {
    expect(isRoadmapBaselineLocked({})).toBe(false);
    expect(isRoadmapBaselineLocked(null)).toBe(false);
    expect(isRoadmapBaselineLocked(undefined)).toBe(false);
  });
});
