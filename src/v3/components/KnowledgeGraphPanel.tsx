import React from "react";
import type { ProgramSummary } from "@/new/types";
import {
  buildKnowledgeGraph,
  buildPhaseSubgraph,
  type GraphNode,
  type GraphNodeKind,
  type GraphHealth,
  type KnowledgeGraph,
} from "@/v3/lib/knowledgeGraph";

const HEALTH_COLOR: Record<GraphHealth, string> = {
  good: "var(--v3-green)",
  warning: "var(--v3-amber)",
  critical: "var(--v3-red)",
  neutral: "var(--v3-text-muted)",
};

const KIND_LABEL: Record<GraphNodeKind, string> = {
  phase: "Phase",
  artifact: "Artifact",
  decision: "Decision",
  risk: "Risk",
  milestone: "Milestone",
  gate: "Gate",
};

interface Connection {
  edgeId: string;
  otherId: string;
  relation: string;
  dir: "out" | "in";
}

/** Undirected adjacency: each edge is reachable from both endpoints. */
function buildAdjacency(graph: KnowledgeGraph): Map<string, Connection[]> {
  const map = new Map<string, Connection[]>();
  const push = (from: string, conn: Connection) => {
    const list = map.get(from) || [];
    list.push(conn);
    map.set(from, list);
  };
  for (const edge of graph.edges) {
    push(edge.source, { edgeId: edge.id, otherId: edge.target, relation: edge.label, dir: "out" });
    push(edge.target, { edgeId: edge.id, otherId: edge.source, relation: edge.label, dir: "in" });
  }
  return map;
}

function TreeRow({
  nodeId,
  relation,
  dir,
  path,
  nodeById,
  adjacency,
  expandedKeys,
  onToggle,
}: {
  nodeId: string;
  relation: string | null;
  dir: "out" | "in" | null;
  path: string[];
  nodeById: Map<string, GraphNode>;
  adjacency: Map<string, Connection[]>;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  const node = nodeById.get(nodeId);
  if (!node) return null;

  const nextPath = [...path, nodeId];
  const pathKey = nextPath.join(">");

  // Children = connected nodes not already on this branch (prevents cycles),
  // de-duplicated so a node reached by two edges appears once.
  const seen = new Set<string>();
  const childConns = (adjacency.get(nodeId) || []).filter((conn) => {
    if (path.includes(conn.otherId) || conn.otherId === nodeId) return false;
    if (seen.has(conn.otherId)) return false;
    seen.add(conn.otherId);
    return true;
  });
  const hasChildren = childConns.length > 0;
  const expanded = expandedKeys.has(pathKey);

  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "4px 0" }}>
        <button
          type="button"
          onClick={() => hasChildren && onToggle(pathKey)}
          aria-label={hasChildren ? (expanded ? "Collapse" : "Expand") : undefined}
          style={{
            flex: "0 0 auto",
            width: 16,
            height: 18,
            lineHeight: "18px",
            textAlign: "center",
            background: "none",
            border: "none",
            padding: 0,
            cursor: hasChildren ? "pointer" : "default",
            color: hasChildren ? "var(--v3-text-secondary)" : "var(--v3-border)",
            fontSize: 10,
          }}
        >
          {hasChildren ? (expanded ? "▾" : "▸") : "•"}
        </button>
        <span
          style={{
            flex: "0 0 auto",
            width: 8,
            height: 8,
            marginTop: 5,
            borderRadius: "50%",
            background: HEALTH_COLOR[node.health],
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--v3-text-primary)", overflowWrap: "anywhere", wordBreak: "break-word", whiteSpace: "normal" }}>
            {relation ? (
              <span style={{ color: "var(--v3-text-muted)", fontSize: 11 }}>
                {dir === "out" ? "→" : "←"} {relation}{" "}
              </span>
            ) : null}
            <span style={{ fontWeight: 600 }}>{node.label}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 2 }}>
            <span style={{ fontSize: 10, color: "var(--v3-text-muted)", border: "1px solid var(--v3-border)", borderRadius: 20, padding: "0 6px" }}>
              {KIND_LABEL[node.kind]}
            </span>
            {node.status ? (
              <span style={{ fontSize: 10, color: HEALTH_COLOR[node.health], textTransform: "capitalize" }}>{node.status}</span>
            ) : null}
            {typeof node.quality === "number" ? (
              <span style={{ fontSize: 10, color: "var(--v3-text-muted)" }}>{node.quality}%</span>
            ) : null}
            {hasChildren ? (
              <span style={{ fontSize: 10, color: "var(--v3-text-muted)", marginLeft: "auto" }}>
                {childConns.length} link{childConns.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {expanded && hasChildren ? (
        <div style={{ marginLeft: 14, paddingLeft: 8, borderLeft: "1px solid var(--v3-border)" }}>
          {childConns.map((conn) => (
            <TreeRow
              key={`${conn.edgeId}:${conn.otherId}`}
              nodeId={conn.otherId}
              relation={conn.relation}
              dir={conn.dir}
              path={nextPath}
              nodeById={nodeById}
              adjacency={adjacency}
              expandedKeys={expandedKeys}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function KnowledgeGraphPanel({
  program,
  phaseId,
}: {
  program: ProgramSummary | null;
  phaseId?: string | null;
}) {
  const graph = React.useMemo(
    () => (phaseId ? buildPhaseSubgraph(program, phaseId) : buildKnowledgeGraph(program)),
    [program, phaseId],
  );

  const nodeById = React.useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of graph.nodes) map.set(node.id, node);
    return map;
  }, [graph.nodes]);

  const adjacency = React.useMemo(() => buildAdjacency(graph), [graph]);

  // Root = the phase node when phase-scoped, else the first phase node.
  const rootId = React.useMemo(() => {
    if (phaseId && nodeById.has(`phase:${phaseId}`)) return `phase:${phaseId}`;
    const phaseNode = graph.nodes.find((n) => n.kind === "phase");
    return phaseNode?.id ?? graph.nodes[0]?.id ?? null;
  }, [phaseId, nodeById, graph.nodes]);

  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(() => new Set());

  // Auto-expand the root branch whenever the root changes.
  React.useEffect(() => {
    if (rootId) setExpandedKeys(new Set([rootId]));
  }, [rootId]);

  const toggle = React.useCallback((key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (!program || !rootId || !graph.nodes.length) {
    return <div className="v3-context-artifacts-empty">No knowledge graph for this phase yet.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--v3-text-secondary)" }}>
          <strong style={{ color: "var(--v3-text-primary)" }}>{graph.stats.nodeCount}</strong> connected entities ·{" "}
          <strong style={{ color: "var(--v3-text-primary)" }}>{graph.stats.edgeCount}</strong> links
        </span>
        <button
          type="button"
          className="v3-button ghost"
          style={{ fontSize: 11, marginLeft: "auto" }}
          onClick={() => setExpandedKeys(new Set(rootId ? [rootId] : []))}
        >
          Collapse all
        </button>
      </div>

      <div style={{ display: "grid", gap: 0 }}>
        <TreeRow
          nodeId={rootId}
          relation={null}
          dir={null}
          path={[]}
          nodeById={nodeById}
          adjacency={adjacency}
          expandedKeys={expandedKeys}
          onToggle={toggle}
        />
      </div>
    </div>
  );
}

export default KnowledgeGraphPanel;
