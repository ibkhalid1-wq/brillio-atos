import React, { useMemo, useState } from "react";
import BenefitsTrajectoryWidget from "@/v3/components/BenefitsTrajectoryWidget";
import { PHASE_LABELS, confidenceColor, priorityChipClass } from "@/v3/lib/uiHelpers";
import { ADAM_PHASE_SEQUENCE } from "@/lib/adamMethodology";
import { getProgramState } from "@/new/lib/programState";
import type { DecisionSummary, GateReview, ProgramSummary } from "@/new/types";
import LiteGateModal from "@/v3/components/LiteGateModal";
import PhaseStatusRings from "@/v3/components/PhaseStatusRings";
import { getLockedPhaseIds, computePhaseReadiness } from "@/v3/lib/phaseReadiness";
import { buildArtifactModel, type ArtifactNode } from "@/v3/lib/artifactModel";
import { selectDecisions } from "@/v3/lib/programRaid";

interface ProgrammeHealthViewProps {
  programId: string;
  program: ProgramSummary | null;
  rawData: Record<string, unknown>;
  activePhaseId: string | null;
  /** Pre-processed phases from ProgramSummary — used in preference to raw DB phases to avoid stale pct values */
  processedPhases?: Array<{ id: string; displayName: string; pct: number; status: string }>;
  onSetPhase: (phaseId: string) => void;
  onApproveGate: (phaseId: string) => Promise<boolean | void>;
  onRequestRemediation: (phaseId: string, note: string) => Promise<void>;
  onDecideDecision: (id: string, decision: string) => Promise<void>;
  onDeferDecision: (id: string) => Promise<void>;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  anyAgentRunning: boolean;
  confidenceScore: number | null;
  onNavigateToPhase?: (phaseId: string) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

type RightTab = "gates" | "decisions" | "health" | "benefits";
type DecisionFilter = "open" | "decided" | "all";

const TAB_DESCRIPTIONS: Record<RightTab, string> = {
  gates: "Can each phase close? A phase clears its gate once every required artifact is approved and average quality is above 85%.",
  decisions: "Decisions waiting on you, plus a record of what's already been decided or deferred.",
  health: "Delivery progress phase by phase, and the KPIs tracking how the programme is performing.",
  benefits: "The value this programme is forecast to deliver, measured against its target outcomes.",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function gateStatusChip(status: string): { cls: string; label: string } {
  switch (status) {
    case "approved":
      return { cls: "v3-chip green", label: "Approved" };
    case "remediation-requested":
      return { cls: "v3-chip red", label: "Remediation" };
    case "pending-review":
    case "ready":
      return { cls: "v3-chip amber", label: "In Review" };
    default:
      return { cls: "v3-chip muted", label: "Pending" };
  }
}

// ─── Tab button ──────────────────────────────────────────────────────────────

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px",
        background: active ? "var(--v3-accent)" : "transparent",
        color: active ? "#fff" : "var(--v3-text-secondary)",
        border: "none",
        borderRadius: "var(--v3-radius)",
        cursor: "pointer",
        fontFamily: "var(--v3-font)",
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        transition: "background 0.15s, color 0.15s",
      }}
    >
      {label}
    </button>
  );
}

// ─── SectionLabel ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--v3-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        marginBottom: 10,
        fontFamily: "var(--v3-font)",
      }}
    >
      {children}
    </div>
  );
}

// ─── Gates tab ───────────────────────────────────────────────────────────────

function ArtifactRow({ node, last }: { node: ArtifactNode; last: boolean }) {
  const approved = node.state === "approved";
  const inProgress = node.present && !approved;
  const indicator = approved ? "var(--v3-green)" : inProgress ? "var(--v3-amber)" : "var(--v3-border)";
  const stateLabel = approved
    ? "Approved"
    : node.present
      ? node.state.charAt(0).toUpperCase() + node.state.slice(1)
      : "Not started";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        borderBottom: last ? undefined : "1px solid var(--v3-border-soft)",
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: 16,
          height: 16,
          borderRadius: 4,
          border: `2px solid ${indicator}`,
          background: approved ? "var(--v3-green)" : "transparent",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        aria-label={stateLabel}
      >
        {approved && (
          <svg width={9} height={7} viewBox="0 0 9 7" fill="none" aria-hidden="true">
            <path d="M1 3.5L3.5 6L8 1" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          color: "var(--v3-text-primary)",
          fontFamily: "var(--v3-font)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {node.label}
      </span>
      <span
        style={{
          flexShrink: 0,
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "var(--v3-font)",
          color: approved ? "var(--v3-green)" : inProgress ? "var(--v3-amber)" : "var(--v3-text-muted)",
        }}
      >
        {node.quality != null ? `${stateLabel} · ${node.quality}%` : stateLabel}
      </span>
    </div>
  );
}

function GateMetric({
  label,
  value,
  met,
  suffix,
}: {
  label: string;
  value: number;
  met: boolean;
  suffix: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: "var(--v3-font)" }}>
        <span style={{ fontSize: 12, color: "var(--v3-text-secondary)" }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: met ? "var(--v3-green)" : "var(--v3-text-primary)" }}>
          {value}% <span style={{ fontWeight: 400, color: "var(--v3-text-muted)" }}>· {suffix}</span>
        </span>
      </div>
      <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--v3-border-soft)", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: met ? "var(--v3-green)" : "var(--v3-amber)", borderRadius: 3 }} />
      </div>
    </div>
  );
}

function GatesTab({
  activePhaseId,
  gateReviews,
  program,
  onApproveGate,
  onRequestRemediation,
  onRunAgent,
  anyAgentRunning,
}: {
  activePhaseId: string | null;
  gateReviews: Record<string, GateReview>;
  program: ProgramSummary | null;
  onApproveGate: (phaseId: string) => Promise<boolean | void>;
  onRequestRemediation: (phaseId: string, note: string) => Promise<void>;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  anyAgentRunning: boolean;
}) {
  const [approving, setApproving] = useState(false);
  const [remediationNote, setRemediationNote] = useState("");
  const [showRemediationInput, setShowRemediationInput] = useState(false);
  const [submittingRemediation, setSubmittingRemediation] = useState(false);
  const [liteGateOpen, setLiteGateOpen] = useState(false);

  const phaseId = activePhaseId;
  const gate: GateReview | null = phaseId ? (gateReviews[phaseId] ?? null) : null;
  const phaseLabel = phaseId ? (PHASE_LABELS[phaseId] ?? phaseId) : "—";
  // Gate readiness reflects the single close rule: every required artifact
  // approved (100%) and average artifact quality above 85%. Exit criteria,
  // assumptions and dependency checks are informational and live elsewhere.
  const readiness = program && phaseId ? computePhaseReadiness(program, phaseId) : null;
  const requiredArtifacts = useMemo<ArtifactNode[]>(() => {
    if (!program || !phaseId) return [];
    const summary = buildArtifactModel(program).phases.find((p) => p.phaseId === phaseId);
    return summary ? summary.artifacts.filter((a) => a.required) : [];
  }, [program, phaseId]);
  const approvedArtifacts = requiredArtifacts.filter((a) => a.state === "approved").length;
  const allArtifactsApproved = requiredArtifacts.length > 0 && approvedArtifacts === requiredArtifacts.length;

  async function handleApprove() {
    if (!phaseId) return;
    setApproving(true);
    try {
      await onApproveGate(phaseId);
    } finally {
      setApproving(false);
    }
  }

  async function handleRemediation() {
    if (!phaseId || !remediationNote.trim()) return;
    setSubmittingRemediation(true);
    try {
      await onRequestRemediation(phaseId, remediationNote.trim());
      setRemediationNote("");
      setShowRemediationInput(false);
    } finally {
      setSubmittingRemediation(false);
    }
  }

  if (!phaseId) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "var(--v3-text-muted)", fontFamily: "var(--v3-font)" }}>
        Select a phase from the left panel to view gate details.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: 24 }}>
      {/* Readiness — gauge, projected score, and blockers ranked by expected gain.
          Surfaces WHY the gate is where it is and WHICH action gains the most,
          right at the approval decision point. */}
      <div>
        <SectionLabel>Gate Readiness — {phaseLabel}</SectionLabel>
        <div
          style={{
            background: "var(--v3-surface)",
            border: "1px solid var(--v3-border-soft)",
            borderRadius: "var(--v3-radius)",
            padding: "20px 24px",
          }}
        >
          {readiness ? (
            <>
              <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", fontFamily: "var(--v3-font)", marginBottom: 18, lineHeight: 1.5 }}>
                This phase can close once <strong style={{ color: "var(--v3-text-primary)" }}>every required artifact is approved</strong> and <strong style={{ color: "var(--v3-text-primary)" }}>average artifact quality is above 85%</strong>.
              </div>

              {/* Required artifacts checklist — the first close requirement */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, fontFamily: "var(--v3-font)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Required artifacts
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: allArtifactsApproved ? "var(--v3-green)" : "var(--v3-text-primary)" }}>
                    {approvedArtifacts} / {requiredArtifacts.length} approved
                  </span>
                </div>
                {requiredArtifacts.length ? (
                  <div style={{ border: "1px solid var(--v3-border-soft)", borderRadius: "var(--v3-radius)", overflow: "hidden" }}>
                    {requiredArtifacts.map((node, i) => (
                      <ArtifactRow key={node.key} node={node} last={i === requiredArtifacts.length - 1} />
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--v3-text-muted)", fontFamily: "var(--v3-font)" }}>
                    No required artifacts defined for this phase.
                  </div>
                )}
              </div>

              {/* Average artifact quality — the second close requirement */}
              <GateMetric
                label="Average artifact quality"
                value={readiness.artifactScore}
                met={readiness.artifactScore > 85}
                suffix="need >85%"
              />

              <div
                style={{
                  marginTop: 16,
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: "var(--v3-font)",
                  color: readiness.canApproveGate ? "var(--v3-green)" : "var(--v3-amber)",
                }}
              >
                {readiness.canApproveGate
                  ? "✓ Ready to close — both requirements met."
                  : "Not ready to close — complete the items above."}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--v3-text-muted)", fontFamily: "var(--v3-font)" }}>
              No readiness data for this phase yet.
            </div>
          )}
          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid var(--v3-border-soft)",
              fontSize: 12,
              color: "var(--v3-text-muted)",
              fontFamily: "var(--v3-font)",
            }}
          >
            <strong style={{ color: "var(--v3-text-secondary)" }}>Gate review:</strong>{" "}
            {gate ? gate.recommendation : "No gate check run yet — use “Check Gate Readiness” to generate an assessment."}
          </div>
        </div>
      </div>

      {/* Remediation note */}
      {gate?.remediationNote && (
        <div
          style={{
            padding: "12px 16px",
            background: "var(--v3-surface)",
            border: "1px solid var(--v3-red)",
            borderRadius: "var(--v3-radius)",
            fontSize: 13,
            color: "var(--v3-text-secondary)",
            fontFamily: "var(--v3-font)",
          }}
        >
          <strong style={{ color: "var(--v3-red)", marginRight: 8 }}>Remediation note:</strong>
          {gate.remediationNote}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="v3-button ghost"
          onClick={() => setLiteGateOpen(true)}
        >
          ✓ Quick Gate Check
        </button>

        {gate?.status !== "approved" && (
          <button
            type="button"
            className="v3-button primary"
            disabled={approving}
            onClick={handleApprove}
          >
            ✓ {approving ? "Approving…" : "Approve & Unlock Next Phase"}
          </button>
        )}

        {gate?.status !== "approved" && (
          <button
            type="button"
            className="v3-button ghost"
            onClick={() => setShowRemediationInput(!showRemediationInput)}
          >
            Request Remediation
          </button>
        )}
      </div>

      {showRemediationInput && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            value={remediationNote}
            onChange={(e) => setRemediationNote(e.target.value)}
            placeholder="Describe what needs to be remediated before this gate can be approved…"
            rows={3}
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "var(--v3-surface)",
              border: "1px solid var(--v3-border)",
              borderRadius: "var(--v3-radius)",
              fontFamily: "var(--v3-font)",
              fontSize: 13,
              color: "var(--v3-text-primary)",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="v3-button danger"
              disabled={!remediationNote.trim() || submittingRemediation}
              onClick={handleRemediation}
            >
              {submittingRemediation ? "Submitting…" : "Submit Remediation Request"}
            </button>
            <button
              type="button"
              className="v3-button ghost"
              onClick={() => { setShowRemediationInput(false); setRemediationNote(""); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <LiteGateModal
        open={liteGateOpen}
        phaseId={phaseId ?? ""}
        phaseLabel={phaseLabel}
        onClose={() => setLiteGateOpen(false)}
        onComplete={() => {
          // Lite gate is a deterministic sense-check only. The formal gate
          // approval lives inline on this same Gates tab — no agent to invoke.
          setLiteGateOpen(false);
        }}
      />
    </div>
  );
}

// ─── Decisions tab ───────────────────────────────────────────────────────────

function DecisionsTab({
  decisionQueue,
  onDecideDecision,
  onDeferDecision,
}: {
  decisionQueue: DecisionSummary[];
  onDecideDecision: (id: string, decision: string) => Promise<void>;
  onDeferDecision: (id: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<DecisionFilter>("open");
  const [deciding, setDeciding] = useState<string | null>(null);
  const [deferring, setDeferring] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...decisionQueue].sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9),
      ),
    [decisionQueue],
  );

  const filtered = useMemo(() => {
    switch (filter) {
      case "open": return sorted.filter((d) => d.status === "open");
      case "decided": return sorted.filter((d) => d.status !== "open");
      default: return sorted;
    }
  }, [sorted, filter]);

  const openCount = sorted.filter((d) => d.status === "open").length;
  const decidedCount = sorted.filter((d) => d.status !== "open").length;

  async function handleDecide(id: string) {
    setDeciding(id);
    try {
      await onDecideDecision(id, "approved");
    } finally {
      setDeciding(null);
    }
  }

  async function handleDefer(id: string) {
    setDeferring(id);
    try {
      await onDeferDecision(id);
    } finally {
      setDeferring(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%" }}>
      {/* Filter chips */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "16px 24px 12px",
          borderBottom: "1px solid var(--v3-border-soft)",
          background: "var(--v3-surface-2)",
        }}
      >
        {(["open", "decided", "all"] as DecisionFilter[]).map((f) => {
          const count = f === "open" ? openCount : f === "decided" ? decidedCount : sorted.length;
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "5px 12px",
                background: active ? "var(--v3-accent)" : "transparent",
                color: active ? "#fff" : "var(--v3-text-secondary)",
                border: active ? "none" : "1px solid var(--v3-border-soft)",
                borderRadius: 99,
                cursor: "pointer",
                fontFamily: "var(--v3-font)",
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                textTransform: "capitalize",
              }}
            >
              {f} ({count})
            </button>
          );
        })}
      </div>

      {/* Decision list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.length === 0 ? (
          <div
            style={{
              padding: "32px 0",
              textAlign: "center",
              fontSize: 13,
              color: "var(--v3-text-muted)",
              fontFamily: "var(--v3-font)",
              fontStyle: "italic",
            }}
          >
            {filter === "open"
              ? "No open decisions. Great work!"
              : filter === "decided"
              ? "No decided decisions yet."
              : "No decisions recorded."}
          </div>
        ) : (
          filtered.map((d) => {
            const phaseLabel = PHASE_LABELS[d.phaseId] ?? d.phaseId;
            const isOpen = d.status === "open";
            return (
              <div
                key={d.id}
                style={{
                  padding: "14px 16px",
                  background: "var(--v3-surface)",
                  border: "1px solid var(--v3-border-soft)",
                  borderRadius: "var(--v3-radius)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--v3-text-primary)",
                      marginBottom: 6,
                      fontFamily: "var(--v3-font)",
                    }}
                  >
                    {d.title || d.question}
                  </div>
                  {d.question && d.title && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--v3-text-secondary)",
                        marginBottom: 6,
                        fontFamily: "var(--v3-font)",
                        lineHeight: 1.5,
                      }}
                    >
                      {d.question}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className={priorityChipClass(d.priority)} style={{ fontSize: 11 }}>
                      {d.priority}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--v3-text-muted)", fontFamily: "var(--v3-font)" }}>
                      {phaseLabel}
                    </span>
                    {d.status && !isOpen && (
                      <span className="v3-chip green" style={{ fontSize: 11 }}>
                        {d.status}
                      </span>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="v3-button primary"
                      disabled={deciding === d.id}
                      onClick={() => handleDecide(d.id)}
                    >
                      {deciding === d.id ? "Approving…" : "Approve"}
                    </button>
                    <button
                      type="button"
                      className="v3-button ghost"
                      disabled={deferring === d.id}
                      onClick={() => handleDefer(d.id)}
                    >
                      {deferring === d.id ? "Deferring…" : "Defer"}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Health tab ───────────────────────────────────────────────────────────────

function HealthTab({
  program,
  phases,
  rawData,
  onRunAgent,
  anyAgentRunning,
}: {
  program: ProgramSummary | null;
  phases: Array<{ id: string; displayName: string; pct: number; status: string }>;
  rawData: Record<string, unknown>;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  anyAgentRunning: boolean;
}) {
  const kpis = useMemo(() => {
    const raw = rawData.kpis;
    if (!Array.isArray(raw)) return [];
    return raw as Array<{ name: string; value: unknown; target: unknown; trend?: string }>;
  }, [rawData]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: 24, overflowY: "auto" }}>
      {/* Phase completion bars */}
      <div>
        <SectionLabel>Phase Completion</SectionLabel>
        <div
          style={{
            background: "var(--v3-surface)",
            border: "1px solid var(--v3-border-soft)",
            borderRadius: "var(--v3-radius)",
            padding: "8px 16px",
          }}
        >
          {phases.map((phase) => {
            const barColor =
              phase.pct >= 80
                ? "var(--v3-green)"
                : phase.pct > 0
                ? "var(--v3-accent)"
                : "var(--v3-border)";
            return (
              <div
                key={phase.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--v3-border-soft)",
                }}
              >
                {program && <PhaseStatusRings program={program} phaseId={phase.id} size={32} />}
                <div
                  style={{
                    width: 100,
                    flexShrink: 0,
                    fontSize: 12,
                    color: "var(--v3-text-secondary)",
                    fontFamily: "var(--v3-font)",
                    fontWeight: 500,
                  }}
                >
                  {PHASE_LABELS[phase.id] ?? phase.displayName}
                </div>
                <div
                  style={{
                    flex: 1,
                    height: 6,
                    background: "var(--v3-surface-3)",
                    borderRadius: 99,
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: "0 auto 0 0",
                      width: `${Math.min(phase.pct, 100)}%`,
                      background: barColor,
                      borderRadius: 99,
                    }}
                  />
                </div>
                <div
                  style={{
                    width: 36,
                    textAlign: "right",
                    fontSize: 12,
                    color: "var(--v3-text-muted)",
                    fontFamily: "var(--v3-font)",
                    fontWeight: 600,
                  }}
                >
                  {phase.pct}%
                </div>
              </div>
            );
          })}
          {phases.length === 0 && (
            <div style={{ padding: "16px 0", fontSize: 13, color: "var(--v3-text-muted)", fontFamily: "var(--v3-font)" }}>
              No phase data available.
            </div>
          )}
        </div>
      </div>

      {/* KPI table */}
      {kpis.length > 0 && (
        <div>
          <SectionLabel>KPIs</SectionLabel>
          <div
            style={{
              background: "var(--v3-surface)",
              border: "1px solid var(--v3-border-soft)",
              borderRadius: "var(--v3-radius)",
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--v3-surface-2)", borderBottom: "1px solid var(--v3-border-soft)" }}>
                  {["Name", "Value", "Target", "Trend"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "8px 14px",
                        textAlign: "left",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--v3-text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        fontFamily: "var(--v3-font)",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kpis.map((kpi, i) => (
                  <tr
                    key={i}
                    style={{ borderBottom: i < kpis.length - 1 ? "1px solid var(--v3-border-soft)" : undefined }}
                  >
                    <td style={{ padding: "10px 14px", fontSize: 13, color: "var(--v3-text-primary)", fontFamily: "var(--v3-font)" }}>
                      {kpi.name}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)", fontFamily: "var(--v3-font)" }}>
                      {String(kpi.value ?? "—")}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: "var(--v3-text-muted)", fontFamily: "var(--v3-font)" }}>
                      {String(kpi.target ?? "—")}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 16 }}>
                      {kpi.trend === "improving" ? "↑" : kpi.trend === "declining" ? "↓" : "→"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Run health check */}
      <div>
        <button
          type="button"
          className="v3-button ghost"
          disabled={anyAgentRunning}
          onClick={() => onRunAgent("health-heatmap", "program")}
        >
          🔬 {anyAgentRunning ? "Preparing…" : "Assess Programme Health"}
        </button>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function ProgrammeHealthView({
  programId: _programId,
  program,
  rawData,
  activePhaseId,
  processedPhases,
  onSetPhase,
  onApproveGate,
  onRequestRemediation,
  onDecideDecision,
  onDeferDecision,
  onRunAgent,
  anyAgentRunning,
  confidenceScore,
  onNavigateToPhase,
}: ProgrammeHealthViewProps) {
  const [rightTab, setRightTab] = useState<RightTab>("gates");

  const { inner } = useMemo(() => getProgramState(rawData), [rawData]);

  const gateReviews = useMemo<Record<string, GateReview>>(() => {
    const gr = inner.gateReviews;
    return typeof gr === "object" && gr !== null && !Array.isArray(gr)
      ? (gr as Record<string, GateReview>)
      : {};
  }, [inner]);

  // Same strict sequential lock set the Today phase strip uses, so a phase that
  // can't be entered there can't be entered from the Gate Timeline either.
  const lockedPhaseIds = useMemo(
    () => (program ? getLockedPhaseIds(program) : new Set<string>()),
    [program],
  );

  // Decisions shown here must agree with the Action Center / rail counts. The
  // canonical open set (selectDecisions) includes synthesised agent actions that
  // the raw persisted decisionQueue lacks, so use it for the "open" rows and add
  // only the persisted *decided* rows so the "Decided" filter still has history.
  const decisionQueue = useMemo<DecisionSummary[]>(() => {
    const open = selectDecisions(program);
    const persisted = Array.isArray(inner.decisionQueue) ? (inner.decisionQueue as DecisionSummary[]) : [];
    const decided = persisted.filter((d) => d.status && d.status !== "open");
    return [...open, ...decided];
  }, [program, inner]);

  // Prefer pre-processed phases (already sanitised by derivePhases) over raw DB data
  // to avoid showing stale 100% values on new programs.
  const phases = useMemo(() => {
    if (processedPhases && processedPhases.length > 0) return processedPhases;
    return Array.isArray(inner.phases)
      ? (inner.phases as Array<{ id: string; displayName: string; pct: number; status: string }>)
      : [];
  }, [processedPhases, inner]);

  // Gates approved progress
  const approvedCount = ADAM_PHASE_SEQUENCE.filter(
    (id) => gateReviews[id]?.status === "approved",
  ).length;

  const scoreColor = confidenceScore !== null ? confidenceColor(confidenceScore) : "var(--v3-text-muted)";

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        fontFamily: "var(--v3-font)",
      }}
    >
      {/* ── Left panel (280px) ─────────────────────────────────────────────── */}
      <div
        style={{
          width: 280,
          flexShrink: 0,
          borderRight: "1px solid var(--v3-border-soft)",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          background: "var(--v3-surface-2)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 18px 16px",
            borderBottom: "1px solid var(--v3-border-soft)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--v3-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom: 10,
            }}
          >
            Programme Health
          </div>

          {/* Confidence score */}
          {confidenceScore !== null && (
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 800,
                  color: scoreColor,
                  lineHeight: 1,
                  letterSpacing: "-0.02em",
                }}
              >
                {confidenceScore}%
              </div>
              <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 3, fontWeight: 500 }}>
                Overall Confidence
              </div>
            </div>
          )}

          <div
            style={{
              fontSize: 12,
              color: "var(--v3-text-secondary)",
              lineHeight: 1.5,
            }}
          >
            Unified view of gates, decisions, and programme health.
          </div>
        </div>

        {/* Gate timeline */}
        <div style={{ padding: "14px 18px 8px" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--v3-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom: 10,
            }}
          >
            Gate Timeline
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {ADAM_PHASE_SEQUENCE.map((phaseId) => {
              const gate = gateReviews[phaseId];
              const status = gate?.status ?? "pending";
              const { cls, label } = gateStatusChip(status);
              const isActive = phaseId === activePhaseId;
              const locked = lockedPhaseIds.has(phaseId);
              // Use the same readiness model the gate panel shows, so the timeline
              // subtext can never contradict the detail view (e.g. "85% ready"
              // here while the panel says artifacts are 0% complete).
              const phaseReadiness = !locked && program ? computePhaseReadiness(program, phaseId) : null;

              return (
                <button
                  key={phaseId}
                  disabled={locked}
                  aria-disabled={locked}
                  title={locked ? "Locked — clear the previous phase gate to unlock this phase" : undefined}
                  onClick={locked ? undefined : () => {
                    onSetPhase(phaseId);
                    onNavigateToPhase?.(phaseId);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "8px 10px",
                    background: isActive ? "var(--v3-accent-soft)" : "transparent",
                    border: isActive ? "1px solid var(--v3-accent)" : "1px solid transparent",
                    borderRadius: "var(--v3-radius)",
                    cursor: locked ? "not-allowed" : "pointer",
                    opacity: locked ? 0.45 : 1,
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? "var(--v3-accent)" : "var(--v3-text-secondary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {PHASE_LABELS[phaseId] ?? phaseId}
                    </div>
                    {locked ? (
                      <div style={{ fontSize: 10, color: "var(--v3-text-muted)", marginTop: 1 }}>
                        🔒 Locked
                      </div>
                    ) : phaseReadiness && (
                      <div
                        style={{
                          fontSize: 10,
                          marginTop: 1,
                          color: phaseReadiness.canApproveGate ? "var(--v3-green)" : "var(--v3-text-muted)",
                        }}
                      >
                        {phaseReadiness.canApproveGate ? "✓ Ready to close" : `${phaseReadiness.score}% ready`}
                      </div>
                    )}
                  </div>
                  <span className={cls} style={{ fontSize: 10, flexShrink: 0 }}>
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Gates progress bar */}
        <div style={{ padding: "12px 18px 8px", borderTop: "1px solid var(--v3-border-soft)", marginTop: 8 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              color: "var(--v3-text-muted)",
              marginBottom: 6,
            }}
          >
            <span>Gates approved</span>
            <span style={{ fontWeight: 600 }}>
              {approvedCount} / {ADAM_PHASE_SEQUENCE.length}
            </span>
          </div>
          <div
            style={{
              height: 5,
              background: "var(--v3-surface-3)",
              borderRadius: 99,
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: "0 auto 0 0",
                width: `${(approvedCount / ADAM_PHASE_SEQUENCE.length) * 100}%`,
                background: "var(--v3-green)",
                borderRadius: 99,
                transition: "width 0.4s ease",
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Right panel ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Contextual breadcrumb header */}
        <div style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--v3-border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
          background: "var(--v3-surface)",
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>
            Programme Health
          </span>
          {activePhaseId && (
            <span style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>
              — {PHASE_LABELS[activePhaseId] ?? activePhaseId} selected
            </span>
          )}
          {confidenceScore !== null && (
            <span style={{
              marginLeft: "auto",
              fontSize: 12, fontWeight: 600,
              // Canonical band (same as the main gauge above) so this header
              // "% confidence" never contradicts it — 76% reads green, not amber.
              color: confidenceColor(confidenceScore),
            }}>
              {confidenceScore}% confidence
            </span>
          )}
        </div>
        {/* Tab bar */}
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "12px 20px",
            borderBottom: "1px solid var(--v3-border-soft)",
            background: "var(--v3-surface-2)",
          }}
        >
          {(["gates", "decisions", "health", "benefits"] as RightTab[]).map((tab) => (
            <TabButton
              key={tab}
              label={tab.charAt(0).toUpperCase() + tab.slice(1)}
              active={rightTab === tab}
              onClick={() => setRightTab(tab)}
            />
          ))}
        </div>

        {/* Active-tab description — orients the PM on what this view answers */}
        <div
          style={{
            padding: "9px 20px",
            fontSize: 12,
            color: "var(--v3-text-muted)",
            lineHeight: 1.45,
            borderBottom: "1px solid var(--v3-border-soft)",
            background: "var(--v3-surface-2)",
            fontFamily: "var(--v3-font)",
          }}
        >
          {TAB_DESCRIPTIONS[rightTab]}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--v3-surface)" }}>
          {rightTab === "gates" && (
            <GatesTab
              activePhaseId={activePhaseId}
              gateReviews={gateReviews}
              program={program}
              onApproveGate={onApproveGate}
              onRequestRemediation={onRequestRemediation}
              onRunAgent={onRunAgent}
              anyAgentRunning={anyAgentRunning}
            />
          )}
          {rightTab === "decisions" && (
            <DecisionsTab
              decisionQueue={decisionQueue}
              onDecideDecision={onDecideDecision}
              onDeferDecision={onDeferDecision}
            />
          )}
          {rightTab === "health" && (
            <HealthTab
              program={program}
              phases={phases}
              rawData={inner}
              onRunAgent={onRunAgent}
              anyAgentRunning={anyAgentRunning}
            />
          )}
          {rightTab === "benefits" && (
            <div style={{ padding: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 16 }}>
                Benefits Realisation
              </div>

              {/* AI Benefit Forecast */}
              {(() => {
                const rawInner = rawData && typeof (rawData as Record<string,unknown>).data === "object"
                  ? (rawData as Record<string,unknown>).data as Record<string,unknown>
                  : rawData as Record<string,unknown> | undefined;
                const benefitForecast = rawInner?.benefitForecast as Parameters<typeof BenefitsTrajectoryWidget>[0]["benefitForecast"];
                return (
                  <div style={{ marginBottom: 20 }}>
                    <BenefitsTrajectoryWidget
                      benefitForecast={benefitForecast ?? null}
                      onRunAgent={() => onRunAgent("benefits-tracker", "program")}
                      isRunning={anyAgentRunning}
                    />
                  </div>
                );
              })()}

              {/* KPI comparison */}
              {(() => {
                const kpis = Array.isArray((inner as any).kpis) ? (inner as any).kpis as any[] : [];
                return kpis.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                    {kpis.map((kpi: any, i: number) => {
                      const hasCurrent = typeof kpi.value === "number";
                      const hasTarget = typeof kpi.target === "number" && kpi.target > 0;
                      const current = hasCurrent ? kpi.value : 0;
                      const unit = typeof kpi.unit === "string" ? kpi.unit : "";
                      // Only compute attainment when both current and a real target
                      // exist — never fabricate a denominator or percentage.
                      const pct = hasCurrent && hasTarget ? Math.round((current / kpi.target) * 100) : null;
                      const achieved = pct !== null && pct >= 100;
                      return (
                        <div key={kpi.id ?? i} style={{ background: "var(--v3-surface)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius-lg)", padding: "12px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>{kpi.name ?? kpi.label ?? `KPI ${i + 1}`}</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: achieved ? "var(--v3-green)" : pct !== null && pct >= 70 ? "var(--v3-accent)" : pct !== null ? "var(--v3-amber)" : "var(--v3-text-muted)" }}>
                              {hasCurrent ? `${current}${unit}` : "—"}{hasTarget ? ` / ${kpi.target}${unit}` : ""}
                            </span>
                          </div>
                          {pct !== null ? (
                            <>
                              <div style={{ height: 6, background: "var(--v3-surface-3)", borderRadius: 999, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: achieved ? "var(--v3-green)" : "var(--v3-accent)", borderRadius: 999, transition: "width 0.4s" }} />
                              </div>
                              <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 4 }}>{pct}% of target achieved</div>
                            </>
                          ) : (
                            <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 4 }}>
                              {hasTarget ? "Current value not yet measured" : "Target not set — define one in programme setup to track attainment"}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius-lg)", padding: "20px", textAlign: "center", marginBottom: 20 }}>
                    <div style={{ fontSize: 24, marginBottom: 10 }}>◆</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--v3-text-primary)", marginBottom: 6 }}>No KPIs configured</div>
                    <div style={{ fontSize: 12, color: "var(--v3-text-muted)", lineHeight: 1.5 }}>
                      Define success metrics in programme setup to start measuring benefits realisation.
                    </div>
                  </div>
                );
              })()}

              {/* Value hypothesis from Strategy phase */}
              {(() => {
                const strategy = (inner as any)?.strategy ?? {};
                const hypothesis = typeof strategy.valueHypothesis === "string" ? strategy.valueHypothesis :
                  typeof (inner as any).objective === "string" ? (inner as any).objective : null;
                return hypothesis ? (
                  <div style={{ background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius-lg)", padding: "14px 16px", marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Value Hypothesis</div>
                    <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.6 }}>{hypothesis}</div>
                  </div>
                ) : null;
              })()}

              {/* Run agent button */}
              <button
                type="button"
                className="v3-button primary"
                onClick={() => onRunAgent("benefits-tracker", "program")}
                disabled={anyAgentRunning}
              >
                {anyAgentRunning ? "Preparing…" : "Track Benefits Realisation"}
              </button>
              {activePhaseId && (
                <button
                  onClick={() => onNavigateToPhase?.(activePhaseId)}
                  style={{
                    background: "none", border: "none", padding: "4px 0",
                    cursor: "pointer", fontSize: 12, color: "var(--v3-accent)",
                    fontWeight: 500, fontFamily: "var(--v3-font)",
                  }}
                >
                  View in Active Phase →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
