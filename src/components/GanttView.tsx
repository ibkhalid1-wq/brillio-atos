import { useMemo, useState } from "react";

const PHASE_COLORS: Record<string, string> = {
  pending: "#e2e8f0",
  active: "#6366f1",
  complete: "#22c55e",
};

interface PhaseRow {
  phaseId: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: number | null;
  actualEnd: number | null;
  forecastEnd: string | null;
  status: string;
  completionPct: number;
}

interface Props {
  rows: PhaseRow[];
  onSchedule: (phaseId: string, field: string, value: string) => void;
}

function toMs(value: string | number | null): number | null {
  if (!value) return null;
  const parsed = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("default", { month: "short", day: "numeric" });
}

export function GanttView({ rows, onSchedule }: Props) {
  const [editing, setEditing] = useState<{ phaseId: string; field: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [hoveredPhase, setHoveredPhase] = useState<string | null>(null);

  const allDates = rows.flatMap((row) => [
    toMs(row.plannedStart),
    toMs(row.plannedEnd),
    toMs(row.actualStart),
    toMs(row.actualEnd),
    toMs(row.forecastEnd),
  ]).filter((value): value is number => value !== null);

  const minTs = allDates.length ? Math.min(...allDates) : Date.now() - (30 * 86_400_000);
  const maxTs = allDates.length ? Math.max(...allDates) : Date.now() + (90 * 86_400_000);
  const span = Math.max(maxTs - minTs, 30 * 86_400_000);
  const BAR_WIDTH = 560;
  const ROW_HEIGHT = 44;
  const LABEL_WIDTH = 110;
  const today = Date.now();

  function toX(timestamp: number) {
    return LABEL_WIDTH + (((timestamp - minTs) / span) * BAR_WIDTH);
  }

  const ticks = useMemo(() => {
    const result: Array<{ x: number; label: string }> = [];
    const date = new Date(minTs);
    date.setDate(1);
    while (date.getTime() <= maxTs) {
      result.push({
        x: toX(date.getTime()),
        label: date.toLocaleDateString("default", { month: "short", year: "2-digit" }),
      });
      date.setMonth(date.getMonth() + 1);
    }
    return result;
  }, [minTs, maxTs]);

  const svgHeight = rows.length * ROW_HEIGHT + 40;
  const svgWidth = LABEL_WIDTH + BAR_WIDTH + 20;
  const todayX = toX(today);

  function startEdit(phaseId: string, field: string, current: string | null) {
    setEditing({ phaseId, field });
    setEditVal(current ? new Date(current).toISOString().slice(0, 10) : "");
  }

  function commitEdit() {
    if (!editing) return;
    onSchedule(editing.phaseId, editing.field, editVal);
    setEditing(null);
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold">Program Timeline</h2>

      <div className="flex gap-4 text-xs">
        {[["Planned", "#e2e8f0", "border"], ["Actual", "#6366f1", "fill"], ["Forecast", "#f59e0b", "dashed"], ["Today", "#ef4444", "line"]].map(([label, color, tone]) => (
          <div key={label as string} className="flex items-center gap-1.5">
            {tone === "fill" ? <div className="w-8 h-3 rounded" style={{ backgroundColor: color as string }} /> : null}
            {tone === "border" ? <div className="w-8 h-3 rounded border-2" style={{ borderColor: color as string, background: "transparent" }} /> : null}
            {tone === "dashed" ? <div className="w-8 h-0 border-t-2 border-dashed" style={{ borderColor: color as string }} /> : null}
            {tone === "line" ? <div className="w-8 h-0 border-t-2" style={{ borderColor: color as string }} /> : null}
            <span className="text-gray-500">{label}</span>
          </div>
        ))}
      </div>

      <div className="border rounded overflow-x-auto">
        <svg width={svgWidth} height={svgHeight} className="font-sans">
          {ticks.map((tick, index) => (
            <g key={`${tick.label}-${index}`}>
              <line x1={tick.x} y1={0} x2={tick.x} y2={svgHeight - 20} stroke="#f1f5f9" strokeWidth="1" />
              <text x={tick.x + 3} y={svgHeight - 6} fontSize="9" fill="#94a3b8">{tick.label}</text>
            </g>
          ))}

          <line x1={todayX} y1={0} x2={todayX} y2={svgHeight - 20} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3 2" />
          <text x={todayX + 2} y={12} fontSize="8" fill="#ef4444">Today</text>

          {rows.map((row, index) => {
            const y = index * ROW_HEIGHT + 8;
            const barY = y + 6;
            const barHeight = 18;
            const isHovered = hoveredPhase === row.phaseId;
            const plannedStart = toMs(row.plannedStart);
            const plannedEnd = toMs(row.plannedEnd);
            const actualStart = toMs(row.actualStart);
            const actualEnd = toMs(row.actualEnd);
            const forecastEnd = toMs(row.forecastEnd);

            return (
              <g key={row.phaseId} onMouseEnter={() => setHoveredPhase(row.phaseId)} onMouseLeave={() => setHoveredPhase(null)}>
                <rect x={0} y={y} width={svgWidth} height={ROW_HEIGHT - 2} fill={isHovered ? "#f8fafc" : "transparent"} />
                <text x={4} y={barY + 13} fontSize="11" fill="#374151" fontWeight="500" className="capitalize">{row.phaseId}</text>
                {plannedStart && plannedEnd ? (
                  <rect
                    x={toX(plannedStart)}
                    y={barY}
                    width={Math.max(4, toX(plannedEnd) - toX(plannedStart))}
                    height={barHeight}
                    fill="transparent"
                    stroke="#cbd5e1"
                    strokeWidth="1.5"
                    rx="3"
                  />
                ) : null}
                {actualStart ? (
                  <rect
                    x={toX(actualStart)}
                    y={barY}
                    width={Math.max(4, toX(actualEnd || today) - toX(actualStart))}
                    height={barHeight}
                    fill={PHASE_COLORS[row.status] || "#e2e8f0"}
                    rx="3"
                    opacity={0.85}
                  />
                ) : null}
                {actualStart && !actualEnd && row.completionPct > 0 ? (
                  <rect
                    x={toX(actualStart)}
                    y={barY}
                    width={Math.max(2, (toX(today) - toX(actualStart)) * (row.completionPct / 100))}
                    height={barHeight}
                    fill="#4f46e5"
                    rx="3"
                    opacity={0.4}
                  />
                ) : null}
                {forecastEnd && !actualEnd ? (
                  <line
                    x1={toX(forecastEnd)}
                    y1={barY - 2}
                    x2={toX(forecastEnd)}
                    y2={barY + barHeight + 2}
                    stroke="#f59e0b"
                    strokeWidth="2"
                    strokeDasharray="3 2"
                  />
                ) : null}
                <circle cx={LABEL_WIDTH - 10} cy={barY + (barHeight / 2)} r={4} fill={PHASE_COLORS[row.status] || "#e2e8f0"} />
                {row.completionPct > 0 && actualStart ? (
                  <text x={toX(actualStart) + 4} y={barY + 12} fontSize="9" fill="#fff" fontWeight="600">
                    {row.completionPct}%
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Phase Schedule</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                {["Phase", "Planned Start", "Planned End", "Actual Start", "Actual End", "Status", "Progress"].map((heading) => (
                  <th key={heading} className="border px-2 py-1 text-left font-medium">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.phaseId} className="hover:bg-gray-50">
                  <td className="border px-2 py-1 capitalize font-medium">{row.phaseId}</td>
                  {(["plannedStart", "plannedEnd"] as const).map((field) => {
                    const value = row[field];
                    const isEditing = editing?.phaseId === row.phaseId && editing.field === field;
                    return (
                      <td key={field} className="border px-2 py-1">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <input
                              type="date"
                              value={editVal}
                              onChange={(event) => setEditVal(event.target.value)}
                              className="border rounded px-1 py-0.5 text-xs"
                            />
                            <button type="button" onClick={commitEdit} className="text-green-600 px-1">✓</button>
                            <button type="button" onClick={() => setEditing(null)} className="text-red-400 px-1">✗</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(row.phaseId, field, value as string | null)}
                            className="text-indigo-600 hover:underline"
                          >
                            {value ? new Date(value).toLocaleDateString() : "+ set"}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="border px-2 py-1">{row.actualStart ? fmtDate(row.actualStart) : "—"}</td>
                  <td className="border px-2 py-1">
                    {row.actualEnd ? fmtDate(row.actualEnd) : row.forecastEnd ? `~${new Date(row.forecastEnd).toLocaleDateString()}` : "—"}
                  </td>
                  <td className="border px-2 py-1 capitalize">
                    <span
                      className={`px-1.5 rounded text-[10px] ${
                        PHASE_COLORS[row.status] === "#22c55e"
                          ? "bg-green-100 text-green-700"
                          : row.status === "active"
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="border px-2 py-1">
                    <div className="flex items-center gap-1">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${row.completionPct}%` }} />
                      </div>
                      <span>{row.completionPct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
