import React from "react";
import { prefersReducedMotion } from "@/v3/lib/reducedMotion";

interface ReadinessArcGaugeProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  animate?: boolean;
  showLabel?: boolean;
  showLegend?: boolean;
  threshold?: number;
}

function polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, radius: number, startDeg: number, sweepDeg: number) {
  const start = polarToCartesian(cx, cy, radius, startDeg);
  const end = polarToCartesian(cx, cy, radius, startDeg + sweepDeg);
  const largeArcFlag = sweepDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

function toneForScore(score: number) {
  if (score >= 80) return "#22C55E";
  if (score >= 60) return "#F59E0B";
  return "#EF4444";
}

export function ReadinessArcGauge({
  score,
  size = 160,
  strokeWidth = 10,
  animate = true,
  showLabel = true,
  showLegend = false,
  threshold = 70,
}: ReadinessArcGaugeProps) {
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const [displayScore, setDisplayScore] = React.useState(animate ? 0 : clampedScore);

  // Mirror the currently-displayed value so a tween starts from wherever the
  // gauge is now — not from 0. This makes a value *update* (e.g. 70 → 75) glide
  // the short delta rather than snapping back to zero and re-sweeping the whole
  // arc, which read as a jarring flash on every recompute.
  const displayScoreRef = React.useRef(displayScore);
  displayScoreRef.current = displayScore;

  React.useEffect(() => {
    if (!animate || prefersReducedMotion()) {
      setDisplayScore(clampedScore);
      return;
    }

    const from = displayScoreRef.current;
    if (from === clampedScore) return;

    let frame = 0;
    const start = Date.now();
    const duration = 800;

    const tick = () => {
      const t = Math.min((Date.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayScore(Math.round(from + (clampedScore - from) * eased));
      if (t < 1) frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [animate, clampedScore]);

  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const startAngle = 210;
  const totalArc = 240;
  const scoreSweep = (displayScore / 100) * totalArc;
  const color = toneForScore(displayScore);

  return (
    <div className="v3-readiness-gauge-wrap">
      <div
        className={`v3-readiness-gauge ${clampedScore < 60 ? "is-warning" : ""}`}
        style={{ width: size, height: size }}
        role="meter"
        aria-valuenow={clampedScore}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Gate readiness: ${clampedScore}%`}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <path
            d={describeArc(center, center, radius, startAngle, totalArc)}
            fill="none"
            stroke="rgba(46, 51, 71, 0.95)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          {displayScore > 0 ? (
            <path
              d={describeArc(center, center, radius, startAngle, scoreSweep)}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 6px ${color}55)` }}
            />
          ) : null}
        </svg>

        <div className="v3-readiness-gauge-center">
          <span className="v3-readiness-gauge-score">{displayScore}</span>
          <span className="v3-readiness-gauge-denom">/ 100</span>
        </div>
      </div>

      {showLabel ? (
        <div className="v3-readiness-gauge-copy">
          <p className="v3-readiness-gauge-label">Gate Readiness</p>
          <p className={`v3-readiness-gauge-hint ${clampedScore >= 80 ? "is-ready" : ""}`}>
            {clampedScore >= 80 ? "Ready for gate approval" : clampedScore < 60 ? "Significant gaps remain" : "Almost ready"}
          </p>
        </div>
      ) : null}
      {showLegend ? (
        <div style={{ textAlign: "center", marginTop: 6, fontSize: 11, color: "var(--v3-text-muted)", lineHeight: 1.4 }}>
          <span style={{ color: score >= threshold ? "var(--v3-green)" : "var(--v3-amber)" }}>
            {score >= threshold ? "✓ Ready to approve" : `${threshold - score}% more needed`}
          </span>
          <br />
          <span>Target: {threshold}%</span>
        </div>
      ) : null}
    </div>
  );
}
