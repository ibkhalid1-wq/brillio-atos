// Aura — Option A: the canonical ledger-construction path (docs/aura/option-a-report.md).
// Change flows generator + override adapter → reconcile, NOT re-migrate-the-blob.
// migrate() is demoted to a deprecated bootstrap/equivalence baseline; this is the live path.
//
// Each source's sub-batch is validated at ITS OWN boundary (the generator by generator
// rules, the override log by import rules) — then merged for the proven reconcile. A batch
// that fails its boundary is rejected here, never reconciled and cleaned up after.
import { generateClaimsBatch, validateBatch, type Batch, type BatchClaim, type GeneratedElement, type ValidationResult, type GenSource } from "./ledgerGenerator.ts";
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
 */
export function buildOptionABatch(source: OptionASource): OptionABatch {
  const gen = generateClaimsBatch(source);
  const genV = validateBatch(gen as Batch);
  const ovr = overridesToBatch(source.overrides ?? []);
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
