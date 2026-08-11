/**
 * Merge algorithm for the write model (docs/aura/ledger-write-model.md).
 *
 * SPEC + PROOF, NOT PERSISTENCE. This runs entirely against the in-memory store to
 * prove the merge design; it writes to no database. When a regeneration produces a
 * new batch of claims (Option A: from the claims-emitting generator; Option B: from
 * re-running migrate() on the new blob), those claims are `reconcile`d into the
 * EXISTING ledger so that no attributed closure is ever overwritten.
 *
 * The merge decision EXTENDS precedence with rules precedence does not have, because
 * precedence compares (source × world) and knows nothing about TIME or PROVENANCE:
 *
 *  1. RECENCY, generated vs generated — two `generated` claims on a locus do not
 *     "coexist" (that would accumulate a stale generation on every regeneration); the
 *     INCOMING (newer) generated supersedes the existing generated.
 *  2. RECENCY, same-provenance `code-derived` (N-4) — a later import from the SAME
 *     named system/dictionary is a CORRECTION of the earlier one, not a rival opinion,
 *     so it supersedes. Two DIFFERENT systems disagreeing is still a genuine conflict
 *     and still coexists.
 *  3. CORROBORATION COLLAPSE (N-5) — two writers landing the SAME value on one locus
 *     are one answer, not two. `store.assert` only consults precedence when the values
 *     CONFLICT, so an agreeing pair leaves two live rows and every live-claim count
 *     (`burnDown.total`, `pctClosed`, `pctSettled`) counts both. The duplicate is
 *     prevented HERE, at write time, rather than hidden at read time.
 *
 * Everything else is precedence.
 */
import { resolvePrecedence, type Source } from "./precedence";
import type { LedgerStore, AssertInput } from "./store";
import { type Claim, type ClaimValue, type Closure, isLive, elementIdOf } from "./types";

const substantive = (v: ClaimValue): boolean => v.kind !== "unknown" && v.kind !== "na";
const valueEq = (a: ClaimValue, b: ClaimValue): boolean => JSON.stringify(a) === JSON.stringify(b);
/** The value kinds `buildDeviationRegister` counts (projections.ts) — kept identical so
 *  `report.deviations` and the register are the same number, not two definitions. */
const devSubstantive = (v: ClaimValue): boolean => v.kind === "scalar" || v.kind === "ref" || v.kind === "ref-list";

/**
 * THE PROVENANCE TOKEN of an imported claim: which named system/dictionary produced it.
 *
 * A `Claim` has **no dedicated provenance field**. `closedBy.by` is the only place the
 * originating system is recorded, and it is only meaningful as a system identity when
 * `closedBy.method === "import"` (for `assertion`/`disposition` it is a person). Every
 * `code-derived` producer in the codebase sets both — `dictionary.ts`
 * (`dictionary:<name>`), `adapters.ts` (`sf-metadata-export`), `migrate.ts`
 * (`prototype`) — so this is readable today WITHOUT a schema change.
 *
 * It returns `null` when provenance is absent or blank, and an absent provenance NEVER
 * matches another absent one: "I cannot tell which system this came from" must not be
 * read as "the same system". Unknown provenance falls through to precedence, i.e. the
 * two readings coexist and the miss stays visible.
 *
 * LIMIT, stated rather than guessed: this token is as fine-grained as its producer made
 * it. `dictionary:<name>` is per-dictionary (good — see `dictionaryProvenance`), but
 * `migrate.ts` stamps every one of its imports `prototype`, so it identifies the
 * PIPELINE, not a system of record. Distinguishing two systems merged by one migrate
 * pass would need a real field — `Claim.provenance` / `AssertInput.provenance`, a stable
 * system-of-record id independent of `closedBy` — which is a frozen-core (`types.ts`,
 * `store.ts`) change and is reported, not guessed at here.
 */
export const importProvenance = (c: { source: Source; closedBy?: Closure }): string | null => {
  if (c.closedBy?.method !== "import") return null;
  const by = (c.closedBy.by ?? "").trim();
  return by ? by : null;
};

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
  world: Claim["world"];
  value: ClaimValue;
  source?: Source;
  closedBy?: Closure;
}

/**
 * The per-cell decision for an INCOMING claim meeting one EXISTING claim on the same
 * locus. `incoming.source` defaults to `generated` — the regeneration batch — and the
 * import batch (`dictionary.ts` / `adapters.ts`) passes `code-derived` with its
 * `closedBy` provenance. Below the two recency rules this DEFERS to `resolvePrecedence`
 * rather than restating the lattice, so there is one definition of who outranks whom.
 */
export function mergeDecision(existing: Claim, incoming: MergeIncoming): MergeOutcome {
  const incomingSource: Source = incoming.source ?? "generated";
  if (existing.world !== incoming.world) return "coexist-deviation";
  if (existing.value.kind === "unknown" && substantive(incoming.value)) return "fill-unknown";
  // Recency rule 1 — generated vs generated: the newer generation replaces the stale one.
  if (existing.source === "generated" && incomingSource === "generated") {
    return valueEq(existing.value, incoming.value) ? "corroborate" : "supersede-existing";
  }
  // Recency rule 2 (N-4) — a re-import from the SAME provenance CORRECTS itself. Applied
  // ONLY when both sides carry the same non-null provenance token, so two DIFFERENT
  // systems disagreeing falls through to precedence below and still coexists.
  if (existing.source === "code-derived" && incomingSource === "code-derived") {
    const p = importProvenance({ source: incomingSource, closedBy: incoming.closedBy });
    if (p !== null && p === importProvenance(existing)) {
      return valueEq(existing.value, incoming.value) ? "corroborate" : "supersede-existing";
    }
  }
  if (valueEq(existing.value, incoming.value)) return "corroborate"; // agreement is one answer (N-5)
  const r = resolvePrecedence({ source: incomingSource, world: incoming.world }, { source: existing.source, world: existing.world });
  if (r.outcome === "wins") return r.winner === "a" ? "supersede-existing" : "preserve-existing";
  if (r.outcome === "coexist") return "coexist-conflict";
  return "preserve-existing"; // escalate — the existing claim is never dropped; a human decides
}

export interface MergeReport {
  applied: number;
  preservedClosures: number;   // attributed closures that survived an incoming conflict
  supersededGenerated: number; // stale generations replaced by newer ones (recency, generated↔generated)
  /** N-4 — earlier `code-derived` rows superseded by a LATER import from the SAME
   *  provenance: a corrected re-upload. Never counts a different system's disagreement. */
  correctedReimports: number;
  /** N-5 — live rows collapsed because a second writer landed the SAME value on the
   *  locus. Prevented at write time; without this they inflate every live-claim ratio. */
  collapsedDuplicates: number;
  filledUnknowns: number;
  newClaims: number;
  /** N-11 — incoming claims that, once live, stand in a CROSS-WORLD deviation on their
   *  locus (substantive on both sides, and the incoming value differs from every live
   *  claim of the other world). Same predicate as `buildDeviationRegister`. */
  deviations: number;
  orphanedClosures: Array<{ about: string; by: string }>; // attributed closures about elements the regeneration DROPPED
}

const ATTRIBUTED = new Set(["asserted", "dispositioned", "document", "regulation", "precedent"]);
const isAttributedClosure = (c: Claim): boolean => ATTRIBUTED.has(c.source) && (c.status === "closed" || c.status === "weak");

/**
 * Does the INCOMING claim supersede this existing live claim by recency?
 *
 * Two arms, both requiring same world, both substantive, values differing, same source:
 *  - `generated` ↔ `generated`: always (regeneration recency).
 *  - `code-derived` ↔ `code-derived`: ONLY when both carry the same import provenance —
 *    the same system re-uploaded a corrected export. A different system's reading of the
 *    same locus is a genuine disagreement and is left to precedence, which coexists it.
 */
const recencySupersedes = (existing: Claim, input: AssertInput): boolean => {
  if (existing.world !== input.world) return false;
  if (existing.source !== input.source) return false;
  if (!substantive(existing.value) || !substantive(input.value)) return false;
  if (valueEq(existing.value, input.value)) return false;
  if (input.source === "generated") return true;
  if (input.source !== "code-derived") return false;
  const p = importProvenance(input);
  return p !== null && p === importProvenance(existing);
};

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
  const report: MergeReport = { applied: 0, preservedClosures: 0, supersededGenerated: 0, correctedReimports: 0, collapsedDuplicates: 0, filledUnknowns: 0, newClaims: 0, deviations: 0, orphanedClosures: [] };
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
      if (input.source === "generated") report.supersededGenerated += 1;
      else report.correctedReimports += 1;
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
    if (isLive(asserted) && substantive(asserted.value)) {
      for (const x of store.liveClaimsAbout(input.about)) {
        if (x.id === asserted.id || x.world !== asserted.world) continue;
        if (!substantive(x.value) || !valueEq(x.value, asserted.value)) continue;
        const r = resolvePrecedence({ source: asserted.source, world: asserted.world }, { source: x.source, world: x.world });
        if (r.outcome !== "wins") continue;
        if (r.winner === "a") x.supersededBy = asserted.id;
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
    if (isLive(asserted) && devSubstantive(asserted.value)) {
      const otherWorld = store.liveClaimsAbout(input.about).filter((x) => x.world !== asserted.world && devSubstantive(x.value));
      if (otherWorld.length > 0 && !otherWorld.some((x) => valueEq(x.value, asserted.value))) report.deviations += 1;
    }
  }
  // orphans: attributed closures about elements the regeneration no longer produces
  for (const c of store.claims()) {
    if (!isLive(c) || !isAttributedClosure(c)) continue;
    const el = elementIdOf(c.about);
    if (!incomingElementIds.has(el)) report.orphanedClosures.push({ about: c.about, by: c.closedBy?.by ?? "?" });
  }
  return report;
}
