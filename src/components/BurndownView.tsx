import React, { useState } from "react";

interface Snapshot {
  ts: string;
  openRaidItems: number;
  resolvedRaidItems: number;
  openQuestions: number;
  answeredQuestions: number;
  totalArtifacts: number;
  approvedArtifacts: number;
  missingArtifacts: number;
  openEscalations: number;
  avgGateReadiness: number;
}

interface BurndownViewProps {
  history: Snapshot[];
}

const METRICS = [
  { key: "missingArtifacts", label: "Missing Artifacts", color: "#2563eb", ideal: "down" },
  { key: "openRaidItems", label: "Open RAID Items", color: "#dc2626", ideal: "down" },
  { key: "openQuestions", label: "Open Questions", color: "#d97706", ideal: "down" },
  { key: "avgGateReadiness", label: "Avg Gate Readiness %", color: "#16a34a", ideal: "up" },
] as const;

export function BurndownView({ history }: BurndownViewProps) {
  const [metric, setMetric] = useState<string>("missingArtifacts");
  const [range, setRange] = useState(30);

  const visible = history.slice(-range);
  if (!visible.length) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>
        Burndown data will accumulate as the program progresses.
      </div>
    );
  }

  const values = visible.map((snapshot) => (snapshot as any)[metric] as number);
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const latest = values.at(-1) ?? 0;
  const earliest = values[0] ?? 0;
  const trend = latest - earliest;
  const metaDef = METRICS.find((entry) => entry.key === metric)!;
  const trendGood = metaDef.ideal === "down" ? trend <= 0 : trend >= 0;

  const W = 600;
  const H = 200;
  const PAD = { top: 16, right: 16, bottom: 32, left: 40 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const points = values.map((value, index) => ({
    x: PAD.left + (index / Math.max(visible.length - 1, 1)) * chartW,
    y: PAD.top + chartH - ((value - min) / Math.max(max - min, 1)) * chartH,
    v: value,
    ts: visible[index].ts,
  }));

  const pathD = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${points.at(-1)!.x},${PAD.top + chartH} L${PAD.left},${PAD.top + chartH} Z`;

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>Burndown Tracking</h2>
      <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 13 }}>Program velocity over time.</p>

      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {METRICS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setMetric(entry.key)}
            style={{
              padding: "5px 12px",
              borderRadius: 8,
              border: "2px solid",
              borderColor: metric === entry.key ? entry.color : "#e5e7eb",
              background: metric === entry.key ? `${entry.color}15` : "white",
              color: metric === entry.key ? entry.color : "#6b7280",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: metric === entry.key ? 600 : 400,
            }}
          >
            {entry.label}
          </button>
        ))}
        <select
          value={range}
          onChange={(event) => setRange(Number(event.target.value))}
          style={{ marginLeft: "auto", padding: "4px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}
        >
          <option value={14}>Last 14 snapshots</option>
          <option value={30}>Last 30</option>
          <option value={60}>Last 60</option>
          <option value={120}>All</option>
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Current", value: latest },
          { label: "Change", value: `${trend >= 0 ? "+" : ""}${trend}`, color: trendGood ? "#16a34a" : "#dc2626" },
          { label: "Snapshots", value: visible.length },
        ].map((entry) => (
          <div key={entry.label} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, background: "white" }}>
            <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>{entry.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: (entry as any).color ?? "#1e293b" }}>{entry.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
        <svg width={W} height={H} style={{ display: "block", width: "100%", height: "auto" }}>
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const y = PAD.top + tick * chartH;
            const val = Math.round(max - tick * (max - min));
            return (
              <g key={tick}>
                <line x1={PAD.left} y1={y} x2={PAD.left + chartW} y2={y} stroke="#f3f4f6" strokeWidth={1} />
                <text x={PAD.left - 4} y={y + 4} textAnchor="end" style={{ fontSize: 9, fill: "#9ca3af" }}>{val}</text>
              </g>
            );
          })}
          <path d={areaD} fill={metaDef.color} opacity={0.08} />
          <path d={pathD} fill="none" stroke={metaDef.color} strokeWidth={2} />
          {points.map((point, index) => (
            <circle key={index} cx={point.x} cy={point.y} r={3} fill={metaDef.color}>
              <title>{new Date(point.ts).toLocaleString()}: {point.v}</title>
            </circle>
          ))}
          {points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 6)) === 0).map((point, index) => (
            <text key={index} x={point.x} y={H - 6} textAnchor="middle" style={{ fontSize: 9, fill: "#9ca3af" }}>
              {new Date(point.ts).toLocaleDateString()}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
