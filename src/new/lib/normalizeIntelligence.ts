/**
 * normalizeIntelligence — the single validated boundary for the extractor's
 * output.
 *
 * The document-intelligence edge returns whatever the LLM emits: despite the
 * prompt's fixed JSON skeleton, in practice the model drifts — a field mapping
 * comes back as a bare string instead of a `{value,…}` envelope, a found-nothing
 * field is listed as `null`, an entity array is missing, a confidence is a
 * string, etc. Every consumer (buildReviewFields, deriveKpiReviewField,
 * deriveRosterReviewField, the review panel) previously trusted the declared
 * TypeScript shape at runtime, so one malformed field could silently drop a real
 * value or crash the whole import.
 *
 * This module coerces the raw response into a shape-guaranteed
 * `DocumentIntelligence` ONCE, right after extraction, so no downstream code has
 * to defend itself. Coercion is lenient by design (an LLM boundary, not a strict
 * contract): a bare scalar becomes a value, a value-less mapping is dropped,
 * arrays are guaranteed present, and the grid-feeding shapes (methodologyMappings,
 * kpis, stakeholders) are deeply coerced because they flow into structured grids
 * whose builders trim/parse the fields.
 */

import {
  DOCUMENT_TYPE_LABELS,
  type DocumentIntelligence,
  type DocumentType,
  type ExtractedEntities,
  type ExtractedKpi,
  type ExtractionType,
  type FieldMapping,
  type MethodologyMappings,
} from "@/new/lib/documentIntelligenceTypes";

// ─── Scalar coercions ─────────────────────────────────────────────────────────

const asString = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const asTrimmed = (v: unknown): string => asString(v).trim();
const asNumber = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
/** A confidence coerced into [0,1], defaulting to 0.75 when absent/non-numeric. */
const asConfidence = (v: unknown): number => Math.max(0, Math.min(1, asNumber(v, 0.75)));
const asExtractionType = (v: unknown): ExtractionType =>
  v === "enriched" || v === "inferred" ? v : "extracted";
const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(asTrimmed).filter(Boolean) : [];
const asObjectArray = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v) ? v.filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null) : [];

const DOC_TYPES = new Set(Object.keys(DOCUMENT_TYPE_LABELS));
const asDocumentType = (v: unknown): DocumentType =>
  typeof v === "string" && DOC_TYPES.has(v) ? (v as DocumentType) : "other";

// ─── Field mappings ────────────────────────────────────────────────────────────

/**
 * Normalise one extractor field mapping into a well-formed FieldMapping,
 * tolerating the two shapes the model drifts to despite the prompt skeleton:
 *  - a bare string/number — the value returned directly, envelope dropped
 *    (e.g. `"functionalDesignSummary": "Covers case intake…"`); and
 *  - a null / value-less entry — a field the model found no data for
 *    (e.g. `"designApprovalDate": null`).
 * Returns null when there is no usable string value to review, so the caller
 * skips it rather than surfacing an empty field or crashing on `null.value`.
 */
export function normalizeFieldMapping(raw: unknown): FieldMapping | null {
  // Envelope dropped — the model returned the value itself as a scalar.
  if (typeof raw === "string" || typeof raw === "number") {
    const value = String(raw).trim();
    return value ? { value, confidence: 0.75, source: "", extractionType: "extracted" } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const value = asTrimmed(m.value);
  if (!value) return null;
  return {
    value,
    confidence: asConfidence(m.confidence),
    source: asString(m.source),
    extractionType: asExtractionType(m.extractionType),
  };
}

function normalizeMappings(raw: unknown): MethodologyMappings {
  const out: MethodologyMappings = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [phaseId, fields] of Object.entries(raw as Record<string, unknown>)) {
    if (!fields || typeof fields !== "object") continue;
    const clean: Record<string, FieldMapping> = {};
    for (const [fieldId, mapping] of Object.entries(fields as Record<string, unknown>)) {
      const normalized = normalizeFieldMapping(mapping);
      if (normalized) clean[fieldId] = normalized;
    }
    if (Object.keys(clean).length > 0) out[phaseId] = clean;
  }
  return out;
}

// ─── KPIs & entities ───────────────────────────────────────────────────────────

function normalizeKpis(raw: unknown): ExtractedKpi[] {
  return asObjectArray(raw)
    .map((k) => ({
      name: asTrimmed(k.name),
      baseline: asTrimmed(k.baseline),
      target: asTrimmed(k.target),
      unit: asTrimmed(k.unit),
      source: asString(k.source),
      confidence: asConfidence(k.confidence),
      extractionType: asExtractionType(k.extractionType),
    }))
    .filter((k) => k.name);
}

/** The 16 entity buckets the pipeline knows about — each guaranteed an array. */
const ENTITY_KEYS = [
  "objectives", "outcomes", "successMetrics", "constraints", "assumptions", "risks",
  "stakeholders", "milestones", "budget", "requirements", "decisions", "actions",
  "technologies", "integrations", "gaps", "recommendations",
] as const;

function normalizeEntities(raw: unknown): ExtractedEntities {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, Array<Record<string, unknown>>> = {};
  // Guarantee every known bucket is an array of objects so any `.map`/`.filter`
  // consumer is crash-safe even when the model omits a bucket or returns a scalar.
  for (const key of ENTITY_KEYS) out[key] = asObjectArray(src[key]);
  // Stakeholders feed the Mobilise roster grid, whose builder trims string
  // fields — deep-coerce them so a numeric/absent value can't crash that bridge.
  out.stakeholders = out.stakeholders.map((s) => ({
    ...s,
    name: asString(s.name),
    role: asString(s.role),
    organization: asString(s.organization),
    source: asString(s.source),
    confidence: asConfidence(s.confidence),
    extractionType: asExtractionType(s.extractionType),
  }));
  return out as unknown as ExtractedEntities;
}

// ─── Top-level ─────────────────────────────────────────────────────────────────

/**
 * Coerce a raw extractor response into a shape-guaranteed DocumentIntelligence.
 * Accepts `unknown` because the value crossing the edge boundary is untrusted;
 * always returns a fully-formed object (never throws), so callers can drop their
 * own runtime shape defences.
 */
export function normalizeIntelligence(raw: unknown): DocumentIntelligence {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    documentType: asDocumentType(r.documentType),
    summary: asString(r.summary),
    primaryPhase: asString(r.primaryPhase),
    relevantPhases: asStringArray(r.relevantPhases),
    overallConfidence: asConfidence(r.overallConfidence),
    entities: normalizeEntities(r.entities),
    methodologyMappings: normalizeMappings(r.methodologyMappings),
    kpis: normalizeKpis(r.kpis),
    gaps: asString(r.gaps),
  };
}
