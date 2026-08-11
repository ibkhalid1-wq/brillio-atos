/**
 * DEEP VALIDATION — CONCURRENCY (pass 2, section E/C4 of docs/aura/full-validation-2026-08-10.md).
 *
 * Pass 1 exercised each closure path ALONE. This exercises two writers landing on the
 * SAME locus: an operator/stakeholder chip assertion (`asserted`) and a data-dictionary
 * import (`code-derived`), interleaved — both read the pre-state, then both write.
 *
 * THE RULE BEING TESTED (read from the code, not assumed):
 *   `precedence.ts:43`  RANK["to-be"] = [regulation, asserted, document, external-standard,
 *                       precedent, dispositioned, code-derived, generated]
 *                       → `asserted` is rank 1, `code-derived` is rank 6.
 *   `precedence.ts:94-95` same world → lower rank WINS, loserDisposition "history".
 *   `store.ts` assert()  applies that result: the loser gets `supersededBy = <winner id>`
 *                        and is RETAINED (never deleted) — `isLive` = `!supersededBy`.
 * So on a shared `to-be` locus the ASSERTION wins, in EITHER arrival order, and the
 * dictionary claim is kept as non-live history. This is the lattice's answer, not
 * last-writer-wins — which is exactly what the order-independence test below proves.
 *
 * Read-only over the real snapshot; every mutation is on a throwaway migrated store.
 */
import { describe, it, expect } from "vitest";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { reconcile } from "@/v3/lib/ledger/merge";
import { dictionaryToClaims, TYPING_SLOTS, type ParsedDictionary } from "@/v3/lib/ledger/dictionary";
import { buildUnknownQueue, buildKitView, openOwnerQuestions, dictionaryBucket } from "@/v3/lib/ledger/projections";
import { projectKitQuestions } from "@/v3/lib/ledger/kitProjection";
import { resolvePrecedence } from "@/v3/lib/ledger/precedence";
import { isLive } from "@/v3/lib/ledger/types";
import type { LedgerStore } from "@/v3/lib/ledger/store";

// ── the synthetic surgery mirror (a SCRATCH copy — no snapshot file is touched) ──
const surgeryOntology = {
  entities: [
    { name: "Case", area: "Surgical Operations", systemOfRecord: "EHR", attributes: ["status", "priority", "acuity"] },
    { name: "Anesthesia Record", area: "Anesthesiology", systemOfRecord: "EHR", attributes: ["type"] },
    { name: "OR Slot", area: "Surgical Scheduling", attributes: ["state"] },
  ],
  relations: [{ from: "Case", to: "Anesthesia Record", relation: "requires", cardinality: "1:1" }],
};
const surgeryAtlas = {
  workflows: [{
    name: "Case Cancellation Review", area: "Surgical Operations", owner: "Chief of Surgery", trigger: "cancel requested",
    steps: [{ action: "Decide whether to reschedule or cancel the case after payer review", actor: "Surgeon" }],
  }],
};
const surgery = (): Snapshot => ({ ontology: surgeryOntology, atlas: surgeryAtlas, overrides: [] });

const LOCUS = "el:attr:case.status#dataType";

/** The chip answer, exactly as `renderQuestion.test.ts` records it: an attributed assertion. */
const chipAssertion = (store: LedgerStore, value: string) => store.assert({
  about: LOCUS, value: { kind: "scalar", value },
  world: "to-be", layer: "configuration", source: "asserted", ownerWhileOpen: { kind: "role", role: "Surgical Operations" },
  status: "closed", closedBy: { method: "assertion", by: "stakeholder:or-manager", verbatim: value },
});

/** The dictionary import, through the REAL import path (dictionaryToClaims → reconcile). */
const dictImport = (store: LedgerStore, dataType: string) => {
  const dict: ParsedDictionary = { name: "ehr-dict", fields: [{ entity: "Case", field: "status", dataType }] };
  const { batch, elements } = dictionaryToClaims(dict, new Set(store.elements().map((e) => e.id)));
  for (const e of elements) store.addElement(e);
  return { report: reconcile(store, batch, new Set(store.elements().map((e) => e.id))), batch };
};

/**
 * THE CONSERVATION IDENTITY (same shape as `pipelineValidation [E1/E2]` and
 * `inboxReconciliation`): open === owner-queue + dictionary-bucket + role/joint-owned,
 * with zero leaked ids (every open id resolves to a live open claim, and the kit
 * projection is exactly the open set).
 */
function conserve(store: LedgerStore): number {
  const q = buildUnknownQueue(store);
  const open = q.items.filter((i) => i.status === "open");
  const dict = dictionaryBucket(q).length;
  const owner = openOwnerQuestions(q).length;
  const roleOwned = open.filter((i) => !TYPING_SLOTS.has(i.slot) && i.owner.kind === "role").length;
  const joint = open.filter((i) => !TYPING_SLOTS.has(i.slot) && i.owner.kind === "joint").length;
  expect(dict + owner + roleOwned + joint).toBe(open.length);
  // zero leaked ids: every queued id is a LIVE open claim, and kit === queue(open)
  for (const i of open) expect(store.liveClaimsAbout(i.about).some((c) => c.status === "open")).toBe(true);
  expect(new Set(projectKitQuestions(store).map((k) => k.about))).toEqual(new Set(open.map((i) => i.about)));
  return open.length;
}

const liveOn = (store: LedgerStore, about: string) => store.liveClaimsAbout(about);
const allOn = (store: LedgerStore, about: string) => store.claimsAbout(about);

describe("[deep-C1] the precedence rule this race is judged by", () => {
  it("asserted BEATS code-derived on a shared to-be locus, symmetrically, loser kept as history", () => {
    const ab = resolvePrecedence({ source: "asserted", world: "to-be" }, { source: "code-derived", world: "to-be" });
    const ba = resolvePrecedence({ source: "code-derived", world: "to-be" }, { source: "asserted", world: "to-be" });
    expect(ab).toMatchObject({ outcome: "wins", winner: "a", loserDisposition: "history" });
    expect(ba).toMatchObject({ outcome: "wins", winner: "b", loserDisposition: "history" });
    // the winner does not depend on argument order — so it cannot be last-writer-wins
    expect(ab.winner === "a" && ba.winner === "b").toBe(true);
  });
});

describe("[deep-C2] two writers close the SAME question — exactly one closure wins", () => {
  for (const order of ["chip-then-dictionary", "dictionary-then-chip"] as const) {
    it(`${order}: the ASSERTION wins (lattice, not arrival order); the dictionary claim is retained as history`, () => {
      const store = migrate(surgery());

      // ── both writers READ the pre-state first (the interleave) ──
      const preLive = liveOn(store, LOCUS).map((c) => c.id);
      const preOpen = conserve(store);
      const preBurn = buildKitView(store).burnDown;
      const preClaimCount = store.claims().length;
      expect(preLive).toHaveLength(1);                                   // one generated ?unknown
      expect(liveOn(store, LOCUS)[0]).toMatchObject({ source: "generated", status: "open" });

      // ── writer 1 ──
      if (order === "chip-then-dictionary") chipAssertion(store, "picklist"); else dictImport(store, "text");

      // ── MID-RACE: after the first write, before the second ──
      const midOpen = conserve(store);
      expect(midOpen).toBe(preOpen - 1);                                 // one question closed, once
      const midBurn = buildKitView(store).burnDown;
      expect(midBurn.open).toBe(preBurn.open - 1);

      // ── writer 2 (holding the SAME pre-state it read above) ──
      if (order === "chip-then-dictionary") dictImport(store, "text"); else chipAssertion(store, "picklist");

      // ── after ──
      const postOpen = conserve(store);
      expect(postOpen).toBe(preOpen - 1);                                // NO double-decrement
      const postBurn = buildKitView(store).burnDown;
      expect(postBurn.open).toBe(preBurn.open - 1);
      expect(postBurn.closed).toBe(preBurn.closed + 1);                  // exactly ONE real closure

      // exactly one live claim, and it is the assertion
      const live = liveOn(store, LOCUS);
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({ source: "asserted", status: "closed" });
      expect(live[0].closedBy).toMatchObject({ by: "stakeholder:or-manager", verbatim: "picklist" });

      // NO claim silently dropped: both writes are on the record, and the losers point
      // at the winner (write-model: "the loser is retained as history — never deleted").
      const all = allOn(store, LOCUS);
      expect(all).toHaveLength(3);                                       // generated unknown + dict + assertion
      expect(store.claims().length).toBe(preClaimCount + 2);
      const dictClaim = all.find((c) => c.source === "code-derived")!;
      expect(dictClaim).toBeTruthy();
      expect(isLive(dictClaim)).toBe(false);
      expect(dictClaim.supersededBy).toBe(live[0].id);                   // superseded BY the winner
      const generated = all.find((c) => c.source === "generated")!;
      expect(isLive(generated)).toBe(false);
      expect(generated.supersededBy).toBeTruthy();
    });
  }

  it("ORDER-INDEPENDENT: both interleavings converge on byte-identical live state and burn-down", () => {
    const run = (chipFirst: boolean) => {
      const store = migrate(surgery());
      if (chipFirst) { chipAssertion(store, "picklist"); dictImport(store, "text"); }
      else { dictImport(store, "text"); chipAssertion(store, "picklist"); }
      return {
        live: liveOn(store, LOCUS).map((c) => ({ id: c.id, source: c.source, status: c.status })),
        burn: buildKitView(store).burnDown,
        open: buildUnknownQueue(store).items.length,
      };
    };
    expect(run(true)).toEqual(run(false));
  });
});

describe("[deep-C3] the SAME-VALUE race — the case precedence never sees", () => {
  /**
   * When both writers land the SAME value there is no `valueConflicts`, so `store.ts`
   * never calls `resolvePrecedence` and NEITHER claim supersedes the other: both stay
   * live on the locus. The question is still closed exactly once (open −1), but the
   * ledger now carries two live rows for one answer.
   *
   * `docs/aura/ledger-write-model.md` predicts this ("an upgrade with the same value
   * doesn't supersede the generated row ... a redundant row THE PROJECTION HIDES —
   * cosmetic, not a correctness issue"). This test measures whether the projection
   * actually hides it. It does not: `buildKitView` counts every live claim, so
   * `burnDown.total` and `burnDown.weak` both move.
   */
  it("same value from both writers: open −1 (no double-decrement) but TWO live claims survive", () => {
    const store = migrate(surgery());
    const preOpen = conserve(store);
    const preBurn = buildKitView(store).burnDown;
    dictImport(store, "picklist");
    chipAssertion(store, "picklist");                                    // identical value
    const postOpen = conserve(store);
    expect(postOpen).toBe(preOpen - 1);                                  // burn-down did NOT double-decrement
    const live = liveOn(store, LOCUS);
    expect(live.map((c) => c.source).sort()).toEqual(["asserted", "code-derived"]);
    const postBurn = buildKitView(store).burnDown;
    expect(postBurn.open).toBe(preBurn.open - 1);
    expect(postBurn.closed).toBe(preBurn.closed + 1);
    // FINDING (reported, not fixed): the redundant row is NOT hidden — settled count
    // and the denominator both absorb it, so one answer settles two rows.
    expect(postBurn.weak).toBe(preBurn.weak + 1);
    expect(postBurn.total).toBe(preBurn.total + 1);
  });
});

describe("[deep-C4] the race on the Laila-shaped multi-locus batch", () => {
  /** A dictionary import is a BATCH; a chip answer is one locus. The batch must not
   *  disturb any locus the chip already closed, and conservation holds throughout. */
  it("a batch import racing one chip closure: only the shared locus is contested", () => {
    const store = migrate(surgery());
    const preOpen = conserve(store);
    chipAssertion(store, "picklist");
    const mid = conserve(store);
    const nameOf = new Map(store.elements().map((e) => [e.id, e.name] as const));
    const fields = store.elements().filter((e) => e.kind === "attribute" && e.of)
      .map((a) => ({ entity: nameOf.get(a.of!) ?? "", field: a.name, dataType: "text" }));
    const { batch } = dictionaryToClaims({ name: "ehr-dict", fields }, new Set(store.elements().map((e) => e.id)));
    const rep = reconcile(store, batch, new Set(store.elements().map((e) => e.id)));
    const post = conserve(store);
    expect(mid).toBe(preOpen - 1);
    // the batch fills the OTHER dataType unknowns; the contested one stays the assertion
    expect(rep.filledUnknowns).toBeGreaterThan(0);
    expect(post).toBe(mid - rep.filledUnknowns);
    expect(liveOn(store, LOCUS).map((c) => c.source)).toEqual(["asserted"]);
    // and the batch's own claim on the contested locus is on the record, superseded
    const contested = allOn(store, LOCUS).find((c) => c.source === "code-derived");
    expect(contested && isLive(contested)).toBe(false);
  });
});
