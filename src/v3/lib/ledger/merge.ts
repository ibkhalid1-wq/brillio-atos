/**
 * Merge algorithm for the write model (docs/aura/ledger-write-model.md).
 *
 * SPEC + PROOF, NOT PERSISTENCE. This runs entirely against the in-memory store to
 * prove the merge design; it writes to no database. When a regeneration produces a
 * new batch of claims (Option A: from the claims-emitting generator; Option B: from
 * re-running migrate() on the new blob), those claims are `reconcile`d into the
 * EXISTING ledger so that no attributed closure is ever overwritten.
 *
 * THE RULES ARE NOT DEFINED HERE. They live in `mergeRules.ts`, because `PgLedger`
 * (`pgStore.ts`) runs the same merge against Postgres and the two must not be able to
 * disagree about what a re-upload means. This file is the in-memory MECHANISM: iterate
 * the batch, ask `mergeRules` what each claim means, mutate the store, count the report.
 * Every `if` about a claim below is a call into `mergeRules`.
 *
 * The rules EXTEND precedence, because precedence compares (source × world) and knows
 * nothing about TIME or PROVENANCE: recency for generated↔generated, recency for
 * same-provenance code-derived (N-4), and the agreeing-duplicate collapse (N-5). Below
 * them everything defers to `resolvePrecedence`. See mergeRules.ts for the full statement.
 */
import { resolvePrecedence } from "./precedence";
import type { LedgerStore, AssertInput } from "./store";
import {
  type ClaimFacts, type MergeReport, collapseDecision, deviates, emptyMergeReport,
  isAttributedClosure, recencyKind, recencySupersedes, substantive, valueEq,
} from "./mergeRules";
import { type Claim, isLive, elementIdOf } from "./types";

// The rules are shared with the persisted path; they are re-exported here so existing
// callers/tests that reach for them via `merge` keep working and cannot get a second copy.
export { importProvenance, type MergeReport } from "./mergeRules";

export type MergeOutcome =
  | "preserve-existing"    // the existing closure/evidence stands; incoming dropped (no overwrite)
  | "supersede-existing"   // incoming (newer generation, or a re-import correcting itself) replaces the existing
  | "fill-unknown"         // incoming value fills an open unknown
  | "corroborate"          // incoming equals an existing claim; one row kept
  | "coexist-conflict"     // same world, equal strength, DIFFERENT provenance — both live, routable
  | "coexist-deviation";   // cross-world; not a conflict — the deviation register's job

/** The INCOMING side of a merge decision. `source` defaults to `generated` because
 *  regeneration output is `generated` (the generation contract's source ceiling) — the
 *  dictionary/adapter path passes `code-derived` plus its `closedBy` provenance. */
export interface MergeIncoming {
  world: ClaimFacts["world"];
  value: ClaimFacts["value"];
  source?: ClaimFacts["source"];
  closedBy?: ClaimFacts["closedBy"];
}

/**
 * The per-cell decision for an INCOMING claim meeting one EXISTING claim on the same
 * locus — the NARRATIVE form of what `reconcile` below does row by row, used by the docs
 * and the rule tests.
 *
 * It states the rules by CALLING them (`recencySupersedes`, `valueEq`, and then the same
 * `resolvePrecedence` everything else defers to), so it cannot describe a merge the merge
 * does not perform. It used to restate the recency arms inline and drifted from
 * `reconcile` on one cell: an `na`-valued generated claim met by a substantive generated
 * one read as `supersede-existing` here while `reconcile` (which requires BOTH sides
 * substantive, as `store.assert` does) coexisted them. The predicate is now the same
 * object in both, so that cell reports what actually happens.
 */
export function mergeDecision(existing: Claim, incoming: MergeIncoming): MergeOutcome {
  const inc: ClaimFacts = {
    world: incoming.world, source: incoming.source ?? "generated",
    value: incoming.value, closedBy: incoming.closedBy,
  };
  if (existing.world !== inc.world) return "coexist-deviation";
  if (existing.value.kind === "unknown" && substantive(inc.value)) return "fill-unknown";
  // Recency rules 1 and 2 (N-4), one predicate: a newer generation, or a re-import from
  // the SAME provenance correcting itself. Two DIFFERENT systems disagreeing is not
  // recency and falls through to precedence below, which coexists it.
  if (recencySupersedes(existing, inc)) return "supersede-existing";
  if (valueEq(existing.value, inc.value)) return "corroborate"; // agreement is one answer (N-5)
  const r = resolvePrecedence({ source: inc.source, world: inc.world }, { source: existing.source, world: existing.world });
  if (r.outcome === "wins") return r.winner === "a" ? "supersede-existing" : "preserve-existing";
  if (r.outcome === "coexist") return "coexist-conflict";
  return "preserve-existing"; // escalate — the existing claim is never dropped; a human decides
}

/**
 * Reconcile a batch of regenerated claims into an existing store. Preserves every
 * attributed closure (precedence guarantees a `generated` claim cannot supersede
 * one), applies the recency rules, collapses agreeing duplicates, fills unknowns, and
 * REPORTS attributed closures whose element the regeneration dropped (orphans) —
 * it never silently deletes them.
 *
 * `incomingElementIds` = the set of element ids the regeneration still produces, so
 * orphans (closures about elements no longer generated) can be flagged.
 */
export function reconcile(store: LedgerStore, incoming: AssertInput[], incomingElementIds: Set<string>): MergeReport {
  const report = emptyMergeReport();
  for (const input of incoming) {
    const liveBefore = store.liveClaimsAbout(input.about).filter((c) => c.world === input.world);
    // recency: a newer claim supersedes a stale one of the same source on the same locus —
    // `generated` (regeneration) or same-provenance `code-derived` (a corrected re-import).
    const stale: Claim[] = [];
    for (const x of liveBefore) {
      if (!recencySupersedes(x, input)) continue;
      // Mark it superseded BEFORE assert so the store's conflict pass does not see it and
      // link the correction to the thing it corrects as a live contradiction. The real
      // winner id is patched in once assert has returned it.
      x.supersededBy = "recency:pending";
      stale.push(x);
      report[recencyKind(input)] += 1;
    }
    const conflictingClosure = liveBefore.find((x) => isAttributedClosure(x) && substantive(x.value) && !valueEq(x.value, input.value) && x.world === input.world);
    const filledU = liveBefore.some((x) => x.value.kind === "unknown");
    const before = store.claims().length;
    const asserted = store.assert(input); // precedence-aware; a generated claim can never supersede an attributed closure
    const added = store.claims().length - before;
    for (const x of stale) x.supersededBy = asserted.id; // point the marker at the claim that actually won
    report.applied += 1;
    if (conflictingClosure) report.preservedClosures += 1;
    else if (filledU) report.filledUnknowns += 1;
    else if (added > 0) report.newClaims += 1;

    // ── N-5: collapse an AGREEING duplicate at write time ──────────────────────────
    // `store.assert` runs precedence only on `valueConflicts` (substantive AND unequal),
    // so two writers closing one locus with the SAME value never resolve and BOTH stay
    // live — and `projections.ts` counts every live claim, so one answer is counted twice
    // in `total` and in `closed + weak`. Agreement is not a conflict, so precedence is
    // asked the question it would have been asked had they disagreed: the stronger source
    // stays live, the agreeing weaker row is kept as history (never deleted). `escalate`
    // and `coexist` are left ALONE — where the lattice cannot decide, both rows stay
    // visible, which is the invariant, not a bug.
    if (isLive(asserted)) {
      for (const x of store.liveClaimsAbout(input.about)) {
        if (x.id === asserted.id) continue;
        const d = collapseDecision(asserted, x);
        if (d === "none") continue;
        if (d === "incoming-supersedes-live") x.supersededBy = asserted.id;
        else asserted.supersededBy = x.id;
        report.collapsedDuplicates += 1;
        if (!isLive(asserted)) break;
      }
    }

    // ── N-11: the deviation count, made reachable ──────────────────────────────────
    // The old test was `liveBefore.some(world === "as-is")` where `liveBefore` had ALREADY
    // been filtered to `input.world` — unsatisfiable, so this field could only ever read 0.
    // A cross-world pair is exactly what `buildDeviationRegister` holds, so the same
    // predicate is used here: substantive on both sides, at least one live claim in the
    // OTHER world, and the incoming value matching none of them.
    if (isLive(asserted) && deviates(asserted, store.liveClaimsAbout(input.about))) report.deviations += 1;
  }
  // orphans: attributed closures about elements the regeneration no longer produces
  for (const c of store.claims()) {
    if (!isLive(c) || !isAttributedClosure(c)) continue;
    const el = elementIdOf(c.about);
    if (!incomingElementIds.has(el)) report.orphanedClosures.push({ about: c.about, by: c.closedBy?.by ?? "?" });
  }
  return report;
}
