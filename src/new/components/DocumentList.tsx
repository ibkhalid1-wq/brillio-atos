import React, { useState } from "react";
import { PHASE_LABELS, type AtosPhase } from "@/new/lib/documentPhaseMap";
import { FILE_TYPE_LABELS, getFileTypeEmoji, type SupportedFileType } from "@/new/lib/parseDocumentToText";
import { getDocumentDetail, useDocumentAttachments } from "@/new/lib/useDocumentAttachments";

export default function DocumentList({ programId }: { programId: string | null }) {
  const { data: docs, isLoading, error } = useDocumentAttachments(programId);
  // Track which document is busy so its buttons can show progress / disable.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Download the stored extraction: raw parsed text plus the structured
  // extracted_data JSON. The original binary is not retained, so this exports
  // what ATLAS actually holds for the document.
  async function handleDownload(id: string, fileName: string) {
    if (!programId) return;
    setBusyId(id);
    setActionError(null);
    try {
      const doc = await getDocumentDetail(programId, id);
      const sections: string[] = [];
      sections.push(`# ${doc.file_name}`);
      sections.push(
        `Phase: ${doc.phase_context ? (PHASE_LABELS[doc.phase_context as AtosPhase] || doc.phase_context) : "Unmapped"}`,
      );
      if (doc.confidence != null) sections.push(`Confidence: ${Math.round(doc.confidence * 100)}%`);
      sections.push(`Status: ${doc.extraction_status || "pending"}`);
      sections.push("");
      sections.push("## Extracted data");
      sections.push(
        doc.extracted_data && Object.keys(doc.extracted_data).length
          ? JSON.stringify(doc.extracted_data, null, 2)
          : "(none)",
      );
      sections.push("");
      sections.push("## Raw text");
      sections.push(doc.raw_text || "(no stored text)");

      const blob = new Blob([sections.join("\n")], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const base = fileName.replace(/\.[^.]+$/, "") || "document";
      a.download = `${base}-extraction.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Download failed.");
    } finally {
      setBusyId(null);
    }
  }

  // Re-run AI extraction over the document's stored raw text. The import panel
  // listens for this event and drives the same review → save flow.
  async function handleReextract(id: string, fileName: string, phaseContext: string | null) {
    if (!programId) return;
    setBusyId(id);
    setActionError(null);
    try {
      const doc = await getDocumentDetail(programId, id);
      if (!doc.raw_text || !doc.raw_text.trim()) {
        setActionError("No stored text to re-extract from for this document.");
        return;
      }
      window.dispatchEvent(
        new CustomEvent("adam:reextract-document", {
          detail: {
            programId,
            rawText: doc.raw_text,
            fileName: doc.file_name || fileName,
            phaseHint: phaseContext || undefined,
          },
        }),
      );
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Re-extract failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (!programId) {
    return (
      <div style={{ color: "var(--v3-text-muted)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
        Select a program to view imported documents.
      </div>
    );
  }

  if (isLoading) {
    return <div style={{ color: "var(--v3-text-muted)", fontSize: 13 }}>Loading documents...</div>;
  }

  if (error) {
    return (
      <div style={{ color: "var(--v3-red)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
        {error || "Unable to load documents."}
      </div>
    );
  }

  if (!docs?.length) {
    return (
      <div
        style={{
          color: "var(--v3-text-muted)",
          fontSize: 13,
          textAlign: "center",
          padding: "24px 0",
        }}
      >
        No documents imported yet.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--v3-text-muted)",
          marginBottom: 4,
        }}
      >
        Imported Documents
      </div>

      {actionError && (
        <div style={{ color: "var(--v3-red)", fontSize: 12, padding: "2px 2px 4px" }}>{actionError}</div>
      )}

      {docs.map((doc) => (
        <div
          key={doc.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 14px",
            background: "var(--v3-surface-2)",
            borderRadius: "var(--v3-radius)",
            border: "1px solid var(--v3-border-soft)",
          }}
        >
          <span style={{ fontSize: 18 }}>{getFileTypeEmoji(doc.file_type)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {doc.file_name}
            </div>
            <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>
              {FILE_TYPE_LABELS[(doc.file_type as SupportedFileType) ?? "text"] ?? "Document"}
              {" · "}
              {doc.phase_context
                ? (PHASE_LABELS[doc.phase_context as AtosPhase] || doc.phase_context)
                : "Unmapped"}
              {doc.confidence != null ? ` · ${Math.round(doc.confidence * 100)}% confidence` : ""}
              {doc.file_type === "image" && doc.ocr_confidence != null ? ` · OCR ${doc.ocr_confidence}%` : ""}
              {doc.created_at ? ` · ${new Date(doc.created_at).toLocaleDateString()}` : ""}
            </div>
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 20,
              background: doc.extraction_status === "extracted" ? "var(--v3-green-soft)" : "var(--v3-surface)",
              color: doc.extraction_status === "extracted" ? "var(--v3-green)" : "var(--v3-text-muted)",
            }}
          >
            {doc.extraction_status || "pending"}
          </span>

          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              title="Download stored extraction (text + data)"
              disabled={busyId === doc.id}
              onClick={() => void handleDownload(doc.id, doc.file_name)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: "var(--v3-radius-sm)",
                border: "1px solid var(--v3-border)",
                background: "var(--v3-surface)",
                color: "var(--v3-text-secondary)",
                cursor: busyId === doc.id ? "default" : "pointer",
                opacity: busyId === doc.id ? 0.5 : 1,
              }}
            >
              Download
            </button>
            <button
              type="button"
              title="Re-run AI extraction over the stored text"
              disabled={busyId === doc.id}
              onClick={() => void handleReextract(doc.id, doc.file_name, doc.phase_context)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: "var(--v3-radius-sm)",
                border: "1px solid var(--v3-border)",
                background: "var(--v3-surface)",
                color: "var(--v3-accent)",
                cursor: busyId === doc.id ? "default" : "pointer",
                opacity: busyId === doc.id ? 0.5 : 1,
              }}
            >
              {busyId === doc.id ? "…" : "Re-extract"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
