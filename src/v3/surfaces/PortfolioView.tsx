import React, { useEffect, useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import PortfolioInsightPanel from "@/v3/components/PortfolioInsightPanel";
import { ragLabel } from "@/v3/lib/uiHelpers";
import { confidenceRag } from "@/v3/lib/confidenceScore";
import { deriveProgramConfidence } from "@/v3/lib/programConfidence";
import { deriveOpenRecommendedActions } from "@/v3/lib/recommendedActions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PortfolioViewProps {
  programs: ProgramSummary[];
  activeProgramId: string | null;
  onSelectProgram: (id: string) => void;
  onDeleteProgram?: (id: string) => Promise<boolean | void>;
  onManageAccess?: (id: string) => void;
  onCreateProgram?: () => void;
  onRunAgent?: (agentId: string, phaseId?: string) => void;
  anyAgentRunning?: boolean;
  loading?: boolean;
}

type SortKey = "name" | "health" | "pct" | "decisions" | "modified";
type SummaryFilter = "all" | "at-risk" | "open-decisions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RAG_ORDER: Record<string, number> = { red: 0, amber: 1, green: 2, muted: 3 };

/**
 * A program's health tone — derived from the computed confidence score, NOT the
 * opaque agent-supplied `healthHeatmap.overallRag`. This guarantees a program's
 * card here reads the same band ("On Track"/"At Risk"/"Critical") that the
 * Executive header and rail badge show for it, instead of contradicting them.
 */
function programRag(program: ProgramSummary): "green" | "amber" | "red" | "muted" {
  return confidenceRag(deriveProgramConfidence(program).score);
}

function ragChipStyle(tone: "green" | "amber" | "red" | "muted"): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 999,
    whiteSpace: "nowrap",
    letterSpacing: "0.02em",
  };
  if (tone === "green") return { ...base, background: "var(--v3-green-subtle, rgba(34,197,94,0.12))", color: "var(--v3-green)" };
  if (tone === "red") return { ...base, background: "var(--v3-red-subtle, rgba(239,68,68,0.12))", color: "var(--v3-red)" };
  if (tone === "amber") return { ...base, background: "var(--v3-amber-subtle, rgba(245,158,11,0.12))", color: "var(--v3-amber)" };
  return { ...base, background: "var(--v3-surface-3)", color: "var(--v3-text-muted)" };
}

function phaseDotColor(phase: { pct: number; status: string }): string {
  if (phase.pct >= 80 || phase.status === "complete") return "var(--v3-green)";
  if (phase.status === "at-risk") return "var(--v3-amber)";
  if (phase.status === "blocked") return "var(--v3-red)";
  if (phase.pct >= 30 || phase.status === "active") return "var(--v3-accent)";
  return "var(--v3-surface-3)";
}

function openDecisionCount(program: ProgramSummary): number {
  return deriveOpenRecommendedActions(program).length;
}

function atRiskCount(program: ProgramSummary): number {
  return (program.phases || []).filter((p) => p.status === "at-risk" || p.status === "blocked").length;
}

function overallPct(program: ProgramSummary): number {
  const phases = program.phases || [];
  if (phases.length === 0) return 0;
  return Math.round(phases.reduce((sum, p) => sum + (p.pct || 0), 0) / phases.length);
}

function programObjective(program: ProgramSummary): string {
  const obj =
    program.objective ||
    (program as unknown as { rawData?: { projectMeta?: { objective?: string } } }).rawData?.projectMeta?.objective ||
    "";
  return obj.length > 80 ? obj.slice(0, 77) + "…" : obj;
}

// ---------------------------------------------------------------------------
// Skeleton card
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div
      className="v3-shimmer"
      style={{
        background: "var(--v3-surface-2)",
        borderRadius: "var(--v3-radius-lg, 10px)",
        height: 140,
        border: "1px solid var(--v3-border)",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Program card
// ---------------------------------------------------------------------------

function ProgramCard({
  program,
  isActive,
  onSelect,
  onRequestDelete,
  onManageAccess,
}: {
  program: ProgramSummary;
  isActive: boolean;
  onSelect: () => void;
  onRequestDelete?: () => void;
  onManageAccess?: () => void;
}) {
  const tone = programRag(program);
  const pct = overallPct(program);
  const decisions = openDecisionCount(program);
  const atRisk = atRiskCount(program);
  const phases = program.phases || [];
  const objective = programObjective(program);

  // Outer div — relative container so delete button can sit outside the card button
  return (
    <div className="v3-portfolio-card-wrap">
      {/* Card is a single <button> with NO nested interactive elements */}
      <button
        type="button"
        className={`v3-portfolio-card${isActive ? " is-active" : ""}`}
        onClick={onSelect}
      >
        {/* Row 1: name + chips */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
          <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: "var(--v3-text-primary)", lineHeight: 1.3, minWidth: 0 }}>
            {program.name}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
            <span style={ragChipStyle(tone)}>{ragLabel(tone)}</span>
            {isActive && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: "var(--v3-accent)", color: "#fff" }}>
                Active
              </span>
            )}
          </div>
        </div>

        {/* Row 2: badges */}
        <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--v3-text-muted)", background: "var(--v3-surface-2)", borderRadius: 6, padding: "2px 7px" }}>
            {phases.length} phase{phases.length !== 1 ? "s" : ""}
          </span>
          <span style={{ fontSize: 11, color: decisions > 2 ? "var(--v3-amber)" : "var(--v3-text-muted)", background: decisions > 2 ? "rgba(245,158,11,0.10)" : "var(--v3-surface-2)", borderRadius: 6, padding: "2px 7px", fontWeight: decisions > 2 ? 600 : 400 }}>
            {decisions} action{decisions !== 1 ? "s" : ""}
          </span>
          {atRisk > 0 && (
            <span style={{ fontSize: 11, color: "var(--v3-red)", background: "rgba(239,68,68,0.10)", borderRadius: 6, padding: "2px 7px", fontWeight: 600 }}>
              ⚑ {atRisk} at risk
            </span>
          )}
        </div>

        {/* Row 3: objective */}
        {objective && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--v3-text-muted)", lineHeight: 1.45, textAlign: "left" }}>
            {objective}
          </div>
        )}

        {/* Row 4: progress bar */}
        <div style={{ marginTop: 10 }}>
          <div style={{ height: 4, background: "var(--v3-surface-3)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "var(--v3-accent)", borderRadius: 999, transition: "width 0.4s ease" }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 4 }}>{pct}% overall</div>
        </div>

        {/* Row 5: phase dots */}
        {phases.length > 0 && (
          <div style={{ display: "flex", gap: 4, marginTop: 10, flexWrap: "wrap" }}>
            {phases.map((phase) => (
              <div key={phase.id} title={`${phase.displayName} — ${phase.pct}%`}
                style={{ width: 8, height: 8, borderRadius: "50%", background: phaseDotColor(phase), flexShrink: 0 }} />
            ))}
          </div>
        )}
      </button>

      {/* Action bar — siblings of the card button, never nested inside it */}
      {(onManageAccess || onRequestDelete) && (
        <div className="v3-portfolio-card-actions">
          {onManageAccess && (
            <button
              type="button"
              className="v3-portfolio-card-action"
              aria-label={`Manage access for ${program.name}`}
              title={`Manage access & sharing for ${program.name}`}
              onClick={onManageAccess}
            >
              Manage access
            </button>
          )}
          {onRequestDelete && (
            <button
              type="button"
              className="v3-portfolio-card-action is-danger"
              aria-label={`Delete ${program.name}`}
              title={`Delete ${program.name}`}
              onClick={onRequestDelete}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "name", label: "Name" },
  { value: "health", label: "Health" },
  { value: "pct", label: "Overall %" },
  { value: "decisions", label: "Open Actions" },
  { value: "modified", label: "Last Modified" },
];

export default function PortfolioView({
  programs,
  activeProgramId,
  onSelectProgram,
  onDeleteProgram,
  onManageAccess,
  onCreateProgram,
  onRunAgent,
  anyAgentRunning,
  loading = false,
}: PortfolioViewProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilter>("all");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const searched = q ? programs.filter((p) => p.name.toLowerCase().includes(q)) : programs;
    const list = searched.filter((program) => {
      if (summaryFilter === "at-risk") return programRag(program) === "red" || atRiskCount(program) > 0;
      if (summaryFilter === "open-decisions") return openDecisionCount(program) > 0;
      return true;
    });

    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name);
        case "health": {
          const ra = RAG_ORDER[programRag(a)] ?? 3;
          const rb = RAG_ORDER[programRag(b)] ?? 3;
          return ra - rb;
        }
        case "pct":
          return overallPct(b) - overallPct(a);
        case "decisions":
          return openDecisionCount(b) - openDecisionCount(a);
        default:
          return 0;
      }
    });
  }, [programs, search, sortKey, summaryFilter]);

  // Summary stats
  const totalPrograms = programs.length;
  const hasActiveFilters = search.trim().length > 0 || summaryFilter !== "all";

  useEffect(() => {
    if (!pendingDelete) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) setPendingDelete(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleting, pendingDelete]);
  const atRiskTotal = programs.filter((p) => programRag(p) === "red" || atRiskCount(p) > 0).length;
  const avgPct =
    totalPrograms > 0
      ? Math.round(programs.reduce((s, p) => s + overallPct(p), 0) / totalPrograms)
      : 0;
  const totalDecisions = programs.reduce((s, p) => s + openDecisionCount(p), 0);

  return (
    <div className="v3-section">
      {/* Header */}
      <div className="v3-card-title" style={{ marginBottom: 12 }}>
        Portfolio
      </div>

      {/* Summary strip */}
      {!loading && totalPrograms > 0 && (
        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          {[
            { label: "Programmes", value: totalPrograms, filter: "all" as SummaryFilter, onClick: () => { setSummaryFilter("all"); setSortKey("name"); } },
            { label: "At Risk", value: atRiskTotal, warn: atRiskTotal > 0, filter: "at-risk" as SummaryFilter, onClick: () => { setSummaryFilter("at-risk"); setSortKey("health"); } },
            { label: "Avg Completion", value: `${avgPct}%`, filter: "all" as SummaryFilter, onClick: () => { setSummaryFilter("all"); setSortKey("pct"); } },
            { label: "Open Actions", value: totalDecisions, warn: totalDecisions > 5, filter: "open-decisions" as SummaryFilter, onClick: () => { setSummaryFilter("open-decisions"); setSortKey("decisions"); } },
          ].map((stat) => (
            <button
              type="button"
              key={stat.label}
              onClick={stat.onClick}
              style={{
                flex: "1 1 80px",
                background: "var(--v3-surface-2)",
                border: `1px solid ${summaryFilter === stat.filter ? "var(--v3-accent)" : "var(--v3-border)"}`,
                borderRadius: "var(--v3-radius-lg, 10px)",
                padding: "8px 12px",
                textAlign: "center",
                cursor: "pointer",
                transition: "background 0.15s, border-color 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--v3-surface-3)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--v3-surface-2)";
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: stat.warn ? "var(--v3-red)" : "var(--v3-text-primary)",
                  lineHeight: 1.2,
                }}
              >
                {stat.value}
              </div>
              <div style={{ fontSize: 10, color: "var(--v3-text-muted)", marginTop: 2, fontWeight: 500 }}>
                {stat.label}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Portfolio Intelligence */}
      {!loading && programs.length > 1 && (
        <div style={{ marginBottom: 20 }}>
          <PortfolioInsightPanel
            programs={programs}
            anyAgentRunning={anyAgentRunning ?? false}
            onRunAgent={(agentId) => onRunAgent?.(agentId)}
          />
        </div>
      )}

      {/* Search + sort */}
      {!loading && totalPrograms > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search programmes…"
            style={{
              flex: "1 1 160px",
              fontSize: 13,
              padding: "7px 12px",
              borderRadius: "var(--v3-radius, 8px)",
              border: "1px solid var(--v3-border)",
              background: "var(--v3-surface-2)",
              color: "var(--v3-text-primary)",
              outline: "none",
            }}
          />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            style={{
              fontSize: 12,
              padding: "7px 10px",
              borderRadius: "var(--v3-radius, 8px)",
              border: "1px solid var(--v3-border)",
              background: "var(--v3-surface-2)",
              color: "var(--v3-text-primary)",
              cursor: "pointer",
            }}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Sort: {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div style={{ display: "grid", gap: 12 }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Empty state — no programs at all */}
      {!loading && totalPrograms === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "48px 24px",
            color: "var(--v3-text-muted)",
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>◫</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--v3-text-primary)", marginBottom: 6 }}>
            No programmes yet
          </div>
          <div style={{ fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>
            Create your first programme to start tracking delivery health, decisions, and progress.
          </div>
          {onCreateProgram && (
            <button
              type="button"
              className="v3-button primary"
              onClick={onCreateProgram}
            >
              Create your first programme →
            </button>
          )}
        </div>
      )}

      {/* Empty search state */}
      {!loading && totalPrograms > 0 && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "38px 20px", color: "var(--v3-text-muted)", fontSize: 13 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--v3-text-primary)", marginBottom: 6 }}>
            No programmes match this view
          </div>
          <div style={{ lineHeight: 1.5, marginBottom: 16 }}>
            {search.trim()
              ? <>No programme matches "<strong>{search}</strong>". Try a different keyword or clear the current filters.</>
              : "The selected portfolio filter has no matching programmes yet."}
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              className="v3-button ghost"
              onClick={() => {
                setSearch("");
                setSummaryFilter("all");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Program cards */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map((program) => (
            <ProgramCard
              key={program.id}
              program={program}
              isActive={program.id === activeProgramId}
              onSelect={() => onSelectProgram(program.id)}
              onRequestDelete={onDeleteProgram ? () => setPendingDelete({ id: program.id, name: program.name }) : undefined}
              onManageAccess={onManageAccess ? () => onManageAccess(program.id) : undefined}
            />
          ))}
        </div>
      )}

      {/* ── Delete confirmation modal (lifted out of card to avoid flicker) ── */}
      {pendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="portfolio-delete-title"
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => { if (!deleting) setPendingDelete(null); }}
        >
          <div
            style={{
              background: "var(--v3-surface)", border: "1px solid var(--v3-border)",
              borderRadius: 16, padding: "28px 28px 24px", maxWidth: 380, width: "90%",
              boxShadow: "0 24px 48px rgba(0,0,0,0.35)",
              fontFamily: "var(--v3-font)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div id="portfolio-delete-title" style={{ fontSize: 15, fontWeight: 700, color: "var(--v3-text-primary)", marginBottom: 8 }}>
              Delete programme?
            </div>
            <div style={{ fontSize: 13, color: "var(--v3-text-muted)", lineHeight: 1.6, marginBottom: 20 }}>
              This will permanently delete <strong style={{ color: "var(--v3-text-primary)" }}>{pendingDelete.name}</strong> and all its phases, gates, decisions, and documents. This cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="v3-button ghost"
                style={{ fontSize: 13 }}
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="v3-button"
                style={{ fontSize: 13, background: "var(--v3-red)", color: "#fff", border: "none", opacity: deleting ? 0.65 : 1 }}
                disabled={deleting}
                onClick={async () => {
                  if (!onDeleteProgram) return;
                  setDeleting(true);
                  try {
                    const result = await onDeleteProgram(pendingDelete.id);
                    if (result !== false) setPendingDelete(null);
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? "Deleting…" : "Delete programme"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
