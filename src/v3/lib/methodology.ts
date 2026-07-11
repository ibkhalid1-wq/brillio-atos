import type { ArchetypeDefinition } from "@/v3/types";
import { getMandatoryCriteria } from "@/v3/lib/exitCriteriaLibrary";

export type MethodologyVariant = "atos-standard" | "atos-lite" | "atos-regulated" | "atos-flow";

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
 * The semantic ROLE a field's fact plays in the programme — orthogonal to its
 * `type` (which is the editor shape). Type answers "how is it entered"; role
 * answers "what kind of fact is it". Roles make the phase spine self-describing:
 * a governance exit criterion can be matched to the fields that carry its
 * evidence by role rather than by fuzzy word overlap, and guidance can cite the
 * exact field a fact belongs in instead of an unnamed "relevant input".
 *   • mandate            → who authorises / owns the programme (the sponsor)
 *   • measure            → a KPI, success metric or quantified benefit
 *   • cost               → a budget / cost figure or its approval
 *   • constraint         → a hard boundary the solution must respect
 *   • governance-signoff → an approval, sign-off or confirmation (date / reference)
 *   • risk               → a risk or assumption to track
 */
export type FieldRole =
  | "mandate"
  | "measure"
  | "cost"
  | "constraint"
  | "governance-signoff"
  | "risk";

/**
 * A single phase-input field captured on the phase screen. The methodology owns
 * the field definitions so the input schema, the UI, and the artifact prompts
 * all read one source of truth — never a hard-coded list in a component.
 */
export interface PhaseInputField {
  id: string;
  label: string;
  /**
   * Input shape. The first six are the primitive editors. The rest are
   * *semantic reference* types — they still persist as a plain string, but the
   * UI renders a context-aware picker (a datalist sourced from the programme's
   * roster, organisations, uploaded documents or generated artifacts) so the
   * captured fact is a real, resolvable reference rather than free text:
   *   • stakeholder         → a named person (roster / stakeholder map)
   *   • organization        → a named org, vendor or department (client + orgs)
   *   • document            → an uploaded source document
   *   • artifact-reference  → a generated artifact in this programme
   *   • transcript          → a recorded conversation (ATOS Flow's primary
   *     evidence): either a document reference OR the pasted transcript text
   *     itself — pasted text persists as the field value and flows verbatim
   *     into generation grounding, so evidence needs no upload round-trip.
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
    | "artifact-reference"
    | "transcript";
  /**
   * The semantic role this field's fact plays (see `FieldRole`). Orthogonal to
   * `type`: it lets the spine match a governance exit criterion to the fields
   * that carry its evidence by MEANING rather than word overlap, and lets
   * guidance name the exact field a fact belongs in. Optional — untagged fields
   * are treated as plain planning inputs with no governance role.
   */
  role?: FieldRole;
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
  /**
   * Required-ness ratchet (ISO date). When set on a `required` field, the field
   * only hard-gates programmes created on/after this cutoff — programmes started
   * earlier (or with no recorded creation date) treat it as optional. This lets a
   * new mandatory input be introduced without retroactively blocking in-flight
   * programmes that never had a chance to capture it. Resolved by
   * `isFieldRequiredForProgram`. No effect on an optional field.
   */
  requiredSince?: string;
}

// Industry options surfaced on the Strategy phase. Lives in the methodology so
// the field definition and its prompt flow stay co-located.
/**
 * Value-chain segments for the industries whose grounding genuinely forks —
 * the qualifier sharpens vocabulary steering and discovery scope. Optional
 * everywhere: when unset, the generators infer the segment from evidence.
 * Industries not listed here have one grounding; asking would be paperwork.
 */
export const INDUSTRY_SEGMENTS: Record<string, string[]> = {
  "Life Sciences & Pharma": ["Clinical", "Manufacturing & Supply", "Commercial"],
  "Banking": ["Retail Banking", "Capital Markets", "Payments"],
  "Energy & Utilities": ["Grid Operations", "Generation", "Energy Retail"],
  "Public Sector & Government": ["Citizen Services", "Organisation & Governance"],
  "Automotive": ["Product & Supply Chain", "Dealer & Commerce"],
};

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

/**
 * ATOS Flow movement metadata — the human/machine split of a movement. Where a
 * stage-gate phase describes work the TEAM performs, a Flow movement describes
 * the few conversations humans have and the generation ATOS runs between them.
 * Rendered by the Flow pipeline surfaces; absent on stage-gate phases.
 */
export interface FlowMovement {
  /** The only human acts in the movement — everything between them is generated. */
  humanMoments: string[];
  /** What ATOS generates during the movement (the automation surface). */
  automations: string[];
  /** Plain-language readiness signal — under Flow the gate is a demonstration, not a document. */
  readyWhen: string;
  /** True for the standing loop (Evolve): it never exits, it keeps running. */
  isLoop?: boolean;
}

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
  /**
   * ATOS Flow only: the movement's human/machine split and readiness signal.
   * Stage-gate phases omit it; Flow surfaces render it (human moments, the
   * automation surface, the "ready when" demonstration, the Evolve loop marker).
   */
  movement?: FlowMovement;
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
      // Kept in sync with EXIT_CRITERIA_LIBRARY (strategy-1..3) so the inline
      // fallback matches what the load-time reconciliation below derives. The
      // budget gate is a Mobilise concern (mobilise-4 "Budget baseline
      // confirmed"), not a Strategy exit criterion, so it is intentionally not
      // listed here.
      mandatoryExitCriteriaTemplates: [
        "Business case approved",
        "Objectives defined and measurable",
        "Sponsor confirmed and committed",
      ],
      entryGuards: ["Programme created", "Sponsor identified"],
      recommendedAgents: ["charter", "business-case", "outcome-framework", "narrative"],
      typicalDurationWeeks: { min: 2, max: 6 },
      inputFields: [
        { id: "businessObjective", label: "Business objective", type: "textarea", placeholder: "What outcome is this programme trying to achieve?", required: true, example: "Reduce cost-to-serve by 20% within 18 months by consolidating three regional service desks onto one platform.", validationRule: "A measurable outcome, not an activity — name the change, the magnitude, and the horizon." },
        { id: "sponsor", label: "Executive sponsor", type: "text", role: "mandate", placeholder: "Name and title", required: true, example: "Jane Okafor, Chief Operating Officer", validationRule: "A named individual with their role, not a team or department." },
        { id: "industry", label: "Industry", type: "select", options: INDUSTRY_OPTIONS, required: true, hint: "The client's primary sector. Sets the regulatory backdrop, benchmark cost/benefit norms, and sector language the charter and business case are written in." },
        { id: "startDate", label: "Programme start date", type: "date", required: true, validationRule: "The programme kickoff date." },
        { id: "targetEndDate", label: "Target end date", type: "date", required: true, validationRule: "Must fall after the programme start date." },
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
          role: "cost",
          required: true,
          hint: "Break the estimated programme cost into line items — e.g. vendor licences, core team, infrastructure — with the estimate and the basis for each.",
          validationRule: "Every cost line needs a quantified estimate and the basis for it — a line with a blank Estimate is not a grounded cost assumption and the business case can't be costed from it.",
          columns: [
            { key: "category", label: "Cost line", type: "text", placeholder: "e.g. Vendor licences" },
            { key: "amount", label: "Estimate", type: "text", width: 140, placeholder: "e.g. $1.2M" },
            { key: "basis", label: "Basis / assumption", type: "text", placeholder: "What the estimate is based on" },
          ],
        },
        // The headline funding figure the business case seeks approval for. The
        // costAssumption grid holds the itemised cost BREAKDOWN, but a business case
        // also states a single INVESTMENT ASK — the total the sponsor is being asked
        // to approve (often the costed sum plus contingency, and the figure SteerCo
        // signs against). No field held it, so the business-case artifact reviewer
        // kept recommending "enter the investment ask" with no input to point at.
        // Optional so it never retroactively gates an in-flight Strategy gate; wired
        // into the business-case input flow below so it grounds generation and the
        // artifact goes stale when the ask changes.
        { id: "investmentAsk", label: "Investment ask", type: "text", role: "cost", required: false, usedByArtifacts: ["business-case"], placeholder: "Total funding requested, e.g. $2.4M over 18 months", hint: "The single headline funding figure the business case seeks approval for — the total investment ask, distinct from the itemised cost breakdown above. This is what SteerCo signs against.", example: "$2.4M capital over 18 months, funded from the FY26 transformation budget" },
        { id: "constraints", label: "Key constraints", type: "textarea", role: "constraint", placeholder: "Budget, timeline, regulatory, or technical constraints", required: true, hint: "e.g. Must go live before Q4 financial year end", example: "Must go live before Q4 FY-end; no additional headcount; core-banking change freeze in December.", validationRule: "The hard boundaries the solution must respect — budget, timeline, regulatory, or technical." },
        { id: "successMetric", label: "Primary success metric", type: "text", role: "measure", placeholder: "KPI name, e.g. Cost to serve", required: true, example: "Cost to serve per transaction", validationRule: "A single measurable KPI name — its baseline and target are captured in the Success KPIs grid." },
        {
          // KPIs captured as a structured grid — each with a baseline and target —
          // so the objective's `measured-by` chain has verifiable measures, not a
          // lone metric name. The Program Graph already reads phaseInputs.strategy.kpis
          // (strategyKpiRaw → parseKpiRows) into KPI nodes; declaring the field here is
          // what lets users finally populate that existing consumer. A KPI missing a
          // baseline or target is flagged "weak" by the objective graph's measured-by
          // edge, so these two columns turn the validator's weak-KPI check from a
          // semantic inference into a structural fact. Optional: making it required
          // would retroactively fail every existing programme's Strategy gate (none
          // carry kpis yet); the required `successMetric` stays the headline measure.
          // Grid rows flatten into the strategy artifact prompts via the edge's
          // buildGroundingFacts, so the KPIs inform charter/business-case/outcome
          // automatically; wired into outcome-framework's input flow below for the
          // visual flow + staleness (optional flow inputs never block generation).
          id: "kpis",
          label: "Success KPIs",
          type: "grid",
          role: "measure",
          // Ratcheted required: a programme's objective must carry at least one
          // measurable KPI (baseline + target) to prove attainment. requiredSince
          // scopes this to programmes created on/after the cutoff, so no in-flight
          // programme (none of which carry kpis yet) is retroactively gated — the
          // exact problem that kept this optional before the ratchet existed.
          required: true,
          requiredSince: "2026-07-02",
          hint: "The measurable KPIs that prove the objective — each with its baseline (where it stands today) and its target. A KPI without both can't verify attainment.",
          usedByArtifacts: ["outcome-framework"],
          columns: [
            { key: "name", label: "KPI", type: "text", placeholder: "e.g. Cost to serve" },
            { key: "baseline", label: "Baseline", type: "text", width: 140, placeholder: "Where it stands today" },
            { key: "target", label: "Target", type: "text", width: 140, placeholder: "The goal" },
            { key: "unit", label: "Unit", type: "text", width: 120, placeholder: "e.g. $, %, days" },
          ],
        },
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
        // ── Governance evidence (sign-off tier) ──────────────────────────────
        // These two fields prove Strategy exit criteria rather than shaping the
        // programme's substance, so they sit at the end of the panel — the user
        // provides them once the mandate above is settled. Both optional (never
        // retroactively gate an in-flight Strategy); flow into their artifacts via
        // buildGroundingFacts.
        //
        // Backs "Sponsor confirmed and committed" — the `sponsor` field captures
        // WHO, this captures WHEN they signed off (evidencePrompt: "date of sign-off").
        { id: "sponsorSignOffDate", label: "Sponsor sign-off date", type: "date", role: "governance-signoff", required: false, usedByArtifacts: ["charter"], hint: "The date the executive sponsor formally signed off the programme mandate. Backs the Strategy exit criterion \"Sponsor confirmed and committed\" (evidence: date of sign-off).", example: "2026-04-20" },
        // Backs "Business case approved" (evidencePrompt: "link or reference to the
        // approved business case document") — a fact the cost grid can't hold.
        { id: "businessCaseApproval", label: "Business case approval reference", type: "text", role: "governance-signoff", required: false, usedByArtifacts: ["business-case"], placeholder: "Link or reference to the approved business case", hint: "A link or document reference showing the business case has been formally approved. Backs the Strategy exit criterion \"Business case approved\".", example: "SteerCo minutes 2026-04-18, item 4" },
      ],
      artifactInputFlow: {
        // The roadmap is sequenced from the whole strategy picture — objective,
        // sponsor, industry, constraints, cost, and the primary success metric —
        // bounded by the programme start/end dates. So every strategy input
        // feeds it: all must be present to generate, and any change stales it.
        "strategic-roadmap": ["businessObjective", "sponsor", "industry", "startDate", "targetEndDate", "costAssumption", "constraints", "successMetric", "validationApproach"],
        "charter": ["industry", "startDate", "targetEndDate"],
        "business-case": ["industry", "costAssumption", "investmentAsk"],
        // The validation/de-risking ladder shapes how outcomes are sequenced and
        // proven, so it feeds the outcome framework and the roadmap. It is
        // optional, so the generation gate (StageView) treats unfilled optional
        // flow inputs as non-blocking — the edge wires the visual flow + staleness
        // without locking generation on an appetite-level field.
        "outcome-framework": ["successMetric", "kpis", "validationApproach"],
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
      recommendedAgents: ["governance-model", "raci-matrix", "risk", "narrative", "stakeholder"],
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
          // A roster row with no allocation reads as "someone owns this role" but says
          // nothing about how much of them the programme actually has — a 10%-allocated
          // lead and a full-time lead are different capacity facts the governance model
          // and ramp plan depend on. Advisory (like the Strategy cost grid): a blank
          // Allocation is an ungrounded staffing line, not a hard save-block.
          validationRule: "Every named individual needs an explicit Allocation % — a blank allocation hides whether the role is full-time or a fractional commitment, which the capacity and ramp plans can't be built from.",
          columns: [
            { key: "role", label: "Core team role", type: "text" },
            { key: "name", label: "Named individual", type: "text" },
            { key: "org", label: "Organisation / team", type: "text" },
            { key: "allocation", label: "Allocation %", type: "text", width: 120 },
            // Ramp timing: when each member actually joins. Owner resolution keys on
            // name, so this column is additive grounding for the mobilisation/ramp plan
            // (a role staffed from week 6 is not the same fact as one staffed at kickoff).
            { key: "startDate", label: "Start date", type: "date", width: 130 },
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
        // Seed the risks-and-assumptions log — the third Mobilise mandatory exit
        // criterion. Unlike the roster/cadence (which ground the RACI and governance
        // *phase* documents), the `risk` agent is PROGRAM-LEVEL: it writes the shared
        // programme RAID log (applyRiskResultToProgramData), never a phaseArtifacts
        // stub, so — exactly like `narrative` in Value Realize — it has no renderable
        // phase-chip artifact to draw a flow edge to. These two inputs are therefore
        // retained as grounding captured on the phase with their consumer recorded via
        // usedByArtifacts, and delivered to the program-level risk agent through the
        // edge ARTIFACT_INPUT_FLOW ("risk": [...]) — NOT wired into artifactInputFlow
        // below (that would dangle on a non-rendering target). required:false so
        // seeding the log never retroactively fails a programme already in Mobilise.
        {
          id: "initialRisks",
          label: "Initial programme risks",
          type: "grid",
          role: "risk",
          required: false,
          hint: "Seed the known risks now so the Risk agent starts from the team's own view rather than a cold scan — one risk per row with its impact, likelihood and mitigation.",
          usedByArtifacts: ["risk"],
          columns: [
            { key: "risk", label: "Risk", type: "text" },
            { key: "impact", label: "Impact", type: "text" },
            { key: "likelihood", label: "Likelihood", type: "text" },
            { key: "mitigation", label: "Mitigation", type: "text" },
          ],
        },
        {
          id: "initialAssumptions",
          label: "Key assumptions to validate",
          type: "grid",
          role: "risk",
          required: false,
          hint: "Capture the beliefs the programme is built on and how each will be proven — unvalidated assumptions are the risks the RAID log must track.",
          usedByArtifacts: ["risk"],
          columns: [
            { key: "assumption", label: "Assumption", type: "text" },
            { key: "validation", label: "How / when validated", type: "text" },
          ],
        },
        // ── Governance evidence (sign-off tier) ──────────────────────────────
        // Backs the "Budget baseline confirmed" exit criterion (evidencePrompt: a
        // "budget approval reference"). The Strategy cost grid holds the ESTIMATE;
        // this records that a baseline was ALLOCATED and APPROVED. Placed at the end
        // as an attestation of the substantive team/governance/RAID work above.
        // Optional (never retroactively gates an in-flight Mobilise); grounded into
        // the phase artifact prompts via the edge's buildGroundingFacts.
        { id: "budgetBaselineApproval", label: "Budget baseline approval reference", type: "text", role: "governance-signoff", required: false, usedByArtifacts: ["governance-model"], placeholder: "Link or reference to the approved budget baseline", hint: "A link or reference confirming the programme budget baseline has been allocated and approved. Backs the Mobilise exit criterion \"Budget baseline confirmed\".", example: "FY26 budget board approval BR-1183" },
      ],
      artifactInputFlow: {
        // RACI maps each activity to an accountable role, so it is grounded entirely by
        // the roster. The governance model synthesises decision bodies and escalation
        // from the cadence plus who staffs the forums (the roster). The risks-and-
        // assumptions log is deliberately absent: `risk` is a program-level RAID agent
        // (no phase-chip artifact), grounded via the edge flow, not a phase edge here.
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
        // Baseline numbers behind the current-state prose. The summary narrates the
        // pain; this grid quantifies it, so "current state documented" carries a
        // measurable starting point the Value Realize benefit variance is later scored
        // against (a benefit with no baseline can only be asserted, not measured).
        // Optional grounding wired into scope-map/requirements-catalog (optional flow
        // inputs never block generation).
        {
          id: "currentStateMetrics",
          label: "Current-state baseline metrics",
          type: "grid",
          role: "measure",
          required: false,
          hint: "Quantify today's performance on the dimensions the programme aims to move — one metric per row with its current value and unit. These are the baselines benefits are later measured against.",
          usedByArtifacts: ["scope-map", "requirements-catalog"],
          columns: [
            { key: "metric", label: "Metric", type: "text", placeholder: "e.g. Order-to-cash cycle time" },
            { key: "current", label: "Current value", type: "text", width: 140 },
            { key: "unit", label: "Unit", type: "text", width: 120, placeholder: "days / % / $" },
          ],
        },
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
            // Evidence for the "Key stakeholders identified and mapped" exit criterion:
            // a name on the list proves identification, but only an engagement status
            // proves they have actually been reached and aligned. The stakeholder-map
            // agent reads this to prioritise who still needs an interview.
            { key: "engagementStatus", label: "Engagement status", type: "select", width: 170, options: ["Not started", "Identified", "Contacted", "Interviewed", "Aligned"] },
          ],
        },
        {
          // Requirements captured as a structured grid so each is a first-class,
          // citable requirement rather than prose buried in the current-state
          // summary. The Program Graph mints one `requirement` node per row (stable
          // ids carried on the rows), which the objective graph's satisfied-by
          // chain and the cross-artifact validator attach design coverage to — so a
          // requirement with no covering design is a structural gap, not a semantic
          // inference. Required via the requiredSince ratchet rather than an outright
          // flag: a bare `required:true` would retroactively fail every existing
          // programme's Discover gate (none carry requirements yet), so it counts as a
          // gap only for programmes created on/after the cutoff — design needs traceable
          // inputs and a post-cutoff Discover with no captured requirements is genuinely
          // incomplete. The requirements-catalog agent drafts these from current state +
          // scope; the grid rows flatten into its prompt via the edge's buildGroundingFacts,
          // so they inform generation automatically. Wired into requirements-catalog's
          // input flow for the visual flow + staleness.
          id: "requirements",
          label: "Requirements",
          type: "grid",
          required: true,
          requiredSince: "2026-07-02",
          hint: "The functional and non-functional needs the solution must satisfy — one per row, with its type and priority. Each becomes a tracked requirement the design must cover.",
          usedByArtifacts: ["requirements-catalog"],
          columns: [
            { key: "requirement", label: "Requirement", type: "text", placeholder: "e.g. Single sign-on across all portals" },
            { key: "category", label: "Type", type: "select", width: 160, options: ["Functional", "Non-functional", "Data", "Integration", "Compliance"] },
            { key: "priority", label: "Priority", type: "select", width: 140, options: ["Must", "Should", "Could", "Won't"] },
          ],
        },
      ],
      artifactInputFlow: {
        "scope-map": ["currentStateSummary", "currentStateMetrics", "scopeInclusions", "scopeExclusions", "stakeholderList"],
        "requirements-catalog": ["currentStateSummary", "currentStateMetrics", "scopeInclusions", "stakeholderList", "requirements"],
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
        // Ratcheted required (2026-07-02): the functional design is the WHAT the
        // solution delivers, and a Design with a target architecture but no functional
        // design records only the technical HOW — leaving the TOM and future-state
        // agents ungrounded on process. Ratchet, not a bare flag, so no in-flight
        // programme (which never had this input) is retroactively gated.
        { id: "functionalDesignSummary", label: "Functional design summary", type: "textarea", required: true, requiredSince: "2026-07-02", placeholder: "Core business processes and workflows the solution must support, and how users/agents move through them", hint: "Summarise the functional/process design — key workflows, use cases, and the roles/agents that act in them. Attach the detailed workflow catalogue as a document and the extractor will summarise it here." },
        { id: "targetArchitecture", label: "Target architecture summary", type: "textarea", required: true, placeholder: "Key components, platforms, and how they integrate", hint: "Major systems, data stores, and integration topology at a glance" },
        {
          // Non-functional requirements as a structured grid so each quality
          // attribute is a first-class, measurable requirement rather than prose.
          // Like the Discover requirements grid, the Program Graph mints one
          // `requirement` node per row (category "Non-functional"), so the
          // objective graph's satisfied-by chain treats an NFR with no covering
          // design as a structural gap. Legacy prose migrates non-destructively:
          // StructuredGrid.parseRows line-splits an existing paragraph into rows
          // under the lead `requirement` column on first open, then re-serializes
          // to JSON on save — a self-healing, one-time migration with no data loss,
          // so every programme that authored NFRs as text keeps them. Required
          // (unchanged): a migrated paragraph yields ≥1 row, so the Design gate is
          // satisfied exactly as before. The `requirement` column key matches the
          // graph's requirement reader; each row also carries the NFR type and its
          // measurable target. Grid rows flatten into solution-architecture prompts
          // via the edge's buildGroundingFacts, so generation is unaffected.
          id: "nonFunctionalRequirements",
          label: "Non-functional requirements",
          type: "grid",
          required: true,
          // Introduced after the NFR grid landed; ratcheted so it only gates
          // programmes created on/after this date. Existing programmes (which never
          // had an NFR input) keep generating their solution architecture without a
          // retroactive block — the grid still flows in and stales when present.
          requiredSince: "2026-07-01",
          hint: "The quality attributes the solution must meet — one per row, with its type and a measurable target. e.g. Availability · 99.9% uptime.",
          columns: [
            { key: "requirement", label: "Requirement", type: "text", placeholder: "e.g. p95 API latency under load" },
            { key: "category", label: "Type", type: "select", width: 170, options: ["Performance", "Security", "Scalability", "Availability", "Compliance", "Usability", "Maintainability"] },
            { key: "target", label: "Target", type: "text", width: 180, placeholder: "e.g. < 200ms p95, 99.9% uptime" },
          ],
        },
        { id: "integrationDataConstraints", label: "Integration & data constraints", type: "textarea", required: false, placeholder: "Systems to integrate, data migration scope, and known dependencies", hint: "Upstream/downstream systems, migration volumes, and sequencing constraints" },
        // The design-decisions log is agent-drafted from the required substance
        // above (approach, functional design, target architecture, NFRs) — so it
        // follows them in the panel: the user reviews and refines a synthesis
        // rather than authoring it cold before the design is stated.
        {
          id: "keyDesignDecisions",
          label: "Key design decisions",
          type: "grid",
          required: false,
          hint: "The Solution Architecture agent drafts these from your approach and target architecture — review, refine, and add any it missed rather than typing the whole log from scratch. Name the requirement(s) each decision addresses so the graph can trace design back to the need it satisfies.",
          columns: [
            { key: "decision", label: "Decision", type: "text" },
            { key: "optionsConsidered", label: "Options considered", type: "text" },
            { key: "rationale", label: "Rationale", type: "text" },
            { key: "addresses", label: "Addresses requirement(s)", type: "text", placeholder: "Requirement text this decision satisfies, comma-separated" },
          ],
        },
        // Governance evidence for the "Solution design approved by architecture review"
        // exit criterion. The design content lives in solution-architecture, but nothing
        // recorded that the review board actually signed it off — so the gate criterion
        // had no backing input. Optional (never retroactively gates an in-flight Design);
        // grounded into the solution-architecture prompt via the edge's buildGroundingFacts.
        { id: "designReviewSignOff", label: "Architecture review sign-off reference", type: "text", role: "governance-signoff", required: false, usedByArtifacts: ["solution-architecture"], placeholder: "Link or reference to the architecture review approval", hint: "A link or reference confirming the solution design was reviewed and approved by the architecture review board. Backs the Design exit criterion \"Solution design approved by architecture review\".", example: "ARB approval ARB-2026-047" },
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
          hint: "Break delivery into increments (sprints, releases, or workstream waves) with the scope each carries and its target date — this is what milestone forecasting tracks against. Name the in-scope item(s) each increment delivers so the graph can trace delivery back to the scope boundary.",
          usedByArtifacts: ["milestone"],
          columns: [
            { key: "increment", label: "Increment", type: "text", placeholder: "e.g. Release 1 — Pipeline agent" },
            { key: "scope", label: "Scope delivered", type: "text", placeholder: "What ships in this increment" },
            { key: "date", label: "Target date", type: "date", width: 160 },
            { key: "delivers", label: "Delivers in-scope item(s)", type: "text", placeholder: "In-scope item(s) this increment delivers, comma-separated" },
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
          // Ratcheted required (2026-07-02): the DoD is the bar every increment is
          // measured against, and a Build with delivery increments but no stated DoD
          // has nothing to check "delivered and tested" against. Ratchet, not a bare
          // flag, so no in-flight Build is retroactively gated on an input it lacked.
          required: true,
          requiredSince: "2026-07-02",
          usedByArtifacts: ["test-plan"],
          placeholder: "The bar each increment must clear before it counts as delivered",
          hint: "e.g. Code reviewed, tests green, docs updated, product owner accepted, no open P1/P2 defects",
        },
        // Evidence for the "User acceptance testing passed" exit criterion. The test
        // STRATEGY states the intended coverage; nothing recorded the RESULT, so the
        // criterion had no backing input — a strategy is a plan, not proof. Optional
        // (never retroactively gates an in-flight Build); grounded into test-plan.
        {
          id: "testResults",
          label: "Test results & coverage evidence",
          type: "grid",
          role: "measure",
          required: false,
          usedByArtifacts: ["test-plan"],
          hint: "Evidence the test strategy was actually met — each coverage/quality measure with its target and the achieved result. Backs the Build exit criterion \"User acceptance testing passed\".",
          columns: [
            { key: "measure", label: "Measure", type: "text", placeholder: "e.g. Unit coverage, UAT pass rate, open P1 defects" },
            { key: "target", label: "Target", type: "text", width: 160 },
            { key: "actual", label: "Actual result", type: "text", width: 160 },
          ],
        },
        // Backing for the "Go-live readiness confirmed" exit criterion. The environments
        // & release textarea describes the PATH to production; this checklist records
        // whether each cutover gate is actually green — the thin grounding the criterion
        // was missing. Optional; grounded into milestone (the cutover-forecasting agent).
        {
          id: "goLiveReadiness",
          label: "Go-live readiness checklist",
          type: "grid",
          required: false,
          usedByArtifacts: ["milestone"],
          hint: "The gates that must be green before cutover — one readiness item per row with its status. Backs the Build exit criterion \"Go-live readiness confirmed\".",
          columns: [
            { key: "item", label: "Readiness item", type: "text", placeholder: "e.g. Cutover plan signed off, rollback tested, migration dry-run passed" },
            { key: "status", label: "Status", type: "select", width: 160, options: ["Not started", "In progress", "Ready", "Blocked"] },
          ],
        },
      ],
      artifactInputFlow: {
        // The test plan maps the test strategy, environments, definition of done and
        // recorded results into test types, criteria and cases; milestone forecasting
        // is grounded on the increment plan bounded by the release approach and the
        // go-live readiness gates.
        "test-plan": ["testStrategy", "environmentsRelease", "definitionOfDone", "testResults"],
        "milestone": ["deliveryIncrements", "environmentsRelease", "goLiveReadiness"],
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
        // goLiveDate + hyperCarePeriod stay optional by design: Operate is a
        // dynamic-only phase for scoring (derivePhaseInputQuality / deriveProgramConfidence
        // treat it as carrying no static required inputs and return null), so promoting a
        // static field to required would flip that invariant for every Operate programme,
        // not just post-cutoff ones. The go-live criterion is instead grounded by the
        // additive hyperCareExit evidence below.
        { id: "goLiveDate", label: "Go-live date", type: "date", required: false, hint: "Actual (or planned) production cutover date — anchors the hyper-care window and adoption baseline." },
        { id: "hyperCarePeriod", label: "Hyper-care period", type: "text", required: false, placeholder: "e.g. 4 weeks post go-live", hint: "How long heightened support runs before steady-state operations take over." },
        { id: "supportModel", label: "Support model & handover", type: "textarea", required: false, usedByArtifacts: ["support-model", "runbook"], placeholder: "Support tiers, ownership, SLAs, and how support is handed to operations", hint: "e.g. L1 service desk, L2 product team, L3 vendor; P1 response 30m; handover to Ops at end of hyper-care." },
        // Structured backing for the "Support model handed to operations" criterion.
        // The supportModel textarea narrates the model; this grid pins the actual tier
        // responsibilities and SLAs so the handover is a checkable contract, not prose.
        {
          id: "supportTiers",
          label: "Support tiers & SLAs",
          type: "grid",
          required: false,
          usedByArtifacts: ["support-model"],
          hint: "One row per support tier with what it owns and its response/resolution SLA — the concrete contract behind the support narrative.",
          columns: [
            { key: "tier", label: "Tier", type: "text", width: 120, placeholder: "e.g. L1 / L2 / L3" },
            { key: "responsibility", label: "Responsibility", type: "text" },
            { key: "sla", label: "SLA", type: "text", width: 200, placeholder: "e.g. P1 response 30m, resolve 4h" },
          ],
        },
        // Evidence for the "Live operation stable for agreed hyper-care period"
        // criterion: proof the window was actually held stable (incidents resolved,
        // stability thresholds met), not just that a period was agreed. Kept next to
        // the support model/tiers it closes out, so the go-live → support → hyper-care
        // narrative stays contiguous. Optional; a programme still inside hyper-care
        // legitimately has no exit evidence yet.
        {
          id: "hyperCareExit",
          label: "Hyper-care exit evidence",
          type: "grid",
          role: "measure",
          required: false,
          usedByArtifacts: ["support-model"],
          hint: "The stability gates that must be met to close hyper-care — each with its threshold and the achieved result. Backs the Operate exit criterion \"Live operation stable for agreed hyper-care period\".",
          columns: [
            { key: "measure", label: "Stability measure", type: "text", placeholder: "e.g. Open P1 incidents, uptime, MTTR" },
            { key: "threshold", label: "Exit threshold", type: "text", width: 160 },
            { key: "actual", label: "Achieved", type: "text", width: 160 },
          ],
        },
        // Adoption is a distinct post-go-live workstream (its own agent), so it
        // follows the support/hyper-care cluster rather than splitting it.
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
        "support-model": ["supportModel", "supportTiers", "hyperCarePeriod", "hyperCareExit"],
        "runbook": ["supportModel"],
        "adoption": ["adoptionBaseline", "goLiveDate"],
      },
    },
    {
      id: "govern",
      displayName: "Govern",
      description: "Establish ongoing governance, compliance, and performance monitoring.",
      requiredArtifacts: [],
      // Govern seeds the regulatory frameworks its compliance check verifies against
      // — the one fact the compliance-checker needs but that was captured nowhere,
      // so the check ran on programType/industry alone. Unlike `risk`/`narrative`,
      // compliance-checker is NOT program-level: applyProgramSupportArtifact writes a
      // real phaseArtifacts stub, so it renders as a phase chip and can anchor a
      // flow edge. Its edge context comes from a DEDICATED branch (not the
      // fall-through ARTIFACT_INPUT_FLOW), so the grounding is synced there — the
      // branch reads this Govern input, falling back to a legacy strategy field.
      // required:false (like every greenfield spine input) so seeding the frameworks
      // never retroactively fails a programme already in Govern; not every programme
      // is regulated, so it stays recommended, never required.
      dynamicSchema: true,
      mandatoryExitCriteriaTemplates: [
        "Governance model operational",
        "Compliance controls verified",
        "Ongoing reporting cadence established",
      ],
      entryGuards: ["Operate gate approved"],
      recommendedAgents: ["compliance-checker", "narrative", "adoption"],
      typicalDurationWeeks: { min: 2, max: 6 },
      inputFields: [
        {
          id: "regulatoryFrameworks",
          label: "Regulatory frameworks in scope",
          type: "grid",
          required: false,
          usedByArtifacts: ["compliance-checker"],
          hint: "Name each regulation or standard the programme must comply with and what it applies to — the compliance check finds gaps against these rather than guessing from the industry.",
          columns: [
            { key: "framework", label: "Framework / regulation", type: "text" },
            { key: "applicability", label: "What it applies to", type: "text" },
          ],
        },
        // Backing for the Govern exit criterion "Control matrix approved" (govern-2,
        // evidencePrompt: "Control matrix reference or governance sign-off"). Frameworks
        // say WHAT must be complied with; this grid pins the operational controls that
        // enforce them — each with an owner, a test status, and its approval — so the
        // compliance check verifies real controls rather than assuming coverage.
        {
          id: "controlMatrix",
          label: "Operational control matrix",
          type: "grid",
          required: false,
          usedByArtifacts: ["compliance-checker"],
          hint: "One row per key operational control: what it does, who owns it, whether it has been tested, and its approval status. Backs the Govern exit criterion \"Control matrix approved\".",
          columns: [
            { key: "control", label: "Control", type: "text" },
            { key: "owner", label: "Owner", type: "text", width: 150 },
            { key: "testStatus", label: "Test status", type: "select", width: 150, options: ["Not tested", "In test", "Passed", "Failed"] },
            { key: "approval", label: "Approval", type: "select", width: 140, options: ["Pending", "Approved", "Rejected"] },
          ],
        },
        // Backing for "Audit evidence plan in place" (govern-3, evidencePrompt: "Audit
        // evidence plan document"). Optional free-text plan for how audit evidence is
        // collected on an ongoing basis — the fact the criterion asks for but that no
        // other Govern input held.
        { id: "auditEvidencePlan", label: "Audit evidence plan", type: "textarea", required: false, usedByArtifacts: ["compliance-checker"], placeholder: "How ongoing audit evidence is collected, by whom, at what cadence, and where it is stored", hint: "The agreed plan for collecting audit evidence over time — backs the Govern exit criterion \"Audit evidence plan in place\"." },
        // Backing for "Escalation policies tested" (govern-4, evidencePrompt: "Escalation
        // test results or confirmation"). A governance sign-off confirming the escalation
        // routes established in Mobilise were actually exercised and confirmed operational
        // in Govern — proof of a test, not just a defined path.
        { id: "escalationTested", label: "Escalation policies tested", type: "select", role: "governance-signoff", required: false, usedByArtifacts: ["compliance-checker"], options: ["Yes", "No"], hint: "Have the escalation routes and decision rights been exercised and confirmed operational? Mirrors the Govern exit criterion \"Escalation policies tested\"." },
      ],
      artifactInputFlow: {
        // compliance-checker renders as a phase chip (setPhaseArtifactValue), so these
        // edges anchor. Delivery to generation is synced in the agent's dedicated
        // edge context branch, not the fall-through ARTIFACT_INPUT_FLOW map. Every
        // Govern static input grounds this one chip (the sole renderable Govern
        // deliverable), keeping the "no dangling inputs" invariant intact.
        "compliance-checker": ["regulatoryFrameworks", "controlMatrix", "auditEvidencePlan", "escalationTested"],
      },
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
          role: "measure",
          required: false,
          usedByArtifacts: ["optimization-backlog"],
          hint: "The current performance metrics the improvement backlog prioritises against — each with where it stands now and the target you're driving toward.",
          columns: [
            { key: "metric", label: "Metric", type: "text" },
            { key: "current", label: "Current", type: "text" },
            { key: "target", label: "Target", type: "text" },
            // Unit makes the current/target numbers comparable and self-describing
            // (%, hrs, $, count) so the backlog ranks like-for-like rather than
            // guessing scale. Additive column — never demotes an already-filled row.
            { key: "unit", label: "Unit", type: "text", width: 100, placeholder: "e.g. %, hrs, $" },
          ],
        },
        { id: "improvementCandidates", label: "Improvement candidates", type: "textarea", required: false, usedByArtifacts: ["optimization-backlog"], placeholder: "Known pain points, inefficiencies, or opportunities to seed the backlog", hint: "The raw opportunities the backlog ranks by value vs effort — captured here so real signals seed it rather than a cold start." },
        // Structured counterpart to the improvementCandidates prose: the same
        // opportunities pinned as ranked rows with explicit value and effort, so
        // "Improvement backlog prioritised" (optimize-2) is a checkable ranking
        // rather than an inference the agent makes from free text. Optional; the
        // textarea remains the low-friction way to seed raw signals.
        {
          id: "improvementBacklog",
          label: "Prioritised improvement backlog",
          type: "grid",
          required: false,
          usedByArtifacts: ["optimization-backlog"],
          hint: "The candidate improvements ranked for delivery: each with its expected business value, the effort to deliver, and a resulting priority. Backs the Optimize exit criterion \"Improvement backlog prioritised\".",
          columns: [
            { key: "opportunity", label: "Opportunity", type: "text" },
            { key: "value", label: "Value", type: "select", width: 120, options: ["Low", "Medium", "High"] },
            { key: "effort", label: "Effort", type: "select", width: 120, options: ["Low", "Medium", "High"] },
            { key: "priority", label: "Priority", type: "select", width: 120, options: ["P1", "P2", "P3"] },
          ],
        },
      ],
      artifactInputFlow: {
        "optimization-backlog": ["optimisationBaseline", "improvementCandidates", "improvementBacklog"],
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
          role: "measure",
          required: false,
          usedByArtifacts: ["benefits-tracker"],
          hint: "Each target benefit with its baseline, target, and the actual value measured at closure — this is what benefits realisation is scored against.",
          columns: [
            { key: "benefit", label: "Benefit", type: "text" },
            { key: "baseline", label: "Baseline", type: "text" },
            { key: "target", label: "Target", type: "text" },
            { key: "actual", label: "Actual at closure", type: "text" },
            // Unit keeps baseline/target/actual on one comparable scale (%, $, FTE)
            // so realisation is measured like-for-like instead of units being crammed
            // into value cells. Additive column — never demotes an already-filled row.
            { key: "unit", label: "Unit", type: "text", width: 100, placeholder: "e.g. %, $, FTE" },
          ],
        },
        { id: "lessonsLearned", label: "Lessons learned", type: "textarea", required: false, usedByArtifacts: ["narrative"], placeholder: "What worked, what didn't, and what to carry into the next programme", hint: "The retrospective that closes the programme — feeds the closure narrative." },
        { id: "closureApproval", label: "Sponsor closure sign-off", type: "select", role: "governance-signoff", required: false, usedByArtifacts: ["narrative"], options: ["Yes", "No"], hint: "Has the executive sponsor formally approved programme closure? Mirrors the mandatory closure exit criterion." },
        // Governance evidence for the "Handover to BAU confirmed" exit criterion.
        // Its evidencePrompt asks for a "BAU handover confirmation document" naming
        // the business-as-usual owner — a fact closureApproval (sponsor sign-off)
        // doesn't hold — so the criterion had no backing input. Optional (never
        // retroactively gates); flows into the closure narrative via usedByArtifacts.
        { id: "bauHandoverConfirmation", label: "BAU handover confirmation", type: "text", role: "governance-signoff", required: false, usedByArtifacts: ["narrative"], placeholder: "BAU owner and handover confirmation reference", hint: "The business-as-usual owner and a reference confirming programme outputs and ongoing responsibilities were formally handed over. Backs the Value Realize exit criterion \"Handover to BAU confirmed\".", example: "Handed to Ops Lead M. Chen, BAU acceptance ref OPS-204" },
      ],
      artifactInputFlow: {
        "benefits-tracker": ["realisedBenefits"],
      },
    },
  ],
};

// ── Exit-criteria single source of truth ─────────────────────────────────────
// `EXIT_CRITERIA_LIBRARY` is the authoritative registry of mandatory exit
// criteria: it is what `objectiveConfidence` evidences a phase against (via
// `getMandatoryCriteria` + `criterionMatches`) and what the gate-review UI reads.
// The gate criteria seeded at each phase boundary come from
// `mandatoryExitCriteriaTemplates` (AppShellV3 passes them to the phase-input
// planner as the next phase's `exitCriteria`). Those two vocabularies used to be
// maintained independently and had drifted — different wording, even different
// counts — so a stored gate criterion never matched its library label and the
// evidence score silently fell back to the approved-gate proxy. We reconcile them
// here by deriving each phase's templates from the library rather than keeping a
// second, drift-prone copy. The inline arrays above remain only as a documented
// fallback for any phase the library does not (yet) cover. Because ATOS_LITE and
// atos-regulated reuse these phase objects by reference, this single pass keeps
// every methodology variant aligned. The invariant is enforced by test.
for (const phase of ATOS_STANDARD.phases) {
  const derived = getMandatoryCriteria(phase.id).map((c) => c.label);
  if (derived.length > 0) phase.mandatoryExitCriteriaTemplates = derived;
}

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

// ─── ATOS Flow ────────────────────────────────────────────────────────────────
// The evidence-to-system methodology for agentic builds: conversations in,
// systems out. Where the stage-gate variants above progress by approving
// documents, Flow progresses by demonstrating working software. One primitive,
// repeated at five altitudes and then a standing loop:
//
//   conversation → transcript → generation → demonstration → next conversation
//
// The gate is a demo, not a document. Governance (decision log, evidence trail)
// is generated from the recorded conversations as a by-product — never typed
// into sign-off fields. Movements deliberately reuse the stage-gate field ids
// where the fact is the same (businessObjective, sponsor, industry,
// successMetric, kpis, realisedBenefits) so cross-cutting consumers — benefits
// tracking, KPI parsing, grounding facts — read Flow programmes unchanged.
export const ATOS_FLOW: MethodologyDefinition = {
  id: "atos-flow",
  version: "3.0.0",
  name: "ATOS Flow",
  description:
    "Evidence-to-system delivery for agentic builds: conversations in, systems out. Five movements and a standing loop; the gate is a demo, not a document.",
  phases: [
    {
      id: "frame",
      displayName: "Frame",
      description: "Turn one recorded sponsor conversation into a confirmed mandate and a booked discovery tour — days, not weeks.",
      requiredArtifacts: ["charter", "discovery-kit"],
      // Documented fallback only — reconciled from EXIT_CRITERIA_LIBRARY (frame-*) at load.
      mandatoryExitCriteriaTemplates: ["Mandate confirmed by sponsor", "Discovery conversations booked"],
      entryGuards: ["Programme created"],
      recommendedAgents: ["charter", "discovery-kit", "stakeholder"],
      typicalDurationWeeks: { min: 1, max: 1 },
      movement: {
        humanMoments: [
          "One 30-minute recorded sponsor conversation",
          "Confirm the generated mandate — \"that's what I meant\"",
        ],
        automations: [
          "Charter drafted from the sponsor transcript",
          "Stakeholder map proposed from the conversation and org context",
          "A role-aware 45-minute discovery agenda per stakeholder",
          "Interview schedule and consent kit",
        ],
        readyWhen: "The sponsor confirms the mandate and the discovery conversations are booked.",
      },
      inputFields: [
        { id: "businessObjective", label: "Business objective", type: "textarea", placeholder: "What outcome is this system meant to achieve?", required: true, example: "Cut quote-to-order cycle time by 70% by replacing the manual desk with an agentic workflow.", validationRule: "A measurable outcome, not an activity — name the change, the magnitude, and the horizon." },
        { id: "sponsor", label: "Executive sponsor", type: "text", role: "mandate", placeholder: "Name and title", required: true, example: "Jane Okafor, Chief Operating Officer", validationRule: "A named individual with their role, not a team or department." },
        { id: "industry", label: "Industry", type: "select", options: INDUSTRY_OPTIONS, required: true, hint: "The client's primary sector — sets the domain language the charter, agendas, and architecture strategy are written in." },
        { id: "segment", label: "Value-chain segment", type: "text", required: false, placeholder: "e.g. Clinical · Manufacturing & Supply · Commercial", hint: "Optional — sharpens vocabulary steering and discovery scope for forked sectors; inferred from evidence when empty." },
        { id: "sponsorConversation", label: "Sponsor conversation transcript", type: "transcript", required: false, usedByArtifacts: ["charter", "discovery-kit"], hint: "Paste the recorded sponsor conversation (or reference the uploaded document). The charter and the discovery kit draft themselves from it — you confirm rather than author." },
        { id: "successMetric", label: "Primary success metric", type: "text", role: "measure", placeholder: "KPI name, e.g. Quote turnaround time", required: true, example: "Quote turnaround time", validationRule: "A single measurable KPI name — baselines are captured from the discovery conversations." },
        {
          // Same field id as the stage-gate spine so KPI consumers (benefits
          // tracking, the Program Graph's measured-by chain) read Flow programmes
          // unchanged. Optional here: under Flow, baselines and targets are
          // EXTRACTED from the discovery conversations and confirmed, not typed
          // cold on day one.
          id: "kpis",
          label: "Success KPIs",
          type: "grid",
          role: "measure",
          required: false,
          hint: "The measurable KPIs that prove the objective. Leave thin at Frame — Listen extracts baselines from the discovery conversations and you confirm them here.",
          columns: [
            { key: "name", label: "KPI", type: "text", placeholder: "e.g. Quote turnaround" },
            { key: "baseline", label: "Baseline", type: "text", width: 90, placeholder: "Today" },
            { key: "target", label: "Target", type: "text", width: 90, placeholder: "The goal" },
            { key: "unit", label: "Unit", type: "text", width: 70, placeholder: "$, %, d" },
          ],
        },
        {
          id: "stakeholderSeed",
          label: "Stakeholders you already know",
          type: "grid",
          required: false,
          hint: "Anyone who must be heard. The stakeholder map generator extends this from the sponsor conversation — seed it, don't complete it.",
          columns: [
            { key: "name", label: "Name", type: "text" },
            { key: "role", label: "Role / title", type: "text" },
            { key: "domain", label: "Domain they own", type: "text", placeholder: "e.g. Pricing desk, Fulfilment" },
          ],
        },
        { id: "targetFirstDemoDate", label: "Target first-demo date", type: "date", required: false, hint: "Flow's headline metric is time-to-first-demo — the date every stakeholder first watches their own workflow run. Days-to-demo replaces duration-in-weeks." },
      ],
      artifactInputFlow: {
        "charter": ["businessObjective", "sponsor", "industry", "successMetric"],
        "discovery-kit": ["businessObjective", "industry", "stakeholderSeed"],
      },
    },
    {
      id: "listen",
      displayName: "Listen",
      description: "Run 45-minute discovery conversations; every transcript compiles into the Current-State Atlas — workflows, ontology, pain heatmap — while coverage climbs.",
      requiredArtifacts: ["domain-ontology", "current-state-atlas"],
      mandatoryExitCriteriaTemplates: ["Stakeholder coverage complete", "Contradictions resolved or logged"],
      entryGuards: ["Discovery kit generated"],
      recommendedAgents: ["current-state-atlas", "domain-ontology", "stakeholder"],
      typicalDurationWeeks: { min: 1, max: 3 },
      movement: {
        humanMoments: [
          "Run each 45-minute discovery conversation",
          "Answer the follow-up questions the synthesis raises",
        ],
        automations: [
          "Transcript ingestion and per-interview extraction — workflows, systems, pain points, metrics, verbatim quotes",
          "Cross-interview synthesis into current-state workflow maps and the pain heatmap",
          "Domain ontology built from every conversation — entities, relations, systems, hand-offs",
          "Contradiction detection between stakeholders, with follow-up questions generated",
          "Live coverage meter — who has been heard, which domains are thin",
        ],
        readyWhen: "Every mapped stakeholder has been heard or explicitly waived, and contradictions are resolved or logged.",
      },
      inputFields: [
        {
          id: "interviewRoster",
          label: "Discovery coverage",
          type: "grid",
          required: true,
          minRows: 3,
          hint: "One row per stakeholder conversation — the coverage ledger the Atlas synthesises from. Waiving someone (with the reason) is a recorded decision, not a gap.",
          validationRule: "Every stakeholder from the map appears here with a status — heard, booked, or waived with a reason.",
          columns: [
            { key: "name", label: "Stakeholder", type: "text" },
            { key: "role", label: "Role / domain", type: "text" },
            { key: "status", label: "Status", type: "select", width: 110, options: ["To book", "Booked", "Heard", "Waived"] },
            { key: "date", label: "Conversation date", type: "date", width: 110 },
          ],
        },
        { id: "interviewTranscripts", label: "Interview transcripts", type: "transcript", required: false, usedByArtifacts: ["current-state-atlas", "domain-ontology"], hint: "Paste each 45-minute conversation (or reference uploaded documents). Open every transcript with a header line — e.g. \"— Maria Chen, Sales Ops, 2026-07-14 —\" — so the Atlas attributes quotes to the right voice. ATOS re-synthesises on every new transcript." },
        {
          id: "contradictionLog",
          label: "Contradiction log",
          type: "grid",
          required: false,
          hint: "Where stakeholders disagree about how things work today. The synthesis surfaces these; resolve them in a follow-up or log the disagreement as a finding.",
          columns: [
            { key: "statement", label: "Contradiction", type: "text" },
            { key: "between", label: "Between", type: "text", width: 140, placeholder: "e.g. Sales ops vs Finance" },
            { key: "status", label: "Status", type: "select", width: 110, options: ["Open", "Resolved", "Logged"] },
            { key: "resolution", label: "Resolution — what was decided", type: "text", placeholder: "The ruling, in one line" },
            { key: "resolvedBy", label: "Settled by", type: "text", width: 130 },
            { key: "resolvedAt", label: "When", type: "text", width: 100 },
          ],
        },
      ],
      artifactInputFlow: {
        "current-state-atlas": ["interviewRoster", "interviewTranscripts", "contradictionLog"],
        "domain-ontology": ["interviewRoster", "interviewTranscripts"],
      },
    },
    {
      id: "envision",
      displayName: "Envision",
      description: "From the Atlas, candidate target architectures with trade-offs; one steering conversation picks the direction, which compiles into the Agentic Blueprint.",
      requiredArtifacts: ["architecture-strategy", "agentic-blueprint"],
      mandatoryExitCriteriaTemplates: ["Architecture direction chosen", "Agentic blueprint accepted"],
      entryGuards: ["Current-State Atlas synthesised"],
      recommendedAgents: ["architecture-strategy", "agentic-blueprint"],
      typicalDurationWeeks: { min: 1, max: 2 },
      dynamicSchema: true,
      movement: {
        humanMoments: ["One steering conversation: pick a direction (recorded)"],
        automations: [
          "Two to three candidate architecture strategies from the Atlas — agentic patterns, integration map, build-vs-buy, risk",
          "The Agentic Blueprint compiled for the chosen direction — agents, tools, orchestration, data contracts, human-in-the-loop points, eval plan",
          "Ontology-driven data model for the Blueprint",
        ],
        readyWhen: "A direction is chosen from the candidates and the Blueprint survives its review conversation.",
      },
      inputFields: [
        {
          id: "agenticFramework",
          label: "Target agentic framework",
          type: "select",
          required: true,
          options: ["Claude Agent SDK", "LangGraph", "OpenAI Agents SDK", "CrewAI", "AutoGen", "Semantic Kernel", "Custom / in-house", "Undecided — recommend one"],
          hint: "The framework the Blueprint compiles to. Pick \"Undecided\" to have the architecture strategy recommend one with rationale.",
        },
        { id: "directionDecision", label: "Chosen direction", type: "textarea", required: false, placeholder: "Candidate, rationale, and what was traded away", hint: "Which candidate architecture was chosen and why — lifted from the recorded steering conversation." },
        { id: "steeringConversation", label: "Steering conversation transcript", type: "transcript", required: false, usedByArtifacts: ["agentic-blueprint"], hint: "The recorded direction-setting conversation — paste it or reference the upload. The decision rationale and Blueprint framing generate from it." },
        { id: "hardConstraints", label: "Hard constraints", type: "textarea", role: "constraint", required: false, placeholder: "Platform mandates, data residency, security posture, integration boundaries", hint: "The boundaries every candidate must respect — lifted from Listen, refined here." },
      ],
      artifactInputFlow: {
        "architecture-strategy": ["agenticFramework", "hardConstraints"],
        "agentic-blueprint": ["agenticFramework", "directionDecision"],
      },
    },
    {
      id: "show",
      displayName: "Show",
      description: "The Blueprint compiles into a working prototype; every stakeholder watches their own workflow run, scripted from their own words. The gate is the demo.",
      requiredArtifacts: ["prototype-pack", "demo-scripts"],
      mandatoryExitCriteriaTemplates: ["Every stakeholder saw their workflow run", "Demo acceptances recorded"],
      entryGuards: ["Agentic Blueprint accepted"],
      recommendedAgents: ["prototype-pack", "demo-scripts"],
      typicalDurationWeeks: { min: 1, max: 3 },
      dynamicSchema: true,
      movement: {
        humanMoments: [
          "Each stakeholder watches their own workflow run",
          "React on the record — demo reactions are ingested as evidence",
        ],
        automations: [
          "Prototype build pack compiled from the Blueprint — scaffold, agent wiring, seed data lifted from the discovery evidence",
          "A demo script per stakeholder, seeded with scenarios from their own transcript",
          "Demo feedback ingestion — reactions become Blueprint diffs and a regenerated prototype",
        ],
        readyWhen: "Every stakeholder has seen their workflow run and accepted — objections addressed or logged.",
      },
      inputFields: [
        {
          // The acceptance ledger IS the gate: one row per stakeholder demo.
          // Tagged governance-signoff because it is Flow's sign-off — a recorded
          // reaction to working software, not a signature on a pack.
          id: "demoTour",
          label: "Demo tour ledger",
          type: "grid",
          role: "governance-signoff",
          required: true,
          hint: "One row per stakeholder demo — this ledger is the gate. \"You said the credit check takes three days; watch it take forty seconds.\"",
          validationRule: "Every stakeholder from the discovery coverage gets a demo row and a verdict.",
          columns: [
            { key: "stakeholder", label: "Stakeholder", type: "text" },
            { key: "date", label: "Demo date", type: "date", width: 110 },
            { key: "verdict", label: "Verdict", type: "select", width: 130, options: ["Pending", "Accepted", "Accepted with changes", "Objection"] },
            { key: "reaction", label: "Reaction / change asked", type: "text" },
          ],
        },
        { id: "prototypeLocation", label: "Prototype location", type: "text", required: false, placeholder: "Repo or environment URL", hint: "Where the running prototype lives — repo, sandbox, or environment." },
        { id: "demoFeedback", label: "Demo session transcripts", type: "transcript", required: false, usedByArtifacts: ["demo-scripts"], hint: "Recordings of the demo sessions — paste or reference. Reactions feed Blueprint diffs and the next prototype build. Header each session with the stakeholder's name so verdicts attribute." },
      ],
      artifactInputFlow: {
        "prototype-pack": ["prototypeLocation"],
      },
    },
    {
      id: "ship",
      displayName: "Ship",
      description: "Harden the accepted prototype into the production system — guardrails, an eval suite generated from the evidence trail, runbook, cutover.",
      requiredArtifacts: ["hardening-plan", "eval-suite", "runbook"],
      mandatoryExitCriteriaTemplates: ["Eval suite green", "Cutover executed"],
      entryGuards: ["Demo acceptances recorded"],
      recommendedAgents: ["hardening-plan", "eval-suite", "runbook"],
      typicalDurationWeeks: { min: 2, max: 4 },
      dynamicSchema: true,
      movement: {
        humanMoments: ["Go/no-go on the evidence — a conversation, not a committee pack"],
        automations: [
          "Prototype-to-production conversion plan — authn/z, error handling, observability, rate limits",
          "Guardrails and human-in-the-loop insertion at the Blueprint's marked points",
          "Eval suite generated from the discovery transcripts and demo acceptances",
          "Runbook and cutover plan",
        ],
        readyWhen: "The eval suite is green and cutover has executed.",
      },
      inputFields: [
        { id: "productionEnvironment", label: "Production environment", type: "text", required: false, placeholder: "e.g. Azure subscription / AWS account, region", hint: "Where the system runs in production — the hardening plan and runbook target it." },
        { id: "goLiveDate", label: "Go-live date", type: "date", required: false, hint: "Planned (or actual) production cutover." },
        { id: "evalStatus", label: "Eval suite status", type: "select", required: false, options: ["Not run", "Red", "Amber", "Green"], hint: "Latest run of the generated eval suite — green is the shipping signal." },
        { id: "goDecisionRef", label: "Go/no-go conversation reference", type: "text", role: "governance-signoff", required: false, placeholder: "Link to the recorded go/no-go conversation", hint: "The decision log generates from the recorded conversation — this is its reference, not a signature." },
      ],
      artifactInputFlow: {
        "hardening-plan": ["productionEnvironment"],
        "runbook": ["productionEnvironment", "goLiveDate"],
      },
    },
    {
      id: "evolve",
      displayName: "Evolve",
      description: "The standing loop, not a phase: telemetry against the baselines captured in Listen, monthly ops conversations feeding the Atlas, drift becoming the next candidates.",
      requiredArtifacts: ["benefits-tracker", "optimization-backlog"],
      mandatoryExitCriteriaTemplates: ["Benefits pulse live against baselines"],
      entryGuards: ["System in production"],
      recommendedAgents: ["benefits-tracker", "optimization-backlog"],
      typicalDurationWeeks: { min: 4, max: 12 },
      movement: {
        humanMoments: ["A monthly ops conversation, recorded"],
        automations: [
          "Telemetry compared to the KPI baselines captured in Frame and Listen",
          "Ops-review transcripts fed back into the Atlas",
          "Drift detection — ontology and workflow changes surfaced",
          "Next improvement candidates ranked by value against the live baselines",
        ],
        readyWhen: "Never — Evolve is the loop. Healthy means the benefits pulse is live and drift is being caught.",
        isLoop: true,
      },
      inputFields: [
        { id: "opsConversations", label: "Ops conversation transcripts", type: "transcript", required: false, usedByArtifacts: ["benefits-tracker", "optimization-backlog"], hint: "The monthly recorded ops review — paste or reference. Each one re-runs the benefits pulse and drift detection." },
        {
          // Same field id as the stage-gate spine's Value Realize grid so the
          // benefits-tracker agent reads Flow programmes unchanged.
          id: "realisedBenefits",
          label: "Realised benefits",
          type: "grid",
          role: "measure",
          required: false,
          hint: "Measured KPI movements against the baselines captured in Listen — the numbers the loop verifies.",
          columns: [
            { key: "kpi", label: "KPI", type: "text" },
            { key: "measured", label: "Measured value", type: "text", width: 120 },
            { key: "date", label: "Measured on", type: "date", width: 115 },
          ],
        },
        { id: "driftNotes", label: "Drift observations", type: "textarea", role: "risk", required: false, placeholder: "Where reality has moved away from the shipped workflows or ontology", hint: "Seeds the optimization backlog with real signals rather than a cold start." },
      ],
      artifactInputFlow: {
        "benefits-tracker": ["realisedBenefits"],
        "optimization-backlog": ["driftNotes"],
      },
    },
  ],
};

// Same library reconciliation as the stage-gate spine above: Flow's movement
// criteria live in EXIT_CRITERIA_LIBRARY (frame-1…evolve-1), so the gate
// machinery evidences movements exactly like phases. The difference is what the
// criteria SAY — recorded conversations and working demonstrations, not packs.
for (const phase of ATOS_FLOW.phases) {
  const derived = getMandatoryCriteria(phase.id).map((c) => c.label);
  if (derived.length > 0) phase.mandatoryExitCriteriaTemplates = derived;
}

export const METHODOLOGY_REGISTRY: Record<MethodologyVariant, MethodologyDefinition> = {
  "atos-standard": ATOS_STANDARD,
  "atos-lite": ATOS_LITE,
  "atos-regulated": {
    ...ATOS_STANDARD,
    id: "atos-regulated",
    name: "ATOS Regulated",
  },
  "atos-flow": ATOS_FLOW,
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
  {
    id: "agentic-system",
    label: "Agentic System Build",
    description: "Compile stakeholder conversations into a working agentic system — discovery transcripts to a hardened production deployment.",
    icon: "✦",
    methodologyVariant: "atos-flow",
    typicalDurationMonths: { min: 1, max: 4 },
    defaultKPIs: ["Time to first demo", "Demo acceptance rate", "Stakeholder coverage", "Eval pass rate"],
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
 * methodology (which declares every stage-gate phase), then to Flow (whose
 * movement ids — frame…evolve — exist in no other variant), so callers always
 * get the phase's exit-criteria spine and recommended agents regardless of
 * which variant the caller happens to hold.
 */
export function getPhaseDefinition(
  phaseId: string,
  variant: MethodologyVariant = "atos-lite",
): PhaseDefinition | undefined {
  return getMethodology(variant).phases.find((phase) => phase.id === phaseId)
    ?? ATOS_STANDARD.phases.find((phase) => phase.id === phaseId)
    ?? ATOS_FLOW.phases.find((phase) => phase.id === phaseId);
}

/** The artifacts a phase produces: its required set plus every input-flow target. */
function phaseOwnedArtifacts(phase: PhaseDefinition): string[] {
  const owned = new Set<string>(phase.requiredArtifacts);
  for (const agentId of Object.keys(phase.artifactInputFlow ?? {})) owned.add(agentId);
  return [...owned];
}

/**
 * A compact, authoritative "phase ownership map" for a formal artifact's
 * generation context. Each phase OWNS a specific set of captured inputs (its
 * `inputFields`) and artifacts (its `requiredArtifacts` plus every
 * `artifactInputFlow` target); a self-reported gap belongs to whichever phase
 * owns the missing item. Feeding this map into the artifact prompt lets the
 * phase-scoped gap discipline suppress out-of-scope gaps from the registry
 * itself rather than from hard-coded scope/roster examples — so it generalises
 * to every phase and artifact and stays correct as the registry evolves.
 *
 * Phases are labelled relative to `currentPhaseId`: EARLIER phases hold content
 * already established upstream (reference it, never re-demand it as a gap), the
 * CURRENT phase is where gaps may legitimately be raised, and LATER phases own
 * detail that is out of scope for this artifact. Deterministic + framework-free,
 * so it unit-tests without a render. Returns "" for an unknown phase id.
 */
export function buildPhaseOwnershipContext(
  currentPhaseId: string,
  variant: MethodologyVariant = "atos-lite",
): string {
  const phases = getMethodology(variant).phases;
  const currentIndex = phases.findIndex((phase) => phase.id === currentPhaseId);
  if (currentIndex === -1) return "";

  const lines: string[] = [
    "## Phase ownership map (authoritative — derived from the methodology registry)",
    "Each phase OWNS a specific set of captured inputs and artifacts, listed below. A self-reported gap belongs to whichever phase owns the missing item. In THIS artifact, only raise gaps for things the CURRENT phase owns — never demand detail an EARLIER phase already established, nor detail (or a structured input) that a LATER phase owns, even if the corresponding downstream artifact is thin or not yet produced.",
  ];
  phases.forEach((phase, index) => {
    const marker =
      index < currentIndex ? "EARLIER — already established upstream"
        : index === currentIndex ? "CURRENT PHASE — gaps may be raised here"
          : "LATER — out of scope for this artifact";
    const inputs = (phase.inputFields ?? []).map((field) => field.label);
    const artifacts = phaseOwnedArtifacts(phase);
    lines.push(`▸ ${phase.displayName} [${marker}]`);
    if (inputs.length) lines.push(`   • Inputs: ${inputs.join("; ")}`);
    if (artifacts.length) lines.push(`   • Artifacts: ${artifacts.join(", ")}`);
  });
  return lines.join("\n");
}
