import React from "react";
import type { ProgramSummary } from "@/new/types";
import { PHASE_LABELS } from "@/v3/lib/uiHelpers";
import PhaseStatusRings from "@/v3/components/PhaseStatusRings";
import { derivePhaseStatusRings } from "@/v3/lib/phaseStatusRings";

export function PhaseStripCard({
  program,
  phase,
  active,
  isNext,
  locked = false,
  onClick,
}: {
  program: ProgramSummary;
  phase: ProgramSummary["phases"][number];
  active: boolean;
  isNext: boolean;
  locked?: boolean;
  onClick: () => void;
}) {
  const rings = derivePhaseStatusRings(program, phase.id);
  const label = PHASE_LABELS[phase.id] ?? phase.displayName ?? phase.id;

  // Rich tooltip — canonical KPI breakdown (inner Input · middle Artifact · outer Gate)
  const tooltipLines = locked
    ? "Locked — clear the previous phase gate to unlock this phase"
    : [
        rings.hasGate ? `Gate: ${rings.gate}%` : "Gate: no review yet",
        `Artifact: ${rings.artifact}%`,
        `Input: ${rings.input}%`,
        `Overall: ${rings.overall}%`,
      ].join(" · ");

  return (
    <button
      type="button"
      onClick={locked ? undefined : onClick}
      disabled={locked}
      aria-disabled={locked}
      title={tooltipLines}
      aria-label={`${label} — ${tooltipLines}`}
      style={{
        flex: "0 0 auto",        // C1: don't shrink; strip scrolls instead
        width: 96,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "14px 8px 12px",
        borderRadius: "var(--v3-radius)",
        background: active
          ? "color-mix(in srgb, var(--v3-accent) 8%, transparent)"
          : isNext
          ? "color-mix(in srgb, var(--v3-accent) 4%, var(--v3-surface))"
          : "var(--v3-surface)",
        border: `1px solid ${
          active ? "var(--v3-accent)" : isNext ? "color-mix(in srgb, var(--v3-accent) 35%, var(--v3-border-soft))" : "var(--v3-border-soft)"
        }`,
        cursor: locked ? "not-allowed" : "pointer",
        opacity: locked ? 0.45 : 1,
        position: "relative",
        overflow: "visible",
        transition: "border-color 0.15s, background 0.15s, opacity 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!active && !locked) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--v3-accent)";
      }}
      onMouseLeave={(e) => {
        if (!active && !locked) (e.currentTarget as HTMLButtonElement).style.borderColor =
          isNext ? "color-mix(in srgb, var(--v3-accent) 35%, var(--v3-border-soft))" : "var(--v3-border-soft)";
      }}
    >
      {/* Active glow stripe */}
      {active && (
        <span style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3,
          borderRadius: "var(--v3-radius) var(--v3-radius) 0 0",
          background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
        }} />
      )}

      {/* C2: "Up next" badge on the first upcoming phase */}
      {isNext && !active && (
        <span style={{
          position: "absolute", top: -8, right: -4,
          fontSize: 9, fontWeight: 700,
          color: "var(--v3-accent)",
          background: "color-mix(in srgb, var(--v3-accent) 15%, var(--v3-surface))",
          border: "1px solid color-mix(in srgb, var(--v3-accent) 40%, transparent)",
          borderRadius: 8,
          padding: "1px 5px",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          lineHeight: 1.6,
          fontFamily: "var(--v3-font)",
          whiteSpace: "nowrap",
        }}>
          Next →
        </span>
      )}

      {/* Lock badge on phases gated behind an unapproved predecessor */}
      {locked && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute", top: -8, right: -4,
            fontSize: 10, lineHeight: 1,
            color: "var(--v3-text-muted)",
            background: "var(--v3-surface)",
            border: "1px solid var(--v3-border-soft)",
            borderRadius: 8,
            padding: "3px 5px",
          }}
        >
          🔒
        </span>
      )}

      {/* Canonical 3-ring phase status — inner Input · middle Artifact · outer Gate.
          Overall score sits inside the rings for consistency with other screens. */}
      <PhaseStatusRings values={rings} size={56} showCenter />

      {/* Phase name */}
      <span style={{
        fontSize: 11,
        fontWeight: active ? 700 : 500,
        color: active ? "var(--v3-text-primary)" : "var(--v3-text-secondary)",
        textAlign: "center",
        lineHeight: 1.3,
        marginTop: 2,
      }}>
        {label}
      </span>
    </button>
  );
}
