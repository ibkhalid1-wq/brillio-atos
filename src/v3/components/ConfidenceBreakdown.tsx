/**
 * Confidence breakdown — the per-signal scores behind the headline confidence %.
 *
 * Single shared presentation so the Executive summary and the Programme Health
 * screen render the breakdown identically (same bars, colours, status chips) and
 * can never drift apart. Driven by the ConfidenceScore produced by the single
 * source of truth (deriveProgramConfidence / computeConfidenceScore).
 */
import React from "react";
import type { ConfidenceScore } from "@/v3/lib/confidenceScore";

export default function ConfidenceBreakdown({
  confidenceResult,
}: {
  confidenceResult: ConfidenceScore | null | undefined;
}) {
  if (!confidenceResult?.signals?.length) return null;

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
        }}
      >
        Confidence Breakdown{confidenceResult.explanation ? ` — ${confidenceResult.explanation}` : ""}
      </div>
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
