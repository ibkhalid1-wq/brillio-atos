import type { ArchetypeDefinition } from "@/v3/types";

export type MethodologyVariant = "atos-standard" | "atos-lite" | "atos-regulated";

/** One column of a structured `grid` phase-input field. */
export interface GridColumn {
  key: string;
  label: string;
  type?: "text" | "number" | "select" | "date";
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
  /**
   * Input shape. The first six are the primitive editors. The last four are
   * *semantic reference* types — they still persist as a plain string, but the
   * UI renders a context-aware picker (a datalist sourced from the programme's
   * roster, organisations, uploaded documents or generated artifacts) so the
   * captured fact is a real, resolvable reference rather than free text:
   *   • stakeholder         → a named person (roster / stakeholder map)
   *   • organization        → a named org, vendor or department (client + orgs)
   *   • document            → an uploaded source document
   *   • artifact-reference  → a generated artifact in this programme
   */
  type:
    | "text"
    | "textarea"
    | "number"
    | "date"
    | "select"
    | "grid"
    | "stakeholder"
    | "organization"
    | "document"
    | "artifact-reference";
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
   * generation prompt. Keyed by agent id (e.g. "strategic-roadmap").
   * The artifact generators read this instead of hard-coding which inputs apply.
   */
  artifactInputFlow?: Record<string, string[]>;
  /**
   * When true, this phase accepts a dynamic schema overlay: the planner reads the
   * prior phase's approved artifacts and writes programme-specific input fields +
   * artifacts into `rawData.dynamicSchema` at the preceding gate. Dynamic entries
   * are additive — any static `inputFields`/`artifacts` the phase also declares
   * stay authoritative (static wins on id collision). Strategy is fully static;
   * Design seeds static solution-design inputs AND takes dynamic additions; the
   * remaining phases are dynamic-only. So the "static vs dynamic" rule lives here
   * in the methodology, not in resolvers.
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
      recommendedAgents: ["charter", "business-case", "outcome-framework", "narrative"],
      typicalDurationWeeks: { min: 2, max: 6 },
      inputFields: [
        { id: "businessObjective", label: "Business objective", type: "textarea", placeholder: "What outcome is this programme trying to achieve?", required: true },
        { id: "sponsor", label: "Executive sponsor", type: "text", placeholder: "Name and title", required: true },
        { id: "industry", label: "Industry", type: "select", options: INDUSTRY_OPTIONS, required: true },
        { id: "startDate", label: "Programme start date", type: "date", required: true },
        { id: "targetEndDate", label: "Target end date", type: "date", required: true },
        {
          // Cost is captured as a line-item grid rather than free text so the
          // business case is grounded on a structured cost breakdown — each row is
          // a cost line with its estimate and the basis for it. The edge's
          // buildGroundingFacts flattens every grid row into the strategy artifact
          // prompts, so the breakdown informs the business-case / roadmap directly.
          // A plain-text legacy value is migrated into a single row by parseRows.
          id: "costAssumption",
          label: "Cost assumption",
          type: "grid",
          required: true,
          hint: "Break the estimated programme cost into line items — e.g. vendor licences, core team, infrastructure — with the estimate and the basis for each.",
          columns: [
            { key: "category", label: "Cost line", type: "text", placeholder: "e.g. Vendor licences" },
            { key: "amount", label: "Estimate", type: "text", width: 140, placeholder: "e.g. $1.2M" },
            { key: "basis", label: "Basis / assumption", type: "text", placeholder: "What the estimate is based on" },
          ],
        },
        { id: "constraints", label: "Key constraints", type: "textarea", placeholder: "Budget, timeline, regulatory, or technical constraints", required: true, hint: "e.g. Must go live before Q4 financial year end" },
        { id: "successMetric", label: "Primary success metric", type: "text", placeholder: "KPI name, e.g. Cost to serve", required: true },
        {
          // Validation / delivery posture: an explicit, recorded plan for how much
          // the programme will prove before committing to full build. POC →
          // Prototype → Pilot → MVP is a fidelity/investment ladder; each stage
          // carries its rationale (considerations — including the "why not" when a
          // stage is skipped, itself governance value) and a target date. Optional
          // at Strategy (appetite-level) so it never blocks artifact generation — a
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
          hint: "Record each de-risking stage you're considering, the key considerations, and a target date. Consciously skipping a stage — with the reason — is a valid, valuable decision to capture.",
          columns: [
            { key: "stage", label: "Stage", type: "select", width: 140, options: ["POC", "Prototype", "Pilot", "MVP"] },
            { key: "considerations", label: "Considerations", type: "text", placeholder: "Scope, what it must prove to proceed, or why it isn't needed" },
            { key: "date", label: "Target date", type: "date", width: 160 },
          ],
        },
      ],
      artifactInputFlow: {
        // The roadmap is sequenced from the whole strategy picture — objective,
        // sponsor, industry, constraints, cost, and the primary success metric —
        // bounded by the programme start/end dates. So every strategy input
        // feeds it: all must be present to generate, and any change stales it.
        "strategic-roadmap": ["businessObjective", "sponsor", "industry", "startDate", "targetEndDate", "costAssumption", "constraints", "successMetric", "validationApproach"],
        "charter": ["industry", "startDate", "targetEndDate"],
        "business-case": ["industry", "costAssumption"],
        // The validation/de-risking ladder shapes how outcomes are sequenced and
        // proven, so it feeds the outcome framework and the roadmap. It is
        // optional, so the generation gate (StageView) treats unfilled optional
        // flow inputs as non-blocking — the edge wires the visual flow + staleness
        // without locking generation on an appetite-level field.
        "outcome-framework": ["successMetric", "validationApproach"],
      },
    },
    {
      id: "mobilise",
      displayName: "Mobilise",
      description: "Stand up the team, governance model, and working environment.",
      requiredArtifacts: [],
      // Mobilise seeds the two facts every downstream phase depends on: the core-team
      // roster (the single source every later "Named <role>" owner resolves against,
      // so the roster-owner guardrail has something to point at) and the governance
      // cadence its governance-model / RACI agents synthesise. Seeding them as static
      // inputs means owner resolution and RACI/governance generation never wait on the
      // planner remembering to ask. dynamicSchema stays true: the planner may still ADD
      // programme-specific fields; static wins on id collision, so the canonical
      // `coreTeamRoster` grid (resolved by findRosterGrid) is always present.
      dynamicSchema: true,
      mandatoryExitCriteriaTemplates: [
        "Core team roles filled with named individuals",
        "Governance model agreed and documented",
        "Risks and assumptions log established",
      ],
      entryGuards: ["Strategy gate approved"],
      recommendedAgents: ["governance-model", "raci-matrix", "narrative", "stakeholder"],
      typicalDurationWeeks: { min: 2, max: 4 },
      inputFields: [
        {
          // Canonical roster address (id `coreTeamRoster`, resolved by findRosterGrid):
          // every later phase's owner/lead fields resolve their named individual from
          // this grid rather than being re-typed. Required so the roster-owner guardrail
          // always has a populated source.
          id: "coreTeamRoster",
          label: "Core team roster",
          type: "grid",
          required: true,
          hint: "Name the individual filling each core team role — this is the single source every downstream owner/lead resolves against.",
          // usedByArtifacts mirrors the artifactInputFlow targets below; the fact
          // graph grounds each roster row into these artifacts via field.usedByArtifacts.
          usedByArtifacts: ["raci-matrix", "governance-model"],
          columns: [
            { key: "role", label: "Core team role", type: "text" },
            { key: "name", label: "Named individual", type: "text" },
            { key: "org", label: "Organisation / team", type: "text" },
            { key: "allocation", label: "Allocation %", type: "text", width: 120 },
          ],
        },
        {
          id: "governanceCadence",
          label: "Governance cadence & decision bodies",
          type: "textarea",
          required: true,
          usedByArtifacts: ["governance-model"],
          placeholder: "Decision forums, who sits on them, how often they meet, and the escalation path",
          hint: "e.g. Weekly delivery stand-up, fortnightly SteerCo (sponsor + workstream leads), exceptions escalate to the sponsor within 48h",
        },
      ],
      artifactInputFlow: {
        // RACI maps each activity to an accountable role, so it is grounded entirely by
        // the roster. The governance model synthesises decision bodies and escalation
        // from the cadence plus who staffs the forums (the roster).
        "raci-matrix": ["coreTeamRoster"],
        "governance-model": ["coreTeamRoster", "governanceCadence"],
      },
    },
    {
      id: "discover",
      displayName: "Discover",
      description: "Establish current state, scope, and discovery findings.",
      requiredArtifacts: [],
      // Discover seeds the discovery facts its agents synthesise (current state,
      // scope boundaries, and the stakeholder map) as static methodology inputs,
      // so scope/requirements/stakeholder generation never depends on the planner
      // remembering to ask for them. dynamicSchema stays true: the planner may
      // still ADD programme-specific fields on top; static wins on id collision,
      // so a planner-emitted free-text stakeholder field is upgraded to the grid.
      dynamicSchema: true,
      mandatoryExitCriteriaTemplates: [
        "Current state documented",
        "In-scope and out-of-scope items agreed",
        "Key stakeholders identified and mapped",
      ],
      entryGuards: ["Mobilise gate approved"],
      recommendedAgents: ["requirements-catalog", "narrative", "stakeholder", "milestone"],
      typicalDurationWeeks: { min: 3, max: 8 },
      inputFields: [
        { id: "currentStateSummary", label: "Current state summary & key pain points", type: "textarea", required: true, placeholder: "How things work today and the problems driving this programme", hint: "Today's processes, systems, and the pain points the programme must resolve" },
        {
          id: "scopeInclusions",
          label: "In-scope processes, systems & geographies",
          type: "grid",
          required: true,
          hint: "List each in-scope element on its own row and tag what kind it is — one item per row keeps the scope boundary explicit.",
          columns: [
            { key: "item", label: "In-scope element", type: "text" },
            { key: "category", label: "Type (process / system / geography)", type: "text" },
          ],
        },
        {
          id: "scopeExclusions",
          label: "Out-of-scope processes, systems & geographies",
          type: "grid",
          required: true,
          hint: "List each explicit exclusion on its own row — naming what the programme will NOT cover protects the boundary against scope creep.",
          columns: [
            { key: "item", label: "Out-of-scope element", type: "text" },
            { key: "category", label: "Type (process / system / geography)", type: "text" },
          ],
        },
        {
          id: "stakeholderList",
          label: "Key stakeholders",
          type: "grid",
          required: true,
          hint: "Capture the people the programme serves and must keep aligned, with their influence and interest.",
          columns: [
            { key: "name", label: "Name", type: "text" },
            { key: "role", label: "Role / title", type: "text" },
            { key: "influence", label: "Influence", type: "text" },
            { key: "interest", label: "Interest", type: "text" },
          ],
        },
      ],
      artifactInputFlow: {
        "scope-map": ["currentStateSummary", "scopeInclusions", "scopeExclusions", "stakeholderList"],
        "requirements-catalog": ["currentStateSummary", "scopeInclusions", "stakeholderList"],
        "stakeholder-map": ["stakeholderList"],
      },
    },
    {
      id: "design",
      displayName: "Design",
      description: "Produce the solution design, architecture decisions, and delivery plan.",
      requiredArtifacts: [],
      // Design seeds the solution-design facts its agents need (approach, target
      // architecture, NFRs, decisions, constraints) as static methodology inputs,
      // so generation never depends on the planner remembering to ask for them.
      // dynamicSchema stays true: the planner may still ADD programme-specific
      // fields on top (e.g. a model-routing policy), and the roster-owner guardrail
      // drops any "Named <role>" staffing fields — owners resolve from the Mobilise
      // roster, never re-typed here.
      dynamicSchema: true,
      mandatoryExitCriteriaTemplates: [
        "Solution design approved by architecture review",
        "Key architecture decisions recorded",
        "Critical path established",
      ],
      entryGuards: ["Discover gate approved"],
      recommendedAgents: ["future-state-design", "target-operating-model", "solution-architecture", "narrative", "change-impact"],
      typicalDurationWeeks: { min: 4, max: 10 },
      inputFields: [
        { id: "solutionApproach", label: "Solution approach & design principles", type: "textarea", required: true, placeholder: "Overall approach and the guiding principles the design must honour", hint: "e.g. API-first, reuse the existing identity platform, buy-over-build for non-differentiating capabilities" },
        { id: "targetArchitecture", label: "Target architecture summary", type: "textarea", required: true, placeholder: "Key components, platforms, and how they integrate", hint: "Major systems, data stores, and integration topology at a glance" },
        {
          id: "keyDesignDecisions",
          label: "Key design decisions",
          type: "grid",
          required: false,
          hint: "Record each significant decision, the options weighed, and why you chose as you did.",
          columns: [
            { key: "decision", label: "Decision", type: "text" },
            { key: "optionsConsidered", label: "Options considered", type: "text" },
            { key: "rationale", label: "Rationale", type: "text" },
          ],
        },
        { id: "nonFunctionalRequirements", label: "Non-functional requirements", type: "textarea", required: true, placeholder: "Performance, security, scalability, availability, and compliance targets", hint: "e.g. 99.9% availability, sub-200ms p95 latency, SOC 2 controls" },
        { id: "integrationDataConstraints", label: "Integration & data constraints", type: "textarea", required: false, placeholder: "Systems to integrate, data migration scope, and known dependencies", hint: "Upstream/downstream systems, migration volumes, and sequencing constraints" },
      ],
      artifactInputFlow: {
        "solution-architecture": ["solutionApproach", "targetArchitecture", "nonFunctionalRequirements", "integrationDataConstraints", "keyDesignDecisions"],
        "future-state-design": ["solutionApproach", "targetArchitecture", "keyDesignDecisions"],
        "target-operating-model": ["solutionApproach"],
        "critical-path": ["solutionApproach", "integrationDataConstraints"],
        "change-impact": ["solutionApproach"],
      },
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
      recommendedAgents: ["test-plan", "narrative", "milestone"],
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
      recommendedAgents: ["narrative", "adoption"],
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
      recommendedAgents: ["optimization-backlog", "narrative", "benefits-tracker"],
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
      recommendedAgents: ["narrative", "benefits-tracker"],
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
