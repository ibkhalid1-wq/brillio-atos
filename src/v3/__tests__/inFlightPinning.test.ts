/**
 * REGRESSION — IN-FLIGHT PINNING.
 *
 * The open finding in docs/aura/owner-routing-fabrication-fix.md: Anesthesiology showed
 * *in-flight / awaiting / 0 owned* because the questions on their SENT link were
 * re-attributed underneath them by a later derivation. The rule this file pins down:
 *
 *   When a stakeholder link is SENT, the questions on it are PINNED to their recipient.
 *   Re-derivation NEVER silently moves a pinned question; a routing change that would
 *   affect an in-flight link surfaces as an OPERATOR DECISION instead.
 *
 * Surface layer only — the pins ride the existing `_operatorActions` underscore field
 * (one write path), and the frozen core (store/types/precedence/projections) is untouched.
 *
 * The re-derivation here is REAL, not simulated: the same atlas is re-migrated with a
 * changed `workflow.owner`, which moves `el:wf:…#phase` and `el:step:…#decision` from one
 * owner to another while the LOCUS IDS stay identical — exactly the shape of the live bug.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, ownerRoleLabelForArea, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildReadModel } from "@/v3/lib/ledger/readModel";
import { buildUnknownQueue, buildHeardRegister, openOwnerQuestions, dictionaryBucket, type QueueItem } from "@/v3/lib/ledger/projections";
import { TYPING_SLOTS } from "@/v3/lib/ledger/dictionary";
import { ownerLabel } from "@/v3/lib/ledger/types";
import {
  foldOwnership, applyOwnership, activeAssignments, activePins, decidedFates,
  baselineOwnerLabels, derivePinConflicts, pinsForSend, pinAgreesWith,
  type OperatorAction, type PinAction,
} from "@/v3/lib/ledger/operatorActions";

// ── the fixture: one anesthesia workflow whose stated OWNER is the thing that moves ──
const snap = (workflowOwner: string): Snapshot => ({
  ontology: { entities: [{ name: "Anesthesia Record", area: "Anesthesiology", attributes: ["type", "status"] }] },
  atlas: {
    workflows: [{
      name: "Pre-op Anesthesia Clearance", area: "Anesthesiology", owner: workflowOwner, trigger: "case booked",
      steps: [{ action: "Decide fitness for anesthesia", actor: "Anesthesiologist" }],
    }],
  },
  overrides: [],
});
const BEFORE = "Anesthesiologist";     // who the derivation named when the link went out
const AFTER = "Chief of Surgery";      // who a later derivation wants instead
const PHASE = "el:wf:pre-op-anesthesia-clearance#phase";
const DECISION_SLOT = "#decision";

/** THE read pipeline useProgramLedger runs, minus React: migrate → operator overlay →
 *  read model → queue. Same functions, same order — no second implementation of any
 *  step, so what this proves is what the surfaces read. */
function read(snapshot: Snapshot, actions: OperatorAction[]) {
  const migrated = migrate(snapshot);
  const fold = foldOwnership(actions);
  const baseline = baselineOwnerLabels(migrated.claims(), activeAssignments(actions));
  const pinConflicts = derivePinConflicts(fold, (about) => baseline.get(about) ?? "", ownerRoleLabelForArea);
  const store = fold.size ? buildReadModel(migrated.elements(), applyOwnership(migrated.claims(), fold)) : migrated;
  const queue = buildUnknownQueue(store);
  const ownerOf = (about: string) => queue.items.find((i) => i.about === about)?.ownerLabel ?? "";
  return { migrated, store, queue, baseline, pinConflicts, ownerOf, heard: buildHeardRegister(store) };
}

/** The routing useProgramLedger performs over the queue — the four buckets every
 *  surface reads. Replicated here (and only here) so conservation can be asserted. */
function route(items: QueueItem[]) {
  const dictionary: QueueItem[] = [], needOwner: QueueItem[] = [], session: QueueItem[] = [], solo: QueueItem[] = [];
  for (const it of items) {
    if (it.status !== "open") continue;                       // blocked = its own residue
    if (TYPING_SLOTS.has(it.slot)) { dictionary.push(it); continue; }
    if (it.owner.kind === "joint") { session.push(it); continue; }
    if (it.owner.kind === "unowned") { needOwner.push(it); continue; }
    solo.push(it);
  }
  return { dictionary, needOwner, session, solo };
}

const send = (abouts: string[], label: string, role: string, at = "2026-08-01T09:00:00.000Z"): PinAction[] =>
  pinsForSend({ abouts, owner: { label, isRole: false }, ownerRole: role, by: "operator", at });

// The two loci the workflow owner actually owns — read off the fixture, not hardcoded.
const OWNED_BY_WORKFLOW = (() => {
  const q = buildUnknownQueue(migrate(snap(BEFORE)));
  return q.items.filter((i) => i.ownerLabel === BEFORE && (i.about === PHASE || i.about.endsWith(DECISION_SLOT))).map((i) => i.about);
})();

describe("a SEND pins its loci — and an agreeing derivation is not a disagreement", () => {
  it("the fixture really does own these loci by the workflow owner (pre-condition)", () => {
    expect(OWNED_BY_WORKFLOW).toContain(PHASE);
    expect(OWNED_BY_WORKFLOW.length).toBeGreaterThan(1);
    expect(read(snap(BEFORE), []).ownerOf(PHASE)).toBe(BEFORE);
  });

  it("pins are minted per LOCUS, deduped, blanks dropped", () => {
    const pins = send([PHASE, PHASE, "", "  ", ...OWNED_BY_WORKFLOW], "Dr. Rao", BEFORE);
    expect(pins.map((p) => p.about)).toEqual([...new Set(OWNED_BY_WORKFLOW)]);
    expect(pins.every((p) => p.kind === "pin" && p.owner.label === "Dr. Rao" && p.ownerRole === BEFORE)).toBe(true);
    expect(pins[0].slot).toBe("phase");
  });

  it("INVARIANT — in-flight with 0 sent questions is unrepresentable: a send carrying no loci pins NOTHING", () => {
    // the kit-script fallback path (strings only, no ledger loci) — `about` is ""
    expect(send(["", "", ""], "Dr. Rao", BEFORE)).toHaveLength(0);
    expect(send([], "Dr. Rao", BEFORE)).toHaveLength(0);
    // …and a nameless recipient is never pinned to either (no fabricated holder)
    expect(pinsForSend({ abouts: [PHASE], owner: { label: "  ", isRole: true }, by: "op", at: "t" })).toHaveLength(0);
  });

  it("the guard in TheLine's row builder still stands (the same invariant on the read side)", () => {
    const src = readFileSync(resolve(__dirname, "../components/flow/TheLine.tsx"), "utf8");
    expect(src).toContain("awaiting: !col.heard && !!col.pack && questions.length > 0");
  });

  it("a pin that AGREES with the derivation raises no operator item (name, role, function, or seam party)", () => {
    // same person as the derived owner, named by their ROLE at send time
    expect(read(snap(BEFORE), send(OWNED_BY_WORKFLOW, "Dr. Rao", BEFORE)).pinConflicts).toHaveLength(0);
    const pin = send([PHASE], "Dr. Rao", BEFORE)[0];
    expect(pinAgreesWith(pin, BEFORE)).toBe(true);                       // by role
    expect(pinAgreesWith({ ...pin, owner: { label: BEFORE, isRole: true }, ownerRole: undefined }, BEFORE)).toBe(true);
    expect(pinAgreesWith(pin, `${BEFORE} ⋈ Surgeon`)).toBe(true);        // one party of a seam
    expect(pinAgreesWith(pin, "")).toBe(true);                           // nobody derived → nothing to decide
    // via the ledger's OWN function mapping (a person in a Sales Ops area → "Sales Ops")
    const salesPin = send([PHASE], "Priya", "Sales Operations")[0];
    expect(pinAgreesWith(salesPin, "Sales Ops", ownerRoleLabelForArea)).toBe(true);
    expect(pinAgreesWith(salesPin, "Sales Ops")).toBe(false);            // without the mapping it would look like a move
  });

  /**
   * THE SHAPE LAILA NEW ACTUALLY HOLDS — the 8 "pin conflicts" that were open on the
   * live programme all afternoon, and are not conflicts at all.
   *
   * Sixteen questions went out on links to two recipients, and eight of them read as
   * disagreements because the compound label "Sales Operations SME" resolved to the
   * broader Sales function instead of Sales Ops. The ownership-binding work fixed the
   * resolution; the eight cleared themselves. Verified afterwards by running the live
   * blob through this exact pipeline: 16 pins, 16 baselines, ZERO conflicts, and no
   * baseline empty — so the zero is agreement, not absence.
   *
   * Pinned here in the two label pairs the programme really carries, because a
   * regression would be invisible: it does not break anything, it just asks the
   * operator to adjudicate eight routings that were never in dispute.
   */
  it("REGRESSION: the two live Laila pairs agree, and 'Sales Ops' is not swallowed by 'Sales'", () => {
    const salesSme = send([PHASE], "Sales SME", "Sales Process Expert")[0];
    expect(pinAgreesWith(salesSme, "Sales Leaders", ownerRoleLabelForArea),
      "a Sales SME stopped matching the Sales owner label").toBe(true);

    const opsSme = send([PHASE], "Sales Operations SME", "Sales Operations Process Expert")[0];
    // MUTATION: reorder FUNCTIONS so /sales/ precedes /sales ?op/ → RED, and the eight
    // conflicts come straight back.
    expect(pinAgreesWith(opsSme, "Sales Ops", ownerRoleLabelForArea),
      "Sales Operations was swallowed by the broader Sales match again").toBe(true);
    // …and the two are still TOLD APART: an ops pin must not silently satisfy a Sales
    // derivation, or the guard would pass by matching everything.
    expect(pinAgreesWith(opsSme, "Sales Leaders", ownerRoleLabelForArea),
      "an ops recipient answered for the Sales owner — the check matches too much").toBe(false);
  });
});

describe("a pinned locus SURVIVES a re-derivation that would have moved it", () => {
  const pins = send(OWNED_BY_WORKFLOW, "Dr. Rao", BEFORE);

  it("without the pin the re-derivation DOES move it (the bug this pins down is real)", () => {
    const after = read(snap(AFTER), []);
    expect(after.ownerOf(PHASE)).toBe(AFTER);
    for (const about of OWNED_BY_WORKFLOW) expect(after.ownerOf(about)).toBe(AFTER);
  });

  it("with the pin the sent question stays with its recipient — every sent locus, none moved", () => {
    const after = read(snap(AFTER), pins);
    for (const about of OWNED_BY_WORKFLOW) expect(after.ownerOf(about)).toBe("Dr. Rao");
  });

  it("a later ASSIGN is a routing change too — it does not sweep an in-flight question either", () => {
    const assign: OperatorAction = {
      kind: "assign", about: PHASE, slot: "phase",
      owner: { label: AFTER, isRole: true }, by: "operator", at: "2026-08-02T09:00:00.000Z",
    };
    const after = read(snap(BEFORE), [...pins, assign]);
    expect(after.ownerOf(PHASE)).toBe("Dr. Rao");                        // the pin holds over the assign
    expect(after.pinConflicts.map((c) => c.about)).toEqual([PHASE]);     // and it surfaces as a decision
    expect(after.pinConflicts[0]).toMatchObject({ pinned: "Dr. Rao", derived: AFTER });
  });

  it("pinning is NOT a closure — the heard register cannot move", () => {
    expect(read(snap(AFTER), pins).heard.total).toBe(read(snap(AFTER), []).heard.total);
    expect(read(snap(AFTER), pins).heard.total).toBe(0);
  });
});

describe("a DISAGREEMENT surfaces as an operator item, never a silent move", () => {
  const pins = send(OWNED_BY_WORKFLOW, "Dr. Rao", BEFORE);
  const after = read(snap(AFTER), pins);

  it("every re-routed sent locus becomes exactly one operator decision row", () => {
    expect(after.pinConflicts.map((c) => c.about).sort()).toEqual([...OWNED_BY_WORKFLOW].sort());
    for (const c of after.pinConflicts) {
      expect(c.pinned).toBe("Dr. Rao");
      expect(c.derived).toBe(AFTER);
      expect(c.pin.sentAt).toBe("2026-08-01T09:00:00.000Z");             // the send is dated on the row
    }
  });

  it("the row states BOTH sides honestly — the derivation is recorded, not discarded", () => {
    expect(after.baseline.get(PHASE)).toBe(AFTER);   // what the derivation wanted
    expect(after.ownerOf(PHASE)).toBe("Dr. Rao");    // what the ledger still says
  });

  it("KEEP settles that disagreement — the pin stands and the row clears", () => {
    const keep: OperatorAction = { kind: "pin-resolve", about: PHASE, decision: "keep", against: AFTER, by: "operator", at: "2026-08-03T09:00:00.000Z" };
    const kept = read(snap(AFTER), [...pins, keep]);
    expect(kept.pinConflicts.map((c) => c.about)).not.toContain(PHASE);
    expect(kept.ownerOf(PHASE)).toBe("Dr. Rao");
    // a DIFFERENT later disagreement is a new decision — a keep is not a blanket waiver
    const assign: OperatorAction = { kind: "assign", about: PHASE, slot: "phase", owner: { label: "Surgeon", isRole: true }, by: "operator", at: "2026-08-04T09:00:00.000Z" };
    const again = read(snap(AFTER), [...pins, keep, assign]);
    expect(again.pinConflicts.map((c) => c.about)).toContain(PHASE);
    expect(again.pinConflicts.find((c) => c.about === PHASE)?.derived).toBe("Surgeon");
    expect(again.ownerOf(PHASE)).toBe("Dr. Rao");    // still not moved, still a decision
  });

  it("RELEASE is the only thing that moves it — and it is an explicit operator act", () => {
    const release: OperatorAction = { kind: "pin-resolve", about: PHASE, decision: "release", against: AFTER, by: "operator", at: "2026-08-03T09:00:00.000Z" };
    const moved = read(snap(AFTER), [...pins, release]);
    expect(moved.ownerOf(PHASE)).toBe(AFTER);                            // the derivation now takes effect
    expect(moved.pinConflicts.map((c) => c.about)).not.toContain(PHASE);
    expect(activePins([...pins, release]).has(PHASE)).toBe(false);
    // the OTHER sent loci are untouched — release is per-locus, never a sweep
    for (const about of OWNED_BY_WORKFLOW.filter((a) => a !== PHASE)) expect(moved.ownerOf(about)).toBe("Dr. Rao");
  });

  it("a stakeholder RELEASE ('not mine') and a DECIDE-FATE both end the in-flight", () => {
    const unassign: OperatorAction = { kind: "unassign", about: PHASE, reason: "release", saidByName: "Dr. Rao", by: "operator", at: "2026-08-03T09:00:00.000Z" };
    expect(activePins([...pins, unassign]).has(PHASE)).toBe(false);
    expect(read(snap(AFTER), [...pins, unassign]).ownerOf(PHASE)).toBe(AFTER);
    const fate: OperatorAction = { kind: "decide-fate", about: PHASE, slot: "phase", decision: "out-of-scope", reason: "not in this programme", by: "operator", at: "2026-08-03T09:00:00.000Z" };
    const decided = [...pins, fate];
    expect(activePins(decided).has(PHASE)).toBe(false);
    expect(decidedFates(decided).has(PHASE)).toBe(true);
    expect(read(snap(AFTER), decided).queue.items.find((i) => i.about === PHASE)).toBeUndefined();  // n/a, out of the queue
  });

  it("a pin on a locus nobody else claims is not a disagreement (a pin never conflicts with no one)", () => {
    const unownedLocus = read(snap(AFTER), []).queue.items.find((i) => i.owner.kind === "unowned")!.about;
    const p = send([unownedLocus], "Dr. Rao", BEFORE);
    expect(read(snap(AFTER), p).pinConflicts).toHaveLength(0);
    expect(read(snap(AFTER), p).ownerOf(unownedLocus)).toBe("Dr. Rao");
  });
});

describe("CONSERVATION holds across pinning — nothing vanishes, nothing double-counts", () => {
  const pins = send(OWNED_BY_WORKFLOW, "Dr. Rao", BEFORE);
  const before = read(snap(AFTER), []);
  const after = read(snap(AFTER), pins);

  it("the open population is identical before and after pinning — a pin re-owns, never removes", () => {
    const openOf = (r: ReturnType<typeof read>) => r.queue.items.filter((i) => i.status === "open").map((i) => i.about).sort();
    expect(openOf(after)).toEqual(openOf(before));
  });

  it("total open === need-an-owner + dictionary + solo(role) + sessions(joint), pinned or not", () => {
    for (const r of [before, after]) {
      const open = r.queue.items.filter((i) => i.status === "open");
      const b = route(r.queue.items);
      expect(b.needOwner.length + b.dictionary.length + b.solo.length + b.session.length).toBe(open.length);
      const seen = new Set([...b.needOwner, ...b.dictionary, ...b.solo, ...b.session].map((i) => i.about));
      expect(seen.size).toBe(open.length);                               // disjoint: no locus in two buckets
      // the projections' own two definitions agree with this routing
      expect(dictionaryBucket(r.queue).length).toBe(b.dictionary.length);
      expect(openOwnerQuestions(r.queue).length).toBe(b.needOwner.length);
    }
  });

  it("the pinned loci moved BETWEEN owners, not out of the count — solo total is unchanged", () => {
    expect(route(after.queue.items).solo.length).toBe(route(before.queue.items).solo.length);
    const soloOwners = (r: ReturnType<typeof read>) => route(r.queue.items).solo.filter((i) => i.ownerLabel === "Dr. Rao").length;
    expect(soloOwners(before)).toBe(0);
    expect(soloOwners(after)).toBe(OWNED_BY_WORKFLOW.length);
  });

  it("a pinned owner reads through the SAME ownerLabel every surface uses (no private label)", () => {
    const item = after.queue.items.find((i) => i.about === PHASE)!;
    expect(ownerLabel(item.owner)).toBe("Dr. Rao");
    expect(item.owner.kind).toBe("role");
  });
});

// ── the same conservation, at programme scale, on the committed Laila record ──
const laila = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const LAILA: Snapshot = {
  ontology: laila("domain-ontology.json"), atlas: laila("current-state-atlas.json"), overrides: laila("operator-overrides.json"),
};

describe("CONSERVATION at programme scale (Laila) — a real send of a real owner's list", () => {
  const bare = read(LAILA, []);
  // The send TheLine actually makes: the open non-typing loci a person owns, capped at
  // the pack's 8 questions. Pinned to a named human whose role is that owner-label.
  const owner = route(bare.queue.items).solo[0].ownerLabel;
  const sent = route(bare.queue.items).solo.filter((i) => i.ownerLabel === owner).slice(0, 8).map((i) => i.about);
  const pins = send(sent, "Ibrahim Khalid", owner);
  const after = read(LAILA, pins);

  it("the send is non-trivial (pre-condition: a real owner with real questions)", () => {
    expect(sent.length).toBeGreaterThan(0);
    expect(owner).not.toBe("unowned");
  });

  it("total open === need-an-owner + dictionary + solo + sessions, before AND after the send", () => {
    for (const r of [bare, after]) {
      const open = r.queue.items.filter((i) => i.status === "open").length;
      const b = route(r.queue.items);
      expect(b.needOwner.length + b.dictionary.length + b.solo.length + b.session.length).toBe(open);
    }
    const a = route(after.queue.items), b = route(bare.queue.items);
    expect([a.needOwner.length, a.dictionary.length, a.solo.length, a.session.length])
      .toEqual([b.needOwner.length, b.dictionary.length, b.solo.length, b.session.length]);
  });

  it("the sent questions now read under their RECIPIENT, and only those moved", () => {
    const mine = route(after.queue.items).solo.filter((i) => i.ownerLabel === "Ibrahim Khalid").map((i) => i.about).sort();
    expect(mine).toEqual([...sent].sort());
    // a pin that agrees with the derivation (same function) raises no decision
    expect(after.pinConflicts).toHaveLength(0);
    expect(activePins(pins).size).toBe(sent.length);
  });

  it("the heard-count is untouched by a send at scale", () => {
    expect(after.heard.total).toBe(bare.heard.total);
  });
});
