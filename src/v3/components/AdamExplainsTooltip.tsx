import React, { useRef, useState } from "react";
import { getGateThreshold } from "@/v3/lib/confidenceScore";

interface AdamExplainsTooltipProps {
  metric: string;
  value?: number | string | null;
  context?: Record<string, unknown>;
  children: React.ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
}

interface Explanation {
  title: string;
  body: string;
  tip?: string;
}

function getExplanation(
  metric: string,
  value: number | string | null | undefined,
  context?: Record<string, unknown>
): Explanation {
  switch (metric) {
    case "confidence": {
      const score = typeof value === "number" ? value : 0;
      return {
        title: "Programme Confidence Score",
        body: `A composite score (0–100) calculated from gate readiness, risk posture, milestone health, and decision load. Your current score is ${score}.`,
        tip:
          score < 70
            ? "Run a Gate Check to identify what's pulling this score down."
            : "Continue resolving decisions and progressing milestones to maintain this level.",
      };
    }
    case "gate-readiness": {
      const phaseId = typeof context?.phaseId === "string" ? context.phaseId : "";
      const threshold = getGateThreshold(phaseId);
      return {
        title: "Readiness to Close",
        body: "Measures whether this phase has met its exit criteria and is ready to proceed. ATOS calculates this from artifact completeness, exit criteria ticked, and open blockers.",
        tip: `Aim for ${threshold}% or above before signing off the phase.`,
      };
    }
    case "rag-status":
      return {
        title: "RAG Health Status",
        body: "Red–Amber–Green health indicator. Green = on track. Amber = caution. Red = at risk. Calculated from milestone progress, risk register, and delivery pace.",
        tip: undefined,
      };
    case "open-decisions":
      return {
        title: "Open Actions",
        body: "Actions that have been raised but not yet resolved — decisions to make, reviews to run, revisions to apply. Unresolved actions can block gate approvals and delay delivery.",
        tip: "Resolve critical and high-priority actions first.",
      };
    case "completion":
      return {
        title: "Phase Completion",
        body: "The estimated percentage of work completed in this phase. Updated manually or by agents based on milestone progress.",
        tip: "Set this to 100% only when all exit criteria are met and the gate is approved.",
      };
    default:
      return {
        title: metric,
        body: "This metric tracks programme performance. Hover over any indicator for contextual guidance.",
        tip: undefined,
      };
  }
}

const TOOLTIP_WIDTH = 280;
const TOOLTIP_OFFSET = 10;

export default function AdamExplainsTooltip({
  metric,
  value,
  context,
  children,
  placement = "top",
}: AdamExplainsTooltipProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const explanation = getExplanation(metric, value, context);

  function calculatePosition() {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();

    let top = 0;
    let left = 0;

    switch (placement) {
      case "top":
        top = rect.top - TOOLTIP_OFFSET;
        left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
        break;
      case "bottom":
        top = rect.bottom + TOOLTIP_OFFSET;
        left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
        break;
      case "left":
        top = rect.top + rect.height / 2;
        left = rect.left - TOOLTIP_WIDTH - TOOLTIP_OFFSET;
        break;
      case "right":
        top = rect.top + rect.height / 2;
        left = rect.right + TOOLTIP_OFFSET;
        break;
    }

    // Clamp horizontally
    left = Math.max(8, Math.min(left, window.innerWidth - TOOLTIP_WIDTH - 8));
    // Clamp vertically (rough estimate: tooltip ~120px tall)
    top = Math.max(8, Math.min(top, window.innerHeight - 130));

    setTooltipPos({ top, left });
  }

  function handleShow() {
    calculatePosition();
    setVisible(true);
  }

  function handleHide() {
    setVisible(false);
  }

  // For "top" placement, translate upward so the bottom of tooltip aligns near trigger
  const transformStyle =
    placement === "top"
      ? "translateY(-100%)"
      : placement === "left" || placement === "right"
      ? "translateY(-50%)"
      : "none";

  return (
    <>
      <div
        ref={wrapperRef}
        onMouseEnter={handleShow}
        onMouseLeave={handleHide}
        onFocus={handleShow}
        onBlur={handleHide}
        style={{ position: "relative", display: "inline-flex" }}
      >
        {children}
      </div>

      {visible && (
        <div
          role="tooltip"
          style={{
            position: "fixed",
            top: tooltipPos.top,
            left: tooltipPos.left,
            zIndex: 500,
            width: TOOLTIP_WIDTH,
            background: "var(--v3-surface)",
            border: "1px solid var(--v3-border)",
            borderRadius: "var(--v3-radius)",
            padding: "12px 14px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            fontSize: 12,
            fontFamily: "var(--v3-font)",
            transform: transformStyle,
            pointerEvents: "none",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 7,
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: 12,
                color: "var(--v3-text-primary)",
                lineHeight: 1.3,
              }}
            >
              {explanation.title}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--v3-accent)",
                background: "var(--v3-accent-soft)",
                borderRadius: 99,
                padding: "2px 7px",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              ⓘ ATOS Explains
            </span>
          </div>

          {/* Body */}
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: "var(--v3-text-secondary)",
              lineHeight: 1.5,
              marginBottom: explanation.tip ? 7 : 0,
            }}
          >
            {explanation.body}
          </p>

          {/* Tip */}
          {explanation.tip && (
            <p
              style={{
                margin: 0,
                fontSize: 11,
                color: "var(--v3-text-muted)",
                fontStyle: "italic",
                lineHeight: 1.45,
              }}
            >
              ✦ {explanation.tip}
            </p>
          )}
        </div>
      )}
    </>
  );
}
