/**
 * Consolidated phase-blocker model — SINGLE SOURCE OF TRUTH for "what is
 * holding this phase back".
 *
 * The phase workspace previously surfaced obstacles in five disconnected
 * places: readiness blockers (Gate readiness card), confidence poor-signals
 * (rail badge), open decisions (Decide queue), open risks (RAID log) and
 * dependencies (RAID log). A Program Manager had to visit each surface to
 * assemble the full picture. This function derives one ranked, de-duplicated
 * list across all five categories so the Progression Card and the right-rail
 * Blockers tab read from the same place and never disagree.
 *
 * Pure composition over existing engines — explainPhaseReadiness (readiness
 * blockers), deriveProgramConfidence (confidence signals) and the program's
 * own RAID / decision queues. No score is re-derived here.
 */
import type { ProgramSummary, RAIDEntry } from "@/new/types";
import type { V3MoreView } from "@/v3/types";
import { explainPhaseReadiness } from "@/v3/lib/readinessModel";
import type { ReadinessFactorKind } from "@/v3/lib/readinessModel";
import { deriveProgramConfidence } from "@/v3/lib/programConfidence";
import { runDeterministicValidation, selectFindingsForPhase, selectModelValidationFindings } from "@/v3/lib/crossArtifactValidation";
import { isDecisionOpen } from "@/v3/utils";

export type BlockerCategory =
  | "readiness"
  | "confidence"
  | "governance"
  | "dependency"
  | "artifact"
  | "risk"
  | "traceability";

export type BlockerSeverity = "critical" | "high" | "medium" | "low";

export interface PhaseBlocker {
  id: string;
  category: BlockerCategory;
  severity: BlockerSeverity;
  label: string;
  detail: string | null;
  /** Readiness points recoverable by resolving this (0 when not readiness-linked). */
  expectedGain: number;
  /** Where to go to resolve it, when there's a clear destination. */
  action?: { label: string; agentId?: string; workspaceId?: V3MoreView };
}

const SEVERITY_RANK: Record<BlockerSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Map a readiness factor kind onto a blocker category. */
function categoryForReadinessKind(kind: ReadinessFactorKind): BlockerCategory {
  switch (kind) {
    case "artifact":
    case "coverage":
      return "artifact";
    case "decision":
      return "governance";
    case "risk":
      return "risk";
    case "exit-criterion":
    case "quality":
    default:
      return "readiness";
  }
}

/** Bucket an expected readiness gain into a severity band. */
function severityForGain(gain: number): BlockerSeverity {
  if (gain >= 12) return "critical";
  if (gain >= 7) return "high";
  if (gain >= 3) return "medium";
  return "low";
}

const DAY_MS = 86_400_000;

export function derivePhaseBlockers(
  program: ProgramSummary | null,
  phaseId: string,
): PhaseBlocker[] {
  if (!program || !phaseId) return [];

  const blockers: PhaseBlocker[] = [];

  // 1) Readiness blockers — already ranked by expectedGain in the model.
  const explanation = explainPhaseReadiness(program, phaseId);
  for (const factor of explanation?.blockers ?? []) {
    blockers.push({
      id: `readiness:${factor.id}`,
      category: categoryForReadinessKind(factor.kind),
      severity: severityForGain(factor.expectedGain),
      label: factor.label,
      detail: factor.detail,
      expectedGain: factor.expectedGain,
    });
  }

  // 2) Confidence — surface poor signals only (warn signals are noise here).
  const confidence = deriveProgramConfidence(program, phaseId);
  for (const signal of confidence.signals) {
    if (signal.status !== "poor") continue;
    // Skip gate readiness — already represented by readiness blockers above.
    if (signal.category === "gate") continue;
    blockers.push({
      id: `confidence:${signal.category}`,
      category: "confidence",
      severity: signal.score < 30 ? "high" : "medium",
      label: `Low ${signal.label.toLowerCase()} (${signal.score}%)`,
      detail: signal.explanation,
      expectedGain: 0,
      action: signal.topAction ? { label: signal.topAction } : undefined,
    });
  }

  // 3) Open risks & explicit blocker entries scoped to this phase.
  const raid: RAIDEntry[] = program.raidEntries || [];
  const phaseRaid = raid.filter((e) => e.phase === phaseId && e.status !== "closed");
  // A `blocker` is, by this app's taxonomy, exactly what prevents the phase gate —
  // so once the gate is approved an open blocker is contradictory and stale (it
  // predates sign-off). Suppress blocker entries for an approved phase even if the
  // data still carries them, so an approved phase never reads as blocked. Risks are
  // not suppressed: a risk can legitimately outlive a gate.
  const gateApproved = program.gateReviews?.[phaseId]?.status === "approved";
  for (const risk of phaseRaid.filter((e) => e.type === "risk" || e.type === "blocker")) {
    if (risk.type === "blocker" && gateApproved) continue;
    // Only surface the ones that genuinely block — critical/high risks and all blockers.
    if (risk.type === "risk" && risk.severity !== "critical" && risk.severity !== "high") continue;
    blockers.push({
      id: `risk:${risk.id}`,
      category: "risk",
      severity: risk.severity,
      label: risk.title,
      detail: risk.mitigation ? `Mitigation: ${risk.mitigation}` : risk.description || null,
      expectedGain: 0,
      action: { label: "Open risk & blocker log", workspaceId: "risks" },
    });
  }

  // 4) Open dependencies — unmet upstream dependencies block progress.
  for (const dep of phaseRaid.filter((e) => e.type === "dependency")) {
    blockers.push({
      id: `dependency:${dep.id}`,
      category: "dependency",
      severity: dep.severity === "critical" || dep.severity === "high" ? "high" : "medium",
      label: dep.title,
      detail: dep.description || null,
      expectedGain: 0,
      action: { label: "Open risk & blocker log", workspaceId: "risks" },
    });
  }

  // 5) Overdue governance decisions (≥14 days open) — the highest-friction subset.
  const openDecisions = (program.decisionQueue || [])
    .filter(isDecisionOpen)
    .filter((d) => !d.phaseId || d.phaseId === phaseId);
  for (const decision of openDecisions) {
    const ageDays = decision.createdAt
      ? Math.floor((Date.now() - new Date(decision.createdAt).getTime()) / DAY_MS)
      : 0;
    const overdue = ageDays >= 14;
    // Readiness blockers already account for decision count; only escalate overdue ones.
    if (!overdue) continue;
    blockers.push({
      id: `decision:${decision.id}`,
      category: "governance",
      severity: decision.priority === "high" ? "high" : "medium",
      label: decision.title,
      detail: `Open ${ageDays} days — ${decision.question}`,
      expectedGain: 0,
      action: { label: "Open decision queue" },
    });
  }

  // 6) Cross-artifact traceability gaps — deterministic (zero-token) plus any
  //    model-backed findings the validator persisted at the last gate review.
  //    Exclude risk-controls — risks/dependencies are already covered above.
  const allValidationFindings = [
    ...runDeterministicValidation(program),
    ...selectModelValidationFindings(program),
  ];
  const validationFindings = selectFindingsForPhase(allValidationFindings, phaseId, {
    excludeDomains: ["risk-controls"],
  });
  for (const finding of validationFindings) {
    blockers.push({
      id: `validation:${finding.findingId}`,
      category: "traceability",
      severity: finding.severity,
      label: finding.issue,
      detail: finding.recommendation,
      expectedGain: 0,
    });
  }

  // Rank: severity first, then recoverable readiness gain.
  return blockers.sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return b.expectedGain - a.expectedGain;
  });
}

/** Compact category → display label for chips/grouping. */
export const BLOCKER_CATEGORY_LABEL: Record<BlockerCategory, string> = {
  readiness: "Readiness",
  confidence: "Confidence",
  governance: "Governance",
  dependency: "Dependency",
  artifact: "Artifact",
  risk: "Risk",
  traceability: "Traceability",
};
