type StatusValue = "approved" | "active" | "complete" | "on-track" |
  "in-progress" | "pending" | "open" |
  "remediation-requested" | "at-risk" | "delayed" |
  "blocked" | "critical" | "failed" |
  "draft" | "finalized" | "cancelled" | "closed" | "n/a";

type SeverityValue = "low" | "medium" | "high" | "critical";
type RiskLevel = "low" | "medium" | "high" | "critical";
type ReadinessLevel = "not-started" | "in-progress" | "at-risk" | "ready";

const GREEN = { bg: "var(--v3-green-soft)", text: "var(--v3-green)", border: "rgba(34,197,94,0.3)" };
const BLUE  = { bg: "var(--v3-accent-b-soft)", text: "var(--v3-accent-b)", border: "rgba(0,160,223,0.3)" };
const AMBER = { bg: "var(--v3-amber-soft)", text: "var(--v3-amber)", border: "rgba(245,158,11,0.3)" };
const RED   = { bg: "var(--v3-red-soft)", text: "var(--v3-red)", border: "rgba(239,68,68,0.3)" };
const MUTED = { bg: "var(--v3-surface-3)", text: "var(--v3-text-muted)", border: "var(--v3-border)" };

const STATUS_MAP: Record<string, typeof GREEN> = {
  approved: GREEN, active: GREEN, complete: GREEN, "on-track": GREEN,
  "in-progress": BLUE, pending: BLUE, open: BLUE,
  "remediation-requested": AMBER, "at-risk": AMBER, delayed: AMBER,
  blocked: RED, critical: RED, failed: RED,
  draft: MUTED, finalized: MUTED, cancelled: MUTED, closed: MUTED, "n/a": MUTED,
};

export function getStatusColor(status: StatusValue | string) {
  return STATUS_MAP[status] ?? MUTED;
}

export function getSeverityColor(severity: SeverityValue): string {
  const map: Record<SeverityValue, string> = { low: "var(--v3-green)", medium: "var(--v3-amber)", high: "var(--v3-red)", critical: "var(--v3-red)" };
  return map[severity];
}

export function getRiskColor(level: RiskLevel): string {
  return getSeverityColor(level);
}

export function getReadinessColor(level: ReadinessLevel): string {
  const map: Record<ReadinessLevel, string> = {
    "not-started": "var(--v3-text-muted)",
    "in-progress": "var(--v3-accent-b)",
    "at-risk": "var(--v3-amber)",
    "ready": "var(--v3-green)",
  };
  return map[level];
}

export function getScoreColor(score: number): string {
  if (score >= 80) return "var(--v3-accent)";
  if (score >= 60) return "var(--v3-green)";
  if (score >= 40) return "var(--v3-amber)";
  return "var(--v3-red)";
}
