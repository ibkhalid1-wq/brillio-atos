/**
 * THE CURATION PATH — minting a PROPOSED element (and the one `?unknown` it opens)
 * from an ontology-gap kit question, as a SURFACE-LAYER overlay.
 *
 * The gap this closes (docs/aura/kit-question-projection.md): `reconcileKit` classifies
 * an unmatched kit question as `ontology-gap` — "the kit knows a thing the ontology
 * missed" — but there was NO way to act on one. Curation was dismiss/defer only
 * (`_curationLog`, `_dismissedAsks`), so a real finding could be filed away and never
 * turned into a question anyone owns.
 *
 * The shape, deliberately identical to the operator verbs that came before it:
 *  · A mint is an OPERATOR ACTION on the existing `_operatorActions` underscore field,
 *    written through the ONE write path (`useOperatorCommits`, `{silent:true}`). No new
 *    channel, no second write path.
 *  · It is applied as a READ-MODEL OVERLAY in `useProgramLedger` — the minted element and
 *    its claim are appended to what `buildReadModel` is handed, exactly the way
 *    `applyOwnership` overlays ownership. THE FROZEN CORE IS NOT TOUCHED: nothing here
 *    calls `store.addElement` / `store.assert`, and no claim is persisted.
 *  · REVERSIBLE — `retract-mint` removes it cleanly; the fold replays the log, so a
 *    retracted proposal leaves the read model in exactly its pre-mint state.
 *
 * The four honesty rules it holds:
 *  1. PROVISIONAL + MARKED. Every minted element id carries the `el:proposed:` prefix,
 *     so a proposal is never indistinguishable from an evidence-grounded element — at a
 *     glance, in a log, or in a locus id. `isProposedLocus(about)` is the one predicate.
 *  2. ATTRIBUTED. Who proposed it, from WHICH kit question, and when — carried on the
 *     action and surfaced on `MintedProposal`.
 *  3. NO FABRICATION. The element NAME is operator-supplied; nothing here invents a noun
 *     out of free-text question tokens (`mintProposal` returns null rather than guess).
 *     The minted claim's value is `?unknown` and its owner is `unowned`: a proposal
 *     asserts only that THERE IS A QUESTION HERE, never what the answer or the owner is.
 *  4. ONE DEFINITION. A proposal whose name is already modelled mints NOTHING — it is
 *     reported as `alreadyModelled` pointing at the element that already holds it, so
 *     curation can never fork a second definition of the same concept.
 *
 * Source `dispositioned`: the honest label for an attributed human proposal — it is the
 * WEAKEST human-decision source, so by precedence a proposal can never outrank evidence
 * (`asserted` / `document` / `regulation` all win on the same locus), and because the
 * claim is open with no closure it can never move the heard-count.
 */
import type { LedgerStore } from "./store";
import {
  aboutOf, contentId, elementIdOf,
  type Claim, type ElementKind, type LedgerElement, type World,
} from "./types";
import type { MintElementAction, OperatorAction, RetractMintAction } from "./operatorActions";

/** Every minted element id starts here — the PROPOSED marking, in the id itself. */
export const PROPOSED_ID_PREFIX = "el:proposed";
/** The slot a proposal is born asking. The ontology does not hold this thing at all, so
 *  the first honest unknown about it is what it MEANS (the renderer: "What does X mean,
 *  exactly?"). Not a typing slot — it needs a person, not a data dictionary. */
export const PROPOSAL_SLOT = "semantics";
const PROPOSAL_WORLD: World = "to-be";
const PROPOSAL_SOURCE = "dispositioned";

export const isProposedElementId = (id: string): boolean => id.startsWith(`${PROPOSED_ID_PREFIX}:`);
export const isProposedLocus = (about: string): boolean => isProposedElementId(elementIdOf(about));

/** The identity key a proposal is deduped on: same parent + same name = same concept. */
const conceptKey = (name: string, of?: string): string => `${of ?? ""}|${name.trim().toLowerCase()}`;

export interface MintInput {
  /** The element name — OPERATOR-SUPPLIED. Never derived from the question text. */
  name: string;
  /** The ontology-gap kit question this proposal answers to (attribution, required). */
  fromKit: string;
  by: string;
  at: string;                    // ISO — caller-supplied (no Date.now here; determinism)
  elementKind?: ElementKind;     // default "entity"
  of?: string;                   // parent element id, when proposing an attribute
  slot?: string;                 // default PROPOSAL_SLOT
  reason?: string;
}

/**
 * Build a MINT action. Content-derived ids: the element id is `contentId` over
 * (kind, parent, lower-cased name) — so the SAME proposal always mints the SAME id, and
 * two gap questions about one missing thing converge on ONE element rather than two.
 * Returns null when the input would require inventing something (no name, no source
 * question, no author) — a miss stays a miss.
 */
export function mintProposal(input: MintInput): MintElementAction | null {
  const name = (input.name ?? "").trim();
  const fromKit = (input.fromKit ?? "").trim();
  const by = (input.by ?? "").trim();
  const at = (input.at ?? "").trim();
  if (!name || !fromKit || !by || !at) return null;
  const elementKind: ElementKind = input.elementKind ?? "entity";
  const of = (input.of ?? "").trim() || undefined;
  const slot = (input.slot ?? "").trim() || PROPOSAL_SLOT;
  const elementId = contentId(PROPOSED_ID_PREFIX, elementKind, of ?? "", name.toLowerCase());
  const reason = (input.reason ?? "").trim();
  return {
    kind: "mint-element",
    elementId,
    about: aboutOf(elementId, slot),
    elementKind,
    name,
    ...(of ? { of } : {}),
    slot,
    world: PROPOSAL_WORLD,
    fromKit,
    ...(reason ? { reason } : {}),
    by, at,
  };
}

/** Build the RETRACT action for a minted element (the undo). */
export function retractProposal(elementId: string, by: string, at: string, reason?: string): RetractMintAction | null {
  const id = (elementId ?? "").trim();
  if (!id || !by.trim() || !at.trim()) return null;
  const r = (reason ?? "").trim();
  return { kind: "retract-mint", elementId: id, ...(r ? { reason: r } : {}), by, at };
}

/** A live proposal, as every surface should read it — provisional, attributed, undoable. */
export interface MintedProposal {
  elementId: string;
  about: string;                 // the one open locus it opened
  name: string;
  elementKind: ElementKind;
  of?: string;
  slot: string;
  world: World;
  /** EVERY ontology-gap kit question that minted this concept, in order (attribution). */
  fromKit: string[];
  /** who proposed it and when — the FIRST mint still standing (a re-mint after a retract
   *  is a NEW proposal and carries its own author/date). */
  by: string;
  at: string;
  reason?: string;
  /** Set when the concept is ALREADY MODELLED: the element id that already holds it.
   *  Nothing is minted in that case — the proposal resolves to the existing element. */
  alreadyModelled?: string;
}

/**
 * Fold the action log into the proposals currently STANDING, keyed by element id.
 * Latest state wins per element: a mint creates it, a retract removes it, a later mint
 * re-creates it with fresh attribution. Replay-based, so undo is exact.
 */
export function foldProposals(actions: readonly OperatorAction[]): Map<string, MintedProposal> {
  const m = new Map<string, MintedProposal>();
  for (const a of actions) {
    if (a.kind === "mint-element") {
      const cur = m.get(a.elementId);
      if (cur) {
        if (!cur.fromKit.includes(a.fromKit)) cur.fromKit.push(a.fromKit);
        continue;                                   // same concept, more provenance
      }
      m.set(a.elementId, {
        elementId: a.elementId, about: a.about, name: a.name, elementKind: a.elementKind,
        ...(a.of ? { of: a.of } : {}), slot: a.slot, world: a.world,
        fromKit: [a.fromKit], by: a.by, at: a.at, ...(a.reason ? { reason: a.reason } : {}),
      });
    } else if (a.kind === "retract-mint") {
      m.delete(a.elementId);
    }
  }
  return m;
}

/** The element a standing proposal contributes to the read model. */
export const proposalElement = (p: MintedProposal): LedgerElement =>
  ({ id: p.elementId, kind: p.elementKind, name: p.name, ...(p.of ? { of: p.of } : {}) });

/**
 * The `?unknown` claim a standing proposal opens. Built with the SAME content-id formula
 * `store.assert` uses, so this row is byte-identical to what a future persisted curation
 * write would produce — the overlay is a preview of that write, not a parallel dialect.
 */
export const proposalClaim = (p: MintedProposal): Claim => ({
  id: contentId("cl", p.about, p.world, PROPOSAL_SOURCE, JSON.stringify({ kind: "unknown" })),
  about: p.about,
  value: { kind: "unknown" },
  world: p.world,
  layer: "domain",
  source: PROPOSAL_SOURCE,
  status: "open",
  ownerWhileOpen: { kind: "unowned" },     // nobody owns a thing the ontology never held
  createdAt: p.at,
});

export interface ProposalOverlay {
  /** proposed elements to append to the read model (none for already-modelled concepts). */
  elements: LedgerElement[];
  /** one open `?unknown` per proposed element — exactly one locus per mint. */
  claims: Claim[];
  /** every standing proposal, including the already-modelled ones (visible, not dropped). */
  proposals: MintedProposal[];
  /** the proposed loci, for a surface that marks a row PROPOSED without re-deriving. */
  abouts: Set<string>;
}

/**
 * Build the overlay: the elements + claims `useProgramLedger` appends to the migrated
 * read model. `existing` is the ontology as already modelled — a proposal whose concept
 * is already there mints NOTHING and is reported `alreadyModelled` instead (invariant:
 * one definition per concept, never a curated fork).
 */
export function proposalOverlay(actions: readonly OperatorAction[], existing: readonly LedgerElement[]): ProposalOverlay {
  const proposals = [...foldProposals(actions).values()];
  if (!proposals.length) return { elements: [], claims: [], proposals: [], abouts: new Set() };
  const byConcept = new Map<string, string>();
  for (const e of existing) if (!isProposedElementId(e.id)) byConcept.set(conceptKey(e.name, e.of), e.id);
  const elements: LedgerElement[] = [];
  const claims: Claim[] = [];
  const abouts = new Set<string>();
  const out: MintedProposal[] = [];
  for (const p of proposals) {
    const held = byConcept.get(conceptKey(p.name, p.of));
    if (held) { out.push({ ...p, alreadyModelled: held }); continue; }
    out.push(p);
    elements.push(proposalElement(p));
    claims.push(proposalClaim(p));
    abouts.add(p.about);
  }
  return { elements, claims, proposals: out, abouts };
}

/** The proposals whose concept the ontology already holds — nothing minted, still visible. */
export const alreadyModelledProposals = (o: ProposalOverlay): MintedProposal[] =>
  o.proposals.filter((p) => !!p.alreadyModelled);

/**
 * Convenience for a surface holding a store: the ontology-gap questions this program has
 * ALREADY minted from, so a gap list can show "proposed" instead of re-offering the mint.
 */
export function mintedKitQuestions(actions: readonly OperatorAction[]): Set<string> {
  const out = new Set<string>();
  for (const p of foldProposals(actions).values()) for (const q of p.fromKit) out.add(q);
  return out;
}

/** Are any of this store's elements proposals? (read-model introspection for tests/surfaces) */
export const proposedElementsIn = (store: LedgerStore): LedgerElement[] =>
  store.elements().filter((e) => isProposedElementId(e.id));
