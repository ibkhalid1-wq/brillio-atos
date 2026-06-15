import React from "react";
import type { PhaseAgentTask } from "@/lib/adamPhaseAgentTypes";
import type { ProgramSummary } from "@/new/types";
import type { V3MoreView } from "@/v3/types";
import TaskQueuePanel from "@/v3/components/TaskQueuePanel";
import { ArtifactLedger, type GenerationHint } from "@/v3/components/ArtifactLedger";
import { KnowledgeGraphPanel } from "@/v3/components/KnowledgeGraphPanel";
import { buildPhaseArtifacts } from "@/v3/lib/artifactModel";
import { derivePhaseBlockers, BLOCKER_CATEGORY_LABEL, type BlockerSeverity } from "@/v3/lib/phaseBlockers";

// Phase inputs now live inline as the primary working area in StageView, so the
// drawer is a focused copilot: Tasks + Blockers + Intelligence (artifacts / graph).
type ContextSection = "tasks" | "blockers" | "intelligence";
type IntelligenceView = "artifacts" | "graph" | "uploads";

const SEVERITY_DOT: Record<BlockerSeverity, string> = {
  critical: "var(--v3-red)",
  high: "var(--v3-red)",
  medium: "var(--v3-amber)",
  low: "var(--v3-text-muted)",
};

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
  onOpenMoreView?: (view: V3MoreView) => void;
  onOpenDecide?: () => void;
  onDownloadArtifact?: (artifactId: string) => void;
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
  onOpenMoreView,
  onOpenDecide,
  onDownloadArtifact,
  generationHint,
}: ContextDrawerProps) {
  const [activeSection, setActiveSection] = React.useState<ContextSection>("tasks");
  const [intelligenceView, setIntelligenceView] = React.useState<IntelligenceView>("artifacts");
  const phaseLedger = React.useMemo(() => {
    if (!program || !phaseId) return null;
    return buildPhaseArtifacts(program, phaseId);
  }, [program, phaseId]);
  const blockers = React.useMemo(() => {
    if (!program || !phaseId) return [];
    return derivePhaseBlockers(program, phaseId);
  }, [program, phaseId]);

  function runBlockerAction(action?: { label: string; agentId?: string; workspaceId?: V3MoreView }) {
    if (!action) return;
    if (action.agentId) { onRunAgent(action.agentId); return; }
    if (action.workspaceId) { onOpenMoreView?.(action.workspaceId); return; }
    if (action.label.toLowerCase().includes("decision")) { onOpenDecide?.(); return; }
  }

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
            ["blockers", "Blockers"],
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
              {section === "blockers" && blockers.length > 0 ? (
                <span className="v3-context-drawer-tab-badge">{blockers.length > 9 ? "9+" : blockers.length}</span>
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

          {activeSection === "blockers" ? (
            <div className="v3-context-blockers">
              <div className="v3-card-title">What's holding this phase back</div>
              <div className="v3-context-docs-copy">
                Readiness, confidence, governance, dependency and artifact gaps — ranked by impact, each with a way to resolve it.
              </div>
              {blockers.length === 0 ? (
                <div className="v3-context-blockers-empty">
                  No active blockers. This phase has a clear path to its gate.
                </div>
              ) : (
                <ul className="v3-context-blockers-list">
                  {blockers.map((item) => (
                    <li key={item.id} className="v3-context-blocker">
                      <span
                        className="v3-context-blocker-dot"
                        style={{ background: SEVERITY_DOT[item.severity] }}
                        aria-hidden="true"
                      />
                      <div className="v3-context-blocker-main">
                        <div className="v3-context-blocker-head">
                          <span className="v3-context-blocker-label">{item.label}</span>
                          <span className="v3-context-blocker-cat">{BLOCKER_CATEGORY_LABEL[item.category]}</span>
                        </div>
                        {item.detail ? (
                          <div className="v3-context-blocker-detail">{item.detail}</div>
                        ) : null}
                        <div className="v3-context-blocker-foot">
                          {item.expectedGain > 0 ? (
                            <span className="v3-context-blocker-gain">+{item.expectedGain} pts</span>
                          ) : null}
                          {item.action ? (
                            <button
                              type="button"
                              className="v3-button ghost"
                              style={{ fontSize: 12 }}
                              onClick={() => runBlockerAction(item.action)}
                            >
                              {item.action.label}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {activeSection === "intelligence" ? (
            <div className="v3-context-docs">
              <div className="v3-context-intel-switch" style={{ display: "flex", gap: 4, marginBottom: 12 }}>
                {([
                  ["artifacts", "Artifacts"],
                  ["graph", "Graph"],
                  ["uploads", "Uploads"],
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
                    <ArtifactLedger
                      phase={phaseLedger}
                      onOpenArtifact={() => onOpenDocuments()}
                      onDownloadArtifact={onDownloadArtifact}
                      generationHint={generationHint}
                    />
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

              {intelligenceView === "uploads" ? (
                <>
                  <div className="v3-card-title">Uploads</div>
                  <div className="v3-context-docs-copy">
                    Documents the team provided for this phase — the evidence ADAM reads from. Upload more to enrich the phase.
                  </div>
                  {(() => {
                    const uploads = (phaseLedger?.artifacts ?? []).filter((node) => node.present && node.origin === "uploaded");
                    if (uploads.length === 0) {
                      return (
                        <div className="v3-context-blockers-empty">
                          No uploaded documents yet. Upload source material to ground this phase's artifacts.
                        </div>
                      );
                    }
                    return (
                      <ul className="v3-context-uploads-list">
                        {uploads.map((node) => (
                          <li key={node.key} className="v3-context-upload">
                            <div className="v3-context-upload-main">
                              <span className="v3-context-upload-label">{node.label}</span>
                              {node.evidence ? (
                                <span className="v3-context-upload-meta">{node.evidence}</span>
                              ) : null}
                            </div>
                            {node.artifactId && onDownloadArtifact ? (
                              <button
                                type="button"
                                className="v3-button ghost"
                                style={{ fontSize: 11, padding: "3px 8px" }}
                                onClick={() => onDownloadArtifact(node.artifactId!)}
                              >
                                Download
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                  <div className="v3-context-docs-actions">
                    <button type="button" className="v3-button primary" style={{ fontSize: 12 }} onClick={onUploadDocument}>
                      Upload document
                    </button>
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
