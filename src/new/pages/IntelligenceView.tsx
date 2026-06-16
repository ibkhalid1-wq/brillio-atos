import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AI_SETTINGS_SAVED_EVENT } from "@/v3/hooks/useAIStatus";
import { EmptyState } from "@/new/components/ui/EmptyState";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { useAgentEvents } from "@/new/lib/useAgentEvents";
import { useArtifactHistory } from "@/new/lib/useArtifactHistory";
import { usePatternLibrary } from "@/new/lib/usePatternLibrary";
import type {
  AgentEventSummary,
  ArtifactVersionSummary,
  PatternLibraryEntry,
  ProgramSummary,
} from "@/new/types";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(deltaMs)) return "just now";
  const minutes = Math.max(1, Math.round(deltaMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function prettyAgent(agentId: string): string {
  return agentId
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Autonomous agents shown in the status grid ───────────────────────────────

const AGENT_STATUS_GROUPS: Array<{ label: string; agents: string[] }> = [
  {
    label: "Core Delivery",
    agents: [
      "narrative", "plan", "risk", "milestone", "budget",
      "critical-path", "change-impact", "stakeholder", "adoption",
      "health-heatmap", "retro", "deck", "scope-pcr", "daily-briefing",
    ],
  },
  {
    label: "Governance",
    agents: ["gate-review", "escalation", "closure"],
  },
  {
    label: "Intelligence",
    agents: ["pattern-extract", "pattern-query", "twin-sync", "benchmark-comparator"],
  },
];

type AgentLastRun = {
  agentId: string;
  status: "complete" | "failed" | "running" | "queued" | "paused" | "cancelled" | null;
  completedAt: string | null;
  confidence: number | null;
};

type RYG = "green" | "amber" | "red" | "blue";

function ryg(run: AgentLastRun | undefined): RYG {
  if (!run || run.status === null) return "amber";           // never run → amber
  if (run.status === "running" || run.status === "queued" || run.status === "paused") return "blue";
  if (run.status === "failed" || run.status === "cancelled") return "red";
  if (run.status === "complete") {
    if (!run.completedAt) return "amber";
    const daysAgo = (Date.now() - new Date(run.completedAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= 7 ? "green" : "amber";
  }
  return "amber";
}

const RYG_DOT: Record<RYG, React.CSSProperties> = {
  green: { background: "var(--v3-green)", boxShadow: "0 0 6px rgba(34,197,94,0.55)" },
  amber: { background: "var(--v3-amber)", boxShadow: "0 0 6px rgba(245,166,35,0.45)" },
  red:   { background: "var(--v3-red)",   boxShadow: "0 0 6px rgba(239,68,68,0.5)" },
  blue:  { background: "#60a5fa",         boxShadow: "0 0 6px rgba(96,165,250,0.5)", animation: "v3-pulse 1.6s ease-in-out infinite" },
};

const RYG_LABEL: Record<RYG, string> = {
  green: "Up to date",
  amber: "Pending / stale",
  red:   "Last run failed",
  blue:  "Running now",
};

function AgentStatusDot({ color }: { color: RYG }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        borderRadius: "50%",
        flexShrink: 0,
        ...RYG_DOT[color],
      }}
    />
  );
}

// ─── Agent descriptions ───────────────────────────────────────────────────────

const AGENT_DESCRIPTIONS: Record<string, string> = {
  "narrative":             "Generates the full programme narrative for stakeholder communication.",
  "plan":                  "Produces a prioritised action plan with owner assignments and timelines.",
  "risk":                  "Identifies RAID entries, scores likelihood and impact, proposes mitigations.",
  "milestone":             "Tracks delivery milestones, flags slippage, and recalculates ETA.",
  "budget":                "Monitors spend vs forecast, surfaces variance and burn-rate alerts.",
  "critical-path":         "Maps schedule dependencies and highlights float on the critical path.",
  "change-impact":         "Assesses organisational change impact and readiness across impacted groups.",
  "stakeholder":           "Maps stakeholders by influence and engagement level, flags gaps.",
  "adoption":              "Scores adoption readiness, tracks training completion and resistance signals.",
  "health-heatmap":        "Scores programme health across 8 dimensions and surfaces red flags.",
  "retro":                 "Synthesises retrospective findings and lessons-learned from phase data.",
  "deck":                  "Builds a structured executive slide deck from programme artefacts.",
  "scope-pcr":             "Tracks scope baseline and logs change requests against approved scope.",
  "daily-briefing":        "Produces a concise daily status brief covering key events and risks.",
  "gate-review":           "Assesses gate readiness against exit criteria before phase transition.",
  "escalation":            "Monitors unresolved risks and decisions, triggers escalation alerts.",
  "closure":               "Validates programme closure readiness and generates closure artefacts.",
  "pattern-extract":       "Extracts reusable delivery patterns from programme data for the library.",
  "pattern-query":         "Queries the pattern library for relevant precedents and accelerators.",
  "twin-sync":             "Synchronises the digital twin graph with live programme state.",
  "benchmark-comparator":  "Benchmarks this programme against similar transformation patterns.",
};

// ─── Agent run history (drill-down) ──────────────────────────────────────────

type AgentRunRow = {
  id: string;
  status: string;
  phase_id: string | null;
  confidence: number | null;
  triggered_by: string | null;
  created_at: string;
  completed_at: string | null;
  tokens_used: number | null;
};

function AgentDrillDown({ programId, agentId, onClose }: { programId: string; agentId: string; onClose: (e?: React.MouseEvent) => void }) {
  const [runs, setRuns] = useState<AgentRunRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("adam_agent_runs")
          .select("id, status, phase_id, confidence, triggered_by, created_at, completed_at, tokens_used")
          .eq("program_id", programId)
          .eq("agent_id", agentId)
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) throw error;
        setRuns((data || []) as AgentRunRow[]);
      } catch (err) {
        console.error("[AgentDrillDown] Failed to load agent runs:", err);
        setRuns([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [programId, agentId]);

  const statusColor = (s: string) =>
    s === "complete" ? "var(--v3-green)" : s === "failed" || s === "cancelled" ? "var(--v3-red)" : s === "running" || s === "queued" ? "#60a5fa" : "var(--v3-amber)";

  return (
    <div
      style={{
        marginTop: 12,
        borderTop: "1px solid var(--v3-border-soft)",
        paddingTop: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="adam-micro" style={{ fontWeight: 600, color: "var(--v3-text-primary)" }}>
          Recent runs — {prettyAgent(agentId)}
        </span>
        <button type="button" className="adam-button-ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={onClose}>
          Close ✕
        </button>
      </div>

      {loading ? (
        <div className="adam-micro adam-muted">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="adam-micro adam-muted" style={{ fontStyle: "italic" }}>No runs recorded yet for this agent.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {runs.map((run) => (
            <div
              key={run.id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: "6px 10px",
                alignItems: "center",
                padding: "8px 10px",
                borderRadius: 8,
                background: "rgba(15,23,42,0.04)",
                border: "1px solid var(--v3-border-soft)",
              }}
            >
              {/* Status dot */}
              <span
                style={{
                  width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                  background: statusColor(run.status),
                  boxShadow: `0 0 4px ${statusColor(run.status)}88`,
                }}
              />
              {/* Info */}
              <div style={{ minWidth: 0 }}>
                <span className="adam-micro" style={{ color: statusColor(run.status), fontWeight: 600 }}>
                  {run.status}
                </span>
                {run.phase_id && run.phase_id !== "program" ? (
                  <span className="adam-micro adam-muted"> · {run.phase_id}</span>
                ) : null}
                {run.triggered_by ? (
                  <span className="adam-micro adam-muted"> · {run.triggered_by}</span>
                ) : null}
              </div>
              {/* Time */}
              <span className="adam-micro adam-muted" style={{ whiteSpace: "nowrap" }}>
                {timeAgo(run.created_at)}
              </span>
              {/* Confidence + tokens — span full row */}
              {(run.confidence !== null || run.tokens_used !== null) ? (
                <div style={{ gridColumn: "2 / 4", display: "flex", gap: 12 }}>
                  {run.confidence !== null ? (
                    <span className="adam-micro adam-muted">{(run.confidence * 100).toFixed(0)}% confidence</span>
                  ) : null}
                  {run.tokens_used !== null ? (
                    <span className="adam-micro adam-muted">{run.tokens_used.toLocaleString()} tokens</span>
                  ) : null}
                  {run.completed_at && run.created_at ? (
                    <span className="adam-micro adam-muted">
                      {Math.round((new Date(run.completed_at).getTime() - new Date(run.created_at).getTime()) / 1000)}s
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Agent Status panel (default tab) ────────────────────────────────────────

function AgentStatusPanel({ programId }: { programId: string }) {
  const [lastRuns, setLastRuns] = useState<AgentLastRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !programId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from("adam_agent_runs")
        .select("agent_id, status, completed_at, confidence, created_at")
        .eq("program_id", programId)
        .order("created_at", { ascending: false })
        .limit(400);

      if (!data) return;
      const seen = new Set<string>();
      const dedupe: AgentLastRun[] = [];
      for (const row of data) {
        if (seen.has(row.agent_id)) continue;
        seen.add(row.agent_id);
        dedupe.push({
          agentId: row.agent_id,
          status: row.status as AgentLastRun["status"],
          completedAt: row.completed_at || null,
          confidence: typeof row.confidence === "number" ? row.confidence : null,
        });
      }
      setLastRuns(dedupe);
    } finally {
      setLoading(false);
    }
  }, [programId]);

  useEffect(() => { void load(); }, [load]);

  const runMap = useMemo(() => {
    const map = new Map<string, AgentLastRun>();
    lastRuns.forEach((r) => map.set(r.agentId, r));
    return map;
  }, [lastRuns]);

  const total = AGENT_STATUS_GROUPS.flatMap((g) => g.agents).length;
  const green = AGENT_STATUS_GROUPS.flatMap((g) => g.agents).filter((a) => ryg(runMap.get(a)) === "green").length;
  const red   = AGENT_STATUS_GROUPS.flatMap((g) => g.agents).filter((a) => ryg(runMap.get(a)) === "red").length;
  const amber = AGENT_STATUS_GROUPS.flatMap((g) => g.agents).filter((a) => ryg(runMap.get(a)) === "amber").length;

  return (
    <div className="adam-stack">
      {/* Summary bar */}
      <div className="adam-card p-4" style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap", background: "rgba(15,23,42,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AgentStatusDot color="green" />
          <span className="adam-body">{green} up to date</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AgentStatusDot color="amber" />
          <span className="adam-body">{amber} pending / stale</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AgentStatusDot color="red" />
          <span className="adam-body">{red} failed</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span className="adam-micro adam-muted">{total} agents · click any card for history</span>
          <button type="button" className="adam-button-ghost" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Groups */}
      {AGENT_STATUS_GROUPS.map((group) => (
        <div key={group.label} className="adam-stack" style={{ gap: 8 }}>
          <div className="adam-micro adam-muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em", paddingTop: 4 }}>
            {group.label}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
            {group.agents.map((agentId) => {
              const run = runMap.get(agentId);
              const color = ryg(run);
              const borderColor = color === "green" ? "var(--v3-green)" : color === "red" ? "var(--v3-red)" : color === "blue" ? "#60a5fa" : "var(--v3-amber)";
              const description = AGENT_DESCRIPTIONS[agentId];
              const isExpanded = expandedAgent === agentId;

              return (
                <div
                  key={agentId}
                  className="adam-card p-3"
                  style={{
                    borderLeft: `3px solid ${borderColor}`,
                    cursor: "pointer",
                    transition: "box-shadow 120ms ease",
                    ...(isExpanded ? { boxShadow: `0 0 0 2px ${borderColor}44` } : {}),
                  }}
                  onClick={() => setExpandedAgent(isExpanded ? null : agentId)}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <AgentStatusDot color={color} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                        <div className="adam-title" style={{ fontSize: 12 }}>{prettyAgent(agentId)}</div>
                        <span style={{ fontSize: 10, color: "var(--v3-text-muted)", flexShrink: 0 }}>
                          {isExpanded ? "▲" : "▼"}
                        </span>
                      </div>
                      {description ? (
                        <div className="adam-micro adam-muted" style={{ marginTop: 2, lineHeight: 1.4 }}>{description}</div>
                      ) : null}
                      <div className="adam-micro" style={{ marginTop: 4, color: borderColor, fontWeight: 500 }}>
                        {RYG_LABEL[color]}
                        {run?.completedAt ? ` · ${timeAgo(run.completedAt)}` : ""}
                        {run?.confidence !== null && run?.confidence !== undefined ? ` · ${(run.confidence * 100).toFixed(0)}% conf` : ""}
                      </div>
                    </div>
                  </div>

                  {/* Drill-down: run history */}
                  {isExpanded ? (
                    <AgentDrillDown
                      programId={programId}
                      agentId={agentId}
                      onClose={(e?: React.MouseEvent) => { e?.stopPropagation(); setExpandedAgent(null); }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Standalone: Pattern Library ─────────────────────────────────────────────

const PATTERN_TYPES: Array<{ value: PatternLibraryEntry["patternType"] | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "risk", label: "Risks" },
  { value: "intervention", label: "Interventions" },
  { value: "milestone-sequence", label: "Milestone Sequences" },
  { value: "adoption-tactic", label: "Adoption Tactics" },
  { value: "gate-criteria", label: "Gate Criteria" },
];

function badgeToneForPattern(type: PatternLibraryEntry["patternType"]): string {
  if (type === "risk") return "amber";
  if (type === "intervention") return "blue";
  if (type === "milestone-sequence") return "green";
  if (type === "adoption-tactic") return "purple";
  return "slate";
}

function PatternSection({
  title,
  patterns,
  filter,
}: {
  title: string;
  patterns: PatternLibraryEntry[];
  filter: PatternLibraryEntry["patternType"] | "all";
}) {
  const filtered = filter === "all" ? patterns : patterns.filter((p) => p.patternType === filter);
  return (
    <section className="adam-stack">
      <div className="adam-row adam-space-between">
        <div className="adam-title">{title}</div>
        <span className="adam-micro adam-muted">{filtered.length} pattern{filtered.length === 1 ? "" : "s"}</span>
      </div>
      {filtered.length ? (
        <div className="adam-grid two">
          {filtered.map((pattern) => (
            <div
              key={pattern.id}
              className="adam-card adam-stack p-4"
              style={{ borderLeft: `4px solid ${pattern.patternType === "risk" ? "#d97706" : pattern.patternType === "milestone-sequence" ? "#16a34a" : pattern.patternType === "adoption-tactic" ? "#7c3aed" : "#2563eb"}` }}
            >
              <div className="adam-row adam-space-between" style={{ alignItems: "center", gap: 8 }}>
                <span className={`adam-badge ${badgeToneForPattern(pattern.patternType)}`}>{pattern.patternType}</span>
                <span className="adam-micro adam-muted">Used {pattern.usedCount}x</span>
              </div>
              <div className="adam-title">{pattern.title}</div>
              <div className="adam-body adam-muted">
                {typeof pattern.body.summary === "string" ? pattern.body.summary : JSON.stringify(pattern.body)}
              </div>
              <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
                {pattern.outcome ? <span className={`adam-badge ${pattern.outcome === "successful" ? "green" : pattern.outcome === "failed" ? "red" : "slate"}`}>{pattern.outcome}</span> : null}
                {pattern.phaseId ? <span className="adam-badge slate">{pattern.phaseId}</span> : null}
                {pattern.industry ? <span className="adam-badge slate">{pattern.industry}</span> : null}
              </div>
              <div className="adam-micro adam-muted">Confidence {(pattern.confidence * 100).toFixed(0)}% · Added {timeAgo(pattern.createdAt)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="adam-card p-5">
          <div className="adam-body adam-muted">No patterns available in this slice yet.</div>
        </div>
      )}
    </section>
  );
}

export function PatternLibraryView({ program }: { program: ProgramSummary | null }) {
  const [patternFilter, setPatternFilter] = useState<PatternLibraryEntry["patternType"] | "all">("all");
  const { currentProgramPatterns, similarPatterns, isLoading, refresh } = usePatternLibrary(
    program?.id || "",
    program?.industry || null,
  );

  if (!program) {
    return <EmptyState context="No program selected" explanation="Open a programme first." recommendation="Choose a programme from the portfolio." />;
  }

  return (
    <div className="adam-stack">
      <div className="adam-row adam-space-between" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div className="adam-stack" style={{ gap: 4 }}>
          <div className="adam-title">Organisation Pattern Library</div>
          <div className="adam-body adam-muted">Reusable patterns extracted from this and similar programs.</div>
        </div>
        <button type="button" className="adam-button-ghost" onClick={() => void refresh()}>Refresh</button>
      </div>
      <div className="adam-row" style={{ flexWrap: "wrap" }}>
        {PATTERN_TYPES.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`adam-chip ${patternFilter === option.value ? "is-active" : ""}`}
            onClick={() => setPatternFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="adam-card p-5"><div className="adam-body adam-muted">Loading patterns…</div></div>
      ) : (
        <>
          <PatternSection title="Extracted from this program" patterns={currentProgramPatterns} filter={patternFilter} />
          <PatternSection title="From similar programs" patterns={similarPatterns} filter={patternFilter} />
        </>
      )}
    </div>
  );
}

// ─── Standalone: Agent Activity ───────────────────────────────────────────────

function badgeToneForEvent(type: AgentEventSummary["eventType"]): string {
  if (type === "completed") return "green";
  if (type === "failed") return "red";
  if (type === "stale") return "amber";
  return "blue";
}

export function AgentActivityView({ program }: { program: ProgramSummary | null }) {
  const { events, runningAgentIds, isLoading, refresh } = useAgentEvents(program?.id || "");

  if (!program) {
    return <EmptyState context="No program selected" explanation="Open a programme first." recommendation="Choose a programme from the portfolio." />;
  }

  return (
    <div className="adam-stack">
      <div className="adam-row adam-space-between" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div className="adam-stack" style={{ gap: 4 }}>
          <div className="adam-title">Agent Activity</div>
          <div className="adam-body adam-muted">Realtime event feed across the programme.</div>
        </div>
        <div className="adam-row" style={{ gap: 8, alignItems: "center" }}>
          {runningAgentIds.length ? (
            <span className="adam-badge blue">
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: "#60a5fa", marginRight: 6, boxShadow: "0 0 0 6px rgba(96,165,250,0.18)" }} />
              {runningAgentIds.length} live
            </span>
          ) : null}
          <button type="button" className="adam-button-ghost" onClick={() => void refresh()}>Refresh</button>
        </div>
      </div>
      {isLoading ? (
        <div className="adam-card p-5"><div className="adam-body adam-muted">Loading events…</div></div>
      ) : events.length ? (
        <div className="adam-stack">
          {events.map((event) => (
            <div key={event.id} className="adam-card p-4">
              <div className="adam-row adam-space-between" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div className="adam-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div className="adam-title">{prettyAgent(event.agentId)}</div>
                  <span className={`adam-badge ${badgeToneForEvent(event.eventType)}`}>{event.eventType}</span>
                  {event.phaseId ? <span className="adam-badge slate">{event.phaseId}</span> : null}
                </div>
                <div className="adam-micro adam-muted">{timeAgo(event.createdAt)}</div>
              </div>
              {event.payload ? (
                <div className="mt-3 adam-body adam-muted">
                  {typeof event.payload.summary === "string"
                    ? event.payload.summary
                    : typeof event.payload.reason === "string"
                      ? event.payload.reason
                      : typeof event.payload.error === "string"
                        ? event.payload.error
                        : JSON.stringify(event.payload)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="adam-card p-5">
          <div className="adam-body adam-muted">No agent events recorded yet for this programme.</div>
        </div>
      )}
    </div>
  );
}

// ─── Standalone: Artifact History ────────────────────────────────────────────

function JSONBlock({ value }: { value: Record<string, unknown> }) {
  return (
    <pre className="adam-card p-4" style={{ overflowX: "auto", whiteSpace: "pre-wrap", background: "rgba(15,23,42,0.45)", fontSize: 12 }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function ArtifactHistoryView({
  program,
  onRefreshProgram,
}: {
  program: ProgramSummary | null;
  onRefreshProgram?: () => Promise<void> | void;
}) {
  const [expandedArtifactId, setExpandedArtifactId] = useState<string>("");
  const [selectedDiffAgent, setSelectedDiffAgent] = useState<string>("narrative");
  const { artifacts, isLoading, isRestoring, restoreArtifact, refresh } = useArtifactHistory(
    program?.id || "",
    onRefreshProgram,
  );

  const groupedArtifacts = useMemo(() => {
    return artifacts.reduce<Record<string, ArtifactVersionSummary[]>>((acc, artifact) => {
      acc[artifact.agentId] = [...(acc[artifact.agentId] || []), artifact].sort((a, b) => b.version - a.version);
      return acc;
    }, {});
  }, [artifacts]);

  const diffPair = useMemo(() => {
    const versions = groupedArtifacts[selectedDiffAgent] || [];
    if (versions.length < 2) return null;
    return { current: versions[0], previous: versions[1] };
  }, [groupedArtifacts, selectedDiffAgent]);

  if (!program) {
    return <EmptyState context="No program selected" explanation="Open a programme first." recommendation="Choose a programme from the portfolio." />;
  }

  return (
    <div className="adam-stack">
      <div className="adam-row adam-space-between" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div className="adam-stack" style={{ gap: 4 }}>
          <div className="adam-title">Artifact History</div>
          <div className="adam-body adam-muted">Versioned agent outputs with restore support.</div>
        </div>
        <button type="button" className="adam-button-ghost" onClick={() => void refresh()}>Refresh</button>
      </div>
      {isLoading ? (
        <div className="adam-card p-5"><div className="adam-body adam-muted">Loading artifacts…</div></div>
      ) : Object.keys(groupedArtifacts).length ? (
        <>
          <div className="adam-grid two">
            {Object.entries(groupedArtifacts).map(([agentId, versions]) => {
              const current = versions[0];
              const previous = versions[1];
              const confidenceDelta = current && previous && current.confidence !== null && previous.confidence !== null
                ? current.confidence - previous.confidence : null;
              const expanded = expandedArtifactId === agentId;
              return (
                <div key={agentId} className="adam-card adam-stack p-4">
                  <div className="adam-row adam-space-between" style={{ alignItems: "center", gap: 12 }}>
                    <div>
                      <div className="adam-title">{prettyAgent(agentId)}</div>
                      <div className="adam-micro adam-muted">
                        {versions.length} version{versions.length === 1 ? "" : "s"} · Latest {timeAgo(current.generatedAt)}
                      </div>
                    </div>
                    <span className="adam-badge slate">v{current.version}</span>
                  </div>
                  <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    {current.confidence !== null ? <span className="adam-badge blue">Confidence {(current.confidence * 100).toFixed(0)}%</span> : null}
                    {confidenceDelta !== null ? (
                      <span className={`adam-badge ${confidenceDelta >= 0 ? "green" : "amber"}`}>Δ {(confidenceDelta * 100).toFixed(0)} pts</span>
                    ) : null}
                  </div>
                  <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="adam-button-ghost" onClick={() => setExpandedArtifactId(expanded ? "" : agentId)}>
                      {expanded ? "Hide history" : "View history"}
                    </button>
                    {versions.slice(1).length ? (
                      <button type="button" className="adam-button" onClick={() => void restoreArtifact(versions[1].id)} disabled={isRestoring}>
                        Restore prior
                      </button>
                    ) : null}
                  </div>
                  {expanded ? (
                    <div className="adam-stack" style={{ gap: 8 }}>
                      {versions.map((version) => (
                        <div key={version.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                          <div className="adam-row adam-space-between" style={{ alignItems: "center", gap: 8 }}>
                            <div className="adam-title">v{version.version}</div>
                            <div className="adam-micro adam-muted">{timeAgo(version.generatedAt)}</div>
                          </div>
                          <div className="mt-2 adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
                            {version.phaseId ? <span className="adam-badge slate">{version.phaseId}</span> : null}
                            {version.confidence !== null ? <span className="adam-badge blue">{(version.confidence * 100).toFixed(0)}%</span> : null}
                            {version.version !== current.version ? (
                              <button type="button" className="adam-button-ghost" onClick={() => void restoreArtifact(version.id)} disabled={isRestoring}>
                                Restore
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="adam-card adam-stack p-5">
            <div className="adam-row adam-space-between" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div className="adam-title">JSON Diff</div>
                <div className="adam-body adam-muted">Side-by-side comparison for recent agent artifacts.</div>
              </div>
              <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
                {["narrative", "plan"].map((agentId) => (
                  <button key={agentId} type="button" className={`adam-chip ${selectedDiffAgent === agentId ? "is-active" : ""}`} onClick={() => setSelectedDiffAgent(agentId)}>
                    {prettyAgent(agentId)}
                  </button>
                ))}
              </div>
            </div>
            {diffPair ? (
              <div className="adam-grid two">
                <div className="adam-stack"><div className="adam-title">Current</div><JSONBlock value={diffPair.current.content} /></div>
                <div className="adam-stack"><div className="adam-title">Previous</div><JSONBlock value={diffPair.previous.content} /></div>
              </div>
            ) : (
              <div className="adam-body adam-muted">Not enough versions to compare yet.</div>
            )}
          </div>
        </>
      ) : (
        <div className="adam-card p-5"><div className="adam-body adam-muted">No artifact history recorded yet.</div></div>
      )}
    </div>
  );
}

// ─── AI Settings tabs: Agents / Provider / Autonomy ──────────────────────────

const TABS = ["Status", "Setup"] as const;
type AISettingsTab = typeof TABS[number];

type AIProviderId = "anthropic" | "openai" | "google";
type AIProviderStatus = { configured: boolean; active: boolean; model: string | null; updatedAt: string | null };

const AI_PROVIDERS: Array<{
  id: AIProviderId;
  label: string;
  description: string;
  placeholder: string;
  runtimeReady: boolean;
  models: Array<{ id: string; label: string; description: string }>;
}> = [
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Recommended for ATOS agents today. Supports the deployed Claude runtime.",
    placeholder: "sk-ant-...",
    runtimeReady: true,
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", description: "Best default for high-quality agent reasoning." },
      { id: "claude-opus-4-1",   label: "Claude Opus 4.1",   description: "Highest reasoning depth for complex programme work." },
      { id: "claude-haiku-4-5",  label: "Claude Haiku 4.5",  description: "Faster, lower-cost runs for lightweight tasks." },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "Use OpenAI chat models for ATOS agent runs.",
    placeholder: "sk-...",
    runtimeReady: true,
    models: [
      { id: "gpt-4o",      label: "GPT-4o",      description: "Balanced default for reliable agent output." },
      { id: "gpt-4.1",     label: "GPT-4.1",     description: "Strong instruction following and structured output." },
      { id: "gpt-4o-mini", label: "GPT-4o mini", description: "Fast, economical agent runs." },
    ],
  },
  {
    id: "google",
    label: "Google Gemini",
    description: "Use Gemini models for ATOS agent runs.",
    placeholder: "AIza...",
    runtimeReady: true,
    models: [
      { id: "gemini-1.5-pro",   label: "Gemini 1.5 Pro",   description: "Best Gemini default for complex context." },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", description: "Fast Gemini runs for lighter tasks." },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", description: "Newer fast model where enabled on the key." },
    ],
  },
];

interface IntelligenceViewProps {
  program: ProgramSummary | null;
  onRefreshProgram?: () => Promise<void> | void;
  initialTab?: AISettingsTab;
}

export function IntelligenceView({ program, onRefreshProgram, initialTab }: IntelligenceViewProps) {
  const [tab, setTab] = useState<AISettingsTab>("Status");
  // Sync to initialTab whenever it changes (e.g. Agents nav → "Status", AI nav → "Setup")
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);

  // Provider state
  const [selectedProvider, setSelectedProvider] = useState<AIProviderId>("anthropic");
  const [selectedProviderModel, setSelectedProviderModel] = useState("claude-sonnet-4-6");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerKeyVisible, setProviderKeyVisible] = useState(false);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [providerStatuses, setProviderStatuses] = useState<Record<AIProviderId, AIProviderStatus>>({
    anthropic: { configured: false, active: false, model: null, updatedAt: null },
    openai:    { configured: false, active: false, model: null, updatedAt: null },
    google:    { configured: false, active: false, model: null, updatedAt: null },
  });
  const [providerUpdatedAt, setProviderUpdatedAt] = useState<string | null>(null);
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerMessage, setProviderMessage] = useState<string | null>(null);

  const providerMeta = AI_PROVIDERS.find((p) => p.id === selectedProvider) ?? AI_PROVIDERS[0];
  const selectedProviderStatus = providerStatuses[selectedProvider];
  const selectedModelMeta = providerMeta.models.find((m) => m.id === selectedProviderModel) ?? providerMeta.models[0];
  const activeProvider = AI_PROVIDERS.find((p) => providerStatuses[p.id]?.active);
  const activeProviderStatus = activeProvider ? providerStatuses[activeProvider.id] : null;

  const refreshProviderSettings = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setProviderMessage("Cloud connection is not configured."); return; }
    setProviderLoading(true);
    setProviderMessage(null);
    try {
      const entries = await Promise.all(AI_PROVIDERS.map(async (provider) => {
        const { data, error } = await supabase.functions.invoke("configure-ai-settings", { body: { action: "status", provider: provider.id } });
        if (error) throw error;
        const result = data as { configured?: boolean; active?: boolean; model?: string | null; updatedAt?: string | null };
        return [provider.id, { configured: Boolean(result.configured), active: Boolean(result.active), model: result.model || provider.models[0].id, updatedAt: result.updatedAt || null }] as const;
      }));
      const nextStatuses = Object.fromEntries(entries) as Record<AIProviderId, AIProviderStatus>;
      setProviderStatuses(nextStatuses);
      setProviderConfigured(Boolean(nextStatuses[selectedProvider]?.configured));
      setSelectedProviderModel(nextStatuses[selectedProvider]?.model || providerMeta.models[0].id);
      setProviderUpdatedAt(nextStatuses[selectedProvider]?.updatedAt || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("session") || msg.includes("401") || msg.includes("verified") || msg.includes("auth")) {
        setProviderMessage("Session expired — refresh the page and sign in to load AI settings.");
      } else {
        setProviderMessage(msg || "Could not load AI provider settings.");
      }
    } finally {
      setProviderLoading(false);
    }
  }, [selectedProvider, providerMeta.models]);

  useEffect(() => {
    if (tab === "Setup") {
      setProviderApiKey("");
      // Always reset model to the selected provider's first model when provider changes
      setSelectedProviderModel(providerMeta.models[0].id);
      void refreshProviderSettings();
    }
  }, [tab, selectedProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveProviderSettings = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setProviderMessage("Cloud connection is not configured."); return; }
    if (!providerMeta.runtimeReady) { setProviderMessage(`${providerMeta.label} is not connected to the ATOS agent runtime yet.`); return; }
    const trimmedKey = providerApiKey.trim();
    if (!trimmedKey && !providerConfigured) { setProviderMessage(`Enter a ${providerMeta.label} API key.`); return; }
    setProviderSaving(true);
    setProviderMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("configure-ai-settings", { body: { action: "save", provider: selectedProvider, model: selectedProviderModel, apiKey: trimmedKey || undefined } });
      if (error) throw error;
      const result = data as { configured?: boolean; active?: boolean; model?: string | null; updatedAt?: string | null };
      setProviderConfigured(Boolean(result.configured));
      if (result.model) setSelectedProviderModel(result.model);
      setProviderUpdatedAt(result.updatedAt || new Date().toISOString());
      setProviderStatuses((curr) => ({
        anthropic: { ...curr.anthropic, active: false },
        openai:    { ...curr.openai,    active: false },
        google:    { ...curr.google,    active: false },
        [selectedProvider]: { configured: true, active: true, model: result.model || selectedProviderModel, updatedAt: result.updatedAt || new Date().toISOString() },
      }));
      setProviderApiKey("");
      setProviderMessage(`${providerMeta.label} settings saved.`);
      window.dispatchEvent(new CustomEvent(AI_SETTINGS_SAVED_EVENT));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("session") || msg.includes("401") || msg.includes("verified") || msg.includes("auth")) {
        setProviderMessage("Session expired — please refresh the page and sign in again to save AI settings.");
      } else {
        setProviderMessage(msg || "Could not save AI provider settings.");
      }
    } finally {
      setProviderSaving(false);
    }
  }, [providerApiKey, providerConfigured, providerMeta, selectedProvider, selectedProviderModel]);

  const pauseOrResumeProvider = useCallback(async (action: "pause" | "resume") => {
    if (!isSupabaseConfigured || !supabase) return;
    setProviderSaving(true);
    setProviderMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("configure-ai-settings", {
        body: { action, provider: selectedProvider },
      });
      if (error) throw error;
      const result = data as { active?: boolean; configured?: boolean } | null;
      setProviderStatuses((curr) => ({
        ...curr,
        [selectedProvider]: { ...curr[selectedProvider], active: Boolean(result?.active) },
      }));
      setProviderMessage(action === "pause" ? `${providerMeta.label} paused. Agents will not use this provider until resumed.` : `${providerMeta.label} resumed as the active runtime.`);
      window.dispatchEvent(new CustomEvent(AI_SETTINGS_SAVED_EVENT));
    } catch (err) {
      setProviderMessage(err instanceof Error ? err.message : `Could not ${action} provider.`);
    } finally {
      setProviderSaving(false);
    }
  }, [selectedProvider, providerMeta.label]);

  const pasteProviderKey = useCallback(async () => {
    if (!navigator.clipboard?.readText) { setProviderMessage("Clipboard access unavailable. Use Cmd+V in the key field."); return; }
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { setProviderMessage("Clipboard is empty."); return; }
      setProviderApiKey(text.trim());
      setProviderMessage("Key pasted. Review it, then save.");
    } catch {
      setProviderMessage("Clipboard permission was blocked. Click into the key field and press Cmd+V.");
    }
  }, []);

  if (!program) {
    return (
      <EmptyState
        context="No programme selected"
        explanation="Choose a programme before opening AI Settings."
        recommendation="Select a programme from the portfolio."
      />
    );
  }

  return (
    <div className="adam-stack">
      {/* Tab strip */}
      <div className="adam-row" style={{ flexWrap: "wrap" }}>
        {TABS.map((item) => (
          <button key={item} type="button" className={`adam-chip ${tab === item ? "is-active" : ""}`} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </div>

      {/* ── Status (RYG) ── */}
      {tab === "Status" ? <AgentStatusPanel programId={program.id} /> : null}

      {/* ── Setup (provider config) ── */}
      {tab === "Setup" ? (
        <div className="adam-stack">
          <div className="adam-card p-5" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.16), rgba(44,200,77,0.08) 44%, rgba(15,23,42,0.04))" }}>
            <div className="adam-row adam-space-between" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div className="adam-stack" style={{ gap: 4 }}>
                <div className="adam-micro adam-muted">AI PROVIDER</div>
                <div className="adam-title">Choose how ATOS agents think</div>
                <div className="adam-body adam-muted">
                  {activeProvider
                    ? `${activeProvider.label} is the active runtime${activeProviderStatus?.model ? ` · ${activeProvider.models.find((m) => m.id === activeProviderStatus.model)?.label || activeProviderStatus.model}` : ""}${activeProviderStatus?.updatedAt ? ` · updated ${timeAgo(activeProviderStatus.updatedAt)}` : ""}`
                    : "No AI provider is connected yet. Connect one to enable ATOS agent runs."}
                </div>
              </div>
              <span className={`adam-badge ${activeProvider ? "green" : "amber"}`}>
                {providerLoading ? "checking" : activeProvider ? "runtime connected" : "setup required"}
              </span>
            </div>
          </div>

          <div className="adam-card p-5">
            <div className="adam-stack" style={{ gap: 18 }}>
              <div className="adam-stack" style={{ gap: 8 }}>
                <span className="adam-micro adam-muted">AI provider</span>
                <div className="adam-grid three">
                  {AI_PROVIDERS.map((provider) => {
                    const selected = provider.id === selectedProvider;
                    const status = providerStatuses[provider.id];
                    const modelLabel = provider.models.find((m) => m.id === status.model)?.label || status.model;
                    const badgeTone = status.active ? "green" : status.configured ? "amber" : "slate";
                    const badgeLabel = status.active ? "active" : status.configured ? "paused" : "not connected";
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        className={`adam-card p-4 adam-stack ${selected ? "is-active" : ""}`}
                        style={{ gap: 10, textAlign: "left", borderColor: status.active ? "rgba(44,200,77,0.72)" : selected ? "var(--adam-accent)" : undefined, background: status.active ? "rgba(44,200,77,0.12)" : selected ? "rgba(99,102,241,0.12)" : undefined }}
                        onClick={() => { setSelectedProvider(provider.id); setProviderMessage(null); }}
                      >
                        <div className="adam-row adam-space-between" style={{ gap: 8, alignItems: "center" }}>
                          <span className="adam-title">{provider.label}</span>
                          <span className={`adam-badge ${badgeTone}`}>{badgeLabel}</span>
                        </div>
                        <span className="adam-micro adam-muted">{provider.description}</span>
                        <div className="adam-stack" style={{ gap: 4 }}>
                          <span className="adam-micro">Model: {status.configured ? modelLabel : provider.models[0].label}</span>
                          <span className="adam-micro adam-muted">
                            {status.configured
                              ? `${status.active ? "Used for new agent runs" : "Paused — key saved, not active"}${status.updatedAt ? ` · ${timeAgo(status.updatedAt)}` : ""}`
                              : "Add a key to connect this provider"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="adam-stack" style={{ gap: 10 }}>
                <div className="adam-card p-4" style={{ background: selectedProviderStatus.active ? "rgba(44,200,77,0.08)" : selectedProviderStatus.configured ? "rgba(59,130,246,0.08)" : "rgba(245,158,11,0.08)", borderColor: selectedProviderStatus.active ? "rgba(44,200,77,0.24)" : selectedProviderStatus.configured ? "rgba(59,130,246,0.24)" : "rgba(245,158,11,0.24)" }}>
                  <div className="adam-row adam-space-between" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <div className="adam-stack" style={{ gap: 4 }}>
                      <div className="adam-title">{providerMeta.label} settings</div>
                      <div className="adam-body adam-muted">
                        {selectedProviderStatus.active
                          ? "Connected and used for new ATOS agent runs."
                          : selectedProviderStatus.configured
                          ? "Paused — key is saved but agents are not using this provider. Resume to activate."
                          : "Not connected yet. Add an API key to activate."}
                      </div>
                    </div>
                    <span className={`adam-badge ${selectedProviderStatus.active ? "green" : selectedProviderStatus.configured ? "amber" : "amber"}`}>
                      {selectedProviderStatus.active ? "active" : selectedProviderStatus.configured ? "paused" : "not connected"}
                    </span>
                  </div>
                </div>

                <label className="adam-stack" style={{ gap: 8 }}>
                  <span className="adam-micro adam-muted">{providerMeta.label} model</span>
                  <select className="adam-select" value={selectedProviderModel} onChange={(e) => { setSelectedProviderModel(e.target.value); setProviderMessage(null); }}>
                    {providerMeta.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select>
                  <span className="adam-micro adam-muted">{selectedModelMeta.description}</span>
                </label>

                <label className="adam-stack" style={{ gap: 8 }}>
                  <span className="adam-micro adam-muted">{providerMeta.label} API key</span>
                  <div className="adam-row" style={{ gap: 8, alignItems: "stretch" }}>
                    <input
                      type={providerKeyVisible ? "text" : "password"}
                      value={providerApiKey}
                      onChange={(e) => setProviderApiKey(e.target.value)}
                      onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t) { e.preventDefault(); setProviderApiKey(t.trim()); setProviderMessage("Key pasted. Review it, then save."); } }}
                      placeholder={providerConfigured ? "Paste a new key to replace the current one" : providerMeta.placeholder}
                      className="adam-input"
                      autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    />
                    <button type="button" className="adam-button-ghost" onClick={() => setProviderKeyVisible((v) => !v)}>{providerKeyVisible ? "Hide" : "Show"}</button>
                    <button type="button" className="adam-button-ghost" onClick={() => void pasteProviderKey()}>Paste key</button>
                  </div>
                </label>

                <div className="adam-card p-4" style={{ background: "rgba(44,200,77,0.08)", borderColor: "rgba(44,200,77,0.22)" }}>
                  <div className="adam-body">
                    Saving this key makes {providerMeta.label} with {selectedModelMeta.label} the active runtime for ATOS agent runs. The key is stored server-side and never exposed back to the browser.
                  </div>
                </div>
              </div>

              {providerMessage ? (
                <div className={`adam-body ${providerMessage.toLowerCase().includes("paused") ? "adam-muted" : providerMessage.toLowerCase().includes("resumed") || providerMessage.toLowerCase().includes("saved") ? "" : "adam-muted"}`}
                  style={{ color: providerMessage.toLowerCase().includes("paused") ? "var(--adam-amber, #f59e0b)" : providerMessage.toLowerCase().includes("resumed") || providerMessage.toLowerCase().includes("saved") ? "var(--adam-green, #2cc84d)" : undefined }}
                >
                  {providerMessage}
                </div>
              ) : null}
              <div className="adam-row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" className="adam-button" onClick={() => void saveProviderSettings()} disabled={providerSaving}>
                  {providerSaving ? "Saving..." : providerConfigured ? "Save model selection" : `Connect ${providerMeta.label}`}
                </button>
                {selectedProviderStatus.configured && (
                  selectedProviderStatus.active ? (
                    <button
                      type="button"
                      className="adam-button-ghost"
                      onClick={() => void pauseOrResumeProvider("pause")}
                      disabled={providerSaving}
                      title={`Pause ${providerMeta.label} — agents will stop using this provider until resumed`}
                    >
                      ⏸ Pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="adam-button-ghost"
                      onClick={() => void pauseOrResumeProvider("resume")}
                      disabled={providerSaving}
                      title={`Resume ${providerMeta.label} as the active AI runtime`}
                    >
                      ▶ Resume
                    </button>
                  )
                )}
                <button type="button" className="adam-button-ghost" onClick={() => void refreshProviderSettings()} disabled={providerLoading}>
                  Refresh status
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
