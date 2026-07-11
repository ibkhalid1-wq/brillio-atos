import { normalizeProgram } from "@/new/lib/programData";
import {
  selectBlockers,
  selectHighRisks,
  selectRisks,
} from "@/v3/lib/programRaid";

/**
 * programRaid is the single source of truth for the risk / blocker lists every
 * surface counts. These tests pin the invariants the module exists to guarantee:
 * risks are risk-only (never silently mixed with blockers, the bug that made the
 * Today feed over-count), monitored risks stay counted (not just status "open"),
 * closed entries drop out, and phase scope narrows the set the same way everywhere.
 */
function makeProgram() {
  return normalizeProgram({
    id: "program-1",
    name: "ERP Transformation",
    client: "Acme",
    industry: "Financial Services",
    updated_at: "2026-06-13T00:00:00.000Z",
    data: { methodology: "atos-standard",
      objective: "Modernize finance operations",
      phases: [
        { id: "strategy", pct: 100 },
        { id: "mobilise", pct: 40 },
      ],
      // Strategy's gate is approved so Mobilise is unlocked — these tests pin the
      // selection semantics (risk-only, monitored counted, severity sort), which
      // must hold independently of phase-locking. Locked-phase filtering has its
      // own test below.
      gateReviews: { strategy: { status: "approved" } },
      raidLog: {
        entries: [
          { id: "r1", type: "risk", title: "Budget overrun", severity: "critical", phase: "strategy", status: "open" },
          { id: "r2", type: "risk", title: "Scope creep", severity: "medium", phase: "mobilise", status: "open" },
          { id: "r3", type: "risk", title: "Resolved risk", severity: "high", phase: "strategy", status: "closed" },
          { id: "r4", type: "risk", title: "Vendor delay", severity: "high", phase: "mobilise", status: "monitoring" },
          { id: "b1", type: "blocker", title: "Env access", severity: "high", phase: "strategy", status: "open" },
          { id: "b2", type: "blocker", title: "Old blocker", severity: "low", phase: "mobilise", status: "closed" },
        ],
      },
    },
  });
}

describe("selectRisks / selectBlockers", () => {
  it("returns risks only — never mixes in blockers", () => {
    const ids = selectRisks(makeProgram()).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["r1", "r2", "r4"]));
    expect(ids).not.toContain("b1");
  });

  it("counts monitored risks and drops closed ones", () => {
    const ids = selectRisks(makeProgram()).map((r) => r.id);
    expect(ids).toContain("r4"); // monitoring is still open work
    expect(ids).not.toContain("r3"); // closed drops out
  });

  it("sorts by severity (critical first)", () => {
    const sev = selectRisks(makeProgram()).map((r) => r.severity);
    expect(sev).toEqual(["critical", "high", "medium"]);
  });

  it("narrows to a single phase when scoped", () => {
    const ids = selectRisks(makeProgram(), { phaseId: "strategy" }).map((r) => r.id);
    expect(ids).toEqual(["r1"]); // r2/r4 are mobilise, r3 closed
  });

  it("selectHighRisks keeps only high/critical risks (no blockers)", () => {
    const ids = selectHighRisks(makeProgram()).map((r) => r.id);
    expect(ids).toEqual(["r1", "r4"]); // critical then high; r2 medium excluded
    expect(ids).not.toContain("b1");
  });

  it("selectBlockers returns open blockers only", () => {
    const ids = selectBlockers(makeProgram()).map((b) => b.id);
    expect(ids).toEqual(["b1"]); // b2 closed
  });
});

/**
 * The agent sometimes emits the same RAID item twice — with an identical id, or as
 * distinct uuids carrying the same type/phase/title. Both render as redundant rows,
 * so deriveRAIDEntries collapses them to the first occurrence.
 */
describe("RAID de-duplication", () => {
  function makeDupProgram() {
    return normalizeProgram({
      id: "program-dup",
      name: "Dups",
      updated_at: "2026-06-13T00:00:00.000Z",
      data: { methodology: "atos-standard",
        objective: "x",
        gateReviews: { strategy: { status: "approved" } },
        raidLog: {
          entries: [
            { id: "cap-build", type: "risk", title: "Team capacity shortfall", severity: "high", phase: "mobilise", status: "open" },
            { id: "cap-build", type: "risk", title: "Team capacity shortfall", severity: "high", phase: "mobilise", status: "open" },
            { id: "other-uuid", type: "risk", title: "team capacity shortfall", severity: "high", phase: "mobilise", status: "open" },
            { id: "distinct", type: "risk", title: "Team capacity shortfall", severity: "high", phase: "strategy", status: "open" },
          ],
        },
      },
    });
  }

  it("collapses entries sharing an id and entries sharing type/phase/title", () => {
    const risks = selectRisks(makeDupProgram());
    const titlesByPhase = risks.map((r) => `${r.phase}:${r.id}`);
    // The two "cap-build" (same id) and the "other-uuid" (same type/phase/title,
    // case-insensitive) collapse to one; the strategy-phase one is genuinely
    // distinct and survives.
    expect(titlesByPhase).toEqual(["mobilise:cap-build", "strategy:distinct"]);
  });

  it("drops a risk-agent restatement of a capacity gap the capacity-assessor owns", () => {
    const program = normalizeProgram({
      id: "program-cap",
      name: "Capacity",
      updated_at: "2026-06-13T00:00:00.000Z",
      data: { methodology: "atos-standard",
        objective: "x",
        gateReviews: { strategy: { status: "approved" } },
        raidLog: {
          entries: [
            // The capacity-assessor's deterministic owner for the mobilise gap.
            { id: "capacity-gap-mobilise", type: "risk", title: "Team capacity shortfall", severity: "high", phase: "mobilise", status: "open" },
            // The risk agent's overlapping restatement of the same gap — must drop.
            { id: "uuid-1", type: "risk", title: "Team capacity shortfall in Change Management Lead role", severity: "high", phase: "mobilise", status: "open" },
            // A genuinely different mobilise risk — must survive.
            { id: "uuid-2", type: "risk", title: "Vendor onboarding delay", severity: "high", phase: "mobilise", status: "open" },
          ],
        },
      },
    });
    const ids = selectRisks(program, { phaseId: "mobilise" }).map((r) => r.id);
    expect(ids).toContain("capacity-gap-mobilise");
    expect(ids).toContain("uuid-2");
    expect(ids).not.toContain("uuid-1");
  });
});

/**
 * Programme-wide lists must surface only ACTIONABLE items: a risk or blocker
 * tied to a locked (future) phase is behind an unapproved gate and cannot be
 * worked yet, so it drops out of the programme view. Scoping INTO that phase is
 * deliberate navigation, so the same item must reappear there.
 */
describe("locked-phase actionability filter", () => {
  function makeLockedProgram() {
    return normalizeProgram({
      id: "program-2",
      name: "Locked phases",
      updated_at: "2026-06-13T00:00:00.000Z",
      data: { methodology: "atos-standard",
        objective: "x",
        phases: [
          { id: "strategy", pct: 40 },
          { id: "mobilise", pct: 0 },
        ],
        // No approved gate → Mobilise is locked.
        raidLog: {
          entries: [
            { id: "r1", type: "risk", title: "Active risk", severity: "high", phase: "strategy", status: "open" },
            { id: "r2", type: "risk", title: "Future risk", severity: "critical", phase: "mobilise", status: "open" },
            { id: "b1", type: "blocker", title: "Future blocker", severity: "high", phase: "mobilise", status: "open" },
          ],
        },
      },
    });
  }

  it("hides locked-phase risks and blockers from the programme-wide list", () => {
    expect(selectRisks(makeLockedProgram()).map((r) => r.id)).toEqual(["r1"]);
    expect(selectBlockers(makeLockedProgram()).map((b) => b.id)).toEqual([]);
  });

  it("still shows them when scoped into the locked phase", () => {
    expect(selectRisks(makeLockedProgram(), { phaseId: "mobilise" }).map((r) => r.id)).toEqual(["r2"]);
    expect(selectBlockers(makeLockedProgram(), { phaseId: "mobilise" }).map((b) => b.id)).toEqual(["b1"]);
  });
});

/**
 * The capacity-assessor's `capacity-gap-{phase}` risk is forward-looking — it
 * exists so resourcing is closed BEFORE a phase's delivery load lands. Once that
 * phase's gate is approved the load has landed, so the gap is stale and drops out
 * programme-wide. It is never re-run for a closed phase, so without this it would
 * linger as a duplicate "Team capacity shortfall" alongside the active phase's.
 * Crucially, genuine non-capacity risks on a closed phase (key activities missed)
 * are still valid and must remain.
 */
describe("stale capacity-gap retirement on completed phases", () => {
  function makeProgram() {
    return normalizeProgram({
      id: "program-cap-complete",
      name: "Completed phases",
      updated_at: "2026-06-13T00:00:00.000Z",
      data: { methodology: "atos-standard",
        objective: "x",
        phases: [
          { id: "mobilise", pct: 100 },
          { id: "build", pct: 30 },
        ],
        // Gates through Design approved → Mobilise is complete and Build is the
        // active, unlocked frontier (normalize expands to the full methodology
        // sequence, so earlier gates must be approved or Build would be locked).
        gateReviews: {
          strategy: { status: "approved" },
          mobilise: { status: "approved" },
          discover: { status: "approved" },
          design: { status: "approved" },
        },
        raidLog: {
          entries: [
            { id: "capacity-gap-mobilise", type: "risk", title: "Team capacity shortfall", severity: "high", phase: "mobilise", status: "open" },
            { id: "capacity-gap-build", type: "risk", title: "Team capacity shortfall", severity: "high", phase: "build", status: "open" },
            // A genuine missed-activity risk in the closed phase — must survive.
            { id: "missed-uat", type: "risk", title: "UAT sign-off skipped in mobilise", severity: "high", phase: "mobilise", status: "open" },
          ],
        },
      },
    });
  }

  it("drops the completed phase's capacity gap but keeps the active one", () => {
    const ids = selectRisks(makeProgram()).map((r) => r.id);
    expect(ids).toContain("capacity-gap-build");
    expect(ids).not.toContain("capacity-gap-mobilise");
  });

  it("keeps genuine non-capacity risks on the completed phase", () => {
    const ids = selectRisks(makeProgram()).map((r) => r.id);
    expect(ids).toContain("missed-uat");
  });

  it("still shows the stale capacity gap when scoped into the completed phase", () => {
    const ids = selectRisks(makeProgram(), { phaseId: "mobilise" }).map((r) => r.id);
    expect(ids).toContain("capacity-gap-mobilise");
  });
});
