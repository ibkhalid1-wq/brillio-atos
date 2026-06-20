/**
 * useDocumentIntelligence — Universal document processing hook.
 *
 * Replaces the older useDocumentImport with a richer pipeline:
 *   idle → parsing → extracting → reviewing → saving → done | error
 *
 * Key differences from useDocumentImport:
 * - Single universal AI extraction (not phase-specific functions)
 * - Returns intelligence + review fields before saving
 * - Caller controls when to commit (approve → save)
 * - Graceful degradation: upload completes even when AI is unavailable
 * - Full traceability stored in extracted_data
 */

import { useCallback, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";
import type { DynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import type {
  ApprovedInputs,
  DocumentImportResult,
  DocumentImportStage,
  DocumentIntelligence,
  ExtractedKpi,
  FieldMapping,
  MethodologyMappings,
  ReviewField,
  StakeholderEntity,
} from "@/new/lib/documentIntelligenceTypes";
import type { GridColumn, PhaseInputField } from "@/v3/lib/phaseInputSchema";
import {
  PROVENANCE_KEY,
  serializeProvenance,
  type FieldProvenance,
  type ProvenanceMap,
} from "@/new/lib/fieldProvenance";

export type { DocumentImportStage, DocumentImportResult, ReviewField, ApprovedInputs };

/** AI merge-and-refine for a field whose imported value collides with an existing one. */
export type RefineFieldFn = (
  phaseId: string,
  fieldId: string,
  fieldLabel: string,
  existingValue: string,
  incomingValue: string,
) => Promise<string>;

// ─── File helpers ─────────────────────────────────────────────────────────────

const AI_NATIVE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const AI_PARSE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * supabase-js raises a FunctionsHttpError for any non-2xx response and exposes
 * the underlying Response on `.context` while discarding the parsed body. Read
 * that Response so callers can recover the function's real error payload.
 */
async function readFunctionErrorBody(
  fnError: unknown,
): Promise<{ error?: string; parseError?: string; isAIUnavailable?: boolean } | null> {
  const context = (fnError as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return null;
  try {
    return await context.clone().json();
  } catch {
    try {
      const txt = await context.clone().text();
      return txt ? { error: txt } : null;
    } catch {
      return null;
    }
  }
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ─── Build review fields from intelligence ────────────────────────────────────

/**
 * Turn the AI's per-phase field mappings into reviewable fields, gated by the
 * methodology. A mapping is only surfaced when its `(phaseId, fieldId)` is a
 * *declared* input field of that phase — i.e. it exists in the phase's resolved
 * input schema (static methodology fields plus any ai-derived dynamic fields the
 * programme has already generated, via `store`).
 *
 * This is the single authoritative gate: the extractor can propose anything, but
 * only fields the methodology declares for a phase land in the review. A phase
 * the programme has not reached has no schema (no static fields, no dynamic
 * schema), so its mappings are dropped rather than scattered into an unreached
 * phase's inputs. Nothing is hard-coded here; the allowed set comes entirely
 * from `getPhaseInputSchema`.
 */
export function buildReviewFields(
  mappings: MethodologyMappings,
  existingPhaseInputs: Record<string, Record<string, string>>,
  store?: DynamicSchemaStore,
): ReviewField[] {
  const fields: ReviewField[] = [];

  for (const [phaseId, fieldMappings] of Object.entries(mappings)) {
    // The phase's declared input fields (methodology + dynamic schema) are the
    // only valid targets. An unreached/unknown dynamic phase resolves to none.
    const schemaFields = getPhaseInputSchema(phaseId, store).fields;
    const declared = new Map(schemaFields.map((f) => [f.id, f]));

    for (const [fieldId, mapping] of Object.entries(fieldMappings)) {
      if (!mapping.value?.trim()) continue;

      const schemaField = declared.get(fieldId);
      // Not a declared field for this phase → drop it rather than create a
      // raw-id input on a phase the methodology never declared.
      if (!schemaField) continue;

      const existingValue = existingPhaseInputs[phaseId]?.[fieldId] ?? "";
      const hasConflict = Boolean(existingValue && existingValue.trim() !== mapping.value.trim());

      fields.push({
        phaseId,
        fieldId,
        fieldLabel: schemaField.label,
        mapping: { ...mapping, reviewState: "pending" },
        existingValue: existingValue || undefined,
        hasConflict,
      });
    }
  }

  return fields;
}

// ─── Structured KPIs → Strategy KPI grid ──────────────────────────────────────

type KpiRow = { id: string; name: string; baseline: string; target: string; unit: string };

function kpiRowId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `kpi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseKpiRows(raw: string): KpiRow[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : kpiRowId(),
        name: String(entry.name ?? "").trim(),
        baseline: String(entry.baseline ?? "").trim(),
        target: String(entry.target ?? "").trim(),
        unit: String(entry.unit ?? "").trim(),
      }))
      .filter((row) => row.name);
  } catch {
    return [];
  }
}

/**
 * Merge two serialized KPI grids without data loss. Rows are keyed by
 * case-insensitive name; incoming values fill blank cells on an existing row and
 * genuinely new KPIs are appended. Used on import conflict — a naive string
 * concat (the default merge) would corrupt the JSON and silently wipe KPIs the
 * PM already entered.
 */
export function mergeKpiJson(existingJson: string, incomingJson: string): string {
  const byName = new Map<string, KpiRow>();
  for (const row of parseKpiRows(existingJson)) byName.set(row.name.toLowerCase(), row);
  for (const row of parseKpiRows(incomingJson)) {
    const key = row.name.toLowerCase();
    const prior = byName.get(key);
    byName.set(key, prior
      ? { ...prior, baseline: prior.baseline || row.baseline, target: prior.target || row.target, unit: prior.unit || row.unit }
      : row);
  }
  return JSON.stringify([...byName.values()]);
}

/**
 * Build a single Strategy `kpis` review field from the structured KPIs the AI
 * extracted, serialized to the JSON shape PhaseInputsPanel persists
 * (`[{id,name,baseline,target,unit}]`) so approving it populates the KPI grid
 * rather than dropping the numbers into a free-text field.
 */
export function deriveKpiReviewField(
  kpis: ExtractedKpi[] | undefined,
  existingPhaseInputs: Record<string, Record<string, string>>,
): ReviewField | null {
  const named = (kpis ?? []).filter((kpi) => kpi.name?.trim());
  if (named.length === 0) return null;

  const rows: KpiRow[] = named.map((kpi) => ({
    id: kpiRowId(),
    name: kpi.name.trim(),
    baseline: (kpi.baseline ?? "").trim(),
    target: (kpi.target ?? "").trim(),
    unit: (kpi.unit ?? "").trim(),
  }));
  const value = JSON.stringify(rows);
  const existingValue = existingPhaseInputs.strategy?.kpis ?? "";
  const avgConfidence = named.reduce((sum, kpi) => sum + (Number(kpi.confidence) || 0), 0) / named.length;

  return {
    phaseId: "strategy",
    fieldId: "kpis",
    fieldLabel: "Outcome KPIs",
    mapping: {
      value,
      confidence: avgConfidence > 0 ? avgConfidence : 0.75,
      source: named.find((kpi) => kpi.source?.trim())?.source ?? "",
      extractionType: "extracted",
      reviewState: "pending",
    },
    existingValue: existingValue || undefined,
    hasConflict: Boolean(existingValue && existingValue.trim() !== value),
  };
}

// ─── Extracted stakeholders → core-team roster grid ───────────────────────────

/** Find the column key whose key or label matches `re`, falling back to `fallback`. */
function matchColumnKey(columns: GridColumn[], re: RegExp, fallback?: string): string | undefined {
  const hit = columns.find((c) => re.test(c.key) || re.test(c.label ?? ""));
  return hit?.key ?? fallback;
}

/**
 * Locate the Mobilise core-team roster grid in a phase schema. Prefers the
 * canonical ai-derived id ("coreTeamRoster", label "Named individuals per core
 * team role"); otherwise the first grid whose columns clearly carry a name and a
 * role. Returns null when no such grid is declared.
 */
function findRosterGrid(fields: PhaseInputField[]): PhaseInputField | null {
  const byId = fields.find((f) => f.type === "grid" && f.id === "coreTeamRoster");
  if (byId) return byId;
  return (
    fields.find(
      (f) =>
        f.type === "grid" &&
        Boolean(matchColumnKey(f.columns ?? [], /name/i)) &&
        Boolean(matchColumnKey(f.columns ?? [], /role|title|position/i)),
    ) ?? null
  );
}

/**
 * Bridge extracted stakeholders into the Mobilise core-team roster grid.
 *
 * The roster is an ai-derived dynamic grid (id "coreTeamRoster"). The extractor
 * reliably lands people in `entities.stakeholders` but only intermittently fills
 * the per-phase grid mapping, so — exactly as `deriveKpiReviewField` does for
 * KPIs — we synthesise the grid value from the structured entity. Rows are keyed
 * to the grid's *actual* declared column keys so the value parses cleanly in
 * StructuredGrid. Returns null when the roster grid is not a declared field for
 * the programme (dynamic schema not generated yet) — we never fabricate a field.
 */
export function deriveRosterReviewField(
  stakeholders: StakeholderEntity[] | undefined,
  existingPhaseInputs: Record<string, Record<string, string>>,
  store?: DynamicSchemaStore,
  phaseId = "mobilise",
): ReviewField | null {
  const named = (stakeholders ?? []).filter((s) => s.name?.trim() || s.role?.trim());
  if (named.length === 0) return null;

  const grid = findRosterGrid(getPhaseInputSchema(phaseId, store).fields);
  if (!grid) return null;

  const cols = grid.columns ?? [];
  const nameKey = matchColumnKey(cols, /name/i, "name")!;
  const roleKey = matchColumnKey(cols, /role|title|position/i, "role")!;
  const orgKey = matchColumnKey(cols, /org|company|firm/i);

  const rows = named.map((s) => {
    const row: Record<string, string> = { id: kpiRowId() };
    row[roleKey] = (s.role ?? "").trim();
    row[nameKey] = (s.name ?? "").trim();
    if (orgKey) row[orgKey] = (s.organization ?? "").trim();
    return row;
  });
  const value = JSON.stringify(rows);
  const existingValue = existingPhaseInputs[phaseId]?.[grid.id] ?? "";
  const avgConfidence = named.reduce((sum, s) => sum + (Number(s.confidence) || 0), 0) / named.length;

  return {
    phaseId,
    fieldId: grid.id,
    fieldLabel: grid.label,
    mapping: {
      value,
      confidence: avgConfidence > 0 ? avgConfidence : 0.75,
      source: named.find((s) => s.source?.trim())?.source ?? "",
      extractionType: "extracted",
      reviewState: "pending",
    },
    existingValue: existingValue || undefined,
    hasConflict: Boolean(existingValue && existingValue.trim() !== value),
  };
}

// ─── Build approved inputs from reviewed fields ───────────────────────────────

/** Parse a value as an array of row objects, or null when it isn't JSON-array shaped. */
function parseRowArray(raw: string): Array<Record<string, unknown>> | null {
  if (!raw.trim().startsWith("[")) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null);
  } catch {
    return null;
  }
}

/**
 * Union two serialized grids (e.g. the core-team roster) without data loss. Rows
 * are de-duplicated by a signature of their cells excluding `id`, so re-importing
 * the same document is idempotent while genuinely new rows are appended. Used on
 * import conflict — the default text refine/concat path would corrupt the JSON.
 */
export function mergeGridJson(existingJson: string, incomingJson: string): string {
  const existing = parseRowArray(existingJson) ?? [];
  const incoming = parseRowArray(incomingJson) ?? [];
  const sig = (row: Record<string, unknown>) =>
    JSON.stringify(
      Object.entries(row)
        .filter(([k]) => k !== "id")
        .map(([k, v]) => [k, String(v ?? "").trim().toLowerCase()])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  const seen = new Set<string>();
  const merged: Array<Record<string, unknown>> = [];
  for (const row of [...existing, ...incoming]) {
    const key = sig(row);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return JSON.stringify(merged);
}

/** Deterministic merge used when AI refine is unavailable or fails — never loses data. */
function localMerge(existing: string, incoming: string): string {
  const a = existing.trim();
  const b = incoming.trim();
  if (!a) return b;
  if (!b || a === b) return a;
  return `${a}\n\n${b}`;
}

/**
 * Build the set of inputs to persist from the reviewed fields. Fields the user
 * rejected are dropped; manually edited fields are taken verbatim. When an
 * accepted field collides with a value already in the programme, the existing
 * and incoming values are merged-and-refined (AI when available, deterministic
 * concatenation otherwise) so a document import never silently overwrites work
 * the PM already entered.
 */
export async function buildApprovedInputs(
  reviewFields: ReviewField[],
  refineField?: RefineFieldFn,
  documentName?: string,
): Promise<ApprovedInputs> {
  const result: ApprovedInputs = {};
  const provByPhase: Record<string, ProvenanceMap> = {};
  const docName = documentName?.trim() || "";
  const add = (
    phaseId: string,
    fieldId: string,
    value: string,
    mapping: FieldMapping,
    extractionType: FieldProvenance["extractionType"],
  ) => {
    if (!result[phaseId]) result[phaseId] = {};
    result[phaseId][fieldId] = value;
    // Record where this value came from so the input grid can show provenance —
    // including the originating document's file name so the artifact map and
    // traceability views can name the source, not just label it "imported".
    if (!provByPhase[phaseId]) provByPhase[phaseId] = {};
    provByPhase[phaseId][fieldId] = {
      source: mapping.source ?? "",
      ...(docName ? { documentName: docName } : {}),
      confidence: typeof mapping.confidence === "number" ? mapping.confidence : 0,
      extractionType,
      value,
    };
  };

  await Promise.all(
    reviewFields.map(async (field) => {
      if (field.mapping.reviewState === "rejected") return;

      // User hand-edited this field in the review panel — honour it verbatim.
      // The PM restructured the extracted text, so record it as "enriched".
      if (field.mapping.reviewState === "edited" && field.mapping.editedValue !== undefined) {
        const edited = field.mapping.editedValue.trim();
        if (edited) add(field.phaseId, field.fieldId, edited, field.mapping, "enriched");
        return;
      }

      const incoming = field.mapping.value?.trim();
      if (!incoming) return;

      const existing = field.existingValue?.trim();
      if (field.hasConflict && existing) {
        // KPIs are JSON arrays — merge structurally; the text refine/concat path
        // below would corrupt the JSON and wipe existing rows.
        if (field.fieldId === "kpis") {
          add(field.phaseId, field.fieldId, mergeKpiJson(existing, incoming), field.mapping, "enriched");
          return;
        }
        // Any other grid value (e.g. the core-team roster) is also a JSON array —
        // union it structurally rather than concatenating text, which would
        // corrupt the JSON and drop rows the PM already entered.
        if (parseRowArray(existing) && parseRowArray(incoming)) {
          add(field.phaseId, field.fieldId, mergeGridJson(existing, incoming), field.mapping, "enriched");
          return;
        }
        let merged = "";
        if (refineField) {
          try {
            merged = (await refineField(field.phaseId, field.fieldId, field.fieldLabel, existing, incoming)).trim();
          } catch {
            merged = "";
          }
        }
        // A merged value blends existing PM text with the import — "enriched".
        add(field.phaseId, field.fieldId, merged || localMerge(existing, incoming), field.mapping, "enriched");
        return;
      }

      add(field.phaseId, field.fieldId, incoming, field.mapping, field.mapping.extractionType);
    }),
  );

  // Fold each phase's provenance map into its input bucket under the metadata key.
  for (const [phaseId, prov] of Object.entries(provByPhase)) {
    if (result[phaseId] && Object.keys(prov).length > 0) {
      result[phaseId][PROVENANCE_KEY] = serializeProvenance(prov);
    }
  }

  return result;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseDocumentIntelligenceOptions {
  programId: string | null;
  /** Existing phase inputs from the programme — used for conflict detection */
  existingPhaseInputs?: Record<string, Record<string, string>>;
  /** Programme's dynamic schema — gates which phases/fields an import can target */
  dynamicSchemaStore?: DynamicSchemaStore;
  /** Called after approved inputs are persisted */
  onComplete?: (result?: DocumentImportResult) => void | Promise<void>;
}

export function useDocumentIntelligence({
  programId,
  existingPhaseInputs = {},
  dynamicSchemaStore,
  onComplete,
}: UseDocumentIntelligenceOptions) {
  const [stage, setStage] = useState<DocumentImportStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [intelligence, setIntelligence] = useState<DocumentIntelligence | null>(null);
  const [reviewFields, setReviewFields] = useState<ReviewField[]>([]);
  const [result, setResult] = useState<DocumentImportResult | null>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  // Name of the file being imported — stamped into per-field provenance at save
  // so the artifact map / traceability can name the source document.
  const importedFileNameRef = useRef<string>("");

  // ── importFile: parse + extract → move to reviewing ──────────────────────
  const importFile = useCallback(async (file: File, phaseHint?: string) => {
    if (!programId) {
      setStage("error");
      setError("No active programme selected.");
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setStage("error");
      setError("Supabase is not configured.");
      return;
    }

    setStage("parsing");
    setError(null);
    setResult(null);
    setIntelligence(null);
    setReviewFields([]);
    setAiUnavailable(false);
    setProgress(10);
    importedFileNameRef.current = file.name;

    // Decide: send file natively to AI or pre-extract text client-side
    const canUseAINative = AI_NATIVE_TYPES.has(file.type) && file.size <= AI_PARSE_MAX_BYTES;
    let fileAttachment: { base64: string; mimeType: string; name: string } | undefined;
    let text = "";

    if (canUseAINative) {
      try {
        const base64 = await fileToBase64(file);
        fileAttachment = { base64, mimeType: file.type, name: file.name };
      } catch {
        // Encoding failed — fall through to text extraction
      }
    }

    if (!fileAttachment) {
      // Import parseDocumentToText lazily to avoid pulling it in when not needed
      const { parseDocumentToText } = await import("@/new/lib/parseDocumentToText");
      const parsed = await parseDocumentToText(file);
      if (parsed.ok) {
        text = parsed.text ?? "";
      }
      // If parsing fails, text stays "" — AI will do its best from filename alone
    }

    setProgress(30);
    setStage("extracting");

    // Declare the activated phases' input fields (static methodology + ai-derived
    // dynamic) so the extractor maps document data onto the SAME registry fields
    // the review panel will surface — not a hard-coded Strategy-only set. A phase
    // is "activated" once it has captured inputs or accrued dynamic fields; we
    // always include Strategy and the upload's target phase.
    const activatedPhaseIds = new Set<string>(["strategy"]);
    if (phaseHint) activatedPhaseIds.add(phaseHint);
    for (const pid of Object.keys(existingPhaseInputs)) activatedPhaseIds.add(pid);
    for (const pid of Object.keys(dynamicSchemaStore?.inputFields ?? {})) activatedPhaseIds.add(pid);
    const phaseSchemas = [...activatedPhaseIds].map((pid) => ({
      phaseId: pid,
      title: getPhaseInputSchema(pid, dynamicSchemaStore).title,
      fields: getPhaseInputSchema(pid, dynamicSchemaStore).fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        hint: f.hint,
        options: f.options,
        columns: f.type === "grid" ? (f.columns ?? []).map((c) => ({ key: c.key, label: c.label })) : undefined,
      })),
    }));

    // ── Call document-intelligence edge function ──────────────────────────
    try {
      const invoked = await supabase.functions.invoke("document-intelligence", {
        body: {
          programId,
          text: text || undefined,
          fileName: file.name,
          fileAttachment: fileAttachment || undefined,
          phaseHint: phaseHint || undefined,
          phaseSchemas,
        },
      });

      let data = invoked.data;
      const fnError = invoked.error;

      if (fnError) {
        // supabase-js collapses any non-2xx into an opaque "Edge Function
        // returned a non-2xx status code" and drops the JSON body. Recover the
        // real payload from the error context so the AI-unavailable degradation
        // path still fires and the user sees the true error, not the generic one.
        const body = await readFunctionErrorBody(fnError);
        if (body?.isAIUnavailable) {
          data = body;
        } else {
          throw new Error(body?.error || body?.parseError || fnError.message || "Extraction request failed.");
        }
      }

      const response = data as {
        ok: boolean;
        intelligence?: DocumentIntelligence;
        attachmentId?: string;
        error?: string;
        isAIUnavailable?: boolean;
        parseError?: string;
      };

      if (response.isAIUnavailable) {
        setAiUnavailable(true);
        // Still allow upload without AI — save the document with no extraction
        await saveDocumentOnly(programId, file, text);
        setStage("done");
        setProgress(100);
        return;
      }

      if (!response.ok || !response.intelligence) {
        throw new Error(response.error || response.parseError || "Extraction returned no data.");
      }

      setProgress(70);
      const intel = response.intelligence;
      setIntelligence(intel);

      // Build review fields for user approval. Structured KPIs become a single
      // Strategy `kpis` grid field so quantified metrics land in the KPI table
      // rather than a free-text mapping.
      const fields = buildReviewFields(
        intel.methodologyMappings ?? {},
        existingPhaseInputs,
        dynamicSchemaStore,
      );
      const derived: ReviewField[] = [];
      const kpiField = deriveKpiReviewField(intel.kpis, existingPhaseInputs);
      if (kpiField) derived.push(kpiField);
      // Bridge extracted stakeholders into the Mobilise core-team roster grid,
      // unless the model already mapped that grid directly (avoid a duplicate
      // review row for the same field).
      const rosterField = deriveRosterReviewField(
        intel.entities?.stakeholders,
        existingPhaseInputs,
        dynamicSchemaStore,
      );
      if (rosterField && !fields.some((f) => f.phaseId === rosterField.phaseId && f.fieldId === rosterField.fieldId)) {
        derived.push(rosterField);
      }
      setReviewFields(derived.length ? [...fields, ...derived] : fields);

      // Store the attachmentId so we can link it after approval
      setResult({
        attachmentId: response.attachmentId ?? "",
        intelligence: intel,
        approvedInputs: {},
      });

      setProgress(80);
      setStage("reviewing"); // Caller now shows the review UI
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Extraction failed.";
      if (msg.includes("AI provider not configured") || msg.includes("not configured")) {
        setAiUnavailable(true);
        await saveDocumentOnly(programId, file, text);
        setStage("done");
        setProgress(100);
      } else {
        setStage("error");
        setError(`Extraction failed: ${msg}`);
      }
    }
  }, [programId, existingPhaseInputs, dynamicSchemaStore]);

  // ── updateReviewField: user edits / approves / rejects a field ───────────
  const updateReviewField = useCallback((
    phaseId: string,
    fieldId: string,
    patch: Partial<Pick<FieldMapping, "reviewState" | "editedValue">>,
  ) => {
    setReviewFields((prev) =>
      prev.map((f) =>
        f.phaseId === phaseId && f.fieldId === fieldId
          ? { ...f, mapping: { ...f.mapping, ...patch } }
          : f,
      ),
    );
  }, []);

  // ── approveAll: mark all pending fields as approved ───────────────────────
  const approveAll = useCallback(() => {
    setReviewFields((prev) =>
      prev.map((f) =>
        f.mapping.reviewState === "pending"
          ? { ...f, mapping: { ...f.mapping, reviewState: "approved" } }
          : f,
      ),
    );
  }, []);

  // ── rejectAll: mark all pending fields as rejected ────────────────────────
  const rejectAll = useCallback(() => {
    setReviewFields((prev) =>
      prev.map((f) => ({ ...f, mapping: { ...f.mapping, reviewState: "rejected" } })),
    );
  }, []);

  // ── save: persist approved inputs ────────────────────────────────────────
  const save = useCallback(async (
    onSavePhaseInputs: (phaseId: string, inputs: Record<string, string>) => Promise<void>,
    onSaveAllPhaseInputs?: (allInputs: Record<string, Record<string, string>>, firstPhaseId?: string) => Promise<void>,
    refineField?: RefineFieldFn,
  ) => {
    if (!result) return;
    setStage("saving");
    setProgress(90);

    try {
      const approved = await buildApprovedInputs(reviewFields, refineField, importedFileNameRef.current);
      // Filter out empty phases
      const nonEmpty = Object.fromEntries(
        Object.entries(approved).filter(([, inputs]) => Object.keys(inputs).length > 0),
      );
      const firstPhaseId = Object.keys(nonEmpty)[0];

      if (onSaveAllPhaseInputs && Object.keys(nonEmpty).length > 0) {
        // Atomic batch save — avoids stale closure when multiple phases need saving
        await onSaveAllPhaseInputs(nonEmpty, firstPhaseId);
      } else {
        // Fallback: per-phase save
        for (const [phaseId, inputs] of Object.entries(nonEmpty)) {
          await onSavePhaseInputs(phaseId, inputs);
        }
        // Signal the shell to open the context drawer
        window.dispatchEvent(new CustomEvent("atlas-v3-open-drawer"));
      }

      const finalResult: DocumentImportResult = {
        ...result,
        approvedInputs: approved,
      };
      setResult(finalResult);
      setProgress(100);
      setStage("done");

      window.dispatchEvent(new CustomEvent("adam:documents-updated", {
        detail: { programId },
      }));

      await onComplete?.(finalResult);
    } catch (err: unknown) {
      setStage("error");
      setError(`Save failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [result, reviewFields, programId, onComplete]);

  // ── reset ────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
    setProgress(0);
    setIntelligence(null);
    setReviewFields([]);
    setResult(null);
    setAiUnavailable(false);
  }, []);

  return {
    stage,
    error,
    progress,
    intelligence,
    reviewFields,
    result,
    aiUnavailable,
    importFile,
    updateReviewField,
    approveAll,
    rejectAll,
    save,
    reset,
  };
}

// ─── Helper: save document record without AI extraction ──────────────────────

async function saveDocumentOnly(programId: string, file: File, text: string) {
  if (!supabase) return;
  await supabase.functions.invoke("save-document", {
    body: {
      program_id: programId,
      file_name: file.name,
      file_type: (file.name.split(".").pop() ?? "unknown").toLowerCase(),
      file_size_bytes: file.size,
      raw_text: text ? text.slice(0, 50000) : null,
      phase_context: null,
      extraction_status: "pending",
      extracted_data: {},
      confidence: 0,
    },
  });
}
