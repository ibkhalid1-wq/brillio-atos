import React from "react";
import type { PhaseAgentTask } from "@/lib/adamPhaseAgentTypes";
import type { DecisionSummary, ProgramSummary, RAIDEntry, RAIDEntryType } from "@/new/types";
import type { V3MoreView } from "@/v3/types";
import TaskQueuePanel from "@/v3/components/TaskQueuePanel";
import { PhaseRailPanels } from "@/v3/components/PhaseRailPanels";

// The expandable right rail. Its body is the canonical two-section rail surface
// (Action Center + Intelligence). Pending agent tasks — questions ADAM needs
// answered — surface as a compact banner above it so nothing is lost.
type RaidDraft = {
  type: RAIDEntryType;
  title: string;
  description: string;
  severity: RAIDEntry["severity"];
  phase: string;
  mitigation?: string;
};

interface ContextDrawerProps {
  open: boolean;
  onToggle: () => void;
  program: ProgramSummary | null;
  phaseId: string | null;
  tasks: PhaseAgentTask[];
  pendingTaskCount: number;
  decisions: DecisionSummary[];
  agentsAvailable?: boolean;
  onUploadDocument: () => void;
  onAnswerQuestion: (taskId: string, answer: string) => Promise<void>;
  onAcknowledgeTask: (taskId: string) => void;
  onRunAgent: (agentId: string) => void;
  onAddDecision: (decision: Omit<DecisionSummary, "id" | "status" | "createdAt">) => Promise<void>;
  onAddRaid: (draft: RaidDraft) => Promise<void>;
  onCloseRaid: (entryId: string, note?: string) => Promise<void>;
  onOpenMoreView?: (view: V3MoreView) => void;
  onOpenDecide?: () => void;
}

export function ContextDrawer({
  open,
  onToggle,
  program,
  phaseId,
  tasks,
  pendingTaskCount,
  decisions,
  agentsAvailable = true,
  onUploadDocument,
  onAnswerQuestion,
  onAcknowledgeTask,
  onRunAgent,
  onAddDecision,
  onAddRaid,
  onCloseRaid,
  onOpenMoreView,
  onOpenDecide,
}: ContextDrawerProps) {
  return (
    <div className={`v3-context-drawer-shell ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="v3-context-drawer-toggle"
        onClick={onToggle}
        aria-label={open ? "Close context panel" : "Open context panel"}
      >
        <span aria-hidden="true">{open ? "▸" : "◂"}</span>
        {!open && pendingTaskCount > 0 ? (
          <span className="v3-context-drawer-toggle-badge">{pendingTaskCount > 9 ? "9+" : pendingTaskCount}</span>
        ) : null}
      </button>

      <aside className="v3-context-drawer" aria-label="Context drawer">
        <div className="v3-context-drawer-body">
          {pendingTaskCount > 0 && phaseId ? (
            <div className="v3-context-drawer-tasks">
              <div className="v3-card-title v3-card-title--flush">ADAM needs you</div>
              <TaskQueuePanel
                tasks={tasks}
                phaseId={phaseId}
                onAnswerQuestion={onAnswerQuestion}
                onAcknowledgeTask={onAcknowledgeTask}
                onRunAgent={onRunAgent}
              />
            </div>
          ) : null}

          {program && phaseId ? (
            <PhaseRailPanels
              program={program}
              phaseId={phaseId}
              decisions={decisions}
              agentsAvailable={agentsAvailable}
              onAddDecision={onAddDecision}
              onAddRaid={onAddRaid}
              onCloseRaid={onCloseRaid}
              onOpenDecide={onOpenDecide ?? (() => {})}
              onRunAgent={onRunAgent}
              onOpenMoreView={onOpenMoreView ?? (() => {})}
              onUploadDocument={onUploadDocument}
            />
          ) : null}
        </div>
      </aside>
    </div>
  );
}
