import React from "react";
import type { ProgramSummary } from "@/new/types";
import RoadmapGantt from "@/v3/components/RoadmapGantt";
import { buildRoadmapRows, buildValidationStages, type ValidationStage } from "@/v3/lib/phaseSchedule";
import type { GanttMarker } from "@/v3/components/RoadmapGantt";
import { AdamCard, AdamCardBody, AdamCardHeader } from "@/v3/components/ui/AdamCard";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";

interface RoadmapViewProps {
  program: ProgramSummary | null;
  planIsRunning: boolean;
  onTriggerPlan: () => void;
  healthIsRunning: boolean;
  onTriggerHealth: () => void;
  /** When provided, the phase timeline becomes editable (drag/resize/date inputs). */
  onSaveRoadmapSchedule?: (schedule: Record<string, { start: string; end: string }>) => Promise<void>;
}

const RAG_COLOR: Record<string, string> = {
  green: "#198754",
  amber: "#d9930b",
  red: "#dc3545",
  grey: "#94a3b8",
};

const RAG_LABEL: Record<string, string> = {
  green: "On track",
  amber: "At risk",
  red: "Off track",
  grey: "Not started",
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#dc3545",
  high: "#d9930b",
  medium: "#64748b",
};

const STAGE_COLOR: Record<string, string> = {
  poc: "#7c3aed",
  prototype: "#0ea5e9",
  pilot: "#0d9488",
  mvp: "#198754",
};

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07-20" → "20 Jul 2026"; returns "" for blank/unparseable input. */
function formatStageDate(iso: string): string {
  const [y, m, d] = (iso || "").split("-");
  const mi = Number(m) - 1;
  if (!y || !MONTH_ABBR[mi] || !d) return "";
  return `${Number(d)} ${MONTH_ABBR[mi]} ${y}`;
}

function RagPill({ rag, label }: { rag: string; label?: string }) {
  const color = RAG_COLOR[rag] ?? RAG_COLOR.grey;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
        letterSpacing: "0.02em", textTransform: "uppercase",
        color, background: `${color}1f`, border: `1px solid ${color}55`,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
      {label ?? RAG_LABEL[rag] ?? rag}
    </span>
  );
}

/** Compact programme-health banner driven by the roadmap-health agent output. */
function RoadmapHealthStrip({
  program, healthIsRunning, onTriggerHealth,
}: { program: ProgramSummary; healthIsRunning: boolean; onTriggerHealth: () => void }) {
  const health = program.healthHeatmap;
  const atRisk = health ? health.phaseHealth.filter((p) => p.rag === "amber" || p.rag === "red").length : 0;
  const topRisks = health
    ? health.phaseHealth.filter((p) => p.topRisk && (p.rag === "amber" || p.rag === "red"))
        .slice(0, 3)
    : [];

  return (
    <AdamCard>
      <AdamCardBody className="v3-program-detail-stack" padded>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <RagPill rag={health?.overallRag ?? "grey"} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 650, color: "var(--v3-text-primary)" }}>
                Roadmap health
              </div>
              <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", maxWidth: 560 }}>
                {health?.summary || "No health assessment yet — run the agent to grade phase progress, status and risks."}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="v3-btn v3-btn-ghost"
            onClick={onTriggerHealth}
            disabled={healthIsRunning}
            style={{ whiteSpace: "nowrap" }}
          >
            {healthIsRunning ? "Assessing…" : "Refresh health"}
          </button>
        </div>

        {health ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="v3-chip muted" style={{ fontSize: 11 }}>Score {Math.round(health.overallHealthScore)}/100</span>
            <span className="v3-chip muted" style={{ fontSize: 11 }}>Momentum: {health.programMomentum}</span>
            <span className="v3-chip muted" style={{ fontSize: 11 }}>Trend: {health.trend}</span>
            <span className="v3-chip muted" style={{ fontSize: 11 }}>{atRisk} phase{atRisk === 1 ? "" : "s"} need attention</span>
            {program.healthHeatmapGeneratedAt ? (
              <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                Updated <RelativeTime date={program.healthHeatmapGeneratedAt} />
              </span>
            ) : null}
          </div>
        ) : null}

        {topRisks.length ? (
          <div style={{ display: "grid", gap: 6 }}>
            {topRisks.map((p) => (
              <div key={p.phaseId} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12 }}>
                <span style={{ color: RAG_COLOR[p.rag] ?? RAG_COLOR.grey, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {p.phaseName}
                </span>
                <span style={{ color: "var(--v3-text-secondary)" }}>{p.topRisk}</span>
              </div>
            ))}
          </div>
        ) : null}
      </AdamCardBody>
    </AdamCard>
  );
}

/** Next actions + open blockers from the folded delivery plan, side by side. */
function DeliveryFocus({
  program, planIsRunning, onTriggerPlan,
}: { program: ProgramSummary; planIsRunning: boolean; onTriggerPlan: () => void }) {
  const plan = program.plan;
  if (!plan || (!plan.nextThreeActions.length && !plan.blockerSummary.length)) {
    return (
      <AdamCard>
        <AdamCardHeader title="Delivery focus" subtitle="Immediate actions and open blockers across the roadmap." />
        <AdamCardBody>
          <EmptyState
            compact
            icon="◇"
            title="No delivery plan yet"
            description="Generate the plan to surface the next actions and blockers on the critical path."
            action={{ label: planIsRunning ? "Generating…" : "Generate plan", onClick: onTriggerPlan, loading: planIsRunning }}
          />
        </AdamCardBody>
      </AdamCard>
    );
  }

  return (
    <AdamCard>
      <AdamCardHeader
        title="Delivery focus"
        subtitle="Immediate actions and open blockers across the roadmap."
        badge={
          <button type="button" className="v3-btn v3-btn-ghost" onClick={onTriggerPlan} disabled={planIsRunning} style={{ fontSize: 11 }}>
            {planIsRunning ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      <AdamCardBody>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--v3-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
              Next actions
            </div>
            {plan.nextThreeActions.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {plan.nextThreeActions.map((a, i) => (
                  <div key={i} style={{ display: "grid", gap: 2, paddingBottom: 8, borderBottom: i < plan.nextThreeActions.length - 1 ? "1px solid var(--v3-border-soft)" : "none" }}>
                    <div style={{ fontSize: 13, color: "var(--v3-text-primary)", fontWeight: 550 }}>{a.action}</div>
                    <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                      {a.phase}{a.owner ? ` · ${a.owner}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>No immediate actions.</div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--v3-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
              Open blockers
            </div>
            {plan.blockerSummary.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {plan.blockerSummary.map((b, i) => (
                  <div key={i} style={{ display: "grid", gap: 2, paddingBottom: 8, borderBottom: i < plan.blockerSummary.length - 1 ? "1px solid var(--v3-border-soft)" : "none" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: SEVERITY_COLOR[b.severity] ?? SEVERITY_COLOR.medium }}>
                        {b.severity}
                      </span>
                      <span style={{ fontSize: 13, color: "var(--v3-text-primary)", fontWeight: 550 }}>{b.blocker}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                      {b.phase}{b.resolution ? ` · ${b.resolution}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>No open blockers.</div>
            )}
          </div>
        </div>
      </AdamCardBody>
    </AdamCard>
  );
}

/** The user-defined validation/de-risking stages, as a dedicated section. */
function ValidationSection({ stages }: { stages: ValidationStage[] }) {
  return (
    <AdamCard>
      <AdamCardHeader
        title="Validation & de-risking"
        subtitle="The proof points that validate outcomes before full rollout — sequenced on the timeline above as markers."
      />
      <AdamCardBody>
        <div style={{ display: "grid", gap: 10 }}>
          {stages.map((stage, i) => {
            const color = STAGE_COLOR[stage.stage.toLowerCase()] ?? "#64748b";
            const dateLabel = formatStageDate(stage.date);
            return (
              <div
                key={stage.id}
                style={{
                  display: "flex", gap: 12, alignItems: "flex-start",
                  paddingBottom: i < stages.length - 1 ? 10 : 0,
                  borderBottom: i < stages.length - 1 ? "1px solid var(--v3-border-soft)" : "none",
                }}
              >
                <span
                  style={{
                    flexShrink: 0, display: "inline-flex", alignItems: "center",
                    padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                    letterSpacing: "0.02em", textTransform: "uppercase",
                    color, background: `${color}1f`, border: `1px solid ${color}55`,
                  }}
                >
                  {stage.stage || "Stage"}
                </span>
                <div style={{ display: "grid", gap: 2, flex: 1, minWidth: 0 }}>
                  {stage.considerations ? (
                    <div style={{ fontSize: 13, color: "var(--v3-text-primary)" }}>{stage.considerations}</div>
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--v3-text-muted)" }}>No considerations noted.</div>
                  )}
                  {dateLabel ? (
                    <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>Target {dateLabel}</div>
                  ) : (
                    <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>No target date</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </AdamCardBody>
    </AdamCard>
  );
}

/**
 * The Strategic Roadmap is the single delivery surface. It composes, top to
 * bottom: agent-graded programme health, the phase timeline (with progress/RAG/
 * risk overlay), the user's validation/de-risking stages and the delivery focus
 * (next actions + blockers from the folded plan). The critical-path sequence is
 * read off the timeline rather than repeated as a list.
 */
export default function RoadmapView({
  program,
  planIsRunning,
  onTriggerPlan,
  healthIsRunning,
  onTriggerHealth,
  onSaveRoadmapSchedule,
}: RoadmapViewProps) {
  const roadmapRows = React.useMemo(
    () => buildRoadmapRows(program?.rawData, (program?.phases || []) as Array<{ id: string; status?: string }>),
    [program?.rawData, program?.phases],
  );

  const validationStages = React.useMemo(
    () => buildValidationStages(program?.rawData),
    [program?.rawData],
  );

  const validationMarkers = React.useMemo<GanttMarker[]>(
    () => validationStages
      .filter((s) => s.date)
      .map((s) => ({ id: s.id, label: s.stage || "Stage", date: s.date, detail: s.considerations || undefined })),
    [validationStages],
  );

  // Persist the full effective schedule (defaults made explicit) with the one
  // edited phase replaced, so the saved plan is stable even if the methodology's
  // duration weights later change.
  const handleRoadmapChange = React.useCallback(
    (id: string, start: string, end: string) => {
      if (!onSaveRoadmapSchedule) return;
      const schedule: Record<string, { start: string; end: string }> = {};
      for (const row of roadmapRows) {
        schedule[row.id] = row.id === id ? { start, end } : { start: row.start, end: row.end };
      }
      void onSaveRoadmapSchedule(schedule);
    },
    [onSaveRoadmapSchedule, roadmapRows],
  );

  if (!program) {
    return (
      <div className="v3-section">
        <EmptyState icon="◇" title="No active programme" description="Select a programme to view its strategic roadmap." />
      </div>
    );
  }

  return (
    <div className="v3-section" style={{ display: "grid", gap: 16 }}>
      <RoadmapHealthStrip program={program} healthIsRunning={healthIsRunning} onTriggerHealth={onTriggerHealth} />

      <AdamCard>
        <AdamCardHeader
          title="Phase timeline"
          subtitle="Programme window weighted by each phase's typical duration. Bars show progress and RAG status against today."
        />
        <AdamCardBody>
          <RoadmapGantt rows={roadmapRows} editable={!!onSaveRoadmapSchedule} onChange={handleRoadmapChange} markers={validationMarkers} />
        </AdamCardBody>
      </AdamCard>

      {validationStages.length ? <ValidationSection stages={validationStages} /> : null}

      <DeliveryFocus program={program} planIsRunning={planIsRunning} onTriggerPlan={onTriggerPlan} />
    </div>
  );
}
