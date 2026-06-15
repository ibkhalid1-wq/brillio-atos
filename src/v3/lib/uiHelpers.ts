/**
 * Shared UI helper functions and constants used across ATOS surfaces.
 * Single source of truth — do not duplicate these in individual components.
 */
import { confidenceLabel, getConfidenceColor } from "@/v3/lib/confidenceScore";

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

/** Returns the CSS colour token matching a confidence score.
 *  Delegates to the canonical confidence model so colour bands never diverge
 *  from the headline label (e.g. a healthy 76% must not render amber here while
 *  reading "On Track" elsewhere). */
export function confidenceColor(score: number): string {
  return getConfidenceColor(score);
}

/** Returns the chip CSS class matching a confidence score.
 *  Aligned to the canonical 4-band model (≥80 Strong, ≥60 On Track,
 *  ≥40 At Risk, else Critical). */
export function confidenceChipClass(score: number): string {
  if (score >= 80) return "v3-chip blue";
  if (score >= 60) return "v3-chip green";
  if (score >= 40) return "v3-chip amber";
  return "v3-chip red";
}

/** Returns health label text + chip class for a confidence score */
export function healthLabel(score: number | null): { text: string; cls: string } {
  if (score === null) return { text: "Unknown", cls: "v3-chip muted" };
  // Delegate the band word to the canonical confidence model so the Executive
  // header never contradicts Home (e.g. 76% must read the same band everywhere,
  // not "On Track" on one surface and "Caution" on another).
  const text = confidenceLabel(score);
  const cls =
    score >= 80 ? "v3-chip blue" : score >= 60 ? "v3-chip green" : score >= 40 ? "v3-chip amber" : "v3-chip red";
  return { text, cls };
}

/** Canonical friendly label for a RAG health tone. SINGLE SOURCE OF TRUTH for
 *  the word shown against a green/amber/red health chip, so the vocabulary never
 *  contradicts the numeric confidence bands (amber always reads "At Risk", red
 *  always reads "Critical" — never "Caution" on one surface and "At Risk" on
 *  another for the same colour). */
export function ragLabel(tone: string | null | undefined): string {
  if (tone === "green") return "On Track";
  if (tone === "amber") return "At Risk";
  if (tone === "red") return "Critical";
  return "Forming";
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
