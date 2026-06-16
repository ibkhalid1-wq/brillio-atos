import React, { useMemo } from "react";
import type { ProgramSummary } from "@/new/types";
import { confidenceColor } from "@/v3/lib/uiHelpers";
import { deriveOpenRecommendedActions } from "@/v3/lib/recommendedActions";

interface PortfolioInsightPanelProps {
  programs: ProgramSummary[];
  anyAgentRunning: boolean;
  onRunAgent: (agentId: string) => void;
}

interface IntelCard {
  label: string;
  value: string | number;
  color?: string;
  description: string;
  icon: string;
}

export default function PortfolioInsightPanel({ programs, anyAgentRunning, onRunAgent }: PortfolioInsightPanelProps) {
  const intel = useMemo((): IntelCard[] => {
    // At-risk programmes (confidence < 60 or avg completion stalled < 10%)
    const atRisk = programs.filter((p) => {
      const phases = p.phases ?? [];
      const avg = phases.length > 0 ? phases.reduce((s, ph) => s + (ph.pct || 0), 0) / phases.length : 0;
      const openD = deriveOpenRecommendedActions(p).length;
      const score = Math.round((avg * 0.4) + (openD > 0 ? Math.max(0, 100 - openD * 10) * 0.25 : 25));
      return score < 60;
    });

    // Gate forecast: total approved vs total gates
    const totalGates = programs.reduce((s, p) => s + (p.phases?.length ?? 0), 0);
    const approvedGates = programs.reduce((s, p) => {
      return s + Object.values(p.gateReviews || {}).filter((g: any) => g?.status === "approved").length;
    }, 0);
    const gatePct = totalGates > 0 ? Math.round((approvedGates / totalGates) * 100) : 0;

    // Cross-programme decision load
    const totalOpenDecisions = programs.reduce((s, p) => {
      return s + deriveOpenRecommendedActions(p).length;
    }, 0);

    return [
      {
        icon: "⚑",
        label: "At-Risk Programmes",
        value: atRisk.length,
        color: atRisk.length > 0 ? "var(--v3-red)" : "var(--v3-green)",
        description: atRisk.length > 0
          ? `${atRisk.map((p) => p.name).slice(0, 2).join(", ")}${atRisk.length > 2 ? ` +${atRisk.length - 2} more` : ""}`
          : "All programmes on track",
      },
      {
        icon: "⬡",
        label: "Gate Coverage",
        value: `${gatePct}%`,
        color: confidenceColor(gatePct),
        description: `${approvedGates} of ${totalGates} gates approved across portfolio`,
      },
      {
        icon: "⊖",
        label: "Open Actions",
        value: totalOpenDecisions,
        color: totalOpenDecisions > 0 ? "var(--v3-amber)" : undefined,
        description: totalOpenDecisions > 0
          ? `${totalOpenDecisions} action${totalOpenDecisions !== 1 ? "s" : ""} awaiting resolution across ${programs.length} programmes`
          : "No open actions",
      },
    ];
  }, [programs]);

  return (
    <div
      style={{
        background: "var(--v3-surface)",
        border: "1px solid var(--v3-border-soft)",
        borderRadius: "var(--v3-radius)",
        padding: "20px 20px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--v3-text-primary)", fontFamily: "var(--v3-font)" }}>
            Portfolio Intelligence
          </div>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", fontFamily: "var(--v3-font)", marginTop: 2 }}>
            Cross-programme risk, gate coverage, and action load
          </div>
        </div>
        <button
          disabled={anyAgentRunning}
          onClick={() => onRunAgent("portfolio-intelligence")}
          style={{
            padding: "7px 14px", background: anyAgentRunning ? "var(--v3-surface-3)" : "var(--v3-surface-2)",
            border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius)",
            cursor: anyAgentRunning ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600,
            color: anyAgentRunning ? "var(--v3-text-muted)" : "var(--v3-accent)",
            fontFamily: "var(--v3-font)", opacity: anyAgentRunning ? 0.6 : 1,
            display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
          }}
        >
          <span>◈</span>
          <span>{anyAgentRunning ? "Running…" : "Generate Analysis"}</span>
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {intel.map((card) => (
          <div
            key={card.label}
            style={{
              flex: "1 1 140px", minWidth: 0, padding: "14px 16px",
              background: "var(--v3-surface-2)", borderRadius: "var(--v3-radius)",
              border: "1px solid var(--v3-border-soft)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 15, color: "var(--v3-text-muted)" }}>{card.icon}</span>
              <span style={{ fontSize: 11, color: "var(--v3-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--v3-font)" }}>
                {card.label}
              </span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: card.color ?? "var(--v3-text-primary)", lineHeight: 1, fontFamily: "var(--v3-font)", marginBottom: 6, letterSpacing: "-0.02em" }}>
              {card.value}
            </div>
            <div style={{ fontSize: 11, color: "var(--v3-text-muted)", fontFamily: "var(--v3-font)", lineHeight: 1.4 }}>
              {card.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
