// ─── Unified Confidence Model ────────────────────────────────────────────────
//
// Single authoritative score that drives both the UI confidence badge AND
// gate approval eligibility. Previously these were two separate, divergent
// calculations. Now phaseReadiness.ts references PHASE_GATE_THRESHOLDS from
// here, and AppShellV3 calls computeConfidenceScore() for the rail badge.
//
// Score composition:
//   gateReadiness    30%   — weighted avg of approved/pending gate scores
//   riskPosture      25%   — severity-weighted open risk penalty
//   milestoneHealth  20%   — milestone on-track ratio
//   decisionBacklog  15%   — open decision count penalty
//   inputCompleteness 10%  — quality-weighted input score (not binary)
// ─────────────────────────────────────────────────────────────────────────────

// Stable, machine-routable identity for each confidence signal so the UI can
// deep-link the "Top Action" to the right surface (not a hardcoded guess).
export type ConfidenceCategory = "gate" | "risk" | "milestone" | "decision" | "input";

export interface ConfidenceSignal {
  label: string;
  category: ConfidenceCategory;
  score: number;          // 0–100
  weight: number;         // 0–1, contribution to total
  contribution: number;   // score × weight (rounded)
  status: "good" | "warn" | "poor";
  explanation: string;    // Human-readable reason for the score
  topAction?: string;     // Single highest-impact action to improve this signal
}

export interface ConfidenceScore {
  score: number;
  label: "Critical" | "At Risk" | "On Track" | "Strong";
  color: "red" | "amber" | "green" | "indigo";
  breakdown: {
    gateReadiness: number;
    riskPosture: number;
    milestoneHealth: number;
    decisionBacklog: number;
    inputCompleteness: number;
  };
  signals: ConfidenceSignal[];
  trend: "up" | "down" | "stable";
  /** Plain-English explanation of why the score is what it is. */
  explanation: string;
  /** The single highest-impact action to improve the score right now. */
  topRecommendation: string;
  /** Category of the top recommendation, so the UI can route the action correctly. */
  topRecommendationCategory?: ConfidenceCategory;
  computedAt: number;
}

// ── Phase-calibrated gate thresholds ─────────────────────────────────────────
// Later phases carry higher execution risk, so they require higher readiness.
export const PHASE_GATE_THRESHOLDS: Record<string, number> = {
  strategy:    65,   // Directional confidence acceptable at mandate stage
  mobilise:    68,   // Team and governance must be mostly settled
  discover:    68,   // Discovery outputs are inherently provisional
  design:      75,   // Architecture and TOM decisions are hard to reverse
  build:       80,   // Delivery execution — highest fidelity required
  operate:     80,   // Live operation — no margin for incomplete readiness
  govern:      72,   // Governance formality varies by organisation
  optimize:    70,   // Improvement cycles are iterative by nature
  valuerealize:72,   // Benefits evidence needs to be substantial
};

export const DEFAULT_GATE_THRESHOLD = 70;

export function getGateThreshold(phaseId: string): number {
  return PHASE_GATE_THRESHOLDS[phaseId] ?? DEFAULT_GATE_THRESHOLD;
}

// ── Risk severity weighting ───────────────────────────────────────────────────
// A single critical risk is far more damaging than ten low risks.
const RISK_SEVERITY_PENALTY: Record<string, number> = {
  critical: 25,
  high:     12,
  medium:    5,
  low:       2,
};

export function computeRiskPosture(risks: Array<{ severity?: string; status?: string }>): number {
  const openRisks = risks.filter((r) => r.status !== "closed" && r.status !== "resolved");
  if (openRisks.length === 0) return 100;

  const totalPenalty = openRisks.reduce((sum, r) => {
    const sev = (r.severity || "medium").toLowerCase();
    return sum + (RISK_SEVERITY_PENALTY[sev] ?? 5);
  }, 0);

  // Scale: penalty 0 → 100, penalty 100 → 0. Cap so a single critical never kills the signal.
  return Math.max(0, Math.min(100, 100 - totalPenalty));
}

// ── Input quality scoring (replaces binary 0/100) ────────────────────────────
// Considers: field count, average field length, extraction confidence, note presence.
export function computeInputQualityScore(
  phaseInputs: Record<string, unknown>,
  extractionConfidence: number,
  hasStageNote: boolean,
): number {
  const fieldEntries = Object.entries(phaseInputs).filter(([key]) => !key.startsWith("_"));
  const fieldCount = fieldEntries.length;

  if (fieldCount === 0 && !hasStageNote) return 0;
  if (fieldCount === 0 && hasStageNote) return 30; // Note only — minimal credit

  // Field completeness (0–60 pts): fields filled / expected minimum of 5
  const fieldCompleteness = Math.min(60, Math.round((fieldCount / 5) * 60));

  // Field quality (0–30 pts): average word count per field, capped at 30
  const avgWords = fieldEntries.reduce((sum, [, v]) => {
    const str = typeof v === "string" ? v : JSON.stringify(v);
    return sum + str.trim().split(/\s+/).filter(Boolean).length;
  }, 0) / Math.max(fieldCount, 1);
  const qualityScore = Math.min(30, Math.round((avgWords / 20) * 30)); // 20 words per field = full score

  // Extraction confidence modifier (0–10 pts): penalises AI-filled but uncertain
  const confidenceBonus = Math.round(extractionConfidence * 10);

  const raw = fieldCompleteness + qualityScore + confidenceBonus;
  return Math.min(100, raw);
}

// ── Main computation ──────────────────────────────────────────────────────────
export function computeConfidenceScore(inputs: {
  gateReadiness: number;
  riskPosture: number;
  milestoneHealth: number;
  openDecisionCount: number;
  inputCompleteness: number;
  previousScore?: number;
  // Optional rich context for explanations
  openCriticalRisks?: number;
  openHighRisks?: number;
  approvedGates?: number;
  totalGates?: number;
  overdueDecisions?: number;
  milestonesAtRisk?: number;
}): ConfidenceScore {
  const decisionBacklog = Math.max(0, 100 - inputs.openDecisionCount * 10);

  const signals: ConfidenceSignal[] = [
    {
      label: "Gate readiness",
      category: "gate",
      score: inputs.gateReadiness,
      weight: 0.30,
      contribution: Math.round(inputs.gateReadiness * 0.30),
      status: inputs.gateReadiness >= 70 ? "good" : inputs.gateReadiness >= 50 ? "warn" : "poor",
      explanation:
        inputs.approvedGates !== undefined && inputs.totalGates !== undefined
          ? `${inputs.approvedGates} of ${inputs.totalGates} phase gates approved. Current phase readiness: ${inputs.gateReadiness}%.`
          : `Current gate readiness is ${inputs.gateReadiness}%.`,
      topAction:
        inputs.gateReadiness < 70
          ? "Run gate-review agent to assess exit criteria and generate a readiness score."
          : undefined,
    },
    {
      label: "Risk posture",
      category: "risk",
      score: inputs.riskPosture,
      weight: 0.25,
      contribution: Math.round(inputs.riskPosture * 0.25),
      status: inputs.riskPosture >= 75 ? "good" : inputs.riskPosture >= 50 ? "warn" : "poor",
      explanation:
        inputs.openCriticalRisks !== undefined
          ? inputs.openCriticalRisks > 0
            ? `${inputs.openCriticalRisks} critical risk(s) and ${inputs.openHighRisks ?? 0} high risk(s) are open and unmitigated.`
            : "No critical or high risks open. Risk posture is healthy."
          : `Risk posture score: ${inputs.riskPosture}%.`,
      topAction:
        inputs.riskPosture < 75 && inputs.openCriticalRisks
          ? `Mitigate or close ${inputs.openCriticalRisks} critical risk(s) in the Risk workspace.`
          : undefined,
    },
    {
      label: "Milestone health",
      category: "milestone",
      score: inputs.milestoneHealth,
      weight: 0.20,
      contribution: Math.round(inputs.milestoneHealth * 0.20),
      status: inputs.milestoneHealth >= 75 ? "good" : inputs.milestoneHealth >= 50 ? "warn" : "poor",
      explanation:
        inputs.milestonesAtRisk !== undefined
          ? inputs.milestonesAtRisk > 0
            ? `${inputs.milestonesAtRisk} milestone(s) are overdue or at risk.`
            : "All tracked milestones are on track."
          : `Milestone health: ${inputs.milestoneHealth}%.`,
      topAction:
        inputs.milestoneHealth < 75 && inputs.milestonesAtRisk
          ? "Review and update overdue milestones in the Milestones workspace."
          : undefined,
    },
    {
      label: "Decision backlog",
      category: "decision",
      score: decisionBacklog,
      weight: 0.15,
      contribution: Math.round(decisionBacklog * 0.15),
      status: decisionBacklog >= 80 ? "good" : decisionBacklog >= 50 ? "warn" : "poor",
      explanation:
        inputs.openDecisionCount === 0
          ? "No open decisions. Decision backlog is clear."
          : inputs.overdueDecisions
          ? `${inputs.openDecisionCount} open decision(s), ${inputs.overdueDecisions} overdue (≥14 days).`
          : `${inputs.openDecisionCount} open decision(s) pending resolution.`,
      topAction:
        inputs.openDecisionCount > 0
          ? inputs.overdueDecisions && inputs.overdueDecisions > 0
            ? `Resolve ${inputs.overdueDecisions} overdue decision(s) in the Decision Queue.`
            : "Resolve open decisions in the Decision Queue to reduce backlog penalty."
          : undefined,
    },
    {
      label: "Input completeness",
      category: "input",
      score: inputs.inputCompleteness,
      weight: 0.10,
      contribution: Math.round(inputs.inputCompleteness * 0.10),
      status: inputs.inputCompleteness >= 70 ? "good" : inputs.inputCompleteness >= 40 ? "warn" : "poor",
      explanation:
        inputs.inputCompleteness === 0
          ? "No structured inputs provided for the active phase."
          : inputs.inputCompleteness < 50
          ? `Input quality is low (${inputs.inputCompleteness}%). Fields may be empty or too brief.`
          : `Phase inputs are ${inputs.inputCompleteness}% quality.`,
      topAction:
        inputs.inputCompleteness < 70
          ? "Complete or expand phase inputs in the active phase view."
          : undefined,
    },
  ];

  const score = Math.max(
    0,
    Math.min(100, signals.reduce((sum, s) => sum + s.contribution, 0)),
  );

  const label: ConfidenceScore["label"] = confidenceLabel(score);
  const color: ConfidenceScore["color"] =
    score >= 80 ? "indigo" : score >= 60 ? "green" : score >= 40 ? "amber" : "red";

  const delta = inputs.previousScore !== undefined ? score - inputs.previousScore : 0;
  const trend: ConfidenceScore["trend"] =
    inputs.previousScore === undefined ? "stable" : delta > 3 ? "up" : delta < -3 ? "down" : "stable";

  // Build explanation from worst signals
  const poorSignals = signals.filter((s) => s.status === "poor").map((s) => s.label);
  const warnSignals = signals.filter((s) => s.status === "warn").map((s) => s.label);
  const explanation =
    poorSignals.length > 0
      ? `Confidence is ${label} (${score}%). Main causes: ${poorSignals.join(", ")}.`
      : warnSignals.length > 0
      ? `Confidence is ${label} (${score}%). Warning on: ${warnSignals.join(", ")}.`
      : `Confidence is ${label} (${score}%). All signals are healthy.`;

  // Top recommendation = highest-impact poor signal's action
  const topSignal =
    [...signals].sort((a, b) => {
      const aPriority = a.status === "poor" ? 0 : a.status === "warn" ? 1 : 2;
      const bPriority = b.status === "poor" ? 0 : b.status === "warn" ? 1 : 2;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return b.weight - a.weight; // Higher-weight signals take priority when tied
    }).find((s) => s.topAction);
  const topRecommendation = topSignal?.topAction ?? "Continue building programme momentum.";
  const topRecommendationCategory = topSignal?.category;

  return {
    score,
    label,
    color,
    breakdown: {
      gateReadiness: inputs.gateReadiness,
      riskPosture: inputs.riskPosture,
      milestoneHealth: inputs.milestoneHealth,
      decisionBacklog,
      inputCompleteness: inputs.inputCompleteness,
    },
    signals,
    trend,
    explanation,
    topRecommendation,
    topRecommendationCategory,
    computedAt: Date.now(),
  };
}

// ── Confidence forecasting ────────────────────────────────────────────────────
// Given a history of (timestamp, score) pairs, estimates days until target.
export interface ConfidenceForecast {
  currentScore: number;
  targetScore: number;
  estimatedDaysToTarget: number | null; // null = not improving or already met
  weeklyVelocity: number;               // Points per week (positive = improving)
  trend: "improving" | "declining" | "stable";
  message: string;
}

export function forecastConfidence(
  history: Array<{ ts: number; score: number }>,
  targetScore: number,
): ConfidenceForecast {
  const current = history.at(-1)?.score ?? 0;

  if (history.length < 2) {
    return {
      currentScore: current,
      targetScore,
      estimatedDaysToTarget: null,
      weeklyVelocity: 0,
      trend: "stable",
      message: "Not enough history to forecast. Keep making progress.",
    };
  }

  // Linear regression over last 14 days of snapshots
  const cutoff = Date.now() - 14 * 86_400_000;
  const recent = history.filter((h) => h.ts >= cutoff);
  if (recent.length < 2) {
    return {
      currentScore: current,
      targetScore,
      estimatedDaysToTarget: null,
      weeklyVelocity: 0,
      trend: "stable",
      message: "Insufficient recent data to forecast.",
    };
  }

  const n = recent.length;
  const sumX = recent.reduce((s, h) => s + h.ts, 0);
  const sumY = recent.reduce((s, h) => s + h.score, 0);
  const sumXY = recent.reduce((s, h) => s + h.ts * h.score, 0);
  const sumX2 = recent.reduce((s, h) => s + h.ts * h.ts, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX); // pts/ms
  const weeklyVelocity = Math.round(slope * 7 * 86_400_000 * 10) / 10; // pts/week

  const trend: ConfidenceForecast["trend"] =
    weeklyVelocity > 1 ? "improving" : weeklyVelocity < -1 ? "declining" : "stable";

  if (current >= targetScore) {
    return {
      currentScore: current,
      targetScore,
      estimatedDaysToTarget: 0,
      weeklyVelocity,
      trend,
      message: `Target of ${targetScore}% already met. Maintain current momentum.`,
    };
  }

  if (slope <= 0) {
    return {
      currentScore: current,
      targetScore,
      estimatedDaysToTarget: null,
      weeklyVelocity,
      trend: "declining",
      message: `Confidence is declining (${weeklyVelocity > 0 ? "+" : ""}${weeklyVelocity} pts/wk). Address blockers to reverse trend.`,
    };
  }

  const pointsNeeded = targetScore - current;
  const msNeeded = pointsNeeded / slope;
  const daysNeeded = Math.ceil(msNeeded / 86_400_000);

  return {
    currentScore: current,
    targetScore,
    estimatedDaysToTarget: daysNeeded,
    weeklyVelocity,
    trend,
    message:
      daysNeeded <= 7
        ? `On track to reach ${targetScore}% in ~${daysNeeded} day(s) at current velocity (+${weeklyVelocity} pts/wk).`
        : `At current pace (+${weeklyVelocity} pts/wk), target of ${targetScore}% reached in ~${Math.round(daysNeeded / 7)} week(s). Accelerate by resolving top blockers.`,
  };
}

export function getConfidenceColor(score: number): string {
  if (score >= 80) return "var(--v3-accent)";
  if (score >= 60) return "var(--v3-green)";
  if (score >= 40) return "var(--v3-amber)";
  return "var(--v3-red)";
}

/**
 * Canonical confidence band label. SINGLE SOURCE OF TRUTH for the headline
 * health word shown anywhere a confidence score is surfaced (Home verdict,
 * Executive header, etc.). Any other label helper must delegate to this so
 * surfaces never disagree on the same program's health.
 */
export function confidenceLabel(score: number): ConfidenceScore["label"] {
  return score >= 80 ? "Strong" : score >= 60 ? "On Track" : score >= 40 ? "At Risk" : "Critical";
}
