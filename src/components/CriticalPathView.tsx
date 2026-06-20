import { useEffect, useRef, useState } from "react";

interface CPNode {
  id: string;
  label: string;
  type: string;
  phase?: string;
  duration: number;
  status: string;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  slack: number;
}

interface CPEdge {
  from: string;
  to: string;
  lag: number;
}

interface CriticalPath {
  nodes: Record<string, CPNode>;
  edges: CPEdge[];
  criticalNodes: string[];
  projectEnd: number;
  computedAt: number;
}

interface Props {
  criticalPath: CriticalPath | null;
  focusNodeIds?: string[];
  focusToken?: number;
  onRecompute: () => void;
}

export function CriticalPathView({ criticalPath, focusNodeIds = [], focusToken = 0, onRecompute }: Props) {
  const [filter, setFilter] = useState<"all" | "critical" | "at_risk">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "phase" | "artifact">("all");
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  if (!criticalPath) {
    return (
      <div className="p-4 space-y-4">
        <h2 className="text-lg font-semibold">Critical Path Analysis</h2>
        <div className="border rounded p-8 text-center space-y-3">
          <p className="text-gray-400 text-sm">No critical path computed yet.</p>
          <button
            type="button"
            onClick={onRecompute}
            className="bg-indigo-600 text-white text-sm px-4 py-2 rounded hover:bg-indigo-700"
          >
            Compute Critical Path
          </button>
        </div>
      </div>
    );
  }

  const criticalSet = new Set(criticalPath.criticalNodes);
  const nodes = Object.values(criticalPath.nodes || {});
  const focusedNodes = focusNodeIds.map((id) => criticalPath.nodes?.[id]).filter(Boolean);
  const filtered = nodes
    .filter((node) => {
      if (typeFilter !== "all" && node.type !== typeFilter) return false;
      if (filter === "critical" && !criticalSet.has(node.id)) return false;
      if (filter === "at_risk" && !(node.slack > 0 && node.slack <= 3)) return false;
      return true;
    })
    .sort((left, right) => left.earlyStart - right.earlyStart);

  const criticalCount = criticalPath.criticalNodes.length;
  const criticalPhaseCount = criticalPath.criticalNodes.filter((id) => criticalPath.nodes[id]?.type === "phase").length;
  const criticalArtifactCount = criticalPath.criticalNodes.filter((id) => criticalPath.nodes[id]?.type === "artifact").length;

  const phases = ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];
  const maxEnd = Math.max(criticalPath.projectEnd || 1, 1);
  const WIDTH = 560;
  const ROW_HEIGHT = 36;
  const LABEL_WIDTH = 100;

  useEffect(() => {
    if (!focusNodeIds.length) return;
    setFilter("critical");
    const targetId = focusNodeIds.find(Boolean);
    if (!targetId) return;
    const frame = window.requestAnimationFrame(() => {
      rowRefs.current[targetId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusNodeIds, focusToken]);

  function toX(value: number) {
    return LABEL_WIDTH + ((value / maxEnd) * WIDTH);
  }

  return (
    <div className="p-4 space-y-4">
      {focusedNodes.length ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-indigo-700 mb-1">Review requested</div>
          <div className="text-xs text-indigo-900 leading-5">
            ADAM brought you to the critical path focused on {focusedNodes.slice(0, 2).map((node) => `"${node.label}"`).join(" and ")}
            {focusedNodes.length > 2 ? ` plus ${focusedNodes.length - 2} more node(s)` : ""} so you can review the dependency chain behind the alert.
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Critical Path Analysis</h2>
        <div className="flex gap-2">
          <span className="text-xs text-gray-400">Computed {new Date(criticalPath.computedAt).toLocaleString()}</span>
          <button
            type="button"
            onClick={onRecompute}
            className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200"
          >
            Recompute
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 text-sm">
        {[
          ["Project Duration", `${criticalPath.projectEnd} days`, "text-indigo-600"],
          ["Critical Nodes", criticalCount, "text-red-600"],
          ["Critical Phases", criticalPhaseCount, "text-orange-600"],
          ["Critical Artifacts", criticalArtifactCount, "text-yellow-600"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="border rounded p-3 text-center">
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <div className="border rounded overflow-x-auto bg-gray-50">
        <svg width={LABEL_WIDTH + WIDTH + 20} height={(phases.length * ROW_HEIGHT) + 24}>
          {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
            <g key={pct}>
              <line x1={toX(pct * maxEnd)} y1={0} x2={toX(pct * maxEnd)} y2={phases.length * ROW_HEIGHT} stroke="#e2e8f0" strokeWidth="1" />
              <text x={toX(pct * maxEnd) + 2} y={(phases.length * ROW_HEIGHT) + 16} fontSize="8" fill="#94a3b8">
                d{Math.round(pct * maxEnd)}
              </text>
            </g>
          ))}

          {phases.map((phaseId, index) => {
            const phaseNode = criticalPath.nodes[`phase_${phaseId}`];
            if (!phaseNode) return null;
            const y = (index * ROW_HEIGHT) + 4;
            const isCritical = criticalSet.has(phaseNode.id);
            const barX = toX(phaseNode.earlyStart);
            const barWidth = Math.max(4, toX(phaseNode.earlyFinish) - toX(phaseNode.earlyStart));
            const artifactNodes = Object.values(criticalPath.nodes).filter((node) => node.type === "artifact" && node.phase === phaseId);

            return (
              <g key={phaseId}>
                <text x={2} y={y + 16} fontSize="10" fill="#374151" fontWeight="500" className="capitalize">
                  {phaseId.slice(0, 8)}
                </text>
                <rect
                  x={barX}
                  y={y + 2}
                  width={barWidth}
                  height={ROW_HEIGHT - 10}
                  fill={isCritical ? "#fecaca" : "#e0e7ff"}
                  stroke={isCritical ? "#ef4444" : "#a5b4fc"}
                  strokeWidth={isCritical ? 2 : 1}
                  rx="3"
                />
                {isCritical ? (
                  <text x={barX + 3} y={y + 14} fontSize="8" fill="#dc2626" fontWeight="600">CRITICAL</text>
                ) : null}
                {artifactNodes.map((artifactNode) => {
                  const artifactX = toX(artifactNode.earlyStart);
                  const isCriticalArtifact = criticalSet.has(artifactNode.id);
                  return (
                    <circle
                      key={artifactNode.id}
                      cx={artifactX + 4}
                      cy={y + ROW_HEIGHT - 10}
                      r={3}
                      fill={isCriticalArtifact ? "#ef4444" : "#6366f1"}
                      opacity={0.75}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex gap-3 text-xs">
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-red-200 border border-red-400 rounded" /><span>Critical path</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-indigo-100 border border-indigo-300 rounded" /><span>Non-critical</span></div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 bg-red-500 rounded-full" /><span>Critical artifact</span></div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 bg-indigo-500 rounded-full" /><span>Non-critical artifact</span></div>
      </div>

      <div className="flex gap-2 text-xs flex-wrap">
        {[
          ["all", "All"],
          ["critical", "Critical only"],
          ["at_risk", "Near-critical (slack ≤ 3)"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value as "all" | "critical" | "at_risk")}
            className={`px-2 py-0.5 rounded border ${filter === value ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-300"}`}
          >
            {label}
          </button>
        ))}
        {[
          ["all", "All Types"],
          ["phase", "Phases"],
          ["artifact", "Artifacts"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTypeFilter(value as "all" | "phase" | "artifact")}
            className={`px-2 py-0.5 rounded border ${typeFilter === value ? "bg-gray-600 text-white border-gray-600" : "border-gray-300"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50">
            {["Item", "Type", "Phase", "Duration", "Early Start", "Early Finish", "Slack", "Critical"].map((heading) => (
              <th key={heading} className="border px-2 py-1 text-left font-medium">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((node) => (
            <tr
              key={node.id}
              ref={(row) => { rowRefs.current[node.id] = row; }}
              className={`${criticalSet.has(node.id) ? "bg-red-50" : node.slack <= 3 ? "bg-yellow-50" : ""} ${
                focusNodeIds.includes(node.id) ? "ring-2 ring-indigo-400" : ""
              }`}
            >
              <td className="border px-2 py-1 font-medium">{node.label}</td>
              <td className="border px-2 py-1 capitalize">{node.type}</td>
              <td className="border px-2 py-1">{node.phase || "—"}</td>
              <td className="border px-2 py-1 font-mono">{node.duration}d</td>
              <td className="border px-2 py-1 font-mono">d{node.earlyStart}</td>
              <td className="border px-2 py-1 font-mono">d{node.earlyFinish}</td>
              <td className={`border px-2 py-1 font-mono font-bold ${node.slack === 0 ? "text-red-600" : node.slack <= 3 ? "text-yellow-600" : "text-green-600"}`}>
                {node.slack}d
              </td>
              <td className="border px-2 py-1 text-center">{criticalSet.has(node.id) ? "🔴" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
