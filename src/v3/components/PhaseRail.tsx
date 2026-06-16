import React from "react";
import { CheckCircle2, Circle, AlertCircle } from "lucide-react";
import type { ProgramSummary } from "@/new/types";
import { phaseName } from "@/v3/utils";

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
  return (
    <div className="v3-phase-rail-wrap">
      <div className="v3-phase-rail-fade" aria-hidden="true" />
      <div className="v3-phase-rail" role="navigation" aria-label="Programme phases">
        {phases.map((phase, index: number) => {
          const isActive = phase.id === activePhaseId;
          const isLocked = lockedPhaseIds.has(phase.id);
          const gate = gateReviews[phase.id];
          const isDone = gate?.status === "approved" || phase.status === "complete" || phase.pct >= 100;

          return (
            <React.Fragment key={phase.id}>
              <button
                type="button"
                onClick={() => !isLocked && onPhaseClick(phase.id)}
                disabled={isLocked}
                title={isLocked ? `${phaseName(phase)} unlocks once the preceding gate is approved` : undefined}
                aria-current={isActive ? "page" : undefined}
                aria-label={`${phaseName(phase)} phase${isActive ? ", active" : ""}${isDone ? ", completed" : ""}${isLocked ? ", locked" : ""}`}
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
                <span className="v3-phase-rail-pill-label">{phaseName(phase)}</span>
                {isActive && (
                  <span style={{ fontSize: 10, color: "var(--v3-accent)", fontWeight: 600, display: "block", marginTop: 1, letterSpacing: "0.02em" }}>
                    Stage {index + 1}
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
