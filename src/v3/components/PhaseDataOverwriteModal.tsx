import React from "react";

interface PhaseDataOverwriteModalProps {
  open: boolean;
  phaseName: string;
  onOverwrite: () => void;
  onKeep: () => void;
}

/**
 * Shown when closing a phase whose *next* phase already holds inputs/artifacts.
 * Regenerating with AI would replace that work, so the user explicitly chooses
 * to overwrite (recreate) or keep the existing data untouched.
 */
export default function PhaseDataOverwriteModal({ open, phaseName, onOverwrite, onKeep }: PhaseDataOverwriteModalProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        background: "rgba(0,0,0,0.55)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24,
      }}
      onClick={onKeep}
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
          {phaseName} already has data
        </div>
        <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", marginBottom: 18, lineHeight: 1.5, fontFamily: "var(--v3-font)" }}>
          The {phaseName} phase already has input fields and artifacts. Regenerating with AI
          will replace them and discard any data captured there. Keep the existing data, or
          overwrite the inputs and artifacts?
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="v3-button ghost" onClick={onKeep}>
            Keep existing
          </button>
          <button type="button" className="v3-button primary" onClick={onOverwrite}>
            Overwrite
          </button>
        </div>
      </div>
    </div>
  );
}
