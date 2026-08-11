/**
 * DEEP VALIDATION — IDEMPOTENCY (pass 2, section C3/C4 of docs/aura/full-validation-2026-08-10.md).
 *
 * Pass 1 proved a dictionary import closes the typing wall ONCE. This runs the SAME
 * import twice against the same store, and then a NEAR-identical import (one row
 * changed), and asks what evidence the caller gets back.
 *
 * The mechanism under test is `store.ts` assert():
 *   `const id = contentId("cl", about, world, source, JSON.stringify(value));`
 *   `if (existing) return existing;  // identical claim → corroboration, one row`
 * so a byte-identical re-import is a content-addressed no-op by construction. What
 * this file measures is whether that no-op is (a) actually observable in the burn-down
 * and the claim set, and (b) REPORTED, rather than silently swallowed.
 *
 * Read-only over the real snapshot; every mutation is on a throwaway migrated store.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { reconcile, type MergeReport } from "@/v3/lib/ledger/merge";
import { parseDictionaryCsv, dictionaryToClaims, type ParsedDictionary } from "@/v3/lib/ledger/dictionary";
import { buildKitView, buildDeviationRegister, buildUnknownQueue } from "@/v3/lib/ledger/projections";
import { isLive, aboutOf } from "@/v3/lib/ledger/types";
import type { LedgerStore } from "@/v3/lib/ledger/store";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const lailaSnapshot = (): Snapshot => ({ ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") });

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

const DICT_CSV = [
  "Entity,Field,Type,Values,Required",
  "Case,status,picklist,scheduled|in-theatre|cancelled,yes",
  "Case,priority,text,,no",
  "Anesthesia Record,type,picklist,general|regional,yes",
].join("\n");

const applyDict = (store: LedgerStore, dict: ParsedDictionary): MergeReport => {
  const { batch, elements } = dictionaryToClaims(dict, new Set(store.elements().map((e) => e.id)));
  for (const e of elements) store.addElement(e);
  return reconcile(store, batch, new Set(store.elements().map((e) => e.id)));
};

/** A full fingerprint of the store — ids AND their resolved state. Idempotency means
 *  this is byte-identical before and after a repeat run. */
const fingerprint = (store: LedgerStore) => JSON.stringify(
  store.claims()
    .map((c) => [c.id, c.about, c.source, c.status, c.supersededBy ?? "", JSON.stringify(c.value)])
    .sort((a, b) => a[0].localeCompare(b[0])),
);

describe("[deep-I1] the SAME dictionary import, run twice", () => {
  it("run 2 is a NO-OP: identical claim set, identical ids, identical burn-down", () => {
    const store = migrate(surgery());
    const dict = parseDictionaryCsv(DICT_CSV, "ehr-dict");

    const first = applyDict(store, dict);
    const afterFirst = { fp: fingerprint(store), burn: buildKitView(store).burnDown, n: store.claims().length };
    expect(first.filledUnknowns).toBeGreaterThan(0);                 // run 1 really moved the wall

    applyDict(store, dict);
    const afterSecond = { fp: fingerprint(store), burn: buildKitView(store).burnDown, n: store.claims().length };

    expect(afterSecond.n).toBe(afterFirst.n);                        // no duplicate claims
    expect(afterSecond.fp).toBe(afterFirst.fp);                      // ids CONTENT-STABLE (leans on C4)
    expect(afterSecond.burn).toEqual(afterFirst.burn);               // burn-down did NOT move a second time
  });

  it("EVIDENCE that it was a repeat: every change counter is zero while `applied` still counts the batch", () => {
    const store = migrate(surgery());
    const dict = parseDictionaryCsv(DICT_CSV, "ehr-dict");
    const first = applyDict(store, dict);
    const second = applyDict(store, dict);

    expect(second.applied).toBe(first.applied);                      // the same rows were processed
    expect(second.newClaims).toBe(0);
    expect(second.filledUnknowns).toBe(0);
    expect(second.preservedClosures).toBe(0);
    expect(second.supersededGenerated).toBe(0);
    expect(second.orphanedClosures).toEqual(first.orphanedClosures);
    // The repeat is therefore DERIVABLE — `applied > 0` with every change counter 0 —
    // but it is never STATED: `MergeReport` has no `corroborated` / `unchanged` field,
    // and `MergeOutcome`'s "corroborate" case is defined in mergeDecision() and never
    // recorded by reconcile(). Reported as a finding, not patched.
    expect(Object.keys(second)).not.toContain("corroborated");
    expect(Object.keys(second)).not.toContain("unchanged");
    expect(second.applied - (second.newClaims + second.filledUnknowns + second.preservedClosures)).toBe(second.applied);
  });

  it("three runs is the same as two: convergence, not drift", () => {
    const store = migrate(surgery());
    const dict = parseDictionaryCsv(DICT_CSV, "ehr-dict");
    applyDict(store, dict);
    const fp2 = (applyDict(store, dict), fingerprint(store));
    const fp3 = (applyDict(store, dict), fingerprint(store));
    expect(fp3).toBe(fp2);
  });

  it("at Laila scale the repeat is still a no-op (the full typing wall, ~200 rows)", () => {
    const store = migrate(lailaSnapshot());
    const nameOf = new Map(store.elements().map((e) => [e.id, e.name] as const));
    const fields = store.elements().filter((e) => e.kind === "attribute" && e.of)
      .map((a) => ({ entity: nameOf.get(a.of!) ?? "", field: a.name, dataType: "text" }));
    const dict: ParsedDictionary = { name: "sf-dict", fields };
    const first = applyDict(store, dict);
    expect(first.filledUnknowns).toBeGreaterThan(100);
    const fp = fingerprint(store);
    const second = applyDict(store, dict);
    expect(fingerprint(store)).toBe(fp);
    expect(second.filledUnknowns + second.newClaims).toBe(0);
  });
});

describe("[deep-I2] a NEAR-identical import — one row changed", () => {
  const CHANGED_CSV = DICT_CSV.replace("Case,priority,text,,no", "Case,priority,number,,no");
  const PRIORITY = aboutOf("el:attr:case.priority", "dataType");

  it("only the changed row moves anything — every other locus is byte-identical", () => {
    const store = migrate(surgery());
    applyDict(store, parseDictionaryCsv(DICT_CSV, "ehr-dict"));
    const state = (c: { status: string; supersededBy?: string; contradicts?: string[] }) =>
      JSON.stringify([c.status, c.supersededBy ?? "", (c.contradicts ?? []).slice().sort()]);
    const before = new Map(store.claims().map((c) => [c.id, state(c)] as const));

    applyDict(store, parseDictionaryCsv(CHANGED_CSV, "ehr-dict"));

    const added = store.claims().filter((c) => !before.has(c.id));
    expect(added).toHaveLength(1);                                   // exactly one new claim
    expect(added[0].about).toBe(PRIORITY);
    expect(added[0]).toMatchObject({ source: "code-derived", value: { kind: "scalar", value: "number" } });
    // the ONLY pre-existing claim whose state moved is the one on the changed locus
    const moved = store.claims().filter((c) => before.has(c.id) && before.get(c.id) !== state(c));
    expect(moved.map((c) => c.about)).toEqual([PRIORITY]);
  });

  it("N-4 RESOLVED: the corrected row SUPERSEDES the stale one — ONE live code-derived claim", () => {
    /**
     * WAS a finding: `precedence.ts:100` coexists two equal-strength machine sources, and
     * `merge.ts`'s recency rule covered `generated` vs `generated` only, so a re-uploaded
     * dictionary that CORRECTED a type left the old value live beside the new one — while
     * `writeDictionaryField`'s own test promised "re-uploading for a system REPLACES its
     * dictionary". The FIELD replaced; the LEDGER accumulated.
     *
     * DECIDED and implemented (merge.ts `recencySupersedes`): a later `code-derived` claim
     * from the SAME import provenance on the SAME locus is a CORRECTION, so it supersedes.
     * The stale row is kept as history (`supersededBy`), never deleted. A DIFFERENT
     * system's disagreement still coexists — proved in ledgerMergeProvenance.test.ts.
     */
    const store = migrate(surgery());
    applyDict(store, parseDictionaryCsv(DICT_CSV, "ehr-dict"));
    const burnBefore = buildKitView(store).burnDown;
    const stale = store.liveClaimsAbout(PRIORITY).find((c) => c.source === "code-derived")!;
    const rep = applyDict(store, parseDictionaryCsv(CHANGED_CSV, "ehr-dict"));

    const live = store.liveClaimsAbout(PRIORITY).filter(isLive);
    expect(live).toHaveLength(1);
    expect(live.map((c) => (c.value as { value: string }).value)).toEqual(["number"]);
    expect(rep.correctedReimports).toBe(1);
    // the stale row is HISTORY, not deleted, and points at the row that corrected it
    const staleNow = store.claimsAbout(PRIORITY).find((c) => c.id === stale.id)!;
    expect(staleNow.supersededBy).toBe(live[0].id);
    // it is NOT a contradiction any more
    expect(store.resolve(PRIORITY).conflicts).toEqual([]);
    // and the burn-down does NOT inflate: one answer, corrected, still one row counted
    const burnAfter = buildKitView(store).burnDown;
    expect(burnAfter).toEqual(burnBefore);
  });

  it("the unchanged rows are NOT re-litigated: no contradiction appears anywhere", () => {
    const store = migrate(surgery());
    applyDict(store, parseDictionaryCsv(DICT_CSV, "ehr-dict"));
    applyDict(store, parseDictionaryCsv(CHANGED_CSV, "ehr-dict"));
    expect(store.allConflicts().map((c) => c.about)).toEqual([]);   // N-4: the correction is not a conflict
    // and the queue is unmoved — a corrected type is not a new question
    expect(buildUnknownQueue(store).items.filter((i) => i.about === PRIORITY)).toEqual([]);
  });
});

describe("[deep-I3] what the report can now tell you", () => {
  /**
   * WAS a dead branch (N-11): `MergeReport.deviations` could never be non-zero —
   * `liveBefore` was filtered to `c.world === input.world` and then asked whether it
   * contained an `as-is` claim while `input.world === "to-be"`. Unsatisfiable. A real
   * cross-world deviation was registered by `buildDeviationRegister` and reported 0 by
   * the merge that created it.
   *
   * FIXED, not deleted: `reconcile` now compares the asserted claim against the live
   * claims of the OTHER world using the same predicate `buildDeviationRegister` uses, so
   * the two numbers agree instead of contradicting each other.
   */
  it("a genuine as-is/to-be deviation is registered by the projection AND reported by reconcile", () => {
    const store = migrate(surgery());
    const about = aboutOf("el:attr:case.priority", "dataType");
    // an as-is system export (adapters.ts shape) says the current field is a string
    store.assert({
      about, value: { kind: "scalar", value: "string" }, world: "as-is", layer: "configuration",
      source: "code-derived", ownerWhileOpen: { kind: "role", role: "System Owner" },
      status: "closed", closedBy: { method: "import", by: "ehr-metadata-export" },
    });
    const devBefore = buildDeviationRegister(store).filter((d) => d.about === about);
    expect(devBefore).toHaveLength(0);                               // nothing to deviate from yet

    const rep = applyDict(store, parseDictionaryCsv(DICT_CSV, "ehr-dict")); // to-be "text"

    const devAfter = buildDeviationRegister(store).filter((d) => d.about === about);
    expect(devAfter).toHaveLength(1);                                // the projection SEES the deviation
    expect(devAfter[0]).toMatchObject({ asIs: "string", toBe: "text" });
    expect(rep.deviations).toBe(1);                                  // and so does the merge report
    expect(rep.deviations).toBe(devAfter.length);                    // ONE number, two readers
  });

  it("no cross-world claim on the locus ⇒ deviations stays 0 (the number MOVES, both ways)", () => {
    const store = migrate(surgery());
    const rep = applyDict(store, parseDictionaryCsv(DICT_CSV, "ehr-dict")); // to-be only; nothing as-is
    expect(rep.deviations).toBe(0);
    expect(buildDeviationRegister(store)).toEqual([]);
  });
});
