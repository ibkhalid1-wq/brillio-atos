// ─── PhaseFlowBar ─────────────────────────────────────────────────────────────
// Methodology flow indicator: "Strategy → Mobilise → ●Design→ Build →…"
// Shows all phases in sequence with the active phase highlighted and gate
// status indicated. Satisfies Priority 5 — Information Architecture.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import type { ProgramSummary } from "@/new/types";

interface PhaseFlowBarProps {
  program: ProgramSummary;
  activePhaseId: string | null;
  lockedPhaseIds: Set<string>;
  onSelectPhase?: (phaseId: string) => void;
}

function gateStatusIcon(status: string | undefined): string {
  if (status === "approved") return "✓";
  if (status === "ready" || status === "pending-review") return "○";
  if (status === "remediation-requested") return "!";
  return "·";
}

export function PhaseFlowBar({
  program,
  activePhaseId,
  lockedPhaseIds,
  onSelectPhase,
}: PhaseFlowBarProps) {
  const phases = program.phases || [];
  if (phases.length === 0) return null;

  const activeIndex = phases.findIndex((p) => p.id === activePhaseId);

  return (
    <div
      aria-label="Methodology phase flow"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        overflowX: "auto",
        scrollbarWidth: "none",
        padding: "0 2px",
        flexShrink: 0,
      }}
    >
      {phases.map((phase, idx) => {
        const isActive = phase.id === activePhaseId;
        const isLocked = lockedPhaseIds.has(phase.id);
        const isPast = idx < activeIndex;
        const gateStatus = program.gateReviews?.[phase.id]?.status;
        const icon = gateStatusIcon(gateStatus);

        const color = isActive
          ? "var(--v3-accent)"
          : isPast
          ? "var(--v3-green)"
          : isLocked
          ? "var(--v3-text-muted)"
          : "var(--v3-text-secondary)";

        const fontWeight = isActive ? 700 : isPast ? 500 : 400;

        return (
          <React.Fragment key={phase.id}>
            {idx > 0 && (
              <span
                style={{
                  color: "var(--v3-border)",
                  fontSize: 10,
                  margin: "0 3px",
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                →
              </span>
            )}
            <button
              type="button"
              aria-label={`${phase.displayName ?? phase.id}${isActive ? " (active)" : isLocked ? " (locked)" : ""}`}
              aria-current={isActive ? "step" : undefined}
              onClick={!isLocked && onSelectPhase ? () => onSelectPhase(phase.id) : undefined}
              title={
                isLocked
                  ? `${phase.displayName ?? phase.id} — locked (approve previous gate to unlock)`
                  : gateStatus === "approved"
                  ? `${phase.displayName ?? phase.id} — gate approved`
                  : isActive
                  ? `${phase.displayName ?? phase.id} — active phase`
                  : phase.displayName ?? phase.id
              }
              style={{
                background: "none",
                border: "none",
                padding: "2px 4px",
                cursor: isLocked || !onSelectPhase ? "default" : "pointer",
                color,
                fontSize: 11,
                fontWeight,
                letterSpacing: isActive ? 0.3 : 0,
                whiteSpace: "nowrap",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: 3,
                opacity: isLocked ? 0.4 : 1,
                borderRadius: 4,
                transition: "color 0.15s",
              }}
            >
              {isActive && (
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--v3-accent)",
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                />
              )}
              <span>{phase.displayName ?? phase.id}</span>
              {icon !== "·" && (
                <span
                  style={{
                    fontSize: 9,
                    color: gateStatus === "approved"
                      ? "var(--v3-green)"
                      : gateStatus === "remediation-requested"
                      ? "var(--v3-amber)"
                      : "var(--v3-text-muted)",
                  }}
                  aria-hidden="true"
                >
                  {icon}
                </span>
              )}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
