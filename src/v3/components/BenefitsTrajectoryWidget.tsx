import React from "react";

interface BenefitForecast {
  forecastedRealization: number | null;
  trajectoryStatus: string;
  gaps: string[];
  recommendation: string | null;
  projectedFinalValue: number | null;
  computedAt: string;
}

interface BenefitsTrajectoryWidgetProps {
  benefitForecast: BenefitForecast | null;
  onRunAgent: () => void;
  isRunning?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return "1 month ago";
  return `${diffMonths} months ago`;
}

function getTrajectoryConfig(status: string): {
  label: string;
  color: string;
  background: string;
  border: string;
} {
  switch (status?.toLowerCase()) {
    case "on-track":
    case "on_track":
      return {
        label: "On Track",
        color: "#16a34a",
        background: "rgba(34,197,94,0.12)",
        border: "rgba(34,197,94,0.25)",
      };
    case "at-risk":
    case "at_risk":
      return {
        label: "At Risk",
        color: "#d97706",
        background: "rgba(245,158,11,0.12)",
        border: "rgba(245,158,11,0.25)",
      };
    case "off-track":
    case "off_track":
      return {
        label: "Off Track",
        color: "#dc2626",
        background: "rgba(239,68,68,0.12)",
        border: "rgba(239,68,68,0.25)",
      };
    default:
      return {
        label: status || "Unknown",
        color: "var(--v3-text-muted)",
        background: "rgba(148,163,184,0.1)",
        border: "rgba(148,163,184,0.2)",
      };
  }
}

// ─── Circular gauge ───────────────────────────────────────────────────────────

function CircularGauge({ pct, color }: { pct: number; color: string }) {
  const size = 88;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, pct));
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <svg width={size} height={size} style={{ display: "block", flexShrink: 0 }}>
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--v3-border)"
        strokeWidth={strokeWidth}
      />
      {/* Progress arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      {/* Centre label */}
      <text
        x={size / 2}
        y={size / 2 + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{
          fontSize: 18,
          fontWeight: 700,
          fill: color,
          fontFamily: "inherit",
        }}
      >
        {clamped}%
      </text>
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BenefitsTrajectoryWidget({
  benefitForecast,
  onRunAgent,
  isRunning = false,
}: BenefitsTrajectoryWidgetProps) {
  // ── Empty state ──────────────────────────────────────────────────────────
  if (!benefitForecast) {
    return (
      <div
        style={{
          background: "var(--v3-surface)",
          border: "1px solid var(--v3-border)",
          borderRadius: "var(--v3-radius-lg)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 32 }}>📈</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--v3-text-primary)" }}>
            No Benefit Forecast
          </div>
          <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 4, lineHeight: 1.5 }}>
            Run the benefit forecast agent to project realisation trajectory.
          </div>
        </div>
        <button
          type="button"
          className="v3-button primary"
          onClick={onRunAgent}
          disabled={isRunning}
          style={{ marginTop: 4 }}
        >
          {isRunning ? "Running…" : "Run Benefit Forecast"}
        </button>
      </div>
    );
  }

  const trajectoryConfig = getTrajectoryConfig(benefitForecast.trajectoryStatus);
  const pct = benefitForecast.forecastedRealization ?? 0;
  const visibleGaps = (benefitForecast.gaps ?? []).slice(0, 4);

  return (
    <div
      style={{
        background: "var(--v3-surface)",
        border: "1px solid var(--v3-border)",
        borderRadius: "var(--v3-radius-lg)",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>
          Benefits Trajectory
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.03em",
            background: trajectoryConfig.background,
            color: trajectoryConfig.color,
            border: `1px solid ${trajectoryConfig.border}`,
          }}
        >
          {trajectoryConfig.label}
        </span>
      </div>

      {/* Gauge + stats */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <CircularGauge pct={pct} color={trajectoryConfig.color} />

        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Forecasted Realisation
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--v3-text-primary)", lineHeight: 1.2, marginTop: 2 }}>
              {pct}%
            </div>
          </div>

          {benefitForecast.projectedFinalValue != null && (
            <div>
              <div style={{ fontSize: 11, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Projected Value
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--v3-text-secondary)", marginTop: 2 }}>
                {formatCurrency(benefitForecast.projectedFinalValue)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Gaps */}
      {visibleGaps.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--v3-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 6,
            }}
          >
            Identified Gaps
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {visibleGaps.map((gap, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 6,
                  fontSize: 12,
                  color: "var(--v3-text-secondary)",
                  lineHeight: 1.4,
                }}
              >
                <span style={{ color: "#f59e0b", marginTop: 2, flexShrink: 0 }}>▸</span>
                <span>{gap}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendation */}
      {benefitForecast.recommendation && (
        <div
          style={{
            background: "var(--v3-surface-2)",
            border: "1px solid var(--v3-border)",
            borderRadius: "var(--v3-radius)",
            padding: "10px 12px",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            Recommendation
          </div>
          <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>
            {benefitForecast.recommendation}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
          Computed {relativeTime(benefitForecast.computedAt)}
        </div>
        <button
          type="button"
          className="v3-button ghost"
          onClick={onRunAgent}
          disabled={isRunning}
          style={{ fontSize: 12, padding: "4px 12px" }}
        >
          {isRunning ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  border: "2px solid var(--v3-accent)",
                  borderTopColor: "transparent",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                  display: "inline-block",
                }}
              />
              Running…
            </span>
          ) : (
            "Refresh"
          )}
        </button>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
