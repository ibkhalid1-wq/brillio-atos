import React, { useMemo } from "react";
import { getAgentMeta } from "@/v3/lib/agentMeta";

interface AgentRun {
  agentId: string;
  status: "success" | "failed" | "timeout";
  durationMs: number;
  createdAt: string;
  programId?: string;
}

interface AgentMetricsPanelProps {
  runs: AgentRun[];
  onRefresh?: () => void;
  loading?: boolean;
  onRetry?: (agentId: string) => void;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius-lg)", padding: "12px 16px", flex: 1 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--v3-text-primary)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function AgentMetricsPanel({ runs, onRefresh, loading, onRetry }: AgentMetricsPanelProps) {
  const { totalRuns, successRate, avgMs, byAgent, recentFailures } = useMemo(() => {
    const totalRuns = runs.length;
    const successes = runs.filter((r) => r.status === "success").length;
    const successRate = totalRuns > 0 ? Math.round((successes / totalRuns) * 100) : 0;
    const avgMs = totalRuns > 0 ? Math.round(runs.reduce((s, r) => s + r.durationMs, 0) / totalRuns) : 0;

    const agentMap: Record<string, { runs: number; successes: number; totalMs: number }> = {};
    for (const r of runs) {
      if (!agentMap[r.agentId]) agentMap[r.agentId] = { runs: 0, successes: 0, totalMs: 0 };
      agentMap[r.agentId].runs++;
      if (r.status === "success") agentMap[r.agentId].successes++;
      agentMap[r.agentId].totalMs += r.durationMs;
    }
    const byAgent = Object.entries(agentMap).map(([id, d]) => ({
      agentId: id, label: getAgentMeta(id).label,
      runs: d.runs, successRate: Math.round((d.successes / d.runs) * 100),
      avgMs: Math.round(d.totalMs / d.runs),
    })).sort((a, b) => b.runs - a.runs);

    const recentFailures = runs.filter((r) => r.status !== "success").slice(-5).reverse();
    return { totalRuns, successRate, avgMs, byAgent, recentFailures };
  }, [runs]);

  return (
    <div style={{ padding: "var(--v3-space-4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--v3-text-primary)" }}>Agent Performance</div>
        {onRefresh && <button onClick={onRefresh} disabled={loading} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--v3-accent)" }}>↻ Refresh</button>}
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <StatCard label="Total Runs" value={String(totalRuns)} />
        <StatCard label="Success Rate" value={`${successRate}%`} />
        <StatCard label="Avg Duration" value={avgMs < 1000 ? `${avgMs}ms` : `${(avgMs / 1000).toFixed(1)}s`} />
      </div>

      {byAgent.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--v3-text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>By Agent</div>
          {byAgent.map((a) => (
            <div key={a.agentId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--v3-border-soft)" }}>
              <span style={{ width: 120, fontSize: 13, color: "var(--v3-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</span>
              <span style={{ width: 36, fontSize: 12, color: "var(--v3-text-muted)", textAlign: "right" }}>{a.runs}</span>
              <div style={{ flex: 1, height: 4, background: "var(--v3-surface-3)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${a.successRate}%`, background: a.successRate >= 80 ? "var(--v3-green)" : a.successRate >= 50 ? "var(--v3-amber)" : "var(--v3-red)", borderRadius: 2 }} />
              </div>
              <span style={{ width: 40, fontSize: 12, color: "var(--v3-text-muted)", textAlign: "right" }}>{a.avgMs < 1000 ? `${a.avgMs}ms` : `${(a.avgMs / 1000).toFixed(1)}s`}</span>
            </div>
          ))}
        </div>
      )}

      {recentFailures.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--v3-text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>Recent Failures</div>
          {recentFailures.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--v3-border-soft)", fontSize: 12, alignItems: "center" }}>
              <span style={{ color: "var(--v3-red)" }}>{getAgentMeta(r.agentId).label}</span>
              <span style={{ color: "var(--v3-text-muted)", flex: 1 }}>{new Date(r.createdAt).toLocaleString()}</span>
              <span style={{ color: "var(--v3-text-muted)" }}>{r.durationMs}ms</span>
              {onRetry && (
                <button
                  type="button"
                  style={{ fontSize: 11, color: "var(--v3-accent)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}
                  onClick={() => onRetry(r.agentId)}
                >
                  Retry
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
