import React, { useState } from "react";
import { Button } from "@/v3/components/ui/Button";

interface Decision {
  id: string;
  title: string;
  question: string;
  type: string;
  priority: "high" | "medium" | "low";
  status: "open" | "decided" | "deferred";
  phaseId?: string;
  source?: string;
  createdAt: string;
  recommendation?: string;
  rationale?: string;
}

interface DecisionCardProps {
  decision: Decision;
  onDecide: (id: string, decision: string) => Promise<void>;
  onDefer: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}

const PRIORITY_COLOR: Record<string, string> = {
  high: "var(--v3-red)", medium: "var(--v3-amber)", low: "var(--v3-accent-b)",
};

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

export function DecisionCard({ decision, onDecide, onDefer, onDismiss }: DecisionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [decisionText, setDecisionText] = useState("");
  const [loading, setLoading] = useState(false);

  const handleDecide = async () => {
    if (!decisionText.trim()) return;
    setLoading(true);
    try { await onDecide(decision.id, decisionText); } finally { setLoading(false); }
  };

  const prioColor = PRIORITY_COLOR[decision.priority] ?? "var(--v3-text-muted)";

  return (
    <div style={{
      background: "var(--v3-surface)", border: "1px solid var(--v3-border)",
      borderRadius: "var(--v3-radius-lg)", marginBottom: 8, overflow: "hidden",
    }}>
      {/* Collapsed header */}
      <button onClick={() => setExpanded((x) => !x)} style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px",
        background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "var(--v3-font)",
      }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: prioColor, flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 13, color: "var(--v3-text-primary)", fontWeight: 500, lineHeight: 1.4 }}>{decision.title}</span>
        {decision.source && <span style={{ fontSize: 11, color: "var(--v3-text-muted)", background: "var(--v3-surface-2)", borderRadius: 4, padding: "1px 6px" }}>{decision.source}</span>}
        <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>{relTime(decision.createdAt)}</span>
        <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--v3-border-soft)" }}>
          <p style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.6, margin: "10px 0" }}>{decision.question}</p>

          {decision.recommendation && (
            <div style={{ background: "var(--v3-accent-soft)", border: "1px solid var(--v3-accent-glow2)", borderRadius: "var(--v3-radius)", padding: "10px 12px", marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-accent)", marginBottom: 4 }}>AI Recommendation</div>
              <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>{decision.recommendation}</div>
              {decision.rationale && <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 6, fontStyle: "italic" }}>{decision.rationale}</div>}
            </div>
          )}

          {decision.status === "open" && (
            <>
              <textarea
                value={decisionText}
                onChange={(e) => setDecisionText(e.target.value)}
                placeholder="Enter decision…"
                rows={2}
                style={{
                  width: "100%", background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)",
                  borderRadius: "var(--v3-radius)", padding: "8px 10px", fontSize: 13,
                  color: "var(--v3-text-primary)", fontFamily: "var(--v3-font)", resize: "vertical",
                  outline: "none", marginBottom: 8, boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="sm" variant="primary" loading={loading} disabled={!decisionText.trim()} onClick={handleDecide}>Record Decision</Button>
                <Button size="sm" variant="ghost" onClick={() => onDefer(decision.id)}>Defer</Button>
                <Button size="sm" variant="ghost" onClick={() => onDismiss(decision.id)}>Dismiss</Button>
              </div>
            </>
          )}
          {decision.status !== "open" && (
            <div style={{ fontSize: 12, color: "var(--v3-text-muted)", fontStyle: "italic" }}>Status: {decision.status}</div>
          )}
        </div>
      )}
    </div>
  );
}
