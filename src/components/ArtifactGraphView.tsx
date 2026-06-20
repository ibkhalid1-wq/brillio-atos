import { useState } from "react";

const STATUS_COLORS = {
  approved: { fill: "#dcfce7", stroke: "#16a34a", text: "#14532d" },
  draft: { fill: "#fef3c7", stroke: "#d97706", text: "#92400e" },
  missing: { fill: "#f9fafb", stroke: "#d1d5db", text: "#9ca3af" },
};

const PHASE_LABEL_COLORS = ["#1e3a5f", "#1e40af", "#0f766e", "#065f46", "#7c3aed", "#9d174d", "#92400e", "#14532d", "#1e3a5f"];

interface GraphNode {
  id: string;
  phaseId: string;
  artifactId: string;
  status: string;
  qualityScore: number | null;
  fragilityScore?: number;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface GraphEdge {
  source: string;
  target: string;
}

interface ArtifactGraphViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalWidth: number;
  totalHeight: number;
  phaseSequence: string[];
  onSelectNode: (phaseId: string, artifactId: string) => void;
}

export function ArtifactGraphView({ nodes, edges, totalWidth, totalHeight, phaseSequence, onSelectNode }: ArtifactGraphViewProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "approved" | "draft" | "missing">("all");

  const nodeMap = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const visible = new Set(nodes.filter((node) => filter === "all" || node.status === filter).map((node) => node.id));
  const counts = {
    approved: nodes.filter((node) => node.status === "approved").length,
    draft: nodes.filter((node) => node.status === "draft").length,
    missing: nodes.filter((node) => node.status === "missing").length,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Artifact Dependency Graph</span>
        {(["all", "approved", "draft", "missing"] as const).map((statusId) => {
          const colorSet = statusId !== "all" ? STATUS_COLORS[statusId] : null;
          const count = statusId === "all" ? nodes.length : counts[statusId];
          return (
            <button
              key={statusId}
              type="button"
              onClick={() => setFilter(statusId)}
              style={{
                padding: "3px 10px",
                borderRadius: 10,
                fontSize: 11,
                border: "1px solid",
                borderColor: filter === statusId ? (colorSet?.stroke ?? "#2563eb") : "#e5e7eb",
                background: filter === statusId ? (colorSet?.fill ?? "#eff6ff") : "white",
                color: filter === statusId ? (colorSet?.text ?? "#1d4ed8") : "#6b7280",
                cursor: "pointer",
              }}
            >
              {statusId} ({count})
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflow: "auto", background: "#fafafa" }}>
        <svg width={totalWidth} height={totalHeight} style={{ display: "block" }}>
          {phaseSequence.map((phaseId, index) => (
            <text
              key={phaseId}
              x={index * 180 + 90}
              y={28}
              textAnchor="middle"
              style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", fill: PHASE_LABEL_COLORS[index % PHASE_LABEL_COLORS.length] }}
            >
              {phaseId}
            </text>
          ))}

          <defs>
            <marker id="artifact-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
            </marker>
          </defs>

          {edges.map((edge, index) => {
            const source = nodeMap[edge.source];
            const target = nodeMap[edge.target];
            if (!source || !target) return null;
            if (!visible.has(edge.source) || !visible.has(edge.target)) return null;
            const x1 = source.x + source.w;
            const y1 = source.y + source.h / 2;
            const x2 = target.x;
            const y2 = target.y + target.h / 2;
            const midX = (x1 + x2) / 2;
            const isSelected = selected === edge.source || selected === edge.target;
            return (
              <path
                key={`${edge.source}-${edge.target}-${index}`}
                d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                fill="none"
                stroke={isSelected ? "#2563eb" : "#d1d5db"}
                strokeWidth={isSelected ? 2 : 1}
                strokeDasharray={target.status === "missing" ? "4,3" : undefined}
                markerEnd="url(#artifact-graph-arrow)"
                opacity={0.7}
              />
            );
          })}

          {nodes.filter((node) => visible.has(node.id)).map((node) => {
            const colors = STATUS_COLORS[node.status as keyof typeof STATUS_COLORS] ?? STATUS_COLORS.missing;
            const isSelected = selected === node.id;
            return (
              <g
                key={node.id}
                onClick={() => {
                  setSelected(node.id === selected ? null : node.id);
                  onSelectNode(node.phaseId, node.artifactId);
                }}
                style={{ cursor: "pointer" }}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.w}
                  height={node.h}
                  rx={6}
                  ry={6}
                  fill={colors.fill}
                  stroke={isSelected ? "#2563eb" : colors.stroke}
                  strokeWidth={isSelected ? 2 : 1}
                />
                <text
                  x={node.x + node.w / 2}
                  y={node.y + node.h / 2 + 4}
                  textAnchor="middle"
                  style={{ fontSize: 10, fill: colors.text, fontWeight: isSelected ? 700 : 400 }}
                >
                  {node.artifactId.length > 18 ? `${node.artifactId.slice(0, 17)}…` : node.artifactId}
                </text>
                {node.fragilityScore && node.fragilityScore > 0 && node.status !== "approved" ? (
                  <text
                    x={node.x + 4}
                    y={node.y + 10}
                    style={{ fontSize: 9, fill: node.fragilityScore >= 5 ? "#dc2626" : "#d97706", fontWeight: 700 }}
                  >
                    ↓{node.fragilityScore}
                  </text>
                ) : null}
                {node.qualityScore !== null && node.status === "approved" ? (
                  <text
                    x={node.x + node.w - 4}
                    y={node.y + 10}
                    textAnchor="end"
                    style={{ fontSize: 9, fill: node.qualityScore >= 70 ? "#16a34a" : node.qualityScore >= 50 ? "#d97706" : "#dc2626" }}
                  >
                    {node.qualityScore}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
