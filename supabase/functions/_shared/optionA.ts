// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ STATUS: SCRIPT-ONLY TOOLING. Not wired to any edge function — by decision.  │
// └─────────────────────────────────────────────────────────────────────────────┘
// Decided 2026-08-10. This module has NO importer among the deployed function
// entrypoints; it is reached only by the hand-run harnesses in `scripts/ledger/`.
// That was previously ambiguous, and the ambiguity cost a wrong conclusion: the
// owner-derivation fix is mirrored here, so it was reported as shipped when in fact
// this code runs nowhere. Regenerating a programme through `run-agent` does NOT
// exercise it — which is why the surgery drain test cannot be settled by a
// regeneration alone (see the brief, §7.1).
//
// Being dormant is not the same as being safe to ignore. Two guards now cover it:
// the fabricated-owner scan reads `supabase/functions/_shared` (it did not before,
// which is how a constant role owner survived here), and
// `dormantGeneratorPath.test.ts` asserts no entrypoint has quietly imported it.
//
// TO WIRE IT: add the import, then update that test in the same change. The test
// exists to make that a deliberate act with a reviewer, not a silent one.

// Aura — Option A: the canonical ledger-construction path (docs/aura/option-a-report.md).
// Change flows generator + override adapter → reconcile, NOT re-migrate-the-blob.
// migrate() is demoted to a deprecated bootstrap/equivalence baseline; this is the live path.
//
// Each source's sub-batch is validated at ITS OWN boundary (the generator by generator
// rules, the override log by import rules) — then merged for the proven reconcile. A batch
// that fails its boundary is rejected here, never reconciled and cleaned up after.
import { generateClaimsBatch, validateBatch, type Batch, type BatchClaim, type GeneratedElement, type Owner, type ValidationResult, type GenSource } from "./ledgerGenerator.ts";
import { overridesToBatch, type OverrideEntry } from "./overrideAdapter.ts";

export interface OptionASource extends GenSource { overrides?: OverrideEntry[]; }
export interface OptionABatch {
  elements: GeneratedElement[]; claims: BatchClaim[];
  generator: ValidationResult; override: ValidationResult;
  counts: { generated: number; dispositioned: number; codeDerived: number; elements: number };
}

const dedupElements = (els: GeneratedElement[]): GeneratedElement[] => {
  const m = new Map<string, GeneratedElement>();
  for (const e of els) if (!m.has(e.id)) m.set(e.id, e);
  return [...m.values()];
};

const IMPORT_OPTS = { allowedSources: ["dispositioned", "code-derived"], requireSlotCompleteness: false, allowClosedBy: true, checkElementIds: false };

/**
 * Build the Option-A batch from Laila's source artifacts + override log. Validates each
 * sub-batch at its boundary; throws if either fails (with the errors). The returned batch
 * is what the caller feeds straight into reconcile(claims, elements).
 *
 * `overrideOwner` is REQUIRED and has NO default — it is passed straight through to
 * `overridesToBatch`, whose docblock explains why (the override log states a person, not
 * an owning role, so nothing here can derive one; a caller with no real owner passes
 * `{ kind: "unowned" }` and the miss stays visible). It is deliberately a parameter and
 * not a field of `OptionASource`: the source artifacts are the engagement's DATA, and the
 * owner is a decision made about them.
 */
export function buildOptionABatch(source: OptionASource, overrideOwner: Owner): OptionABatch {
  const gen = generateClaimsBatch(source);
  const genV = validateBatch(gen as Batch);
  const ovr = overridesToBatch(source.overrides ?? [], overrideOwner);
  const ovrV = validateBatch(ovr.batch, IMPORT_OPTS);
  if (!genV.ok) throw new Error(`generator batch invalid: ${genV.errors.slice(0, 3).map((e) => e.code).join(",")}`);
  if (!ovrV.ok) throw new Error(`override batch invalid: ${ovrV.errors.slice(0, 3).map((e) => e.code).join(",")}`);

  const claims: BatchClaim[] = [...gen.claims, ...ovr.batch.claims];
  const elements = dedupElements([...gen.elements, ...ovr.batch.elements]);
  const bySource = (s: string) => claims.filter((c) => c.source === s).length;
  return {
    elements, claims, generator: genV, override: ovrV,
    counts: { generated: bySource("generated"), dispositioned: bySource("dispositioned"), codeDerived: bySource("code-derived"), elements: elements.length },
  };
}
