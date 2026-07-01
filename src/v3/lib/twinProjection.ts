import { derivePhaseSpendRows, type PhaseSpendRow } from "@/v3/lib/budgetMetrics";

// ---------------------------------------------------------------------------
// Digital Twin projection engine
//
// Pure derivations for the Twin page: how complete the twin model is (fidelity),
// the live phase-spine model that mirrors current program state, and a
// read-only what-if projection. Nothing here writes program.data — the twin is
// a simulation layer over the real program.
// ---------------------------------------------------------------------------

export type TwinDomainState = "modeled" | "partial" | "empty";

export interface TwinDomainStatus {
  key: string;
  label: string;
  state: TwinDomainState;
  confidence: number | null;
}

/** A domain is `modeled` when present with adequate confidence, `partial` when
 *  present but the agent's confidence is low, and `empty` when absent. */
export function domainState(present: boolean, confidence: number | null): TwinDomainState {
  if (!present) return "empty";
  if (confidence !== null && confidence < 0.5) return "partial";
  return "modeled";
}

export interface TwinFidelity {
  score: number; // 0-1, weighting partial domains as half
  modeled: number;
  partial: number;
  empty: number;
  total: number;
  domains: TwinDomainStatus[];
}

export function summariseFidelity(domains: ReadonlyArray<TwinDomainStatus>): TwinFidelity {
  let modeled = 0;
  let partial = 0;
  let empty = 0;
  let points = 0;
  for (const domain of domains) {
    if (domain.state === "modeled") {
      modeled += 1;
      points += 1;
    } else if (domain.state === "partial") {
      partial += 1;
      points += 0.5;
    } else {
      empty += 1;
    }
  }
  const total = domains.length;
  return { score: total ? points / total : 0, modeled, partial, empty, total, domains: [...domains] };
}

export interface TwinDomainSource {
  narrative: string;
  plan: { confidence: number } | null;
  milestones: ReadonlyArray<unknown>;
  budgetTracking: { confidence: number } | null;
  criticalPath: { confidence: number } | null;
  stakeholders: ReadonlyArray<unknown>;
  healthHeatmap: { confidence: number } | null;
  raidEntries: ReadonlyArray<unknown>;
}

export function buildTwinDomains(src: TwinDomainSource): TwinDomainStatus[] {
  const make = (key: string, label: string, present: boolean, confidence: number | null): TwinDomainStatus => ({
    key,
    label,
    state: domainState(present, confidence),
    confidence,
  });
  return [
    make("narrative", "Narrative", src.narrative.trim().length > 0, null),
    make("plan", "Delivery plan", src.plan !== null, src.plan?.confidence ?? null),
    make("milestones", "Milestones", src.milestones.length > 0, null),
    make("budget", "Budget", src.budgetTracking !== null, src.budgetTracking?.confidence ?? null),
    make("criticalPath", "Critical path", src.criticalPath !== null, src.criticalPath?.confidence ?? null),
    make("stakeholders", "Stakeholders", src.stakeholders.length > 0, null),
    make("health", "Health signal", src.healthHeatmap !== null, src.healthHeatmap?.confidence ?? null),
    make("raid", "RAID", src.raidEntries.length > 0, null),
  ];
}

export interface PhaseTwinNode {
  phaseId: string;
  phaseName: string;
  pct: number;
  status: string;
  rag: "green" | "amber" | "red" | "grey";
  estimatedCost: number | null;
  actualCost: number | null;
  costStatus: PhaseSpendRow["status"];
  openRaidCount: number;
  workstreamCount: number;
}

export interface PhaseSpineInput {
  phases: ReadonlyArray<{ id: string; displayName: string; pct: number; status: string }>;
  healthPhases: ReadonlyArray<{ phaseId: string; rag: "green" | "amber" | "red" | "grey" }>;
  raidEntries: ReadonlyArray<{ phase: string; status: string }>;
  workstreams: ReadonlyArray<{ phaseId: string }>;
  projectedCost: number | null;
  phaseActuals: Record<string, number>;
}

export function buildPhaseSpine(input: PhaseSpineInput): PhaseTwinNode[] {
  const spendRows = derivePhaseSpendRows(
    input.projectedCost,
    input.phases.map((phase) => ({ id: phase.id, displayName: phase.displayName })),
    input.phaseActuals,
  );
  const spendById = new Map(spendRows.map((row) => [row.phaseId, row]));
  const ragById = new Map(input.healthPhases.map((health) => [health.phaseId, health.rag]));
  return input.phases.map((phase) => {
    const row = spendById.get(phase.id);
    const openRaidCount = input.raidEntries.filter(
      (entry) => (entry.phase === phase.id || entry.phase === phase.displayName) && entry.status !== "closed",
    ).length;
    const workstreamCount = input.workstreams.filter((workstream) => workstream.phaseId === phase.id).length;
    return {
      phaseId: phase.id,
      phaseName: phase.displayName,
      pct: phase.pct,
      status: phase.status,
      rag: ragById.get(phase.id) ?? "grey",
      estimatedCost: row?.estimated ?? null,
      actualCost: row?.actual ?? null,
      costStatus: row?.status ?? "unknown",
      openRaidCount,
      workstreamCount,
    };
  });
}

/** Weighted completion across items carrying a weight and a 0-100 pct. Returns
 *  null when there is no positive weight to divide by. */
export function weightedCompletion(items: ReadonlyArray<{ weight: number; pct: number }>): number | null {
  const totalWeight = items.reduce((sum, item) => sum + (Number.isFinite(item.weight) ? item.weight : 0), 0);
  if (totalWeight <= 0) return null;
  const weighted = items.reduce(
    (sum, item) => sum + (Number.isFinite(item.weight) ? item.weight : 0) * (Number.isFinite(item.pct) ? item.pct : 0),
    0,
  );
  return weighted / totalWeight;
}

function averageCompletion(phases: ReadonlyArray<{ pct: number }>): number | null {
  if (!phases.length) return null;
  const sum = phases.reduce((total, phase) => total + (Number.isFinite(phase.pct) ? phase.pct : 0), 0);
  return sum / phases.length;
}

export interface TwinModel {
  phases: ReadonlyArray<{ id: string; pct: number }>;
  workstreams: ReadonlyArray<{ id: string; phaseId: string; weight: number; pct: number }>;
  milestones: ReadonlyArray<{ id: string; title: string; phaseId: string }>;
  projectedCost: number | null;
  actualSpend: number | null;
  projectedBenefits: number | null;
}

export interface TwinScenario {
  phaseDelaysWeeks: Record<string, number>;
  droppedWorkstreamIds: string[];
  budgetDeltaPct: number;
}

export const EMPTY_SCENARIO: TwinScenario = {
  phaseDelaysWeeks: {},
  droppedWorkstreamIds: [],
  budgetDeltaPct: 0,
};

export interface TwinProjection {
  scheduleSlipWeeks: number;
  baselineCompletionPct: number | null;
  projectedCompletionPct: number | null;
  baselineCost: number | null;
  projectedCost: number | null;
  costUtilization: number | null;
  atRiskMilestones: Array<{ id: string; title: string; phaseId: string }>;
  valueAtRisk: number | null;
}

export function projectScenario(model: TwinModel, scenario: TwinScenario): TwinProjection {
  const scheduleSlipWeeks = Object.values(scenario.phaseDelaysWeeks).reduce(
    (sum, weeks) => sum + (Number.isFinite(weeks) && weeks > 0 ? weeks : 0),
    0,
  );

  const dropped = new Set(scenario.droppedWorkstreamIds);
  const remainingWorkstreams = model.workstreams.filter((workstream) => !dropped.has(workstream.id));

  const baselineCompletionPct = model.workstreams.length
    ? weightedCompletion(model.workstreams)
    : averageCompletion(model.phases);
  const projectedCompletionPct = model.workstreams.length
    ? weightedCompletion(remainingWorkstreams)
    : averageCompletion(model.phases);

  const baselineCost = model.projectedCost;
  const projectedCost = baselineCost !== null ? baselineCost * (1 + scenario.budgetDeltaPct / 100) : null;
  const costUtilization =
    projectedCost !== null && projectedCost > 0 && model.actualSpend !== null
      ? model.actualSpend / projectedCost
      : null;

  const delayedPhases = new Set(
    Object.entries(scenario.phaseDelaysWeeks)
      .filter(([, weeks]) => Number.isFinite(weeks) && weeks > 0)
      .map(([phaseId]) => phaseId),
  );
  const atRiskMilestones = model.milestones
    .filter((milestone) => delayedPhases.has(milestone.phaseId))
    .map((milestone) => ({ id: milestone.id, title: milestone.title, phaseId: milestone.phaseId }));
  const valueAtRisk =
    model.projectedBenefits !== null && model.phases.length
      ? model.projectedBenefits * (delayedPhases.size / model.phases.length)
      : null;

  return {
    scheduleSlipWeeks,
    baselineCompletionPct,
    projectedCompletionPct,
    baselineCost,
    projectedCost,
    costUtilization,
    atRiskMilestones,
    valueAtRisk,
  };
}
