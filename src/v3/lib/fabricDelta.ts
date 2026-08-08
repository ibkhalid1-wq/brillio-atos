/**
 * Fabric delta + refinement reconciliation (docs/aura/fabric.md §"Incremental update"
 * and §"Stakeholder refinements must survive").
 *
 * `diffFabric` is the deterministic incremental path: re-derive the fabric, diff by
 * `id`+`hash`, and emit only what moved. An unchanged node (same id, same hash) is
 * NOT re-emitted downstream — this is what makes a one-attribute change touch a
 * handful of regions instead of the whole document.
 *
 * Rename honesty: a diff alone CANNOT tell a rename from a remove+add — `Opportunity`
 * → `Deal` produces a new name-based id, so the old id vanishes and a new one appears.
 * The spec is explicit that a rename is carried as an old→new pair KNOWN from the edit
 * event, not inferred from the fabric. So `diffFabric` accepts an optional `renames`
 * map (from the ontology editor); without it, a rename correctly shows as remove+add.
 * Inferring renames heuristically is out of scope — it would be a guess, and the
 * region-identity discipline this file serves exists precisely to avoid guesses.
 *
 * `reconcileRefinements` is the preserve-or-escalate half. It can reliably DETECT
 * that a refined region is untouched (preserve), changed (3-way conflict → escalate),
 * or gone (orphaned → escalate). It does NOT auto-merge a free-form hand edit with a
 * new derivation — the honest limit stated in the spec. A refinement is therefore
 * never silently destroyed: it is preserved or surfaced for a human.
 */
import type { Fabric, FabricNode } from "./fabric";

export interface FabricDelta {
  added: FabricNode[];
  removed: FabricNode[];
  changed: Array<{ id: string; before: FabricNode; after: FabricNode }>;
  renamed: Array<{ from: string; to: string; hashChanged: boolean }>;
  unchanged: string[]; // ids untouched — copied verbatim, never re-emitted
}

export function diffFabric(prev: Fabric, next: Fabric, renames: ReadonlyArray<readonly [string, string]> = []): FabricDelta {
  const prevById = new Map(prev.nodes.map((n) => [n.id, n] as const));
  const nextById = new Map(next.nodes.map((n) => [n.id, n] as const));
  const consumedPrev = new Set<string>();
  const consumedNext = new Set<string>();
  const renamed: FabricDelta["renamed"] = [];

  // renames first — a known old→new pair moves identity rather than dropping + re-adding
  for (const [from, to] of renames) {
    const before = prevById.get(from);
    const after = nextById.get(to);
    if (before && after && !consumedPrev.has(from) && !consumedNext.has(to)) {
      renamed.push({ from, to, hashChanged: before.hash !== after.hash });
      consumedPrev.add(from);
      consumedNext.add(to);
    }
  }

  const added: FabricNode[] = [];
  const removed: FabricNode[] = [];
  const changed: FabricDelta["changed"] = [];
  const unchanged: string[] = [];

  for (const n of next.nodes) {
    if (consumedNext.has(n.id)) continue;
    const before = prevById.get(n.id);
    if (!before) { added.push(n); continue; }
    if (before.hash === n.hash) unchanged.push(n.id);
    else changed.push({ id: n.id, before, after: n });
  }
  for (const n of prev.nodes) {
    if (consumedPrev.has(n.id)) continue;
    if (!nextById.has(n.id)) removed.push(n);
  }
  return { added, removed, changed, renamed, unchanged };
}

/** Total nodes that a downstream renderer must re-emit for this delta. */
export function reEmitCount(delta: FabricDelta): number {
  return delta.added.length + delta.changed.length + delta.renamed.length;
}

// ── refinement preservation ──────────────────────────────────────────────

/** A stakeholder/operator edit bound to a region, recorded against the hash it was made on. */
export interface Refinement { fabricId: string; againstHash: string; content: unknown; }

export type RefinementStatus = "preserved" | "conflict" | "orphaned";
export interface RefinementDisposition {
  fabricId: string;
  status: RefinementStatus;
  reason: string;
}

/**
 * For each refinement, decide preserve / conflict / orphaned against the NEW fabric.
 * Never returns "merged" — auto-merge is out of scope by design; a conflict is escalated.
 */
export function reconcileRefinements(next: Fabric, refinements: ReadonlyArray<Refinement>, renames: ReadonlyArray<readonly [string, string]> = []): RefinementDisposition[] {
  const nextById = new Map(next.nodes.map((n) => [n.id, n] as const));
  const renameTo = new Map(renames.map(([from, to]) => [from, to] as const));
  return refinements.map((r) => {
    const targetId = renameTo.get(r.fabricId) ?? r.fabricId;
    const node = nextById.get(targetId);
    if (!node) return { fabricId: r.fabricId, status: "orphaned" as const, reason: `region ${targetId} no longer derives from the ontology` };
    if (node.hash === r.againstHash) return { fabricId: r.fabricId, status: "preserved" as const, reason: renameTo.has(r.fabricId) ? `moved to ${targetId}; inputs unchanged` : "inputs unchanged" };
    return { fabricId: r.fabricId, status: "conflict" as const, reason: `derivation inputs changed (${r.againstHash} → ${node.hash}); 3-way resolve required` };
  });
}
