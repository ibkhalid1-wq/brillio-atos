/**
 * Shared UI helper functions and constants used across ADAM surfaces.
 * Single source of truth — do not duplicate these in individual components.
 */

/** Client-facing phase display names (maps internal phase IDs → readable labels) */
export const PHASE_LABELS: Record<string, string> = {
  strategy: "Strategy",
  mobilise: "Mobilise",
  discover: "Discover",
  design: "Design",
  build: "Build",
  operate: "Operate",
  govern: "Govern",
  optimize: "Optimize",
  valuerealize: "Value Realize",
};

/** Returns the CSS colour token matching a confidence score */
export function confidenceColor(score: number): string {
  if (score >= 80) return "var(--v3-green)";
  if (score >= 60) return "var(--v3-amber)";
  return "var(--v3-red)";
}

/** Returns the chip CSS class matching a confidence score */
export function confidenceChipClass(score: number): string {
  if (score >= 80) return "v3-chip green";
  if (score >= 60) return "v3-chip amber";
  return "v3-chip red";
}

/** Returns health label text + chip class for a confidence score */
export function healthLabel(score: number | null): { text: string; cls: string } {
  if (score === null) return { text: "Unknown", cls: "v3-chip muted" };
  if (score >= 80) return { text: "On Track", cls: "v3-chip green" };
  if (score >= 60) return { text: "Caution", cls: "v3-chip amber" };
  return { text: "At Risk", cls: "v3-chip red" };
}

/** Returns chip class for RAID severity */
export function severityChipClass(severity: string): string {
  if (severity === "critical") return "v3-chip red";
  if (severity === "high") return "v3-chip amber";
  return "v3-chip muted";
}

/** Returns chip class for decision priority */
export function priorityChipClass(priority: string): string {
  if (priority === "critical") return "v3-chip red";
  if (priority === "high") return "v3-chip amber";
  return "v3-chip muted";
}

/** Returns a phase label, falling back to the raw ID or a displayName */
export function phaseLabel(phaseId: string | null | undefined, displayName?: string): string {
  if (!phaseId) return "—";
  return PHASE_LABELS[phaseId] ?? displayName ?? phaseId;
}
