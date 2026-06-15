import React from "react";
import type { PhaseAgentTask } from "@/lib/adamPhaseAgentTypes";
import type { ProgramSummary } from "@/new/types";
import TaskQueuePanel from "@/v3/components/TaskQueuePanel";
import { ArtifactLedger, type GenerationHint } from "@/v3/components/ArtifactLedger";
import { KnowledgeGraphPanel } from "@/v3/components/KnowledgeGraphPanel";
import { buildPhaseArtifacts } from "@/v3/lib/artifactModel";

// Phase inputs now live inline as the primary working area in StageView, so the
// drawer is a focused copilot: Tasks + Intelligence (artifacts / graph).
type ContextSection = "tasks" | "intelligence";
type IntelligenceView = "artifacts" | "graph";

interface ContextDrawerProps {
  open: boolean;
  onToggle: () => void;
  program: ProgramSummary | null;
  phaseId: string | null;
  tasks: PhaseAgentTask[];
  pendingTaskCount: number;
  onUploadDocument: () => void;
  onAnswerQuestion: (taskId: string, answer: string) => Promise<void>;
  onAcknowledgeTask: (taskId: string) => void;
  onRunAgent: (agentId: string) => void;
  onOpenDocuments: () => void;
  generationHint?: GenerationHint | null;
}

export function ContextDrawer({
  open,
  onToggle,
  program,
  phaseId,
  tasks,
  pendingTaskCount,
  onUploadDocument,
  onAnswerQuestion,
  onAcknowledgeTask,
  onRunAgent,
  onOpenDocuments,
  generationHint,
}: ContextDrawerProps) {
  const [activeSection, setActiveSection] = React.useState<ContextSection>("tasks");
  const [intelligenceView, setIntelligenceView] = React.useState<IntelligenceView>("artifacts");
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
            ["tasks", "Tasks"],
            ["intelligence", "Intelligence"],
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
          {activeSection === "tasks" && phaseId ? (
            <TaskQueuePanel
              tasks={tasks}
              phaseId={phaseId}
              onAnswerQuestion={onAnswerQuestion}
              onAcknowledgeTask={onAcknowledgeTask}
              onRunAgent={onRunAgent}
            />
          ) : null}

          {activeSection === "intelligence" ? (
            <div className="v3-context-docs">
              <div className="v3-context-intel-switch" style={{ display: "flex", gap: 4, marginBottom: 12 }}>
                {([
                  ["artifacts", "Artifacts"],
                  ["graph", "Graph"],
                ] as Array<[IntelligenceView, string]>).map(([view, label]) => (
                  <button
                    key={view}
                    type="button"
                    className={`v3-context-drawer-tab ${intelligenceView === view ? "active" : ""}`}
                    style={{ flex: 1, fontSize: 12 }}
                    onClick={() => setIntelligenceView(view)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {intelligenceView === "artifacts" ? (
                <>
                  <div className="v3-card-title">Artifacts</div>
                  <div className="v3-context-docs-copy">
                    What this phase needs, what exists, and how each piece connects — with quality and provenance.
                  </div>
                  <div className="v3-context-artifacts">
                    <ArtifactLedger phase={phaseLedger} onOpenArtifact={() => onOpenDocuments()} generationHint={generationHint} />
                  </div>
                  <div className="v3-context-docs-actions">
                    <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={onUploadDocument}>
                      Upload document
                    </button>
                    <button type="button" className="v3-button primary" style={{ fontSize: 12 }} onClick={onOpenDocuments}>
                      Open documents →
                    </button>
                  </div>
                </>
              ) : null}

              {intelligenceView === "graph" ? (
                <>
                  <div className="v3-card-title">Knowledge graph</div>
                  <div className="v3-context-docs-copy">
                    This phase's system of record — expand each entity to trace artifacts, decisions, risks, milestones and gates down to the final node.
                  </div>
                  <div className="v3-context-artifacts">
                    <KnowledgeGraphPanel program={program} phaseId={phaseId} />
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
