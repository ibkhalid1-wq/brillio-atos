/**
 * Merge algorithm for the write model (docs/aura/ledger-write-model.md).
 *
 * SPEC + PROOF, NOT PERSISTENCE. This runs entirely against the in-memory store to
 * prove the merge design; it writes to no database. When a regeneration produces a
 * new batch of claims (Option A: from the claims-emitting generator; Option B: from
 * re-running migrate() on the new blob), those claims are `reconcile`d into the
 * EXISTING ledger so that no attributed closure is ever overwritten.
 *
 * The merge decision EXTENDS precedence with ONE rule precedence does not have:
 * two `generated` claims on a locus do not "coexist" (that would accumulate stale
 * generations on every regeneration) — the INCOMING (newer) generated supersedes the
 * existing generated. Everything else is precedence.
 */
import type { LedgerStore, AssertInput } from "./store";
import { type Claim, type ClaimValue, isLive, elementIdOf } from "./types";

const substantive = (v: ClaimValue): boolean => v.kind !== "unknown" && v.kind !== "na";
const valueEq = (a: ClaimValue, b: ClaimValue): boolean => JSON.stringify(a) === JSON.stringify(b);

export type MergeOutcome =
  | "preserve-existing"    // the existing closure/evidence stands; incoming dropped (no overwrite)
  | "supersede-existing"   // incoming (newer generation) replaces the stale existing generation
  | "fill-unknown"         // incoming value fills an open unknown
  | "corroborate"          // incoming equals an existing claim; one row kept
  | "coexist-deviation";   // cross-world; not a conflict — the deviation register's job

/**
 * The per-cell decision for an INCOMING `generated` claim meeting one EXISTING claim
 * on the same locus. Regeneration output is always `generated` (the generation
 * contract's source ceiling), so this is the table that actually runs.
 */
export function mergeDecision(existing: Claim, incoming: { world: Claim["world"]; value: ClaimValue }): MergeOutcome {
  if (existing.world !== incoming.world) return "coexist-deviation";
  if (existing.value.kind === "unknown" && substantive(incoming.value)) return "fill-unknown";
  if (existing.source !== "generated") return "preserve-existing"; // every non-generated source outranks generated for a shared world
  // existing is generated, same world:
  if (valueEq(existing.value, incoming.value)) return "corroborate";
  return "supersede-existing"; // recency — the rule beyond precedence
}

export interface MergeReport {
  applied: number;
  preservedClosures: number;   // attributed closures that survived an incoming conflict
  supersededGenerated: number; // stale generations replaced by newer ones
  filledUnknowns: number;
  newClaims: number;
  deviations: number;
  orphanedClosures: Array<{ about: string; by: string }>; // attributed closures about elements the regeneration DROPPED
}

const ATTRIBUTED = new Set(["asserted", "dispositioned", "document", "regulation", "precedent"]);
const isAttributedClosure = (c: Claim): boolean => ATTRIBUTED.has(c.source) && (c.status === "closed" || c.status === "weak");

/**
 * Reconcile a batch of regenerated claims into an existing store. Preserves every
 * attributed closure (precedence guarantees a `generated` claim cannot supersede
 * one), applies the recency rule for generated-vs-generated, fills unknowns, and
 * REPORTS attributed closures whose element the regeneration dropped (orphans) —
 * it never silently deletes them.
 *
 * `incomingElementIds` = the set of element ids the regeneration still produces, so
 * orphans (closures about elements no longer generated) can be flagged.
 */
export function reconcile(store: LedgerStore, incoming: AssertInput[], incomingElementIds: Set<string>): MergeReport {
  const report: MergeReport = { applied: 0, preservedClosures: 0, supersededGenerated: 0, filledUnknowns: 0, newClaims: 0, deviations: 0, orphanedClosures: [] };
  for (const input of incoming) {
    const liveBefore = store.liveClaimsAbout(input.about).filter((c) => c.world === input.world);
    // recency: a newer generated claim supersedes a stale generated one on the same locus
    if (input.source === "generated" && substantive(input.value)) {
      for (const x of liveBefore) {
        if (x.source === "generated" && substantive(x.value) && !valueEq(x.value, input.value)) {
          // mark the stale generation superseded, then let assert add the new one
          (x as { supersededBy?: string }).supersededBy = "recency:pending";
          report.supersededGenerated += 1;
        }
      }
    }
    const conflictingClosure = liveBefore.find((x) => isAttributedClosure(x) && substantive(x.value) && !valueEq(x.value, input.value) && x.world === input.world);
    const filledU = liveBefore.some((x) => x.value.kind === "unknown");
    const before = store.claims().length;
    store.assert(input); // precedence-aware; a generated claim can never supersede an attributed closure
    const added = store.claims().length - before;
    report.applied += 1;
    if (conflictingClosure) report.preservedClosures += 1;
    else if (filledU) report.filledUnknowns += 1;
    else if (added > 0) report.newClaims += 1;
    if (input.world === "to-be" && liveBefore.some((x) => x.world === "as-is")) report.deviations += 1;
  }
  // fix up the recency markers to real ids (point them at the incoming claim on the locus)
  for (const c of store.claims()) {
    if ((c as { supersededBy?: string }).supersededBy === "recency:pending") {
      const winner = store.liveClaimsAbout(c.about).find((w) => w.source === "generated" && w.id !== c.id && isLive(w));
      (c as { supersededBy?: string }).supersededBy = winner ? winner.id : c.id;
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
