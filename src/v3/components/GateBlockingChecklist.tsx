import React, { useMemo } from "react";
import type { GateReview, ProgramSummary } from "@/new/types";
import type { V3MoreView } from "@/v3/types";
import { derivePhaseBlockers, BLOCKER_CATEGORY_LABEL } from "@/v3/lib/phaseBlockers";

/**
 * GateBlockingChecklist — the single "what's between you and the gate" list.
 *
 * Reads from derivePhaseBlockers (the consolidated blocker engine), which already
 * merges missing artifacts, unmet exit criteria, open risks/blockers, unmet
 * dependencies and overdue governance decisions into one ranked list. Each row
 * carries an inline action that routes to the right place to resolve it.
 *
 * Renders nothing when the gate is already approved or there is nothing blocking.
 */

interface GateBlockingChecklistProps {
  program: ProgramSummary;
  phaseId: string;
  gateStatus: GateReview["status"] | null;
  onRunAgent: (agentId: string) => void;
  onOpenMoreView?: (view: V3MoreView) => void;
  onOpenDecide: () => void;
}

const SEVERITY_DOT: Record<string, string> = {
  critical: "var(--v3-red)",
  high: "var(--v3-red)",
  medium: "var(--v3-amber)",
  low: "var(--v3-amber)",
};

export function GateBlockingChecklist({
  program,
  phaseId,
  gateStatus,
  onRunAgent,
  onOpenMoreView,
  onOpenDecide,
}: GateBlockingChecklistProps) {
  const blockers = useMemo(() => derivePhaseBlockers(program, phaseId), [program, phaseId]);

  if (gateStatus === "approved" || blockers.length === 0) return null;

  const top = blockers.slice(0, 6);

  return (
    <div className="v3-card v3-gate-blockers">
      <div className="v3-gate-blockers-head">
        <div className="v3-card-title v3-card-title--flush">What's between you and the gate</div>
        <span className="v3-chip amber v3-chip-tight">{blockers.length}</span>
      </div>
      <div className="v3-gate-blockers-list">
        {top.map((item) => {
          const runAction = () => {
            if (item.action?.agentId) { onRunAgent(item.action.agentId); return; }
            if (item.action?.workspaceId) { onOpenMoreView?.(item.action.workspaceId); return; }
            if (item.id.startsWith("decision:")) { onOpenDecide(); return; }
          };
          const hasAction = !!(item.action?.agentId || item.action?.workspaceId || item.id.startsWith("decision:"));
          return (
            <div key={item.id} className="v3-gate-blocker-row">
              <span className="v3-gate-blocker-dot" style={{ color: SEVERITY_DOT[item.severity] ?? "var(--v3-amber)" }}>•</span>
              <div className="v3-gate-blocker-body">
                <div className="v3-gate-blocker-label">{item.label}</div>
                {item.detail ? <div className="v3-gate-blocker-detail">{item.detail}</div> : null}
                <div className="v3-gate-blocker-tags">
                  <span className="v3-chip muted v3-chip-tight">{BLOCKER_CATEGORY_LABEL[item.category]}</span>
                  {item.expectedGain > 0 ? (
                    <span className="v3-chip green v3-chip-tight">+{item.expectedGain} pts</span>
                  ) : null}
                </div>
              </div>
              {hasAction ? (
                <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={runAction}>
                  {item.action?.label ?? "Resolve"} →
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default GateBlockingChecklist;
