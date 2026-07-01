import React, { useEffect, useState } from "react";

export interface LockedPhaseOption {
  id: string;
  name: string;
}

interface ChangeRequestModalProps {
  open: boolean;
  /** When set, the request targets this phase and the picker is hidden. */
  fixedPhase?: LockedPhaseOption;
  /** Selectable locked phases when no fixedPhase is given. */
  lockedPhases?: LockedPhaseOption[];
  onClose: () => void;
  onSubmit: (phaseId: string, title: string, reason: string) => void | Promise<void>;
}

export default function ChangeRequestModal({
  open,
  fixedPhase,
  lockedPhases = [],
  onClose,
  onSubmit,
}: ChangeRequestModalProps) {
  const [phaseId, setPhaseId] = useState(fixedPhase?.id ?? lockedPhases[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset ONLY when the modal transitions to open. Depending on `lockedPhases`
  // here is a trap: callers pass a fresh array (or the default `[]`) on every
  // render, so an unstable reference would re-run this effect after each
  // keystroke and wipe `title`/`reason` — making the Summary and Reason/impact
  // fields impossible to fill in. The props are read at open time inside the
  // effect, which is all the reset needs.
  useEffect(() => {
    if (open) {
      setPhaseId(fixedPhase?.id ?? lockedPhases[0]?.id ?? "");
      setTitle("");
      setReason("");
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const effectivePhaseId = fixedPhase?.id ?? phaseId;
  const canSubmit = !!effectivePhaseId && title.trim().length > 0 && reason.trim().length > 0 && !submitting;
  const close = () => { if (!submitting) onClose(); };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(effectivePhaseId, title.trim(), reason.trim());
    } finally {
      setSubmitting(false);
    }
  };

  const noTargets = !fixedPhase && lockedPhases.length === 0;

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
          border: "1px solid var(--v3-border)", padding: 28, maxWidth: 500, width: "100%",
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--v3-text-primary)", marginBottom: 6, fontFamily: "var(--v3-font)" }}>
          Raise change request{fixedPhase ? ` — ${fixedPhase.name}` : ""}
        </div>
        <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", marginBottom: 18, lineHeight: 1.5, fontFamily: "var(--v3-font)" }}>
          This stage is locked. Log a change request describing what needs to change and why.
          Once approved, the stage gate reopens for the controlled edit — and the request is kept for the audit trail.
        </div>

        {noTargets ? (
          <div style={{ fontSize: 13, color: "var(--v3-text-muted)", marginBottom: 18 }}>
            No locked stages to change. Change requests apply to stages that have already been closed.
          </div>
        ) : (
          <>
            {!fixedPhase ? (
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--v3-text-muted)", display: "block", marginBottom: 6 }}>
                  Locked stage
                </span>
                <select
                  value={phaseId}
                  onChange={(e) => setPhaseId(e.target.value)}
                  disabled={submitting}
                  className="v3-input"
                  style={{ width: "100%", background: "var(--v3-surface-2)" }}
                >
                  {lockedPhases.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            ) : null}

            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--v3-text-muted)", display: "block", marginBottom: 6 }}>
                Summary
              </span>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
                placeholder="e.g. Revise target operating model"
                className="v3-input"
                style={{ width: "100%", background: "var(--v3-surface-2)" }}
              />
            </label>

            <label style={{ display: "block" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--v3-text-muted)", display: "block", marginBottom: 6 }}>
                Reason / impact
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                placeholder="Why is this change needed? What does it affect?"
                className="v3-input v3-textarea"
                style={{ minHeight: 96, background: "var(--v3-surface-2)", width: "100%" }}
              />
            </label>
          </>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="v3-button ghost" onClick={close} disabled={submitting}>
            {noTargets ? "Close" : "Cancel"}
          </button>
          {!noTargets ? (
            <button type="button" className="v3-button primary" disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? "Logging…" : "Submit request"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
