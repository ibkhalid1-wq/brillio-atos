import React, { useMemo, useState } from "react";
import { PHASE_LABELS } from "@/v3/lib/uiHelpers";
import { NumberCountUp } from "@/v3/components/ui/NumberCountUp";
import { ContextHeader } from "@/v3/components/ContextHeader";
import { ReadinessArcGauge } from "@/v3/components/ReadinessArcGauge";
import { GateCoachPanel } from "@/v3/components/GateCoachPanel";
import { AutoSaveField } from "@/v3/components/ui/AutoSaveField";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import { AgentActivityFeed, type AgentActivityItem } from "@/v3/components/AgentActivityFeed";
import { getMandatoryCriteria } from "@/v3/lib/exitCriteriaLibrary";
import { getProgramState } from "@/new/lib/programState";
import { ADAM_PHASE_SEQUENCE } from "@/lib/adamMethodology";

interface PhaseCockpitProps {
  programId: string;
  programName: string;
  rawData: Record<string, unknown>;
  activePhaseId: string | null;
  onSetPhase: (phaseId: string) => void;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  anyAgentRunning: boolean;
  mode: "guided" | "power";
  agentActivity?: AgentActivityItem[];
  onSaveField?: (field: string, value: string) => Promise<void>;
  onOpenCommandPalette?: () => void;
  onApproveGate?: (phaseId: string) => Promise<void>;
  onRequestRemediation?: (phaseId: string, note: string) => Promise<void>;
  onOpenRemediationModal?: (phaseId: string) => void;
}

type CockpitTab = "status" | "risks" | "decisions" | "gate";

const PHASE_AGENTS: Record<string, string[]> = {
  strategy: ["narrative", "plan", "kpi-validator"],
  mobilise: ["plan", "risk", "capacity-assessor"],
  discover: ["narrative", "stakeholder", "discovery-guide-generator"],
  design: ["narrative", "change-impact", "risk"],
  build: ["milestone", "risk", "sprint-planner"],
  operate: ["health-heatmap", "narrative", "gate-review"],
  govern: ["gate-review", "compliance-checker", "lessons-synthesiser"],
  optimize: ["narrative", "benchmark-comparator", "lessons-synthesiser"],
  valuerealize: ["narrative", "kpi-validator", "closure"],
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function severityChipStyle(severity: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 600,
    padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap",
  };
  if (severity === "critical") return { ...base, background: "rgba(239,68,68,0.12)", color: "var(--v3-red)" };
  if (severity === "high") return { ...base, background: "rgba(245,158,11,0.12)", color: "var(--v3-amber)" };
  if (severity === "medium") return { ...base, background: "rgba(59,130,246,0.12)", color: "var(--v3-accent)" };
  return { ...base, background: "var(--v3-surface-3)", color: "var(--v3-text-muted)" };
}

export default function PhaseCockpit({
  programId, programName, rawData, activePhaseId, onSetPhase,
  onRunAgent, anyAgentRunning, mode, agentActivity = [], onSaveField, onOpenCommandPalette,
  onApproveGate, onRequestRemediation, onOpenRemediationModal,
}: PhaseCockpitProps) {
  const [activeTab, setActiveTab] = useState<CockpitTab>("status");

  const { inner } = useMemo(() => getProgramState(rawData), [rawData]);

  const phases = useMemo(() =>
    ADAM_PHASE_SEQUENCE.map((id) => {
      const pData = (inner as any)[id] ?? {};
      const pct: number = typeof pData.pct === "number" ? pData.pct
        : Array.isArray(inner.phases)
          ? ((inner.phases as any[]).find((p: any) => p.id === id)?.pct ?? 0) : 0;
      const gateReviews = (inner.gateReviews as any) ?? {};
      const gateStatus = gateReviews[id]?.status ?? "pending";
      return { id, label: PHASE_LABELS[id] ?? id, pct, gateStatus };
    }),
  [inner]);

  const activePhase = phases.find((p) => p.id === activePhaseId) ?? phases[0];
  const phaseLabel = activePhase?.label ?? "Phase";

  const gateReviews = useMemo(() => {
    const gr = inner.gateReviews;
    return (typeof gr === "object" && gr !== null && !Array.isArray(gr)) ? gr as Record<string, any> : {};
  }, [inner]);

  const activeReview = activePhaseId ? gateReviews[activePhaseId] : null;
  const readinessScore: number = activeReview?.readinessScore ?? 0;

  const exitCriteria = useMemo(() =>
    activePhaseId ? getMandatoryCriteria(activePhaseId) : [],
  [activePhaseId]);

  const phaseDecisions = useMemo(() => {
    const dq = Array.isArray(inner.decisionQueue) ? inner.decisionQueue as any[] : [];
    return dq.filter((d: any) => (!activePhaseId || d.phaseId === activePhaseId) && d.status === "open");
  }, [inner, activePhaseId]);

  const phaseRisks = useMemo(() => {
    const raidEntries = Array.isArray((inner as any).raidEntries) ? (inner as any).raidEntries as any[] : [];
    if (raidEntries.length === 0) return [];
    const phaseSpecific = raidEntries.filter((r: any) => r.phaseId === activePhaseId);
    return phaseSpecific.length > 0 ? phaseSpecific : raidEntries;
  }, [inner, activePhaseId]);

  const phaseAgentIds = activePhaseId ? (PHASE_AGENTS[activePhaseId] ?? ["narrative", "plan", "risk"]) : [];

  const TABS: { id: CockpitTab; label: string }[] = [
    { id: "status", label: "Status" },
    { id: "risks", label: "Risks & Issues" },
    { id: "decisions", label: phaseDecisions.length > 0 ? `Decisions (${phaseDecisions.length})` : "Decisions" },
    { id: "gate", label: "Gate" },
  ];

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden", height: "100%" }}>
      {/* Left — Phase Navigator */}
      <div style={{
        width: 220, flexShrink: 0, borderRight: "1px solid var(--v3-border)",
        background: "var(--v3-surface)", overflowY: "auto", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--v3-border)", fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Phases
        </div>
        {phases.map((p) => {
          const isActive = p.id === activePhaseId;
          const gateColor = p.gateStatus === "approved" ? "var(--v3-green)" : p.gateStatus === "remediation-requested" ? "var(--v3-amber)" : p.gateStatus === "in-review" ? "var(--v3-accent)" : "var(--v3-border)";
          return (
            <button key={p.id} onClick={() => onSetPhase(p.id)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
              background: isActive ? "var(--v3-accent-soft)" : "transparent",
              border: "none", borderLeft: isActive ? "3px solid var(--v3-accent)" : "3px solid transparent",
              cursor: "pointer", textAlign: "left", fontFamily: "var(--v3-font)", width: "100%",
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: isActive ? "var(--v3-text-primary)" : "var(--v3-text-secondary)" }}>{p.label}</div>
                <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 1 }}>{p.pct}%</div>
              </div>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: gateColor, flexShrink: 0 }} />
            </button>
          );
        })}
      </div>

      {/* Centre — Work Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <ContextHeader programName={programName} mode="delivery" phaseLabel={phaseLabel} activeTab={activeTab !== "status" ? activeTab : null} onOpenCommandPalette={onOpenCommandPalette} />

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--v3-border)", background: "var(--v3-surface)", flexShrink: 0 }}>
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: "10px 16px", fontSize: 13, background: "none", border: "none",
              borderBottom: activeTab === tab.id ? "2px solid var(--v3-accent)" : "2px solid transparent",
              color: activeTab === tab.id ? "var(--v3-text-primary)" : "var(--v3-text-secondary)",
              cursor: "pointer", fontFamily: "var(--v3-font)", fontWeight: activeTab === tab.id ? 600 : 400,
            }}>{tab.label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>

          {/* STATUS tab */}
          {activeTab === "status" && (
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <div style={{ width: "100%", fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 12 }}>
                Phase status — {activePhase?.label ?? "Current phase"}
              </div>

              {/* Phase Signal mini-section */}
              <div style={{ width: "100%", background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius-lg)", padding: "12px 14px", marginBottom: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Phase Signal</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: "var(--v3-accent-soft)", color: "var(--v3-accent)" }}>
                    {activePhase?.pct ?? 0}% complete
                  </span>
                  {readinessScore > 0 && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: readinessScore >= 70 ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)", color: readinessScore >= 70 ? "var(--v3-green)" : "var(--v3-amber)" }}>
                      Gate readiness: {readinessScore}%
                    </span>
                  )}
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: phaseDecisions.length > 0 ? "rgba(245,158,11,0.12)" : "var(--v3-surface-3)", color: phaseDecisions.length > 0 ? "var(--v3-amber)" : "var(--v3-text-muted)" }}>
                    {phaseDecisions.length} open decision{phaseDecisions.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>

              {/* Readiness card */}
              <div style={{ background: "var(--v3-surface)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius-xl)", padding: "20px", minWidth: 220 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 12 }}>Gate Readiness</div>
                <ReadinessArcGauge score={readinessScore} size={100} />
                <div style={{ textAlign: "center", marginTop: 4 }}>
                  <NumberCountUp value={readinessScore} duration={600} suffix="%" style={{ fontSize: 24, fontWeight: 700, color: "var(--v3-text-primary)" }} />
                </div>
                <div style={{ textAlign: "center", marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                    {activeReview?.status === "approved" ? "✓ Gate Approved" : activeReview?.status === "remediation-requested" ? "⚠ Remediation Requested" : "Gate Pending"}
                  </div>
                </div>
              </div>

              {/* Agent card */}
              <div style={{ flex: 1, minWidth: 240 }}>
                {anyAgentRunning ? (
                  <div style={{ background: "var(--v3-accent-soft)", border: "1px solid var(--v3-accent-glow)", borderRadius: "var(--v3-radius-xl)", padding: "16px" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-accent)", marginBottom: 8 }}>◎ Agent Running…</div>
                    <AgentActivityFeed items={agentActivity.filter((a) => a.status === "running")} maxItems={3} compact />
                  </div>
                ) : (
                  <div style={{ background: "var(--v3-surface)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius-xl)", padding: "16px" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>Run Phase Agents</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {phaseAgentIds.map((agentId) => (
                        <button key={agentId} onClick={() => onRunAgent(agentId, activePhaseId ?? undefined)} style={{
                          background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius)",
                          padding: "5px 12px", fontSize: 12, color: "var(--v3-text-secondary)", cursor: "pointer", fontFamily: "var(--v3-font)",
                        }}>{agentId.replace(/-/g, " ")}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Gate Coach — actions populated by gate-readiness-coach agent output */}
                {activePhaseId && (() => {
                  const coachActions = (inner as any)[activePhaseId]?.gateCoachActions ?? [];
                  return coachActions.length > 0 ? (
                    <div style={{ marginTop: 16 }}>
                      <GateCoachPanel
                        actions={coachActions}
                        onRunAgent={(agentId) => onRunAgent(agentId, activePhaseId)}
                      />
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
          )}

          {/* RISKS tab */}
          {activeTab === "risks" && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 16 }}>
                Risks & issues — {phaseLabel}
              </div>
              {phaseRisks.length === 0 ? (
                <div>
                  <EmptyState
                    icon="✓"
                    title="No risks recorded for this phase"
                    description="Run the Risk agent to analyse and surface risks for this stage."
                    action={{ label: "Run Risk Agent", onClick: () => onRunAgent("risk", activePhaseId ?? "program") }}
                  />
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[...phaseRisks]
                    .sort((a: any, b: any) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4))
                    .map((r: any, i: number) => (
                      <div key={r.id ?? i} style={{ background: "var(--v3-surface)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius-lg)", padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={severityChipStyle(r.severity ?? "medium")}>{r.severity ?? "medium"}</span>
                          {r.status && (
                            <span style={{ fontSize: 11, color: "var(--v3-text-muted)", background: "var(--v3-surface-2)", borderRadius: 6, padding: "2px 7px" }}>{r.status}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)", marginBottom: 4 }}>{r.description ?? r.title ?? `Risk ${i + 1}`}</div>
                        {r.owner && <div style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>Owner: {r.owner}</div>}
                      </div>
                    ))}
                  <button
                    onClick={() => onRunAgent("risk", activePhaseId ?? "program")}
                    style={{ marginTop: 8, background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius)", padding: "7px 14px", fontSize: 12, color: "var(--v3-accent)", cursor: "pointer", fontFamily: "var(--v3-font)", alignSelf: "flex-start" }}
                  >
                    Run Risk Agent
                  </button>
                </div>
              )}
            </div>
          )}

          {/* DECISIONS tab */}
          {activeTab === "decisions" && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 16 }}>
                Open decisions — {phaseLabel}
              </div>
              {phaseDecisions.length === 0 ? (
                <EmptyState icon="✓" title="No open decisions for this phase" description="Open decisions will appear here as agents flag blockers or raise questions for review." />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {phaseDecisions.map((d: any) => (
                    <div key={d.id} style={{ background: "var(--v3-surface)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius-lg)", padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={severityChipStyle(d.priority ?? "medium")}>{d.priority ?? "medium"}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)", marginBottom: 4 }}>{d.title}</div>
                      {d.question && <div style={{ fontSize: 12, color: "var(--v3-text-secondary)" }}>{d.question}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* GATE tab */}
          {activeTab === "gate" && (
            exitCriteria.length === 0 ? (
              <EmptyState icon="⊞" title="No checklist items yet" description="Completion checklist items will appear here once a gate review is run." />
            ) : (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 16 }}>
                  Gate readiness — {phaseLabel}
                </div>
                <div style={{ marginBottom: 20 }}>
                  <ReadinessArcGauge score={readinessScore} size={80} />
                </div>
                {activePhaseId && (() => {
                  const coachActions = (inner as any)[activePhaseId]?.gateCoachActions ?? [];
                  return coachActions.length > 0 ? (
                    <div style={{ marginBottom: 20 }}>
                      <GateCoachPanel
                        actions={coachActions}
                        onRunAgent={(agentId) => onRunAgent(agentId, activePhaseId)}
                      />
                    </div>
                  ) : null;
                })()}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {exitCriteria.map((c) => {
                    const evidence = (inner as any)[`evidence_${c.id}`] ?? "";
                    const hasEvidence = typeof evidence === "string" && evidence.trim().length > 0;
                    return (
                      <div key={c.id} style={{ background: "var(--v3-surface)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius-lg)", padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                          <span style={{ color: hasEvidence ? "var(--v3-green)" : "var(--v3-text-muted)", fontWeight: 600, marginTop: 1 }}>{hasEvidence ? "✓" : "○"}</span>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>{c.label}</div>
                            <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", marginTop: 2 }}>{c.description}</div>
                          </div>
                        </div>
                        {onSaveField && (
                          <AutoSaveField
                            value={evidence}
                            onSave={(val) => onSaveField(`evidence_${c.id}`, val)}
                            placeholder={c.evidencePrompt}
                            rows={2}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button
                    onClick={() => activePhaseId && onApproveGate?.(activePhaseId)}
                    style={{ background: "var(--v3-accent)", color: "#fff", border: "none", borderRadius: "var(--v3-radius)", padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--v3-font)" }}
                  >
                    Approve &amp; Unlock Next Phase ✓
                  </button>
                  <button
                    onClick={() => {
                      if (!activePhaseId) return;
                      if (onOpenRemediationModal) {
                        onOpenRemediationModal(activePhaseId);
                      } else {
                        onRequestRemediation?.(activePhaseId, "Issues flagged for remediation — please review exit criteria.");
                      }
                    }}
                    style={{ background: "none", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius)", padding: "8px 16px", fontSize: 13, color: "var(--v3-text-secondary)", cursor: "pointer", fontFamily: "var(--v3-font)" }}
                  >
                    Flag Issues for Review
                  </button>
                  <button
                    onClick={() => onRunAgent("gate-review", activePhaseId ?? undefined)}
                    style={{ background: "none", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius)", padding: "8px 16px", fontSize: 13, color: "var(--v3-accent)", cursor: "pointer", fontFamily: "var(--v3-font)" }}
                  >
                    Run AI Gate Check
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
