import React, { useState } from "react";
import type { AgentConfidence } from "@/v3/lib/agentConfidence";
import { confidenceLevelColor } from "@/v3/lib/agentConfidence";

interface ConfidenceBadgeProps {
  confidence: AgentConfidence;
  showBreakdown?: boolean;
}

const LABEL: Record<string, string> = { high: "High confidence", medium: "Medium", low: "Low confidence" };

export function ConfidenceBadge({ confidence, showBreakdown = false }: ConfidenceBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const color = confidenceLevelColor(confidence.level);

  const badge = (
    <span
      onClick={showBreakdown ? () => setExpanded((x) => !x) : undefined}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
        padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 500, cursor: showBreakdown ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {LABEL[confidence.level]}
    </span>
  );

  if (!showBreakdown) return badge;

  return (
    <div style={{ display: "inline-block" }}>
      {badge}
      {expanded && (
        <div style={{
          marginTop: 6, background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)",
          borderRadius: "var(--v3-radius)", padding: "10px 12px", fontSize: 12, minWidth: 200,
        }}>
          <div style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, color: "var(--v3-text-secondary)" }}>
              <span>Score</span><span style={{ color }}>{Math.round(confidence.score * 100)}%</span>
            </div>
            <div style={{ height: 4, background: "var(--v3-surface-3)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${confidence.score * 100}%`, background: color, borderRadius: 2 }} />
            </div>
          </div>
          {confidence.signals.length > 0 && (
            <ul style={{ margin: 0, padding: "0 0 0 14px", color: "var(--v3-text-secondary)", lineHeight: 1.6 }}>
              {confidence.signals.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
          <div style={{ marginTop: 6, color: "var(--v3-text-muted)", fontSize: 11 }}>
            Input completeness: {confidence.inputCompleteness}%
          </div>
        </div>
      )}
    </div>
  );
}
