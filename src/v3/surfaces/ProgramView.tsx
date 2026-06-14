import React, { useMemo } from "react";
import type { BenefitMilestone, ProgramSummary } from "@/new/types";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";
import { StatusBadge } from "@/v3/components/ui/StatusBadge";
import ProgramUsagePanel from "@/v3/components/ProgramUsagePanel";
import { ragLabel } from "@/v3/lib/uiHelpers";
import { confidenceRag } from "@/v3/lib/confidenceScore";
import { deriveProgramConfidence } from "@/v3/lib/programConfidence";
import { AdamCard, AdamCardBody, AdamCardHeader } from "@/v3/components/ui/AdamCard";
import type { V3Mode, V3MoreView, V3ReportId } from "@/v3/types";

interface ProgramViewProps {
  program: ProgramSummary | null;
  mode: V3Mode;
  focusedReportId: V3ReportId | null;
  currentView: V3MoreView | null;
  renderView: () => React.ReactNode;
  onOpenMoreView: (view: V3MoreView | null) => void;
  onOpenReport: (reportId: V3ReportId) => void;
  sanity: { label: string; description: string } | null;
  validation: Array<{ score: number; status: string }> | null;
  hasBlockers: boolean;
  warningCount: number;
  narrativeIsRunning?: boolean;
  onNavigateToPipeline: () => void;
  onNavigateToProgrammeHealth: () => void;
  onNavigateToStage: (phaseId: string) => void;
}

const ADVANCED_LINKS: Array<{ label: string; view: V3MoreView }> = [
  { label: "Stakeholder map", view: "stakeholders" },
  { label: "Adoption tracker", view: "adoption" },
  { label: "Critical path", view: "critical-path" },
  { label: "Pattern library", view: "intelligence" },
  { label: "Benchmark comparison", view: "benchmark" },
  { label: "Decision audit trail", view: "decision-audit" },
  { label: "Budget", view: "budget" },
  { label: "Change impact", view: "change-impact" },
];

const REPORT_ROWS: Array<{ id: V3ReportId; label: string }> = [
  { id: "narrative", label: "Narrative" },
  { id: "deck", label: "Status deck" },
  { id: "status", label: "Executive brief" },
  { id: "closure", label: "Closure" },
];

function reportPreview(program: ProgramSummary | null, reportId: V3ReportId | null): string | null {
  if (!program || !reportId) return null;
  if (reportId === "narrative") return program.narrative || null;
  if (reportId === "deck") return program.deck?.programHealthSummary || program.deck?.slides?.[0]?.speakerNotes || null;
  if (reportId === "closure") return program.closure?.benefitsSummary?.commentary || program.closure?.recommendations?.[0] || null;
  return program.healthHeatmap?.summary || program.narrative || null;
}

function ragToBadgeVariant(rag: string | null | undefined) {
  if (rag === "green") return "approved";
  if (rag === "red") return "critical";
  if (rag === "amber") return "pending";
  return "locked";
}

function formatPhaseName(id: string | null | undefined) {
  if (!id) return "--";
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " ");
}

function WorkstreamsCard({ program, onNavigateToPipeline }: { program: ProgramSummary; onNavigateToPipeline: () => void }) {
  const items = (program.workstreams || []).slice(0, 4);
  return (
    <AdamCard>
      <AdamCardHeader title="Workstreams" subtitle={items.length ? `${items.length} active tracks` : "No workstreams defined"} />
      <AdamCardBody>
        {items.length ? (
          <div className="v3-oversight-list">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="v3-oversight-list-row"
                onClick={onNavigateToPipeline}
                style={{ width: "100%", cursor: "pointer", textAlign: "left" }}
              >
                <div>
                  <div className="v3-oversight-row-title">{item.label}</div>
                  <div className="v3-oversight-row-sub">{formatPhaseName(item.phaseId)}</div>
                </div>
                <div className="v3-oversight-row-metric">{Math.round(item.pct)}%</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="v3-oversight-empty-copy">No active workstreams yet.</div>
        )}
      </AdamCardBody>
    </AdamCard>
  );
}

function BenefitsCard({ milestones, onNavigateToProgrammeHealth }: { milestones: BenefitMilestone[]; onNavigateToProgrammeHealth: () => void }) {
  return (
    <AdamCard>
      <AdamCardHeader title="Benefits" subtitle={milestones.length ? `${milestones.length} tracked value milestones` : "No benefits tracked"} />
      <AdamCardBody>
        {milestones.length ? (
          <div className="v3-oversight-list">
            {milestones.slice(0, 4).map((item) => (
              <button
                key={item.id}
                type="button"
                className="v3-oversight-list-row"
                onClick={onNavigateToProgrammeHealth}
                style={{ width: "100%", cursor: "pointer", textAlign: "left" }}
              >
                <div>
                  <div className="v3-oversight-row-title">{item.title}</div>
                  <div className="v3-oversight-row-sub">{item.estimatedValue}</div>
                </div>
                <StatusBadge variant={item.status === "realised" ? "approved" : item.status === "at-risk" ? "at-risk" : "pending"} size="sm" label={item.status} />
              </button>
            ))}
          </div>
        ) : (
          <div className="v3-oversight-empty-copy">No benefit milestones available yet.</div>
        )}
      </AdamCardBody>
    </AdamCard>
  );
}

function StakeholderCard({ program, onOpenMoreView }: { program: ProgramSummary; onOpenMoreView: (view: V3MoreView | null) => void }) {
  const updates = program.stakeholderRadar?.latestUpdates || [];
  return (
    <AdamCard>
      <AdamCardHeader
        title="Stakeholders"
        subtitle={updates.length ? `${updates.length} recent sentiment updates` : "No stakeholder sentiment yet"}
        action={<button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={() => onOpenMoreView("stakeholders")}>Open map</button>}
      />
      <AdamCardBody>
        {updates.length ? (
          <div className="v3-oversight-list">
            {updates.slice(0, 4).map((item, index) => (
              <div key={`${item.stakeholder}-${index}`} className="v3-oversight-list-row">
                <div>
                  <div className="v3-oversight-row-title">{item.stakeholder}</div>
                  <div className="v3-oversight-row-sub">{item.summary}</div>
                </div>
                <StatusBadge variant={item.sentiment === "supportive" ? "approved" : item.sentiment === "resistant" ? "critical" : "pending"} size="sm" label={item.sentiment} />
              </div>
            ))}
          </div>
        ) : (
          <div className="v3-oversight-empty-copy">No stakeholder updates captured yet.</div>
        )}
      </AdamCardBody>
    </AdamCard>
  );
}

function ReportsCard({
  program,
  focusedReportId,
  onOpenReport,
}: {
  program: ProgramSummary;
  focusedReportId: V3ReportId | null;
  onOpenReport: (reportId: V3ReportId) => void;
}) {
  const preview = reportPreview(program, focusedReportId);
  return (
    <AdamCard>
      <AdamCardHeader title="Reports" subtitle="Narrative, deck, executive brief, and closure outputs" />
      <AdamCardBody>
        <div className="v3-oversight-report-links">
          {REPORT_ROWS.map((report) => (
            <button
              key={report.id}
              type="button"
              className={`v3-more-item ${focusedReportId === report.id ? "is-active" : ""}`}
              aria-pressed={focusedReportId === report.id}
              onClick={() => onOpenReport(report.id)}
            >
              <span>{report.label}</span>
              <span>›</span>
            </button>
          ))}
        </div>
        {preview ? (
          <div className="v3-oversight-preview">
            {preview}
          </div>
        ) : null}
      </AdamCardBody>
    </AdamCard>
  );
}

export default function ProgramView({
  program,
  mode,
  focusedReportId,
  currentView,
  renderView,
  onOpenMoreView,
  onOpenReport,
  hasBlockers,
  warningCount,
  narrativeIsRunning = false,
  onNavigateToPipeline,
  onNavigateToProgrammeHealth,
  onNavigateToStage,
}: ProgramViewProps) {
  if (currentView) {
    return (
      <div className="v3-more-detail">
        <div className="v3-more-detail-header">
          <button type="button" className="v3-button ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => onOpenMoreView(null)}>
            ← Workspaces
          </button>
        </div>
        <div className="v3-embedded-view">{renderView()}</div>
      </div>
    );
  }

  if (!program) {
    return (
      <div className="v3-section">
        <div className="v3-empty" style={{ marginTop: 60 }}>
          <div className="v3-empty-icon">◫</div>
          <div className="v3-empty-title">No programme loaded</div>
          <div className="v3-empty-body">Select a programme to review health, reports, and advanced workspaces.</div>
        </div>
      </div>
    );
  }

  const detailView = renderView();
  const benefits = program.benefitsTracking?.benefitMilestones || [];
  // Health reads from the computed confidence score (traceable, explainable) —
  // the single source of truth shared with the rail badge and Portfolio cards —
  // not the opaque agent-supplied overallRag, so this surface never contradicts
  // the others on the same programme's health.
  const healthRag = confidenceRag(deriveProgramConfidence(program).score);
  const healthVariant = ragToBadgeVariant(healthRag);
  const openRisks = (program.raidEntries || []).filter((entry) => entry.type === "risk" && entry.status !== "closed");
  const highRisks = openRisks.filter((entry) => entry.severity === "critical" || entry.severity === "high");
  const activeMembers = program.team?.members?.length || 0;
  const updatedAt = program.updatedAt || program.lastActiveAt || null;
  const activePhase = (program.phases || []).find((phase) => phase.id === program.activePhaseId) || null;
  const hasActivePhase = !!program.activePhaseId;

  return (
    <div className="v3-oversight-layout">
      <div className="v3-oversight-header">
        <div>
          <h1 className="v3-oversight-title">Oversight</h1>
          <p className="v3-oversight-subtitle">Programme health and performance</p>
        </div>
        {updatedAt ? (
          <div className="v3-oversight-updated">
            Updated <RelativeTime date={updatedAt} />
          </div>
        ) : null}
      </div>

      {hasBlockers ? (
        <div className="v3-validation-banner is-error">
          <span>Program data has blocking issues — some agent outputs may be unreliable.</span>
          <button type="button" className="v3-button ghost" style={{ fontSize: 11 }} onClick={() => onOpenMoreView("intelligence")}>View details →</button>
        </div>
      ) : warningCount > 0 ? (
        <div className="v3-validation-banner is-warn">
          <span>{warningCount} data quality warning{warningCount !== 1 ? "s" : ""} detected.</span>
          <button type="button" className="v3-button ghost" style={{ fontSize: 11 }} onClick={() => onOpenMoreView("intelligence")}>View details →</button>
        </div>
      ) : null}

      <div className="v3-oversight-kpis">
        <AdamCard
          accent={healthVariant === "approved" ? "success" : healthVariant === "critical" ? "danger" : "warning"}
          interactive
          onClick={onNavigateToProgrammeHealth}
        >
          <AdamCardBody>
            <div className="v3-oversight-kpi-label">Health Score</div>
            <div className="v3-oversight-kpi-value">{ragLabel(healthRag)}</div>
            <div className="v3-oversight-kpi-sub">{program.healthHeatmap?.summary || "Programme posture still forming."}</div>
          </AdamCardBody>
        </AdamCard>

        <AdamCard
          interactive={hasActivePhase}
          onClick={hasActivePhase ? () => onNavigateToStage(program.activePhaseId as string) : undefined}
        >
          <AdamCardBody>
            <div className="v3-oversight-kpi-label">Active Phase</div>
            <div className="v3-oversight-kpi-value">{formatPhaseName(program.activePhaseId)}</div>
            <div className="v3-oversight-kpi-sub">{activePhase?.objective || (hasActivePhase ? "Current execution focus" : "No phase active yet")}</div>
          </AdamCardBody>
        </AdamCard>

        <AdamCard accent={highRisks.length ? "danger" : openRisks.length ? "warning" : "none"} interactive onClick={() => onOpenMoreView("risks")}>
          <AdamCardBody>
            <div className="v3-oversight-kpi-label">Open Risks</div>
            <div className="v3-oversight-kpi-value">{openRisks.length}</div>
            <div className="v3-oversight-kpi-sub">{highRisks.length} high severity</div>
          </AdamCardBody>
        </AdamCard>

        <AdamCard interactive onClick={() => onOpenMoreView("stakeholders")}>
          <AdamCardBody>
            <div className="v3-oversight-kpi-label">Team</div>
            <div className="v3-oversight-kpi-value">{activeMembers || "--"}</div>
            <div className="v3-oversight-kpi-sub">Tracked core members</div>
          </AdamCardBody>
        </AdamCard>
      </div>

      <AdamCard>
        <AdamCardHeader
          title="Programme Narrative"
          subtitle={program.narrative ? "Latest executive summary" : narrativeIsRunning ? "Generating…" : "No narrative yet"}
          badge={<StatusBadge variant={healthVariant} size="sm" label={ragLabel(healthRag)} />}
          action={<button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={() => onOpenReport("narrative")}>Open report</button>}
        />
        <AdamCardBody>
          {program.narrative ? (
            <div className="v3-oversight-narrative">{program.narrative}</div>
          ) : narrativeIsRunning ? (
            <div className="v3-oversight-empty-copy">Generating narrative from the latest programme signals…</div>
          ) : (
            <div className="v3-oversight-empty-copy">Generate a narrative to summarise status for stakeholders.</div>
          )}
        </AdamCardBody>
      </AdamCard>

      <div className="v3-oversight-grid-3">
        <WorkstreamsCard program={program} onNavigateToPipeline={onNavigateToPipeline} />
        <BenefitsCard milestones={benefits} onNavigateToProgrammeHealth={onNavigateToProgrammeHealth} />
        <StakeholderCard program={program} onOpenMoreView={onOpenMoreView} />
      </div>

      <div className="v3-oversight-grid-2">
        <ReportsCard
          program={program}
          focusedReportId={focusedReportId}
          onOpenReport={onOpenReport}
        />
        <AdamCard>
          <AdamCardHeader title="Advanced" subtitle={mode === "power" ? "Deep programme workspaces" : "Additional workspaces"} />
          <AdamCardBody>
            <div className="v3-oversight-report-links">
              {ADVANCED_LINKS.map((item) => (
                <button key={item.view} type="button" className="v3-more-item" onClick={() => onOpenMoreView(item.view)}>
                  <span>{item.label}</span>
                  <span>›</span>
                </button>
              ))}
            </div>
          </AdamCardBody>
        </AdamCard>
      </div>

      {mode === "power" ? <ProgramUsagePanel programId={program.id} /> : null}

      {detailView ? (
        <div className="v3-embedded-view">{detailView}</div>
      ) : null}
    </div>
  );
}
