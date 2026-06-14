import React from "react";
import { cn } from "@/lib/cn";

export type BadgeVariant =
  | "approved" | "pending" | "remediation" | "locked"
  | "high" | "medium" | "low" | "critical"
  | "pass" | "fail" | "partial"
  | "active" | "complete" | "at-risk" | "delayed"
  | "running" | "done" | "error"
  | "open" | "resolved" | "escalated";

const BADGE_STYLE: Record<BadgeVariant, string> = {
  approved: "adam-badge--approved",
  pending: "adam-badge--pending",
  remediation: "adam-badge--remediation",
  locked: "adam-badge--locked",
  high: "adam-badge--high",
  medium: "adam-badge--medium",
  low: "adam-badge--low",
  critical: "adam-badge--critical",
  pass: "adam-badge--approved",
  fail: "adam-badge--remediation",
  partial: "adam-badge--pending",
  active: "adam-badge--active",
  complete: "adam-badge--approved",
  "at-risk": "adam-badge--pending",
  delayed: "adam-badge--remediation",
  running: "adam-badge--running",
  done: "adam-badge--approved",
  error: "adam-badge--remediation",
  open: "adam-badge--pending",
  resolved: "adam-badge--locked",
  escalated: "adam-badge--critical",
};

const BADGE_LABELS: Partial<Record<BadgeVariant, string>> = {
  "at-risk": "At Risk",
  remediation: "Remediation Needed",
};

export function StatusBadge({
  variant,
  label,
  dot = false,
  size = "md",
}: {
  variant: BadgeVariant;
  label?: string;
  dot?: boolean;
  size?: "sm" | "md";
}) {
  const display = label ?? BADGE_LABELS[variant] ?? variant;
  const animated = variant === "running" || variant === "active";

  return (
    <span
      className={cn("adam-badge", BADGE_STYLE[variant], size === "sm" && "adam-badge--sm")}
      style={{
        fontVariantNumeric: "tabular-nums",
        userSelect: "none",
        WebkitUserSelect: "none",
        letterSpacing: "0.03em",
        fontSize: 11,
      } as React.CSSProperties}
    >
      {(dot || animated) ? <span className={cn("adam-badge__dot", animated && "adam-badge__dot--pulse")} /> : null}
      {display}
    </span>
  );
}
