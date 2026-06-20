import React, { useEffect, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import type { V3ReportId } from "@/v3/types";

interface ReportsViewProps {
  program: ProgramSummary | null;
  narrativeIsRunning: boolean;
  deckIsRunning: boolean;
  closureIsRunning: boolean;
  onTriggerNarrative: () => void;
  onTriggerDeck: () => void;
  onTriggerClosure: () => void;
  focusedReportId?: V3ReportId | null;
}

interface ReportCardConfig {
  id: V3ReportId;
  icon: string;
  title: string;
  subtitle: string;
  readinessLabel: string;
  readinessTone: "green" | "amber" | "red" | "muted";
  kicker: string;
  isRunning: boolean;
  onRefresh: (() => void) | null;
  content: string | null;
}

export default function ReportsView({
  program,
  narrativeIsRunning,
  deckIsRunning,
  closureIsRunning,
  onTriggerNarrative,
  onTriggerDeck,
  onTriggerClosure,
  focusedReportId = null,
}: ReportsViewProps) {
  const [expanded, setExpanded] = useState<V3ReportId | null>(focusedReportId);

  useEffect(() => {
    if (focusedReportId) setExpanded(focusedReportId);
  }, [focusedReportId]);

  const toggle = (id: V3ReportId) => {
    setExpanded((current) => (current === id ? null : id));
  };

  const openDecisionCount = (program?.decisionQueue || []).filter((decision) => !decision.status || decision.status === "open").length;
  const activeEscalationCount = (program?.escalations || []).filter((entry) => entry.status === "open").length;
  const activeReportCount = [
    !!program?.narrative,
    !!(program?.deck?.programHealthSummary || program?.deck?.slides?.length),
    !!buildStatusReport(program),
    !!buildClosureSummary(program),
  ].filter(Boolean).length;

  const reports: ReportCardConfig[] = [
    {
      id: "narrative",
      icon: "✦",
      title: "Program Status",
      subtitle: "Executive narrative generated from current program signals",
      readinessLabel: program?.narrative ? "Ready" : "Not yet",
      readinessTone: program?.narrative ? "green" : narrativeIsRunning ? "amber" : "muted",
      kicker: program?.narrativeGeneratedAt ? `Updated ${new Date(program.narrativeGeneratedAt).toLocaleDateString()}` : "Awaiting first narrative",
      isRunning: narrativeIsRunning,
      onRefresh: onTriggerNarrative,
      content: program?.narrative || null,
    },
    {
      id: "deck",
      icon: "▤",
      title: "Status Deck",
      subtitle: "Slide-ready summary for stakeholders",
      readinessLabel: program?.deck ? "Ready" : "Not yet",
      readinessTone: program?.deck ? "green" : deckIsRunning ? "amber" : "muted",
      kicker: program?.deck?.audience || "Presentation-ready narrative and health posture",
      isRunning: deckIsRunning,
      onRefresh: onTriggerDeck,
      content: program?.deck?.programHealthSummary || program?.deck?.slides?.[0]?.speakerNotes || null,
    },
    {
      id: "status",
      icon: "◎",
      title: "Status Report",
      subtitle: "Combined health, schedule and budget snapshot",
      readinessLabel: buildStatusReport(program) ? "Ready" : "Developing",
      readinessTone: buildStatusReport(program) ? "green" : "amber",
      kicker: program?.healthHeatmap?.summary || program?.budgetTracking?.healthReason || "Built from the latest narrative, plan, and health signals",
      isRunning: false,
      onRefresh: null,
      content: buildStatusReport(program),
    },
    {
      id: "closure",
      icon: "⬡",
      title: "Closure Pack",
      subtitle: "Benefits realised, lessons learned, and handoff posture",
      readinessLabel: program?.closure?.status === "ready" || program?.closure?.status === "approved" ? "Ready" : "Not yet",
      readinessTone: program?.closure?.status === "ready" || program?.closure?.status === "approved"
        ? "green"
        : closureIsRunning
          ? "amber"
          : "muted",
      kicker: program?.closure?.benefitsSummary?.planned || "Benefits, lessons, and handoff summary",
      isRunning: closureIsRunning,
      onRefresh: onTriggerClosure,
      content: buildClosureSummary(program),
    },
  ];

  return (
    <div className="v3-section v3-reports-layout">
      <section className="v3-reports-hero">
        <div className="v3-reports-hero-head">
          <div className="v3-reports-hero-copy">
            <div className="v3-card-title" style={{ marginBottom: 10 }}>Executive reports</div>
            <h1 className="v3-reports-hero-title">Presentation-ready outputs for leadership and stakeholders</h1>
            <p className="v3-reports-hero-body">
              Each report is generated from the latest program signals so leaders can review posture, risk, value, and closure without navigating the full platform.
            </p>
          </div>

          <div className="v3-reports-hero-status">
            <span className="v3-chip blue">{activeReportCount} of 4 ready</span>
            {activeEscalationCount ? <span className="v3-chip red">{activeEscalationCount} escalation{activeEscalationCount > 1 ? "s" : ""}</span> : null}
            {openDecisionCount ? <span className="v3-chip amber">{openDecisionCount} decisions open</span> : null}
          </div>
        </div>

        <div className="v3-reports-hero-grid">
          <div className="v3-reports-glass-card">
            <div className="v3-card-title">Ready now</div>
            <div className="v3-reports-glass-value">{activeReportCount}/4</div>
            <div className="v3-reports-glass-sub">
              Narrative, deck, status, and closure outputs are tracked as executive-ready artifacts.
            </div>
          </div>

          <div className="v3-reports-glass-card">
            <div className="v3-card-title">Current posture</div>
            <div className="v3-reports-glass-value">
              {program?.healthHeatmap?.overallRag ? program.healthHeatmap.overallRag.toUpperCase() : "Forming"}
            </div>
            <div className="v3-reports-glass-sub">
              {program?.healthHeatmap?.summary || program?.budgetTracking?.healthReason || "The report stack will sharpen as more program signals arrive."}
            </div>
          </div>
        </div>
      </section>

      {reports.map((report) => (
        <div key={report.id} className="v3-report-card">
          <div className="v3-report-card-header" onClick={() => toggle(report.id)}>
            <div className="v3-reports-card-head">
              <div className="v3-reports-card-icon">
                {report.icon}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--v3-text-primary)" }}>{report.title}</div>
                <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>{report.subtitle}</div>
                <div className="v3-reports-card-kicker">{report.kicker}</div>
              </div>
            </div>
            <div className="v3-reports-card-meta">
              <span className={`v3-chip ${report.readinessTone}`}>{report.readinessLabel}</span>
              {report.isRunning ? <div className="v3-thinking-dot" /> : null}
              <span style={{ color: "var(--v3-text-muted)", fontSize: 16 }}>
                {expanded === report.id ? "∧" : "∨"}
              </span>
            </div>
          </div>

          {expanded === report.id ? (
            <div className="v3-report-card-body">
              {report.content ? (
                <>
                  <div className="v3-reports-body-label">Executive preview</div>
                  <p style={{ marginTop: 0, lineHeight: 1.72 }}>{report.content}</p>
                  {report.onRefresh ? (
                    <button
                      className="v3-button ghost"
                      style={{ fontSize: 12, marginTop: 12 }}
                      disabled={report.isRunning}
                      onClick={report.onRefresh}
                    >
                      {report.isRunning ? "Regenerating…" : "↻ Regenerate"}
                    </button>
                  ) : null}
                </>
              ) : (
                <div style={{ color: "var(--v3-text-muted)", fontSize: 13 }}>
                  {report.isRunning ? (
                    "Generating this report…"
                  ) : (
                    <>
                      Not generated yet.{" "}
                      {report.onRefresh ? (
                        <span
                          style={{ color: "var(--v3-accent)", cursor: "pointer" }}
                          onClick={report.onRefresh}
                        >
                          Generate now
                        </span>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function buildStatusReport(program: ProgramSummary | null): string | null {
  if (!program) return null;
  const parts: string[] = [];
  if (program.narrative) {
    parts.push(program.narrative);
  }
  const blocker = program.plan?.blockerSummary?.[0];
  if (blocker?.blocker) {
    parts.push(`Key blocker: ${blocker.blocker}.`);
  }
  if (program.healthHeatmap) {
    parts.push(`Health: ${program.healthHeatmap.overallRag} · ${program.healthHeatmap.summary}`);
  }
  return parts.length ? parts.join(" ") : null;
}

function buildClosureSummary(program: ProgramSummary | null): string | null {
  const closure = program?.closure;
  if (!closure || closure.status === "not-ready") return null;
  if (closure.benefitsSummary?.commentary) return closure.benefitsSummary.commentary;
  if (closure.recommendations.length) return closure.recommendations[0];
  if (closure.lessonsLearned.length) return closure.lessonsLearned[0]?.lesson || null;
  return null;
}
