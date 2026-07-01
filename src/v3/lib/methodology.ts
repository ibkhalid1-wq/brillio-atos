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
      // The critical path is a CONTRACT artifact: downstream models (the Digital
      // Twin phase spine + bottleneck rail, schedule projections) read the
      // structured `data.criticalPath` it produces, and "Critical path established"
      // is already a mandatory Design exit criterion. Declaring it here guarantees
      // every programme produces it, rather than leaving it to the planner's
      // discretion as a dynamic artifact. dynamicArtifactDefs drops the dynamic
      // duplicate so the merged required set never double-counts it.
      requiredArtifacts: ["critical-path"],
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
        // Functional (process/workflow) design — the WHAT, distinct from the
        // technical HOW captured by targetArchitecture. Without this field the
        // document extractor had no target for a functional/workflow design doc
        // (it maps only to declared fields), so such documents couldn't be mapped.
        // Feeds future-state-design (futureCapabilities/processChanges) and the
        // TOM (coreProcesses). Prose so an imported workflow catalogue summarises
        // cleanly here while the full document stays attached as the source.
        { id: "functionalDesignSummary", label: "Functional design summary", type: "textarea", required: false, placeholder: "Core business processes and workflows the solution must support, and how users/agents move through them", hint: "Summarise the functional/process design — key workflows, use cases, and the roles/agents that act in them. Attach the detailed workflow catalogue as a document and the extractor will summarise it here." },
        { id: "targetArchitecture", label: "Target architecture summary", type: "textarea", required: true, placeholder: "Key components, platforms, and how they integrate", hint: "Major systems, data stores, and integration topology at a glance" },
        {
          id: "keyDesignDecisions",
          label: "Key design decisions",
          type: "grid",
          required: false,
          hint: "The Solution Architecture agent drafts these from your approach and target architecture — review, refine, and add any it missed rather than typing the whole log from scratch.",
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
        "solution-architecture": ["solutionApproach", "functionalDesignSummary", "targetArchitecture", "nonFunctionalRequirements", "integrationDataConstraints", "keyDesignDecisions"],
        "future-state-design": ["solutionApproach", "functionalDesignSummary", "targetArchitecture", "keyDesignDecisions"],
        "target-operating-model": ["solutionApproach", "functionalDesignSummary"],
        "critical-path": ["solutionApproach", "integrationDataConstraints"],
        "change-impact": ["solutionApproach", "functionalDesignSummary"],
      },
    },
    {
      id: "build",
      displayName: "Build",
      description: "Deliver the solution against the agreed design.",
      requiredArtifacts: [],
      // Build seeds the delivery facts its agents synthesise — the increment plan
      // the milestone agent forecasts against, and the test strategy / environments
      // / definition of done the test-plan agent maps requirements to. Seeding them
      // as static inputs means milestone and test-plan generation never depends on
      // the planner remembering to ask for delivery substance. dynamicSchema stays
      // true: the planner may still ADD programme-specific build fields on top
      // (static wins on id collision), and any "Named <role>" staffing field is
      // dropped by the roster-owner guardrail — owners resolve from the Mobilise
      // roster, never re-typed here.
      dynamicSchema: true,
      mandatoryExitCriteriaTemplates: [
        "All must-have requirements delivered and tested",
        "User acceptance testing passed",
        "Go-live readiness confirmed",
      ],
      entryGuards: ["Design gate approved"],
      recommendedAgents: ["test-plan", "narrative", "milestone"],
      typicalDurationWeeks: { min: 8, max: 26 },
      inputFields: [
        {
          id: "deliveryIncrements",
          label: "Delivery increments & cadence",
          type: "grid",
          required: true,
          hint: "Break delivery into increments (sprints, releases, or workstream waves) with the scope each carries and its target date — this is what milestone forecasting tracks against.",
          usedByArtifacts: ["milestone"],
          columns: [
            { key: "increment", label: "Increment", type: "text", placeholder: "e.g. Release 1 — Pipeline agent" },
            { key: "scope", label: "Scope delivered", type: "text", placeholder: "What ships in this increment" },
            { key: "date", label: "Target date", type: "date", width: 160 },
          ],
        },
        {
          id: "testStrategy",
          label: "Test strategy & coverage targets",
          type: "textarea",
          required: true,
          usedByArtifacts: ["test-plan"],
          placeholder: "Test types in scope, coverage targets, and entry/exit criteria",
          hint: "e.g. Unit + integration + UAT; 80% unit coverage; entry = code-complete, exit = zero P1 defects",
        },
        {
          id: "environmentsRelease",
          label: "Environments & release approach",
          type: "textarea",
          required: true,
          usedByArtifacts: ["test-plan", "milestone"],
          placeholder: "Environment path to production and how releases are cut and promoted",
          hint: "e.g. dev → staging → prod; fortnightly release train; blue-green cutover with rollback",
        },
        {
          id: "definitionOfDone",
          label: "Definition of done & quality gates",
          type: "textarea",
          required: false,
          usedByArtifacts: ["test-plan"],
          placeholder: "The bar each increment must clear before it counts as delivered",
          hint: "e.g. Code reviewed, tests green, docs updated, product owner accepted, no open P1/P2 defects",
        },
      ],
      artifactInputFlow: {
        // The test plan maps the test strategy, environments and definition of done
        // into test types, criteria and cases; milestone forecasting is grounded on
        // the increment plan bounded by the release approach.
        "test-plan": ["testStrategy", "environmentsRelease", "definitionOfDone"],
        "milestone": ["deliveryIncrements", "environmentsRelease"],
      },
    },
    {
      id: "operate",
      displayName: "Operate",
      description: "Transition to live operation with appropriate support.",
      requiredArtifacts: [],
      // Operate seeds the go-live / support / adoption facts its agents synthesise
      // as static methodology inputs, so support-model, runbook and adoption
      // generation never depends on the planner remembering to ask. Promoted from
      // the generic dynamic fields the planner was emitting per programme; landed
      // as required:false so tightening the gate is a deliberate later step
      // (runPreFlight fails a phase on any blank required field, which would
      // retroactively regress a programme already in Operate). dynamicSchema stays
      // true: the planner may still ADD programme-specific fields; static wins on
      // id collision, and "Named <role>" owner fields resolve from the Mobilise
      // roster rather than being re-captured here.
      //
      // Each artifactInputFlow target is a *renderable, fall-through* Operate agent
      // whose prompt the edge grounds from these inputs (kept in sync with the edge
      // ARTIFACT_INPUT_FLOW). health-heatmap is deliberately NOT wired: its edge
      // branch grades programme health from the phase/gate state and strategy KPIs,
      // not from a manually-entered adoption baseline, so gating it on these inputs
      // would be a flow with no real consumer.
      dynamicSchema: true,
      mandatoryExitCriteriaTemplates: [
        "Live operation stable for agreed hyper-care period",
        "Support model handed to operations",
        "Adoption metrics baseline established",
      ],
      entryGuards: ["Build gate approved"],
      recommendedAgents: ["runbook", "support-model", "narrative", "adoption", "health-heatmap"],
      typicalDurationWeeks: { min: 4, max: 12 },
      inputFields: [
        { id: "goLiveDate", label: "Go-live date", type: "date", required: false, hint: "Actual (or planned) production cutover date — anchors the hyper-care window and adoption baseline." },
        { id: "hyperCarePeriod", label: "Hyper-care period", type: "text", required: false, placeholder: "e.g. 4 weeks post go-live", hint: "How long heightened support runs before steady-state operations take over." },
        { id: "supportModel", label: "Support model & handover", type: "textarea", required: false, usedByArtifacts: ["support-model", "runbook"], placeholder: "Support tiers, ownership, SLAs, and how support is handed to operations", hint: "e.g. L1 service desk, L2 product team, L3 vendor; P1 response 30m; handover to Ops at end of hyper-care." },
        {
          id: "adoptionBaseline",
          label: "Adoption metrics baseline",
          type: "grid",
          required: false,
          usedByArtifacts: ["adoption"],
          hint: "The adoption metrics tracked from go-live, with their starting baseline and target — this is what adoption reporting trends against.",
          columns: [
            { key: "metric", label: "Adoption metric", type: "text" },
            { key: "baseline", label: "Baseline at go-live", type: "text" },
            { key: "target", label: "Target", type: "text" },
          ],
        },
      ],
      artifactInputFlow: {
        "support-model": ["supportModel", "hyperCarePeriod"],
        "runbook": ["supportModel"],
        "adoption": ["adoptionBaseline", "goLiveDate"],
      },
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
      // Optimize seeds the two facts the optimisation backlog ranks against — the
      // current performance baseline and the known improvement candidates — as
      // static methodology inputs, so the backlog is grounded on real numbers and
      // real pain points rather than the planner remembering to ask. Landed
      // required:false for the same gate-safety reason as Operate; dynamicSchema
      // stays true for programme-specific additions (static wins on id collision).
      //
      // Only optimization-backlog is wired: it is the one renderable, fall-through
      // Optimize agent these inputs ground (kept in sync with the edge
      // ARTIFACT_INPUT_FLOW). narrative is program-level (dropped from every phase
      // artifact set) and benefits-tracker already receives the full phaseInputs
      // blob in its own edge branch, so neither needs a phase-chip flow here.
      dynamicSchema: true,
      mandatoryExitCriteriaTemplates: [
        "Optimisation opportunities identified and prioritised",
        "At least one improvement cycle completed",
      ],
      entryGuards: ["Govern gate approved"],
      recommendedAgents: ["optimization-backlog", "narrative", "benefits-tracker"],
      typicalDurationWeeks: { min: 4, max: 12 },
      inputFields: [
        {
          id: "optimisationBaseline",
          label: "Performance baseline",
          type: "grid",
          required: false,
          usedByArtifacts: ["optimization-backlog"],
          hint: "The current performance metrics the improvement backlog prioritises against — each with where it stands now and the target you're driving toward.",
          columns: [
            { key: "metric", label: "Metric", type: "text" },
            { key: "current", label: "Current", type: "text" },
            { key: "target", label: "Target", type: "text" },
          ],
        },
        { id: "improvementCandidates", label: "Improvement candidates", type: "textarea", required: false, usedByArtifacts: ["optimization-backlog"], placeholder: "Known pain points, inefficiencies, or opportunities to seed the backlog", hint: "The raw opportunities the backlog ranks by value vs effort — captured here so real signals seed it rather than a cold start." },
      ],
      artifactInputFlow: {
        "optimization-backlog": ["optimisationBaseline", "improvementCandidates"],
      },
    },
    {
      id: "valuerealize",
      displayName: "Value Realize",
      description: "Formally measure and document benefits realisation.",
      requiredArtifacts: [],
      // Value Realize seeds the closure facts its agents synthesise — realised
      // benefits measured against baseline, lessons learned, and sponsor closure
      // sign-off — as static methodology inputs, so closure never depends on the
      // planner remembering to ask. Landed as required:false for the same
      // gate-safety reason as Operate; dynamicSchema stays true for programme-
      // specific additions (static wins on id collision).
      //
      // Only benefits-tracker is in artifactInputFlow because it is the only
      // *renderable* Value Realize phase deliverable. The closure narrative is a
      // program-level briefing (dropped from every phase's artifact set), so a
      // "narrative" flow target would dangle with no chip to anchor or gate. The
      // narrative agent already receives the full phaseInputs blob at generation,
      // so lessonsLearned / closureApproval reach it without a phase-chip edge;
      // they are retained as inputs (documented via usedByArtifacts, and mirroring
      // the mandatory closure exit criteria) rather than dropped.
      dynamicSchema: true,
      mandatoryExitCriteriaTemplates: [
        "Benefits measured against baseline",
        "Final lessons learned documented",
        "Programme closure approved by sponsor",
      ],
      entryGuards: ["Optimize gate approved"],
      recommendedAgents: ["narrative", "benefits-tracker"],
      typicalDurationWeeks: { min: 2, max: 8 },
      inputFields: [
        {
          id: "realisedBenefits",
          label: "Realised benefits vs baseline",
          type: "grid",
          required: false,
          usedByArtifacts: ["benefits-tracker"],
          hint: "Each target benefit with its baseline, target, and the actual value measured at closure — this is what benefits realisation is scored against.",
          columns: [
            { key: "benefit", label: "Benefit", type: "text" },
            { key: "baseline", label: "Baseline", type: "text" },
            { key: "target", label: "Target", type: "text" },
            { key: "actual", label: "Actual at closure", type: "text" },
          ],
        },
        { id: "lessonsLearned", label: "Lessons learned", type: "textarea", required: false, usedByArtifacts: ["narrative"], placeholder: "What worked, what didn't, and what to carry into the next programme", hint: "The retrospective that closes the programme — feeds the closure narrative." },
        { id: "closureApproval", label: "Sponsor closure sign-off", type: "select", required: false, usedByArtifacts: ["narrative"], options: ["Yes", "No"], hint: "Has the executive sponsor formally approved programme closure? Mirrors the mandatory closure exit criterion." },
      ],
      artifactInputFlow: {
        "benefits-tracker": ["realisedBenefits"],
      },
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
