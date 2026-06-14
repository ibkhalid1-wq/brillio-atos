import React from "react";
import type { PhaseAgentTask } from "@/lib/adamPhaseAgentTypes";
import type { ProgramSummary } from "@/new/types";
import PhaseInputsPanel from "@/v3/components/PhaseInputsPanel";
import TaskQueuePanel from "@/v3/components/TaskQueuePanel";

type ContextSection = "inputs" | "tasks" | "docs";

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
  const phaseArtifacts = React.useMemo(() => {
    if (!program || !phaseId) return [];
    return (program.artifacts || [])
      .filter((artifact) => artifact.phaseId === phaseId || (!artifact.phaseId && phaseId === "program"))
      .slice(0, 6);
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
              <div className="v3-card-title">Documents</div>
              <div className="v3-context-docs-copy">
                Upload supporting material, review generated phase artifacts, or open the document workspace for this programme.
              </div>
              <div className="v3-context-artifacts">
                <div className="v3-context-artifacts-header">
                  <span>Phase artifacts</span>
                  <span>{phaseArtifacts.length}</span>
                </div>
                {phaseArtifacts.length ? (
                  <div className="v3-context-artifacts-list">
                    {phaseArtifacts.map((artifact) => (
                      <button
                        key={`${artifact.phaseId}-${artifact.id}`}
                        type="button"
                        className="v3-context-artifact-row"
                        onClick={onOpenDocuments}
                      >
                        <span>
                          <strong>{artifact.title}</strong>
                          <small>{artifact.status} · v{artifact.versionNumber}</small>
                        </span>
                        <span aria-hidden="true">›</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="v3-context-artifacts-empty">
                    No artifacts generated for this phase yet.
                  </div>
                )}
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
        </div>
      </aside>
    </div>
  );
}
