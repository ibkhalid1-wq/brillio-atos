import React, { useState } from "react";
import { Button } from "@/v3/components/ui/Button";
import { DelayedConfirmButton } from "@/v3/components/ui/DelayedConfirmButton";
import { ReadinessArcGauge } from "@/v3/components/ReadinessArcGauge";

interface GateApprovalModalProps {
  phaseId: string;
  phaseLabel: string;
  review: {
    readinessScore?: number;
    exitCriteria?: Array<{ label: string; status: "pass" | "fail" | "partial" }>;
    humanNote?: string;
  };
  onApprove: (phaseId: string) => Promise<void>;
  onRequestRemediation: (phaseId: string, note: string) => Promise<void>;
  onClose: () => void;
  open: boolean;
}

const STATUS_ICON: Record<string, { icon: string; color: string }> = {
  pass: { icon: "✓", color: "var(--v3-green)" },
  fail: { icon: "✗", color: "var(--v3-red)" },
  partial: { icon: "⊘", color: "var(--v3-amber)" },
};

export function GateApprovalModal({ phaseId, phaseLabel, review, onApprove, onRequestRemediation, onClose, open }: GateApprovalModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [showRemediation, setShowRemediation] = useState(false);
  const [remediationNote, setRemediationNote] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleApprove = async () => {
    if (!confirmed) return;
    setLoading(true);
    try {
      await onApprove(phaseId);
      onClose();
    } finally { setLoading(false); }
  };

  const handleRemediation = async () => {
    setLoading(true);
    try {
      await onRequestRemediation(phaseId, remediationNote);
      onClose();
    } finally { setLoading(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--v3-surface)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius-xl)", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "var(--v3-shadow-sheet)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--v3-border)" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--v3-text-primary)" }}>Approve {phaseLabel} Gate</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--v3-text-muted)", fontSize: 18 }}>×</button>
        </div>

        <div style={{ padding: "20px" }}>
          {/* Readiness */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
            <ReadinessArcGauge score={review.readinessScore ?? 0} size={80} />
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--v3-text-primary)" }}>{review.readinessScore ?? 0}%</div>
              <div style={{ fontSize: 12, color: "var(--v3-text-secondary)" }}>Gate Readiness</div>
            </div>
          </div>

          {(review.readinessScore ?? 0) < 70 && (
            <div style={{ background: "color-mix(in srgb, var(--v3-amber) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--v3-amber) 30%, transparent)", borderRadius: "var(--v3-radius)", padding: "10px 12px", marginBottom: 16, fontSize: 13, color: "var(--v3-text-primary)" }}>
              <strong>Gate readiness is below 70%.</strong> Consider running the Readiness Coach agent to identify blockers before approving.
            </div>
          )}

          {/* Exit criteria */}
          {review.exitCriteria && review.exitCriteria.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--v3-text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>Exit Criteria</div>
              {review.exitCriteria.map((c, i) => {
                const s = STATUS_ICON[c.status];
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--v3-border-soft)" }}>
                    <span style={{ color: s.color, fontWeight: 600, width: 16, textAlign: "center" }}>{s.icon}</span>
                    <span style={{ fontSize: 13, color: "var(--v3-text-primary)" }}>{c.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Human note */}
          {review.humanNote && (
            <div style={{ background: "var(--v3-surface-2)", borderRadius: "var(--v3-radius)", padding: "10px 12px", marginBottom: 16, fontSize: 13, color: "var(--v3-text-secondary)", fontStyle: "italic" }}>
              "{review.humanNote}"
            </div>
          )}

          {/* Confirmation */}
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 16 }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ marginTop: 2, accentColor: "var(--v3-accent)" }} />
            <span style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>
              I confirm the gate conditions have been reviewed and the programme is ready to proceed
            </span>
          </label>

          {/* Remediation */}
          {showRemediation && (
            <div style={{ marginBottom: 16 }}>
              <textarea
                value={remediationNote}
                onChange={(e) => setRemediationNote(e.target.value)}
                placeholder="Describe what needs to be remediated…"
                rows={3}
                className="v3-input v3-textarea"
                style={{ minHeight: 96, background: "var(--v3-surface-2)" }}
              />
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            {!showRemediation ? (
              <Button size="sm" variant="secondary" onClick={() => setShowRemediation(true)}>Request Remediation</Button>
            ) : (
              <Button size="sm" variant="danger" loading={loading} disabled={!remediationNote.trim()} onClick={handleRemediation}>Submit Remediation</Button>
            )}
            <DelayedConfirmButton
              onConfirm={handleApprove}
              label="Approve Gate"
              confirmingLabel="Hold to approve…"
              delayMs={2000}
              disabled={!confirmed}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
