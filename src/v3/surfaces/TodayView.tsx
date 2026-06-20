import React, { useMemo } from "react";
import { formatCurrency } from "@/new/lib/programData";
import type { DecisionSummary, Escalation, ProgramSummary } from "@/new/types";
import type { V3MoreView, V3Nudge, V3ReportId } from "@/v3/types";
import { phaseNameById, phaseTone, timeAgo } from "@/v3/utils";

interface TodayViewProps {
  program: ProgramSummary | null;
  openEscalations: Escalation[];
  openDecisions: DecisionSummary[];
  scopeRiskHigh: boolean;
  programReady: boolean;
  narrativeIsRunning: boolean;
  nudges: V3Nudge[];
  onOpenDecisions: () => void;
  onOpenPhase: (phaseId: string) => void;
  onOpenMoreView: (view: V3MoreView) => void;
  onOpenReport: (reportId: V3ReportId) => void;
}

type PriorityItemType = "decision" | "action" | "urgent";

interface PriorityItem {
  type: PriorityItemType;
  label: string;
  sub?: string;
  phaseId?: string;
}

function valueTone(value: number): "green" | "amber" | "red" | "gray" {
  return phaseTone(value);
}

export default function TodayView({
  program,
  openEscalations,
  openDecisions,
  scopeRiskHigh,
  programReady,
  narrativeIsRunning,
  nudges,
  onOpenDecisions,
  onOpenPhase,
  onOpenMoreView,
  onOpenReport,
}: TodayViewProps) {
  const narrative = program?.narrative || "";
  const plan = program?.plan || null;
  const budget = program?.budgetTracking || null;
  const health = program?.healthHeatmap || null;
  const activePhase = program?.phases.find((phase) => phase.id === program.activePhaseId) || program?.phases[0] || null;
  const activePhaseName = activePhase ? phaseNameById(program, activePhase.id) : "No active phase";
  const activeNextAction = activePhase ? plan?.nextThreeActions.find((action) => (
    typeof action.phase === "string" && action.phase.toLowerCase().includes(activePhase.id.toLowerCase())
  )) : null;
  const focusSummary = activeNextAction?.action
    || activePhase?.objective
    || program?.criticalPath?.currentBottleneck?.recommendedAction
    || "Review the latest transformation posture and align the next executive move.";
  const postureTone = budget?.healthSignal || health?.overallRag || valueTone(program?.readiness ?? 0);
  const postureLabel = postureTone === "green"
    ? "Healthy delivery posture"
    : postureTone === "amber"
      ? "Attention required"
      : postureTone === "red"
        ? "Action required"
        : "Signal forming";
  const nextDecision = openDecisions[0] || null;
  const nextEscalation = openEscalations[0] || null;

  const priorityItems = useMemo<PriorityItem[]>(() => {
    const items: PriorityItem[] = [];

    openEscalations.slice(0, 1).forEach((entry) => {
      items.push({
        type: "urgent",
        label: entry.title || "Open escalation requires attention",
        sub: entry.summary || undefined,
        phaseId: entry.linkedPhaseId || undefined,
      });
    });

    openDecisions
      .filter((entry) => entry.priority === "critical" || entry.priority === "high")
      .slice(0, 2)
      .forEach((entry) => {
        items.push({
          type: "decision",
          label: entry.question || entry.title || "Decision needed",
          sub: phaseNameById(program, entry.phaseId),
          phaseId: entry.phaseId,
        });
      });

    (plan?.nextThreeActions || [])
      .slice(0, Math.max(0, 3 - items.length))
      .forEach((action) => {
        items.push({
          type: "action",
          label: action.action || "Advance the next move",
          sub: action.owner ? `Owner: ${action.owner}` : phaseNameById(program, action.phase),
          phaseId: action.phase,
        });
      });

    if (!items.length) {
      nudges.slice(0, 3).forEach((nudge) => {
        items.push({
          type: "action",
          label: nudge.actionLabel || nudge.message,
          sub: nudge.message,
          phaseId: program?.activePhaseId || "",
        });
      });
    }

    return items.slice(0, 3);
  }, [nudges, openDecisions, openEscalations, plan?.nextThreeActions, program]);

  const healthCells = [
    {
      label: "Readiness",
      value: `${program?.readiness ?? 0}%`,
      color: valueTone(program?.readiness ?? 0),
    },
    {
      label: "Open decisions",
      value: String(openDecisions.length),
      color: openDecisions.length > 0 ? "amber" : "green",
    },
    {
      label: "Value delivered",
      value: program?.valueDelivered ? formatCurrency(program.valueDelivered) : "—",
      color: program?.valueDelivered ? "green" : "gray",
    },
    {
      label: "Budget",
      value: budget?.healthSignal ? budget.healthSignal.toUpperCase() : (health?.overallRag ? health.overallRag.toUpperCase() : "—"),
      color: budget?.healthSignal || health?.overallRag || "gray",
    },
  ] as const;

  return (
    <div className="v3-section v3-today-layout">
      {programReady ? (
        <div className="v3-banner closure">
          <span>🎉</span>
          <div>
            <strong>Program ready to close.</strong> All exit criteria are met.
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="v3-button primary"
                style={{ fontSize: 12, padding: "6px 12px" }}
                onClick={() => onOpenReport("closure")}
              >
                View closure pack →
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {openEscalations.length > 0 && !programReady ? (
        <div className="v3-banner escalation">
          <span>⚠</span>
          <div>
            <strong>{openEscalations.length} open escalation{openEscalations.length > 1 ? "s" : ""}.</strong>{" "}
            {openEscalations[0]?.title || "Requires attention."}
          </div>
        </div>
      ) : null}

      {scopeRiskHigh ? (
        <div className="v3-banner scope">
          <span>△</span>
          <div>
            <strong>Scope risk: High.</strong> Uncontrolled scope changes detected.{" "}
            <span
              style={{ cursor: "pointer", textDecoration: "underline" }}
              onClick={() => onOpenMoreView("scope-pcr")}
            >
              Review scope log →
            </span>
          </div>
        </div>
      ) : null}

      <section className="v3-today-hero">
        <div className="v3-today-hero-head">
          <div className="v3-today-hero-copy">
            <div className="v3-card-title" style={{ marginBottom: 10 }}>Executive command center</div>
            <h1 className="v3-today-hero-title">{program?.name || "Program overview"}</h1>
            <p className="v3-today-hero-objective">
              {program?.objective || "Define the transformation objective to turn this into a live executive workspace."}
            </p>
          </div>

          <div className="v3-today-hero-status">
            <span className="v3-chip blue">{activePhaseName}</span>
            <span className={`v3-chip ${postureTone === "green" ? "green" : postureTone === "amber" ? "amber" : postureTone === "red" ? "red" : "muted"}`}>
              {postureLabel}
            </span>
            {nextEscalation ? <span className="v3-chip red">Escalation open</span> : null}
            {nextDecision ? <span className="v3-chip amber">Decision pending</span> : null}
          </div>
        </div>

        <div className="v3-today-hero-grid">
          <div className="v3-today-glass-card">
            <div className="v3-card-title">Current focus</div>
            <div className="v3-today-glass-value">{focusSummary}</div>
            <div className="v3-today-glass-sub">
              {nextEscalation?.summary || nextDecision?.question || "The next high-value move is ready for executive review."}
            </div>
          </div>

          <div className="v3-today-glass-card">
            <div className="v3-card-title">Signals to watch</div>
            <div className="v3-today-glass-list">
              <div>
                <strong>{openDecisions.length}</strong>
                <span>open decisions</span>
              </div>
              <div>
                <strong>{openEscalations.length}</strong>
                <span>active escalations</span>
              </div>
              <div>
                <strong>{program?.criticalPath?.currentBottleneck?.phaseName || activePhaseName}</strong>
                <span>bottleneck watch</span>
              </div>
            </div>
          </div>
        </div>

        <div className="v3-today-hero-actions">
          {activePhase ? (
            <button
              type="button"
              className="v3-button primary"
              onClick={() => onOpenPhase(activePhase.id)}
            >
              Open current phase
            </button>
          ) : null}
          <button
            type="button"
            className="v3-button ghost"
            onClick={() => onOpenReport("status")}
          >
            Open status report
          </button>
        </div>
      </section>

      <div className="v3-health-strip">
        {healthCells.map((cell) => (
          <div key={cell.label} className="v3-health-cell">
            <div className={`v3-health-cell-value ${cell.color}`}>{cell.value}</div>
            <div className="v3-health-cell-label">{cell.label}</div>
          </div>
        ))}
      </div>

      <div className="v3-today-content-grid">
        <section className="v3-card">
          <div className="v3-card-title">Program Status</div>
          {narrative ? (
            <>
              <p className="v3-narrative">{narrative}</p>
              <div className="v3-narrative-timestamp">
                Updated {timeAgo(program?.narrativeGeneratedAt || null)}
              </div>
            </>
          ) : (
            <div style={{ color: "var(--v3-text-muted)", fontSize: 13 }}>
              {narrativeIsRunning
                ? "Generating your program status…"
                : "No narrative yet. A status summary will appear shortly."}
            </div>
          )}
        </section>

        <section className="v3-today-side-stack">
          <div className="v3-card-sm">
            <div className="v3-card-title">Executive readout</div>
            <div className="v3-today-side-value">{activePhaseName}</div>
            <div className="v3-today-side-copy">
              {program?.criticalPath?.currentBottleneck?.reason || budget?.healthReason || health?.summary || "No bottleneck has been raised by the platform yet."}
            </div>
          </div>

          <div className="v3-card-sm">
            <div className="v3-card-title">Value posture</div>
            <div className="v3-today-side-value">
              {program?.valueDelivered ? formatCurrency(program.valueDelivered) : "—"}
            </div>
            <div className="v3-today-side-copy">
              {budget?.projectedBenefits
                ? `Projected benefits: ${formatCurrency(budget.projectedBenefits)}`
                : "Projected benefits will appear once financial signals are populated."}
            </div>
          </div>
        </section>
      </div>

      {priorityItems.length > 0 ? (
        <section>
          <div className="v3-card-title" style={{ marginBottom: 12 }}>Priority Actions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {priorityItems.map((item, index) => (
              <div
                key={`${item.type}-${index}-${item.label}`}
                className="v3-action-card"
                onClick={() => {
                  if (item.type === "urgent" || item.type === "decision") {
                    onOpenDecisions();
                    return;
                  }
                  if (item.phaseId) {
                    onOpenPhase(item.phaseId);
                    return;
                  }
                  onOpenMoreView("plan");
                }}
              >
                <div className={`v3-action-icon ${item.type}`}>
                  {item.type === "decision" ? "◈" : item.type === "urgent" ? "⚡" : "→"}
                </div>
                <div>
                  <div className="v3-action-label">{item.label}</div>
                  {item.sub ? <div className="v3-action-sub">{item.sub}</div> : null}
                </div>
                <span
                  className={`v3-chip ${item.type === "urgent" ? "red" : item.type === "decision" ? "blue" : "green"}`}
                  style={{ marginLeft: "auto", flexShrink: 0, fontSize: 10 }}
                >
                  {item.type === "decision" ? "Decision" : item.type === "urgent" ? "Urgent" : "Action"}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {!narrative && priorityItems.length === 0 && !programReady ? (
        <div className="v3-empty">
          <div className="v3-empty-icon">✦</div>
          <div className="v3-empty-title">The workspace is getting started</div>
          <div className="v3-empty-body">
            The platform is analysing your program data. Check back in a moment.
          </div>
        </div>
      ) : null}
    </div>
  );
}
