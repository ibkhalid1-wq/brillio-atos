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

import { useCallback, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { PHASE_INPUT_SCHEMAS } from "@/v3/lib/phaseInputSchema";
import type {
  ApprovedInputs,
  DocumentImportResult,
  DocumentImportStage,
  DocumentIntelligence,
  ExtractedKpi,
  FieldMapping,
  MethodologyMappings,
  ReviewField,
} from "@/new/lib/documentIntelligenceTypes";

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

function buildReviewFields(
  mappings: MethodologyMappings,
  existingPhaseInputs: Record<string, Record<string, string>>,
): ReviewField[] {
  const fields: ReviewField[] = [];

  for (const [phaseId, fieldMappings] of Object.entries(mappings)) {
    // Look up schema to get human-readable field labels
    const schema = PHASE_INPUT_SCHEMAS[phaseId];
    const schemaFields = schema?.fields ?? [];

    for (const [fieldId, mapping] of Object.entries(fieldMappings)) {
      if (!mapping.value?.trim()) continue;

      const schemaField = schemaFields.find((f) => f.id === fieldId);
      const fieldLabel = schemaField?.label ?? fieldId;
      const existingValue = existingPhaseInputs[phaseId]?.[fieldId] ?? "";
      const hasConflict = Boolean(existingValue && existingValue.trim() !== mapping.value.trim());

      fields.push({
        phaseId,
        fieldId,
        fieldLabel,
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

// ─── Build approved inputs from reviewed fields ───────────────────────────────

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
async function buildApprovedInputs(
  reviewFields: ReviewField[],
  refineField?: RefineFieldFn,
): Promise<ApprovedInputs> {
  const result: ApprovedInputs = {};
  const add = (phaseId: string, fieldId: string, value: string) => {
    if (!result[phaseId]) result[phaseId] = {};
    result[phaseId][fieldId] = value;
  };

  await Promise.all(
    reviewFields.map(async (field) => {
      if (field.mapping.reviewState === "rejected") return;

      // User hand-edited this field in the review panel — honour it verbatim.
      if (field.mapping.reviewState === "edited" && field.mapping.editedValue !== undefined) {
        const edited = field.mapping.editedValue.trim();
        if (edited) add(field.phaseId, field.fieldId, edited);
        return;
      }

      const incoming = field.mapping.value?.trim();
      if (!incoming) return;

      const existing = field.existingValue?.trim();
      if (field.hasConflict && existing) {
        // KPIs are JSON arrays — merge structurally; the text refine/concat path
        // below would corrupt the JSON and wipe existing rows.
        if (field.fieldId === "kpis") {
          add(field.phaseId, field.fieldId, mergeKpiJson(existing, incoming));
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
        add(field.phaseId, field.fieldId, merged || localMerge(existing, incoming));
        return;
      }

      add(field.phaseId, field.fieldId, incoming);
    }),
  );

  return result;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseDocumentIntelligenceOptions {
  programId: string | null;
  /** Existing phase inputs from the programme — used for conflict detection */
  existingPhaseInputs?: Record<string, Record<string, string>>;
  /** Called after approved inputs are persisted */
  onComplete?: (result?: DocumentImportResult) => void | Promise<void>;
}

export function useDocumentIntelligence({
  programId,
  existingPhaseInputs = {},
  onComplete,
}: UseDocumentIntelligenceOptions) {
  const [stage, setStage] = useState<DocumentImportStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [intelligence, setIntelligence] = useState<DocumentIntelligence | null>(null);
  const [reviewFields, setReviewFields] = useState<ReviewField[]>([]);
  const [result, setResult] = useState<DocumentImportResult | null>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);

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

    // ── Call document-intelligence edge function ──────────────────────────
    try {
      const invoked = await supabase.functions.invoke("document-intelligence", {
        body: {
          programId,
          text: text || undefined,
          fileName: file.name,
          fileAttachment: fileAttachment || undefined,
          phaseHint: phaseHint || undefined,
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
      );
      const kpiField = deriveKpiReviewField(intel.kpis, existingPhaseInputs);
      setReviewFields(kpiField ? [...fields, kpiField] : fields);

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
  }, [programId, existingPhaseInputs]);

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
      const approved = await buildApprovedInputs(reviewFields, refineField);
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
