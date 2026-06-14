import React, { useState, useEffect } from "react";

interface RemediationNoteModalProps {
  open: boolean;
  phaseName: string;
  onClose: () => void;
  onConfirm: (note: string) => void;
}

export default function RemediationNoteModal({ open, phaseName, onClose, onConfirm }: RemediationNoteModalProps) {
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        background: "rgba(0,0,0,0.55)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--v3-surface)", borderRadius: "var(--v3-radius)",
          border: "1px solid var(--v3-border)", padding: 28, maxWidth: 480, width: "100%",
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--v3-text-primary)", marginBottom: 6, fontFamily: "var(--v3-font)" }}>
          Flag Issues — {phaseName}
        </div>
        <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", marginBottom: 18, lineHeight: 1.5, fontFamily: "var(--v3-font)" }}>
          Describe the issues that need remediation before this gate can be approved. This will be added to the programme audit trail.
        </div>
        <textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Describe the issues requiring remediation (e.g. missing exit criteria, outstanding risks, incomplete artefacts)…"
          className="v3-input v3-textarea"
          style={{ minHeight: 96, background: "var(--v3-surface-2)" }}
        />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 18px", background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)",
              borderRadius: "var(--v3-radius)", cursor: "pointer", fontSize: 13,
              color: "var(--v3-text-secondary)", fontFamily: "var(--v3-font)", fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            disabled={!note.trim()}
            onClick={() => { if (note.trim()) { onConfirm(note.trim()); onClose(); } }}
            style={{
              padding: "8px 18px", background: note.trim() ? "var(--v3-amber)" : "var(--v3-surface-3)",
              border: "none", borderRadius: "var(--v3-radius)",
              cursor: note.trim() ? "pointer" : "not-allowed", fontSize: 13,
              color: note.trim() ? "#fff" : "var(--v3-text-muted)",
              fontFamily: "var(--v3-font)", fontWeight: 600,
              transition: "background 0.15s",
            }}
          >
            Flag Issues
          </button>
        </div>
      </div>
    </div>
  );
}
