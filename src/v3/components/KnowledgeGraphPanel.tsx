import React from "react";
import type { ProgramSummary } from "@/new/types";
import {
  buildKnowledgeGraph,
  type GraphNode,
  type GraphNodeKind,
  type GraphHealth,
} from "@/v3/lib/knowledgeGraph";

const HEALTH_COLOR: Record<GraphHealth, string> = {
  good: "var(--v3-green)",
  warning: "var(--v3-amber)",
  critical: "var(--v3-red)",
  neutral: "var(--v3-text-muted)",
};

const KIND_META: Record<GraphNodeKind, { label: string; plural: string }> = {
  phase: { label: "Phase", plural: "Phases" },
  artifact: { label: "Artifact", plural: "Artifacts" },
  decision: { label: "Decision", plural: "Decisions" },
  risk: { label: "Risk", plural: "Risks" },
  milestone: { label: "Milestone", plural: "Milestones" },
  gate: { label: "Gate", plural: "Gates" },
};

const KIND_ORDER: GraphNodeKind[] = ["phase", "gate", "artifact", "milestone", "decision", "risk"];

function NodeChip({
  node,
  degree,
  selected,
  onSelect,
}: {
  node: GraphNode;
  degree: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="v3-kg-node"
      onClick={() => onSelect(node.id)}
      style={{
        display: "grid",
        gap: 3,
        textAlign: "left",
        padding: "8px 10px",
        border: "1px solid var(--v3-border)",
        borderLeft: `3px solid ${HEALTH_COLOR[node.health]}`,
        borderRadius: "var(--v3-radius)",
        background: selected ? "var(--v3-surface-2)" : "var(--v3-surface)",
        boxShadow: selected ? "0 0 0 1px var(--v3-accent)" : "none",
        cursor: "pointer",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--v3-text-primary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.label}
        </span>
        {typeof node.quality === "number" ? (
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--v3-text-muted)" }}>{node.quality}%</span>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {node.status ? (
          <span style={{ fontSize: 10, color: HEALTH_COLOR[node.health], textTransform: "capitalize" }}>{node.status}</span>
        ) : null}
        <span style={{ fontSize: 10, color: "var(--v3-text-muted)", marginLeft: "auto" }}>
          {degree} link{degree === 1 ? "" : "s"}
        </span>
      </div>
    </button>
  );
}

export function KnowledgeGraphPanel({
  program,
  onOpenNode,
}: {
  program: ProgramSummary | null;
  onOpenNode?: (node: GraphNode) => void;
}) {
  const graph = React.useMemo(() => buildKnowledgeGraph(program), [program]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const degreeById = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const edge of graph.edges) {
      map.set(edge.source, (map.get(edge.source) || 0) + 1);
      map.set(edge.target, (map.get(edge.target) || 0) + 1);
    }
    return map;
  }, [graph.edges]);

  const nodeById = React.useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of graph.nodes) map.set(node.id, node);
    return map;
  }, [graph.nodes]);

  const grouped = React.useMemo(() => {
    const map = new Map<GraphNodeKind, GraphNode[]>();
    for (const node of graph.nodes) {
      const list = map.get(node.kind) || [];
      list.push(node);
      map.set(node.kind, list);
    }
    return map;
  }, [graph.nodes]);

  const selectedConnections = React.useMemo(() => {
    if (!selectedId) return [];
    return graph.edges
      .filter((edge) => edge.source === selectedId || edge.target === selectedId)
      .map((edge) => {
        const outgoing = edge.source === selectedId;
        const otherId = outgoing ? edge.target : edge.source;
        return { edge, outgoing, other: nodeById.get(otherId) };
      })
      .filter((conn) => conn.other);
  }, [selectedId, graph.edges, nodeById]);

  if (!program || !graph.nodes.length) {
    return <div className="v3-context-artifacts-empty">No knowledge graph for this programme yet.</div>;
  }

  const selectedNode = selectedId ? nodeById.get(selectedId) : null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--v3-text-secondary)" }}>
          <strong style={{ color: "var(--v3-text-primary)" }}>{graph.stats.nodeCount}</strong> entities ·{" "}
          <strong style={{ color: "var(--v3-text-primary)" }}>{graph.stats.edgeCount}</strong> connections
        </span>
        {graph.stats.orphans > 0 ? (
          <span style={{ fontSize: 11, color: "var(--v3-amber)" }}>
            {graph.stats.orphans} unconnected — gaps in traceability
          </span>
        ) : (
          <span style={{ fontSize: 11, color: "var(--v3-green)" }}>Fully connected</span>
        )}
      </div>

      {KIND_ORDER.filter((kind) => grouped.get(kind)?.length).map((kind) => {
        const list = grouped.get(kind)!;
        return (
          <div key={kind} style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {KIND_META[kind].plural} · {list.length}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6 }}>
              {list.map((node) => (
                <NodeChip
                  key={node.id}
                  node={node}
                  degree={degreeById.get(node.id) || 0}
                  selected={node.id === selectedId}
                  onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {selectedNode ? (
        <div
          style={{
            display: "grid",
            gap: 8,
            padding: "12px 14px",
            border: "1px solid var(--v3-border)",
            borderRadius: "var(--v3-radius)",
            background: "var(--v3-surface-2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--v3-text-primary)", flex: 1 }}>
              {selectedNode.label}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: HEALTH_COLOR[selectedNode.health], textTransform: "uppercase" }}>
              {KIND_META[selectedNode.kind].label}
            </span>
          </div>
          {selectedNode.detail ? (
            <div style={{ fontSize: 11, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>{selectedNode.detail}</div>
          ) : null}

          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>
            Traceability · {selectedConnections.length}
          </div>
          {selectedConnections.length ? (
            <div style={{ display: "grid", gap: 4 }}>
              {selectedConnections.map(({ edge, outgoing, other }) => (
                <div key={edge.id} style={{ fontSize: 11, color: "var(--v3-text-secondary)", display: "flex", gap: 6 }}>
                  <span style={{ color: "var(--v3-text-muted)", whiteSpace: "nowrap" }}>
                    {outgoing ? `→ ${edge.label}` : `← ${edge.label} by`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedId(other!.id)}
                    style={{ background: "none", border: "none", padding: 0, color: "var(--v3-accent)", cursor: "pointer", textAlign: "left", fontSize: 11 }}
                  >
                    {other!.label}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--v3-amber)" }}>No connections — this entity is not yet traceable.</div>
          )}

          {onOpenNode ? (
            <button
              type="button"
              className="v3-button ghost"
              style={{ fontSize: 12, justifySelf: "start", marginTop: 4 }}
              onClick={() => onOpenNode(selectedNode)}
            >
              Open {KIND_META[selectedNode.kind].label.toLowerCase()} →
            </button>
          ) : null}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
          Select an entity to trace its connections across the programme.
        </div>
      )}
    </div>
  );
}

export default KnowledgeGraphPanel;
