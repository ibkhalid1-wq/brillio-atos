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
import { migrate, migrationStats, type Snapshot, type MigrationStats } from "./migrate";
import {
  buildUnknownQueue, buildKitView, buildDeviationRegister, buildHeardRegister,
  buildOntologyView, buildAtlasView,
  type UnknownQueue, type KitView, type Deviation, type HeardRegister,
  type OntologyElementView, type WorkflowView,
} from "./projections";
import type { LedgerStore } from "./store";
import { isLive } from "./types";

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
    const store = migrate(snap);
    const kit = buildKitView(store);
    return {
      store,
      stats: migrationStats(store),
      queue: buildUnknownQueue(store),
      kit,
      devs: buildDeviationRegister(store),
      heard: buildHeardRegister(store),
      ontology: buildOntologyView(store),
      atlas: buildAtlasView(store),
      ownership: ownershipSummary(store),
      unownedBands: kit.bands.filter((b) => b.kind === "unowned"),
      seamBands: kit.bands.filter((b) => b.kind === "seam"),
    };
  }, [program]);
}
