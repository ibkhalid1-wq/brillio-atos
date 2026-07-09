import React from "react";
import { CheckCircle2, Circle, AlertCircle } from "lucide-react";
import type { ProgramSummary } from "@/new/types";
import { phaseName } from "@/v3/utils";
import { getPhaseDefinition } from "@/v3/lib/methodology";

interface PhaseRailProps {
  phases: ProgramSummary["phases"];
  activePhaseId: string;
  gateReviews: Record<string, { status?: string } | undefined>;
  lockedPhaseIds: Set<string>;
  onPhaseClick: (phaseId: string) => void;
}

export function PhaseRail({
  phases,
  activePhaseId,
  gateReviews,
  lockedPhaseIds,
  onPhaseClick,
}: PhaseRailProps) {
  const railRef = React.useRef<HTMLDivElement>(null);
  const activeRef = React.useRef<HTMLButtonElement>(null);

  // The rail scrolls horizontally; when the active stage changes (e.g. navigating
  // to the programme screen lands on the current stage), bring its pill into view
  // so the control actually moves to the current stage instead of leaving it
  // highlighted but scrolled off. Scroll the rail itself — never the page — by
  // nudging scrollLeft so the active pill is centred.
  React.useEffect(() => {
    const rail = railRef.current;
    const pill = activeRef.current;
    if (!rail || !pill) return;
    const railRect = rail.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const delta = (pillRect.left - railRect.left) - (rail.clientWidth / 2 - pill.clientWidth / 2);
    rail.scrollTo({ left: Math.max(0, rail.scrollLeft + delta), behavior: "smooth" });
  }, [activePhaseId]);

  return (
    <div className="v3-phase-rail-wrap">
      <div className="v3-phase-rail-fade" aria-hidden="true" />
      <div className="v3-phase-rail" role="navigation" aria-label="Programme phases" ref={railRef}>
        {phases.map((phase, index: number) => {
          const isActive = phase.id === activePhaseId;
          const isLocked = lockedPhaseIds.has(phase.id);
          const gate = gateReviews[phase.id];
          const isDone = gate?.status === "approved" || phase.status === "complete" || phase.pct >= 100;
          // ATOS Flow movements carry the movement metadata; stage-gate phases
          // don't. A movement pill hovers its readiness signal (the gate is a
          // demo, not a document) and the Evolve loop wears its ∞ marker.
          const movement = getPhaseDefinition(phase.id)?.movement;

          return (
            <React.Fragment key={phase.id}>
              <button
                type="button"
                ref={isActive ? activeRef : undefined}
                onClick={() => !isLocked && onPhaseClick(phase.id)}
                disabled={isLocked}
                title={
                  isLocked
                    ? `${phaseName(phase)} unlocks once the preceding gate is approved`
                    : movement
                      ? `Ready when: ${movement.readyWhen}`
                      : undefined
                }
                aria-current={isActive ? "page" : undefined}
                aria-label={`${phaseName(phase)} ${movement ? "movement" : "phase"}${isActive ? ", active" : ""}${isDone ? ", completed" : ""}${isLocked ? ", locked" : ""}`}
                className={[
                  "v3-phase-rail-pill",
                  isActive ? "is-active" : "",
                  isDone ? "is-done" : "",
                  isLocked ? "is-locked" : "",
                ].filter(Boolean).join(" ")}
              >
                {isDone ? (
                  <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" className="v3-phase-rail-pill-dot" />
                ) : isLocked ? (
                  <AlertCircle size={14} strokeWidth={2} aria-hidden="true" className="v3-phase-rail-pill-dot" />
                ) : (
                  <Circle size={14} strokeWidth={2} aria-hidden="true" className="v3-phase-rail-pill-dot" />
                )}
                <span className="v3-phase-rail-pill-label">
                  {phaseName(phase)}
                  {movement?.isLoop ? <span aria-hidden="true" style={{ marginLeft: 4, opacity: 0.7 }}>∞</span> : null}
                </span>
                {isActive && (
                  <span style={{ fontSize: 10, color: "var(--v3-accent)", fontWeight: 600, display: "block", marginTop: 1, letterSpacing: "0.02em" }}>
                    {movement ? (movement.isLoop ? "The loop" : `Movement ${index + 1}`) : `Stage ${index + 1}`}
                  </span>
                )}
              </button>
              {index < phases.length - 1 ? (
                <div
                  className={`v3-phase-rail-connector ${isDone ? "is-done" : ""}`}
                  aria-hidden="true"
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
