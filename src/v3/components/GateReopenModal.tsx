import React, { useState, useEffect } from "react";

interface GateReopenModalProps {
  open: boolean;
  phaseName: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export default function GateReopenModal({ open, phaseName, onClose, onConfirm }: GateReopenModalProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
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
          Reopen Gate — {phaseName}
        </div>
        <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", marginBottom: 18, lineHeight: 1.5, fontFamily: "var(--v3-font)" }}>
          Reopening this gate will lock the next phase and require re-approval. Provide a reason for the audit trail.
        </div>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for reopening (e.g. exit criteria not fully met, new risk identified)…"
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
            disabled={!reason.trim()}
            onClick={() => { if (reason.trim()) { onConfirm(reason.trim()); onClose(); } }}
            style={{
              padding: "8px 18px", background: reason.trim() ? "var(--v3-accent)" : "var(--v3-surface-3)",
              border: "none", borderRadius: "var(--v3-radius)",
              cursor: reason.trim() ? "pointer" : "not-allowed", fontSize: 13,
              color: reason.trim() ? "#fff" : "var(--v3-text-muted)",
              fontFamily: "var(--v3-font)", fontWeight: 600,
              transition: "background 0.15s",
            }}
          >
            Reopen Gate
          </button>
        </div>
      </div>
    </div>
  );
}
