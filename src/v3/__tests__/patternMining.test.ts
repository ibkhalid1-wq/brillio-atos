import { describe, it, expect } from "vitest";
import {
  mineRiskPatterns,
  rankSimilarPatterns,
  type ProgramProfile,
} from "@/v3/lib/patternMining";
import type { PatternLibraryEntry, ProgramSummary, RAIDEntry } from "@/new/types";

/**
 * Cross-programme learning has two pure halves: mining a programme's RAID history
 * into library candidates (a *closed* risk is a *successful* mitigation worth
 * reusing), and ranking a candidate pool by relevance to a target programme so
 * the UI surfaces the few best precedents rather than an industry-filtered dump.
 */
function raid(over: Partial<RAIDEntry>): RAIDEntry {
  return {
    id: "r1",
    type: "risk",
    title: "Vendor SLA slippage",
    description: "Key vendor missing delivery windows.",
    severity: "high",
    phase: "design",
    owner: null,
    mitigation: "Weekly SLA review + penalty clause",
    status: "closed",
    source: "agent",
    createdAt: "2026-01-01T00:00:00Z",
    closedAt: null,
    closedBy: null,
    closureNote: null,
    ...over,
  };
}

function program(over: Partial<ProgramSummary>): ProgramSummary {
  return {
    id: "prog-1",
    industry: "Banking",
    raidEntries: [],
    ...over,
  } as ProgramSummary;
}

function pattern(over: Partial<PatternLibraryEntry>): PatternLibraryEntry {
  return {
    id: "p1",
    patternType: "risk",
    phaseId: "design",
    industry: "Banking",
    programSize: "large",
    title: "Pattern",
    body: {},
    outcome: "neutral",
    confidence: 0.5,
    sourceProgramId: "other-prog",
    createdAt: "2026-01-01T00:00:00Z",
    usedCount: 0,
    ...over,
  };
}

describe("mineRiskPatterns", () => {
  it("returns nothing for a programme with no RAID entries", () => {
    expect(mineRiskPatterns(program({ raidEntries: [] }))).toEqual([]);
  });

  it("mines risks and blockers but ignores assumptions and dependencies", () => {
    const p = program({
      raidEntries: [
        raid({ id: "a", type: "risk" }),
        raid({ id: "b", type: "blocker" }),
        raid({ id: "c", type: "assumption" }),
        raid({ id: "d", type: "dependency" }),
      ],
    });
    const mined = mineRiskPatterns(p);
    expect(mined.map((m) => m.id)).toEqual(["mined:prog-1:a", "mined:prog-1:b"]);
    expect(mined.every((m) => m.patternType === "risk")).toBe(true);
  });

  it("skips entries with no documented mitigation", () => {
    const p = program({
      raidEntries: [
        raid({ id: "a", mitigation: null }),
        raid({ id: "b", mitigation: "   " }),
        raid({ id: "c", mitigation: "Real response" }),
      ],
    });
    expect(mineRiskPatterns(p).map((m) => m.id)).toEqual(["mined:prog-1:c"]);
  });

  it("marks a closed risk successful and an open/monitoring risk neutral", () => {
    const p = program({
      raidEntries: [
        raid({ id: "a", status: "closed" }),
        raid({ id: "b", status: "open" }),
        raid({ id: "c", status: "monitoring" }),
      ],
    });
    const byId = Object.fromEntries(mineRiskPatterns(p).map((m) => [m.id, m.outcome]));
    expect(byId["mined:prog-1:a"]).toBe("successful");
    expect(byId["mined:prog-1:b"]).toBe("neutral");
    expect(byId["mined:prog-1:c"]).toBe("neutral");
  });

  it("carries confidence, phase, industry, and mitigation body through", () => {
    const p = program({
      industry: "Retail",
      raidEntries: [raid({ id: "a", agentConfidence: 0.83, phase: "build", mitigation: "Fallback vendor" })],
    });
    const [m] = mineRiskPatterns(p);
    expect(m.confidence).toBe(0.83);
    expect(m.phaseId).toBe("build");
    expect(m.industry).toBe("Retail");
    expect(m.sourceProgramId).toBe("prog-1");
    expect(m.body.mitigation).toBe("Fallback vendor");
  });

  it("prefers profile overrides for size/industry/source over programme defaults", () => {
    const p = program({ industry: "Banking", raidEntries: [raid({ id: "a" })] });
    const [m] = mineRiskPatterns(p, { programId: "canonical", industry: "Insurance", programSize: "enterprise" });
    expect(m.industry).toBe("Insurance");
    expect(m.programSize).toBe("enterprise");
    expect(m.sourceProgramId).toBe("canonical");
  });
});

describe("rankSimilarPatterns", () => {
  const target: ProgramProfile = {
    programId: "prog-1",
    industry: "Banking",
    programSize: "large",
    activePhaseId: "design",
  };

  it("returns nothing for an empty candidate pool", () => {
    expect(rankSimilarPatterns([], target)).toEqual([]);
  });

  it("excludes the target's own patterns", () => {
    const own = pattern({ id: "own", sourceProgramId: "prog-1" });
    const other = pattern({ id: "other", sourceProgramId: "prog-2" });
    const ranked = rankSimilarPatterns([own, other], target);
    expect(ranked.map((r) => r.entry.id)).toEqual(["other"]);
  });

  it("ranks a full match above a partial match", () => {
    const full = pattern({
      id: "full",
      industry: "Banking",
      programSize: "large",
      phaseId: "design",
      outcome: "successful",
      sourceProgramId: "px",
    });
    const partial = pattern({
      id: "partial",
      industry: "Banking",
      programSize: "small",
      phaseId: "build",
      outcome: "neutral",
      sourceProgramId: "py",
    });
    const ranked = rankSimilarPatterns([partial, full], target);
    expect(ranked[0].entry.id).toBe("full");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("surfaces industry alignment as a reason", () => {
    const [top] = rankSimilarPatterns([pattern({ industry: "Banking", sourceProgramId: "px" })], target);
    expect(top.reasons.some((r) => r.includes("industry"))).toBe(true);
  });

  it("a precise match outranks a popular-but-off-context one", () => {
    const precise = pattern({
      id: "precise",
      industry: "Banking",
      programSize: "large",
      phaseId: "design",
      outcome: "successful",
      usedCount: 0,
      sourceProgramId: "px",
    });
    const popular = pattern({
      id: "popular",
      industry: "Healthcare",
      programSize: "small",
      phaseId: "closure",
      outcome: "neutral",
      usedCount: 50,
      sourceProgramId: "py",
    });
    const ranked = rankSimilarPatterns([popular, precise], target);
    expect(ranked[0].entry.id).toBe("precise");
  });

  it("honours the limit and sorts deterministically on ties", () => {
    // Two identical-scoring candidates → title then id breaks the tie.
    const a = pattern({ id: "z", title: "Alpha", industry: "Banking", programSize: null, phaseId: null, outcome: "neutral", confidence: 0, sourceProgramId: "px" });
    const b = pattern({ id: "a", title: "Beta", industry: "Banking", programSize: null, phaseId: null, outcome: "neutral", confidence: 0, sourceProgramId: "py" });
    const ranked = rankSimilarPatterns([b, a], target, 1);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].entry.title).toBe("Alpha");
  });
});
