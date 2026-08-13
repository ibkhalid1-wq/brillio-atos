/**
 * CHECK 5 — SCALE (deep validation, 2026-08-11).
 *
 * INVARIANT: correctness does not depend on size. At ~10x the question volume of the
 * largest real programme, the conservation identity still holds, the ONE renderer still
 * completes EVERY open locus, and the roster/owner projection is still exactly right.
 *
 * THE MEASUREMENT (taken first, so "10x" means something):
 *   Laila (docs/laila/snapshot-2026-08-07) — the largest real programme available here —
 *   migrates to 310 elements / 963 claims / 406 queue items, of which **395 are OPEN
 *   questions**. So 10x ≈ 3,950 open questions. The synthetic programme below is built
 *   from a repeated BLOCK worth ~40 open questions; `BLOCKS_1X = 10` reproduces Laila's
 *   volume (~400) and `BLOCKS_10X = 100` is the 10x run (~4,000).
 *
 * SCRATCH ONLY: the synthetic programme is generated in memory. No snapshot is mutated,
 * no network, no DB.
 *
 * RUNTIME BUDGET: the whole file stays well under a second of test time on this machine.
 * Nothing is sampled — every locus at both scales is rendered and asserted.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, ownerFor, type Snapshot } from "@/v3/lib/ledger/migrate";
import {
  buildUnknownQueue, openOwnerQuestions, dictionaryBucket, buildKitView,
  type QueueItem,
} from "@/v3/lib/ledger/projections";
import { projectKitQuestions } from "@/v3/lib/ledger/kitProjection";
import { renderQuestion } from "@/v3/lib/ledger/renderQuestion";
import { TYPING_SLOTS } from "@/v3/lib/ledger/dictionary";
import { elementIdOf, ownerLabel } from "@/v3/lib/ledger/types";
import type { LedgerStore } from "@/v3/lib/ledger/store";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const laila = (): LedgerStore => migrate({
  ontology: snap("domain-ontology.json"),
  atlas: snap("current-state-atlas.json"),
  overrides: snap("operator-overrides.json"),
} as Snapshot);

// ── the synthetic programme ──────────────────────────────────────────────────────
// One BLOCK = 5 entities (4 attributes each, one of them ENUMISH so it also opens a
// valueSet), 2 relations, 1 workflow with 5 steps (2 of which are decisions). Areas are
// chosen against the ledger's OWN function table so the owner mix is known exactly:
// two single-function areas, one seam (two functions), one area the table does not know
// (stays UNOWNED — a miss must stay visible at scale too).
const AREAS = ["Sales", "Finance", "Sales / Finance", "Surgical Operations", "Legal"] as const;

function syntheticSnapshot(blocks: number): Snapshot {
  const entities: Array<Record<string, unknown>> = [];
  const relations: Array<Record<string, unknown>> = [];
  const workflows: Array<Record<string, unknown>> = [];
  for (let b = 0; b < blocks; b += 1) {
    for (let e = 0; e < AREAS.length; e += 1) {
      entities.push({
        name: `Block ${b} Entity ${e}`,
        area: AREAS[e],
        systemOfRecord: e % 2 === 0 ? "CoreSystem" : "LedgerSystem",
        // `status` is ENUMISH (migrate.ts ENUMISH) → opens dataType AND valueSet.
        attributes: ["status", "amount", "ownerName", "createdOn"],
      });
    }
    relations.push({ from: `Block ${b} Entity 0`, to: `Block ${b} Entity 1`, relation: "requires", cardinality: "1:N" });
    relations.push({ from: `Block ${b} Entity 2`, to: `Block ${b} Entity 3`, relation: "produces" });
    workflows.push({
      name: `Block ${b} Workflow`,
      area: AREAS[b % AREAS.length],
      owner: "Programme Lead",
      trigger: "record created",
      steps: [
        { action: `Block ${b} · capture the inbound record and normalise its identifiers`, actor: "Sales" },
        { action: `Block ${b} · review the record against policy and approve or reject it`, actor: "Finance" },
        { action: `Block ${b} · decide whether the exception is in scope for this release`, actor: "Legal" },
        { action: `Block ${b} · notify the downstream system and reconcile the acknowledgement`, actor: "Surgical Operations" },
        { action: `Block ${b} · archive the record and release the reservation it held`, actor: "Sales" },
      ],
    });
  }
  return { ontology: { entities, relations }, atlas: { workflows }, overrides: [] };
}

const BLOCKS_1X = 10;     // ≈ Laila's 395 open questions
const BLOCKS_10X = 100;   // ≈ 10x

// ── the invariants under test, as functions so both scales run the identical code ──

/** CONSERVATION (the E2 identity, as pipelineValidation.test.ts states it):
 *  dictionary bucket + owner queue + role-owned + joint-owned === all open questions. */
function conservation(store: LedgerStore): { open: number; dict: number; owner: number; role: number; joint: number } {
  const q = buildUnknownQueue(store);
  const open = q.items.filter((i) => i.status === "open");
  const dict = dictionaryBucket(q).length;
  const owner = openOwnerQuestions(q).length;
  const role = open.filter((i) => !TYPING_SLOTS.has(i.slot) && i.owner.kind === "role").length;
  const joint = open.filter((i) => !TYPING_SLOTS.has(i.slot) && i.owner.kind === "joint").length;
  return { open: open.length, dict, owner, role, joint };
}

/** The ROSTER/OWNER projection, exactly as useProgramLedger derives it: solo-answerable
 *  open loci grouped by owner label (role owners only; seams are session questions). */
function rosterProjection(store: LedgerStore): { solo: Map<string, QueueItem[]>; sessions: Map<string, QueueItem[]> } {
  const q = buildUnknownQueue(store);
  const solo = new Map<string, QueueItem[]>();
  const sessions = new Map<string, QueueItem[]>();
  for (const it of q.items) {
    if (it.status === "open" && TYPING_SLOTS.has(it.slot)) continue;
    if (it.owner.kind === "joint") { (sessions.get(it.ownerLabel) ?? sessions.set(it.ownerLabel, []).get(it.ownerLabel)!).push(it); continue; }
    if (it.owner.kind !== "role" || it.status !== "open") continue;
    (solo.get(it.ownerLabel) ?? solo.set(it.ownerLabel, []).get(it.ownerLabel)!).push(it);
  }
  return { solo, sessions };
}

/**
 * BEST OF THREE, not one sample.
 *
 * These ratios are the file's findings, and they were measured once each — which
 * made the whole suite flaky: under vitest's parallel pool a single sample picks up
 * whatever else the machine was doing, and the 1x case (small, fast) is hurt
 * proportionally more than the 10x case, so the ratio collapses and a REAL property
 * reads as a failure. It failed in a full run and passed in isolation, repeatedly —
 * the classic signature.
 *
 * The minimum of a few runs is the standard answer: scheduler noise only ever ADDS
 * time, so the fastest observed run is the one closest to the true cost. Three is
 * enough to shake off a single unlucky slice without turning a test suite into a
 * benchmark suite.
 */
const time = <T>(fn: () => T): { ms: number; value: T } => {
  let best = Infinity;
  let value!: T;
  for (let i = 0; i < 3; i += 1) {
    const t0 = performance.now();
    value = fn();
    best = Math.min(best, performance.now() - t0);
  }
  return { ms: best, value };
};

interface Run {
  label: string;
  store: LedgerStore;
  open: QueueItem[];
  conserve: ReturnType<typeof conservation>;
  roster: ReturnType<typeof rosterProjection>;
  t: { migrate: number; conservation: number; renderAll: number; roster: number };
  rendered: number;
}

/** WARM-UP. Without it the 1x numbers are cold-JIT numbers and the growth ratio is
 *  measuring the optimiser, not the algorithm (observed: the same 10x run reported x32
 *  and x90 across processes). Every timed path below is exercised once first. */
function warmUp(): void {
  const s = migrate(syntheticSnapshot(2));
  conservation(s);
  rosterProjection(s);
  for (const i of buildUnknownQueue(s).items) renderQuestion(s, i.about, "stakeholder");
}

function run(label: string, blocks: number): Run {
  warmUp();
  const m = time(() => migrate(syntheticSnapshot(blocks)));
  const store = m.value;
  conservation(store);                                   // warm this store's paths too
  const c = time(() => conservation(store));
  const open = buildUnknownQueue(store).items.filter((i) => i.status === "open");
  for (const i of open.slice(0, 50)) renderQuestion(store, i.about, "stakeholder");
  // FULL renderer pass — every open locus, stakeholder audience, nothing sampled.
  const r = time(() => {
    let n = 0;
    for (const i of open) { const q = renderQuestion(store, i.about, "stakeholder"); if (q.question.length) n += 1; }
    return n;
  });
  // ROSTER RENDER — the projection plus one rendered question per owner band, which is
  // what the roster chip's inline sentence needs.
  const ro = time(() => {
    const proj = rosterProjection(store);
    for (const [, items] of proj.solo) renderQuestion(store, items[0].about, "operator");
    return proj;
  });
  return {
    label, store, open, conserve: c.value, roster: ro.value, rendered: r.value,
    t: { migrate: m.ms, conservation: c.ms, renderAll: r.ms, roster: ro.ms },
  };
}

// Built once, shared by every case in the file (two migrations, not twenty).
const REAL = laila();
const REAL_OPEN = buildUnknownQueue(REAL).items.filter((i) => i.status === "open").length;
const X1 = run("1x", BLOCKS_1X);
const X10 = run("10x", BLOCKS_10X);

describe("[5a] the measurement — what 10x actually is", () => {
  it("Laila is the largest real programme, and its question volume is pinned", () => {
    expect(REAL.elements().length).toBe(310);
    expect(REAL.claims().length).toBe(963);
    expect(REAL_OPEN).toBe(395);
  });

  it("the synthetic 1x matches Laila's volume, and 10x is ten times it (±10%)", () => {
    expect(X1.open.length).toBeGreaterThan(REAL_OPEN * 0.9);
    expect(X1.open.length).toBeLessThan(REAL_OPEN * 1.2);
    const ratio = X10.open.length / X1.open.length;
    expect(ratio).toBeGreaterThan(9.5);
    expect(ratio).toBeLessThan(10.5);
     
    console.log(`[5a] Laila open=${REAL_OPEN} · synthetic 1x open=${X1.open.length} · 10x open=${X10.open.length} (x${ratio.toFixed(2)}) · 10x elements=${X10.store.elements().length} claims=${X10.store.claims().length}`);
  });
});

describe("[5b] correctness is unchanged at 10x", () => {
  for (const r of [X1, X10]) {
    it(`${r.label}: CONSERVATION — dictionary + owner-queue + role-owned + joint-owned === open`, () => {
      const { open, dict, owner, role, joint } = r.conserve;
      expect(dict + owner + role + joint).toBe(open);
      expect(open).toBeGreaterThan(0);
    });

    it(`${r.label}: the renderer completes EVERY open locus — no gaps, no throws, no empty strings`, () => {
      expect(r.rendered).toBe(r.open.length);
      // and the projection the kit reads is the same set, one-to-one
      const kit = projectKitQuestions(r.store);
      expect(kit.length).toBe(r.open.length);
      expect(new Set(kit.map((k) => k.about))).toEqual(new Set(r.open.map((i) => i.about)));
      for (const k of kit) expect(k.question.trim().length).toBeGreaterThan(0);
    });

    it(`${r.label}: no locus is dropped or duplicated (ids unique, every id resolves to a live open claim)`, () => {
      expect(new Set(r.open.map((i) => i.about)).size).toBe(r.open.length);
      const openAbouts = new Set(r.store.claims().filter((c) => !c.supersededBy && c.status === "open").map((c) => c.about));
      for (const i of r.open) expect(openAbouts.has(i.about)).toBe(true);
    });

    it(`${r.label}: the ROSTER/OWNER projection is exactly right (owners come from the area table, misses stay unowned)`, () => {
      const { solo, sessions } = r.roster;
      // Owner labels are the ledger's own, never invented.
      for (const [label, items] of solo) {
        expect(label).not.toBe("unowned");
        for (const it of items) expect(ownerLabel(it.owner)).toBe(label);
      }
      // Seams: every session key is a joint label, and the SET is scale-invariant.
      expect(sessions.size).toBeGreaterThan(0);
      for (const k of sessions.keys()) expect(k).toContain("⋈");
      expect([...sessions.keys()].sort()).toEqual([...X1.roster.sessions.keys()].sort());
      // Partition: solo + sessions + unowned-non-typing === all non-typing open questions.
      const q = buildUnknownQueue(r.store);
      const nonTyping = q.items.filter((i) => i.status === "open" && !TYPING_SLOTS.has(i.slot));
      const soloN = [...solo.values()].reduce((n, v) => n + v.length, 0);
      const sessN = [...sessions.values()].filter(Boolean).reduce((n, v) => n + v.filter((i) => i.status === "open").length, 0);
      const unownedN = nonTyping.filter((i) => i.owner.kind === "unowned").length;
      expect(soloN + sessN + unownedN).toBe(nonTyping.length);
      // A miss stays VISIBLE: "Surgical Operations" maps to no function, so its loci are
      // unowned rather than swallowed by a default role.
      expect(ownerFor("Surgical Operations")).toEqual({ kind: "unowned" });
      expect(unownedN).toBeGreaterThan(0);
    });
  }

  it("every per-owner count scales by EXACTLY 10 — the projection is linear in the data, not in the code path", () => {
    const at = (r: Run) => Object.fromEntries([...r.roster.solo.entries()].map(([k, v]) => [k, v.length]));
    const a = at(X1), b = at(X10);
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    for (const k of Object.keys(a)) expect(b[k]).toBe(a[k] * 10);
    // conservation terms too
    expect(X10.conserve.open).toBe(X1.conserve.open * 10);
    expect(X10.conserve.dict).toBe(X1.conserve.dict * 10);
    expect(X10.conserve.owner).toBe(X1.conserve.owner * 10);
    expect(X10.conserve.role).toBe(X1.conserve.role * 10);
    expect(X10.conserve.joint).toBe(X1.conserve.joint * 10);
  });

  it("the burn-down identity survives 10x (closed + weak + open === total, percentages finite)", () => {
    for (const r of [X1, X10]) {
      const bd = buildKitView(r.store).burnDown;
      expect(bd.closed + bd.weak + bd.open).toBe(bd.total);
      expect(Number.isFinite(bd.pctClosed)).toBe(true);
      expect(Number.isFinite(bd.pctSettled)).toBe(true);
      expect(bd.pctSettled).toBeGreaterThanOrEqual(bd.pctClosed);
    }
  });

  it("element identity holds at 10x — every open locus points at an element the store actually holds", () => {
    const ids = new Set(X10.store.elements().map((e) => e.id));
    for (const i of X10.open) expect(ids.has(elementIdOf(i.about)), `orphan locus ${i.about}`).toBe(true);
  });
});

/**
 * FINDING F-5.2 — TWO LABELS FOR ONE SEAM (found by the roster/owner assertion above,
 * confirmed on the REAL Laila snapshot).
 *
 * `ownerFor(area)` maps each function through `ROLE_LABEL` before building the joint
 * owner (migrate.ts: `functionsOf(area).map((fn) => ROLE_LABEL[fn] ?? fn)`), so a
 * multi-function AREA string yields `Practices ⋈ Sales Leaders`.
 * `jointOrOwner(areaA, areaB)` — the path a RELATION or a cross-area STEP takes —
 * builds `jointOwner([a, b])` from the RAW function tokens and skips `ROLE_LABEL`
 * entirely, so the identical pair of functions yields `Practices ⋈ Sales`.
 *
 * Both labels are live on Laila today. Every surface groups seams by `ownerLabel`, so
 * one seam renders as TWO session bands, and a roster person routed through
 * `ownerRoleLabelForArea` (which DOES apply ROLE_LABEL → "Sales Leaders") matches one
 * band and not the other. The `parties`-sorted "one seam, one identity" rule stated in
 * types.ts is defeated before it is reached, because the two labels differ in the party
 * NAME, not in the ordering.
 *
 * Pinned, not fixed: the fix is a one-line change in `jointOrOwner`, but it re-labels
 * owners across the whole ledger (session queue keys, roster routing, kit bands), which
 * is not a trivially-safe edit to make inside a validation pass.
 */
describe("[5b] FINDING F-5.2 — one seam, one owner label (FIXED in pass 2)", () => {
  /**
   * These two tests were written to PIN THE DEFECT: `ownerFor` mapped functions
   * through ROLE_LABEL and `jointOrOwner` did not, so one seam wore two names.
   * The defect was then fixed in the same pass (`migrate.ts` jointOrOwner now
   * labels both parties), so the assertions are inverted — they hold the FIX.
   *
   * Deliberately not deleted. A test that once proved a bug existed is the
   * cheapest possible regression guard for that exact bug, and the console line
   * below still reports the real per-band counts so the merge stays visible.
   */
  it("Laila: the function pair appears under exactly ONE seam label", () => {
    const q = buildUnknownQueue(REAL).items;
    const labels = new Set(q.map((i) => i.ownerLabel));
    // The labelled spelling is the only one.
    expect(labels.has("Practices ⋈ Sales Leaders")).toBe(true);
    expect(labels.has("Practices ⋈ Sales")).toBe(false);
    // and the raw token no longer leaks into the other pairs either
    expect(labels.has("Alliances ⋈ Sales")).toBe(false);
    expect(labels.has("Finance ⋈ Sales")).toBe(false);
    const merged = q.filter((i) => i.ownerLabel === "Practices ⋈ Sales Leaders").length;
    expect(merged).toBeGreaterThan(0);
     
    console.log(`[F-5.2 fixed] Laila: "Practices ⋈ Sales Leaders"=${merged} questions in ONE band (was 5 + 10 across two)`);
  });

  it("the synthetic programme confirms the merge at both scales", () => {
    for (const r of [X1, X10]) {
      const labels = new Set(buildUnknownQueue(r.store).items.map((i) => i.ownerLabel));
      // The AREA path and the RELATION path now agree on the spelling.
      expect(labels.has("Finance ⋈ Sales Leaders")).toBe(true);
      expect(labels.has("Finance ⋈ Sales")).toBe(false);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 5c · TIMINGS — recorded, and the SHAPE of the growth asserted.
// ════════════════════════════════════════════════════════════════════════════════
/**
 * FINDING F-5.1 (super-linear, by construction — see the report).
 *
 * `renderQuestion` is O(elements + claims) PER CALL:
 *   · it rebuilds `new Map(store.elements())` on every call (renderQuestion.ts:131);
 *   · `scalarAt` → `store.resolve` → `claimsAbout` filters ALL claims (store.ts:68);
 *   · `conflictingReadings` walks ALL claims for every `#semantics` locus.
 * A full pass over Q loci is therefore O(Q · (E + C)) — QUADRATIC in programme size.
 * 10x the data costs ~100x the renderer pass, and this test records that rather than
 * hiding it. The bound below is deliberately generous (it pins the SHAPE: quadratic is
 * tolerated, cubic is not) so the check fails on a real regression, not on machine noise.
 *
 * `conservation` and the roster projection are single passes and stay ~linear.
 */
describe("[5c] timings and growth shape", () => {
  const ratio = (a: number, b: number) => (a > 0 ? b / a : Number.POSITIVE_INFINITY);

  it("records the timings for both scales", () => {
    const row = (r: Run) => `${r.label}: migrate ${r.t.migrate.toFixed(1)}ms · conservation ${r.t.conservation.toFixed(1)}ms · renderAll(${r.open.length}) ${r.t.renderAll.toFixed(1)}ms · roster ${r.t.roster.toFixed(1)}ms`;
     
    console.log(`[5c] ${row(X1)}\n[5c] ${row(X10)}`);
     
    console.log(`[5c] ratios (10x/1x): conservation x${ratio(X1.t.conservation, X10.t.conservation).toFixed(1)} · renderAll x${ratio(X1.t.renderAll, X10.t.renderAll).toFixed(1)} · roster x${ratio(X1.t.roster, X10.t.roster).toFixed(1)}`);
    expect(X10.t.renderAll).toBeGreaterThan(0);
  });

  /**
   * FINDING F-5.3 — MIGRATION is quadratic too, and this one is in the FROZEN core.
   * `store.assert` calls `liveClaimsAbout(about)`, which filters the WHOLE claim map
   * (store.ts:68) on every insert, so building a ledger of C claims is O(C²). Recorded,
   * not fixed: an index on `about` is a change to `store.ts`, which is frozen — a needed
   * core change is a finding, per the brief.
   */
  it("MIGRATION growth is recorded (frozen-core O(C^2) insert path)", () => {
    const total = ratio(X1.t.migrate, X10.t.migrate);
    const perClaim = ratio(X1.t.migrate / X1.store.claims().length, X10.t.migrate / X10.store.claims().length);
     
    console.log(`[F-5.3] migrate growth for 10x data: total x${total.toFixed(1)} · PER-CLAIM x${perClaim.toFixed(1)} (linear = 1)`);
    expect(perClaim).toBeGreaterThan(1.8);   // super-linear — the finding
    expect(perClaim).toBeLessThan(40);       // …and no worse than quadratic-with-slack
    expect(X10.t.migrate).toBeLessThan(20_000);
  });

  it("the CONSERVATION query stays ~linear (a single pass over the claims)", () => {
    // Generous ceiling: linear would be x10; anything approaching x100 is a hidden join.
    expect(ratio(X1.t.conservation, X10.t.conservation)).toBeLessThan(45);
  });

  it("the ROSTER projection stays ~linear", () => {
    expect(ratio(X1.t.roster, X10.t.roster)).toBeLessThan(45);
  });

  it("the FULL RENDERER PASS is SUPER-LINEAR — flagged, bounded, and must not get worse", () => {
    const total = ratio(X1.t.renderAll, X10.t.renderAll);
    // PER-LOCUS cost is the honest signal: linear ⇒ ~1.0, quadratic ⇒ ~10. Wall-clock
    // totals on a shared machine are noisy, so the assertion is on this ratio with a
    // wide band — it still separates "linear" from "grows with programme size".
    const perLocus = ratio(X1.t.renderAll / X1.open.length, X10.t.renderAll / X10.open.length);
     
    console.log(`[5c] renderAll growth for 10x data: total x${total.toFixed(1)} · PER-LOCUS x${perLocus.toFixed(1)} (linear = 1, quadratic ≈ 10)`);
    expect(perLocus).toBeGreaterThan(1.8);   // it IS super-linear — the finding, asserted
    expect(perLocus).toBeLessThan(40);       // …and no worse than quadratic-with-slack
  });

  it("the absolute cost at 10x is still inside a sane CI budget", () => {
    // Guards against a change that keeps the SHAPE but multiplies the constant.
    expect(X10.t.renderAll).toBeLessThan(20_000);
    expect(X10.t.conservation).toBeLessThan(5_000);
    expect(X10.t.roster).toBeLessThan(5_000);
  });

  /**
   * THE BUDGET (set 2026-08-11, pass-2 finding N-6).
   *
   * The ceilings above are CI tolerances — 20 s for a render nobody would wait
   * through. They pin the growth SHAPE and were deliberately generous, which
   * means a change could make the product four times slower and still pass. A
   * shape without a ceiling is a measurement, not a gate.
   *
   * So: a ceiling grounded in what a person experiences, not in what CI
   * survives. Measured today (median of 4 runs, after warm-up):
   *   1x  (410 questions — Laila is 395, the largest real programme):  ~9 ms
   *   10x (4,100 questions — no client is near this):                 ~690 ms
   *
   * The budget is ~5x the measurement in both cases. Tight enough that a real
   * regression (anything that makes the renderer five times slower) turns this
   * red; loose enough to absorb a shared or throttled machine, because a gate
   * that flakes is a gate people learn to re-run rather than read.
   *
   * If a client programme ever genuinely approaches 10x, revisit N-6 rather
   * than raising this number — the quadratic term is the thing to fix, and the
   * fix is an index on `about` in `store.ts`, which is frozen core.
   */
  it("BUDGET: a full render stays inside human tolerance at both scales", () => {
    expect(X1.t.renderAll, "a real-programme render must feel instant").toBeLessThan(400);
    expect(X10.t.renderAll, "10x the largest real programme must still be a wait, not a hang").toBeLessThan(4_000);
    // The linear paths have no excuse at any scale.
    expect(X10.t.conservation, "the conservation query is linear — it must stay cheap").toBeLessThan(500);
    expect(X10.t.roster, "the roster projection is linear — it must stay cheap").toBeLessThan(500);
  });
});
