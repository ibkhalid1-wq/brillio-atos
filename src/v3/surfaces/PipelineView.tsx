import React from "react";
import type { ProgramSummary } from "@/new/types";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import { phaseName } from "@/v3/utils";

interface PipelineViewProps {
  program: ProgramSummary | null;
  activePhaseId: string | null;
  onSelectPhase: (phaseId: string) => void;
  onOpenPhase: (phaseId: string) => void;
  onUpdatePhasePct: (phaseId: string, pct: number) => void;
  lockedPhaseIds: Set<string>;
  completionEstimates?: Record<string, { estimate: number }>;
  gateReviews?: Record<string, { readinessScore?: number; status?: string } | null>;
}

function phaseLabel(label: string): string {
  return label.split(" ").slice(0, 3).join(" ");
}

function strokeColor(phase: ProgramSummary["phases"][number], active: boolean): string {
  if (active) return "var(--br-blue)";
  if (phase.pct >= 100 || phase.status === "complete") return "var(--br-green)";
  if (phase.status === "at-risk" || phase.status === "blocked") return "var(--v3-amber)";
  return "var(--v3-border)";
}

function PhaseRing({ pct, color }: { pct: number; color: string }) {
  const normalized = Math.min(100, Math.max(0, pct));
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (normalized / 100) * circumference;

  return (
    <svg className="v3-stage-node-ring" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
      <circle
        cx="16"
        cy="16"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 16 16)"
      />
    </svg>
  );
}

export default function PipelineView({ program, activePhaseId, onSelectPhase, onOpenPhase, onUpdatePhasePct, lockedPhaseIds, completionEstimates = {}, gateReviews }: PipelineViewProps) {
  const phases = program?.phases || [];

  if (!program || !phases.length) {
    return (
      <div className="v3-section">
        <div className="v3-empty-shell">
          <EmptyState
            illustration="gates"
            title="No pipeline available yet"
            description="Add phases to the programme to see the ATOS lifecycle and open phase work areas."
          />
        </div>
      </div>
    );
  }

  // ── Summary stats ─────────────────────────────────────────────────────────
  const avgPct = phases.length > 0
    ? Math.round(phases.reduce((s, p) => s + p.pct, 0) / phases.length)
    : 0;
  const gateReviewMap = gateReviews ?? program.gateReviews ?? {};
  const approvedGates = Object.values(gateReviewMap).filter(
    (g) => g && typeof g === "object" && (g as { status?: string }).status === "approved"
  ).length;
  const activePhase = phases.find((p) => p.id === activePhaseId);
  const atRiskCount = phases.filter((p) => p.status === "at-risk" || p.status === "blocked").length;

  return (
    <div className="v3-section" style={{ padding: 0 }}>
      {/* ── Pipeline header ─────────────────────────────────────────────── */}
      <div style={{
        padding: "20px 24px 16px",
        borderBottom: "1px solid var(--v3-border-soft)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        fontFamily: "var(--v3-font)",
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--v3-text-primary)", letterSpacing: "-0.015em" }}>
            Delivery Pipeline
          </h1>
          <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--v3-text-muted)" }}>
            {activePhase ? `Active phase: ${phaseName(activePhase)}` : "Phase-by-phase delivery lifecycle"}
          </p>
        </div>
        {/* Inline summary row */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { label: "Overall", value: `${avgPct}%`, color: avgPct >= 60 ? "var(--v3-green)" : avgPct >= 30 ? "var(--v3-amber)" : "var(--v3-text-secondary)" },
            { label: "Gates", value: `${approvedGates}/${phases.length}`, color: "var(--v3-text-primary)" },
            ...(atRiskCount > 0 ? [{ label: "At Risk", value: String(atRiskCount), color: "var(--v3-red)" }] : []),
          ].map((s) => (
            <div key={s.label} style={{
              padding: "6px 12px",
              background: "var(--v3-surface-2)",
              border: "1px solid var(--v3-border-soft)",
              borderRadius: "var(--v3-radius)",
              textAlign: "center",
              minWidth: 60,
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "var(--v3-text-muted)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="v3-stage-rail">
        {phases.map((phase) => {
          const active = phase.id === activePhaseId;
          const isLocked = lockedPhaseIds.has(phase.id);
          const color = strokeColor(phase, active);
          return (
            <button
              key={phase.id}
              type="button"
              className={`v3-stage-node ${active ? "active" : ""} ${isLocked ? "is-locked" : ""}`}
              onClick={() => !isLocked && onSelectPhase(phase.id)}
              aria-pressed={active}
              aria-disabled={isLocked}
              title={isLocked ? "Approve the previous phase gate to unlock" : undefined}
              style={{ background: "transparent", border: "none", padding: 0, opacity: isLocked ? 0.45 : 1, cursor: isLocked ? "not-allowed" : "pointer" }}
            >
              <PhaseRing pct={phase.pct} color={color} />
              <span className="v3-stage-node-label">{phaseLabel(phaseName(phase))}</span>
            </button>
          );
        })}
      </div>

      <div className="v3-section">
        {phases.map((phase) => {
          const review = program.gateReviews?.[phase.id] || null;
          const isLocked = lockedPhaseIds.has(phase.id);
          const agentEstimate = completionEstimates[phase.id]?.estimate;
          const statusTone = review
            ? review.status === "approved" || review.status === "ready"
              ? "green"
              : review.status === "remediation-requested"
                ? "red"
                : "amber"
            : phase.pct >= 100
              ? "green"
              : phase.status === "at-risk" || phase.status === "blocked"
                ? "amber"
                : "muted";

          return (
            <div key={phase.id} className="v3-card-sm">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--v3-text-primary)" }}>{phaseName(phase)}</div>
                  <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 4 }}>{phase.objective || "Open the phase work area to review focus and next moves."}</div>
                </div>
                <span className={`v3-chip ${statusTone}`}>{review ? review.status.replace(/-/g, " ") : "gate pending"}</span>
              </div>

              {isLocked ? (() => {
                  const phaseIndex = phases.indexOf(phase);
                  const prevPhase = phaseIndex > 0 ? phases[phaseIndex - 1] : null;
                  const prevReview = prevPhase && gateReviews ? gateReviews[prevPhase.id] : null;
                  const prevLabel = prevPhase ? phaseName(prevPhase) : "the previous phase";
                  const prevScore = prevReview?.readinessScore;
                  return (
                    <div className="v3-locked-banner">
                      <span style={{ fontSize: 12, opacity: 0.6 }}>⊘</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>Locked</div>
                        <div style={{ fontSize: 12, marginTop: 2 }}>
                          Approve the <strong>{prevLabel}</strong> gate to unlock
                          {prevScore != null ? ` (currently ${prevScore}% ready)` : ""}.
                        </div>
                      </div>
                    </div>
                  );
                })() : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                    <input
                      type="range"
                      className="v3-range"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(phase.pct)}
                      onChange={(event) => onUpdatePhasePct(phase.id, Number(event.target.value))}
                      style={{ flex: 1 }}
                      aria-label={`${phaseName(phase)} completion`}
                    />
                    <span style={{ fontSize: 12, color: "var(--v3-text-muted)", fontWeight: 600, minWidth: 32, textAlign: "right" }}>
                      {Math.round(phase.pct)}%
                    </span>
                  </div>
                  {agentEstimate !== undefined && agentEstimate !== Math.round(phase.pct) ? (
                    <button
                      type="button"
                      className="v3-button ghost"
                      style={{ fontSize: 11, paddingLeft: 0, marginTop: 6, color: "var(--v3-text-muted)", textDecoration: "underline" }}
                      onClick={() => onUpdatePhasePct(phase.id, agentEstimate)}
                    >
                      Agent estimates {agentEstimate}% — apply?
                    </button>
                  ) : null}

                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginTop: 12, gap: 12 }}>
                    <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={() => onOpenPhase(phase.id)}>
                      Open work area →
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
