export interface WalkthroughStep {
  id: string;
  phase: string;
  phaseLabel: string;
  phaseIcon: string;
  action: string;
  type: "input" | "artifact" | "gate" | "advance" | "verify";
  field?: string;
  value?: any;
  artifactType?: string;
  artifactContent?: string;
  expectedOutcome: string;
  verifyFn?: (data: any) => boolean;
}

export const WALKTHROUGH_PHASES = [
  { id: "strategy", label: "Strategy", icon: "🎯" },
  { id: "mobilise", label: "Mobilise", icon: "👥" },
  { id: "discover", label: "Discover", icon: "🔍" },
  { id: "design", label: "Design", icon: "🏗️" },
  { id: "build", label: "Build", icon: "🔨" },
  { id: "govern", label: "Govern", icon: "🏛️" },
  { id: "operate", label: "Operate", icon: "⚙️" },
  { id: "valuerealize", label: "Value Realize", icon: "💰" },
] as const;

const TODAY_LABEL = new Date().toLocaleDateString("en-US");

export const WALKTHROUGH_PROGRAM = {
  name: "Invoice Processing Automation",
  strategy: {
    businessProblem: "Finance team manually processes 500+ invoices per month. Each invoice takes 15 minutes on average. Errors cause payment delays and supplier relationship issues.",
    desiredOutcome: "Reduce invoice processing time by 70% and error rate by 90% within 90 days of deployment.",
    sponsor: "Chief Financial Officer",
    objectives: [
      "Automate invoice data extraction and validation",
      "Route exceptions to human reviewers with full context",
      "Integrate with existing ERP system for payment processing",
    ],
    valueHypothesis: "An L2 Invoice Intelligence Agent processing 500 invoices/month at 70% time reduction saves 125 hours/month. At $75/hour fully loaded cost, this delivers $9,375/month or $112,500 annually.",
    constraints: [
      "All payment approvals must remain with human finance team — no autonomous payments",
      "Must integrate with SAP ERP",
      "PII data must not leave the corporate network — on-premise or private cloud only",
    ],
    baselineMetrics: {
      "bm-001": { name: "Average invoice processing time", currentValue: 15, unit: "minutes/invoice", source: "Finance ops time study Q1 2026", date: "2026-01-20" },
      "bm-002": { name: "Monthly invoice volume", currentValue: 500, unit: "invoices/month", source: "ERP transaction log", date: "2026-01-20" },
      "bm-003": { name: "Invoice error rate", currentValue: 8, unit: "%", source: "Finance audit Q4 2025", date: "2026-01-15" },
    },
  },
  mobilise: {
    deliveryRoles: [
      { role: "Program Sponsor", personKey: "cfo-001", name: "Diana Osei", allocation: 0.1 },
      { role: "Program Manager", personKey: "pm-001", name: "Marcus Webb", allocation: 1.0 },
      { role: "Developer", personKey: "dev-001", name: "Fatima Al-Rashid", allocation: 1.0 },
      { role: "Business Analyst", personKey: "ba-001", name: "James Thornton", allocation: 0.8 },
    ],
    raci: {
      "Invoice Intelligence Agent": {
        responsible: "Developer",
        accountable: "Program Sponsor",
        consulted: ["Business Analyst"],
        informed: ["Finance Team"],
      },
    },
    governanceModel: {
      steeringCommittee: ["Diana Osei", "CFO Office"],
      reviewCadence: "weekly",
      escalationPath: "Program Manager → Program Sponsor → CFO",
    },
  },
  discover: {
    capabilityDNA: [{
      id: "cap-001",
      name: "Invoice Intelligence Agent",
      description: "Ingests invoice PDFs and emails, extracts structured data (vendor, amount, line items, due date), validates against PO database, flags exceptions, and routes to human approver with full context package.",
      autonomyLevel: 2,
      approved: true,
      humanInTheLoop: true,
      hitlPolicy: "All payment approvals require human sign-off from Finance Analyst or CFO. Agent may extract and validate but never initiates payment.",
      dataClassification: "Confidential — Financial",
      dataResidency: "On-Premise",
      integrations: ["SAP ERP", "Email (Exchange)", "Document Store (SharePoint)"],
    }],
    kpis: [
      { id: "kpi-001", name: "Invoice processing time", target: "70% reduction (15 min → 4.5 min)", unit: "minutes/invoice", measuredValue: null },
      { id: "kpi-002", name: "Invoice error rate", target: "90% reduction (8% → 0.8%)", unit: "%", measuredValue: null },
      { id: "kpi-003", name: "Monthly hours saved", target: "≥ 125 hours/month", unit: "hours/month", measuredValue: null },
    ],
    stakeholders: [
      { name: "Diana Osei", role: "CFO / Sponsor", interest: "high", influence: "high" },
      { name: "Finance Team (8 analysts)", role: "End Users", interest: "high", influence: "medium" },
      { name: "IT Security", role: "Compliance Gate", interest: "high", influence: "high" },
      { name: "Suppliers (500+)", role: "Indirect", interest: "low", influence: "low" },
    ],
    opportunityAssessment: {
      feasibility: "high",
      strategicAlignment: "high",
      estimatedEffort: "medium",
      riskRating: "low",
      recommendation: "Proceed to Design",
    },
  },
  design: {
    architectureDecisions: [
      { id: "adr-001", title: "Document extraction engine", decision: "Use Azure Document Intelligence (Form Recognizer) deployed in private Azure environment with VNet peering to corporate network", decisionMaker: "Fatima Al-Rashid", alternatives: "On-premise Tesseract OCR, AWS Textract (rejected — data residency)", constraints: "PII must not leave corporate network — private Azure VNet selected", reversibility: "partially-reversible", status: "approved", supersededBy: null },
      { id: "adr-002", title: "ERP integration pattern", decision: "SAP BAPI integration via RFC calls using certified SAP .NET connector", decisionMaker: "Fatima Al-Rashid", alternatives: "SAP REST API (not available on current version), direct DB write (rejected — bypasses controls)", constraints: "Must use certified integration paths only — direct DB writes violate SAP support policy", reversibility: "reversible", status: "approved", supersededBy: null },
    ],
    agentBlueprint: {
      agentName: "InvoiceIQ",
      agentType: "assistive",
      autonomyLevel: 2,
      inputs: ["Invoice PDF or email attachment", "Vendor master data from SAP", "Open PO list from SAP"],
      outputs: ["Structured invoice data (JSON)", "3-way match result (PO / GR / Invoice)", "Exception report with recommended action", "Human approval package"],
      tools: ["Azure Document Intelligence", "SAP BAPI connector", "SharePoint API", "Exchange Web Services"],
      guardrails: ["Never initiate payment — approval package only", "Flag invoices > $10,000 for CFO review regardless of match status", "Reject invoices with missing mandatory fields — do not guess", "Audit log every action with timestamp and actor"],
    },
    skillCatalog: [
      { id: "sk-001", name: "Invoice OCR extraction", description: "Extract structured fields from PDF and image invoices using Azure Document Intelligence", type: "data-processing" },
      { id: "sk-002", name: "3-way PO matching", description: "Match invoice against Purchase Order and Goods Receipt in SAP", type: "reasoning" },
      { id: "sk-003", name: "Exception classification", description: "Classify discrepancies (amount variance, duplicate, missing PO) and recommend action", type: "nlp" },
      { id: "sk-004", name: "Approval routing", description: "Build contextual approval package and route to correct approver via email and SharePoint", type: "integration" },
    ],
  },
  build: {
    deploymentChecklist: {
      infraProvisioned: true,
      azureDocumentIntelligenceConfigured: true,
      sapIntegrationTested: true,
      sharepointIntegrationTested: true,
      exchangeIntegrationTested: true,
      securityReviewPassed: true,
      performanceTestPassed: true,
      hitlWorkflowTested: true,
    },
    acceptanceCriteria: [
      { id: "ac-001", criterion: "Invoice data extraction accuracy ≥ 95% on test set of 100 invoices", status: "passed" },
      { id: "ac-002", criterion: "3-way matching completes within 30 seconds per invoice", status: "passed" },
      { id: "ac-003", criterion: "Exception classification accuracy ≥ 90% validated by Finance Analyst", status: "passed" },
      { id: "ac-004", criterion: "HITL approval package contains all required fields for human decision", status: "passed" },
      { id: "ac-005", criterion: "Security review passed — no invoice data leaves corporate network boundary", status: "passed" },
      { id: "ac-006", criterion: "SAP BAPI calls use only approved integration patterns — certified connector only", status: "passed" },
    ],
    testPlan: { totalCases: 50, passed: 50, failed: 0, blocked: 0 },
    artifacts: [],
  },
  govern: {
    governanceFramework: {
      escalationPathDefined: true,
      auditReviewFrequency: "monthly",
      boardReportingCadence: "quarterly",
      separationOfDutiesEnforced: true,
      aiModelVersioningPolicy: true,
      aiModelVersioningPolicyDetail: "All Azure Document Intelligence model updates require: regression test on 100-invoice test set, Finance Analyst sign-off on accuracy metrics, IT Security approval, and CFO notification before production deployment.",
    },
    riskRegister: [
      { id: "risk-001", risk: "Incorrect invoice amount extracted leads to overpayment", likelihood: "low", impact: "critical", mitigation: "HITL review required for all payments; amount variance > 5% auto-flagged for manual verification" },
      { id: "risk-002", risk: "SAP integration disruption during ERP upgrade", likelihood: "medium", impact: "high", mitigation: "Tested against SAP test client; fallback to manual processing with 24h SLA during maintenance windows" },
      { id: "risk-003", risk: "Duplicate invoice processing", likelihood: "low", impact: "medium", mitigation: "Duplicate detection checks invoice number + vendor + amount hash against 90-day rolling window" },
    ],
    complianceChecklist: {
      gdprAssessed: true,
      euAiActCategoryDetermined: true,
      securityReviewCompleted: true,
      dataPrivacyImpactAssessment: true,
    },
  },
  operate: {
    trustGraduationEvidence: {
      testCasesPassed: 50,
      userValidationCount: 6,
      monitoredHours: 168,
      hitlComplianceRate: 1.0,
    },
    runbookItems: [
      { id: "rb-001", scenario: "Azure Document Intelligence API unavailable", procedure: "Queue invoices in SharePoint holding folder. Alert Marcus Webb via Teams. Auto-retry every 30 minutes. Escalate to CFO after 4 hours.", owner: "Marcus Webb" },
      { id: "rb-002", scenario: "SAP RFC connection failure", procedure: "Suspend processing. Notify Fatima Al-Rashid. Verify SAP system status via SAP Solution Manager. Do not process invoices without ERP connectivity — PO matching cannot be confirmed.", owner: "Fatima Al-Rashid" },
      { id: "rb-003", scenario: "Extraction accuracy drops below 90%", procedure: "Suspend agent. Notify Fatima Al-Rashid. Re-run test set. Review model version. Finance Analyst manually processes invoice queue until resolved.", owner: "Fatima Al-Rashid" },
    ],
    monitoringSetup: { alertingConfigured: true, dashboardCreated: true, slasDefined: true },
  },
  valuerealize: {
    kpis: [
      { id: "kpi-001", name: "Invoice processing time", target: "70% reduction", unit: "minutes/invoice", measuredValue: 4.2, achievedAt: "2026-06-08" },
      { id: "kpi-002", name: "Invoice error rate", target: "90% reduction", unit: "%", measuredValue: 0.6, achievedAt: "2026-06-08" },
      { id: "kpi-003", name: "Monthly hours saved", target: "≥ 125 hours/month", unit: "hours/month", measuredValue: 131, achievedAt: "2026-06-08" },
    ],
    lessonsForNextCycle: "On-premise data residency added 4 weeks to the Azure private VNet configuration — budget this into future programs with strict data residency requirements. SAP BAPI integration was more stable than expected but required 3 weeks of SAP Basis team availability — plan for their schedule early. Finance team adoption was excellent (100% HITL compliance) partly because they were involved in defining the exception criteria. Co-design of approval package with end users was the single most impactful activity in the program.",
    artifacts: [
      { id: "att-001", type: "stakeholderAttestation", status: "approved", title: "Stakeholder Outcome Attestation — Invoice Processing Automation", createdBy: "ba-001", approvedBy: "cfo-001", approvedAt: "2026-06-09" },
    ],
  },
  twinGraph: { nodes: [], edges: [] },
  customContradictionRules: [],
};

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  { id: "step-001", phase: "strategy", phaseLabel: "Strategy", phaseIcon: "🎯", action: "Create new program", type: "input", field: "name", value: "Invoice Processing Automation", expectedOutcome: "Program created with name set", verifyFn: (d) => d?.name === "Invoice Processing Automation" },
  { id: "step-002", phase: "strategy", phaseLabel: "Strategy", phaseIcon: "🎯", action: "Define business problem", type: "input", field: "strategy.businessProblem", value: WALKTHROUGH_PROGRAM.strategy.businessProblem, expectedOutcome: "Business problem field populated", verifyFn: (d) => !!d?.strategy?.businessProblem },
  { id: "step-003", phase: "strategy", phaseLabel: "Strategy", phaseIcon: "🎯", action: "Set desired outcome", type: "input", field: "strategy.desiredOutcome", value: WALKTHROUGH_PROGRAM.strategy.desiredOutcome, expectedOutcome: "Desired outcome field populated", verifyFn: (d) => !!d?.strategy?.desiredOutcome },
  { id: "step-004", phase: "strategy", phaseLabel: "Strategy", phaseIcon: "🎯", action: "Identify program sponsor", type: "input", field: "strategy.sponsor", value: "Chief Financial Officer", expectedOutcome: "Sponsor field populated", verifyFn: (d) => !!d?.strategy?.sponsor },
  { id: "step-005", phase: "strategy", phaseLabel: "Strategy", phaseIcon: "🎯", action: "Document value hypothesis", type: "input", field: "strategy.valueHypothesis", value: WALKTHROUGH_PROGRAM.strategy.valueHypothesis, expectedOutcome: "Value hypothesis populated", verifyFn: (d) => !!d?.strategy?.valueHypothesis },
  { id: "step-006", phase: "strategy", phaseLabel: "Strategy", phaseIcon: "🎯", action: "Capture 3 baseline metrics", type: "input", field: "strategy.baselineMetrics", value: WALKTHROUGH_PROGRAM.strategy.baselineMetrics, expectedOutcome: "3 baseline metrics captured", verifyFn: (d) => Object.keys(d?.strategy?.baselineMetrics ?? {}).length >= 3 },
  {
    id: "step-007",
    phase: "strategy",
    phaseLabel: "Strategy",
    phaseIcon: "🎯",
    action: "Generate Outcome Charter artifact",
    type: "artifact",
    artifactType: "Outcome Charter",
    artifactContent: `# Outcome Charter — Invoice Processing Automation

**Sponsor:** Chief Financial Officer (Diana Osei)
**Program Manager:** Marcus Webb
**Date:** ${TODAY_LABEL}

## Business Problem
Finance team manually processes 500+ invoices per month at 15 minutes each, resulting in 125 hours of manual labor monthly. An 8% error rate causes payment delays and damages supplier relationships.

## Desired Outcome
Reduce invoice processing time by 70% (15 min → 4.5 min) and error rate by 90% (8% → 0.8%) within 90 days of deployment.

## Value at Stake
- **Time saving:** 125 hours/month recovered
- **Financial value:** $9,375/month ($112,500/year) at $75/hour fully loaded
- **Quality improvement:** Error rate from 8% to <1%

## Strategic Alignment
Directly supports CFO FY2026 initiative: Finance Process Automation. Frees Finance Analysts for higher-value analytical work.

## Constraints
- All payment approvals remain with human finance team
- PII and financial data must not leave corporate network
- Integration must use certified SAP connector paths only

## Success Criteria
- 70% reduction in processing time measured over 30-day post-deployment period
- 90% reduction in error rate verified by Finance Analyst audit
- ≥ 80% Finance team adoption within 60 days`,
    expectedOutcome: "Outcome Charter artifact generated and saved",
    verifyFn: (d) => (d?.strategy?.artifacts?.length ?? 0) > 0,
  },
  { id: "step-008", phase: "strategy", phaseLabel: "Strategy", phaseIcon: "🎯", action: "Verify Strategy exit criteria", type: "gate", expectedOutcome: "All Strategy exit criteria passing — business problem, outcome, sponsor, baseline metrics, value hypothesis defined", verifyFn: (d) => !!d?.strategy?.businessProblem && !!d?.strategy?.sponsor && Object.keys(d?.strategy?.baselineMetrics ?? {}).length > 0 },

  { id: "step-009", phase: "mobilise", phaseLabel: "Mobilise", phaseIcon: "👥", action: "Add Program Sponsor to team roster", type: "input", field: "mobilise.deliveryRoles", value: WALKTHROUGH_PROGRAM.mobilise.deliveryRoles, expectedOutcome: "4 team members added including Sponsor, PM, Developer, BA", verifyFn: (d) => (d?.mobilise?.deliveryRoles?.length ?? 0) >= 4 },
  { id: "step-010", phase: "mobilise", phaseLabel: "Mobilise", phaseIcon: "👥", action: "Define RACI for Invoice Intelligence Agent", type: "input", field: "mobilise.raci", value: WALKTHROUGH_PROGRAM.mobilise.raci, expectedOutcome: "RACI defined with Accountable role assigned", verifyFn: (d) => !!d?.mobilise?.raci?.["Invoice Intelligence Agent"]?.accountable },
  {
    id: "step-011",
    phase: "mobilise",
    phaseLabel: "Mobilise",
    phaseIcon: "👥",
    action: "Generate Team Charter artifact",
    type: "artifact",
    artifactType: "Team Charter",
    artifactContent: `# Team Charter — Invoice Processing Automation

## Team Composition
| Role | Name | Allocation |
|---|---|---|
| Program Sponsor | Diana Osei (CFO) | 10% |
| Program Manager | Marcus Webb | 100% |
| Developer | Fatima Al-Rashid | 100% |
| Business Analyst | James Thornton | 80% |

## RACI — Invoice Intelligence Agent
| Activity | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|
| Capability Development | Developer | Program Sponsor | Business Analyst | Finance Team |
| Testing & Validation | Business Analyst | Program Manager | Developer | Finance Team |
| Production Deployment | Developer | Program Manager | IT Security | CFO |

## Governance
- **Review cadence:** Weekly standup + bi-weekly steering
- **Escalation:** Program Manager → Program Sponsor → CFO
- **Decisions:** Architecture decisions require Program Manager approval; spend decisions require CFO approval

## Ways of Working
- Daily async update via Teams channel #invoice-automation
- All artifacts stored in SharePoint: Finance Transformation / Invoice Automation
- Change requests require written approval from Program Sponsor`,
    expectedOutcome: "Team Charter artifact generated",
    verifyFn: (d) => (d?.mobilise?.artifacts?.length ?? 0) > 0,
  },
  { id: "step-012", phase: "mobilise", phaseLabel: "Mobilise", phaseIcon: "👥", action: "Verify Mobilise exit criteria", type: "gate", expectedOutcome: "Team defined, RACI complete with accountable role, governance model documented", verifyFn: (d) => (d?.mobilise?.deliveryRoles?.length ?? 0) >= 3 && Object.values(d?.mobilise?.raci ?? {}).every((r: any) => r?.accountable) },

  { id: "step-013", phase: "discover", phaseLabel: "Discover", phaseIcon: "🔍", action: "Define Invoice Intelligence Agent Capability DNA", type: "input", field: "discover.capabilityDNA", value: WALKTHROUGH_PROGRAM.discover.capabilityDNA, expectedOutcome: "Capability DNA created with L2 autonomy level and HITL policy", verifyFn: (d) => d?.discover?.capabilityDNA?.some((c: any) => c?.approved) },
  { id: "step-014", phase: "discover", phaseLabel: "Discover", phaseIcon: "🔍", action: "Define 3 measurable KPIs", type: "input", field: "discover.kpis", value: WALKTHROUGH_PROGRAM.discover.kpis, expectedOutcome: "3 KPIs defined with targets", verifyFn: (d) => (d?.discover?.kpis?.length ?? 0) >= 3 },
  { id: "step-015", phase: "discover", phaseLabel: "Discover", phaseIcon: "🔍", action: "Map 4 stakeholders", type: "input", field: "discover.stakeholders", value: WALKTHROUGH_PROGRAM.discover.stakeholders, expectedOutcome: "4 stakeholders mapped with interest and influence levels", verifyFn: (d) => (d?.discover?.stakeholders?.length ?? 0) >= 4 },
  { id: "step-016", phase: "discover", phaseLabel: "Discover", phaseIcon: "🔍", action: "Complete opportunity assessment", type: "input", field: "discover.opportunityAssessment", value: WALKTHROUGH_PROGRAM.discover.opportunityAssessment, expectedOutcome: "Opportunity assessment completed with Proceed recommendation", verifyFn: (d) => !!d?.discover?.opportunityAssessment?.recommendation },
  {
    id: "step-017",
    phase: "discover",
    phaseLabel: "Discover",
    phaseIcon: "🔍",
    action: "Generate Opportunity Assessment artifact",
    type: "artifact",
    artifactType: "Opportunity Assessment",
    artifactContent: `# Opportunity Assessment — Invoice Processing Automation

## Executive Summary
The Invoice Processing Automation program is **highly feasible** with **high strategic alignment** and a compelling financial return. Recommend proceeding to Design phase.

## Opportunity Sizing
| Metric | Current | Target | Value |
|---|---|---|---|
| Processing time/invoice | 15 min | 4.5 min | 70% reduction |
| Monthly invoices | 500 | 500 | — |
| Error rate | 8% | 0.8% | 90% reduction |
| Hours saved/month | — | 125 hrs | $9,375/month |

## Capability Assessment
**Invoice Intelligence Agent (L2 Autonomy)**
- Feasibility: High — document extraction and ERP integration are well-understood patterns
- Risk: Low — L2 autonomy means no autonomous payments; all decisions remain with humans
- Readiness: Medium — SAP integration requires 2-week Basis team engagement

## Stakeholder Readiness
- Finance Team: High interest, actively requesting automation
- IT Security: Engaged — data residency constraint well understood
- CFO: Champion sponsor with clear business case

## Recommendation
✅ **PROCEED TO DESIGN**
The business case is clear, the team is assembled, and the technical path is validated. No blockers to Design entry.`,
    expectedOutcome: "Opportunity Assessment artifact generated",
    verifyFn: (d) => (d?.discover?.artifacts?.length ?? 0) > 0,
  },
  { id: "step-018", phase: "discover", phaseLabel: "Discover", phaseIcon: "🔍", action: "Verify Discover exit criteria", type: "gate", expectedOutcome: "Approved capability, KPIs defined, opportunity assessment complete", verifyFn: (d) => d?.discover?.capabilityDNA?.some((c: any) => c?.approved) && (d?.discover?.kpis?.length ?? 0) >= 1 },

  { id: "step-019", phase: "design", phaseLabel: "Design", phaseIcon: "🏗️", action: "Record 2 Architecture Decisions in ADR format", type: "input", field: "design.architectureDecisions", value: WALKTHROUGH_PROGRAM.design.architectureDecisions, expectedOutcome: "2 ADRs recorded with decisionMaker, alternatives, constraints, reversibility", verifyFn: (d) => (d?.design?.architectureDecisions?.length ?? 0) >= 2 },
  { id: "step-020", phase: "design", phaseLabel: "Design", phaseIcon: "🏗️", action: "Define InvoiceIQ Agent Blueprint", type: "input", field: "design.agentBlueprint", value: WALKTHROUGH_PROGRAM.design.agentBlueprint, expectedOutcome: "Agent Blueprint defined with inputs, outputs, tools, guardrails", verifyFn: (d) => !!d?.design?.agentBlueprint?.agentName },
  { id: "step-021", phase: "design", phaseLabel: "Design", phaseIcon: "🏗️", action: "Define 4 skills in Skill Catalog", type: "input", field: "design.skillCatalog", value: WALKTHROUGH_PROGRAM.design.skillCatalog, expectedOutcome: "4 skills defined covering data-processing, reasoning, nlp, integration", verifyFn: (d) => (d?.design?.skillCatalog?.length ?? 0) >= 4 },
  {
    id: "step-022",
    phase: "design",
    phaseLabel: "Design",
    phaseIcon: "🏗️",
    action: "Generate Architecture Package artifact",
    type: "artifact",
    artifactType: "Architecture Package",
    artifactContent: `# Architecture Package — Invoice Processing Automation

## Agent: InvoiceIQ
Autonomy Level: L2 (Assistive — human approves all payments)

## Data Flow
\`\`\`
Invoice (PDF/Email)
    ↓
Azure Document Intelligence (Private VNet)
    ↓ Structured JSON
SAP BAPI Connector → 3-Way Match (PO / GR / Invoice)
    ↓ Match Result + Exceptions
Exception Classifier
    ↓ Approval Package
Human Approver (Finance Analyst / CFO)
    ↓ Approval Decision
SAP BAPI → Payment Release
\`\`\`

## Architecture Decisions
### ADR-001: Document Extraction Engine
- **Decision:** Azure Document Intelligence in private VNet
- **Alternatives considered:** On-premise Tesseract OCR, AWS Textract
- **AWS Textract rejected:** Data residency — financial data cannot leave corporate network
- **Reversibility:** Partially reversible

### ADR-002: ERP Integration Pattern
- **Decision:** SAP BAPI via RFC using certified SAP .NET connector
- **Alternatives considered:** SAP REST API (not available on current version), direct DB write
- **Direct DB write rejected:** Bypasses SAP controls, voids support contract
- **Reversibility:** Reversible

## Security Controls
- All data processed within corporate network boundary (Azure private VNet)
- No invoice data stored beyond processing session
- Audit log for every agent action with timestamp, actor, and outcome
- Invoices > $10,000 auto-routed to CFO regardless of match status

## Non-Functional Requirements
- Processing time: < 30 seconds per invoice
- Availability: 99.5% during finance business hours (07:00–19:00 Mon–Fri)
- Audit retention: 7 years (regulatory requirement)`,
    expectedOutcome: "Architecture Package artifact generated",
    verifyFn: (d) => (d?.design?.artifacts?.length ?? 0) > 0,
  },
  { id: "step-023", phase: "design", phaseLabel: "Design", phaseIcon: "🏗️", action: "Verify Design exit criteria", type: "gate", expectedOutcome: "ADRs complete, agent blueprint defined, skill catalog populated", verifyFn: (d) => (d?.design?.architectureDecisions?.length ?? 0) >= 1 && !!d?.design?.agentBlueprint?.agentName && (d?.design?.skillCatalog?.length ?? 0) >= 1 },

  { id: "step-024", phase: "build", phaseLabel: "Build", phaseIcon: "🔨", action: "Define 6 acceptance criteria", type: "input", field: "build.acceptanceCriteria", value: WALKTHROUGH_PROGRAM.build.acceptanceCriteria, expectedOutcome: "6 acceptance criteria defined", verifyFn: (d) => (d?.build?.acceptanceCriteria?.length ?? 0) >= 6 },
  { id: "step-025", phase: "build", phaseLabel: "Build", phaseIcon: "🔨", action: "Mark all acceptance criteria as passed", type: "input", field: "build.deploymentChecklist", value: WALKTHROUGH_PROGRAM.build.deploymentChecklist, expectedOutcome: "All acceptance criteria passing, security review passed", verifyFn: (d) => d?.build?.acceptanceCriteria?.every((ac: any) => ac?.status === "passed") },
  { id: "step-026", phase: "build", phaseLabel: "Build", phaseIcon: "🔨", action: "Record test plan — 50 cases, all passing", type: "input", field: "build.testPlan", value: WALKTHROUGH_PROGRAM.build.testPlan, expectedOutcome: "Test plan recorded: 50 cases, 0 failures", verifyFn: (d) => (d?.build?.testPlan?.totalCases ?? 0) > 0 && (d?.build?.testPlan?.failed ?? 0) === 0 },
  {
    id: "step-027",
    phase: "build",
    phaseLabel: "Build",
    phaseIcon: "🔨",
    action: "Generate Build Package artifact",
    type: "artifact",
    artifactType: "Build Package",
    artifactContent: `# Build Package — Invoice Processing Automation

## Test Execution Summary
| Category | Count |
|---|---|
| Total test cases | 50 |
| Passed | 50 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |

## Acceptance Criteria Results
✅ Invoice data extraction accuracy ≥ 95% — **Achieved: 97.2%** on 100-invoice test set
✅ 3-way matching completes within 30 seconds — **Achieved: 8.3 seconds average**
✅ Exception classification accuracy ≥ 90% — **Achieved: 93.1%** validated by Finance Analyst
✅ HITL approval package contains all required fields — **Verified by James Thornton**
✅ Security review passed — **No data leaves corporate network** — verified by IT Security
✅ SAP BAPI calls use only approved integration patterns — **Certified connector confirmed**

## Deployment Checklist
✅ Azure private VNet provisioned and tested
✅ Azure Document Intelligence configured and model trained on 200 sample invoices
✅ SAP RFC connection tested — BAPI calls validated against SAP test client
✅ SharePoint document library configured for approval packages
✅ Exchange Web Services integration tested — routing rules verified
✅ Security review completed by IT Security team
✅ Performance test: 500 invoices processed in 68 minutes (under 1-hour SLA)
✅ HITL workflow tested with Finance Analyst team — approval UI approved by users

## Known Limitations
- Handwritten invoices not supported in v1 — flagged for manual processing
- Non-English invoices require manual field review — documented in runbook`,
    expectedOutcome: "Build Package artifact generated",
    verifyFn: (d) => (d?.build?.artifacts?.length ?? 0) > 0,
  },
  { id: "step-028", phase: "build", phaseLabel: "Build", phaseIcon: "🔨", action: "Verify Build exit criteria", type: "gate", expectedOutcome: "All ACs passing, security review passed, test plan recorded", verifyFn: (d) => d?.build?.acceptanceCriteria?.every((ac: any) => ac?.status === "passed") && !!(d?.build?.deploymentChecklist as any)?.securityReviewPassed },

  { id: "step-029", phase: "govern", phaseLabel: "Govern", phaseIcon: "🏛️", action: "Complete governance framework (all 5 fields)", type: "input", field: "govern.governanceFramework", value: WALKTHROUGH_PROGRAM.govern.governanceFramework, expectedOutcome: "All 5 governance framework fields complete including AI model versioning policy", verifyFn: (d) => !!(d?.govern?.governanceFramework as any)?.aiModelVersioningPolicy },
  { id: "step-030", phase: "govern", phaseLabel: "Govern", phaseIcon: "🏛️", action: "Add 3 risks to risk register", type: "input", field: "govern.riskRegister", value: WALKTHROUGH_PROGRAM.govern.riskRegister, expectedOutcome: "3 risks with likelihood, impact, and mitigation", verifyFn: (d) => (d?.govern?.riskRegister?.length ?? 0) >= 3 },
  { id: "step-031", phase: "govern", phaseLabel: "Govern", phaseIcon: "🏛️", action: "Complete compliance checklist", type: "input", field: "govern.complianceChecklist", value: WALKTHROUGH_PROGRAM.govern.complianceChecklist, expectedOutcome: "GDPR, EU AI Act, security review, DPIA all complete", verifyFn: (d) => !!(d?.govern?.complianceChecklist as any)?.securityReviewCompleted },
  {
    id: "step-032",
    phase: "govern",
    phaseLabel: "Govern",
    phaseIcon: "🏛️",
    action: "Generate Governance Model artifact",
    type: "artifact",
    artifactType: "Governance Model",
    artifactContent: `# Governance Model — Invoice Processing Automation

## Governance Framework
| Component | Detail |
|---|---|
| Escalation Path | Program Manager → Program Sponsor → CFO |
| Audit Review Frequency | Monthly — IT Security + Finance Analyst |
| Board Reporting Cadence | Quarterly CFO report |
| Separation of Duties | Enforced — artifact creators cannot self-approve |
| AI Model Versioning Policy | All model updates require regression test + CFO notification |

## Risk Register
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Incorrect amount extraction → overpayment | Low | Critical | HITL mandatory; >5% variance auto-flagged |
| SAP integration disruption during ERP upgrade | Medium | High | Fallback to manual; Basis team on standby |
| Duplicate invoice processing | Low | Medium | 90-day hash deduplication check |

## Compliance Status
✅ GDPR impact assessment completed
✅ EU AI Act: Limited Risk category confirmed (assistive tool, human in control)
✅ Security review passed — IT Security sign-off obtained
✅ Data Privacy Impact Assessment completed

## Ongoing Governance
- Monthly accuracy review against 10% random sample
- Quarterly model performance review
- Annual security re-assessment
- CFO notified of any model version changes before deployment`,
    expectedOutcome: "Governance Model artifact generated",
    verifyFn: (d) => (d?.govern?.artifacts?.length ?? 0) > 0,
  },
  { id: "step-033", phase: "govern", phaseLabel: "Govern", phaseIcon: "🏛️", action: "Verify Govern exit criteria", type: "gate", expectedOutcome: "All 5 governance fields complete, risk register populated, compliance checklist done", verifyFn: (d) => !!(d?.govern?.governanceFramework as any)?.aiModelVersioningPolicy && (d?.govern?.riskRegister?.length ?? 0) >= 1 },

  { id: "step-034", phase: "operate", phaseLabel: "Operate", phaseIcon: "⚙️", action: "Record trust graduation evidence (all 4 thresholds)", type: "input", field: "operate.trustGraduationEvidence", value: WALKTHROUGH_PROGRAM.operate.trustGraduationEvidence, expectedOutcome: "50 test cases, 6 user validations, 168 monitored hours, 100% HITL compliance", verifyFn: (d) => (d?.operate?.trustGraduationEvidence as any)?.testCasesPassed >= 10 },
  { id: "step-035", phase: "operate", phaseLabel: "Operate", phaseIcon: "⚙️", action: "Document 3 runbook scenarios", type: "input", field: "operate.runbookItems", value: WALKTHROUGH_PROGRAM.operate.runbookItems, expectedOutcome: "3 runbook scenarios with owner and procedure", verifyFn: (d) => (d?.operate?.runbookItems?.length ?? 0) >= 2 },
  {
    id: "step-036",
    phase: "operate",
    phaseLabel: "Operate",
    phaseIcon: "⚙️",
    action: "Generate Operations Runbook artifact",
    type: "artifact",
    artifactType: "Operations Runbook",
    artifactContent: `# Operations Runbook — InvoiceIQ Agent

## Monitoring
- **Dashboard:** Finance Ops SharePoint > InvoiceIQ Performance
- **Alerts:** Teams channel #invoiceiq-alerts
- **SLA:** 99.5% availability Mon–Fri 07:00–19:00

## Trust Graduation Evidence
| Evidence | Threshold | Actual |
|---|---|---|
| Test cases passed | ≥ 10 | **50 ✅** |
| User validations | ≥ 3 | **6 ✅** |
| Monitored hours without incident | ≥ 24 | **168 ✅** |
| HITL compliance rate | ≥ 95% | **100% ✅** |

## Incident Response

### Scenario 1: Azure Document Intelligence API unavailable
**Owner:** Marcus Webb
1. Queue invoices in SharePoint holding folder (path: Finance > InvoiceIQ > Queue)
2. Alert Marcus Webb via Teams and email
3. Auto-retry every 30 minutes (configured in Azure Logic App)
4. If unresolved after 4 hours: escalate to CFO, activate manual processing fallback
5. Post incident report within 24 hours

### Scenario 2: SAP RFC connection failure
**Owner:** Fatima Al-Rashid
1. Suspend all invoice processing immediately — PO matching cannot be confirmed without ERP
2. Notify Fatima Al-Rashid and SAP Basis team
3. Verify SAP system status via SAP Solution Manager
4. Do not resume until RFC connection confirmed healthy
5. Process backlog invoices manually during outage — SLA: 4 hours

### Scenario 3: Extraction accuracy drops below 90%
**Owner:** Fatima Al-Rashid
1. Suspend agent processing immediately
2. Run 50-invoice test set to confirm accuracy degradation
3. Review Azure Document Intelligence model version changelog
4. Finance Analyst manually processes queue until resolved (SLA: same business day)
5. Rollback model version if recent update caused degradation`,
    expectedOutcome: "Operations Runbook generated",
    verifyFn: (d) => (d?.operate?.artifacts?.length ?? 0) > 0,
  },
  { id: "step-037", phase: "operate", phaseLabel: "Operate", phaseIcon: "⚙️", action: "Verify Operate exit criteria", type: "gate", expectedOutcome: "Trust graduation evidence meets all thresholds, runbook documented", verifyFn: (d) => (d?.operate?.trustGraduationEvidence as any)?.testCasesPassed >= 10 && (d?.operate?.runbookItems?.length ?? 0) >= 2 },

  { id: "step-038", phase: "valuerealize", phaseLabel: "Value Realize", phaseIcon: "💰", action: "Record measured KPI values after 30-day deployment", type: "input", field: "valuerealize.kpis", value: WALKTHROUGH_PROGRAM.valuerealize.kpis, expectedOutcome: "All 3 KPIs have measured values exceeding targets", verifyFn: (d) => (d?.valuerealize?.kpis ?? []).filter((k: any) => k?.measuredValue !== null).length >= 3 },
  { id: "step-039", phase: "valuerealize", phaseLabel: "Value Realize", phaseIcon: "💰", action: "Document lessons learned", type: "input", field: "valuerealize.lessonsForNextCycle", value: WALKTHROUGH_PROGRAM.valuerealize.lessonsForNextCycle, expectedOutcome: "Lessons learned documented (>50 chars)", verifyFn: (d) => (d?.valuerealize?.lessonsForNextCycle ?? "").length >= 50 },
  {
    id: "step-040",
    phase: "valuerealize",
    phaseLabel: "Value Realize",
    phaseIcon: "💰",
    action: "Generate Value Realization Report artifact",
    type: "artifact",
    artifactType: "Value Realization Report",
    artifactContent: `# Value Realization Report — Invoice Processing Automation

**Reporting Period:** 30 days post-deployment (2026-05-09 to 2026-06-08)
**Prepared by:** James Thornton, Business Analyst
**Approved by:** Diana Osei, CFO

## Executive Summary
All three program KPIs have been met or exceeded. The Invoice Processing Automation program delivered **$9,825/month in recovered productivity** in its first full month of operation — 104.8% of the target.

## KPI Performance
| KPI | Baseline | Target | Achieved | Status |
|---|---|---|---|---|
| Processing time/invoice | 15 min | 4.5 min (70% ↓) | **4.2 min (72% ↓)** | ✅ Exceeded |
| Invoice error rate | 8% | 0.8% (90% ↓) | **0.6% (92.5% ↓)** | ✅ Exceeded |
| Monthly hours saved | 0 | 125 hrs | **131 hrs** | ✅ Exceeded |

## Financial Value Delivered
- Hours saved this month: 131 hours
- Value at $75/hour: **$9,825/month**
- Annualised: **$117,900/year**
- Original target: $112,500/year
- **Variance: +$5,400/year (+4.8% above target)**

## Stakeholder Attestation
Outcome formally attested by Diana Osei (CFO) on 2026-06-09.
Attestation on file: SharePoint > Finance Transformation > Invoice Automation > Governance

## Lessons for Next Program Cycle
1. On-premise data residency adds 4 weeks to Azure VNet configuration — budget early
2. SAP Basis team availability is a critical path dependency — schedule 8 weeks ahead
3. Co-design of approval UI with Finance Analysts drove 100% HITL compliance
4. Handwritten invoice handling should be scoped into v2 — volume is ~3% of total`,
    expectedOutcome: "Value Realization Report generated",
    verifyFn: (d) => (d?.valuerealize?.artifacts ?? []).filter((a: any) => a?.type !== "stakeholderAttestation").length > 0,
  },
  {
    id: "step-041",
    phase: "valuerealize",
    phaseLabel: "Value Realize",
    phaseIcon: "💰",
    action: "Submit and approve Stakeholder Attestation",
    type: "artifact",
    artifactType: "Stakeholder Attestation",
    artifactContent: "Approved by Diana Osei, CFO — 2026-06-09",
    expectedOutcome: "Stakeholder attestation approved",
    verifyFn: (d) => (d?.valuerealize?.artifacts ?? []).some((a: any) => a?.type === "stakeholderAttestation" && a?.status === "approved"),
  },
  { id: "step-042", phase: "valuerealize", phaseLabel: "Value Realize", phaseIcon: "💰", action: "Verify ValueRealize exit criteria — program complete", type: "gate", expectedOutcome: "All KPIs measured, baseline comparison complete, attestation approved, lessons learned documented", verifyFn: (d) => (d?.valuerealize?.kpis ?? []).some((k: any) => k?.measuredValue !== null) && (d?.valuerealize?.lessonsForNextCycle ?? "").length >= 50 },
];
