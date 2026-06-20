import type { ArchetypeDefinition } from "@/v3/types";

export type MethodologyVariant = "atos-standard" | "atos-lite" | "atos-regulated";

/** One column of a structured `grid` phase-input field. */
export interface GridColumn {
  key: string;
  label: string;
  type?: "text" | "number" | "select";
  /** Fixed pixel width; omit to let the column flex. */
  width?: number;
  options?: string[];
  placeholder?: string;
}

/**
 * A single phase-input field captured on the phase screen. The methodology owns
 * the field definitions so the input schema, the UI, and the artifact prompts
 * all read one source of truth — never a hard-coded list in a component.
 */
export interface PhaseInputField {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "grid";
  placeholder?: string;
  required: boolean;
  options?: string[];
  hint?: string;
  /** Required when `type === "grid"`: the columns each row exposes. */
  columns?: GridColumn[];
  /** Soft-required threshold: warn when a grid has fewer than this many rows. */
  minRows?: number;
  /**
   * Provenance. Omitted (or "methodology") for the static registry fields;
   * "ai-derived" for fields a planner agent proposed for a specific programme
   * after a prior phase cleared its gate. Lets the UI mark them and lets the
   * resolver keep static fields authoritative when ids collide.
   */
  source?: "methodology" | "ai-derived";
  // ── Planner traceability (ai-derived fields only) ──────────────────────────
  // The Phase Transition Planner annotates each proposed field with why it is
  // needed and which artifacts consume it, and may pre-fill a high-confidence
  // inferred value the user only has to confirm. All optional; static fields
  // omit them.
  /** Short "why we need this fact" rationale from the planner. */
  reasonNeeded?: string;
  /** Artifact ids this field feeds (planner-declared). */
  usedByArtifacts?: string[];
  /** Planner-inferred value to suggest; the user confirms rather than retypes. */
  prefillValue?: string;
  /** Where the prefilled value was inferred from (artifact/document/evidence). */
  prefillSource?: string;
  /** Planner's confidence in the prefilled value. */
  confidence?: "high" | "medium" | "low";
  /** True when a prefilled value must be explicitly confirmed before it counts. */
  needsConfirmation?: boolean;
  /** Human-readable validation expectation (e.g. "ISO date"). */
  validationRule?: string;
  /** Example answer to anchor the user. */
  example?: string;
}

// Industry options surfaced on the Strategy phase. Lives in the methodology so
// the field definition and its prompt flow stay co-located.
export const INDUSTRY_OPTIONS = [
  "Financial Services",
  "Banking",
  "Insurance",
  "Healthcare",
  "Life Sciences & Pharma",
  "Retail & Consumer Goods",
  "Manufacturing",
  "Automotive",
  "Energy & Utilities",
  "Telecommunications",
  "Media & Entertainment",
  "Technology & Software",
  "Transportation & Logistics",
  "Public Sector & Government",
  "Education",
  "Travel & Hospitality",
  "Professional Services",
  "Other",
];

export interface PhaseDefinition {
  id: string;
  displayName: string;
  description: string;
  requiredArtifacts: string[];
  mandatoryExitCriteriaTemplates: string[];
  entryGuards: string[];
  recommendedAgents: string[];
  typicalDurationWeeks: { min: number; max: number };
  /** Phase-input fields captured on this phase (source of truth for the UI schema). */
  inputFields?: PhaseInputField[];
  /**
   * Declarative flow: which captured input field ids feed each artifact/agent's
   * generation prompt. Keyed by agent id (e.g. "strategic-roadmap", "plan").
   * The artifact generators read this instead of hard-coding which inputs apply.
   */
  artifactInputFlow?: Record<string, string[]>;
  /**
   * When true, this phase carries NO static inputs or artifacts — its entire
   * input + artifact schema is generated dynamically from prior-phase artifacts
   * (the planner writes them into the programme's dynamicSchema overlay at the
   * preceding gate). Only Strategy is static; every later phase is dynamic, so
   * the "static vs dynamic" rule lives here in the methodology, not in resolvers.
   */
  dynamicSchema?: boolean;
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
      requiredArtifacts: ["charter", "business-case", "outcome-framework", "strategic-roadmap"],
      mandatoryExitCriteriaTemplates: [
        "Executive sponsor confirmed and mandate documented",
        "Business objective and primary success metric defined",
        "Programme budget approved",
      ],
      entryGuards: ["Programme created", "Sponsor identified"],
      recommendedAgents: ["charter", "business-case", "outcome-framework", "narrative", "input-quality"],
      typicalDurationWeeks: { min: 2, max: 6 },
      inputFields: [
        { id: "businessObjective", label: "Business objective", type: "textarea", placeholder: "What outcome is this programme trying to achieve?", required: true },
        { id: "sponsor", label: "Executive sponsor", type: "text", placeholder: "Name and title", required: true },
        { id: "industry", label: "Industry", type: "select", options: INDUSTRY_OPTIONS, required: true },
        { id: "startDate", label: "Programme start date", type: "date", required: true },
        { id: "targetEndDate", label: "Target end date", type: "date", required: true },
        { id: "costAssumption", label: "Cost assumption", type: "textarea", placeholder: "Estimated programme cost and the basis for it", required: true, hint: "e.g. ~$2.4M based on vendor quotes and a 6-person core team" },
        { id: "constraints", label: "Key constraints", type: "textarea", placeholder: "Budget, timeline, regulatory, or technical constraints", required: true, hint: "e.g. Must go live before Q4 financial year end" },
        { id: "successMetric", label: "Primary success metric", type: "text", placeholder: "KPI name, e.g. Cost to serve", required: true },
        {
          // Validation / delivery posture: an explicit, recorded decision on how
          // much the programme will prove before committing to full build. POC →
          // Prototype → Pilot → MVP is a fidelity/investment ladder, so each stage
          // carries its own "is it needed?" call AND the rationale (the "why not"
          // when a stage is skipped is itself the governance value). Optional at
          // Strategy (appetite-level) so it never blocks artifact generation — a
          // required+empty field would fail the pre-flight gate; the concrete plan
          // is refined downstream in Design. Captured as a grid so one field holds
          // the whole matrix, and the edge's buildGroundingFacts already flattens
          // every grid row into the strategy artifact prompts — so it informs the
          // charter / business-case / roadmap automatically with NO artifactInputFlow
          // entry (which would otherwise gate generation on it).
          id: "validationApproach",
          label: "Validation approach",
          type: "grid",
          required: false,
          hint: "Record each de-risking stage you're considering and whether it's needed. Consciously skipping a stage — with the reason — is a valid, valuable decision to capture.",
          columns: [
            { key: "stage", label: "Stage", type: "select", width: 140, options: ["POC", "Prototype", "Pilot", "MVP"] },
            { key: "decision", label: "Needed?", type: "select", width: 150, options: ["Required", "Not required", "Decide later"] },
            { key: "considerations", label: "Considerations", type: "text", placeholder: "Why it is / isn't needed, scope, what it must prove to proceed" },
          ],
        },
      ],
      artifactInputFlow: {
        // The roadmap is sequenced from the whole strategy picture — objective,
        // sponsor, industry, constraints, cost, and the primary success metric —
        // bounded by the programme start/end dates. So every strategy input
        // feeds it: all must be present to generate, and any change stales it.
        "strategic-roadmap": ["businessObjective", "sponsor", "industry", "startDate", "targetEndDate", "costAssumption", "constraints", "successMetric"],
        "charter": ["industry", "startDate", "targetEndDate"],
        "business-case": ["industry", "costAssumption"],
      },
    },
    {
      id: "mobilise",
      displayName: "Mobilise",
      description: "Stand up the team, governance model, and working environment.",
      // Dynamic-only: artifacts + inputs are planned from Strategy's approved artifacts.
      requiredArtifacts: [],
      dynamicSchema: true,
      mandatoryExitCriteriaTemplates: [
        "Core team roles filled with named individuals",
        "Governance model agreed and documented",
        "Risks and assumptions log established",
      ],
      entryGuards: ["Strategy gate approved"],
      recommendedAgents: ["governance-model", "raci-matrix", "narrative", "plan", "stakeholder", "risk"],
      typicalDurationWeeks: { min: 2, max: 4 },
    },
    {
      id: "discover",
      displayName: "Discover",
      description: "Establish current state, scope, and discovery findings.",
      requiredArtifacts: [],
      dynamicSchema: true,
      mandatoryExitCriteriaTemplates: [
        "Current state documented",
        "In-scope and out-of-scope items agreed",
        "Key stakeholders identified and mapped",
      ],
      entryGuards: ["Mobilise gate approved"],
      recommendedAgents: ["requirements-catalog", "narrative", "risk", "stakeholder", "milestone"],
      typicalDurationWeeks: { min: 3, max: 8 },
    },
    {
      id: "design",
      displayName: "Design",
      description: "Produce the solution design, architecture decisions, and delivery plan.",
      requiredArtifacts: [],
      dynamicSchema: true,
      mandatoryExitCriteriaTemplates: [
        "Solution design approved by architecture review",
        "Key architecture decisions recorded",
        "Critical path established",
      ],
      entryGuards: ["Discover gate approved"],
      recommendedAgents: ["future-state-design", "target-operating-model", "solution-architecture", "narrative", "plan", "risk", "critical-path", "change-impact"],
      typicalDurationWeeks: { min: 4, max: 10 },
    },
    {
      id: "build",
      displayName: "Build",
      description: "Deliver the solution against the agreed design.",
      requiredArtifacts: [],
      dynamicSchema: true,
      mandatoryExitCriteriaTemplates: [
        "All must-have requirements delivered and tested",
        "User acceptance testing passed",
        "Go-live readiness confirmed",
      ],
      entryGuards: ["Design gate approved"],
      recommendedAgents: ["test-plan", "narrative", "plan", "milestone", "risk"],
      typicalDurationWeeks: { min: 8, max: 26 },
    },
    {
      id: "operate",
      displayName: "Operate",
      description: "Transition to live operation with appropriate support.",
      requiredArtifacts: [],
      dynamicSchema: true,
      mandatoryExitCriteriaTemplates: [
        "Live operation stable for agreed hyper-care period",
        "Support model handed to operations",
        "Adoption metrics baseline established",
      ],
      entryGuards: ["Build gate approved"],
      recommendedAgents: ["runbook", "support-model", "narrative", "adoption", "health-heatmap"],
      typicalDurationWeeks: { min: 4, max: 12 },
    },
    {
      id: "govern",
      displayName: "Govern",
      description: "Establish ongoing governance, compliance, and performance monitoring.",
      requiredArtifacts: [],
      dynamicSchema: true,
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
      requiredArtifacts: [],
      dynamicSchema: true,
      mandatoryExitCriteriaTemplates: [
        "Optimisation opportunities identified and prioritised",
        "At least one improvement cycle completed",
      ],
      entryGuards: ["Govern gate approved"],
      recommendedAgents: ["optimization-backlog", "narrative", "plan", "benefits-tracker"],
      typicalDurationWeeks: { min: 4, max: 12 },
    },
    {
      id: "valuerealize",
      displayName: "Value Realize",
      description: "Formally measure and document benefits realisation.",
      requiredArtifacts: [],
      dynamicSchema: true,
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

/**
 * The methodology definition for a single phase id. Falls back to the standard
 * methodology (which declares every known phase) when the variant omits it, so
 * callers always get the phase's exit-criteria spine and recommended agents.
 */
export function getPhaseDefinition(
  phaseId: string,
  variant: MethodologyVariant = "atos-lite",
): PhaseDefinition | undefined {
  return getMethodology(variant).phases.find((phase) => phase.id === phaseId)
    ?? ATOS_STANDARD.phases.find((phase) => phase.id === phaseId);
}
