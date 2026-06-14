import React from "react";
import type { PhaseAgentTask } from "@/lib/adamPhaseAgentTypes";
import type { ProgramSummary } from "@/new/types";
import PhaseInputsPanel from "@/v3/components/PhaseInputsPanel";
import TaskQueuePanel from "@/v3/components/TaskQueuePanel";
import { ArtifactLedger } from "@/v3/components/ArtifactLedger";
import { KnowledgeGraphPanel } from "@/v3/components/KnowledgeGraphPanel";
import { buildPhaseArtifacts } from "@/v3/lib/artifactModel";

type ContextSection = "inputs" | "tasks" | "docs" | "graph";

interface ContextDrawerProps {
  open: boolean;
  onToggle: () => void;
  program: ProgramSummary | null;
  phaseId: string | null;
  tasks: PhaseAgentTask[];
  pendingTaskCount: number;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>) => Promise<void>;
  onUploadDocument: () => void;
  onAnswerQuestion: (taskId: string, answer: string) => Promise<void>;
  onAcknowledgeTask: (taskId: string) => void;
  onRunAgent: (agentId: string) => void;
  onOpenDocuments: () => void;
}

export function ContextDrawer({
  open,
  onToggle,
  program,
  phaseId,
  tasks,
  pendingTaskCount,
  onSaveInputs,
  onUploadDocument,
  onAnswerQuestion,
  onAcknowledgeTask,
  onRunAgent,
  onOpenDocuments,
}: ContextDrawerProps) {
  const [activeSection, setActiveSection] = React.useState<ContextSection>("inputs");
  const phaseLedger = React.useMemo(() => {
    if (!program || !phaseId) return null;
    return buildPhaseArtifacts(program, phaseId);
  }, [program, phaseId]);

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
        <div className="v3-context-drawer-tabs">
          {([
            ["inputs", "Inputs"],
            ["tasks", "Tasks"],
            ["docs", "Docs"],
            ["graph", "Graph"],
          ] as Array<[ContextSection, string]>).map(([section, label]) => (
            <button
              key={section}
              type="button"
              className={`v3-context-drawer-tab ${activeSection === section ? "active" : ""}`}
              onClick={() => setActiveSection(section)}
            >
              {label}
              {section === "tasks" && pendingTaskCount > 0 ? (
                <span className="v3-context-drawer-tab-badge">{pendingTaskCount > 9 ? "9+" : pendingTaskCount}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="v3-context-drawer-body">
          {activeSection === "inputs" && program && phaseId ? (
            <PhaseInputsPanel
              program={program}
              phaseId={phaseId}
              onSave={onSaveInputs}
              onUploadDocument={onUploadDocument}
            />
          ) : null}

          {activeSection === "tasks" && phaseId ? (
            <TaskQueuePanel
              tasks={tasks}
              phaseId={phaseId}
              onAnswerQuestion={onAnswerQuestion}
              onAcknowledgeTask={onAcknowledgeTask}
              onRunAgent={onRunAgent}
            />
          ) : null}

          {activeSection === "docs" ? (
            <div className="v3-context-docs">
              <div className="v3-card-title">Artifacts</div>
              <div className="v3-context-docs-copy">
                What this phase needs, what exists, and how each piece connects — with quality and provenance.
              </div>
              <div className="v3-context-artifacts">
                <ArtifactLedger phase={phaseLedger} onOpenArtifact={() => onOpenDocuments()} />
              </div>
              <div className="v3-context-docs-actions">
                <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={onUploadDocument}>
                  Upload document
                </button>
                <button type="button" className="v3-button primary" style={{ fontSize: 12 }} onClick={onOpenDocuments}>
                  Open documents →
                </button>
              </div>
            </div>
          ) : null}

          {activeSection === "graph" ? (
            <div className="v3-context-docs">
              <div className="v3-card-title">Knowledge graph</div>
              <div className="v3-context-docs-copy">
                The programme's system of record — every phase, artifact, decision, risk, milestone and gate, and how they connect.
              </div>
              <div className="v3-context-artifacts">
                <KnowledgeGraphPanel program={program} />
              </div>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
