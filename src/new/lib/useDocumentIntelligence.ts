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
  FieldMapping,
  MethodologyMappings,
  ReviewField,
} from "@/new/lib/documentIntelligenceTypes";

export type { DocumentImportStage, DocumentImportResult, ReviewField, ApprovedInputs };

// ─── File helpers ─────────────────────────────────────────────────────────────

const AI_NATIVE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const AI_PARSE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

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

// ─── Build approved inputs from reviewed fields ───────────────────────────────

function buildApprovedInputs(reviewFields: ReviewField[]): ApprovedInputs {
  const result: ApprovedInputs = {};
  for (const field of reviewFields) {
    if (field.mapping.reviewState === "rejected") continue;
    const value =
      field.mapping.reviewState === "edited" && field.mapping.editedValue !== undefined
        ? field.mapping.editedValue
        : field.mapping.value;
    if (!value?.trim()) continue;
    if (!result[field.phaseId]) result[field.phaseId] = {};
    result[field.phaseId][field.fieldId] = value.trim();
  }
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
      const { data, error: fnError } = await supabase.functions.invoke("document-intelligence", {
        body: {
          programId,
          text: text || undefined,
          fileName: file.name,
          fileAttachment: fileAttachment || undefined,
          phaseHint: phaseHint || undefined,
        },
      });

      if (fnError) {
        throw new Error(fnError.message || "Extraction request failed.");
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

      // Build review fields for user approval
      const fields = buildReviewFields(
        intel.methodologyMappings ?? {},
        existingPhaseInputs,
      );
      setReviewFields(fields);

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
  ) => {
    if (!result) return;
    setStage("saving");
    setProgress(90);

    try {
      const approved = buildApprovedInputs(reviewFields);
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
