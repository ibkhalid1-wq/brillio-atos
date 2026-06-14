import React, { useMemo, useState } from "react";
import { TransformationTwinGraph } from "@/new/components/ui/TransformationTwinGraph";
import { ArtifactCard } from "@/new/components/ui/ArtifactCard";
import { AgentCard } from "@/new/components/ui/AgentCard";
import { EmptyState } from "@/new/components/ui/EmptyState";
import type { AgentCardModel, ProgramSummary } from "@/new/types";

interface TwinViewProps {
  program: ProgramSummary | null;
  agentCards: AgentCardModel[];
  agentActivityMap: Record<string, { status: "idle" | "running" | "complete" | "blocked"; lastAction?: string; confidence?: number }>;
  onOpenWorkspace: (phaseId: string) => void;
  onViewTrace: (runId: string) => void;
}

export function TwinView({ program, agentCards, agentActivityMap, onOpenWorkspace, onViewTrace }: TwinViewProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const selectedNode = useMemo(
    () => program?.twinGraph.nodes.find((node) => String(node.id) === selectedNodeId) || null,
    [program, selectedNodeId],
  );
  const selectedPhaseId = useMemo(() => String((selectedNode?.phaseCreated as string) || (selectedNode?.properties && typeof selectedNode.properties === "object" && selectedNode.properties !== null ? (selectedNode.properties as Record<string, unknown>).phaseId : "") || ""), [selectedNode]);
  const relatedArtifacts = useMemo(
    () => selectedPhaseId ? program?.artifacts.filter((artifact) => artifact.phaseId === selectedPhaseId).slice(0, 4) || [] : [],
    [program, selectedPhaseId],
  );
  const relatedAgent = useMemo(
    () => selectedPhaseId ? agentCards.find((card) => card.phaseId === selectedPhaseId) || null : null,
    [agentCards, selectedPhaseId],
  );

  if (!program || !program.twinGraph.nodes.length) {
    return (
      <EmptyState
        context="No Twin data yet"
        explanation="The transformation graph will appear once the program begins producing phased artifacts and relationships."
        recommendation="Run the Strategy agent to seed the first Twin nodes."
      />
    );
  }

  return (
    <div className="v3-twin-layout">
      <div className="v3-card v3-twin-graph-panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, padding: "0 8px 16px" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--v3-text-primary)" }}>Transformation Twin</div>
            <div style={{ fontSize: 13, color: "var(--v3-text-muted)" }}>The live graph of strategy, capabilities, agents, decisions, risk, and value.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="v3-chip blue">{program.twinGraph.nodes.length} nodes</span>
            <span className="v3-chip muted">{program.twinGraph.edges.length} edges</span>
          </div>
        </div>
        <TransformationTwinGraph
          twinGraph={program.twinGraph}
          agentActivityMap={agentActivityMap}
          onNodeClick={(node) => setSelectedNodeId(String(node.id))}
        />
      </div>

      <aside className="v3-twin-sidebar">
        <div className="v3-card v3-twin-sidebar-inner">
          {selectedNode ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{String(selectedNode.type || "Node")}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--v3-text-primary)", marginTop: 8 }}>{String(selectedNode.label || selectedNode.id || "Untitled node")}</div>
              </div>
              <div style={{ fontSize: 13, color: "var(--v3-text-muted)" }}>
                {selectedPhaseId ? `This node is anchored to ${selectedPhaseId}.` : "No direct phase mapping was found for this node."}
              </div>
              {relatedAgent ? (
                <AgentCard
                  {...relatedAgent}
                  onViewTrace={relatedAgent.run?.id ? () => onViewTrace(relatedAgent.run?.id || "") : undefined}
                />
              ) : null}
              <div style={{ display: "grid", gap: 12 }}>
                <div className="v3-card-title">Related artifacts</div>
                {relatedArtifacts.length ? relatedArtifacts.map((artifact) => (
                  <ArtifactCard key={artifact.id} {...artifact} />
                )) : (
                  <div style={{ fontSize: 13, color: "var(--v3-text-muted)" }}>No artifacts linked to this node yet.</div>
                )}
              </div>
              {selectedPhaseId ? (
                <button type="button" className="v3-button primary" onClick={() => onOpenWorkspace(selectedPhaseId)}>
                  Open workspace
                </button>
              ) : null}
            </div>
          ) : (
            <EmptyState
              context="Select a node"
              explanation="The Twin becomes useful when you inspect one outcome, capability, risk, or agent at a time."
              recommendation="Click any node in the canvas to reveal its details, linked artifacts, and active agent."
            />
          )}
        </div>
      </aside>
    </div>
  );
}
