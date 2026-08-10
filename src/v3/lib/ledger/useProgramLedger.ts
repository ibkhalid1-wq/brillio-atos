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
import { deriveArtifactAsks, parseDeclaredSors, type ArtifactAskMark, type ArtifactAskView } from "./artifactAsks";
import { reconcile } from "./merge";
import { readDictionarySources, dictionaryToClaims, TYPING_SLOTS } from "./dictionary";
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
  /** read-side conflicts: two live claims on one locus (freeze-and-adjudicate). */
  conflicts: Array<{ about: string; slot: string; count: number }>;
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
    const withProposals = curation.claims.length ? [...migrated.claims(), ...curation.claims] : migrated.claims();
    // ── in-flight PINNING: the BASELINE owner per open locus, read ONCE off the
    // pre-overlay claims — "who would own this if no link had gone out". It exists
    // solely to DETECT a disagreement; the overlay below still hands the locus to the
    // pinned recipient, and the disagreement goes to the operator as a decision.
    const baselineOwner = baselineOwnerLabels(withProposals, activeAssignments(actions));
    const pinConflicts = derivePinConflicts(fold, (about) => baselineOwner.get(about) ?? "", ownerRoleLabelForArea);
    const store = fold.size || curation.elements.length
      ? buildReadModel([...migrated.elements(), ...curation.elements], applyOwnership(withProposals, fold))
      : migrated;
    const assignments = [...activeAssignments(actions).values()];
    const pins = [...activePins(actions).values()];
    const decideFates = [...decidedFates(actions).values()];

    // read-side conflicts: precedence leaves two live claims on one locus. Computed
    // over the read model (surface layer) — the projections/store are untouched.
    const conflicts: Array<{ about: string; slot: string; count: number }> = [];
    const seenAbout = new Set<string>();
    for (const c of store.claims()) {
      if (!isLive(c) || seenAbout.has(c.about)) continue;
      seenAbout.add(c.about);
      const r = store.resolve(c.about);
      if (r.conflicts && r.conflicts.length > 1) conflicts.push({ about: c.about, slot: slotOf(c.about), count: r.conflicts.length });
    }

    const kit = buildKitView(store);
    const queue = buildUnknownQueue(store);
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
    const typingLoci = dictionaryBucket(queue);
    const soloByOwner = new Map<string, QueueItem[]>();
    const sessionMap = new Map<string, QueueItem[]>();
    for (const it of queue.items) {
      if (it.status === "open" && TYPING_SLOTS.has(it.slot)) continue;   // typing → dictionary bucket
      if (it.owner.kind === "joint") { (sessionMap.get(it.ownerLabel) ?? sessionMap.set(it.ownerLabel, []).get(it.ownerLabel)!).push(it); continue; }
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
      assignQueue,
    };
  }, [program]);
}
