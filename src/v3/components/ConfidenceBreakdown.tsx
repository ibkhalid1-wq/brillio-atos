/**
 * Confidence breakdown — the per-signal scores behind the headline confidence %.
 *
 * Single shared presentation so the Executive summary and the Programme Health
 * screen render the breakdown identically (same bars, colours, status chips) and
 * can never drift apart. Driven by the ConfidenceScore produced by the single
 * source of truth (deriveProgramConfidence / computeConfidenceScore).
 */
import React from "react";
import type { ConfidenceScore, ConfidenceForecast } from "@/v3/lib/confidenceScore";

export default function ConfidenceBreakdown({
  confidenceResult,
  forecast,
}: {
  confidenceResult: ConfidenceScore | null | undefined;
  /** Optional score-history forecast — when present, shows a trend chip + projection. */
  forecast?: ConfidenceForecast | null;
}) {
  if (!confidenceResult?.signals?.length) return null;

  // The trend chip and forecast line only render when a forecast is supplied
  // (i.e. the caller has score history). Surfaces that derive confidence without
  // history pass nothing and see the breakdown exactly as before.
  const trend = confidenceResult.trend;
  const trendChip =
    forecast == null
      ? null
      : trend === "up"
        ? { glyph: "↑", label: "Improving", color: "var(--v3-green)", bg: "rgba(34,197,94,0.12)" }
        : trend === "down"
          ? { glyph: "↓", label: "Declining", color: "var(--v3-red, #ef4444)", bg: "rgba(239,68,68,0.12)" }
          : { glyph: "→", label: "Stable", color: "var(--v3-text-muted)", bg: "var(--v3-border-soft)" };

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--v3-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginBottom: 12,
          fontFamily: "var(--v3-font)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span>Confidence Breakdown{confidenceResult.explanation ? ` — ${confidenceResult.explanation}` : ""}</span>
        {trendChip ? (
          <span
            style={{
              fontSize: 10,
              padding: "1px 7px",
              borderRadius: 10,
              background: trendChip.bg,
              color: trendChip.color,
              fontWeight: 700,
              letterSpacing: 0.3,
            }}
            title={forecast?.message}
          >
            {trendChip.glyph} {trendChip.label}
          </span>
        ) : null}
      </div>
      {forecast?.message ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--v3-text-secondary)",
            marginBottom: 12,
            fontFamily: "var(--v3-font)",
          }}
        >
          {forecast.message}
        </div>
      ) : null}
      <div
        style={{
          background: "var(--v3-surface)",
          border: "1px solid var(--v3-border-soft)",
          borderRadius: "var(--v3-radius)",
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {confidenceResult.signals.map((sig) => {
          const barColor =
            sig.status === "good"
              ? "var(--v3-green)"
              : sig.status === "warn"
                ? "var(--v3-amber)"
                : "var(--v3-red, #ef4444)";
          return (
            <div key={sig.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 160,
                  fontSize: 12,
                  color: "var(--v3-text-secondary)",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  fontFamily: "var(--v3-font)",
                }}
                title={sig.explanation || sig.label}
              >
                {sig.label}
              </div>
              <div style={{ flex: 1, height: 6, background: "var(--v3-border-soft)", borderRadius: 3, overflow: "hidden", minWidth: 60 }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, Math.max(0, sig.score))}%`,
                    background: barColor,
                    borderRadius: 3,
                    transition: "width 0.4s",
                  }}
                />
              </div>
              <div style={{ width: 38, fontSize: 12, fontWeight: 600, color: barColor, textAlign: "right", flexShrink: 0, fontFamily: "var(--v3-font)" }}>
                {Math.round(sig.score)}
              </div>
              <div
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 10,
                  background:
                    sig.status === "good"
                      ? "rgba(34,197,94,0.12)"
                      : sig.status === "warn"
                        ? "rgba(245,158,11,0.12)"
                        : "rgba(239,68,68,0.12)",
                  color: barColor,
                  fontWeight: 600,
                  flexShrink: 0,
                  letterSpacing: 0.2,
                  textTransform: "uppercase",
                  fontFamily: "var(--v3-font)",
                }}
              >
                {sig.status}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
