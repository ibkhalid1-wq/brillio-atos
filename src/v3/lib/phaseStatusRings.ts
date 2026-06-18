/**
 * Phase-status rings — the single canonical KPI mapping for the embedded
 * 3-ring (concentric donut) phase-status visual used across every surface
 * (Home, Programme, Executive Summary, Phase, …).
 *
 * The mandate fixes the ring-to-KPI mapping and it must be identical everywhere:
 *   • inner ring  → Input Score    (how good are the inputs feeding the phase)
 *   • middle ring → Artifact Score (how complete/quality are the artifacts)
 *   • outer ring  → Gate Score     (readiness composite: the average of artifact
 *                                   completeness and artifact quality)
 *
 * All values come from computePhaseReadiness(). Gate Score and the composite
 * `overall` are both its `score`, so the outer ring matches the header "Gate
 * score" metric everywhere. This module is the pure derivation + tone brain so
 * the visual component stays presentational and the mapping stays unit-testable.
 *
 * No React, deterministic, unit-tested.
 */

import type { ProgramSummary } from "@/new/types";
import { computePhaseReadiness, getLockedPhaseIds, type PhaseReadinessResult } from "@/v3/lib/phaseReadiness";

export type RingTone = "green" | "amber" | "red" | "muted";

export interface PhaseStatusRingValues {
  /** Inner ring — input quality score (0-100). */
  input: number;
  /** Middle ring — artifact quality score (0-100). */
  artifact: number;
  /** Outer ring — gate score: the readiness composite (avg of artifact completeness + quality), 0-100. */
  gate: number | null;
  /** Composite phase score — same value as `gate` (computePhaseReadiness().score). */
  overall: number;
  /** Always true: the gate score is the readiness composite, which is always defined. */
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
  // Gate score is the readiness composite — the average of artifact completeness
  // and artifact quality (result.score). This is the SAME number the header
  // "Gate score" metric shows, so the outer ring stays consistent with it on
  // every surface. (The LLM gate-review readinessScore is a separate reviewer
  // signal that drives canApproveGate / exit criteria, not this ring.)
  const gate = clamp(result.score);
  return {
    input: clamp(result.inputScore),
    artifact: clamp(result.artifactScore),
    gate,
    overall: gate,
    hasGate: true,
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
  const result = computePhaseReadiness(program, phaseId, threshold);
  // A locked phase must not show progression on the rings. Under strict sequential
  // gating a phase is locked until its predecessor's gate is approved; while locked
  // the programme has not reached — nor dynamically activated — it, so it has no
  // legitimate progression to display. An artifact force-routed into a later-phase
  // slot ahead of time (e.g. a program-level agent whose methodology home is
  // Operate) would otherwise inflate that phase's rings and make it read as "in
  // progress". Mute every signal to the same "not started" state the other locked
  // phases already show. Readiness itself stays lock-agnostic (it answers "is this
  // phase's gate approvable in isolation?"); only the visual is gated here.
  //
  // This deliberately mutes even a phase that previously cleared its own gate: in a
  // clean forward flow an approved phase is never locked (the lock set is exactly
  // the phases after the open frontier), so the only way an approved phase lands in
  // the lock set is when an UPSTREAM gate is reopened/un-approved — which
  // cascade-locks everything downstream. That downstream approval is now stale and
  // pending re-approval, so the rings must read as "not started", not keep showing
  // their old green progression while the phase sits behind a reopened gate.
  if (getLockedPhaseIds(program).has(phaseId)) {
    return ringsFromReadiness({ ...result, score: 0, artifactScore: 0, inputScore: 0 });
  }
  return ringsFromReadiness(result);
}
