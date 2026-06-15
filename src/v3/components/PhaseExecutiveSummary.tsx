import React from "react";
import type { ProgramSummary } from "@/new/types";
import { derivePhaseExecutiveSummary, type PhaseVerdict } from "@/v3/lib/phaseExecutiveSummary";
import { derivePhaseMethodologyCompleteness } from "@/v3/lib/phaseMethodologyCompleteness";

function methodologyTone(pct: number): "green" | "amber" | "red" {
  if (pct >= 100) return "green";
  if (pct >= 50) return "amber";
  return "red";
}

const VERDICT_TONE: Record<PhaseVerdict, "green" | "amber" | "red"> = {
  ready: "green",
  progressing: "amber",
  blocked: "red",
};

const VERDICT_LABEL: Record<PhaseVerdict, string> = {
  ready: "Ready to progress",
  progressing: "On track",
  blocked: "Blocked",
};

/**
 * "Executive snapshot" — a condensed, 15-second read of the phase pinned above
 * the working zones. Collapsed by default to a single headline line; expand for
 * the scores, the top blocker and the single next action. The open/closed state
 * is persisted per browser so a sponsor-minded user keeps it open and a builder
 * keeps it tucked away. Reads only the pure executive projection, so it can never
 * contradict the detailed surfaces below it.
 */
export function PhaseExecutiveSummary({
  program,
  phaseId,
  onRunAgent,
  onOpenMoreView,
}: {
  program: ProgramSummary | null;
  phaseId: string | null;
  onRunAgent?: (agentId: string) => void;
  onOpenMoreView?: (view: string) => void;
}) {
  const STORAGE_KEY = "atlas-v3-exec-snapshot-open";
  const [open, setOpen] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  function toggle() {
    setOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const summary = React.useMemo(
    () => derivePhaseExecutiveSummary(program, phaseId),
    [program, phaseId],
  );

  const methodology = React.useMemo(
    () => derivePhaseMethodologyCompleteness(program, phaseId),
    [program, phaseId],
  );

  if (!summary) return null;

  const tone = VERDICT_TONE[summary.verdict];

  function runNextAction() {
    const action = summary?.nextAction;
    if (!action) return;
    if (action.agentId && onRunAgent) onRunAgent(action.agentId);
    else if (action.workspaceId && onOpenMoreView) onOpenMoreView(action.workspaceId);
  }

  const canActNext = !!summary.nextAction && (
    (!!summary.nextAction.agentId && !!onRunAgent) ||
    (!!summary.nextAction.workspaceId && !!onOpenMoreView)
  );

  return (
    <div className={`v3-exec-snapshot ${tone}`}>
      <button type="button" className="v3-exec-snapshot-head" onClick={toggle} aria-expanded={open}>
        <span className={`v3-exec-snapshot-dot ${tone}`} aria-hidden="true" />
        <span className="v3-exec-snapshot-verdict">{VERDICT_LABEL[summary.verdict]}</span>
        <span className="v3-exec-snapshot-headline">{summary.headline}</span>
        <span className="v3-exec-snapshot-scores">
          <span className={`v3-chip ${tone}`}>R {summary.readinessScore}%</span>
          <span className={`v3-chip ${summary.confidenceScore >= 75 ? "green" : summary.confidenceScore >= 50 ? "amber" : "red"}`}>
            C {summary.confidenceScore}%
          </span>
          {summary.blockerCount > 0 ? (
            <span className="v3-chip muted">{summary.blockerCount} blocker{summary.blockerCount === 1 ? "" : "s"}</span>
          ) : null}
          {methodology && methodology.total > 0 ? (
            <span
              className={`v3-chip ${methodologyTone(methodology.pct)}`}
              title={`Methodology · ${methodology.present} of ${methodology.total} requirements met`}
            >
              M {methodology.pct}%
            </span>
          ) : null}
        </span>
        <span className="v3-exec-snapshot-caret">{open ? "▴" : "▾"}</span>
      </button>

      {open ? (
        <div className="v3-exec-snapshot-body">
          <div className="v3-exec-snapshot-metrics">
            <div className="v3-exec-snapshot-metric">
              <span className="v3-exec-snapshot-metric-val">{summary.readinessScore}%</span>
              <span className="v3-exec-snapshot-metric-lbl">Readiness · gate {summary.threshold}%</span>
            </div>
            <div className="v3-exec-snapshot-metric">
              <span className="v3-exec-snapshot-metric-val">{summary.confidenceScore}%</span>
              <span className="v3-exec-snapshot-metric-lbl">Confidence</span>
            </div>
            <div className="v3-exec-snapshot-metric">
              <span className="v3-exec-snapshot-metric-val">{summary.blockerCount}</span>
              <span className="v3-exec-snapshot-metric-lbl">
                Blockers{summary.criticalCount > 0 ? ` · ${summary.criticalCount} critical` : ""}
              </span>
            </div>
            {methodology && methodology.total > 0 ? (
              <div className="v3-exec-snapshot-metric">
                <span className="v3-exec-snapshot-metric-val">{methodology.pct}%</span>
                <span className="v3-exec-snapshot-metric-lbl">
                  Methodology · {methodology.present} of {methodology.total} met
                </span>
              </div>
            ) : null}
          </div>

          {summary.topBlocker ? (
            <div className="v3-exec-snapshot-blocker">
              <span className="v3-exec-snapshot-row-label">Top blocker</span>
              <span className="v3-exec-snapshot-row-value">{summary.topBlocker.label}</span>
            </div>
          ) : null}

          {summary.nextAction ? (
            <div className="v3-exec-snapshot-next">
              <span className="v3-exec-snapshot-row-label">Next best action</span>
              <span className="v3-exec-snapshot-row-value">{summary.nextAction.label}</span>
              {canActNext ? (
                <button type="button" className="v3-button primary v3-exec-snapshot-cta" onClick={runNextAction}>
                  Do it →
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default PhaseExecutiveSummary;
