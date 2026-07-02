import React, { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type TwinNodeRecord = {
  id: string;
  type: string;
  label?: string;
  status?: string;
  phaseCreated?: string;
  confidence?: number;
  linkedArtifactId?: string | null;
  properties?: Record<string, unknown>;
};

type TwinEdgeRecord = {
  id: string;
  from: string;
  to: string;
  type?: string;
};

type AgentActivityState = {
  status: "idle" | "running" | "complete" | "blocked";
  lastAction?: string;
  confidence?: number;
};

type TwinManualPosition = {
  x: number;
  y: number;
};

interface TwinGraphProps {
  twinGraph: { nodes: TwinNodeRecord[]; edges: TwinEdgeRecord[] };
  onNodeClick?: (node: TwinNodeRecord) => void;
  agentActivityMap?: Record<string, AgentActivityState>;
  onNodePositionChange?: (nodeId: string, position: TwinManualPosition) => void;
  onResetLayout?: () => void;
  /** Canvas height in px. Callers serving a graph that grows over time (e.g. the
   *  Program Graph gaining nodes each phase) pass a viewport-derived value so the
   *  canvas expands with the window rather than staying at the fixed default. */
  height?: number;
  /** Floor for zoom-out. The default suits the compact Twin; a graph that keeps
   *  growing needs a lower floor so fitView can frame every node at once. */
  minZoom?: number;
  /** Refit trigger. When this changes (e.g. the node/edge count after a new phase
   *  produces outputs) the view re-frames so newly added nodes are in view. */
  fitViewKey?: string | number;
}

/** Reframes the viewport whenever `dep` changes — keeps the whole graph in view
 *  as later phases add nodes. Rendered inside <ReactFlow> so it can use the flow
 *  instance. */
function FitViewOnChange({ dep }: { dep: string | number | undefined }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const raf = requestAnimationFrame(() => { void fitView({ padding: 0.14 }); });
    return () => cancelAnimationFrame(raf);
  }, [dep, fitView]);
  return null;
}

const NODE_COLORS: Record<string, string> = {
  Strategy: "#1e3a5f",
  Outcome: "#1a6b3c",
  KPI: "#4a7c59",
  Capability: "#7c3d8f",
  Decision: "#8f6a1a",
  Role: "#1a5c8f",
  Agent: "#8f1a3d",
  Skill: "#3d8f1a",
  Data: "#1a7c7c",
  Risk: "#8f1a1a",
  Governance: "#3d1a8f",
  Value: "#1a8f5c",
  Learning: "#5c8f1a",
  // Program Graph node kinds (buildProgramGraph display types).
  Source: "#475569",
  Insight: "#9a6a00",
  Fact: "#0f766e",
  Phase: "#1e3a5f",
  Artifact: "#5b21b6",
  Stakeholder: "#1a5c8f",
  Requirement: "#0369a1",
};

const TWIN_NODE_TYPE_ORDER = [
  "Strategy", "Outcome", "KPI", "Capability", "Decision",
  "Role", "Agent", "Skill", "Data", "Risk", "Governance", "Value", "Learning",
  "Source", "Insight", "Fact", "Requirement", "Phase", "Artifact", "Stakeholder",
];

const SEMANTIC_LANES = [
  // Program Graph lanes (buildProgramGraph) — left→right source→knowledge→phase→
  // artifact flow. They filter out for Transformation Twin data (whose types are
  // disjoint), so adding them does not alter twin layout.
  { id: "pg-sources", label: "Sources", types: ["Source"] },
  { id: "pg-knowledge", label: "Knowledge", types: ["Insight", "Fact"] },
  { id: "pg-requirements", label: "Requirements", types: ["Requirement"] },
  { id: "pg-phases", label: "Phases", types: ["Phase"] },
  { id: "pg-artifacts", label: "Artifacts", types: ["Artifact"] },
  { id: "strategy", label: "Strategy", types: ["Strategy"] },
  { id: "outcomes", label: "Outcomes", types: ["Outcome", "KPI"] },
  { id: "capability", label: "Capability", types: ["Capability"] },
  { id: "decisions", label: "Decisions", types: ["Decision"] },
  { id: "execution", label: "Execution", types: ["Role", "Agent", "Skill", "Data"] },
  { id: "controls", label: "Controls", types: ["Risk", "Governance"] },
  { id: "value", label: "Value", types: ["Value", "Learning"] },
  { id: "pg-people", label: "Stakeholders", types: ["Stakeholder"] },
] as const;

const LAYER_GAP = 166;
const INTERNAL_COLUMN_GAP = 176;
const ROW_GAP = 98;
const LAYER_TOP_PADDING = 96;
const LAYER_LEFT_PADDING = 52;
const NODE_LAYOUT_WIDTH = 156;

type TwinLaneDefinition = {
  id: string;
  label: string;
  types: string[];
};

function getOrderedLanes(rawNodes: TwinNodeRecord[]): TwinLaneDefinition[] {
  const presentTypes = new Set(rawNodes.map((node) => node.type));
  const baseLanes = SEMANTIC_LANES
    .filter((lane) => lane.types.some((type) => presentTypes.has(type)))
    .map((lane) => ({ id: lane.id, label: lane.label, types: [...lane.types] }));
  const coveredTypes = new Set<string>(baseLanes.flatMap((lane) => lane.types));
  const extraTypes = Array.from(presentTypes)
    .filter((type) => !coveredTypes.has(type))
    .sort((left, right) => left.localeCompare(right))
    .map((type) => ({ id: `extra-${type}`, label: type, types: [type] }));
  return [...baseLanes, ...extraTypes];
}

function getNodeLaneIndex(node: TwinNodeRecord, orderedLanes: TwinLaneDefinition[]): number {
  const laneIndex = orderedLanes.findIndex((lane) => lane.types.includes(node.type));
  return laneIndex >= 0 ? laneIndex : orderedLanes.length - 1;
}

function getLaneColumnCount(nodeCount: number): number {
  if (nodeCount >= 13) return 3;
  if (nodeCount >= 6) return 2;
  return 1;
}

function getOrderedTypes(rawNodes: TwinNodeRecord[]): string[] {
  const knownTypes = TWIN_NODE_TYPE_ORDER.filter((type) => rawNodes.some((node) => node.type === type));
  const extraTypes = rawNodes
    .map((node) => node.type)
    .filter((type, index, array) => array.indexOf(type) === index && !knownTypes.includes(type))
    .sort((left, right) => left.localeCompare(right));
  return [...knownTypes, ...extraTypes];
}

function buildTooltip(node: TwinNodeRecord, activity: AgentActivityState | null): string {
  const parts = [
    node.label || node.type || "Node",
    `Type: ${node.type}`,
    `Status: ${node.status || "draft"}`,
  ];
  if (activity?.lastAction) parts.push(`Last action: ${activity.lastAction}`);
  if (typeof activity?.confidence === "number") parts.push(`Activity confidence: ${Math.round(activity.confidence * 100)}%`);
  return parts.join("\n");
}

function buildNodeBoxShadow(activity: AgentActivityState | null, isSelected = false): string {
  const baseShadow = !activity
    ? "0 8px 24px rgba(15,23,42,0.18)"
    : activity.status === "running"
      ? "0 0 0 2px rgba(37,99,235,0.32), 0 0 22px rgba(59,130,246,0.42)"
      : activity.status === "complete"
        ? "0 0 0 2px rgba(34,197,94,0.3), 0 8px 24px rgba(15,23,42,0.18)"
        : activity.status === "blocked"
          ? "0 0 0 2px rgba(245,158,11,0.35), 0 8px 24px rgba(15,23,42,0.18)"
          : "0 8px 24px rgba(15,23,42,0.18)";

  if (!isSelected) return baseShadow;

  return `${baseShadow}, 0 0 0 3px rgba(255,255,255,0.95), 0 0 0 6px rgba(37,99,235,0.22)`;
}

function readManualPosition(node: TwinNodeRecord): TwinManualPosition | null {
  const maybePosition = node?.properties?.manualPosition;
  if (!maybePosition || typeof maybePosition !== "object") return null;
  const x = Number((maybePosition as { x?: unknown }).x);
  const y = Number((maybePosition as { y?: unknown }).y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function buildLayeredPositions(
  rawNodes: TwinNodeRecord[],
  rawEdges: TwinEdgeRecord[],
  manualPositions: Record<string, TwinManualPosition> = {},
): Map<string, { x: number; y: number }> {
  const orderedLanes = getOrderedLanes(rawNodes);

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  rawNodes.forEach((node) => {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  });
  rawEdges.forEach((edge) => {
    if (!outgoing.has(edge.from) || !incoming.has(edge.to)) return;
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  });

  const layers = orderedLanes.map((lane) =>
    rawNodes
      .filter((node) => lane.types.includes(node.type))
      .sort((left, right) => {
        const leftTypeIndex = TWIN_NODE_TYPE_ORDER.indexOf(left.type);
        const rightTypeIndex = TWIN_NODE_TYPE_ORDER.indexOf(right.type);
        return (
          (leftTypeIndex >= 0 ? leftTypeIndex : Number.MAX_SAFE_INTEGER)
          - (rightTypeIndex >= 0 ? rightTypeIndex : Number.MAX_SAFE_INTEGER)
        ) || `${left.label || left.id}`.localeCompare(`${right.label || right.id}`);
      }),
  );

  const getIndexMaps = () => layers.map((layer) => new Map(layer.map((node, index) => [node.id, index])));

  for (let sweep = 0; sweep < 4; sweep += 1) {
    for (let layerIndex = 1; layerIndex < layers.length; layerIndex += 1) {
      const indexMaps = getIndexMaps();
      layers[layerIndex] = [...layers[layerIndex]].sort((left, right) => {
        const leftScore = getNeighborBarycenter(left.id, layerIndex, incoming, outgoing, rawNodes, indexMaps, orderedLanes);
        const rightScore = getNeighborBarycenter(right.id, layerIndex, incoming, outgoing, rawNodes, indexMaps, orderedLanes);
        return leftScore - rightScore || `${left.label || left.id}`.localeCompare(`${right.label || right.id}`);
      });
    }
    for (let layerIndex = layers.length - 2; layerIndex >= 0; layerIndex -= 1) {
      const indexMaps = getIndexMaps();
      layers[layerIndex] = [...layers[layerIndex]].sort((left, right) => {
        const leftScore = getNeighborBarycenter(left.id, layerIndex, incoming, outgoing, rawNodes, indexMaps, orderedLanes);
        const rightScore = getNeighborBarycenter(right.id, layerIndex, incoming, outgoing, rawNodes, indexMaps, orderedLanes);
        return leftScore - rightScore || `${left.label || left.id}`.localeCompare(`${right.label || right.id}`);
      });
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  let laneLeft = LAYER_LEFT_PADDING;
  layers.forEach((layer) => {
    const columnCount = getLaneColumnCount(layer.length);
    const rowsPerColumn = Math.ceil(layer.length / columnCount) || 1;
    const laneWidth = NODE_LAYOUT_WIDTH + (columnCount - 1) * INTERNAL_COLUMN_GAP;
    layer.forEach((node, rowIndex) => {
      const columnIndex = Math.floor(rowIndex / rowsPerColumn);
      const rowPosition = rowIndex % rowsPerColumn;
      const manualPosition = manualPositions[node.id] || readManualPosition(node);
      positions.set(node.id, {
        x: manualPosition?.x ?? (laneLeft + columnIndex * INTERNAL_COLUMN_GAP),
        y: manualPosition?.y ?? (LAYER_TOP_PADDING + rowPosition * ROW_GAP),
      });
    });
    laneLeft += laneWidth + LAYER_GAP;
  });

  return positions;
}

function getNeighborBarycenter(
  nodeId: string,
  layerIndex: number,
  incoming: Map<string, string[]>,
  outgoing: Map<string, string[]>,
  rawNodes: TwinNodeRecord[],
  indexMaps: Array<Map<string, number>>,
  orderedLanes: TwinLaneDefinition[],
): number {
  const nodeById = new Map(rawNodes.map((node) => [node.id, node]));
  const neighborIndexes: number[] = [];
  const collectNeighborIndexes = (neighborIds: string[]) => {
    neighborIds.forEach((neighborId) => {
      const neighbor = nodeById.get(neighborId);
      if (!neighbor) return;
      const neighborLayerIndex = getNodeLaneIndex(neighbor, orderedLanes);
      const index = indexMaps[neighborLayerIndex]?.get(neighborId);
      if (typeof index === "number") neighborIndexes.push(index);
    });
  };

  collectNeighborIndexes((incoming.get(nodeId) || []).filter((neighborId) => {
    const neighbor = nodeById.get(neighborId);
    return !!neighbor && getNodeLaneIndex(neighbor, orderedLanes) < layerIndex;
  }));
  collectNeighborIndexes((outgoing.get(nodeId) || []).filter((neighborId) => {
    const neighbor = nodeById.get(neighborId);
    return !!neighbor && getNodeLaneIndex(neighbor, orderedLanes) > layerIndex;
  }));

  if (!neighborIndexes.length) {
    return Number.MAX_SAFE_INTEGER;
  }
  return neighborIndexes.reduce((sum, value) => sum + value, 0) / neighborIndexes.length;
}

export function TransformationTwinGraph({
  twinGraph,
  onNodeClick,
  agentActivityMap,
  onNodePositionChange,
  onResetLayout,
  height = 760,
  minZoom = 0.74,
  fitViewKey,
}: TwinGraphProps) {
  const rawNodes = Array.isArray(twinGraph?.nodes) ? twinGraph.nodes : [];
  const rawEdges = Array.isArray(twinGraph?.edges) ? twinGraph.edges : [];
  const [selectedNode, setSelectedNode] = useState<TwinNodeRecord | null>(null);
  const [focusedType, setFocusedType] = useState<string>("All");
  const [editMode, setEditMode] = useState(false);
  const [layoutOverrides, setLayoutOverrides] = useState<Record<string, TwinManualPosition>>({});

  const rawNodeMap = useMemo(
    () => new Map(rawNodes.map((node) => [node.id, node])),
    [rawNodes],
  );
  const orderedTypes = useMemo(() => getOrderedTypes(rawNodes), [rawNodes]);
  const connectionMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    rawNodes.forEach((node) => {
      map.set(node.id, new Set([node.id]));
    });
    rawEdges.forEach((edge) => {
      if (!map.has(edge.from)) map.set(edge.from, new Set([edge.from]));
      if (!map.has(edge.to)) map.set(edge.to, new Set([edge.to]));
      map.get(edge.from)?.add(edge.to);
      map.get(edge.to)?.add(edge.from);
    });
    return map;
  }, [rawEdges, rawNodes]);
  const focusedNodeIds = useMemo(() => {
    if (focusedType === "All") return null;
    const ids = new Set<string>();
    rawNodes
      .filter((node) => node.type === focusedType)
      .forEach((node) => {
        (connectionMap.get(node.id) || new Set([node.id])).forEach((id) => ids.add(id));
      });
    return ids;
  }, [connectionMap, focusedType, rawNodes]);
  const selectedNeighborhoodIds = useMemo(() => {
    if (!selectedNode) return null;
    return connectionMap.get(selectedNode.id) || new Set([selectedNode.id]);
  }, [connectionMap, selectedNode]);

  useEffect(() => {
    const nextOverrides = rawNodes.reduce<Record<string, TwinManualPosition>>((acc, node) => {
      const manualPosition = readManualPosition(node);
      if (manualPosition) acc[node.id] = manualPosition;
      return acc;
    }, {});
    setLayoutOverrides(nextOverrides);
  }, [rawNodes]);

  const positionedNodes = useMemo(
    () => buildLayeredPositions(rawNodes, rawEdges, layoutOverrides),
    [layoutOverrides, rawEdges, rawNodes],
  );

  const nodes: Node[] = useMemo(() => {
    return rawNodes.map((node) => {
      const hasWarning = !!node?.properties?.warning;
      const activity = agentActivityMap?.[node.id] || null;
      const tooltip = buildTooltip(node, activity);
      const position = positionedNodes.get(node.id) || { x: LAYER_LEFT_PADDING, y: LAYER_TOP_PADDING };
      const dimForFocus = focusedNodeIds && !focusedNodeIds.has(node.id);
      const dimForSelection = selectedNeighborhoodIds && !selectedNeighborhoodIds.has(node.id);
      const isDimmed = Boolean(dimForFocus || dimForSelection);
      const isSelected = selectedNode?.id === node.id;

      return {
        id: node.id,
        type: "default",
        position,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
          data: {
            label: (
              <div title={tooltip} style={{ display: "grid", gap: 4, lineHeight: 1.3 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {activity?.status === "running" ? (
                    <span
                      className="adam-twin-node-pulse"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: "#93c5fd",
                        flexShrink: 0,
                      }}
                    />
                  ) : null}
                  <span style={{ fontSize: 9.25, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.72 }}>
                    {node.type}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700, whiteSpace: "normal", maxWidth: 156 }}>
                  {`${hasWarning ? "⚠ " : ""}${String(node.label || node.type || "Node").slice(0, 56)}`}
                </div>
              </div>
            ),
          },
          style: {
            background: NODE_COLORS[node.type] || "#555",
            color: "#fff",
          border: hasWarning
            ? "2px solid #D99114"
            : activity?.status === "blocked"
              ? "2px solid rgba(245,158,11,0.95)"
              : activity?.status === "complete" || node.status === "approved"
                ? "2px solid rgba(34,197,94,0.9)"
                : "1px solid rgba(255,255,255,0.22)",
          borderRadius: 14,
          fontSize: 11,
          padding: "10px 12px",
          minWidth: 148,
          maxWidth: 172,
          opacity: node.status === "deprecated" ? 0.34 : isDimmed ? 0.22 : 1,
          boxShadow: buildNodeBoxShadow(activity, isSelected),
          animation: activity?.status === "running" ? "adam-twin-node-pulse-shadow 2s ease-in-out infinite" : "none",
          transition: "opacity 140ms ease, box-shadow 140ms ease, border-color 140ms ease",
        },
      };
    });
  }, [agentActivityMap, focusedNodeIds, positionedNodes, rawNodes, selectedNeighborhoodIds, selectedNode?.id]);

  const edges: Edge[] = useMemo(() => (
    rawEdges.map((edge) => {
      const dimForFocus = focusedNodeIds && (!focusedNodeIds.has(edge.from) || !focusedNodeIds.has(edge.to));
      const dimForSelection = selectedNeighborhoodIds && (!selectedNeighborhoodIds.has(edge.from) || !selectedNeighborhoodIds.has(edge.to));
      const isDimmed = Boolean(dimForFocus || dimForSelection);
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: "smoothstep",
        style: {
          stroke: "#7c8aa5",
          strokeWidth: isDimmed ? 0.8 : 1.45,
          opacity: isDimmed ? 0.12 : 0.68,
        },
        pathOptions: { borderRadius: 16, offset: 26 },
        animated: !isDimmed && (edge.type === "achieves" || edge.type === "measures"),
        zIndex: 0,
      };
    })
  ), [focusedNodeIds, rawEdges, selectedNeighborhoodIds]);

  if (!nodes.length) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 320,
          border: "1px dashed rgba(148,163,184,0.45)",
          borderRadius: 18,
          color: "#64748b",
          fontSize: 13,
          background: "linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(248,250,252,0.92) 100%)",
        }}
      >
        Transformation Twin is empty. Complete Discover and Design to populate the graph.
      </div>
    );
  }

  const selectedActivity = selectedNode ? agentActivityMap?.[selectedNode.id] || null : null;
  const typeCounts = useMemo(() => (
    orderedTypes.map((type) => ({
      type,
      count: rawNodes.filter((node) => node.type === type).length,
    }))
  ), [orderedTypes, rawNodes]);

  return (
    <div style={{ position: "relative", height, width: "100%", borderRadius: 18, overflow: "hidden", border: "1px solid rgba(203,213,225,0.9)" }}>
      <style>{`
        .adam-twin-node-pulse {
          animation: adam-twin-node-dot 2s ease-in-out infinite;
        }
        @keyframes adam-twin-node-dot {
          0%, 100% { opacity: 0.45; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1); }
        }
        @keyframes adam-twin-node-pulse-shadow {
          0%, 100% { box-shadow: 0 0 0 2px rgba(37,99,235,0.2), 0 0 12px rgba(59,130,246,0.16); }
          50% { box-shadow: 0 0 0 3px rgba(37,99,235,0.28), 0 0 24px rgba(59,130,246,0.36); }
        }
      `}</style>
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          right: selectedNode ? 320 : 12,
          zIndex: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          pointerEvents: "none",
        }}
      >
        {[
          { type: "All", count: rawNodes.length },
          ...typeCounts,
        ].map((item) => {
          const active = focusedType === item.type;
          return (
            <button
              key={item.type}
              type="button"
              onClick={() => setFocusedType(item.type)}
              style={{
                pointerEvents: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 999,
                border: `1px solid ${active ? "rgba(37,99,235,0.32)" : "rgba(203,213,225,0.95)"}`,
                background: active ? "rgba(239,246,255,0.98)" : "rgba(255,255,255,0.94)",
                color: active ? "#1d4ed8" : "#475569",
                fontSize: 10.5,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 10px 22px rgba(15,23,42,0.08)",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: item.type === "All" ? "#2563eb" : (NODE_COLORS[item.type] || "#64748b"),
                  flexShrink: 0,
                }}
              />
              <span>{item.type}</span>
              <span style={{ color: active ? "#2563eb" : "#94a3b8" }}>{item.count}</span>
            </button>
          );
        })}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={(_, flowNode) => {
          const rawNode = rawNodeMap.get(flowNode.id) || null;
          if (editMode) {
            setSelectedNode(rawNode);
            return;
          }
          setSelectedNode(rawNode);
          if (rawNode) onNodeClick?.(rawNode);
        }}
        fitView
        fitViewOptions={{ padding: 0.14, maxZoom: 1.08 }}
        minZoom={minZoom}
        nodesDraggable={editMode}
        nodesConnectable={false}
        elementsSelectable
        onNodeDrag={(_, flowNode) => {
          if (!editMode) return;
          setLayoutOverrides((prev) => {
            const nextPosition = {
              x: Math.round(flowNode.position.x),
              y: Math.round(flowNode.position.y),
            };
            const existing = prev[flowNode.id];
            if (existing && existing.x === nextPosition.x && existing.y === nextPosition.y) {
              return prev;
            }
            return { ...prev, [flowNode.id]: nextPosition };
          });
        }}
        onNodeDragStop={(_, flowNode) => {
          if (!editMode) return;
          const nextPosition = {
            x: Math.round(flowNode.position.x),
            y: Math.round(flowNode.position.y),
          };
          setLayoutOverrides((prev) => ({ ...prev, [flowNode.id]: nextPosition }));
          onNodePositionChange?.(flowNode.id, nextPosition);
        }}
      >
        <FitViewOnChange dep={fitViewKey} />
        <Background gap={20} color="#d8dee9" />
        <Controls />
        <MiniMap
          nodeColor={(node) => NODE_COLORS[rawNodeMap.get(node.id)?.type || ""] || "#555"}
          style={{ background: "#0f172a", width: 132, height: 96, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(148,163,184,0.28)" }}
        />
      </ReactFlow>
      <div
        style={{
          position: "absolute",
          top: 12,
          right: selectedNode ? 320 : 12,
          zIndex: 13,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {editMode ? (
          <>
            <button
              type="button"
              onClick={() => {
                setLayoutOverrides({});
                setSelectedNode(null);
                onResetLayout?.();
              }}
              style={{
                border: "1px solid rgba(203,213,225,0.95)",
                background: "rgba(255,255,255,0.96)",
                color: "#475569",
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 10.5,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 10px 22px rgba(15,23,42,0.08)",
              }}
            >
              Reset layout
            </button>
            <button
              type="button"
              onClick={() => setEditMode(false)}
              style={{
                border: "1px solid rgba(29,78,216,0.18)",
                background: "rgba(37,99,235,0.96)",
                color: "#fff",
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 10.5,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 10px 22px rgba(37,99,235,0.18)",
              }}
            >
              Done editing
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setSelectedNode(null);
              setEditMode(true);
            }}
            style={{
              border: "1px solid rgba(29,78,216,0.18)",
              background: "rgba(255,255,255,0.96)",
              color: "#1d4ed8",
              borderRadius: 999,
              padding: "7px 12px",
              fontSize: 10.5,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 10px 22px rgba(15,23,42,0.08)",
            }}
          >
            Edit layout
          </button>
        )}
      </div>
      {editMode ? (
        <div
          style={{
            position: "absolute",
            left: 16,
            bottom: 16,
            zIndex: 13,
            background: "rgba(15,23,42,0.9)",
            color: "rgba(241,245,249,0.96)",
            borderRadius: 12,
            padding: "9px 11px",
            fontSize: 10.75,
            lineHeight: 1.5,
            boxShadow: "0 16px 32px rgba(15,23,42,0.18)",
          }}
        >
          Drag nodes to reshape the Twin. Changes save automatically for this program.
        </div>
      ) : null}
      {selectedNode ? (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            width: 288,
            background: "rgba(255,255,255,0.98)",
            border: "1px solid rgba(203,213,225,0.95)",
            borderRadius: 16,
            padding: 16,
            boxShadow: "0 20px 40px rgba(15,23,42,0.18)",
            zIndex: 10,
            fontSize: 12.5,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontWeight: 800, color: "#0f172a" }}>{selectedNode.label}</span>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              style={{ border: "none", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
            >
              ✕
            </button>
          </div>
          <div style={{ display: "grid", gap: 4, color: "#64748b" }}>
            <div>Type: <span style={{ color: "#0f172a" }}>{selectedNode.type}</span></div>
            <div>Status: <span style={{ color: "#0f172a" }}>{selectedNode.status || "draft"}</span></div>
            <div>Phase: <span style={{ color: "#0f172a" }}>{selectedNode.phaseCreated}</span></div>
            <div>Confidence: <span style={{ color: "#0f172a" }}>{Math.round((selectedNode.confidence || 0.5) * 100)}%</span></div>
            {selectedActivity ? (
              <>
                <div>Agent status: <span style={{ color: "#0f172a" }}>{selectedActivity.status}</span></div>
                {selectedActivity.lastAction ? (
                  <div>Last action: <span style={{ color: "#0f172a" }}>{selectedActivity.lastAction}</span></div>
                ) : null}
                {typeof selectedActivity.confidence === "number" ? (
                  <div>Activity confidence: <span style={{ color: "#0f172a" }}>{Math.round(selectedActivity.confidence * 100)}%</span></div>
                ) : null}
              </>
            ) : null}
            {selectedNode?.properties?.warning ? (
              <div>Warning: <span style={{ color: "#b45309" }}>{String(selectedNode.properties.warning)}</span></div>
            ) : null}
            {selectedNode.properties && Object.keys(selectedNode.properties).length > 0 ? (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(226,232,240,0.95)", display: "grid", gap: 4 }}>
                {Object.entries(selectedNode.properties).map(([key, value]) => (
                  <div key={key}>
                    {key}: <span style={{ color: "#0f172a" }}>{String(value).slice(0, 60)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
