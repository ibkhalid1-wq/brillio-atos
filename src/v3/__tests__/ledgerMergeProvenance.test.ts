/**
 * The three merge decisions resolved on 2026-08-11 — N-4, N-5, N-11 of
 * docs/aura/full-validation-pass2-2026-08-11.md. Each `it` below is written so that
 * reverting the ONE line in `merge.ts` that implements it turns exactly this assertion
 * red; the mutation-proof result is recorded in the session report.
 *
 *  N-4  a corrected dictionary re-upload must CORRECT, not contradict.
 *  N-5  two writers landing the SAME value are one answer, not two.
 *  N-11 `MergeReport.deviations` must be a number that can move.
 *
 * Everything runs against the real store + the real dictionary emitter on a scratch
 * synthetic snapshot. No snapshot file is read or written.
 */
import { describe, it, expect } from "vitest";
import { createLedgerStore, type AssertInput, type LedgerStore } from "@/v3/lib/ledger/store";
import { reconcile, mergeDecision, importProvenance } from "@/v3/lib/ledger/merge";
import { dictionaryToClaims, dictionaryProvenance, parseDictionaryCsv, type ParsedDictionary } from "@/v3/lib/ledger/dictionary";
import { buildKitView, buildDeviationRegister } from "@/v3/lib/ledger/projections";
import { aboutOf, isLive, type Claim, type ClaimValue, type Owner } from "@/v3/lib/ledger/types";

const OWNER: Owner = { kind: "role", role: "System Owner" };
const ATTR = "el:attr:case.priority";
const TYPE = aboutOf(ATTR, "dataType");
const sc = (v: string): ClaimValue => ({ kind: "scalar", value: v });

/** A store holding just the one attribute element, with its dataType born `?unknown`. */
const bare = (): LedgerStore => {
  const store = createLedgerStore();
  store.addElement({ id: "el:entity:case", kind: "entity", name: "Case" });
  store.addElement({ id: ATTR, kind: "attribute", name: "priority", of: "el:entity:case" });
  store.assert({ about: TYPE, value: { kind: "unknown" }, world: "to-be", layer: "configuration", source: "generated", ownerWhileOpen: OWNER, status: "open" });
  return store;
};

/** A one-row dictionary naming `system` as its provenance, stating `type` for the field. */
const dict = (system: string, type: string): ParsedDictionary =>
  parseDictionaryCsv(["Entity,Field,Type", `Case,priority,${type}`].join("\n"), system);

const applyDict = (store: LedgerStore, d: ParsedDictionary) => {
  const { batch, elements } = dictionaryToClaims(d, new Set(store.elements().map((e) => e.id)));
  for (const e of elements) store.addElement(e);
  return reconcile(store, batch, new Set(store.elements().map((e) => e.id)));
};

const liveTypes = (store: LedgerStore): string[] =>
  store.liveClaimsAbout(TYPE).filter(isLive).map((c) => String((c.value as { value: unknown }).value)).sort();

const claimStub = (over: Partial<Claim>): Claim => ({
  id: "x", about: TYPE, value: sc("text"), world: "to-be", layer: "configuration",
  source: "code-derived", status: "weak", ownerWhileOpen: OWNER, ...over,
});

// ══ N-4 ══════════════════════════════════════════════════════════════════════════
describe("[N-4] a corrected dictionary re-upload CORRECTS, it does not contradict", () => {
  it("the SAME dictionary re-uploaded with a fixed type leaves exactly ONE live claim", () => {
    const store = bare();
    applyDict(store, dict("ehr-dict", "text"));
    expect(liveTypes(store)).toEqual(["text"]);

    const rep = applyDict(store, dict("ehr-dict", "number")); // the operator fixes the typo

    expect(liveTypes(store)).toEqual(["number"]);             // ONE definition per number
    expect(rep.correctedReimports).toBe(1);
  });

  it("the corrected-away row is kept as HISTORY pointing at its correction — nothing is deleted", () => {
    const store = bare();
    applyDict(store, dict("ehr-dict", "text"));
    const stale = store.liveClaimsAbout(TYPE).find((c) => c.source === "code-derived")!;
    applyDict(store, dict("ehr-dict", "number"));

    const all = store.claimsAbout(TYPE);
    const staleNow = all.find((c) => c.id === stale.id)!;
    expect(staleNow).toBeTruthy();                            // the row still exists
    expect(isLive(staleNow)).toBe(false);                     // …as history
    expect(staleNow.supersededBy).toBe(store.liveClaimsAbout(TYPE).find(isLive)!.id);
    expect(staleNow.value).toEqual(sc("text"));               // what was believed, and by whom, is intact
  });

  it("a correction is NOT a conflict: no coexist row, and burn-down does not inflate", () => {
    const store = bare();
    applyDict(store, dict("ehr-dict", "text"));
    const burnBefore = buildKitView(store).burnDown;

    applyDict(store, dict("ehr-dict", "number"));

    expect(store.resolve(TYPE).conflicts).toEqual([]);
    expect(store.allConflicts()).toEqual([]);
    expect(buildKitView(store).burnDown).toEqual(burnBefore); // total/weak/open/pct all unmoved
  });

  it("a DIFFERENT system disagreeing STILL COEXISTS — the genuine conflict is not flattened", () => {
    const store = bare();
    applyDict(store, dict("ehr-dict", "text"));
    applyDict(store, dict("billing-dict", "number"));         // another system, another reading

    expect(liveTypes(store)).toEqual(["number", "text"]);     // BOTH live — a visible contradiction
    const conflicts = store.resolve(TYPE).conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("coexist");
  });

  it("two systems disagreeing, then ONE of them corrects itself: its own row moves, the other's does not", () => {
    const store = bare();
    applyDict(store, dict("ehr-dict", "text"));
    applyDict(store, dict("billing-dict", "number"));
    const billing = store.liveClaimsAbout(TYPE).find((c) => c.closedBy?.by === dictionaryProvenance("billing-dict"))!;

    applyDict(store, dict("ehr-dict", "code"));               // only the EHR dictionary is corrected

    expect(liveTypes(store)).toEqual(["code", "number"]);     // EHR's "text" gone, billing's "number" untouched
    expect(store.liveClaimsAbout(TYPE).some((c) => c.id === billing.id)).toBe(true);
  });

  it("provenance is REQUIRED, never assumed: two code-derived claims with no import provenance coexist", () => {
    const store = bare();
    const anon = (v: string): AssertInput => ({ about: TYPE, value: sc(v), world: "to-be", layer: "configuration", source: "code-derived", ownerWhileOpen: OWNER, status: "weak" });
    reconcile(store, [anon("text")], new Set());
    const rep = reconcile(store, [anon("number")], new Set());

    expect(rep.correctedReimports).toBe(0);   // "I cannot tell which system this came from"
    expect(liveTypes(store)).toEqual(["number", "text"]); // …is NOT "the same system". The miss stays visible.
    expect(importProvenance(anon("text"))).toBeNull();
  });

  it("`dictionaryProvenance` is the ONE definition the emitter and the merge rule share", () => {
    const store = bare();
    applyDict(store, dict("ehr-dict", "text"));
    const emitted = store.liveClaimsAbout(TYPE).find((c) => c.source === "code-derived")!;
    expect(emitted.closedBy?.by).toBe(dictionaryProvenance("ehr-dict"));
    expect(importProvenance(emitted)).toBe(dictionaryProvenance("ehr-dict"));
  });

  it("mergeDecision states the rule: same provenance ⇒ supersede/corroborate, different ⇒ coexist", () => {
    const existing = claimStub({ closedBy: { method: "import", by: dictionaryProvenance("ehr-dict") } });
    const same = { method: "import" as const, by: dictionaryProvenance("ehr-dict") };
    const other = { method: "import" as const, by: dictionaryProvenance("billing-dict") };

    expect(mergeDecision(existing, { world: "to-be", value: sc("number"), source: "code-derived", closedBy: same })).toBe("supersede-existing");
    expect(mergeDecision(existing, { world: "to-be", value: sc("text"), source: "code-derived", closedBy: same })).toBe("corroborate");
    expect(mergeDecision(existing, { world: "to-be", value: sc("number"), source: "code-derived", closedBy: other })).toBe("coexist-conflict");
    // and the regeneration batch is unchanged: a `generated` incoming never overwrites an import
    expect(mergeDecision(existing, { world: "to-be", value: sc("number") })).toBe("preserve-existing");
  });

  it("re-uploading the SAME dictionary unchanged is still a byte-identical no-op", () => {
    const store = bare();
    applyDict(store, dict("ehr-dict", "text"));
    const fp = JSON.stringify(store.claims().map((c) => [c.id, c.status, c.supersededBy ?? ""]).sort());
    const n = store.claims().length;

    const rep = applyDict(store, dict("ehr-dict", "text"));

    expect(store.claims().length).toBe(n);
    expect(JSON.stringify(store.claims().map((c) => [c.id, c.status, c.supersededBy ?? ""]).sort())).toBe(fp);
    expect(rep.correctedReimports).toBe(0);   // an identical re-run corrects nothing
    expect(rep.collapsedDuplicates).toBe(0);
  });

  it("claim ids stay CONTENT-stable: the corrected row's id is a function of its content only", () => {
    const a = bare(); applyDict(a, dict("ehr-dict", "text")); applyDict(a, dict("ehr-dict", "number"));
    const b = bare(); applyDict(b, dict("ehr-dict", "number"));   // reached in one upload, not two
    expect(a.liveClaimsAbout(TYPE).find(isLive)!.id).toBe(b.liveClaimsAbout(TYPE).find(isLive)!.id);
  });
});

// ══ N-5 ══════════════════════════════════════════════════════════════════════════
describe("[N-5] two writers, one value — the duplicate is prevented at WRITE time", () => {
  it("FROZEN-CORE FINDING, still true: store.assert alone leaves TWO live rows for one answer", () => {
    // `store.ts:97` — `valueConflicts` requires substantive AND UNEQUAL, so an agreeing
    // pair never reaches `resolvePrecedence` and neither supersedes. This is the finding
    // reported against projections.ts/store.ts; it is pinned here so it cannot drift
    // unnoticed while the frozen core is closed.
    const store = bare();
    store.assert({ about: TYPE, value: sc("text"), world: "to-be", layer: "configuration", source: "generated", ownerWhileOpen: OWNER, status: "weak" });
    store.assert({ about: TYPE, value: sc("text"), world: "to-be", layer: "configuration", source: "asserted", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "assertion", by: "dba", verbatim: "it is text" } });
    expect(store.liveClaimsAbout(TYPE).filter(isLive)).toHaveLength(2); // one answer, two rows
  });

  it("through reconcile the SAME answer collapses to ONE live row — the stronger source stays", () => {
    const store = bare();
    store.assert({ about: TYPE, value: sc("text"), world: "to-be", layer: "configuration", source: "generated", ownerWhileOpen: OWNER, status: "weak" });

    const rep = reconcile(store, [{ about: TYPE, value: sc("text"), world: "to-be", layer: "configuration", source: "asserted", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "assertion", by: "dba", verbatim: "it is text" } }], new Set());

    const live = store.liveClaimsAbout(TYPE).filter(isLive);
    expect(live).toHaveLength(1);
    expect(live[0].source).toBe("asserted");     // the confirmation, not the guess
    expect(rep.collapsedDuplicates).toBe(1);
    // the guess is history, not deleted — attribution survives
    expect(store.claimsAbout(TYPE).find((c) => c.source === "generated" && c.value.kind === "scalar")!.supersededBy).toBe(live[0].id);
  });

  it("the burn-down denominator does not double-count the agreed answer", () => {
    const dup = bare();
    dup.assert({ about: TYPE, value: sc("text"), world: "to-be", layer: "configuration", source: "generated", ownerWhileOpen: OWNER, status: "weak" });
    reconcile(dup, [{ about: TYPE, value: sc("text"), world: "to-be", layer: "configuration", source: "asserted", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "assertion", by: "dba", verbatim: "it is text" } }], new Set());

    const single = bare();
    reconcile(single, [{ about: TYPE, value: sc("text"), world: "to-be", layer: "configuration", source: "asserted", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "assertion", by: "dba", verbatim: "it is text" } }], new Set());

    // the ONE closure reads the same whether or not a machine had already guessed it
    expect(buildKitView(dup).burnDown).toEqual(buildKitView(single).burnDown);
    expect(buildKitView(dup).burnDown.pctClosed).toBe(100);
  });

  it("where the lattice CANNOT decide, both agreeing rows stay visible — no silent flattening", () => {
    // regulation vs asserted ESCALATES even when they agree; collapsing would erase the
    // escalation, so the collapse only fires on a clean `wins`.
    const store = bare();
    store.assert({ about: TYPE, value: sc("text"), world: "to-be", layer: "configuration", source: "asserted", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "assertion", by: "dba", verbatim: "it is text" } });
    const rep = reconcile(store, [{ about: TYPE, value: sc("text"), world: "to-be", layer: "configuration", source: "regulation", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "document", by: "HIPAA", verbatim: "…" } }], new Set());

    expect(rep.collapsedDuplicates).toBe(0);
    expect(store.liveClaimsAbout(TYPE).filter(isLive)).toHaveLength(2);
  });

  it("a cross-world pair with the same value is NOT collapsed — the deviation register needs both", () => {
    const store = bare();
    store.assert({ about: TYPE, value: sc("text"), world: "as-is", layer: "configuration", source: "code-derived", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "import", by: "ehr-metadata-export" } });
    const rep = reconcile(store, [{ about: TYPE, value: sc("text"), world: "to-be", layer: "configuration", source: "asserted", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "assertion", by: "dba", verbatim: "keep it" } }], new Set());

    expect(rep.collapsedDuplicates).toBe(0);
    expect(store.liveClaimsAbout(TYPE).filter(isLive)).toHaveLength(2);
  });
});

// ══ N-11 ═════════════════════════════════════════════════════════════════════════
describe("[N-11] MergeReport.deviations is a number that can move", () => {
  it("an incoming to-be claim over an as-is export REPORTS the deviation it just created", () => {
    const store = bare();
    store.assert({ about: TYPE, value: sc("string"), world: "as-is", layer: "configuration", source: "code-derived", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "import", by: "ehr-metadata-export" } });

    const rep = applyDict(store, dict("ehr-dict", "text"));

    expect(rep.deviations).toBe(1);
    expect(rep.deviations).toBe(buildDeviationRegister(store).filter((d) => d.about === TYPE).length);
  });

  it("no as-is claim on the locus ⇒ 0; agreeing worlds ⇒ 0 (the number moves BOTH ways)", () => {
    const none = bare();
    expect(applyDict(none, dict("ehr-dict", "text")).deviations).toBe(0);

    const agree = bare();
    agree.assert({ about: TYPE, value: sc("text"), world: "as-is", layer: "configuration", source: "code-derived", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "import", by: "ehr-metadata-export" } });
    expect(applyDict(agree, dict("ehr-dict", "text")).deviations).toBe(0);   // same target as today = no deviation
    expect(buildDeviationRegister(agree)).toEqual([]);
  });

  it("reconcile's count and buildDeviationRegister's count are ONE number over a multi-row batch", () => {
    const store = createLedgerStore();
    store.addElement({ id: "el:entity:case", kind: "entity", name: "Case" });
    for (const f of ["priority", "status"]) {
      const id = `el:attr:case.${f}`;
      store.addElement({ id, kind: "attribute", name: f, of: "el:entity:case" });
      store.assert({ about: aboutOf(id, "dataType"), value: sc("string"), world: "as-is", layer: "configuration", source: "code-derived", ownerWhileOpen: OWNER, status: "closed", closedBy: { method: "import", by: "ehr-metadata-export" } });
    }
    const d = parseDictionaryCsv(["Entity,Field,Type", "Case,priority,number", "Case,status,string"].join("\n"), "ehr-dict");
    const rep = applyDict(store, d);

    expect(rep.deviations).toBe(1);                              // only `priority` actually deviates
    expect(rep.deviations).toBe(buildDeviationRegister(store).length);
  });
});
