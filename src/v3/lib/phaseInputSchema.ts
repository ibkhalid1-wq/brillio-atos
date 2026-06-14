export interface PhaseInputField {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select";
  placeholder?: string;
  required: boolean;
  options?: string[];
  hint?: string;
}

export interface PhaseInputSchema {
  phaseId: string;
  title: string;
  description: string;
  fields: PhaseInputField[];
}

const keyRolesField: PhaseInputField = {
  id: "keyRoles",
  label: "Key roles",
  type: "textarea",
  placeholder: "Program Director: Jane Smith\nTech Lead: John Doe\nBusiness Owner: Acme Corp PMO",
  required: false,
  hint: "Name the accountable person for each role active in this phase",
};

export const PHASE_INPUT_SCHEMAS: Record<string, PhaseInputSchema> = {
  strategy: {
    phaseId: "strategy",
    title: "Strategy inputs",
    description: "Provide the foundational context ADAM needs to generate strategy artifacts.",
    fields: [
      { id: "businessObjective", label: "Business objective", type: "textarea", placeholder: "What outcome is this program trying to achieve?", required: true },
      { id: "sponsor", label: "Executive sponsor", type: "text", placeholder: "Name and title", required: true },
      { id: "constraints", label: "Key constraints", type: "textarea", placeholder: "Budget, timeline, regulatory, or technical constraints", required: false, hint: "e.g. Must go live before Q4 financial year end" },
      { id: "successMetric", label: "Primary success metric", type: "text", placeholder: "e.g. 20% reduction in processing time", required: true },
      keyRolesField,
    ],
  },
  mobilise: {
    phaseId: "mobilise",
    title: "Mobilise inputs",
    description: "Define the team and governance structure for this phase.",
    fields: [
      { id: "programDirector", label: "Program director", type: "text", placeholder: "Name", required: true },
      { id: "teamSize", label: "Team size", type: "number", placeholder: "Number of FTEs", required: false },
      { id: "governanceModel", label: "Governance model", type: "select", options: ["Steering committee", "PMO-led", "Agile squad", "Hybrid"], required: false },
      { id: "keyRisks", label: "Known risks at mobilisation", type: "textarea", placeholder: "Staffing, vendor readiness, budget approval…", required: false },
      keyRolesField,
    ],
  },
  discover: {
    phaseId: "discover",
    title: "Discover inputs",
    description: "Describe the current state and discovery scope.",
    fields: [
      { id: "currentState", label: "Current state summary", type: "textarea", placeholder: "What is being replaced or improved?", required: true },
      { id: "scopeInclusions", label: "In scope", type: "textarea", placeholder: "Business units, processes, systems", required: true },
      { id: "scopeExclusions", label: "Out of scope", type: "textarea", placeholder: "What is explicitly excluded", required: false },
      { id: "keyStakeholders", label: "Key stakeholders", type: "textarea", placeholder: "Names, departments, roles", required: false },
      keyRolesField,
    ],
  },
  design: {
    phaseId: "design",
    title: "Design inputs",
    description: "Provide the solution design context for this phase.",
    fields: [
      { id: "solutionApproach", label: "Solution approach", type: "textarea", placeholder: "High-level technical or process design direction", required: true },
      { id: "integrationPoints", label: "Integration points", type: "textarea", placeholder: "Systems that must connect to the solution", required: false },
      { id: "designConstraints", label: "Design constraints", type: "textarea", placeholder: "Architecture standards, security requirements", required: false },
      keyRolesField,
    ],
  },
  build: {
    phaseId: "build",
    title: "Build inputs",
    description: "Track build progress and highlight what ADAM should know.",
    fields: [
      { id: "sprintVelocity", label: "Current sprint velocity", type: "number", placeholder: "Story points per sprint", required: false },
      { id: "blockers", label: "Active blockers", type: "textarea", placeholder: "What is blocking delivery right now?", required: false },
      { id: "testCoverage", label: "Test coverage %", type: "number", placeholder: "0–100", required: false },
      keyRolesField,
    ],
  },
};

export function getPhaseInputSchema(phaseId: string): PhaseInputSchema {
  return PHASE_INPUT_SCHEMAS[phaseId] ?? {
    phaseId,
    title: "Phase inputs",
    description: "Provide any context ADAM needs to generate artifacts for this phase.",
    fields: [
      { id: "context", label: "Phase context", type: "textarea", placeholder: "Key information, decisions made, or constraints for this phase", required: false },
      { id: "objectives", label: "Phase objectives", type: "textarea", placeholder: "What must be achieved before this phase can close?", required: false },
      keyRolesField,
    ],
  };
}
