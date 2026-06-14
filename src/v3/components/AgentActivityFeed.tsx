import React from "react";
import { getAgentMeta } from "@/v3/lib/agentMeta";

export interface AgentActivityItem {
  runId: string;
  agentId: string;
  status: "running" | "success" | "failed" | "queued";
  startedAt: string;
  durationMs?: number;
  phaseId?: string;
}

interface AgentActivityFeedProps {
  items?: AgentActivityItem[] | null;
  maxItems?: number;
  compact?: boolean;
}

const STATUS_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  running: { color: "var(--v3-accent)", icon: "◎", label: "Running" },
  success: { color: "var(--v3-green)", icon: "✓", label: "Complete" },
  failed:  { color: "var(--v3-red)",   icon: "✗", label: "Failed" },
  queued:  { color: "var(--v3-text-muted)", icon: "◌", label: "Queued" },
};

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function AgentActivityFeed({ items, maxItems = 10, compact = false }: AgentActivityFeedProps) {
  const visible = (items || []).slice(0, maxItems);
  if (visible.length === 0) return (
    <div style={{ padding: "12px 0", fontSize: 12, color: "var(--v3-text-muted)", textAlign: "center" }}>No recent agent activity</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 2 : 4 }}>
      {visible.map((item) => {
        const meta = getAgentMeta(item.agentId);
        const cfg = STATUS_CONFIG[item.status];
        return (
          <div key={item.runId} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: compact ? "4px 0" : "6px 0",
            borderBottom: "1px solid var(--v3-border-soft)",
          }}>
            <span style={{ color: cfg.color, fontSize: compact ? 11 : 13, animation: item.status === "running" ? "v3-pulse 1.5s ease-in-out infinite" : "none" }}>{cfg.icon}</span>
            <span style={{ flex: 1, fontSize: compact ? 11 : 12, color: "var(--v3-text-primary)" }}>{meta.label}</span>
            {item.phaseId && <span style={{ fontSize: 11, color: "var(--v3-text-muted)", background: "var(--v3-surface-2)", borderRadius: 4, padding: "1px 5px" }}>{item.phaseId}</span>}
            {item.durationMs && item.status === "success" && <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>{item.durationMs < 1000 ? `${item.durationMs}ms` : `${(item.durationMs / 1000).toFixed(1)}s`}</span>}
            <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>{relTime(item.startedAt)}</span>
          </div>
        );
      })}
    </div>
  );
}
