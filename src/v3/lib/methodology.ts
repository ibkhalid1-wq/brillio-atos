import type { ArchetypeDefinition } from "@/v3/types";

export type MethodologyVariant = "atos-standard" | "atos-lite" | "atos-regulated";

export interface PhaseDefinition {
  id: string;
  displayName: string;
  description: string;
  requiredArtifacts: string[];
  mandatoryExitCriteriaTemplates: string[];
  entryGuards: string[];
  recommendedAgents: string[];
  typicalDurationWeeks: { min: number; max: number };
}

export interface MethodologyDefinition {
  id: MethodologyVariant;
  version: string;
  name: string;
  description: string;
  phases: PhaseDefinition[];
}

export const ATOS_STANDARD: MethodologyDefinition = {
  id: "atos-standard",
  version: "2.1.0",
  name: "ATOS Standard",
  description: "Full 9-phase ATOS transformation methodology for enterprise programs.",
  phases: [
    {
      id: "strategy",
      displayName: "Strategy",
      description: "Define the transformation mandate, value hypothesis, and success metrics.",
      requiredArtifacts: ["charter", "business-case", "outcome-framework", "narrative", "plan"],
      mandatoryExitCriteriaTemplates: [
        "Executive sponsor confirmed and mandate documented",
        "Business objective and primary success metric defined",
        "Programme budget approved",
      ],
      entryGuards: ["Programme created", "Sponsor identified"],
      recommendedAgents: ["charter", "business-case", "outcome-framework", "narrative", "plan", "input-quality"],
      typicalDurationWeeks: { min: 2, max: 6 },
    },
    {
      id: "mobilise",
      displayName: "Mobilise",
      description: "Stand up the team, governance model, and working environment.",
      requiredArtifacts: ["narrative", "plan", "stakeholder"],
      mandatoryExitCriteriaTemplates: [
        "Core team roles filled with named individuals",
        "Governance model agreed and documented",
        "Risks and assumptions log established",
      ],
      entryGuards: ["Strategy gate approved"],
      recommendedAgents: ["narrative", "stakeholder", "risk"],
      typicalDurationWeeks: { min: 2, max: 4 },
    },
    {
      id: "discover",
      displayName: "Discover",
      description: "Establish current state, scope, and discovery findings.",
      requiredArtifacts: ["narrative", "risk", "milestone"],
      mandatoryExitCriteriaTemplates: [
        "Current state documented",
        "In-scope and out-of-scope items agreed",
        "Key stakeholders identified and mapped",
      ],
      entryGuards: ["Mobilise gate approved"],
      recommendedAgents: ["narrative", "risk", "stakeholder", "milestone"],
      typicalDurationWeeks: { min: 3, max: 8 },
    },
    {
      id: "design",
      displayName: "Design",
      description: "Produce the solution design, architecture decisions, and delivery plan.",
      requiredArtifacts: ["narrative", "plan", "risk", "critical-path"],
      mandatoryExitCriteriaTemplates: [
        "Solution design approved by architecture review",
        "Key architecture decisions recorded",
        "Critical path established",
      ],
      entryGuards: ["Discover gate approved"],
      recommendedAgents: ["narrative", "plan", "risk", "critical-path", "change-impact"],
      typicalDurationWeeks: { min: 4, max: 10 },
    },
    {
      id: "build",
      displayName: "Build",
      description: "Deliver the solution against the agreed design.",
      requiredArtifacts: ["narrative", "plan", "milestone"],
      mandatoryExitCriteriaTemplates: [
        "All must-have requirements delivered and tested",
        "User acceptance testing passed",
        "Go-live readiness confirmed",
      ],
      entryGuards: ["Design gate approved"],
      recommendedAgents: ["narrative", "plan", "milestone", "risk"],
      typicalDurationWeeks: { min: 8, max: 26 },
    },
    {
      id: "operate",
      displayName: "Operate",
      description: "Transition to live operation with appropriate support.",
      requiredArtifacts: ["narrative", "adoption"],
      mandatoryExitCriteriaTemplates: [
        "Live operation stable for agreed hyper-care period",
        "Support model handed to operations",
        "Adoption metrics baseline established",
      ],
      entryGuards: ["Build gate approved"],
      recommendedAgents: ["narrative", "adoption", "health-heatmap"],
      typicalDurationWeeks: { min: 4, max: 12 },
    },
    {
      id: "govern",
      displayName: "Govern",
      description: "Establish ongoing governance, compliance, and performance monitoring.",
      requiredArtifacts: ["narrative", "risk"],
      mandatoryExitCriteriaTemplates: [
        "Governance model operational",
        "Compliance controls verified",
        "Ongoing reporting cadence established",
      ],
      entryGuards: ["Operate gate approved"],
      recommendedAgents: ["narrative", "risk", "adoption"],
      typicalDurationWeeks: { min: 2, max: 6 },
    },
    {
      id: "optimize",
      displayName: "Optimize",
      description: "Drive continuous improvement against baseline metrics.",
      requiredArtifacts: ["narrative", "plan"],
      mandatoryExitCriteriaTemplates: [
        "Optimisation opportunities identified and prioritised",
        "At least one improvement cycle completed",
      ],
      entryGuards: ["Govern gate approved"],
      recommendedAgents: ["narrative", "plan", "benefits-tracker"],
      typicalDurationWeeks: { min: 4, max: 12 },
    },
    {
      id: "valuerealize",
      displayName: "Value Realize",
      description: "Formally measure and document benefits realisation.",
      requiredArtifacts: ["narrative", "closure"],
      mandatoryExitCriteriaTemplates: [
        "Benefits measured against baseline",
        "Final lessons learned documented",
        "Programme closure approved by sponsor",
      ],
      entryGuards: ["Optimize gate approved"],
      recommendedAgents: ["narrative", "closure", "benefits-tracker"],
      typicalDurationWeeks: { min: 2, max: 8 },
    },
  ],
};

export const ATOS_LITE: MethodologyDefinition = {
  ...ATOS_STANDARD,
  id: "atos-lite",
  version: "2.1.0",
  name: "ATOS Lite",
  description: "Streamlined 6-phase methodology for smaller programs under 6 months.",
  phases: ATOS_STANDARD.phases.filter((phase) =>
    ["strategy", "mobilise", "discover", "build", "operate", "valuerealize"].includes(phase.id)
  ),
};

export const CLIENT_PHASE_NAMES: Record<string, string> = {
  strategy: "Strategy",
  mobilise: "Mobilise",
  discover: "Discover",
  design: "Design",
  build: "Build",
  operate: "Operate",
  govern: "Govern",
  optimize: "Optimize",
  valuerealize: "Value Realize",
};

export const METHODOLOGY_REGISTRY: Record<MethodologyVariant, MethodologyDefinition> = {
  "atos-standard": ATOS_STANDARD,
  "atos-lite": ATOS_LITE,
  "atos-regulated": {
    ...ATOS_STANDARD,
    id: "atos-regulated",
    name: "ATOS Regulated",
  },
};

export const PROGRAM_ARCHETYPES: ArchetypeDefinition[] = [
  {
    id: "technology-implementation",
    label: "Technology Implementation",
    description: "Deploying a technology platform, system migration, or software rollout.",
    icon: "⚙",
    methodologyVariant: "atos-lite",
    typicalDurationMonths: { min: 3, max: 9 },
    defaultKPIs: ["System uptime", "User adoption rate", "Defect resolution time", "Go-live on time"],
  },
  {
    id: "business-transformation",
    label: "Business Transformation",
    description: "End-to-end operating model change, organisational redesign, or strategic shift.",
    icon: "◈",
    methodologyVariant: "atos-standard",
    typicalDurationMonths: { min: 6, max: 18 },
    defaultKPIs: ["Benefits realised %", "Change readiness score", "Stakeholder engagement", "Cost reduction"],
  },
  {
    id: "regulatory-programme",
    label: "Regulatory Programme",
    description: "Compliance-driven programme with mandated controls, audits, and formal governance.",
    icon: "⊞",
    methodologyVariant: "atos-regulated",
    typicalDurationMonths: { min: 6, max: 24 },
    defaultKPIs: ["Compliance status", "Audit findings resolved", "Controls implemented", "Regulatory deadline met"],
  },
  {
    id: "agile-delivery",
    label: "Agile Delivery",
    description: "Iterative delivery programme using sprints, backlogs, and continuous release.",
    icon: "◎",
    methodologyVariant: "atos-lite",
    typicalDurationMonths: { min: 2, max: 6 },
    defaultKPIs: ["Sprint velocity", "Feature delivery rate", "Backlog burndown", "NPS / user satisfaction"],
  },
];

export function getMethodology(variant: MethodologyVariant = "atos-lite"): MethodologyDefinition {
  return METHODOLOGY_REGISTRY[variant] ?? ATOS_STANDARD;
}

export function getPhaseSequence(variant: MethodologyVariant = "atos-lite"): string[] {
  return getMethodology(variant).phases.map((phase) => phase.id);
}

export function getPhaseDefinition(variant: MethodologyVariant = "atos-lite", phaseId: string): PhaseDefinition | null {
  return getMethodology(variant).phases.find((phase) => phase.id === phaseId) ?? null;
}
