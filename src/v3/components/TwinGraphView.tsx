import React, { useMemo, useState } from "react";
import { formatDateOnly } from "@/lib/formatTime";

interface TwinNode {
  id: string;
  type: string;
  label: string;
  description?: string;
  status?: string;
  phase?: string;
}

interface TwinEdge {
  source: string;
  target: string;
  type: string;
  label?: string;
}

interface TwinGraph {
  nodes: TwinNode[];
  edges: TwinEdge[];
  syncedAt?: string;
}

const NODE_TYPE_COLOR: Record<string, string> = {
  Strategy: "var(--v3-accent)",
  Outcome: "var(--br-green)",
  KPI: "var(--br-green)",
  Risk: "var(--v3-red, #ef4444)",
  Governance: "var(--v3-amber, #f59e0b)",
  Decision: "var(--v3-amber, #f59e0b)",
  Capability: "#8b5cf6",
  Role: "#06b6d4",
  Agent: "#06b6d4",
  Value: "var(--br-green)",
  Learning: "#a78bfa",
};

interface TwinGraphViewProps {
  graph: TwinGraph;
  onSyncTwin: () => void;
  isSyncing: boolean;
}

export default function TwinGraphView({ graph, onSyncTwin, isSyncing }: TwinGraphViewProps) {
  const [selectedNode, setSelectedNode] = useState<TwinNode | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);

  const nodeTypes = useMemo(() => Array.from(new Set(graph.nodes.map((node) => node.type))).sort(), [graph.nodes]);
  const visibleNodes = filterType ? graph.nodes.filter((node) => node.type === filterType) : graph.nodes;
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));

  const selectedConnections = selectedNode
    ? {
        outgoing: graph.edges.filter((edge) => edge.source === selectedNode.id),
        incoming: graph.edges.filter((edge) => edge.target === selectedNode.id),
      }
    : null;

  if (!graph.nodes.length) {
    return (
      <div className="v3-section">
        <div className="v3-empty" style={{ marginTop: 60 }}>
          <div className="v3-empty-icon">⬡</div>
          <div className="v3-empty-title">Twin not yet generated</div>
          <div className="v3-empty-body">Generate the narrative first, then sync the twin to build the knowledge graph.</div>
          <button type="button" className="v3-button primary" style={{ marginTop: 16 }} disabled={isSyncing} onClick={onSyncTwin}>
            {isSyncing ? "Syncing…" : "Sync twin now"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="v3-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <div>
          <div className="v3-card-title">Transformation twin</div>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
            {graph.nodes.length} nodes · {graph.edges.length} relationships
            {graph.syncedAt ? ` · Synced ${formatDateOnly(graph.syncedAt)}` : ""}
          </div>
        </div>
        <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} disabled={isSyncing} onClick={onSyncTwin}>
          {isSyncing ? "Syncing…" : "↻ Re-sync"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <button type="button" className={`v3-chip ${!filterType ? "blue" : "muted"}`} onClick={() => setFilterType(null)}>
          All
        </button>
        {nodeTypes.map((type) => (
          <button key={type} type="button" className={`v3-chip ${filterType === type ? "blue" : "muted"}`} onClick={() => setFilterType(type === filterType ? null : type)}>
            {type}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {visibleNodes.map((node) => {
          const color = NODE_TYPE_COLOR[node.type] || "var(--v3-text-muted)";
          const connections = visibleEdges.filter((edge) => edge.source === node.id || edge.target === node.id);
          return (
            <button
              key={node.id}
              type="button"
              className={`v3-twin-node-row ${selectedNode?.id === node.id ? "is-selected" : ""}`}
              onClick={() => setSelectedNode(selectedNode?.id === node.id ? null : node)}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flex: 1 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>{node.label}</span>
                    <span className="v3-chip muted" style={{ fontSize: 11 }}>{node.type}</span>
                    {node.status === "at-risk" ? <span className="v3-chip red" style={{ fontSize: 11 }}>at risk</span> : null}
                    {node.status === "complete" ? <span className="v3-chip green" style={{ fontSize: 11 }}>complete</span> : null}
                  </div>
                  {node.description ? <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 2 }}>{node.description}</div> : null}
                </div>
              </div>
              <span className="v3-chip muted" style={{ fontSize: 11, flexShrink: 0 }}>{connections.length} links</span>
            </button>
          );
        })}
      </div>

      {selectedNode && selectedConnections ? (
        <div className="v3-twin-detail">
          <div className="v3-card-title">{selectedNode.label}</div>
          <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginBottom: 10 }}>{selectedNode.description}</div>
          {selectedConnections.outgoing.length ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                This node →
              </div>
              {selectedConnections.outgoing.map((edge, index) => {
                const target = graph.nodes.find((node) => node.id === edge.target);
                return (
                  <div key={`${edge.source}-${edge.target}-${index}`} style={{ fontSize: 12, color: "var(--v3-text-secondary)", display: "flex", gap: 6, alignItems: "center" }}>
                    <span className="v3-chip muted" style={{ fontSize: 11 }}>{edge.type}</span>
                    <span>{target?.label || edge.target}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
          {selectedConnections.incoming.length ? (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                → This node
              </div>
              {selectedConnections.incoming.map((edge, index) => {
                const source = graph.nodes.find((node) => node.id === edge.source);
                return (
                  <div key={`${edge.source}-${edge.target}-incoming-${index}`} style={{ fontSize: 12, color: "var(--v3-text-secondary)", display: "flex", gap: 6, alignItems: "center" }}>
                    <span>{source?.label || edge.source}</span>
                    <span className="v3-chip muted" style={{ fontSize: 11 }}>{edge.type}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
