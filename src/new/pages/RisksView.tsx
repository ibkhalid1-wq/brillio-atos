import React, { useState } from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import { AgentPulse } from "@/new/components/ui/AgentPulse";
import { useRaidLog } from "@/new/lib/useRaidLog";
import type { ProgramSummary, RAIDEntry, RAIDEntryType } from "@/new/types";
import { confidenceLabel, confidenceTone, pushV3Toast } from "@/v3/utils";

interface RisksViewProps {
  program: ProgramSummary | null;
  raidAgentRunning: boolean;
  onTriggerRiskAgent: () => void;
  onRefresh: () => Promise<void>;
}

const TYPE_LABELS: Record<RAIDEntryType, string> = {
  risk: "Risk",
  blocker: "Blocker",
  assumption: "Assumption",
  dependency: "Dependency",
};

const TYPE_BADGE: Record<RAIDEntryType, string> = {
  risk: "red",
  blocker: "amber",
  assumption: "blue",
  dependency: "slate",
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "red",
  high: "amber",
  medium: "blue",
  low: "slate",
};

const EMPTY_FORM = {
  type: "risk" as RAIDEntryType,
  title: "",
  description: "",
  severity: "medium" as RAIDEntry["severity"],
  phase: "",
  owner: "",
  mitigation: "",
};

function getPhaseName(program: ProgramSummary, phaseId: string): string {
  return program.phases.find((phase) => phase.id === phaseId)?.displayName || phaseId;
}

function raidConfidence(program: ProgramSummary): number | null {
  const raw = program.rawData || {};
  const inner = typeof raw.data === "object" && raw.data !== null && !Array.isArray(raw.data)
    ? raw.data as Record<string, unknown>
    : raw;
  const raidLog = typeof inner.raidLog === "object" && inner.raidLog !== null && !Array.isArray(inner.raidLog)
    ? inner.raidLog as Record<string, unknown>
    : null;
  return typeof raidLog?.confidence === "number" ? raidLog.confidence : null;
}

function exportRaidCsv(entries: RAIDEntry[], programName: string) {
  const headers = ["ID", "Type", "Title", "Severity", "Phase", "Owner", "Status", "Mitigation"];
  const rows = entries.map((entry) => [
    entry.id,
    entry.type,
    `"${(entry.title || "").replace(/"/g, "\"\"")}"`,
    entry.severity || "",
    entry.phase || "",
    entry.owner || "",
    entry.status || "",
    `"${(entry.mitigation || "").replace(/"/g, "\"\"")}"`,
  ].join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${programName}-raid-log.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function RisksView({
  program,
  raidAgentRunning,
  onTriggerRiskAgent,
  onRefresh,
}: RisksViewProps) {
  const [typeFilter, setTypeFilter] = useState<RAIDEntryType | "all">("all");
  const [showClosed, setShowClosed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closureNote, setClosureNote] = useState("");

  const { closeEntry, reopenEntry, addEntry, isSaving } = useRaidLog(
    program?.id ?? "",
    program?.rawData ?? {},
    onRefresh,
  );

  if (!program) {
    return (
      <NotReadyCard
        title="Risks & blockers"
        reason="No active program. Connect Supabase and select a program to begin."
      />
    );
  }

  const entries = program.raidEntries ?? [];

  if (entries.length === 0 && !raidAgentRunning) {
    return (
      <div className="adam-stack" style={{ maxWidth: 800 }}>
        <NotReadyCard
          title="Risks & blockers"
          reason="ATOS needs at least one phase with measurable progress before it can scan for risks and blockers."
          onTrigger={onTriggerRiskAgent}
          triggerLabel="Scan for risks"
          isRunning={raidAgentRunning}
        />
      </div>
    );
  }

  const filtered = entries
    .filter((entry) => {
      if (typeFilter !== "all" && entry.type !== typeFilter) return false;
      if (!showClosed && entry.status === "closed") return false;
      return true;
    })
    .sort((left, right) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      if (left.status !== right.status) return left.status === "closed" ? 1 : -1;
      return (severityOrder[left.severity] ?? 3) - (severityOrder[right.severity] ?? 3);
    });

  const openCount = entries.filter((entry) => entry.status === "open").length;
  const activeCount = entries.filter((entry) => entry.status !== "closed").length;
  const criticalCount = entries.filter((entry) => entry.status !== "closed" && entry.severity === "critical").length;
  const monitoringCount = entries.filter((entry) => entry.status === "monitoring").length;
  const humanCount = entries.filter((entry) => entry.status !== "closed" && entry.source === "human").length;
  const closedCount = entries.filter((entry) => entry.status === "closed").length;
  const confidence = raidConfidence(program);

  const submitAdd = async () => {
    if (!form.title.trim()) return;
    try {
      await addEntry({
        ...form,
        owner: form.owner || undefined,
        mitigation: form.mitigation || undefined,
      });
      setForm(EMPTY_FORM);
      setAddOpen(false);
    } catch {
      pushV3Toast("Could not save entry. Try again.", { tone: "error", duration: 4000 });
    }
  };

  const submitClose = async (entryId: string) => {
    try {
      await closeEntry(entryId, closureNote || undefined);
      setClosingId(null);
      setClosureNote("");
    } catch {
      pushV3Toast("Could not save entry. Try again.", { tone: "error", duration: 4000 });
    }
  };

  return (
    <div className="adam-stack" style={{ maxWidth: 960 }}>
      <div className="adam-card adam-risk-hero p-5">
        <div className="adam-row adam-space-between adam-risk-hero-top">
          <div className="adam-stack adam-risk-hero-copy">
            <div className="adam-micro adam-risk-eyebrow">Program watchlist</div>
            <div className="adam-heading-xl">Risks &amp; Blockers</div>
            {confidence !== null ? (
              <div>
                <span className={`v3-chip ${confidenceTone(confidence)}`} title={confidenceLabel(confidence)}>
                  {Math.round(confidence * 100)}% confidence
                </span>
              </div>
            ) : null}
            <div className="adam-body adam-muted adam-risk-hero-summary">
              {activeCount} active items across the program watchlist.{" "}
              {criticalCount > 0 ? `${criticalCount} require immediate attention.` : "No critical items are currently open."}
            </div>
          </div>
          <div className="adam-row adam-risk-hero-actions">
            {raidAgentRunning ? (
              <div className="adam-row adam-risk-agent-state">
                <AgentPulse status="running" size="sm" />
                <span className="adam-micro adam-muted">Agent scanning…</span>
              </div>
            ) : (
              <button type="button" className="adam-button-ghost" onClick={onTriggerRiskAgent}>
                Re-scan with ATOS
              </button>
            )}
            <button type="button" className="adam-button" onClick={() => setAddOpen(true)}>
              + Add manually
            </button>
            <button type="button" className="v3-export-btn" onClick={() => exportRaidCsv(program.raidEntries || [], program.name || "program")}>
              Export CSV
            </button>
          </div>
        </div>

        <div className="adam-grid adam-risk-kpis">
          <div className="adam-kpi adam-risk-kpi">
            <div className="adam-micro adam-muted">Open now</div>
            <div className="adam-heading-lg">{openCount}</div>
            <div className="adam-micro adam-muted">Items awaiting active resolution</div>
          </div>
          <div className="adam-kpi adam-risk-kpi is-critical">
            <div className="adam-micro adam-muted">Critical exposure</div>
            <div className="adam-heading-lg">{criticalCount}</div>
            <div className="adam-micro adam-muted">
              {criticalCount > 0 ? "Escalate within the current operating cycle" : "No immediate escalations detected"}
            </div>
          </div>
          <div className="adam-kpi adam-risk-kpi">
            <div className="adam-micro adam-muted">Monitoring</div>
            <div className="adam-heading-lg">{monitoringCount}</div>
            <div className="adam-micro adam-muted">Tracked items that remain under watch</div>
          </div>
          <div className="adam-kpi adam-risk-kpi">
            <div className="adam-micro adam-muted">Human-owned</div>
            <div className="adam-heading-lg">{humanCount}</div>
            <div className="adam-micro adam-muted">
              {closedCount > 0 ? `${closedCount} archived items retained for context` : "No archived items yet"}
            </div>
          </div>
        </div>

        <div className="adam-risk-hero-footer adam-micro adam-muted">
          {program.raidGeneratedAt
            ? `Last scanned by ATOS: ${new Date(program.raidGeneratedAt).toLocaleString()}`
            : "ATOS scan has not run yet. Manual entries will still be preserved."}
        </div>
      </div>

      {addOpen ? (
        <div className="adam-card adam-risk-form p-5">
          <div className="adam-row adam-space-between adam-risk-form-header">
            <div className="adam-stack" style={{ gap: 6 }}>
              <div className="adam-title">Add risk or blocker</div>
              <div className="adam-body adam-muted">
                Capture a program signal with clear ownership, severity, and mitigation so it enters the operating rhythm cleanly.
              </div>
            </div>
            <button
              type="button"
              className="adam-button-ghost"
              onClick={() => {
                setAddOpen(false);
                setForm(EMPTY_FORM);
              }}
            >
              Close
            </button>
          </div>
          <div className="adam-grid two adam-risk-form-grid">
            <div className="adam-stack" style={{ gap: 6 }}>
              <label className="adam-micro adam-muted">Type</label>
              <select
                className="adam-select"
                value={form.type}
                onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as RAIDEntryType }))}
              >
                <option value="risk">Risk</option>
                <option value="blocker">Blocker</option>
                <option value="assumption">Assumption</option>
                <option value="dependency">Dependency</option>
              </select>
            </div>
            <div className="adam-stack" style={{ gap: 6 }}>
              <label className="adam-micro adam-muted">Severity</label>
              <select
                className="adam-select"
                value={form.severity}
                onChange={(event) => setForm((current) => ({ ...current, severity: event.target.value as RAIDEntry["severity"] }))}
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <div className="adam-stack adam-risk-form-field">
            <label className="adam-micro adam-muted">Title *</label>
            <input
              className="adam-input"
              placeholder="Brief title…"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            />
          </div>
          <div className="adam-stack adam-risk-form-field">
            <label className="adam-micro adam-muted">Description</label>
            <textarea
              className="adam-textarea"
              rows={2}
              placeholder="What is the risk or blocker?"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </div>
          <div className="adam-grid two adam-risk-form-grid">
            <div className="adam-stack" style={{ gap: 6 }}>
              <label className="adam-micro adam-muted">Phase</label>
              <select
                className="adam-select"
                value={form.phase}
                onChange={(event) => setForm((current) => ({ ...current, phase: event.target.value }))}
              >
                <option value="">— Select phase —</option>
                {program.phases.map((phase) => (
                  <option key={phase.id} value={phase.id}>{phase.displayName}</option>
                ))}
              </select>
            </div>
            <div className="adam-stack" style={{ gap: 6 }}>
              <label className="adam-micro adam-muted">Owner</label>
              <input
                className="adam-input"
                placeholder="Owner name or role…"
                value={form.owner}
                onChange={(event) => setForm((current) => ({ ...current, owner: event.target.value }))}
              />
            </div>
          </div>
          <div className="adam-stack adam-risk-form-field">
            <label className="adam-micro adam-muted">Mitigation / resolution path</label>
            <input
              className="adam-input"
              placeholder="How should this be resolved?"
              value={form.mitigation}
              onChange={(event) => setForm((current) => ({ ...current, mitigation: event.target.value }))}
            />
          </div>
          <div className="adam-row adam-risk-form-actions">
            <button type="button" className="adam-button" onClick={() => void submitAdd()} disabled={isSaving || !form.title.trim()}>
              {isSaving ? "Saving…" : "Add entry"}
            </button>
            <button
              type="button"
              className="adam-button-ghost"
              onClick={() => {
                setAddOpen(false);
                setForm(EMPTY_FORM);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="adam-card adam-risk-toolbar p-4">
        <div className="adam-row adam-space-between adam-risk-toolbar-row">
          <div className="adam-stack adam-risk-toolbar-copy" style={{ gap: 4 }}>
            <div className="adam-title">Queue focus</div>
            <div className="adam-micro adam-muted">
              Filter the operating watchlist by entry type and decide whether to keep archived issues visible.
            </div>
          </div>
          <div className="adam-risk-toolbar-controls">
            {(["all", "risk", "blocker", "assumption", "dependency"] as const).map((type) => {
              const count = type === "all"
                ? activeCount
                : entries.filter((entry) => entry.type === type && entry.status !== "closed").length;
              return (
                <button
                  key={type}
                  type="button"
                  className={`adam-chip ${typeFilter === type ? "is-active" : ""}`}
                  style={{ fontSize: 12 }}
                  onClick={() => setTypeFilter(type)}
                >
                  {type === "all" ? "All" : TYPE_LABELS[type]}
                  {count > 0 ? (
                    <span className={`adam-badge ${type !== "all" ? TYPE_BADGE[type] : "slate"}`} style={{ padding: "1px 5px", fontSize: 10 }}>
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
        <div className="adam-risk-toolbar-footer">
          <label className="adam-micro adam-muted adam-risk-checkbox">
            <input type="checkbox" checked={showClosed} onChange={(event) => setShowClosed(event.target.checked)} />
            Show closed items
          </label>
        </div>
      </div>

      <div className="adam-stack" style={{ gap: 8 }}>
        {filtered.length === 0 ? (
          <div className="adam-card adam-risk-clear p-6">
            <div className="adam-title">
              {showClosed ? "No entries match this view" : "Risk queue is clear"}
            </div>
            <div className="adam-body adam-muted">
              {showClosed
                ? "Try a different filter or hide archived items to return to the active watchlist."
                : "No open or monitored risks are currently surfacing for this slice of the program."}
            </div>
          </div>
        ) : null}

        {filtered.map((entry) => (
          <div
            key={entry.id}
            className={`adam-card adam-risk-entry p-5 ${entry.status === "closed" ? "is-closed" : ""} is-${entry.severity}`}
          >
            <div className="adam-row adam-space-between adam-risk-entry-top">
              <div className="adam-stack adam-risk-entry-main">
                <div className="adam-row adam-risk-entry-badges">
                  <span className={`adam-badge ${TYPE_BADGE[entry.type]}`}>{TYPE_LABELS[entry.type]}</span>
                  <span className={`adam-badge ${SEVERITY_BADGE[entry.severity]}`}>{entry.severity}</span>
                  {entry.source === "agent" ? <span className="adam-badge slate">ATOS</span> : null}
                  {entry.status === "monitoring" ? <span className="adam-badge blue">Monitoring</span> : null}
                  {entry.status === "closed" ? <span className="adam-badge green">Closed</span> : null}
                </div>
                <div className="adam-row adam-space-between adam-risk-entry-heading">
                  <div className="adam-title">{entry.title}</div>
                  {entry.source === "agent" && entry.agentConfidence !== undefined ? (
                    <div className="adam-risk-confidence">
                      <div className="adam-micro adam-muted">Confidence {Math.round(entry.agentConfidence * 100)}%</div>
                      <div className="adam-risk-confidence-bar">
                        <span
                          className={`adam-risk-confidence-fill is-${entry.severity}`}
                          style={{ width: `${Math.max(8, Math.round(entry.agentConfidence * 100))}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
                {entry.description ? <div className="adam-body adam-muted">{entry.description}</div> : null}
                <div className="adam-risk-meta">
                  <span className="adam-risk-meta-chip">{getPhaseName(program, entry.phase)}</span>
                  {entry.owner ? <span className="adam-risk-meta-chip">Owner: {entry.owner}</span> : null}
                  <span className="adam-risk-meta-chip">{entry.source === "human" ? "Logged manually" : "Detected by ATOS"}</span>
                </div>
                {entry.mitigation ? <div className="adam-risk-note">Mitigation: {entry.mitigation}</div> : null}
                {entry.status === "closed" && entry.closureNote ? (
                  <div className="adam-risk-closure-note">
                    Closed: {entry.closureNote}
                  </div>
                ) : null}
              </div>

              <div className="adam-stack adam-risk-entry-actions">
                {entry.status === "open" && closingId !== entry.id ? (
                  <button
                    type="button"
                    className="adam-button-ghost"
                    onClick={() => setClosingId(entry.id)}
                  >
                    Mark resolved
                  </button>
                ) : null}
                {entry.status === "closed" ? (
                  <button
                    type="button"
                    className="adam-button-ghost"
                    onClick={async () => {
                      try {
                        await reopenEntry(entry.id);
                      } catch {
                        pushV3Toast("Could not save entry. Try again.", { tone: "error", duration: 4000 });
                      }
                    }}
                    disabled={isSaving}
                  >
                    Reopen
                  </button>
                ) : null}
              </div>
            </div>

            {closingId === entry.id ? (
              <div className="adam-stack adam-risk-close-panel">
                <div className="adam-micro adam-muted">Optional: add a closure note</div>
                <input
                  className="adam-input"
                  placeholder="How was this resolved?"
                  value={closureNote}
                  onChange={(event) => setClosureNote(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitClose(entry.id);
                  }}
                />
                <div className="adam-row adam-risk-close-actions">
                  <button
                    type="button"
                    className="adam-button"
                    onClick={() => void submitClose(entry.id)}
                    disabled={isSaving}
                  >
                    {isSaving ? "Saving…" : "Confirm close"}
                  </button>
                  <button
                    type="button"
                    className="adam-button-ghost"
                    onClick={() => {
                      setClosingId(null);
                      setClosureNote("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
