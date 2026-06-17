import { ATOS_STANDARD, type PhaseInputField } from "@/v3/lib/methodology";

// Field/column types are owned by the methodology (single source of truth);
// re-exported here so existing imports from this module keep working.
export type { GridColumn, PhaseInputField } from "@/v3/lib/methodology";

export interface PhaseInputSchema {
  phaseId: string;
  title: string;
  description: string;
  fields: PhaseInputField[];
}

/** Reads a phase's input-field definitions from the methodology registry. */
function methodologyInputFields(phaseId: string): PhaseInputField[] {
  return ATOS_STANDARD.phases.find((phase) => phase.id === phaseId)?.inputFields ?? [];
}

export const PHASE_INPUT_SCHEMAS: Record<string, PhaseInputSchema> = {
  strategy: {
    phaseId: "strategy",
    title: "Strategy inputs",
    description: "Provide the foundational context ATOS needs to generate strategy artifacts.",
    // Fields sourced from the methodology so the schema never drifts from it.
    fields: methodologyInputFields("strategy"),
  },
  mobilise: {
    phaseId: "mobilise",
    title: "Mobilise inputs",
    description: "Define the team and governance structure for this phase.",
    // Fields sourced from the methodology so the schema never drifts from it.
    fields: methodologyInputFields("mobilise"),
  },
  discover: {
    phaseId: "discover",
    title: "Discover inputs",
    description: "Describe the current state and discovery scope.",
    fields: [
      { id: "currentState", label: "Current state summary", type: "textarea", placeholder: "What is being replaced or improved?", required: true },
      { id: "scopeInclusions", label: "In scope", type: "textarea", placeholder: "Business units, processes, systems", required: true },
      { id: "scopeExclusions", label: "Out of scope", type: "textarea", placeholder: "What is explicitly excluded", required: true },
      { id: "keyStakeholders", label: "Key stakeholders", type: "textarea", placeholder: "Names, departments, roles", required: true },
    ],
  },
  design: {
    phaseId: "design",
    title: "Design inputs",
    description: "Provide the solution design context for this phase.",
    fields: [
      { id: "solutionApproach", label: "Solution approach", type: "textarea", placeholder: "High-level technical or process design direction", required: true },
      { id: "integrationPoints", label: "Integration points", type: "textarea", placeholder: "Systems that must connect to the solution", required: true },
      { id: "designConstraints", label: "Design constraints", type: "textarea", placeholder: "Architecture standards, security requirements", required: true },
    ],
  },
  build: {
    phaseId: "build",
    title: "Build inputs",
    description: "Track build progress and highlight what ATOS should know.",
    fields: [
      { id: "sprintVelocity", label: "Current sprint velocity", type: "number", placeholder: "Story points per sprint", required: true },
      { id: "blockers", label: "Active blockers", type: "textarea", placeholder: "What is blocking delivery right now?", required: true },
      { id: "testCoverage", label: "Test coverage %", type: "number", placeholder: "0–100", required: true },
    ],
  },
  operate: {
    phaseId: "operate",
    title: "Operate inputs",
    description: "Confirm go-live readiness, support arrangements, and the KPIs now being tracked.",
    fields: [
      { id: "goLivePlanOwner", label: "Go-live plan owner", type: "text", placeholder: "Name and title of the person accountable for cutover / go-live", required: true, hint: "Aligns to the approved go-live plan exit criterion" },
      { id: "supportModel", label: "Support model", type: "select", options: ["Hypercare team", "Dedicated support desk", "Vendor-managed", "Internal BAU team", "Hybrid"], required: true, hint: "Confirmed hypercare and steady-state support arrangement" },
      { id: "trackedKpi", label: "KPI being tracked", type: "textarea", placeholder: "Which KPI is actively measured against baseline, and where is it reported?", required: true, hint: "At least one KPI must be tracked against baseline to exit Operate" },
      { id: "runbookReference", label: "Runbook reference", type: "text", placeholder: "Link or reference to the operational runbook", required: true },
      { id: "adoptionApproach", label: "Adoption approach", type: "textarea", placeholder: "How is user adoption being driven and measured in early live operation?", required: true },
    ],
  },
  govern: {
    phaseId: "govern",
    title: "Govern inputs",
    description: "Establish the compliance, controls, and reporting that keep the programme governed.",
    fields: [
      { id: "complianceOwner", label: "Compliance owner", type: "text", placeholder: "Name and title of the person accountable for compliance sign-off", required: true, hint: "Owner who validates the compliance framework" },
      { id: "controlMatrix", label: "Control matrix reference", type: "text", placeholder: "Link or reference to the approved control matrix", required: true, hint: "Key operational controls documented, tested, and approved" },
      { id: "reportingCadence", label: "Reporting cadence", type: "select", options: ["Weekly", "Fortnightly", "Monthly", "Quarterly"], required: true, hint: "Ongoing governance reporting rhythm" },
      { id: "auditEvidencePlan", label: "Audit evidence plan", type: "textarea", placeholder: "How and when audit evidence is collected, and who owns it", required: true },
      { id: "escalationPath", label: "Escalation path", type: "textarea", placeholder: "Escalation routes and decision rights confirmed as operational", required: true },
    ],
  },
  optimize: {
    phaseId: "optimize",
    title: "Optimize inputs",
    description: "Capture the baseline, improvement backlog, and adoption signals that drive continuous improvement.",
    fields: [
      { id: "benefitBaseline", label: "Benefit baseline", type: "textarea", placeholder: "Which benefit has an agreed baseline, and what is the measured starting value?", required: true, hint: "Baseline measurement for at least one benefit must be confirmed" },
      { id: "improvementBacklog", label: "Improvement backlog reference", type: "text", placeholder: "Link or reference to the prioritised improvement backlog", required: true, hint: "Post-go-live improvements logged and prioritised by business value" },
      { id: "adoptionTarget", label: "Adoption vs target", type: "text", placeholder: "e.g. 84% of adoption-plan target", required: true, hint: "Adoption should track to ≥ 80% of plan" },
      { id: "experimentProposal", label: "Experiment recommendation", type: "textarea", placeholder: "Summarise at least one proposed optimisation experiment and its expected value", required: true },
    ],
  },
  valuerealize: {
    phaseId: "valuerealize",
    title: "Value Realize inputs",
    description: "Record realised benefits, lessons, and the handover that closes the programme.",
    fields: [
      { id: "realisedBenefits", label: "Realised benefits", type: "textarea", placeholder: "Which benefits have been realised and quantified, and who signed them off?", required: true, hint: "At least one benefit realised, measured, and signed off by the sponsor" },
      { id: "lessonsLearnedReference", label: "Lessons learned reference", type: "text", placeholder: "Link or reference to the lessons-learned register", required: true, hint: "Retrospective completed with lessons documented across phases" },
      { id: "bauOwner", label: "BAU owner", type: "text", placeholder: "Name and title of the business-as-usual owner accepting handover", required: true, hint: "Programme outputs and responsibilities formally handed to BAU" },
      { id: "closurePackReference", label: "Closure pack reference", type: "text", placeholder: "Link or reference to the approved programme closure pack", required: true },
    ],
  },
};

export function getPhaseInputSchema(phaseId: string): PhaseInputSchema {
  return PHASE_INPUT_SCHEMAS[phaseId] ?? {
    phaseId,
    title: "Phase inputs",
    description: "Provide any context ATOS needs to generate artifacts for this phase.",
    fields: [
      { id: "context", label: "Phase context", type: "textarea", placeholder: "Key information, decisions made, or constraints for this phase", required: true },
      { id: "objectives", label: "Phase objectives", type: "textarea", placeholder: "What must be achieved before this phase can close?", required: true },
    ],
  };
}
