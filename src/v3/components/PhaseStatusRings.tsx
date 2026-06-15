import React from "react";
import type { ProgramSummary } from "@/new/types";
import {
  derivePhaseStatusRings,
  type PhaseStatusRingValues,
} from "@/v3/lib/phaseStatusRings";

/**
 * PhaseStatusRings — the single, canonical embedded 3-ring (concentric donut)
 * phase-status visual used on every surface (Home, Programme, Executive
 * Summary, Phase, …). The KPI-to-ring mapping is fixed and identical everywhere:
 *
 *   • inner ring  → Input Score
 *   • middle ring → Artifact Score
 *   • outer ring  → Gate Score   (rendered as a muted track until a gate exists)
 *
 * Purely presentational. Pass either pre-derived `values`, or a `program` +
 * `phaseId` and it derives them via the shared pure helper.
 */

type PhaseStatusRingsProps = {
  size?: number;
  /** Show the composite phase score in the centre. */
  showCenter?: boolean;
  /** Render the canonical Gate / Artifact / Input legend beneath the rings. */
  showLegend?: boolean;
  /** Optional title override for the hover tooltip. */
  title?: string;
  className?: string;
} & (
  | { values: PhaseStatusRingValues; program?: never; phaseId?: never }
  | { program: ProgramSummary; phaseId: string; values?: never }
);

const TRACK = "var(--v3-surface-3)";

/**
 * Each ring has its OWN identity colour so the three KPIs are instantly
 * distinguishable at a glance (arc length still encodes the value 0-100):
 *   • outer  Gate     → blue
 *   • middle Artifact → violet
 *   • inner  Input    → teal
 */
const RING_COLORS = {
  gate: "var(--v3-accent-b)", // blue
  artifact: "#A78BFA",        // violet
  input: "#2DD4BF",           // teal
} as const;

function ringArc(r: number, pct: number): { dasharray: number; dashoffset: number } {
  const circ = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  return { dasharray: circ, dashoffset: circ - (clamped / 100) * circ };
}

export function PhaseStatusRings(props: PhaseStatusRingsProps) {
  const { size = 52, showCenter = false, showLegend = false, title, className } = props;

  const values: PhaseStatusRingValues =
    props.values ?? derivePhaseStatusRings(props.program, props.phaseId);

  const { input, artifact, gate, overall, hasGate } = values;

  const cx = size / 2;
  // Thicker strokes for a bolder, more legible donut. The track matches the
  // value-arc width but stays visually subtle (low opacity) so the coloured
  // arcs dominate without the background reading as a heavy grey ring.
  const sw = Math.max(3.4, cx * 0.17);
  const gap = sw * 1.45;
  const rOuter = cx - sw / 2 - 0.5;
  const rMid = rOuter - gap;
  const rInner = Math.max(sw, rMid - gap);

  const outer = ringArc(rOuter, gate ?? 0);
  const mid = ringArc(rMid, artifact);
  const inner = ringArc(rInner, input);

  const gateCol = hasGate ? RING_COLORS.gate : "var(--v3-border)";
  const artifactCol = RING_COLORS.artifact;
  const inputCol = RING_COLORS.input;

  // Centre readout includes the unit ("78%") and is sized to fit inside the
  // inner ring — narrower for longer values like "100%" so it never overflows.
  const centerText = `${overall}%`;
  const innerSpace = (rInner + sw / 2) * 2 * 0.92; // usable width up to the inner ring's outer edge
  const centerFontSize = Math.max(
    8,
    Math.min(size * 0.26, innerSpace / (centerText.length * 0.62)),
  );

  const tooltip =
    title ??
    [
      `Gate: ${hasGate ? `${gate}%` : "no review yet"}`,
      `Artifact: ${artifact}%`,
      `Input: ${input}%`,
      `Overall: ${overall}%`,
    ].join(" · ");

  return (
    <div
      className={`v3-phase-rings${className ? ` ${className}` : ""}`}
      title={tooltip}
      role="img"
      aria-label={tooltip}
    >
      <div className="v3-phase-rings-svg" style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ overflow: "visible" }}>
          {/* Tracks — full width but subtle (low opacity) behind the value arcs */}
          <circle cx={cx} cy={cx} r={rOuter} fill="none" stroke={TRACK} strokeWidth={sw} strokeOpacity={0.3} />
          <circle cx={cx} cy={cx} r={rMid} fill="none" stroke={TRACK} strokeWidth={sw} strokeOpacity={0.3} />
          <circle cx={cx} cy={cx} r={rInner} fill="none" stroke={TRACK} strokeWidth={sw} strokeOpacity={0.3} />

          {/* Outer — Gate */}
          {hasGate && (gate ?? 0) > 0 && (
            <circle
              cx={cx} cy={cx} r={rOuter}
              fill="none" stroke={gateCol} strokeWidth={sw}
              strokeLinecap="round"
              strokeDasharray={outer.dasharray}
              strokeDashoffset={outer.dashoffset}
              transform={`rotate(-90 ${cx} ${cx})`}
            />
          )}

          {/* Middle — Artifact */}
          {artifact > 0 && (
            <circle
              cx={cx} cy={cx} r={rMid}
              fill="none" stroke={artifactCol} strokeWidth={sw}
              strokeLinecap="round"
              strokeDasharray={mid.dasharray}
              strokeDashoffset={mid.dashoffset}
              transform={`rotate(-90 ${cx} ${cx})`}
            />
          )}

          {/* Inner — Input */}
          {input > 0 && (
            <circle
              cx={cx} cy={cx} r={rInner}
              fill="none" stroke={inputCol} strokeWidth={sw}
              strokeLinecap="round"
              strokeDasharray={inner.dasharray}
              strokeDashoffset={inner.dashoffset}
              transform={`rotate(-90 ${cx} ${cx})`}
            />
          )}
        </svg>

        {showCenter && (
          <span
            className="v3-phase-rings-center"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: centerFontSize,
              fontWeight: 700,
              color: "var(--v3-text-primary)",
              fontFamily: "var(--v3-font)",
              letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
            }}
          >
            {centerText}
          </span>
        )}
      </div>

      {showLegend && (
        <div className="v3-phase-rings-legend">
          {[
            { color: gateCol, label: "Gate", value: hasGate ? `${gate}%` : "—" },
            { color: artifactCol, label: "Artifact", value: `${artifact}%` },
            { color: inputCol, label: "Input", value: `${input}%` },
          ].map(({ color, label, value }) => (
            <span key={label} className="v3-phase-rings-legend-item">
              <svg width={9} height={9} viewBox="0 0 9 9" aria-hidden="true">
                <circle cx={4.5} cy={4.5} r={3.5} fill="none" stroke={color} strokeWidth={2} />
              </svg>
              {label} {value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default PhaseStatusRings;
