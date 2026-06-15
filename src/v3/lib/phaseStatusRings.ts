/**
 * Phase-status rings — the single canonical KPI mapping for the embedded
 * 3-ring (concentric donut) phase-status visual used across every surface
 * (Home, Programme, Executive Summary, Phase, …).
 *
 * The mandate fixes the ring-to-KPI mapping and it must be identical everywhere:
 *   • inner ring  → Input Score    (how good are the inputs feeding the phase)
 *   • middle ring → Artifact Score (how complete/quality are the artifacts)
 *   • outer ring  → Gate Score     (gate readiness; null until a gate review exists)
 *
 * All three values come from computePhaseReadiness(); the composite `overall`
 * is its `score`. This module is the pure derivation + tone brain so the visual
 * component stays presentational and the mapping stays unit-testable.
 *
 * No React, deterministic, unit-tested.
 */

import type { ProgramSummary } from "@/new/types";
import { computePhaseReadiness, type PhaseReadinessResult } from "@/v3/lib/phaseReadiness";

export type RingTone = "green" | "amber" | "red" | "muted";

export interface PhaseStatusRingValues {
  /** Inner ring — input quality score (0-100). */
  input: number;
  /** Middle ring — artifact quality score (0-100). */
  artifact: number;
  /** Outer ring — gate readiness score (0-100), or null when no gate review yet. */
  gate: number | null;
  /** Composite phase score (gate·0.6 + artifact·0.3 + input·0.1, or the no-gate blend). */
  overall: number;
  /** True once a gate review with a readiness score exists. */
  hasGate: boolean;
  /** Whether the gate can currently be approved (score + exits + assumptions). */
  canApproveGate: boolean;
  /** Phase-calibrated gate threshold. */
  threshold: number;
}

/** Quality tone bands — shared green ≥75 / amber ≥50 / red convention. */
export function ringTone(value: number | null): RingTone {
  if (value == null) return "muted";
  if (value >= 75) return "green";
  if (value >= 50) return "amber";
  return "red";
}

/** Map a tone to its CSS custom property (consistent with chips/KPIs). */
export function ringToneColor(tone: RingTone): string {
  switch (tone) {
    case "green": return "var(--v3-green)";
    case "amber": return "var(--v3-amber)";
    case "red": return "var(--v3-red)";
    default: return "var(--v3-border)";
  }
}

/** Convenience: the colour for a raw ring value. */
export function ringColor(value: number | null): string {
  return ringToneColor(ringTone(value));
}

/**
 * Derive the canonical ring values from an already-computed readiness result.
 * Kept separate so callers that already have a PhaseReadinessResult in scope
 * don't recompute, and so the mapping is trivially testable.
 */
export function ringsFromReadiness(result: PhaseReadinessResult): PhaseStatusRingValues {
  const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));
  return {
    input: clamp(result.inputScore),
    artifact: clamp(result.artifactScore),
    gate: result.gateScore == null ? null : clamp(result.gateScore),
    overall: clamp(result.score),
    hasGate: result.gateScore != null,
    canApproveGate: result.canApproveGate,
    threshold: result.threshold,
  };
}

/**
 * Derive the canonical 3-ring KPI values for a phase. The single source of
 * truth for every surface that renders the embedded phase-status rings.
 */
export function derivePhaseStatusRings(
  program: ProgramSummary,
  phaseId: string,
  threshold?: number,
): PhaseStatusRingValues {
  return ringsFromReadiness(computePhaseReadiness(program, phaseId, threshold));
}
