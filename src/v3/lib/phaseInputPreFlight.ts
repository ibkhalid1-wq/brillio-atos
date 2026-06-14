export interface PreFlightResult {
  pass: boolean;
  completeness: number;
  missingFields: string[];
  warnings: string[];
  blockingCount: number;
}

interface PhaseInputs {
  objective?: string;
  scope?: string;
  risks?: unknown[];
  milestones?: unknown[];
  narrative?: string;
  stakeholders?: unknown[];
  budget?: unknown;
  kpis?: unknown[];
  [key: string]: unknown;
}

const REQUIRED_FIELDS_BY_AGENT: Record<string, Array<{ key: keyof PhaseInputs; label: string }>> = {
  "narrative":      [{ key: "objective", label: "Programme objective" }, { key: "scope", label: "Scope" }],
  "risk":           [{ key: "objective", label: "Programme objective" }, { key: "milestones", label: "Milestones" }],
  "gate-review":    [{ key: "objective", label: "Programme objective" }, { key: "risks", label: "Risk register" }, { key: "milestones", label: "Milestones" }],
  "stakeholder":    [{ key: "stakeholders", label: "Stakeholder list" }, { key: "objective", label: "Programme objective" }],
  "budget":         [{ key: "budget", label: "Budget baseline" }, { key: "milestones", label: "Milestones" }],
  "critical-path":  [{ key: "milestones", label: "Milestones" }],
  "kpi-validator":  [{ key: "kpis", label: "KPI definitions" }, { key: "objective", label: "Programme objective" }],
  "capacity-assessor": [{ key: "milestones", label: "Milestones" }],
};

export function runPreFlight(agentId: string, inputs: PhaseInputs): PreFlightResult {
  const required = REQUIRED_FIELDS_BY_AGENT[agentId] ?? [{ key: "objective" as keyof PhaseInputs, label: "Programme objective" }];
  const missingFields: string[] = [];
  const warnings: string[] = [];

  for (const field of required) {
    const val = inputs[field.key];
    const isEmpty = val === undefined || val === null || val === ""
      || (Array.isArray(val) && val.length === 0)
      || (typeof val === "string" && val.trim().length < 10);
    if (isEmpty) missingFields.push(field.label);
  }

  if (typeof inputs.narrative === "string" && inputs.narrative.trim().length < 50) {
    warnings.push("Phase narrative is sparse — output quality may be limited");
  }

  const completeness = required.length === 0 ? 100 :
    Math.round(((required.length - missingFields.length) / required.length) * 100);

  return { pass: missingFields.length === 0, completeness, missingFields, warnings, blockingCount: missingFields.length };
}
