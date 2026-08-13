/**
 * useProgramLedger — the ONE in-browser read path onto the claims ledger, shared
 * by every surface so they can never again show three different numbers for the
 * same thing.
 *
 * It migrates THIS program's committed artifacts on the fly (ontology + atlas +
 * operator overrides), read-only — exactly what LedgerLensPanel did inline, now
 * lifted so the kit, the Design Loop, the artifact views and the stats header all
 * read the identical store and the identical projections.
 *
 * HONESTY, stated once here so every consumer inherits it:
 *  - This is a read-only migration of committed artifacts. It is NOT the persisted
 *    server ledger (Option A / Postgres), which is gated on the model key + binder.
 *    In-browser it yields ~955 claims where the stored ledger has ~1211 (the fuller
 *    generated unknown-set is server-side). So counts here are HONEST reads of what
 *    the browser can compute, and DIVERGE from the persisted figures — consumers mark
 *    the per-area / persisted layers provisional rather than borrow the server numbers.
 *  - Stakeholder `asserted` closures arrive through the store write path, which is not
 *    wired in-browser — so `ownership.stakeholder` is 0 here by construction. That 0 is
 *    the truth of the read model, not a fabrication; it is the gated "stakeholders
 *    shape it" state, surfaced, never hidden behind a tidy "N of N heard".
 */
import { useMemo } from "react";
import type { ProgramSummary } from "@/new/types";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { readMovementInputs } from "@/v3/components/flow/flowShellData";
import { migrate, migrationStats, ownerRoleLabelForArea, type Snapshot, type MigrationStats } from "./migrate";
import {
  buildUnknownQueue, buildKitView, buildDeviationRegister, buildHeardRegister,
  buildOntologyView, buildAtlasView, openOwnerQuestions, dictionaryBucket,
  type UnknownQueue, type KitView, type Deviation, type HeardRegister,
  type OntologyElementView, type WorkflowView, type QueueItem,
} from "./projections";
import { buildReadModel } from "./readModel";
import { projectKitQuestions, type KitQuestion } from "./kitProjection";
import { deriveArtifactAsks, parseDeclaredSors, type ArtifactAskMark, type ArtifactAskView, systemOfRecordQuestionOverlay } from "./artifactAsks";
import { reconcile } from "./merge";
import { readDictionarySources, dictionaryToClaims, TYPING_SLOTS } from "./dictionary";
import { deriveRoles } from "@shared/semanticRoles.ts";
import {
  derivedTypeProposals, derivedTypeClaims, derivedTypeSuggestions,
  type DerivedTypeProposal, type AttributeRoleLike,
} from "./derivedTypes";
import { lifecycleLoci, lifecycleQuestionOverlay } from "./lifecycle";
import type { LedgerStore } from "./store";
import { isLive, slotOf } from "./types";
import {
  readOperatorActions, foldOwnership, applyOwnership, activeAssignments, activePins,
  decidedFates, derivePinConflicts, baselineOwnerLabels,
  type OperatorAction, type AssignAction, type ScheduleAction, type CaptureAction,
  type DecideFateAction, type RedirectAction, type PinAction, type PinConflict,
} from "./operatorActions";
import { proposalOverlay, type MintedProposal } from "./curation";

/** Ownership by SOURCE CLASS, the ledger's own encoding (not an invented taxonomy):
 *  operator = decision/dispositioned · stakeholder = asserted · joint = a locus with
 *  both · draft = machine-proposed only (generated/code-derived/external-standard),
 *  awaiting either a decision or an assertion. Computed in this surface layer over the
 *  read model — the frozen projections' data logic is untouched. */
export type OwnershipClass = "operator" | "stakeholder" | "joint" | "draft";
export interface OwnershipSummary {
  operator: number; stakeholder: number; joint: number; draft: number; total: number;
  /** live-claim histogram by raw source class, for the source-legibility surfaces. */
  bySource: Record<string, number>;
}
const OPERATOR_SOURCES = new Set(["decision", "dispositioned"]);
const STAKEHOLDER_SOURCES = new Set(["asserted"]);

/** The ownership class of a single locus, given the live sources present on it. */
export function ownershipOf(sources: Iterable<string>): OwnershipClass {
  let op = false, stk = false;
  for (const s of sources) { if (OPERATOR_SOURCES.has(s)) op = true; if (STAKEHOLDER_SOURCES.has(s)) stk = true; }
  return op && stk ? "joint" : op ? "operator" : stk ? "stakeholder" : "draft";
}

function ownershipSummary(store: LedgerStore): OwnershipSummary {
  const live = store.claims().filter(isLive);
  const bySource: Record<string, number> = {};
  const perLocus = new Map<string, Set<string>>();
  for (const c of live) {
    bySource[c.source] = (bySource[c.source] ?? 0) + 1;
    (perLocus.get(c.about) ?? perLocus.set(c.about, new Set()).get(c.about)!).add(c.source);
  }
  const out: OwnershipSummary = { operator: 0, stakeholder: 0, joint: 0, draft: 0, total: perLocus.size, bySource };
  for (const sources of perLocus.values()) out[ownershipOf(sources)] += 1;
  return out;
}

/** One frozen locus for the adjudicate queue: which locus, which slot, and how many
 *  LIVE CLAIMS are standing on it. */
export interface ConflictRead { about: string; slot: string; count: number }

/**
 * READ-SIDE CONFLICTS — the loci an operator has to adjudicate.
 *
 * A contradiction is stored as LINKS between claims, and `store.resolve` returns them
 * as PAIRS, deduped by claim-pair key (store.ts conflictsFor). So two contradicting
 * live claims — the ordinary case, produced by `store.assert` itself when it escalates
 * or lets same-world claims coexist, with no explicit `contradict()` call anywhere —
 * yield exactly ONE pair. The gate here read `> 1`, i.e. "more than one PAIR", which a
 * locus only reaches at THREE mutually contradicting claims. Two execs disagreeing froze
 * the element and then reached nobody: the adjudicate section and its stat never
 * rendered and the rail badge never moved. The gate is the presence of a contradiction,
 * so it is `> 0`.
 *
 * `count` is `live.length` — CLAIMS, not pairs — because the row it feeds reads
 * "frozen · N live claims". Pairs would have printed "1 live claim" over two of them.
 *
 * Pure over the store's own reads (surface layer): the frozen core is untouched.
 */
export function readConflicts(store: LedgerStore): ConflictRead[] {
  const out: ConflictRead[] = [];
  const seenAbout = new Set<string>();
  for (const c of store.claims()) {
    if (!isLive(c) || seenAbout.has(c.about)) continue;
    seenAbout.add(c.about);
    const r = store.resolve(c.about);
    if (r.conflicts && r.conflicts.length > 0) out.push({ about: c.about, slot: slotOf(c.about), count: r.live.length });
  }
  return out;
}

export interface ProgramLedger {
  store: LedgerStore;
  stats: MigrationStats;
  queue: UnknownQueue;
  kit: KitView;
  /** One dictionary ask per system of record — Frame-born, inbox only while unprovided. */
  artifactAsks: ArtifactAskView;
  devs: Deviation[];
  heard: HeardRegister;
  ontology: OntologyElementView[];
  atlas: WorkflowView[];
  ownership: OwnershipSummary;
  /** unowned + seam bands (the loud signals), pulled from the kit view for reuse. */
  unownedBands: KitView["bands"];
  seamBands: KitView["bands"];
  /** Operator verbs (surface layer). ASSIGN + DECIDE-FATE are already applied to the
   *  projections above (ownership/status overlay); captures/schedules/redirects are
   *  annotations the surface carries and were NOT injected as ledger closures. */
  actions: OperatorAction[];
  /** currently-owned loci (active assignments, superseded ones folded out). */
  assignments: AssignAction[];
  schedules: ScheduleAction[];
  captures: CaptureAction[];
  redirects: RedirectAction[];
  /** loci the operator decided the fate of (out-of-scope / escalate). */
  decideFates: DecideFateAction[];
  /** IN-FLIGHT PINS — loci a SENT stakeholder link carries. The ownership overlay
   *  honours these over any fresh derivation and over any later assign, so a
   *  question already on someone's link cannot change hands silently. */
  pins: PinAction[];
  /** the pinned loci, for a surface that wants to mark a row "on a sent link". */
  pinnedAbouts: Set<string>;
  /** The pin DECISIONS: open unknowns where a fresh derivation (or a later routing
   *  action) wants a different owner than the person the question is in flight to.
   *  The pin still holds — this is an operator decision queue, never a sweep. */
  pinConflicts: PinConflict[];
  /** CURATION — elements PROPOSED from ontology-gap kit questions (curation.ts). Each
   *  standing proposal contributed exactly one open `?unknown` to the read model above,
   *  overlaid, never written to the store. A proposal whose concept the ontology already
   *  holds minted nothing and carries `alreadyModelled` instead. */
  proposals: MintedProposal[];
  /** the proposed loci — a surface marks a row PROPOSED from this, never re-deriving. */
  proposedAbouts: Set<string>;
  /** loci with an operator-entered capture — shown provisional, never counted as heard. */
  capturedAbouts: Set<string>;
  /** read-side conflicts: a locus frozen by contradicting live claims. `count` is
   *  the LIVE CLAIMS on it — see readConflicts. */
  conflicts: ConflictRead[];
  /** THE ONE unowned number — open-unknowns (open or blocked) nobody owns. Every
   *  surface that says "unowned" reads this, so the Work header and the goal strip
   *  can never diverge again (they read 6 vs 5 before). = queue.counts.unowned. */
  unownedOpen: number;
  /** Solo-answerable OPEN unknowns grouped by the ledger owner-label that owns them
   *  (role owners only — seams are joint and never here). This is the single source
   *  for "a person's questions": a roster person maps to owner-label(s) via the
   *  ledger's own function mapping, and reads THEIR loci here — not area-inherited
   *  questions. Kills the turf over-count (the same locus can't land under two
   *  different owners). */
  soloByOwner: Map<string, QueueItem[]>;
  /** The session queue: seam (jointly-owned) questions grouped by function pair.
   *  A jointly-owned locus is a SESSION question, never a solo one — it lives here,
   *  not on any individual's async list. The inbox Sessions panel reads this. */
  sessionQueue: Array<{ pair: string; abouts: string[]; items: QueueItem[] }>;
  /** Open TYPING loci (dataType / valueSet / optionality) — the "what type is X?" wall.
   *  These are REROUTED off individual domain-expert lists (excluded from soloByOwner):
   *  a data dictionary answers them in one upload from the SYSTEM owner, not N form
   *  fields from the domain expert. If a dictionary is applied, most are already closed
   *  and this shrinks to the genuinely-contested typing residue. */
  typingLoci: QueueItem[];
  /** The applied data dictionary's name, or null — when set, the typing wall self-closed
   *  from it (code-derived · weak, deviatable). */
  dictionaryName: string | null;
  /** Types Aura PROPOSED by reading the field names, for loci nothing else answered.
   *  `code-derived · weak` — deviatable by anyone. Exposed so a surface can say how
   *  many questions left the wall this way: a burn-down that shrinks because the
   *  machine guessed must SAY the machine guessed. */
  derivedTypes: DerivedTypeProposal[];
  /** A suggested type for each STILL-OPEN typing locus — below the assert floor, so
   *  never written: it seeds the answer a confirmation grid offers. */
  typeSuggestions: DerivedTypeProposal[];
  /** The ASSIGN queue — unowned questions that genuinely need a HUMAN owner: NON-typing
   *  (phase / decision / …). Typing questions are excluded (they route to the dictionary,
   *  not to a person). So burn-down `unownedOpen` = assignQueue.length + the unowned slice
   *  of `typingLoci` — a decomposition by KIND, no double-count, no drop. */
  assignQueue: QueueItem[];
}

/** Build the read-only ledger + every projection for a program. Memoized on the
 *  program reference so a surface can call it freely. */
export function useProgramLedger(program?: ProgramSummary): ProgramLedger {
  return useMemo(() => {
    const inner = (((program?.rawData as { data?: Record<string, unknown> } | undefined)?.data) ?? {}) as Record<string, unknown>;
    const overrides = Array.isArray(inner.flowOperatorOverrides) ? inner.flowOperatorOverrides as Array<Record<string, unknown>> : [];
    const snap: Snapshot = {
      ontology: (program ? (readArtifactDoc(program, "domainOntology") as Record<string, unknown>) : {}) ?? {},
      atlas: (program ? (readArtifactDoc(program, "currentStateAtlas") as Record<string, unknown>) : {}) ?? {},
      overrides,
    };
    const migrated = migrate(snap);

    // ── data-dictionary import (the PRIMARY typing-close path) ──
    // The client's dictionaries (fingerprint-safe `_dataDictionary` — a CSV string, a
    // pre-parsed {name,fields}, or a KEYED map of one per system of record) are parsed
    // and reconciled into the store through the SAME reconcile() the FHIR/Salesforce
    // adapters use. They fill the dataType/valueSet/optionality unknowns as
    // `code-derived · weak` — deviatable. No new mechanism; one more source feeding
    // proven machinery. EVERY source is imported: the claims a Finance dictionary
    // closes are as real as the CRM one's.
    let dictionaryName: string | null = null;                 // the programme-wide upload
    const dictionaryBySor = new Map<string, string>();        // lowercased SoR → its own dictionary
    const listenInputs = program ? readMovementInputs(program, "listen") : undefined;
    const dictRaw = (listenInputs as Record<string, unknown> | undefined)?._dataDictionary;
    for (const { sor, dict } of readDictionarySources(dictRaw)) {
      if (!dict.fields.length) continue;   // an unparsable upload closes nothing — and says so
      const { batch, elements } = dictionaryToClaims(dict, new Set(migrated.elements().map((e) => e.id)));
      for (const e of elements) migrated.addElement(e);
      reconcile(migrated, batch, new Set(migrated.elements().map((e) => e.id)));
      const name = dict.name || "uploaded-dictionary";
      if (sor) dictionaryBySor.set(sor.trim().toLowerCase(), name);
      else dictionaryName = name;
    }

    // ── derived types (the LAST word, and the weakest) ──
    // Aura's own semantic-role reader already types these field names — it is how
    // the prototype renders a currency column — so asking a person "what type of
    // value is Account.annual revenue?" was asking for something already worked
    // out. Seeded AFTER every real source, over the loci still OPEN, so an
    // uploaded dictionary always wins and a heuristic only ever fills a gap.
    // `code-derived · weak`, deviatable, and counted separately as PROPOSED —
    // these are readings of a name, not knowledge of the client's business.
    let suggestions: DerivedTypeProposal[] = [];
    const derivedTypes: DerivedTypeProposal[] = (() => {
      const ontologyDoc = snap.ontology;
      if (!ontologyDoc || typeof ontologyDoc !== "object") return [];
      const openTypeLoci = new Set(
        buildUnknownQueue(migrated).items
          .filter((i) => i.status === "open" && i.slot === "dataType")
          .map((i) => i.about),
      );
      if (!openTypeLoci.size) return [];
      let roles: AttributeRoleLike[] = [];
      try {
        roles = (deriveRoles(ontologyDoc as Record<string, unknown>).attributeRoles ?? []) as AttributeRoleLike[];
      } catch { return []; }   // a reading that throws proposes nothing
      const proposals = derivedTypeProposals(roles, openTypeLoci);
      if (proposals.length) reconcile(migrated, derivedTypeClaims(proposals), new Set(migrated.elements().map((e) => e.id)));
      // What is STILL open now carries a below-floor reading — too weak to assert,
      // strong enough to pre-answer the question. Kept for the grid's defaults.
      const stillOpen = new Set(
        buildUnknownQueue(migrated).items
          .filter((i) => i.status === "open" && i.slot === "dataType")
          .map((i) => i.about),
      );
      suggestions = derivedTypeSuggestions(roles, stillOpen);
      return proposals;
    })();

    // ── artifact-ask marks (preventive dictionary ask, one per SoR) — same
    //    fingerprint-safe underscore pattern as the dictionary itself ──
    const askMarksRaw = (listenInputs as Record<string, unknown> | undefined)?._artifactAsks;
    const askMarksArr = typeof askMarksRaw === "string"
      ? (() => { try { return JSON.parse(askMarksRaw) as unknown; } catch { return []; } })()
      : askMarksRaw;
    const askMarks: ArtifactAskMark[] = Array.isArray(askMarksArr)
      ? (askMarksArr.filter((m): m is ArtifactAskMark => !!m && typeof m === "object" && typeof (m as ArtifactAskMark).sor === "string"))
      : [];

    // ── operator verbs, applied as a surface overlay over the read model ──
    // ASSIGN re-derives ownership (unowned → owned-and-open) by re-pointing the open
    // claim's owner; the projections below then read the assigned state. buildReadModel
    // is the DB read-model constructor — no store/precedence code is touched.
    const actions = readOperatorActions(listenInputs);
    const schedules = actions.filter((a): a is ScheduleAction => a.kind === "schedule");
    const captures = actions.filter((a): a is CaptureAction => a.kind === "capture");
    const redirects = actions.filter((a): a is RedirectAction => a.kind === "redirect");
    const fold = foldOwnership(actions);
    // ── CURATION overlay: elements PROPOSED from ontology-gap kit questions, each with
    // the one `?unknown` it opens. Same shape as the ownership overlay — appended to what
    // buildReadModel is handed, never written into the frozen store. Provisional (id
    // prefix `el:proposed:`), attributed (who/which question/when), reversible
    // (`retract-mint`), and never minted over a concept the ontology already holds.
    const curation = proposalOverlay(actions, migrated.elements());
    // A CONFIDENT LIFECYCLE'S STAGE QUESTION IS BORN IF IT DOES NOT EXIST. Five of
    // Laila New's seven had no `#valueSet` claim at all, so the finding could never
    // reach anyone: no card, no bucket, no question. Overlay only — the frozen store
    // is untouched, exactly as the curation proposals above.
    const lifecycleBorn = lifecycleQuestionOverlay(migrated);
    // "WHICH SYSTEM HOLDS THIS?" — same gap, same fix. 37 typing questions sat on
    // entities with no system of record and not one of those entities had the
    // question anywhere, so the block reporting them could only describe them.
    const sorBorn = systemOfRecordQuestionOverlay(migrated);
    const overlaid = [...curation.claims, ...lifecycleBorn, ...sorBorn];
    const withProposals = overlaid.length ? [...migrated.claims(), ...overlaid] : migrated.claims();
    // ── in-flight PINNING: the BASELINE owner per open locus, read ONCE off the
    // pre-overlay claims — "who would own this if no link had gone out". It exists
    // solely to DETECT a disagreement; the overlay below still hands the locus to the
    // pinned recipient, and the disagreement goes to the operator as a decision.
    const baselineOwner = baselineOwnerLabels(withProposals, activeAssignments(actions));
    const pinConflicts = derivePinConflicts(fold, (about) => baselineOwner.get(about) ?? "", ownerRoleLabelForArea);
    const store = fold.size || curation.elements.length || lifecycleBorn.length || sorBorn.length
      ? buildReadModel([...migrated.elements(), ...curation.elements], applyOwnership(withProposals, fold))
      : migrated;
    const assignedActions = [...activeAssignments(actions).values()];
    const pins = [...activePins(actions).values()];
    const decideFates = [...decidedFates(actions).values()];

    // read-side conflicts: precedence leaves contradicting live claims on one locus.
    // ONE definition, above, over the read model (surface layer) — store/projections
    // untouched.
    const conflicts = readConflicts(store);

    const kit = buildKitView(store);
    const queue = buildUnknownQueue(store);

    /**
     * AN ASSIGNMENT IS SPENT WHEN ITS QUESTION IS.
     *
     * `activeAssignments` folds the operator's OWN verbs — assign, unassign,
     * decide-fate — and nothing else. So the only things that could ever end an
     * in-flight row were the operator ending it by hand. The event that actually
     * matters, the QUESTION BEING ANSWERED, was invisible to it: a claim landing on
     * the locus closes it on the burn-down, removes it from Discover, and leaves the
     * Inbox still saying "awaiting Sales Operations SME" for ever.
     *
     * Reported as "why not clearing". Every other route out of the queue has the
     * same hole — a dictionary upload answering a typing question, an adjudication
     * settling a frozen locus, a curation removing the element underneath it.
     *
     * The queue is the ONE definition of what is still open (open OR blocked live
     * claims), so an assignment is in flight exactly while its locus is in it. Not a
     * new rule: the same one the burn-down, Discover and the badge already use.
     */
    const openAbouts = new Set(queue.items.map((i) => i.about));
    const assignments = assignedActions.filter((a) => openAbouts.has(a.about));
    // ONE ask per system of record, born at SoR identification (derivation) — the
    // preventive dictionary ask, projected to Frame readiness, Discover, and the inbox.
    // Identification happens on EITHER surface: the sponsor's Frame input names systems
    // before any ontology exists, and the ontology's entities carry them afterwards.
    // Merged case-insensitively inside the derivation — one system, one ask, always.
    const declaredSors = parseDeclaredSors(
      (program ? readMovementInputs(program, "frame") : undefined)?.systemsOfRecord,
    );
    const artifactAsks = deriveArtifactAsks(store, { marks: askMarks, dictionaryName, declaredSors, dictionaryBySor });
    // Kit questions ARE the open unknowns, phrased for humans — the SAME source the
    // operator queue reads (buildUnknownQueue), never a separately-generated list. One
    // list, so the stakeholder's kit and the operator's queue can't drift.
    const kitQuestions: KitQuestion[] = projectKitQuestions(store);

    // ── one derivation of "a person's questions" and "the session queue" ──
    // Solo-answerable OWNED loci, grouped by owner-label (role owners only). A seam
    // (joint) locus is a session question — collected separately, never on a solo
    // list. Both computed once here so counts and lists across every surface agree.
    // THE single definitions (projections.ts), computed once and read by every surface:
    //  · assignQueue = "need a human owner" = inbox count/list = burn-down "unowned".
    //  · typingLoci  = the data-dictionary bucket (typing questions → system owner).
    // Conservation (asserted in tests): all-unowned = assignQueue + the unowned slice of
    // typingLoci — nothing vanishes, nothing double-counted.
    const assignQueue = openOwnerQuestions(queue);
    /**
     * A LIFECYCLE'S STAGES ARE ASKED OF PEOPLE, NOT CHASED FROM A SCHEMA.
     *
     * Every `#valueSet` locus went to the dictionary bucket, which excludes it from
     * `soloByOwner` — so "what stages does an Opportunity go through" sat on NOBODY's
     * card, waiting on a document, while the Discover strip that found it could only
     * describe it. That is the opposite of the direction it was built for: lifecycle
     * stages are confirmed during Listen, by the people who move the thing.
     *
     * Only CONFIDENT readings move (name plus a second signal — see lifecycle.ts). A
     * one-signal guess must not put a question on a person's link.
     */
    const lifecycleAsks = lifecycleLoci(store);
    const typingLoci = dictionaryBucket(queue)
      .filter((i) => !lifecycleAsks.has(i.about))
      // …and never a seam. A question counted in both buckets is the same question
      // waiting on two different answers, which is how a burn-down starts lying.
      .filter((i) => i.owner.kind !== "joint");
    const soloByOwner = new Map<string, QueueItem[]>();
    const sessionMap = new Map<string, QueueItem[]>();
    for (const it of queue.items) {
      // A SEAM OUTRANKS THE TYPING ROUTE, and this order is the whole of it.
      //
      // Measured on Laila New: ALL ELEVEN of its jointly-owned questions are
      // `#optionality` on a relation — "does every Account need a Territory, or is
      // that optional?" — and `optionality` is a typing slot, so every one was
      // skipped to the dictionary on the line below before this check ever ran. The
      // Sessions section had nothing to draw, on a programme with four live seams.
      //
      // A dictionary can tell you a column is nullable. It cannot tell you whether
      // the business REQUIRES a Territory on every Account, and it certainly cannot
      // settle that when Sales Leaders and Sales Ops own the answer jointly — that is
      // a disagreement between two functions, which is exactly what a seam is and
      // exactly what a joint session is for. Joint ownership therefore wins: the
      // question goes to the people who have to agree, not to a document.
      if (it.owner.kind === "joint") {
        (sessionMap.get(it.ownerLabel) ?? sessionMap.set(it.ownerLabel, []).get(it.ownerLabel)!).push(it);
        // …AND IT GOES TO BOTH OWNERS, like every other question.
        //
        // It used to `continue` here, so a jointly-owned question reached NOBODY on
        // Discover: it existed only as a seam waiting for the operator to book a
        // meeting, and until that meeting happened nobody was ever asked. That makes
        // the operator the bottleneck on the one class of question they cannot answer.
        //
        // Both owners owe it, so it goes on both lists and rides out on both links
        // like anything else. If they answer the same, it is settled without a room.
        // If they answer differently, that is a CONTRADICTION — which this ledger
        // already detects, logs and routes to adjudication. The seam view below stays
        // as the operator's sight of a cross-area dependency, and a joint session
        // becomes something they may CHOOSE rather than the only path through.
        //
        // A blocked one still does not go out: it is held for a named authority.
        if (it.status === "open") {
          for (const party of it.owner.parties) {
            (soloByOwner.get(party) ?? soloByOwner.set(party, []).get(party)!).push(it);
          }
        }
        continue;
      }
      // typing → dictionary bucket, EXCEPT a lifecycle's stages, which are a person's
      // to state and fall through to their card below.
      if (it.status === "open" && TYPING_SLOTS.has(it.slot) && !lifecycleAsks.has(it.about)) continue;
      if (it.owner.kind !== "role" || it.status !== "open") continue;    // unowned → assignQueue; blocked → needs unsticking
      (soloByOwner.get(it.ownerLabel) ?? soloByOwner.set(it.ownerLabel, []).get(it.ownerLabel)!).push(it);
    }
    const sessionQueue = [...sessionMap.entries()]
      .map(([pair, items]) => ({ pair, items, abouts: items.map((i) => i.about) }))
      .sort((a, b) => b.items.length - a.items.length || a.pair.localeCompare(b.pair));

    return {
      store,
      stats: migrationStats(store),
      queue,
      kit,
      kitQuestions,   // the one projection: open unknowns phrased for humans (kit === queue)
      artifactAsks,   // one dictionary ask per SoR — Frame-born, inbox only while unprovided
      devs: buildDeviationRegister(store),
      heard: buildHeardRegister(store),
      ontology: buildOntologyView(store),
      atlas: buildAtlasView(store),
      ownership: ownershipSummary(store),
      unownedBands: kit.bands.filter((b) => b.kind === "unowned"),
      seamBands: kit.bands.filter((b) => b.kind === "seam"),
      actions,
      assignments,
      schedules,
      captures,
      redirects,
      decideFates,
      pins,
      pinnedAbouts: new Set(pins.map((p) => p.about)),
      pinConflicts,
      proposals: curation.proposals,
      proposedAbouts: curation.abouts,
      capturedAbouts: new Set(captures.map((c) => c.about)),
      conflicts,
      unownedOpen: assignQueue.length,   // burn-down "unowned" === inbox "need an owner" — ONE read
      soloByOwner,
      sessionQueue,
      typingLoci,
      dictionaryName,
      derivedTypes,
      typeSuggestions: suggestions,
      assignQueue,
    };
  }, [program]);
}
