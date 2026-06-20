import React, { useState } from "react";

const LINK_TYPES = [
  { id: "shared_platform", label: "Shared Platform", color: "#6366f1" },
  { id: "shared_team", label: "Shared Team", color: "#f59e0b" },
  { id: "shared_output", label: "Shared Output", color: "#10b981" },
  { id: "sequential", label: "Sequential Dependency", color: "#ef4444" },
  { id: "data_dependency", label: "Data Dependency", color: "#8b5cf6" },
];

interface PNode {
  id: string;
  label: string;
  isCurrent: boolean;
  health: number | null;
}

interface PEdge {
  id: string;
  fromProgramId: string;
  toProgramId: string;
  linkType: string;
  description: string;
  color: string;
}

interface Link {
  id: string;
  fromProgramId: string;
  toProgramId: string;
  linkType: string;
  description: string;
  fromPhase: string;
  toPhase: string;
  status: string;
}

interface Props {
  nodes: PNode[];
  edges: PEdge[];
  links: Link[];
  cascadeAlerts: string[];
  currentProgramId: string;
  programNames: Record<string, string>;
  onSave: (link: Link) => void;
  onDelete: (id: string) => void;
}

const PHASES = ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];
const BLANK_LINK: Link = {
  id: "",
  fromProgramId: "",
  toProgramId: "",
  linkType: "sequential",
  description: "",
  fromPhase: "",
  toPhase: "",
  status: "active",
};

export function CrossProgramMapView({
  nodes,
  edges,
  links,
  cascadeAlerts,
  currentProgramId,
  programNames,
  onSave,
  onDelete,
}: Props) {
  const [form, setForm] = useState<Link>({
    ...BLANK_LINK,
    id: globalThis.crypto?.randomUUID?.() || "",
    fromProgramId: currentProgramId,
  });
  const [open, setOpen] = useState(false);
  const width = 700;
  const height = 400;
  const radius = 160;

  const positions: Record<string, { x: number; y: number }> = {};
  nodes.forEach((node, index) => {
    const angle = ((2 * Math.PI * index) / Math.max(nodes.length, 1)) - (Math.PI / 2);
    positions[node.id] = {
      x: (width / 2) + (radius * Math.cos(angle)),
      y: (height / 2) + (radius * Math.sin(angle)),
    };
  });

  function healthColor(health: number | null) {
    if (health === null) return "#94a3b8";
    if (health >= 75) return "#22c55e";
    if (health >= 50) return "#f59e0b";
    return "#ef4444";
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onSave(form);
    setForm({
      ...BLANK_LINK,
      id: globalThis.crypto?.randomUUID?.() || "",
      fromProgramId: currentProgramId,
    });
    setOpen(false);
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Cross-Program Dependencies</h2>
        <button type="button" onClick={() => setOpen((value) => !value)} className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700">
          + Add Dependency
        </button>
      </div>

      {nodes.length ? (
        <svg width={width} height={height} className="w-full rounded border bg-gray-50">
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const from = positions[edge.fromProgramId];
            const to = positions[edge.toProgramId];
            if (!from || !to) return null;
            const isCascade = cascadeAlerts.includes(edge.id);
            return (
              <g key={edge.id}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={isCascade ? "#ef4444" : edge.color}
                  strokeWidth={isCascade ? 2.5 : 1.5}
                  strokeDasharray={isCascade ? "4 2" : undefined}
                  markerEnd="url(#arrow)"
                  opacity={0.7}
                />
                {edge.description ? (
                  <text x={(from.x + to.x) / 2} y={((from.y + to.y) / 2) - 6} textAnchor="middle" fontSize="9" fill={edge.color} className="pointer-events-none">
                    {LINK_TYPES.find((type) => type.id === edge.linkType)?.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {nodes.map((node) => {
            const pos = positions[node.id];
            if (!pos) return null;
            return (
              <g key={node.id} transform={`translate(${pos.x},${pos.y})`}>
                <circle r={28} fill={node.isCurrent ? "#6366f1" : "#fff"} stroke={healthColor(node.health)} strokeWidth={2.5} />
                <text textAnchor="middle" dy="0.35em" fontSize="9" fill={node.isCurrent ? "#fff" : "#1e293b"} fontWeight="500">
                  {node.label.slice(0, 12)}
                </text>
                {node.health !== null ? (
                  <text textAnchor="middle" dy="1.6em" fontSize="8" fill={healthColor(node.health)}>
                    {node.health}%
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : (
        <div className="rounded border p-8 text-center text-sm text-gray-400">
          No programs in the portfolio yet. Add programs to visualize cross-dependencies.
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-xs">
        {LINK_TYPES.map((type) => (
          <div key={type.id} className="flex items-center gap-1">
            <div className="h-0.5 w-4" style={{ backgroundColor: type.color }} />
            <span className="text-gray-500">{type.label}</span>
          </div>
        ))}
        {cascadeAlerts.length ? <div className="flex items-center gap-1 text-red-500"><span>⚠️ {cascadeAlerts.length} cascade risk(s)</span></div> : null}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Dependency List</h3>
        <div className="space-y-1">
          {!links.length ? <p className="text-xs text-gray-400">No dependencies defined.</p> : null}
          {links.map((link) => {
            const isCascade = cascadeAlerts.includes(link.id);
            return (
              <div key={link.id} className={`flex items-start justify-between gap-2 rounded border p-2 text-xs ${isCascade ? "border-red-300 bg-red-50" : ""}`}>
                <div>
                  <span className="font-medium">{programNames[link.fromProgramId] || link.fromProgramId}</span>
                  <span className="mx-1 text-gray-400">→</span>
                  <span className="font-medium">{programNames[link.toProgramId] || link.toProgramId}</span>
                  <span className="ml-2 text-gray-400">{LINK_TYPES.find((type) => type.id === link.linkType)?.label}</span>
                  {isCascade ? <span className="ml-2 text-red-600">⚠️ cascade risk</span> : null}
                  {link.description ? <p className="mt-0.5 text-gray-500">{link.description}</p> : null}
                </div>
                <button type="button" onClick={() => onDelete(link.id)} className="shrink-0 text-red-400 hover:text-red-600">✕</button>
              </div>
            );
          })}
        </div>
      </div>

      {open ? (
        <form onSubmit={submit} className="grid grid-cols-2 gap-3 rounded border bg-gray-50 p-4 text-sm">
          <h3 className="col-span-2 font-medium">New Cross-Program Dependency</h3>
          <div>
            <label className="text-xs text-gray-500">From Program</label>
            <select value={form.fromProgramId} onChange={(event) => setForm((prev) => ({ ...prev, fromProgramId: event.target.value }))} className="w-full rounded border px-2 py-1">
              {nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">To Program</label>
            <select value={form.toProgramId} onChange={(event) => setForm((prev) => ({ ...prev, toProgramId: event.target.value }))} className="w-full rounded border px-2 py-1">
              {nodes.filter((node) => node.id !== form.fromProgramId).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
          </div>
          <select value={form.linkType} onChange={(event) => setForm((prev) => ({ ...prev, linkType: event.target.value }))} className="rounded border px-2 py-1">
            {LINK_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
          </select>
          <input placeholder="Description" value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} className="rounded border px-2 py-1" />
          <div>
            <label className="text-xs text-gray-500">From Phase</label>
            <select value={form.fromPhase} onChange={(event) => setForm((prev) => ({ ...prev, fromPhase: event.target.value }))} className="w-full rounded border px-2 py-1">
              <option value="">Select phase</option>
              {PHASES.map((phaseId) => <option key={phaseId} value={phaseId}>{phaseId}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">To Phase</label>
            <select value={form.toPhase} onChange={(event) => setForm((prev) => ({ ...prev, toPhase: event.target.value }))} className="w-full rounded border px-2 py-1">
              <option value="">Select phase</option>
              {PHASES.map((phaseId) => <option key={phaseId} value={phaseId}>{phaseId}</option>)}
            </select>
          </div>
          <div className="col-span-2 flex gap-2">
            <button type="submit" className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700">Save</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded bg-gray-200 px-3 py-1.5 hover:bg-gray-300">Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
