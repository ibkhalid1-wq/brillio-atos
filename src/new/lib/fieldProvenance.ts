/**
 * Field-level source provenance for phase inputs.
 *
 * The document-import pipeline extracts each value with a source quote,
 * confidence and extraction type, but historically only the value string was
 * persisted — so once an imported value reached the Strategy/Mobilise/etc. input
 * grid there was no way to see where it came from. This module persists that
 * provenance alongside the inputs (under the metadata key `_provenance`) and
 * keeps it intact across repeated imports.
 *
 * Storage shape: `phaseInputs[phaseId]._provenance` is a JSON string of
 * `Record<fieldId, FieldProvenance>`. The `_` prefix marks it as metadata, so
 * the field-count and completeness selectors that already filter `_`-keys ignore
 * it automatically.
 */

import type { ExtractionType } from "./documentIntelligenceTypes";

export const PROVENANCE_KEY = "_provenance";

export interface FieldProvenance {
  /** Short quote or section reference the value was extracted from. */
  source: string;
  /** Extraction confidence 0–1. */
  confidence: number;
  extractionType: ExtractionType;
  /**
   * Snapshot of the imported value. The UI shows the provenance badge only
   * while the field still holds this value; a later hand-edit makes the live
   * value diverge and the badge silently drops — so provenance never mislabels
   * a value the PM has since rewritten.
   */
  value: string;
}

export type ProvenanceMap = Record<string, FieldProvenance>;

export function parseProvenance(raw: unknown): ProvenanceMap {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ProvenanceMap = {};
    for (const [fieldId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      out[fieldId] = {
        source: typeof e.source === "string" ? e.source : "",
        confidence: typeof e.confidence === "number" ? e.confidence : 0,
        extractionType:
          e.extractionType === "enriched" || e.extractionType === "inferred"
            ? e.extractionType
            : "extracted",
        value: typeof e.value === "string" ? e.value : "",
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeProvenance(map: ProvenanceMap): string {
  return JSON.stringify(map);
}

/**
 * Deep-merge two serialized provenance maps. Incoming entries win per field, but
 * fields only present on the existing side survive — so a second document import
 * never wipes provenance recorded by the first. Returns the merged JSON string,
 * or undefined when neither side carries any provenance.
 */
export function mergeProvenance(existingRaw: unknown, incomingRaw: unknown): string | undefined {
  const merged: ProvenanceMap = { ...parseProvenance(existingRaw), ...parseProvenance(incomingRaw) };
  return Object.keys(merged).length > 0 ? serializeProvenance(merged) : undefined;
}
