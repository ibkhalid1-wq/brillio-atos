import React, { useMemo, useState } from "react";
import { NumberCountUp } from "@/v3/components/ui/NumberCountUp";
import { GateTimeline, type GateEntry } from "@/v3/components/GateTimeline";
import { DecisionCard } from "@/v3/components/DecisionCard";
import { GateApprovalModal } from "@/v3/components/GateApprovalModal";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import { getProgramState } from "@/new/lib/programState";
import { ADAM_PHASE_SEQUENCE } from "@/lib/adamMethodology";

interface GovernanceViewProps {
  programId: string;
  rawData: Record<string, unknown>;
  activePhaseId: string | null;
  onSetPhase: (phaseId: string) => void;
  onApproveGate: (phaseId: string) => Promise<void>;
  onRequestRemediation: (phaseId: string, note: string) => Promise<void>;
  onDecideDecision: (id: string, decision: string) => Promise<void>;
  onDeferDecision: (id: string) => Promise<void>;
  onRunAgent?: (agentId: string, phaseId?: string) => void;
}

const PHASE_LABELS: Record<string, string> = {
  strategy: "Strategy", mobilise: "Mobilise", discover: "Discover",
  design: "Design", build: "Build", operate: "Operate",
  govern: "Govern", optimize: "Optimize", valuerealize: "Value Capture",
};

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

type DecisionFilter = "open" | "decided" | "all";
type RightTab = "decisions" | "audit";

export default function GovernanceView({
  programId, rawData, activePhaseId, onSetPhase, onApproveGate,
  onRequestRemediation, onDecideDecision, onDeferDecision, onRunAgent,
}: GovernanceViewProps) {
  const [rightTab, setRightTab] = useState<RightTab>("decisions");
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("open");
  const [approvalModalPhase, setApprovalModalPhase] = useState<string | null>(null);

  const { inner } = useMemo(() => getProgramState(rawData), [rawData]);

  const gateReviews = useMemo(() => {
    const gr = inner.gateReviews;
    return (typeof gr === "object" && gr !== null && !Array.isArray(gr))
      ? gr as Record<string, any>
      : {};
  }, [inner]);

  const decisionQueue = useMemo(() => {
    return Array.isArray(inner.decisionQueue) ? inner.decisionQueue as any[] : [];
  }, [inner]);

  const gates: GateEntry[] = useMemo(() =>
    ADAM_PHASE_SEQUENCE.map((phaseId) => {
      const review = gateReviews[phaseId];
      return {
        phaseId,
        phaseLabel: PHASE_LABELS[phaseId] ?? phaseId,
        status: review?.status === "approved" ? "approved"
          : review?.status === "remediation-requested" ? "remediation-requested"
          : review ? "in-review" : "pending",
        readinessScore: review?.readinessScore ?? undefined,
        approvedAt: review?.approvedAt ?? null,
        approvedBy: review?.approvedBy ?? null,
        remediationNote: review?.remediationNote ?? null,
        isCurrent: phaseId === activePhaseId,
      };
    }),
  [gateReviews, activePhaseId]);

  // Decision counts for filter chip badges
  const openCount = decisionQueue.filter((d: any) => d.status === "open").length;
  const decidedCount = decisionQueue.filter((d: any) => d.status !== "open").length;
  const allCount = decisionQueue.length;

  const filterLabels: Record<DecisionFilter, string> = {
    open: `Open (${openCount})`,
    decided: `Decided (${decidedCount})`,
    all: `All (${allCount})`,
  };

  const filteredDecisions = useMemo(() =>
    decisionQueue.filter((d: any) =>
      decisionFilter === "all" ? true : decisionFilter === "open" ? d.status === "open" : d.status !== "open"
    ),
  [decisionQueue, decisionFilter]);

  // Sorted by priority: critical → high → medium → low → undefined
  const sortedDecisions = useMemo(() =>
    [...filteredDecisions].sort((a: any, b: any) =>
      (PRIORITY_ORDER[a.priority as keyof typeof PRIORITY_ORDER] ?? 4) -
      (PRIORITY_ORDER[b.priority as keyof typeof PRIORITY_ORDER] ?? 4)
    ),
  [filteredDecisions]);

  const activeReview = activePhaseId ? gateReviews[activePhaseId] : null;
  const approvalModalReview = approvalModalPhase ? gateReviews[approvalModalPhase] : null;

  const handleDismissDecision = async (id: string) => {
    // defer as dismiss
    await onDeferDecision(id);
  };

  // Empty state per filter
  const emptyStateProps: Record<DecisionFilter, { icon: string; title: string; description: string }> = {
    open: {
      icon: "✓",
      title: "No open decisions",
      description: "All decisions are resolved — programme is making progress.",
    },
    decided: {
      icon: "○",
      title: "No decided items yet",
      description: "Resolved decisions will appear here for audit.",
    },
    all: {
      icon: "✦",
      title: "No decisions recorded",
      description: "Decisions will be added automatically as agents run.",
    },
  };

  const approvedGateCount = gates.filter(g => g.status === "approved").length;
  const approvedGatePct = gates.length > 0 ? (approvedGateCount / gates.length) * 100 : 0;

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden", height: "100%", flexDirection: "column" }}>
      {/* Soft migration notice */}
      <div style={{
        padding: "8px 16px",
        background: "var(--v3-accent-soft)",
        borderBottom: "1px solid var(--v3-accent-glow)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 12,
        color: "var(--v3-accent)",
        flexShrink: 0,
      }}>
        <span>✦ This view has been upgraded — <strong>Programme Health</strong> now combines gates, decisions, and health in one unified view.</span>
      </div>
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Left — Gate Timeline */}
      <div style={{
        width: 280, flexShrink: 0, borderRight: "1px solid var(--v3-border)",
        background: "var(--v3-surface)", overflowY: "auto", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "12px 16px 0", fontSize: 11, color: "var(--v3-text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>
          Gates & Decisions
        </div>
        <div style={{ padding: "8px 16px 14px", borderBottom: "1px solid var(--v3-border)", flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>Stage Checkpoints</div>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>
            Each stage must pass a gate before proceeding
          </div>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 4 }}>
            {approvedGateCount} of {gates.length} approved
          </div>
          {/* Approval progress bar */}
          <div style={{ height: 3, background: "var(--v3-surface-2)", borderRadius: 2, marginTop: 6, width: "100%" }}>
            <div style={{
              height: "100%",
              width: `${approvedGatePct}%`,
              background: "var(--v3-green)",
              borderRadius: 2,
              transition: "width 0.4s",
            }} />
          </div>
        </div>
        <div style={{ padding: "0 12px", flex: 1 }}>
          <GateTimeline gates={gates} onSelectGate={onSetPhase} activePhaseId={activePhaseId} />
        </div>
      </div>

      {/* Right — Decisions / Audit */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Right header */}
        <div style={{
          borderBottom: "1px solid var(--v3-border)", background: "var(--v3-surface)",
          padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {activePhaseId ? (
              <>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>
                  {PHASE_LABELS[activePhaseId] ?? activePhaseId}
                </span>
                {activeReview?.readinessScore != null && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                    background: "var(--v3-accent-soft)", color: "var(--v3-accent)",
                  }}>
                    <NumberCountUp value={activeReview.readinessScore} duration={500} suffix="% ready" style={{ fontSize: 11, fontWeight: 600 }} />
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontSize: 13, color: "var(--v3-text-muted)" }}>
                Select a gate to review — {openCount} open decision{openCount !== 1 ? "s" : ""} across all stages
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {activePhaseId && activeReview?.status !== "approved" && (
              <>
                {onRunAgent && (
                  <button onClick={() => onRunAgent("gate-review", activePhaseId)} style={{
                    background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)",
                    borderRadius: "var(--v3-radius)", padding: "5px 12px", fontSize: 12,
                    color: "var(--v3-text-secondary)", cursor: "pointer", fontFamily: "var(--v3-font)",
                  }}>Run AI Gate Check</button>
                )}
                <button onClick={() => setApprovalModalPhase(activePhaseId)} style={{
                  background: "var(--v3-accent)", border: "none", borderRadius: "var(--v3-radius)",
                  padding: "5px 12px", fontSize: 12, color: "#fff", cursor: "pointer", fontFamily: "var(--v3-font)", fontWeight: 500,
                }}>Approve Gate</button>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--v3-border)", background: "var(--v3-surface)", flexShrink: 0 }}>
          {(["decisions", "audit"] as RightTab[]).map((tab) => (
            <button key={tab} onClick={() => setRightTab(tab)} style={{
              padding: "10px 16px", fontSize: 13, background: "none", border: "none",
              borderBottom: rightTab === tab ? "2px solid var(--v3-accent)" : "2px solid transparent",
              color: rightTab === tab ? "var(--v3-text-primary)" : "var(--v3-text-secondary)",
              cursor: "pointer", fontFamily: "var(--v3-font)", fontWeight: rightTab === tab ? 600 : 400,
              textTransform: "capitalize",
            }}>{tab}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {rightTab === "decisions" && (
            <>
              {/* Filter chips with counts */}
              <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                {(["open", "decided", "all"] as DecisionFilter[]).map((f) => (
                  <button key={f} onClick={() => setDecisionFilter(f)} style={{
                    padding: "3px 10px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                    background: decisionFilter === f ? "var(--v3-accent-soft)" : "var(--v3-surface-2)",
                    color: decisionFilter === f ? "var(--v3-accent)" : "var(--v3-text-secondary)",
                    border: decisionFilter === f ? "1px solid var(--v3-accent-glow)" : "1px solid var(--v3-border)",
                    fontFamily: "var(--v3-font)",
                  }}>{filterLabels[f]}</button>
                ))}
              </div>
              {sortedDecisions.length === 0 ? (
                <EmptyState
                  icon={emptyStateProps[decisionFilter].icon}
                  title={emptyStateProps[decisionFilter].title}
                  description={emptyStateProps[decisionFilter].description}
                />
              ) : (
                sortedDecisions.map((d: any) => (
                  <DecisionCard key={d.id} decision={d}
                    onDecide={onDecideDecision} onDefer={onDeferDecision} onDismiss={handleDismissDecision} />
                ))
              )}
            </>
          )}

          {rightTab === "audit" && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Phase", "Status", "Approved By", "Approved At", "Readiness"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--v3-border)", color: "var(--v3-text-secondary)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ADAM_PHASE_SEQUENCE.map((phaseId) => {
                  const r = gateReviews[phaseId];
                  return (
                    <tr key={phaseId}>
                      <td style={{ padding: "8px 8px", borderBottom: "1px solid var(--v3-border-soft)", color: "var(--v3-text-primary)" }}>{PHASE_LABELS[phaseId]}</td>
                      <td style={{ padding: "8px 8px", borderBottom: "1px solid var(--v3-border-soft)" }}>
                        <span
                          className={`v3-chip ${r?.status === "approved" ? "green" : r?.status === "remediation-requested" ? "amber" : "muted"}`}
                          style={{ fontSize: 11 }}
                        >
                          {r?.status ?? "pending"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 8px", borderBottom: "1px solid var(--v3-border-soft)", color: "var(--v3-text-secondary)" }}>{r?.approvedBy ?? "—"}</td>
                      <td style={{ padding: "8px 8px", borderBottom: "1px solid var(--v3-border-soft)", color: "var(--v3-text-secondary)" }}>{r?.approvedAt ? new Date(r.approvedAt).toLocaleDateString() : "—"}</td>
                      <td style={{ padding: "8px 8px", borderBottom: "1px solid var(--v3-border-soft)", color: "var(--v3-text-secondary)" }}>{r?.readinessScore != null ? `${r.readinessScore}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Gate Approval Modal */}
      {approvalModalPhase && (
        <GateApprovalModal
          open={!!approvalModalPhase}
          phaseId={approvalModalPhase}
          phaseLabel={PHASE_LABELS[approvalModalPhase] ?? approvalModalPhase}
          review={approvalModalReview ?? {}}
          onApprove={onApproveGate}
          onRequestRemediation={onRequestRemediation}
          onClose={() => setApprovalModalPhase(null)}
        />
      )}
      </div>
    </div>
  );
}
