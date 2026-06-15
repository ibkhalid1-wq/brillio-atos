import React from "react";
import type { ProgramSummary } from "@/new/types";
import { derivePhaseChanges, type PhaseChangeTone } from "@/v3/lib/phaseChangeSummary";

const TONE_DOT: Record<PhaseChangeTone, string> = {
  added: "var(--v3-accent)",
  updated: "var(--v3-amber)",
  resolved: "var(--v3-green)",
};

const TONE_LABEL: Record<PhaseChangeTone, string> = {
  added: "New",
  updated: "Updated",
  resolved: "Resolved",
};

/**
 * "Since your last visit" — a compact, dismissible recap of what changed on this
 * phase. The baseline (last-seen timestamp) is persisted per program+phase in
 * localStorage; on first ever visit we silently set the baseline and show nothing.
 */
export function PhaseChangeSummary({
  program,
  phaseId,
}: {
  program: ProgramSummary | null;
  phaseId: string | null;
}) {
  const storageKey = program && phaseId ? `atlas-v3-phase-visit:${program.id}:${phaseId}` : null;

  const readSince = React.useCallback((): string | null => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }, [storageKey]);

  const [since, setSince] = React.useState<string | null>(readSince);

  // Re-read the baseline whenever the phase (storage key) changes.
  React.useEffect(() => {
    setSince(readSince());
  }, [readSince]);

  // Establish the baseline on the first ever visit, without showing a recap.
  React.useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    if (since === null) {
      try {
        window.localStorage.setItem(storageKey, new Date().toISOString());
      } catch {
        /* ignore quota / privacy-mode errors */
      }
    }
  }, [since, storageKey]);

  const changes = React.useMemo(
    () => derivePhaseChanges(program, phaseId, since),
    [program, phaseId, since],
  );

  function markSeen() {
    if (!storageKey || typeof window === "undefined") return;
    const now = new Date().toISOString();
    try {
      window.localStorage.setItem(storageKey, now);
    } catch {
      /* ignore */
    }
    setSince(now);
  }

  if (!changes.length) return null;

  const shown = changes.slice(0, 5);
  const extra = changes.length - shown.length;

  return (
    <div className="v3-change-summary">
      <div className="v3-change-summary-head">
        <span className="v3-change-summary-title">Since your last visit</span>
        <button type="button" className="v3-change-summary-dismiss" onClick={markSeen}>
          Mark as seen
        </button>
      </div>
      <ul className="v3-change-summary-list">
        {shown.map((change) => (
          <li key={change.id} className="v3-change-summary-item">
            <span className="v3-change-summary-dot" style={{ background: TONE_DOT[change.tone] }} aria-hidden="true" />
            <span className="v3-change-summary-label">{change.label}</span>
            <span className="v3-change-summary-tag">{TONE_LABEL[change.tone]} · {change.detail}</span>
          </li>
        ))}
      </ul>
      {extra > 0 ? <div className="v3-change-summary-more">+{extra} more change{extra === 1 ? "" : "s"}</div> : null}
    </div>
  );
}

export default PhaseChangeSummary;
