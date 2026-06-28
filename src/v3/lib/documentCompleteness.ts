import type { ProgramSummary } from "@/new/types";

export interface CompletenessWarning {
  field: string;
  impact: string;
  severity: "blocking" | "warning";
}

export function checkNarrativeCompleteness(program: ProgramSummary): CompletenessWarning[] {
  const warnings: CompletenessWarning[] = [];
  const raw = program.rawData as Record<string, unknown>;
  const inner = (raw?.data as Record<string, unknown>) ?? raw ?? {};
  const phaseInputs = (inner.phaseInputs as Record<string, Record<string, unknown>>) ?? {};
  const strategyInputs = phaseInputs.strategy ?? {};

  if (!strategyInputs.businessObjective && !inner.objective) {
    warnings.push({ field: "Business objective", impact: "Narrative will be generic", severity: "blocking" });
  }
  const phases = Array.isArray(inner.phases) ? inner.phases : [];
  const hasProgress = phases.some((p: unknown) => typeof p === "object" && p !== null && (p as Record<string, unknown>).pct as number > 0);
  if (!hasProgress) {
    warnings.push({ field: "Phase progress", impact: "Narrative will say 'not started'", severity: "warning" });
  }
  return warnings;
}

export function checkDeckCompleteness(program: ProgramSummary): CompletenessWarning[] {
  const warnings: CompletenessWarning[] = [];
  const raw = program.rawData as Record<string, unknown>;
  const inner = (raw?.data as Record<string, unknown>) ?? raw ?? {};
  const phaseInputs = (inner.phaseInputs as Record<string, Record<string, unknown>>) ?? {};
  const strategyInputs = phaseInputs.strategy ?? {};

  if (!strategyInputs.businessObjective && !inner.objective) warnings.push({ field: "Business objective", impact: "Executive summary slide will be weak", severity: "blocking" });
  if (!inner.budget && !inner.budgetTracking) warnings.push({ field: "Budget data", impact: "Financials slide will be empty", severity: "warning" });
  if (!inner.stakeholders || (inner.stakeholders as unknown[]).length === 0) warnings.push({ field: "Stakeholders", impact: "Stakeholder slide will be missing", severity: "warning" });
  if (!inner.narrative) warnings.push({ field: "Programme narrative", impact: "Executive summary will be weak — run Narrative agent first", severity: "warning" });
  return warnings;
}

export function checkPlanCompleteness(program: ProgramSummary): CompletenessWarning[] {
  const warnings: CompletenessWarning[] = [];
  const raw = program.rawData as Record<string, unknown>;
  const inner = (raw?.data as Record<string, unknown>) ?? raw ?? {};
  const phases = Array.isArray(inner.phases) ? inner.phases : [];

  if (phases.length === 0) warnings.push({ field: "Phase structure", impact: "Plan will have no milestones", severity: "blocking" });
  const raidLog = (inner.raidLog as Record<string, unknown>) ?? {};
  const entries = Array.isArray(raidLog.entries) ? raidLog.entries : [];
  if (entries.length === 0) warnings.push({ field: "Risk & blocker entries", impact: "Blocker summary will be empty", severity: "warning" });
  return warnings;
}
