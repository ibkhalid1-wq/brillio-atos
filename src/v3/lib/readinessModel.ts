/**
 * Readiness explainability.
 *
 * A readiness score is only useful if a PM can see WHY it is what it is and
 * WHAT would move it. This module turns the opaque `readiness` / gate
 * `readinessScore` numbers into an explanation: the drivers already helping,
 * the blockers holding it back, and the expected point gain from resolving
 * each blocker (so the highest-leverage action is obvious).
 *
 * It is a pure selector built on the Cycle-4 artifact model and the programme's
 * gate reviews — no backend changes. It reads concrete gaps (missing required
 * artifacts, unmet exit criteria, open decisions, open risks) so every number
 * is traceable to a real entity.
 */
import type { ProgramSummary, GateReview } from "@/new/types";
import { ATOS_STANDARD, type MethodologyDefinition } from "@/v3/lib/methodology";
import { buildArtifactModel, type PhaseArtifactSummary } from "@/v3/lib/artifactModel";
import { deriveOpenRecommendedActions } from "@/v3/lib/recommendedActions";
import { selectRisks } from "@/v3/lib/programRaid";

export type ReadinessFactorKind = "artifact" | "decision" | "risk" | "exit-criterion" | "quality" | "coverage";

export interface ReadinessFactor {
  id: string;
  label: string;
  kind: ReadinessFactorKind;
  detail: string | null;
  /** Expected readiness points gained by resolving this blocker (0 for drivers). */
  expectedGain: number;
}

export interface ReadinessExplanation {
  phaseId: string;
  phaseLabel: string;
  /** 0-100 current readiness. */
  score: number;
  /** score + realisable gain, capped at 100. */
  projectedScore: number;
  /** Gate status when a gate review exists. */
  status: GateReview["status"] | null;
  /** True when the score was derived (no gate review present). */
  derived: boolean;
  drivers: ReadinessFactor[];
  blockers: ReadinessFactor[];
  summary: string;
}

/** Relative leverage weights for distributing the readiness gap across blockers. */
const BLOCKER_WEIGHT: Record<"artifact" | "exit-criterion" | "decision" | "risk", number> = {
  artifact: 3,
  "exit-criterion": 2,
  decision: 2,
  risk: 1,
};

/** Derive a readiness score from artifact coverage + quality when no gate exists. */
function deriveScore(phase: PhaseArtifactSummary): number {
  if (phase.required === 0) return 100;
  const coverage = phase.present / phase.required; // 0-1
  const quality = (phase.avgQuality ?? 0) / 100; // 0-1
  return Math.round(coverage * 70 + quality * 30);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function explainPhaseReadiness(
  program: ProgramSummary | null,
  phaseId: string,
  methodology: MethodologyDefinition = ATOS_STANDARD,
): ReadinessExplanation | null {
  if (!program) return null;
  const model = buildArtifactModel(program, methodology);
  const phase = model.phases.find((p) => p.phaseId === phaseId);
  if (!phase) return null;

  const gate = program.gateReviews?.[phaseId] ?? null;
  const score = clamp(gate ? gate.readinessScore : deriveScore(phase));

  const drivers: ReadinessFactor[] = [];
  const rawBlockers: Array<Omit<ReadinessFactor, "expectedGain"> & { weight: number }> = [];

  // Artifacts: present required ones drive readiness, missing ones block it.
  for (const node of phase.artifacts) {
    if (!node.required) continue;
    if (node.present) {
      drivers.push({
        id: `artifact:${node.key}`,
        label: node.label,
        kind: "artifact",
        detail: node.state === "approved" ? "Approved" : node.quality != null ? `${node.state} · ${node.quality}% quality` : node.state,
        expectedGain: 0,
      });
    } else {
      rawBlockers.push({
        id: `artifact:${node.key}`,
        label: `Missing: ${node.label}`,
        kind: "artifact",
        detail: "Required artifact not yet produced",
        weight: BLOCKER_WEIGHT.artifact,
      });
    }
  }

  // Average quality reads as a driver or a soft blocker.
  if (typeof phase.avgQuality === "number") {
    if (phase.avgQuality >= 80) {
      drivers.push({
        id: "quality:high",
        label: `High artifact quality (${phase.avgQuality}%)`,
        kind: "quality",
        detail: "Evidence is strong across present artifacts",
        expectedGain: 0,
      });
    } else if (phase.present > 0) {
      rawBlockers.push({
        id: "quality:low",
        label: `Artifact quality at ${phase.avgQuality}%`,
        kind: "quality",
        detail: "Strengthen evidence to raise confidence",
        weight: 1,
      });
    }
  }

  // Gate-derived signals: exit criteria, open decisions, open risks.
  if (gate) {
    for (const [index, criterion] of (gate.exitCriteriaStatus || []).entries()) {
      if (criterion.met) {
        drivers.push({
          id: `exit:${index}`,
          label: criterion.criterion,
          kind: "exit-criterion",
          detail: criterion.evidence || "Met",
          expectedGain: 0,
        });
      } else {
        rawBlockers.push({
          id: `exit:${index}`,
          label: criterion.criterion,
          kind: "exit-criterion",
          detail: "Exit criterion not yet met",
          weight: BLOCKER_WEIGHT["exit-criterion"],
        });
      }
    }
    // Open decisions / risks are counted from the LIVE queues — not the gate
    // record's frozen openDecisions/openRisks snapshot, which drifts out of date
    // the moment the team resolves something. Using the same selectors the Action
    // Center and RAID rail use keeps every surface on one number.
    const openDecisionCount = deriveOpenRecommendedActions(program).filter(
      (d) => !d.phaseId || d.phaseId === phaseId,
    ).length;
    if (openDecisionCount > 0) {
      rawBlockers.push({
        id: "decisions:open",
        label: `${openDecisionCount} open action${openDecisionCount === 1 ? "" : "s"}`,
        kind: "decision",
        detail: "Resolve to unblock the gate",
        weight: BLOCKER_WEIGHT.decision * Math.min(openDecisionCount, 3),
      });
    }
    const openRiskCount = selectRisks(program, { phaseId }).length;
    if (openRiskCount > 0) {
      rawBlockers.push({
        id: "risks:open",
        label: `${openRiskCount} open risk${openRiskCount === 1 ? "" : "s"}`,
        kind: "risk",
        detail: "Mitigate or accept to raise readiness",
        weight: BLOCKER_WEIGHT.risk * Math.min(openRiskCount, 3),
      });
    }
  }

  // Distribute the readiness gap across blockers by weight → expected gain.
  const gap = clamp(100 - score);
  const totalWeight = rawBlockers.reduce((sum, b) => sum + b.weight, 0);
  const blockers: ReadinessFactor[] = rawBlockers
    .map((b) => ({
      id: b.id,
      label: b.label,
      kind: b.kind,
      detail: b.detail,
      expectedGain: totalWeight > 0 ? Math.round((b.weight / totalWeight) * gap) : 0,
    }))
    .sort((a, b) => b.expectedGain - a.expectedGain);

  const realisableGain = blockers.reduce((sum, b) => sum + b.expectedGain, 0);
  const projectedScore = clamp(score + realisableGain);

  const summary = blockers.length
    ? `Readiness ${score}%. Biggest lever: ${blockers[0].label.toLowerCase()} (+${blockers[0].expectedGain}). Resolving all open items projects ${projectedScore}%.`
    : `Readiness ${score}% with no open blockers — ${drivers.length} driver${drivers.length === 1 ? "" : "s"} in place.`;

  return {
    phaseId,
    phaseLabel: phase.phaseLabel,
    score,
    projectedScore,
    status: gate?.status ?? null,
    derived: !gate,
    drivers,
    blockers,
    summary,
  };
}
