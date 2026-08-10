/**
 * REGRESSION — THE CURATION PATH (locus minting from an ontology-gap kit question).
 *
 * The open finding in docs/aura/kit-question-projection.md: `reconcileKit` classifies an
 * unmatched kit question as `ontology-gap` ("the kit knows a thing the ontology missed")
 * but there was NO way to act on one — curation was dismiss/defer only. This file pins
 * the path that closes it:
 *
 *   An operator MINTS a PROPOSED element + the one `?unknown` it opens, from a named kit
 *   question. It rides the existing `_operatorActions` underscore field (one write path),
 *   is applied as a READ-MODEL OVERLAY (the frozen core is untouched), is visibly marked
 *   PROPOSED, and RETRACT puts the read model back exactly as it was.
 *
 * Everything asserted here is read through the SAME functions `useProgramLedger` runs, in
 * the same order — no second implementation of any step.
 */
import { describe, it, expect } from "vitest";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildReadModel } from "@/v3/lib/ledger/readModel";
import { createLedgerStore } from "@/v3/lib/ledger/store";
import {
  buildUnknownQueue, buildHeardRegister, buildKitView, openOwnerQuestions,
  dictionaryBucket, type QueueItem,
} from "@/v3/lib/ledger/projections";
import { TYPING_SLOTS } from "@/v3/lib/ledger/dictionary";
import { renderQuestion } from "@/v3/lib/ledger/renderQuestion";
import { projectKitQuestions, reconcileKit } from "@/v3/lib/ledger/kitProjection";
import { isLive } from "@/v3/lib/ledger/types";
import { foldOwnership, applyOwnership, type OperatorAction } from "@/v3/lib/ledger/operatorActions";
import {
  mintProposal, retractProposal, foldProposals, proposalOverlay, proposalClaim,
  isProposedLocus, isProposedElementId, mintedKitQuestions, proposedElementsIn,
  PROPOSED_ID_PREFIX, PROPOSAL_SLOT,
} from "@/v3/lib/ledger/curation";

// ── fixture: a small surgery ontology + atlas (the live program is DB-only) ──
const snap: Snapshot = {
  ontology: {
    entities: [
      { name: "Case", area: "Surgical Operations", attributes: ["status"] },
      { name: "Anesthesia Record", area: "Anesthesiology", attributes: ["type"] },
    ],
  },
  atlas: {
    workflows: [{
      name: "Case Cancellation Review", area: "Surgical Operations", trigger: "cancel requested",
      steps: [{ action: "Decide whether to reschedule or cancel", actor: "Surgeon" }],
    }],
  },
  overrides: [],
};

/** THE read pipeline useProgramLedger runs, minus React: migrate → curation overlay →
 *  ownership overlay → read model → queue. Same functions, same order. */
function read(actions: OperatorAction[]) {
  const migrated = migrate(snap);
  const curation = proposalOverlay(actions, migrated.elements());
  const withProposals = curation.claims.length ? [...migrated.claims(), ...curation.claims] : migrated.claims();
  const fold = foldOwnership(actions);
  const store = fold.size || curation.elements.length
    ? buildReadModel([...migrated.elements(), ...curation.elements], applyOwnership(withProposals, fold))
    : migrated;
  const queue = buildUnknownQueue(store);
  return {
    store, curation, queue,
    elements: store.elements(),
    open: queue.items.filter((i) => i.status === "open"),
    assignQueue: openOwnerQuestions(queue),
    typing: dictionaryBucket(queue),
    heard: buildHeardRegister(store),
    burnDown: buildKitView(store).burnDown,
    kit: projectKitQuestions(store),
  };
}

/** The four buckets the hook routes the queue into — conservation is asserted over these. */
function route(items: QueueItem[]) {
  const dictionary: QueueItem[] = [], needOwner: QueueItem[] = [], session: QueueItem[] = [], solo: QueueItem[] = [];
  for (const it of items) {
    if (it.status !== "open") continue;
    if (TYPING_SLOTS.has(it.slot)) { dictionary.push(it); continue; }
    if (it.owner.kind === "joint") { session.push(it); continue; }
    if (it.owner.kind === "unowned") { needOwner.push(it); continue; }
    solo.push(it);
  }
  return { dictionary, needOwner, session, solo };
}
const conserved = (items: QueueItem[]) => {
  const r = route(items);
  return r.dictionary.length + r.needOwner.length + r.session.length + r.solo.length;
};

// The gap question this whole path exists for — an invented noun the ontology never held.
const GAP = "How is a sterilisation tray shortage handled before an operation?";
const MINT = mintProposal({ name: "Sterilisation Tray", fromKit: GAP, by: "operator@brillio", at: "2026-08-10T09:00:00.000Z", reason: "kit caught it; ontology has no element" })!;
const RETRACT = retractProposal(MINT.elementId, "operator@brillio", "2026-08-10T10:00:00.000Z", "duplicate of inventory scope")!;

describe("the gap is real, and the mint is derived from it (not invented alongside it)", () => {
  it("reconcileKit classifies the question as an ontology-gap (the precondition)", () => {
    const rec = reconcileKit([GAP], migrate(snap));
    expect(rec.matched).toHaveLength(0);
    expect(rec.unmatched[0].reason).toBe("ontology-gap");
    expect(rec.unmatched[0].implies).toContain("curation path");
  });

  it("NO FABRICATION — a mint without an operator-supplied name / source question / author is refused", () => {
    const base = { name: "Sterilisation Tray", fromKit: GAP, by: "op", at: "t" };
    expect(mintProposal({ ...base, name: "   " })).toBeNull();
    expect(mintProposal({ ...base, fromKit: "" })).toBeNull();
    expect(mintProposal({ ...base, by: "" })).toBeNull();
    expect(mintProposal({ ...base, at: "" })).toBeNull();
    expect(retractProposal("", "op", "t")).toBeNull();
  });

  it("the mint is PROVISIONAL, ATTRIBUTED and CONTENT-ADDRESSED", () => {
    expect(MINT.elementId.startsWith(`${PROPOSED_ID_PREFIX}:`)).toBe(true);
    expect(isProposedElementId(MINT.elementId)).toBe(true);
    expect(MINT.about).toBe(`${MINT.elementId}#${PROPOSAL_SLOT}`);
    expect(MINT.fromKit).toBe(GAP);                 // which kit question
    expect(MINT.by).toBe("operator@brillio");       // who proposed it
    expect(MINT.at).toBe("2026-08-10T09:00:00.000Z"); // when
    expect(MINT.world).toBe("to-be");
    // content-derived and STABLE: the same proposal always mints the same id
    const again = mintProposal({ name: "  sterilisation tray  ", fromKit: "a different gap question", by: "someone-else", at: "2026-09-01T00:00:00.000Z" })!;
    expect(again.elementId).toBe(MINT.elementId);
    // a DIFFERENT concept gets a different id (no id collision by prefix alone)
    expect(mintProposal({ name: "Tray Washer", fromKit: GAP, by: "op", at: "t" })!.elementId).not.toBe(MINT.elementId);
  });
});

describe("minting adds exactly one element and one open locus", () => {
  const before = read([]);
  const after = read([MINT]);

  it("+1 element, +1 live claim, +1 open unknown — nothing else moves", () => {
    expect(after.elements.length).toBe(before.elements.length + 1);
    expect(after.store.claims().filter(isLive).length).toBe(before.store.claims().filter(isLive).length + 1);
    expect(after.open.length).toBe(before.open.length + 1);
    expect(after.burnDown.open).toBe(before.burnDown.open + 1);
    // the ONE new locus is the minted one
    const added = after.open.filter((i) => !before.open.some((b) => b.about === i.about));
    expect(added.map((i) => i.about)).toEqual([MINT.about]);
    expect(proposedElementsIn(after.store).map((e) => e.id)).toEqual([MINT.elementId]);
  });

  it("the minted claim is an OPEN ?unknown, unowned, attributed — never an answer", () => {
    const c = after.store.liveClaimsAbout(MINT.about);
    expect(c).toHaveLength(1);
    expect(c[0].value).toEqual({ kind: "unknown" });
    expect(c[0].status).toBe("open");
    expect(c[0].ownerWhileOpen).toEqual({ kind: "unowned" });
    expect(c[0].source).toBe("dispositioned");
    expect(c[0].closedBy).toBeUndefined();
    expect(c[0].createdAt).toBe(MINT.at);
  });

  it("the heard-count CANNOT move (a proposal is not an answer)", () => {
    expect(after.heard.total).toBe(before.heard.total);
    expect(after.burnDown.closed).toBe(before.burnDown.closed);
    expect(after.burnDown.weak).toBe(before.burnDown.weak);
  });

  it("the claim row is byte-identical to what the store's own write path would produce", () => {
    const p = [...foldProposals([MINT]).values()][0];
    const overlaid = proposalClaim(p);
    const scratch = createLedgerStore();
    const written = scratch.assert({
      about: overlaid.about, value: { kind: "unknown" }, world: overlaid.world,
      layer: overlaid.layer, source: overlaid.source, ownerWhileOpen: overlaid.ownerWhileOpen,
    });
    expect(written.id).toBe(overlaid.id);           // same contentId formula, no parallel dialect
    expect(written.status).toBe("open");
  });
});

describe("it appears in the queue as PROPOSED", () => {
  const after = read([MINT]);

  it("it is IN the queue, unowned, and routed to 'needs a human owner'", () => {
    const item = after.open.find((i) => i.about === MINT.about)!;
    expect(item).toBeDefined();
    expect(item.owner.kind).toBe("unowned");        // nobody owns a thing nobody modelled
    expect(item.routing).toBe("unowned");
    expect(after.assignQueue.some((i) => i.about === MINT.about)).toBe(true);
    expect(after.typing.some((i) => i.about === MINT.about)).toBe(false); // not a dictionary chore
  });

  it("it is MARKED proposed — never indistinguishable from an evidence-grounded element", () => {
    expect(isProposedLocus(MINT.about)).toBe(true);
    expect(after.curation.abouts.has(MINT.about)).toBe(true);
    // and every OTHER open locus in the program is NOT marked
    for (const i of after.open) if (i.about !== MINT.about) expect(isProposedLocus(i.about)).toBe(false);
  });

  it("its question comes from the ONE renderer (producer-zero), and it reaches the kit", () => {
    const r = renderQuestion(after.store, MINT.about, "stakeholder");
    expect(r.question).toBe('What does Sterilisation Tray mean, exactly?');
    expect(r.elementName).toBe("Sterilisation Tray");
    expect(after.kit.some((k) => k.about === MINT.about)).toBe(true);   // kit === queue still holds
  });

  it("the proposal carries its provenance to the surface (who / which question / when)", () => {
    const p = after.curation.proposals.find((x) => x.elementId === MINT.elementId)!;
    expect(p.fromKit).toEqual([GAP]);
    expect(p.by).toBe("operator@brillio");
    expect(p.at).toBe("2026-08-10T09:00:00.000Z");
    expect(p.reason).toContain("ontology has no element");
    expect(p.alreadyModelled).toBeUndefined();
    expect(mintedKitQuestions([MINT]).has(GAP)).toBe(true);
  });
});

describe("retracting removes it cleanly", () => {
  const before = read([]);
  const after = read([MINT]);
  const undone = read([MINT, RETRACT]);

  it("the read model returns to EXACTLY its pre-mint state", () => {
    expect(undone.elements.map((e) => e.id).sort()).toEqual(before.elements.map((e) => e.id).sort());
    expect(undone.open.map((i) => i.about).sort()).toEqual(before.open.map((i) => i.about).sort());
    expect(undone.store.claims().length).toBe(before.store.claims().length);
    expect(undone.burnDown).toEqual(before.burnDown);
    expect(undone.curation.proposals).toHaveLength(0);
    expect(undone.curation.abouts.size).toBe(0);
    expect(proposedElementsIn(undone.store)).toHaveLength(0);
    expect(after.open.length - undone.open.length).toBe(1);            // it really was there
  });

  it("re-minting after a retract works, with FRESH attribution (the log is the trace)", () => {
    const remint = mintProposal({ name: "Sterilisation Tray", fromKit: GAP, by: "second-operator", at: "2026-08-11T09:00:00.000Z" })!;
    const back = read([MINT, RETRACT, remint]);
    expect(back.open.some((i) => i.about === MINT.about)).toBe(true);
    const p = back.curation.proposals[0];
    expect(p.by).toBe("second-operator");
    expect(p.at).toBe("2026-08-11T09:00:00.000Z");
  });

  it("a retract of something never minted is a no-op (no phantom removal)", () => {
    const stray = retractProposal("el:proposed:deadbeef", "op", "2026-08-10T11:00:00.000Z")!;
    const r = read([stray]);
    expect(r.open.map((i) => i.about).sort()).toEqual(before.open.map((i) => i.about).sort());
  });
});

describe("conservation holds before and after (nothing vanishes, nothing double-counts)", () => {
  for (const [label, actions] of [["before mint", []], ["after mint", [MINT]], ["after retract", [MINT, RETRACT]]] as const) {
    it(`open === dictionary + need-owner + session + solo — ${label}`, () => {
      const r = read([...actions]);
      expect(conserved(r.open)).toBe(r.open.length);
      // and the two headline populations still partition the unowned open set
      const unownedOpen = r.open.filter((i) => i.owner.kind === "unowned");
      const unownedTyping = r.typing.filter((i) => i.owner.kind === "unowned");
      expect(r.assignQueue.length + unownedTyping.length).toBe(unownedOpen.length);
    });
  }

  it("the mint moves the buckets by exactly one, in the need-owner bucket only", () => {
    const b = route(read([]).open), a = route(read([MINT]).open);
    expect(a.needOwner.length).toBe(b.needOwner.length + 1);
    expect(a.dictionary.length).toBe(b.dictionary.length);
    expect(a.session.length).toBe(b.session.length);
    expect(a.solo.length).toBe(b.solo.length);
  });
});

describe("ONE DEFINITION — curation can never fork a concept the ontology already holds", () => {
  it("minting an already-modelled name mints NOTHING and says so", () => {
    const dupe = mintProposal({ name: "Case", fromKit: "Who owns a Case?", by: "op", at: "2026-08-10T09:00:00.000Z" })!;
    const r = read([dupe]);
    const base = read([]);
    expect(r.elements.length).toBe(base.elements.length);
    expect(r.open.length).toBe(base.open.length);
    expect(r.curation.elements).toHaveLength(0);
    const p = r.curation.proposals[0];
    expect(p.alreadyModelled).toBe("el:entity:case");   // visible, not silently dropped
  });

  it("two gap questions about ONE missing thing converge on one element, not two", () => {
    const m2 = mintProposal({ name: "Sterilisation Tray", fromKit: "Where are sterilisation trays stored?", by: "op", at: "2026-08-10T12:00:00.000Z" })!;
    const r = read([MINT, m2]);
    expect(proposedElementsIn(r.store)).toHaveLength(1);
    expect(r.open.filter((i) => isProposedLocus(i.about))).toHaveLength(1);
    expect(r.curation.proposals[0].fromKit).toEqual([GAP, "Where are sterilisation trays stored?"]); // both kept
    expect(r.curation.proposals[0].by).toBe("operator@brillio");  // the original proposer stands
  });
});

describe("a proposal is a real, closable question — and never outranks evidence", () => {
  it("an attributed answer supersedes the minted ?unknown and it leaves the queue", () => {
    // Promotion rehearsal on a SCRATCH store (the overlay itself is read-only by design).
    const scratch = createLedgerStore();
    const p = [...foldProposals([MINT]).values()][0];
    scratch.addElement({ id: p.elementId, kind: p.elementKind, name: p.name });
    const c = proposalClaim(p);
    scratch.assert({ about: c.about, value: { kind: "unknown" }, world: c.world, layer: c.layer, source: c.source, ownerWhileOpen: c.ownerWhileOpen });
    expect(buildUnknownQueue(scratch).items.filter((i) => i.status === "open")).toHaveLength(1);
    scratch.assert({
      about: c.about, value: { kind: "scalar", value: "the tray set a case needs, by procedure" },
      world: "to-be", layer: "domain", source: "asserted", ownerWhileOpen: { kind: "unowned" },
      status: "closed", closedBy: { method: "assertion", by: "Dr. Rao", verbatim: "that's what we call it" },
    });
    expect(buildUnknownQueue(scratch).items.filter((i) => i.status === "open")).toHaveLength(0);
    expect(scratch.liveClaimsAbout(c.about).every((x) => x.source === "asserted")).toBe(true);
    expect(buildHeardRegister(scratch).total).toBe(1);   // the ANSWER is heard, the proposal never was
  });
});
