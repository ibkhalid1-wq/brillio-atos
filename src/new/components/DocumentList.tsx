import React from "react";
import { PHASE_LABELS, type AtosPhase } from "@/new/lib/documentPhaseMap";
import { FILE_TYPE_LABELS, getFileTypeEmoji, type SupportedFileType } from "@/new/lib/parseDocumentToText";
import { useDocumentAttachments } from "@/new/lib/useDocumentAttachments";

export default function DocumentList({ programId }: { programId: string | null }) {
  const { data: docs, isLoading, error } = useDocumentAttachments(programId);

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
        </div>
      ))}
    </div>
  );
}
