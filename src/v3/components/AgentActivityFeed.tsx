import React from "react";
import { getAgentMeta } from "@/v3/lib/agentMeta";

export interface AgentActivityItem {
  runId: string;
  agentId: string;
  status: "running" | "success" | "failed" | "queued";
  startedAt: string;
  durationMs?: number;
  phaseId?: string;
  /** Raw failure reason from adam_agent_runs.error_message — surfaced inline on failed runs. */
  errorMessage?: string;
}

// Mirror of the smoke-test classifiers: tell a transient provider outage apart from
// an auth problem apart from a genuine failure, so a failed run reads as a clear,
// actionable reason instead of an opaque red ✗ buried away in a trace drawer.
const PROVIDER_RE = /overload|rate.?limit|upstream|unavailable|timed?\s*out|timeout|503|529|capacity|provider|anthropic|model_error|api error/i;
const AUTH_RE = /jwt|unauthor|forbidden|not allowed|permission|\bsign|token|401|403/i;

/** Turn a raw error_message into a short, human-readable reason + retry hint. */
function classifyAgentError(raw?: string): string {
  const msg = (raw || "").trim();
  if (!msg) return "Run failed — open the trace for details.";
  if (PROVIDER_RE.test(msg) && !AUTH_RE.test(msg)) {
    return "AI provider temporarily unavailable — retry shortly.";
  }
  if (AUTH_RE.test(msg)) {
    return "Sign-in expired — sign in again, then retry.";
  }
  return msg.length > 140 ? `${msg.slice(0, 139).trimEnd()}…` : msg;
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
        const failureReason = item.status === "failed" ? classifyAgentError(item.errorMessage) : null;
        return (
          <div key={item.runId} style={{
            display: "flex", flexDirection: "column", gap: 2,
            padding: compact ? "4px 0" : "6px 0",
            borderBottom: "1px solid var(--v3-border-soft)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: cfg.color, fontSize: compact ? 11 : 13, animation: item.status === "running" ? "v3-pulse 1.5s ease-in-out infinite" : "none" }}>{cfg.icon}</span>
              <span style={{ flex: 1, fontSize: compact ? 11 : 12, color: "var(--v3-text-primary)" }}>{meta.label}</span>
              {item.phaseId && <span style={{ fontSize: 11, color: "var(--v3-text-muted)", background: "var(--v3-surface-2)", borderRadius: 4, padding: "1px 5px" }}>{item.phaseId}</span>}
              {item.durationMs && item.status === "success" && <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>{item.durationMs < 1000 ? `${item.durationMs}ms` : `${(item.durationMs / 1000).toFixed(1)}s`}</span>}
              <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>{relTime(item.startedAt)}</span>
            </div>
            {failureReason && (
              <div style={{
                fontSize: 11,
                color: "var(--v3-red)",
                lineHeight: 1.4,
                paddingLeft: compact ? 19 : 21,
              }}>
                {failureReason}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
