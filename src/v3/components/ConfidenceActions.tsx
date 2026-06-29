/**
 * Confidence actions — the specific, prioritised steps to close the gaps behind
 * the headline confidence %.
 *
 * Driven by the SAME ConfidenceScore as ConfidenceBreakdown, so the actions can
 * never drift from the bars they remediate: each weak signal (status poor/warn)
 * surfaces its own `topAction`, ordered worst-first then by weight — exactly the
 * priority the model uses to pick `topRecommendation`. Nothing is hard-coded; an
 * all-healthy programme renders the positive empty state.
 */
import React from "react";
import type { ConfidenceScore, ConfidenceSignal } from "@/v3/lib/confidenceScore";

function priority(status: ConfidenceSignal["status"]): number {
  return status === "poor" ? 0 : status === "warn" ? 1 : 2;
}

export default function ConfidenceActions({
  confidenceResult,
}: {
  confidenceResult: ConfidenceScore | null | undefined;
}) {
  if (!confidenceResult?.signals?.length) return null;

  const actions = confidenceResult.signals
    .filter((sig) => sig.status !== "good" && sig.topAction)
    .sort((a, b) => {
      const p = priority(a.status) - priority(b.status);
      return p !== 0 ? p : b.weight - a.weight;
    });

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
        Actions to Address Gaps
      </div>
      <div
        style={{
          background: "var(--v3-surface)",
          border: "1px solid var(--v3-border-soft)",
          borderRadius: "var(--v3-radius)",
          padding: actions.length ? "8px 10px" : "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: actions.length ? 4 : 0,
        }}
      >
        {actions.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", fontFamily: "var(--v3-font)" }}>
            All confidence signals are healthy — no gaps to address right now.
          </div>
        ) : (
          actions.map((sig) => {
            const accent =
              sig.status === "warn" ? "var(--v3-amber)" : "var(--v3-red, #ef4444)";
            return (
              <div
                key={sig.label}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "8px 8px",
                  borderRadius: 8,
                }}
              >
                <span
                  style={{
                    marginTop: 5,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: accent,
                    flexShrink: 0,
                  }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--v3-text-primary)",
                      lineHeight: 1.45,
                      fontFamily: "var(--v3-font)",
                    }}
                  >
                    {sig.topAction}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--v3-text-muted)",
                      fontFamily: "var(--v3-font)",
                    }}
                  >
                    {sig.label} · {sig.explanation}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
