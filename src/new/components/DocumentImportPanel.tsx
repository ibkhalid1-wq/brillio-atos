/**
 * DocumentImportPanel — Universal document intake with AI extraction & review.
 *
 * Pipeline:
 *   1. User drops / selects a file
 *   2. AI parses, extracts, classifies, maps to methodology fields
 *   3. Review panel shows extracted fields with confidence + source
 *   4. User approves / edits / rejects each field
 *   5. Approved fields are saved into programme phase inputs
 *
 * Graceful degradation:
 *   - When AI is unavailable the document is still uploaded and stored
 *   - A clear, friendly message explains what happened
 *   - No broken states, no raw errors
 */

import React, { useEffect, useRef, useState } from "react";
import { useAIStatus } from "@/v3/hooks/useAIStatus";
import { ACCEPTED_FILE_EXTENSIONS, detectFileType, FILE_TYPE_LABELS, getFileTypeEmoji } from "@/new/lib/parseDocumentToText";
import { useDocumentIntelligence } from "@/new/lib/useDocumentIntelligence";
import { DocumentReviewPanel } from "@/new/components/DocumentReviewPanel";
import { PHASE_LABELS, type AtosPhase } from "@/new/lib/documentPhaseMap";
import type { DocumentImportResult } from "@/new/lib/useDocumentIntelligence";
import type { DynamicSchemaStore } from "@/v3/lib/dynamicSchema";

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

interface DocumentImportPanelProps {
  programId: string | null;
  /** Existing phase inputs — used for conflict detection */
  existingPhaseInputs?: Record<string, Record<string, string>>;
  /** Programme's dynamic schema — gates which phases/fields an import can target */
  dynamicSchemaStore?: DynamicSchemaStore;
  /**
   * Phases whose gate is approved (inputs frozen). Their extracted fields are shown
   * read-only in the review panel and excluded from the import, so the user learns
   * the phase is locked up front instead of after a silent post-save drop.
   */
  lockedPhaseIds?: Set<string>;
  /** Called when the user saves approved inputs (single phase — legacy) */
  onSavePhaseInputs?: (phaseId: string, inputs: Record<string, string>) => Promise<void>;
  /** Preferred: atomic save for all phases at once, avoids stale-closure overwrites */
  onSaveAllPhaseInputs?: (allInputs: Record<string, Record<string, string>>, firstPhaseId?: string) => Promise<void>;
  /** AI merge-and-refine for fields that collide with an existing value. */
  onRefineField?: (phaseId: string, fieldId: string, fieldLabel: string, existingValue: string, incomingValue: string) => Promise<string>;
  /** Called after a successful import (with or without extraction) */
  onComplete?: (result?: DocumentImportResult) => void | Promise<void>;
  onClose?: () => void;
}

export default function DocumentImportPanel({
  programId,
  existingPhaseInputs = {},
  dynamicSchemaStore,
  lockedPhaseIds,
  onSavePhaseInputs,
  onSaveAllPhaseInputs,
  onRefineField,
  onComplete,
  onClose,
}: DocumentImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [phaseOverride, setPhaseOverride] = useState<AtosPhase | "">("");
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const aiStatus = useAIStatus();
  const aiAvailable = aiStatus.status === "connected";

  const {
    stage,
    error,
    progress,
    intelligence,
    reviewFields,
    aiUnavailable,
    importFile,
    importText,
    updateReviewField,
    save,
    reset,
  } = useDocumentIntelligence({
    programId,
    existingPhaseInputs,
    dynamicSchemaStore,
    lockedPhaseIds,
    onComplete,
  });

  function resetAll() {
    setSelectedFile(null);
    setSelectionError(null);
    reset();
  }

  // ── Re-extract from a stored document ──────────────────────────────────────
  // The documents list dispatches `adam:reextract-document` with the document's
  // stored raw text. We re-run the extractor over that text (no file re-upload)
  // and surface the same review → save flow used for fresh imports.
  useEffect(() => {
    const handleReextract = (event: Event) => {
      const detail = (event as CustomEvent<{
        programId?: string;
        documentId?: string;
        rawText?: string;
        fileName?: string;
        phaseHint?: string;
      }>).detail;
      if (!detail) return;
      if (detail.programId && programId && detail.programId !== programId) return;
      setSelectedFile(null);
      setSelectionError(null);
      void importText(detail.rawText ?? "", detail.fileName ?? "document", detail.phaseHint || undefined, detail.documentId || undefined);
    };
    window.addEventListener("adam:reextract-document", handleReextract as EventListener);
    return () => {
      window.removeEventListener("adam:reextract-document", handleReextract as EventListener);
    };
  }, [programId, importText]);

  function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const file = files[0];
    if (file.size > MAX_FILE_BYTES) {
      setSelectionError("This file exceeds the 50 MB limit. Please upload a smaller document.");
      return;
    }
    setSelectionError(null);
    setSelectedFile(file);
    reset();
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    handleFiles(event.dataTransfer.files);
  }

  async function handleImport() {
    if (!selectedFile) return;
    await importFile(selectedFile, phaseOverride || undefined);
  }

  const isRunning = stage === "parsing" || stage === "extracting" || stage === "saving";

  const stageLabel: Record<string, string> = {
    parsing: "Reading document…",
    extracting: "AI is analysing content…",
    saving: "Saving approved fields…",
  };

  // ── AI unavailable banner ──────────────────────────────────────────────────
  const showAIWarning = aiStatus.status === "not-configured" || aiStatus.status === "error";

  return (
    <div
      style={{
        background: "var(--v3-surface)",
        border: "1px solid var(--v3-border)",
        borderRadius: "var(--v3-radius-lg)",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 620,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--v3-text-primary)" }}>
            Import Document
          </div>
          <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 3 }}>
            PDF · DOCX · PPTX · XLSX · HTML · MD · PNG/JPG · CSV · JSON · ZIP · EML · more — Max 50 MB
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--v3-text-muted)", fontSize: 20, lineHeight: 1, padding: 2 }}
          >
            ×
          </button>
        )}
      </div>

      {/* AI status warning */}
      {showAIWarning && (
        <div
          style={{
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.25)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 12,
            color: "#f59e0b",
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 14, marginTop: 1 }}>⚠</span>
          <div>
            <strong>
              {aiStatus.status === "not-configured"
                ? "AI provider not configured."
                : "AI service temporarily unavailable."}
            </strong>{" "}
            You can still upload documents — they will be stored and available for manual review.
            AI-assisted extraction will be unavailable until a provider is connected.
          </div>
        </div>
      )}

      {/* ── Drop zone (idle with no file selected) ── */}
      {!selectedFile && stage === "idle" && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? "var(--v3-accent)" : "var(--v3-border)"}`,
            borderRadius: "var(--v3-radius)",
            padding: "36px 16px",
            textAlign: "center",
            cursor: "pointer",
            background: dragOver ? "rgba(99,102,241,0.05)" : "transparent",
            transition: "all 0.15s",
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
          <div style={{ fontSize: 13, color: "var(--v3-text-secondary)" }}>
            Drop a file here or <span style={{ color: "var(--v3-accent)" }}>browse</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 6 }}>
            Documents, spreadsheets, slides, images, PDFs, emails and more
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FILE_EXTENSIONS}
            style={{ display: "none" }}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      )}

      {/* ── File selected, ready to import ── */}
      {selectedFile && stage === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* File card */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "var(--v3-surface-2)",
              borderRadius: "var(--v3-radius)",
              padding: "10px 14px",
            }}
          >
            <span style={{ fontSize: 20 }}>{getFileTypeEmoji(detectFileType(selectedFile))}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedFile.name}
              </div>
              <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                {FILE_TYPE_LABELS[detectFileType(selectedFile) ?? "text"] ?? "Document"} · {(selectedFile.size / 1024).toFixed(0)} KB
              </div>
            </div>
            <button
              type="button"
              onClick={resetAll}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--v3-text-muted)", fontSize: 18 }}
            >
              ×
            </button>
          </div>

          {/* Phase override */}
          <div>
            <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Phase hint (optional)
            </div>
            <select
              value={phaseOverride}
              onChange={(e) => setPhaseOverride(e.target.value as AtosPhase | "")}
              style={{
                width: "100%",
                background: "var(--v3-surface-2)",
                border: "1px solid var(--v3-border)",
                borderRadius: "var(--v3-radius-sm)",
                padding: "8px 12px",
                fontSize: 13,
                color: "var(--v3-text-secondary)",
                outline: "none",
              }}
            >
              <option value="">Auto-detect from content</option>
              {(Object.entries(PHASE_LABELS) as Array<[AtosPhase, string]>).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="v3-button primary"
            onClick={() => void handleImport()}
            disabled={!programId || !selectedFile}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {aiAvailable ? "Import & Extract →" : "Upload Document →"}
          </button>

          {!aiAvailable && (
            <div style={{ fontSize: 11, color: "var(--v3-text-muted)", textAlign: "center" }}>
              AI extraction is unavailable. The document will be stored for manual review.
            </div>
          )}
        </div>
      )}

      {/* ── Processing progress ── */}
      {isRunning && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 14,
                height: 14,
                border: "2px solid var(--v3-accent)",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <span style={{ fontSize: 13, color: "var(--v3-text-secondary)" }}>
              {stageLabel[stage] ?? "Processing…"}
            </span>
          </div>
          <div style={{ height: 4, background: "var(--v3-surface-2)", borderRadius: 2, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${progress}%`,
                background: "var(--v3-accent)",
                borderRadius: 2,
                transition: "width 0.4s ease",
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>{progress}% complete</div>
        </div>
      )}

      {/* ── Review panel ── */}
      {stage === "reviewing" && intelligence && (
        <DocumentReviewPanel
          intelligence={intelligence}
          reviewFields={reviewFields}
          lockedPhaseIds={lockedPhaseIds}
          saving={false}
          onUpdateField={(phaseId, fieldId, patch) => updateReviewField(phaseId, fieldId, patch)}
          onSave={() => {
            if (onSavePhaseInputs || onSaveAllPhaseInputs) {
              // Prefer batch save to avoid stale closure overwrites across multiple phases
              void save(
                onSavePhaseInputs ?? (async () => { /* noop fallback */ }),
                onSaveAllPhaseInputs,
                onRefineField,
              );
            } else {
              // No save handler provided — just call onComplete and close
              void onComplete?.();
              resetAll();
            }
          }}
          onCancel={resetAll}
        />
      )}

      {/* ── Error state ── */}
      {stage === "error" && (error || selectionError) && (
        <div
          style={{
            background: "var(--v3-red-soft)",
            border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: "var(--v3-radius)",
            padding: "12px 14px",
            fontSize: 13,
            color: "var(--v3-red)",
          }}
        >
          {selectionError || error}
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="v3-button ghost"
              style={{ fontSize: 12 }}
              onClick={resetAll}
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* ── Done — AI unavailable, document stored ── */}
      {stage === "done" && aiUnavailable && (
        <div
          style={{
            background: "rgba(245,158,11,0.06)",
            border: "1px solid rgba(245,158,11,0.2)",
            borderRadius: "var(--v3-radius)",
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "#f59e0b" }}>
            Document uploaded successfully
          </div>
          <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 5, lineHeight: 1.5 }}>
            AI-assisted extraction is currently unavailable. The document has been stored and will be
            available for manual review. You can retry extraction once an AI provider is connected in
            Settings.
          </div>
          <button
            type="button"
            className="v3-button ghost"
            style={{ fontSize: 12, marginTop: 10 }}
            onClick={resetAll}
          >
            Upload another
          </button>
        </div>
      )}

      {/* ── Done — successful with extraction ── */}
      {stage === "done" && !aiUnavailable && (
        <div
          style={{
            background: "var(--v3-green-soft)",
            border: "1px solid rgba(34,197,94,0.2)",
            borderRadius: "var(--v3-radius)",
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-green)" }}>
            Document imported and fields populated ✓
          </div>
          <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 5, lineHeight: 1.5 }}>
            Approved fields have been saved to the relevant phase inputs. Open the Inputs panel in the
            stage view to review and further edit the populated values.
          </div>
          <button
            type="button"
            className="v3-button ghost"
            style={{ fontSize: 12, marginTop: 10 }}
            onClick={resetAll}
          >
            Import another
          </button>
        </div>
      )}

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
