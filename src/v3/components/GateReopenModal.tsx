import React, { useState, useEffect } from "react";

interface GateReopenModalProps {
  open: boolean;
  phaseName: string;
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
}

export default function GateReopenModal({ open, phaseName, onClose, onConfirm }: GateReopenModalProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) { setReason(""); setSubmitting(false); }
  }, [open]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (!reason.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => { if (!submitting) onClose(); };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        background: "rgba(0,0,0,0.55)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24,
      }}
      onClick={close}
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
          disabled={submitting}
          placeholder="Reason for reopening (e.g. exit criteria not fully met, new risk identified)…"
          className="v3-input v3-textarea"
          style={{ minHeight: 96, background: "var(--v3-surface-2)" }}
        />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="v3-button ghost" onClick={close} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="v3-button primary"
            disabled={!reason.trim() || submitting}
            onClick={handleConfirm}
          >
            {submitting ? "Reopening…" : "Reopen Gate"}
          </button>
        </div>
      </div>
    </div>
  );
}
