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
import { migrate, migrationStats, type Snapshot, type MigrationStats } from "./migrate";
import {
  buildUnknownQueue, buildKitView, buildDeviationRegister, buildHeardRegister,
  buildOntologyView, buildAtlasView,
  type UnknownQueue, type KitView, type Deviation, type HeardRegister,
  type OntologyElementView, type WorkflowView, type QueueItem,
} from "./projections";
import { buildReadModel } from "./readModel";
import { reconcile } from "./merge";
import { parseDictionaryCsv, dictionaryToClaims, TYPING_SLOTS, type ParsedDictionary } from "./dictionary";
import type { LedgerStore } from "./store";
import { isLive, slotOf } from "./types";
import {
  readOperatorActions, foldOwnership, applyOwnership, activeAssignments, decidedFates,
  type OperatorAction, type AssignAction, type ScheduleAction, type CaptureAction,
  type DecideFateAction, type RedirectAction,
} from "./operatorActions";

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
    // If the client uploaded a data dictionary (fingerprint-safe `_dataDictionary` — CSV
    // string, or a pre-parsed {name,fields}), parse it and reconcile its claims into the
    // store through the SAME reconcile() the FHIR/Salesforce adapters use. It fills the
    // dataType/valueSet/optionality unknowns as `code-derived · weak` — deviatable. No new
    // mechanism; one more source feeding proven machinery.
    let dictionaryName: string | null = null;
    const listenInputs = program ? readMovementInputs(program, "listen") : undefined;
    const dictRaw = (listenInputs as Record<string, unknown> | undefined)?._dataDictionary;
    if (dictRaw) {
      const dict: ParsedDictionary = typeof dictRaw === "string"
        ? parseDictionaryCsv(dictRaw)
        : (dictRaw as ParsedDictionary);
      if (dict?.fields?.length) {
        const { batch, elements } = dictionaryToClaims(dict, new Set(migrated.elements().map((e) => e.id)));
        for (const e of elements) migrated.addElement(e);
        reconcile(migrated, batch, new Set(migrated.elements().map((e) => e.id)));
        dictionaryName = dict.name || "uploaded-dictionary";
      }
    }

    // ── operator verbs, applied as a surface overlay over the read model ──
    // ASSIGN re-derives ownership (unowned → owned-and-open) by re-pointing the open
    // claim's owner; the projections below then read the assigned state. buildReadModel
    // is the DB read-model constructor — no store/precedence code is touched.
    const actions = readOperatorActions(listenInputs);
    const schedules = actions.filter((a): a is ScheduleAction => a.kind === "schedule");
    const captures = actions.filter((a): a is CaptureAction => a.kind === "capture");
    const redirects = actions.filter((a): a is RedirectAction => a.kind === "redirect");
    const fold = foldOwnership(actions);
    const store = fold.size
      ? buildReadModel(migrated.elements(), applyOwnership(migrated.claims(), fold))
      : migrated;
    const assignments = [...activeAssignments(actions).values()];
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

    // ── one derivation of "a person's questions" and "the session queue" ──
    // Solo-answerable OWNED loci, grouped by owner-label (role owners only). A seam
    // (joint) locus is a session question — collected separately, never on a solo
    // list. Both computed once here so counts and lists across every surface agree.
    const soloByOwner = new Map<string, QueueItem[]>();
    const sessionMap = new Map<string, QueueItem[]>();
    const typingLoci: QueueItem[] = [];
    for (const it of queue.items) {
      // TYPING questions ("what type is X?") REROUTE to the system owner as one
      // "upload your data dictionary" ask — never N questions to a domain expert.
      if (it.status === "open" && TYPING_SLOTS.has(it.slot)) { typingLoci.push(it); continue; }
      if (it.owner.kind === "joint") { (sessionMap.get(it.ownerLabel) ?? sessionMap.set(it.ownerLabel, []).get(it.ownerLabel)!).push(it); continue; }
      if (it.owner.kind !== "role" || it.status !== "open") continue; // unowned → the assign queue; blocked → needs unsticking; both are not a solo "send a link"
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
      capturedAbouts: new Set(captures.map((c) => c.about)),
      conflicts,
      unownedOpen: queue.counts.unowned,
      soloByOwner,
      sessionQueue,
      typingLoci,
      dictionaryName,
    };
  }, [program]);
}
