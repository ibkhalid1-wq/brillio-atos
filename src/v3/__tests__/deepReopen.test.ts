/**
 * DEEP VALIDATION — REOPEN / CLOSURE REVERSAL (pass 2, sections A3 + E of
 * docs/aura/full-validation-2026-08-10.md).
 *
 * The brief: close a question, reopen it, and prove every projection shows it again,
 * the burn-down goes +1, and attribution history survives.
 *
 * WHAT THIS FILE ESTABLISHES FIRST — there is NO reopen path. Not in the store
 * (`LedgerStore` exposes assert / close / disposition / contradict and nothing that
 * moves a claim back to `open`), not in the operator verb set (`OperatorAction` has ten
 * kinds; none reverses a closure, and `applyOwnership` explicitly refuses any claim that
 * is not already `open`/`blocked` — operatorActions.ts:362), and not in the UI (the
 * "Reopen" affordances in TheLine/PhaseInputsPanel reopen a STAGE GATE, and the
 * `reopened` state in artifactAsks is an SoR ASK re-accumulating typing questions —
 * neither touches a claim). So the answer to check 3 is NO-SUCH-PATH, and the tests
 * below pin that, then measure the one force in the core that DOES move a closed claim
 * back into the open population: a regulation claim landing on it (a BLOCK, not a reopen).
 *
 * JUDGMENT CALL, logged: the brief's premise "the ledger is append-only" is contradicted
 * by the spec itself — docs/aura/ledger-write-model.md, "The two corollaries":
 * "The store is not append-only — a write is a read-modify-write across the locus …
 * `assert` mutates prior claims (`supersededBy`, and `status = "blocked"` on a bound
 * loser)". Append-only is the AUDIT log's property, not the ledger's ("Do not conflate
 * 'the audit log is append-only' with 'the ledger is append-only'"). These tests therefore
 * assert the weaker, real guarantee: no claim ROW is ever deleted and `closedBy`
 * (author + verbatim) is never erased — while recording that `status` IS overwritten
 * in place, so "it was once closed" is not readable from the ledger alone.
 *
 * Read-only over fixtures; every mutation is on a throwaway migrated store.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue, buildKitView, buildHeardRegister, openOwnerQuestions, dictionaryBucket } from "@/v3/lib/ledger/projections";
import { projectKitQuestions } from "@/v3/lib/ledger/kitProjection";
import { applyOwnership, foldOwnership, type OperatorAction } from "@/v3/lib/ledger/operatorActions";
import { buildReadModel } from "@/v3/lib/ledger/readModel";
import { TYPING_SLOTS } from "@/v3/lib/ledger/dictionary";
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

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const lailaSnapshot = (): Snapshot => ({ ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") });

const LOCUS = "el:attr:case.status#dataType";
const AUTHOR = "stakeholder:or-manager";

const closeIt = (store: LedgerStore) => store.assert({
  about: LOCUS, value: { kind: "scalar", value: "picklist" },
  world: "to-be", layer: "configuration", source: "asserted", ownerWhileOpen: { kind: "role", role: "Surgical Operations" },
  status: "closed", closedBy: { method: "assertion", by: AUTHOR, verbatim: "It's a picklist — five states.", at: "2026-08-11" },
});

/** A3's identity — kit === queue(open) === per-owner union — plus the conservation split. */
function a3AndConservation(store: LedgerStore) {
  const q = buildUnknownQueue(store);
  const open = q.items.filter((i) => i.status === "open");
  expect(new Set(projectKitQuestions(store).map((k) => k.about))).toEqual(new Set(open.map((i) => i.about)));
  const byOwner = new Map<string, number>();
  for (const i of open) byOwner.set(i.ownerLabel, (byOwner.get(i.ownerLabel) ?? 0) + 1);
  expect([...byOwner.values()].reduce((a, b) => a + b, 0)).toBe(open.length);
  const roleOwned = open.filter((i) => !TYPING_SLOTS.has(i.slot) && i.owner.kind === "role").length;
  const joint = open.filter((i) => !TYPING_SLOTS.has(i.slot) && i.owner.kind === "joint").length;
  expect(dictionaryBucket(q).length + openOwnerQuestions(q).length + roleOwned + joint).toBe(open.length);
  return open.length;
}

describe("[deep-R1] NO-SUCH-PATH — nothing in the system reverses a claim closure", () => {
  it("the store exposes no reopen verb", () => {
    const store = migrate(surgery());
    const surface = Object.keys(store).sort();
    expect(surface).toEqual([
      "addElement", "addShape", "allConflicts", "assert", "claims", "claimsAbout",
      "close", "contradict", "disposition", "elements", "liveClaimsAbout", "resolve", "shapes",
    ]);
    for (const verb of ["reopen", "unclose", "reverse", "undo", "retract", "delete"]) {
      expect(store as unknown as Record<string, unknown>).not.toHaveProperty(verb);
    }
    // `close()` is one-way: it can only ever produce "closed" or "weak" (store.ts close()).
    const closed = closeIt(store);
    expect(store.close(closed.id, { method: "assertion", by: AUTHOR }).status).toBe("weak");
    expect(store.close(closed.id, { method: "assertion", by: AUTHOR, verbatim: "x" }).status).toBe("closed");
  });

  it("no OPERATOR verb reverses a closure (exhaustive over the union — tsc fails if a verb is added)", () => {
    const REVERSES_A_CLOSURE: Record<OperatorAction["kind"], boolean> = {
      assign: false,          // re-points ownerWhileOpen on an OPEN unknown
      schedule: false,        // an annotation
      capture: false,         // an operator-entered answer; never a store write
      unassign: false,        // reverses ROUTING, not a closure
      "decide-fate": false,   // takes an OPEN unknown to n/a or blocked
      redirect: false,        // an annotation
      pin: false,             // in-flight routing
      "pin-resolve": false,   // a routing decision
      "mint-element": false,  // proposes a NEW element + its ?unknown
      "retract-mint": false,  // undoes a PROPOSAL, not a closure
    };
    expect(Object.values(REVERSES_A_CLOSURE).some(Boolean)).toBe(false);
  });

  it("applyOwnership cannot reopen a CLOSURE — but its guard reads status, not liveness (FINDING)", () => {
    const store = migrate(surgery());
    const generated = store.liveClaimsAbout(LOCUS)[0];               // the born-open ?unknown
    const closure = closeIt(store);
    const actions: OperatorAction[] = [
      { kind: "decide-fate", about: LOCUS, slot: "dataType", decision: "out-of-scope", reason: "n/a here", by: "op", at: "2026-08-11" },
      { kind: "assign", about: LOCUS, slot: "dataType", owner: { label: "Someone Else", isRole: false }, by: "op", at: "2026-08-11" },
    ];
    const before = store.claims().filter((c) => c.about === LOCUS);
    const after = applyOwnership(before, foldOwnership(actions));

    // the CLOSURE is untouchable from the overlay — no reopen, no re-ownership
    expect(after.find((c) => c.id === closure.id)).toEqual(before.find((c) => c.id === closure.id));

    // FINDING: `operatorActions.ts:362` guards on `c.status !== "open" && c.status !== "blocked"`
    // and NOT on `isLive(c)`. A SUPERSEDED history row still carries `status: "open"`, so the
    // overlay rewrites its `ownerWhileOpen` to an owner that was never true while it was open —
    // attribution history rewritten on a dead row.
    const deadBefore = before.find((c) => c.id === generated.id)!;
    const deadAfter = after.find((c) => c.id === generated.id)!;
    expect(isLive(deadBefore)).toBe(false);
    expect(deadBefore.ownerWhileOpen).toEqual({ kind: "unowned" });
    expect(deadAfter.ownerWhileOpen).toEqual({ kind: "role", role: "Someone Else" });

    // …and it is INERT: every projection filters `isLive`, so nothing surfaces the rewrite
    // and no question comes back. Severity is attribution-integrity, not a visible miscount.
    const overlaid = buildReadModel(store.elements(), [...store.claims().filter((c) => c.about !== LOCUS), ...after]);
    expect(buildUnknownQueue(overlaid).items.some((i) => i.about === LOCUS)).toBe(false);
    expect(projectKitQuestions(overlaid).some((k) => k.about === LOCUS)).toBe(false);
    expect(buildKitView(overlaid).burnDown).toEqual(buildKitView(store).burnDown);
  });

  it("asserting a fresh ?unknown does NOT reopen — it is born superseded (store.ts assert)", () => {
    const store = migrate(surgery());
    const openBefore = a3AndConservation(store);
    closeIt(store);
    const afterClose = a3AndConservation(store);
    expect(afterClose).toBe(openBefore - 1);

    const reborn = store.assert({
      about: LOCUS, value: { kind: "unknown" }, world: "to-be", layer: "configuration",
      source: "generated", ownerWhileOpen: { kind: "role", role: "Surgical Operations" }, status: "open",
    });
    expect(isLive(reborn)).toBe(false);                              // supersededBy the substantive closure
    expect(reborn.supersededBy).toBeTruthy();
    expect(a3AndConservation(store)).toBe(afterClose);               // the question did NOT come back
    expect(buildKitView(store).burnDown.open).toBe(buildKitView(migrate(surgery())).burnDown.open - 1);
  });

  it("source sentry: nothing in src/ ever clears a supersession or writes a claim back to open", () => {
    const dir = resolve(__dirname, "../lib/ledger");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const src = readFileSync(resolve(dir, f), "utf8");
      expect(src).not.toMatch(/supersededBy\s*=\s*(undefined|null)|delete\s+\w+\.supersededBy/);
      // the only assignments of status "open" are on NEWLY minted claims, never on an
      // existing one — i.e. no `<existing>.status = "open"` anywhere.
      expect(src).not.toMatch(/\b[a-z]\w*\.status\s*=\s*["']open["']/i);
    }
  });
});

describe("[deep-R2] the one force that moves a CLOSED claim back into the open population", () => {
  /**
   * A `regulation` claim landing on an attributed closure ESCALATES to Legal and holds
   * the assertion `blocked` (precedence.ts:80-82; store.ts escalate branch). That takes a
   * closed claim back into `buildUnknownQueue` and back into `burnDown.open` (+1) — the
   * closest thing to a reopen the core has. It is a BLOCK, not a reopen: the kit does not
   * ask it again, because a blocked question cannot be answered by the stakeholder.
   */
  const bindIt = (store: LedgerStore) => store.assert({
    about: LOCUS, value: { kind: "scalar", value: "coded-terminology" },
    world: "to-be", layer: "domain", source: "regulation", ownerWhileOpen: { kind: "role", role: "Legal" },
    status: "closed", closedBy: { method: "document", by: "regulator:cms", verbatim: "must use a coded terminology" },
  });

  it("burn-down goes +1 open and −1 closed; the queue shows it again as BLOCKED", () => {
    const store = migrate(surgery());
    closeIt(store);
    const afterClose = buildKitView(store).burnDown;
    expect(buildUnknownQueue(store).items.some((i) => i.about === LOCUS)).toBe(false);

    bindIt(store);

    const afterBind = buildKitView(store).burnDown;
    expect(afterBind.open).toBe(afterClose.open + 1);                // +1 — the locus is open work again
    const item = buildUnknownQueue(store).items.find((i) => i.about === LOCUS);
    expect(item).toBeTruthy();
    expect(item).toMatchObject({ status: "blocked", routing: "blocked" });
  });

  it("but the KIT does not ask it again — blocked ≠ open, and A3's identity still holds", () => {
    const store = migrate(surgery());
    const openBefore = a3AndConservation(store);
    closeIt(store);
    bindIt(store);
    // kit === queue(open) === per-owner union, and the conservation split, still hold
    const openAfter = a3AndConservation(store);
    expect(openAfter).toBe(openBefore - 1);                          // the locus is NOT back in the open set
    expect(projectKitQuestions(store).some((k) => k.about === LOCUS)).toBe(false);
    expect(openOwnerQuestions(buildUnknownQueue(store)).some((i) => i.about === LOCUS)).toBe(false);
    expect(dictionaryBucket(buildUnknownQueue(store)).some((i) => i.about === LOCUS)).toBe(false);
    // NOTE (reported): `burnDown.open` counts open+blocked (projections.ts:185) while the
    // kit/owner-queue/dictionary-bucket count `open` only. So a blocked locus is in the
    // burn-down's "open" number and in no askable list — the two populations differ by
    // exactly the blocked set. Pinned here so the divergence is deliberate, not drift.
    const q = buildUnknownQueue(store);
    expect(buildKitView(store).burnDown.open - q.items.filter((i) => i.status === "open").length)
      .toBe(q.items.filter((i) => i.status === "blocked").length);
  });

  it("the burn-down's 'open' and the askable lists differ by EXACTLY the blocked set — on both programs", () => {
    // Today that difference is 0 on the real snapshot too, so nothing reads wrong yet;
    // this pins the identity so the divergence stays deliberate the moment it is non-zero.
    for (const build of [() => migrate(surgery()), () => migrate(lailaSnapshot())]) {
      const store = build();
      const q = buildUnknownQueue(store);
      const blocked = q.items.filter((i) => i.status === "blocked").length;
      expect(buildKitView(store).burnDown.open - q.items.filter((i) => i.status === "open").length).toBe(blocked);
      expect(projectKitQuestions(store).length).toBe(q.items.length - blocked);
    }
  });

  it("ATTRIBUTION SURVIVES: the original closure, its author and its verbatim are still readable", () => {
    const store = migrate(surgery());
    const generated = store.liveClaimsAbout(LOCUS)[0];
    const closure = closeIt(store);
    bindIt(store);

    const all = store.claimsAbout(LOCUS);
    expect(all).toHaveLength(3);                                     // generated ?unknown + assertion + regulation
    // nothing deleted: the pre-closure generated unknown is still on the record as history
    const gen = all.find((c) => c.id === generated.id)!;
    expect(gen).toBeTruthy();
    expect(isLive(gen)).toBe(false);
    expect(gen.supersededBy).toBe(closure.id);

    // the closure itself is still live, with its author and words intact
    const kept = all.find((c) => c.id === closure.id)!;
    expect(isLive(kept)).toBe(true);
    expect(kept.closedBy).toEqual({ method: "assertion", by: AUTHOR, verbatim: "It's a picklist — five states.", at: "2026-08-11" });
    expect(kept.value).toEqual({ kind: "scalar", value: "picklist" });
    // and WHY it is held is on the record, escalated to a named authority (A8)
    expect(kept.status).toBe("blocked");
    expect(kept.escalateTo).toBe("legal-compliance");
    expect(kept.blockedReason).toMatch(/cannot be silently overridden/);
    expect(kept.contradicts).toContain(all.find((c) => c.source === "regulation")!.id);
  });

  it("HONEST LIMIT: `status` is overwritten in place, so 'it was once closed' is NOT on the ledger", () => {
    const store = migrate(surgery());
    const closure = closeIt(store);
    expect(closure.status).toBe("closed");
    bindIt(store);
    const kept = store.claimsAbout(LOCUS).find((c) => c.id === closure.id)!;
    expect(kept.status).toBe("blocked");
    // The ONLY surviving trace that it was a closure is `closedBy` — no prior-status row
    // exists, because the ledger is read-modify-write by design (ledger-write-model.md).
    // The mutation history is the AUDIT log's job (`audit_events`), which this in-memory
    // store does not have — so from the ledger alone the closed→blocked transition is
    // invisible. Reported as the residue, not patched.
    expect(kept.closedBy?.by).toBe(AUTHOR);
    expect(Object.keys(kept)).not.toContain("previousStatus");
    expect(Object.keys(kept)).not.toContain("history");
  });

  it("the heard-count follows the block: the blocked closure stops counting as heard", () => {
    const store = migrate(surgery());
    const bandOf = (label: string) => buildHeardRegister(store).byBand.find((b) => b.band === label)?.heard ?? 0;
    const base = buildHeardRegister(store).total;
    expect(bandOf("Surgical Operations")).toBe(0);

    closeIt(store);
    expect(bandOf("Surgical Operations")).toBe(1);                   // a real human closure, heard
    expect(buildHeardRegister(store).total).toBe(base + 1);

    bindIt(store);
    // isHeardClosure requires status closed|weak (projections.ts:131) — the BLOCKED assertion
    // drops out, which is right: the answer is no longer believed, only recorded.
    expect(bandOf("Surgical Operations")).toBe(0);
    // the regulation that blocked it is itself an attributed closure, so the TOTAL is flat
    // rather than falling — the heard population changed hands, it did not shrink.
    expect(bandOf("Legal")).toBe(1);
    expect(buildHeardRegister(store).total).toBe(base + 1);
  });
});
