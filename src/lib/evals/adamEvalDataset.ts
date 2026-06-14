import type { AgentMemoryEntry } from "@/lib/adamAgentMemory";
import type { AgentHandoff } from "@/lib/adamSync";
import type { AdamAgentId, ProgramContext } from "@/lib/adamAgentPrompts";

export type EvalDimension =
  | "accuracy"
  | "completeness"
  | "specificity"
  | "consistency"
  | "schema_validity"
  | "confidence_calibration"
  | "pause_behavior"
  | "tone"
  | "hallucination";

export interface ExpectedTrait {
  dimension: EvalDimension;
  description: string;
  evaluator: "llm" | "regex" | "schema" | "custom";
  weight: number;
  evaluatorConfig?: Record<string, unknown>;
}

export interface AntiPattern {
  description: string;
  pattern?: string;
  llmCheck?: string;
}

export interface EvalCase {
  id: string;
  agentId: AdamAgentId;
  name: string;
  description: string;
  input: {
    programContext: ProgramContext;
    crossPhaseContext?: string;
    memory?: AgentMemoryEntry[];
    incomingHandoff?: AgentHandoff;
  };
  expectedOutputTraits: ExpectedTrait[];
  antiPatterns: AntiPattern[];
  tags: string[];
}

type CaseKind = "happy_001" | "happy_002" | "happy_003" | "edge_001" | "edge_002" | "adv_001" | "pause_001";

interface ScenarioSeed {
  code: CaseKind;
  industry: string;
  programName: string;
  sponsor: string;
  sponsorRole: string;
  challenge: string;
  goal: string;
  budgetUsd: number;
  timelineMonths: number;
  baselineMetrics: string[];
  targetMetrics: string[];
  strategicDrivers: string[];
  constraints: string[];
  regulatoryContext: string[];
  stakeholders: string[];
  knownRisks: string[];
  tags: string[];
}

interface AgentScenarioProfile {
  agentName: string;
  caseFocus: Record<CaseKind, string>;
  pauseReason: string;
  requiredEvidence: string[];
}

const SCENARIO_SEEDS: ScenarioSeed[] = [
  {
    code: "happy_001",
    industry: "Life Sciences",
    programName: "FieldSignal Navigator",
    sponsor: "Elena Marquez",
    sponsorRole: "Chief Commercial Officer",
    challenge: "Field medical teams spend too much time manually triaging HCP insights and preparing compliant follow-up actions, causing lost signal throughput and inconsistent escalation to brand teams.",
    goal: "Create a governed human-plus-agent workflow that increases insight capture speed, improves routing quality, and reduces manual triage effort.",
    budgetUsd: 3600000,
    timelineMonths: 9,
    baselineMetrics: [
      "Only 41% of HCP insights are routed within 48 hours.",
      "Medical affairs staff spend 11 hours per week on manual triage and summarization.",
      "Only 22% of routed insights lead to a documented action within two weeks.",
    ],
    targetMetrics: [
      "Route 85% of HCP insights within 24 hours.",
      "Reduce manual triage effort by 60% within 6 months.",
      "Increase documented follow-up actions to 55% within two weeks.",
    ],
    strategicDrivers: [
      "Protect launch revenue for two specialty brands.",
      "Improve field insight responsiveness without adding headcount.",
      "Demonstrate a compliant AI operating model that can scale to adjacent teams.",
    ],
    constraints: [
      "Must use approved MLR review steps for external communications.",
      "Budget cannot exceed current transformation envelope.",
      "Change impact on medical affairs workflows must be absorbed before Q4 congress season.",
    ],
    regulatoryContext: ["FDA promotional compliance", "Pharmacovigilance reporting obligations", "Global privacy rules for HCP data"],
    stakeholders: ["Medical Affairs", "Compliance", "Commercial Excellence", "Field Medical Leadership", "Brand Teams"],
    knownRisks: ["Unclear ownership for insight routing exceptions", "Potential compliance delays if MLR workload spikes"],
    tags: ["happy_path", "regulated", "life_sciences"],
  },
  {
    code: "happy_002",
    industry: "Financial Services",
    programName: "Claims Shield Operations",
    sponsor: "Marcus Dyer",
    sponsorRole: "Chief Risk Officer",
    challenge: "Fraud review analysts manually consolidate evidence across claims, device fingerprints, and payment anomalies, leading to slow investigations and uneven case quality.",
    goal: "Introduce a governed agent-assisted fraud triage capability that accelerates investigation prep, improves hit rate, and preserves human decision ownership.",
    budgetUsd: 5200000,
    timelineMonths: 12,
    baselineMetrics: [
      "Average investigation prep time is 95 minutes per suspicious claim.",
      "Only 14% of flagged cases result in confirmed fraud.",
      "Analyst backlog remains above 1,200 cases for 9 of the last 12 weeks.",
    ],
    targetMetrics: [
      "Reduce prep time to under 35 minutes per case.",
      "Increase confirmed fraud hit rate to 23%.",
      "Lower average backlog to under 400 cases within two quarters.",
    ],
    strategicDrivers: [
      "Reduce claims leakage while preserving customer fairness.",
      "Free senior analysts for high-complexity investigations.",
      "Create a reusable AI control pattern for broader risk operations.",
    ],
    constraints: [
      "No autonomous payment blocking without human approval.",
      "Evidence lineage must be audit-ready.",
      "Transformation must integrate with legacy claims systems before core replacement completes.",
    ],
    regulatoryContext: ["SOX control requirements", "Model risk management policy", "Consumer duty obligations"],
    stakeholders: ["Fraud Operations", "Risk Governance", "Claims Technology", "Internal Audit", "Customer Operations"],
    knownRisks: ["Model explainability expectations still emerging", "Legacy data quality varies across regions"],
    tags: ["happy_path", "financial_services", "risk_sensitive"],
  },
  {
    code: "happy_003",
    industry: "Healthcare",
    programName: "CarePath Prior Auth",
    sponsor: "Dr. Nina Walker",
    sponsorRole: "Chief Operating Officer",
    challenge: "Prior authorization coordinators spend large amounts of time gathering clinical context, reviewing plan rules, and chasing missing documentation, delaying patient treatment and inflating admin burden.",
    goal: "Deploy a human-led agent-assisted prior auth workflow that improves turnaround time, reduces rework, and maintains clinical safety.",
    budgetUsd: 4400000,
    timelineMonths: 10,
    baselineMetrics: [
      "Median prior auth turnaround time is 4.8 days.",
      "Thirty-one percent of submissions require rework due to missing documentation.",
      "Care coordinators spend 8.5 hours weekly on follow-up calls and status chasing.",
    ],
    targetMetrics: [
      "Reduce median turnaround time to 2.2 days.",
      "Cut rework rate to under 15%.",
      "Reduce manual follow-up effort by 45%.",
    ],
    strategicDrivers: [
      "Improve patient access timelines for specialty therapies.",
      "Reduce administrative burden without increasing clinical risk.",
      "Create a replicable AI-enabled care operations blueprint.",
    ],
    constraints: [
      "Clinical override and escalation rules must remain human controlled.",
      "HIPAA and payer-specific audit needs must be met.",
      "Nursing leadership can only absorb one major workflow change this quarter.",
    ],
    regulatoryContext: ["HIPAA", "Payer documentation rules", "Clinical quality oversight"],
    stakeholders: ["Care Coordination", "Revenue Cycle", "Clinical Operations", "Compliance", "Patient Access"],
    knownRisks: ["Incomplete documentation in referral packets", "Integration timing with EHR upgrade is uncertain"],
    tags: ["happy_path", "healthcare", "human_in_the_loop"],
  },
  {
    code: "edge_001",
    industry: "Retail",
    programName: "StoreFlow Workforce Pulse",
    sponsor: "Alyssa Trent",
    sponsorRole: "VP Store Operations",
    challenge: "District managers want AI help to prioritize labor, shrink, and service interventions, but current baseline data is fragmented and different regions report performance inconsistently.",
    goal: "Design a lightweight transformation that turns inconsistent store data into decision support for district managers.",
    budgetUsd: 1900000,
    timelineMonths: 7,
    baselineMetrics: [
      "Shrink is reported monthly but category definitions differ by region.",
      "Store labor planning accuracy is tracked only in five pilot regions.",
    ],
    targetMetrics: [
      "Improve labor planning accuracy by 20% in pilot regions.",
      "Reduce shrink variance by 8% in targeted categories.",
    ],
    strategicDrivers: [
      "Stabilize store performance before peak season.",
      "Avoid adding corporate planning headcount.",
    ],
    constraints: [
      "No major POS replacement this year.",
      "Store leaders can tolerate only limited extra process burden.",
    ],
    regulatoryContext: ["Labor scheduling rules vary by state"],
    stakeholders: ["Store Operations", "Merchandising", "Loss Prevention", "Regional Finance"],
    knownRisks: ["Metric definitions are inconsistent across regions", "Store managers are skeptical of centrally generated recommendations"],
    tags: ["edge_case", "retail", "partial_baseline"],
  },
  {
    code: "edge_002",
    industry: "Manufacturing",
    programName: "PlantSense Reliability Hub",
    sponsor: "Jonas Keller",
    sponsorRole: "SVP Operations",
    challenge: "Plant reliability teams want agent support for maintenance triage and parts risk prediction, but asset data quality is uneven and workforce adoption concerns are high in unionized sites.",
    goal: "Identify a safe, phased AI-enabled reliability capability that improves maintenance prioritization without eroding workforce trust.",
    budgetUsd: 2800000,
    timelineMonths: 11,
    baselineMetrics: [
      "Unplanned downtime data exists for all plants but root-cause coding is incomplete in 40% of events.",
      "Maintenance planners spend roughly 6 hours per week manually assembling parts risk views.",
    ],
    targetMetrics: [
      "Reduce unplanned downtime by 10% in phase-one sites.",
      "Cut planner prep effort by 35%.",
    ],
    strategicDrivers: [
      "Protect throughput in two constrained product lines.",
      "Use AI to improve maintenance planning without reducing workforce safety standards.",
    ],
    constraints: [
      "Union consultation required before role redesign.",
      "No direct machine shutdown authority for agents.",
    ],
    regulatoryContext: ["Worker safety obligations", "Cybersecurity requirements for OT environments"],
    stakeholders: ["Plant Operations", "Maintenance", "Industrial Engineering", "Labor Relations", "Cybersecurity"],
    knownRisks: ["OT data access is inconsistent", "Supervisors are unclear on future oversight workload"],
    tags: ["edge_case", "manufacturing", "workforce_complexity"],
  },
  {
    code: "adv_001",
    industry: "Public Sector",
    programName: "Citizen Intake Assist",
    sponsor: "Ruth Adeyemi",
    sponsorRole: "Deputy Secretary for Service Delivery",
    challenge: "Leadership wants to accelerate citizen intake processing with agents while simultaneously reducing risk exposure, protecting vulnerable populations, and avoiding any perception of automated denial decisions.",
    goal: "Design a transformation that improves intake speed and caseworker productivity while preserving public trust, explainability, and mandatory human authority.",
    budgetUsd: 6100000,
    timelineMonths: 14,
    baselineMetrics: [
      "Average intake packet completion takes 13.5 days.",
      "Caseworkers spend 52% of their time on document consolidation and status follow-up.",
      "Quality review failure rates vary from 6% to 19% by regional office.",
    ],
    targetMetrics: [
      "Reduce intake cycle time to 7 days.",
      "Free 20% of caseworker time for direct applicant support.",
      "Standardize quality review failure rates below 8% across offices.",
    ],
    strategicDrivers: [
      "Reduce backlog before a policy expansion increases demand.",
      "Improve equity and consistency across regions.",
      "Demonstrate responsible AI in a politically visible environment.",
    ],
    constraints: [
      "No automated eligibility or denial decisions.",
      "Unions and public advocates must be engaged early.",
      "Any perceived bias issue will trigger executive review.",
    ],
    regulatoryContext: ["Administrative law due process", "Public records obligations", "Data retention policy"],
    stakeholders: ["Service Delivery", "Legal", "Caseworkers", "Public Advocates", "Internal Audit"],
    knownRisks: ["Policy intent can be interpreted differently by regions", "Public scrutiny is high and tolerance for mistakes is low"],
    tags: ["adversarial", "public_sector", "contradictory_input"],
  },
  {
    code: "pause_001",
    industry: "Healthcare",
    programName: "AccessFlow Assist",
    sponsor: "",
    sponsorRole: "",
    challenge: "Executives want an AI transformation for patient access, but the ask is still framed only as improve operations and no accountable sponsor has been confirmed.",
    goal: "Explore whether ADAM can form a program shape once leadership provides enough clarity.",
    budgetUsd: 1200000,
    timelineMonths: 6,
    baselineMetrics: [],
    targetMetrics: ["Improve patient access somehow within six months."],
    strategicDrivers: ["General pressure to use AI", "Need to show progress to the board"],
    constraints: ["Very limited approved budget", "No agreed scope", "No baseline study complete"],
    regulatoryContext: ["HIPAA"],
    stakeholders: ["Operations", "Patient Access"],
    knownRisks: ["No sponsor", "No baseline", "Vague objective"],
    tags: ["pause_trigger", "missing_context", "should_pause"],
  },
];

const AGENT_PROFILES: Record<AdamAgentId, AgentScenarioProfile> = {
  strategy: {
    agentName: "Strategy Advisor",
    caseFocus: {
      happy_001: "Form a crisp transformation thesis and measurable outcome set for the commercial insight workflow.",
      happy_002: "Translate the fraud operations problem into a falsifiable strategy and value hypothesis.",
      happy_003: "Frame the prior auth transformation as an enterprise operating bet with measurable outcomes.",
      edge_001: "Constrain scope despite fragmented baselines and partial regional metrics.",
      edge_002: "Balance value ambition with workforce trust and OT safety constraints.",
      adv_001: "Resolve tension between speed, public trust, and zero automated denial authority.",
      pause_001: "Pause because the objective and sponsor are too vague to support a real transformation thesis.",
    },
    pauseReason: "Missing sponsor and measurable baseline make strategy output unsafe.",
    requiredEvidence: ["falsifiable thesis", "named outcomes", "value pools"],
  },
  mobilise: {
    agentName: "Mobilisation Lead",
    caseFocus: {
      happy_001: "Create governance and stakeholder readiness for a regulated commercial transformation.",
      happy_002: "Stand up decision rights and launch choreography for fraud operations.",
      happy_003: "Mobilize clinical, revenue cycle, and compliance stakeholders around prior auth change.",
      edge_001: "Build a light but credible governance model despite fragmented metrics and skeptical store leaders.",
      edge_002: "Shape mobilisation around union consultation, OT risk, and phased rollout.",
      adv_001: "Define governance and communications that can withstand public scrutiny and policy tension.",
      pause_001: "Pause because no sponsor or owner exists to anchor mobilisation.",
    },
    pauseReason: "No accountable leadership spine exists for mobilisation planning.",
    requiredEvidence: ["governance cadence", "decision rights", "launch checklist"],
  },
  discover: {
    agentName: "Discovery Analyst",
    caseFocus: {
      happy_001: "Quantify HCP insight opportunities with value pools and ROI ranges.",
      happy_002: "Build investment-grade fraud operations business cases and payback logic.",
      happy_003: "Prioritize prior auth opportunities with grounded baselines and value pools.",
      edge_001: "Work around fragmented retail baselines without overstating certainty.",
      edge_002: "Quantify maintenance opportunity despite uneven root-cause data.",
      adv_001: "Model citizen service value while preserving public trust and mandated human authority.",
      pause_001: "Pause because there is no usable baseline data for any opportunity.",
    },
    pauseReason: "Discovery requires baseline evidence to quantify value credibly.",
    requiredEvidence: ["value pool mapping", "ROI ranges", "payback periods"],
  },
  design: {
    agentName: "Capability Architect",
    caseFocus: {
      happy_001: "Define human-plus-agent capabilities for commercial insight triage and escalation.",
      happy_002: "Design fraud triage capabilities with explicit oversight and decision boundaries.",
      happy_003: "Design prior auth support capabilities with strong human clinical touchpoints.",
      edge_001: "Design a narrow store-ops capability despite inconsistent data definitions.",
      edge_002: "Design reliability capabilities that respect union and OT safety constraints.",
      adv_001: "Design citizen intake capabilities that separate support from legal determination.",
      pause_001: "Pause because oversight requirements and decision boundaries are undefined.",
    },
    pauseReason: "Capability design is unsafe when human oversight is unclear.",
    requiredEvidence: ["capability definitions", "autonomy levels", "human touchpoints"],
  },
  agent_arch: {
    agentName: "Agent Architect",
    caseFocus: {
      happy_001: "Define a multi-agent workforce for compliant insight capture and routing.",
      happy_002: "Blueprint fraud-support agents with clear tools, escalation, and failure modes.",
      happy_003: "Specify prior auth agents that preserve clinical authority and payer rule transparency.",
      edge_001: "Design lightweight decision-support agents despite limited retail system maturity.",
      edge_002: "Specify safe OT-adjacent agents with bounded permissions and workforce clarity.",
      adv_001: "Architect public-sector agents that never cross into automated decisions.",
      pause_001: "Pause because required tools and data access are not yet defined.",
    },
    pauseReason: "An agent blueprint cannot be approved without tool and data boundaries.",
    requiredEvidence: ["agent blueprints", "dependency map", "failure modes"],
  },
  build: {
    agentName: "FDE Lead",
    caseFocus: {
      happy_001: "Turn regulated commercial capability design into build-ready workstreams and tests.",
      happy_002: "Produce an execution-ready build plan for fraud triage tooling and trust controls.",
      happy_003: "Create engineering workstreams for prior auth acceleration with integration and testing detail.",
      edge_001: "Scope a build plan that tolerates partial data standardization in retail pilots.",
      edge_002: "Stage a build around OT security, maintenance adoption, and phased rollout.",
      adv_001: "Build a safe intake-assist package with strong human override and policy testing.",
      pause_001: "Pause because the design baseline is not mature enough for build planning.",
    },
    pauseReason: "Build planning needs an approved capability or agent design baseline.",
    requiredEvidence: ["engineering workstreams", "test strategy", "release dependencies"],
  },
  operate: {
    agentName: "Operations Lead",
    caseFocus: {
      happy_001: "Define the live operating model for compliant insight-routing service operations.",
      happy_002: "Stand up HITL and service levels for fraud-support operations.",
      happy_003: "Operationalize prior auth agents with strong reviewer thresholds and runbooks.",
      edge_001: "Create a lean operating model for store support with minimal field burden.",
      edge_002: "Define safe operational boundaries for OT-adjacent reliability workflows.",
      adv_001: "Ensure public-sector intake assistance stays reviewable, supportable, and politically resilient.",
      pause_001: "Pause because operational reviewers and thresholds are not defined.",
    },
    pauseReason: "Operate cannot complete without explicit reviewer and threshold definitions.",
    requiredEvidence: ["HITL policy", "service levels", "runbook priorities"],
  },
  govern: {
    agentName: "Governance Coach",
    caseFocus: {
      happy_001: "Build audit-ready governance for a life sciences insight-routing capability.",
      happy_002: "Create control evidence and monitoring structure for fraud operations AI.",
      happy_003: "Define clinical-safe governance and evidence for prior auth acceleration.",
      edge_001: "Set minimum viable retail governance when data definitions remain uneven.",
      edge_002: "Balance OT cybersecurity, labor sensitivity, and safety evidence in manufacturing.",
      adv_001: "Construct governance robust enough for public scrutiny and due process obligations.",
      pause_001: "Pause because policy requirements and control ownership are too unclear.",
    },
    pauseReason: "Governance outputs are unsafe when obligations and owners are unknown.",
    requiredEvidence: ["control matrix", "audit evidence plan", "policy gaps"],
  },
  optimize: {
    agentName: "Value Realization Lead",
    caseFocus: {
      happy_001: "Interpret live HCP insight-routing signals and recommend the next optimization moves.",
      happy_002: "Diagnose fraud operations value leakage and backlog next experiments.",
      happy_003: "Read prior auth operating signals and identify safe value gains.",
      edge_001: "Use weak store data responsibly while suggesting narrow optimization tests.",
      edge_002: "Translate uneven plant telemetry into cautious optimization hypotheses.",
      adv_001: "Recommend improvements without compromising public trust or fairness.",
      pause_001: "Pause because no live value or performance signals exist yet.",
    },
    pauseReason: "Optimization requires live value signals, not aspiration alone.",
    requiredEvidence: ["value signals", "value leakage drivers", "experiments"],
  },
  valuerealize: {
    agentName: "Value Accountant",
    caseFocus: {
      happy_001: "Compare promised versus realized commercial insight value and document lessons learned.",
      happy_002: "Account for delivered fraud operations value and residual risk.",
      happy_003: "Assess realized value of prior auth acceleration and closure conditions.",
      edge_001: "Handle partial retail outcome evidence without overstating realized value.",
      edge_002: "Assess maintenance transformation value while highlighting residual operational risks.",
      adv_001: "Explain delivered public-sector value with a conservative evidence standard.",
      pause_001: "Pause because there are no actual realized metrics to reconcile.",
    },
    pauseReason: "Value realization cannot complete without actual results.",
    requiredEvidence: ["baseline vs actual", "lessons learned", "closure recommendations"],
  },
  delivery: {
    agentName: "Delivery Lead",
    caseFocus: {
      happy_001: "Summarize milestone health and RAID control for the commercial program.",
      happy_002: "Expose execution risks and learning-cycle priorities in fraud operations delivery.",
      happy_003: "Steer prior auth delivery through milestones, dependencies, and learning cycles.",
      edge_001: "Keep a retail pilot delivery plan honest despite inconsistent regional data.",
      edge_002: "Manage phased manufacturing rollout risks and adoption dependencies.",
      adv_001: "Balance political visibility with disciplined delivery truth-telling.",
      pause_001: "Pause because there is no credible milestone or RAID signal to report.",
    },
    pauseReason: "Delivery reporting needs real milestone and dependency evidence.",
    requiredEvidence: ["milestone health", "RAID priorities", "learning cycle focus"],
  },
  adoption: {
    agentName: "Change Lead",
    caseFocus: {
      happy_001: "Shape adoption and championing for field medical and compliance stakeholders.",
      happy_002: "Build the human adoption plan for fraud analysts and risk leaders.",
      happy_003: "Design adoption support for coordinators, nurses, and patient access teams.",
      edge_001: "Handle store manager skepticism and limited process tolerance in retail.",
      edge_002: "Address workforce trust and union sensitivity in manufacturing sites.",
      adv_001: "Create an adoption approach that protects public trust and frontline caseworker buy-in.",
      pause_001: "Pause because impacted personas and change implications remain too vague.",
    },
    pauseReason: "Adoption planning must know who changes and how.",
    requiredEvidence: ["impacted personas", "champion network", "training plan"],
  },
  titan: {
    agentName: "Intelligence Analyst",
    caseFocus: {
      happy_001: "Forecast likely value trajectory for the commercial insight transformation.",
      happy_002: "Compare fraud operations scenarios and recommend leverage decisions.",
      happy_003: "Model prior auth outcome scenarios and identify leading indicators.",
      edge_001: "Use partial retail evidence to build cautious scenario comparisons.",
      edge_002: "Forecast manufacturing outcomes despite noisy OT and workforce signals.",
      adv_001: "Handle contradictory public-sector aims with strict scenario framing and decision trade-offs.",
      pause_001: "Pause because there are no credible leading indicators or benchmark anchors.",
    },
    pauseReason: "Forecasting without leading indicators would be misleading.",
    requiredEvidence: ["scenario comparisons", "leading indicators", "recommended decisions"],
  },
};

function createProgramContext(seed: ScenarioSeed): ProgramContext {
  return {
    programId: `prog-${seed.programName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    programName: seed.programName,
    industry: seed.industry,
    sponsor: seed.sponsor,
    sponsorRole: seed.sponsorRole,
    businessChallenge: seed.challenge,
    transformationGoal: seed.goal,
    budgetUsd: seed.budgetUsd,
    timelineMonths: seed.timelineMonths,
    currentPhase: "strategy",
    baselineMetrics: seed.baselineMetrics,
    targetMetrics: seed.targetMetrics,
    strategicDrivers: seed.strategicDrivers,
    constraints: seed.constraints,
    regulatoryContext: seed.regulatoryContext,
    stakeholders: seed.stakeholders,
    knownRisks: seed.knownRisks,
  };
}

function createMemory(agentId: AdamAgentId, seed: ScenarioSeed): AgentMemoryEntry[] {
  return [
    {
      agentId,
      phaseId: agentId,
      programId: `memory-${seed.programName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      timestamp: "2026-05-20T15:00:00.000Z",
      type: "feedback",
      summary: `Earlier reviewers asked the ${agentId} agent to be more specific about owners, timelines, and measurable thresholds.`,
      outcome: "modified",
      confidence: 0.68,
      learningNote: "Prefer explicit owners, baselines, and decision criteria over broad narrative language.",
    },
  ];
}

function createHandoff(agentId: AdamAgentId, seed: ScenarioSeed): AgentHandoff | undefined {
  if (agentId === "strategy") return undefined;
  const priorPhase = agentId === "mobilise"
    ? "strategy"
    : agentId === "discover"
      ? "mobilise"
      : agentId === "design"
        ? "discover"
        : agentId === "agent_arch"
          ? "design"
          : agentId === "build"
            ? "agent_arch"
            : agentId === "operate"
              ? "build"
              : agentId === "govern"
                ? "operate"
                : agentId === "optimize"
                  ? "govern"
                  : agentId === "valuerealize"
                    ? "optimize"
                    : agentId === "delivery"
                      ? "build"
                      : agentId === "adoption"
                        ? "mobilise"
                        : "discover";
  return {
    fromAgentId: `${priorPhase}_agent`,
    fromPhaseId: priorPhase,
    toPhaseId: agentId,
    completedAt: "2026-06-01T10:00:00.000Z",
    summary: `${seed.programName} now has a working ${priorPhase} package with named outcomes, material risks, and early alignment on business value. The next agent should use those decisions as the baseline rather than re-opening first principles.`,
    keyDecisions: [
      "Program scope constrained to highest-value workflow first.",
      "Human accountability retained for high-consequence decisions.",
    ],
    artifactIds: [`${priorPhase}-artifact-001`, `${priorPhase}-artifact-002`],
    openQuestions: ["What minimum evidence is still missing to proceed confidently?"],
    confidence: 0.81,
    recommendedNextAction: `Advance ${seed.programName} into ${agentId} with a concrete, decision-ready package.`,
  };
}

function createCrossPhaseContext(agentId: AdamAgentId, seed: ScenarioSeed): string | undefined {
  if (agentId === "strategy") return undefined;
  return [
    `Prior phase context for ${seed.programName}:`,
    `- Approved scope focuses on ${seed.goal.toLowerCase()}.`,
    `- Baseline signals include: ${seed.baselineMetrics.slice(0, 2).join(" | ")}.`,
    `- Non-negotiable constraints: ${seed.constraints.slice(0, 2).join(" | ")}.`,
    `- Risks already called out: ${seed.knownRisks.slice(0, 2).join(" | ")}.`,
  ].join("\n");
}

function buildExpectedTraits(agentId: AdamAgentId, seed: ScenarioSeed): ExpectedTrait[] {
  const shouldPause = seed.code === "pause_001";
  if (shouldPause) {
    return [
      {
        dimension: "pause_behavior",
        description: `The ${agentId} agent must pause instead of manufacturing a complete output when the supplied context is missing the evidence required for this phase.`,
        evaluator: "custom",
        weight: 0.35,
        evaluatorConfig: { shouldPause: true },
      },
      {
        dimension: "confidence_calibration",
        description: "Confidence should fall below completion threshold or the agent should explicitly pause.",
        evaluator: "custom",
        weight: 0.2,
        evaluatorConfig: { contextQuality: "critical_missing" },
      },
      {
        dimension: "tone",
        description: "The pause should be professional, factual, and enterprise-ready rather than apologetic or vague.",
        evaluator: "llm",
        weight: 0.1,
      },
      {
        dimension: "hallucination",
        description: "The agent must not invent sponsors, baselines, ROI numbers, or governance conditions that are not present.",
        evaluator: "llm",
        weight: 0.15,
      },
      {
        dimension: "specificity",
        description: "If the agent pauses, it should ask a concrete decision question with useful options rather than a generic request for more detail.",
        evaluator: "llm",
        weight: 0.2,
      },
    ];
  }

  return [
    {
      dimension: "schema_validity",
      description: "Output must parse cleanly and satisfy the registered schema.",
      evaluator: "schema",
      weight: 0.18,
    },
    {
      dimension: "completeness",
      description: "All required fields should be populated with meaningful content rather than placeholders.",
      evaluator: "custom",
      weight: 0.14,
    },
    {
      dimension: "specificity",
      description: `The output should be concrete, using named metrics, owners, thresholds, or decisions appropriate for ${seed.programName}.`,
      evaluator: "llm",
      weight: 0.15,
    },
    {
      dimension: seed.code === "adv_001" ? "consistency" : "accuracy",
      description: seed.code === "adv_001"
        ? "The output should resolve contradictory inputs without ignoring critical constraints or prior-phase evidence."
        : "The output should be grounded in the provided program context rather than generic transformation advice.",
      evaluator: "llm",
      weight: 0.14,
    },
    {
      dimension: "confidence_calibration",
      description: "Confidence should reflect the quality and completeness of the evidence, not arbitrary optimism.",
      evaluator: "custom",
      weight: 0.12,
      evaluatorConfig: {
        contextQuality: seed.code.startsWith("happy") ? "high" : seed.code === "adv_001" ? "mixed" : "medium",
      },
    },
    {
      dimension: "pause_behavior",
      description: "The agent should continue normally and not pause when the context is sufficient to proceed.",
      evaluator: "custom",
      weight: 0.09,
      evaluatorConfig: { shouldPause: false },
    },
    {
      dimension: "tone",
      description: "Tone should sound like an enterprise transformation specialist rather than a generic chatbot or marketing writer.",
      evaluator: "llm",
      weight: 0.08,
    },
    {
      dimension: "hallucination",
      description: "The output must avoid invented facts, names, or figures that do not appear in the input context.",
      evaluator: "llm",
      weight: 0.1,
    },
  ];
}

function buildAntiPatterns(profile: AgentScenarioProfile): AntiPattern[] {
  return [
    {
      description: "Uses placeholder language such as TBD, lorem ipsum, or generic bullets.",
      pattern: "\\b(TBD|placeholder|lorem ipsum|to be confirmed)\\b",
    },
    {
      description: "Falls back to generic consulting language rather than program-specific outputs.",
      llmCheck: `Does the output avoid generic enterprise filler and instead address the specific ${profile.agentName} responsibilities for this case?`,
    },
    {
      description: `Omits the evidence types that matter most for this agent: ${profile.requiredEvidence.join(", ")}.`,
      llmCheck: `Does the output explicitly cover ${profile.requiredEvidence.join(", ")} rather than speaking in broad generalities?`,
    },
  ];
}

function buildCase(agentId: AdamAgentId, seed: ScenarioSeed): EvalCase {
  const profile = AGENT_PROFILES[agentId];
  const namePrefix = `${seed.industry} — ${seed.programName}`;
  return {
    id: `${agentId}_${seed.code}`,
    agentId,
    name: `${namePrefix} (${seed.code.replace("_", " ")})`,
    description: profile.caseFocus[seed.code],
    input: {
      programContext: createProgramContext(seed),
      crossPhaseContext: createCrossPhaseContext(agentId, seed),
      memory: createMemory(agentId, seed),
      incomingHandoff: createHandoff(agentId, seed),
    },
    expectedOutputTraits: buildExpectedTraits(agentId, seed),
    antiPatterns: buildAntiPatterns(profile),
    tags: [...seed.tags],
  };
}

export const ADAM_EVAL_DATASET: EvalCase[] = (Object.keys(AGENT_PROFILES) as AdamAgentId[]).flatMap((agentId) => (
  SCENARIO_SEEDS.map((seed) => buildCase(agentId, seed))
));

export function getEvalCasesForAgent(agentId: AdamAgentId): EvalCase[] {
  return ADAM_EVAL_DATASET.filter((entry) => entry.agentId === agentId);
}

export function getEvalCase(caseId: string): EvalCase {
  const match = ADAM_EVAL_DATASET.find((entry) => entry.id === caseId);
  if (!match) {
    throw new Error(`Unknown eval case: ${caseId}`);
  }
  return match;
}
