export const SANITY_SEED_PROGRAM = {
  id: "sanity-email-autoresponder",
  name: "Email Auto-Responder",
  createdAt: new Date().toISOString(),
  status: "active",
  customContradictionRules: [],

  strategy: {
    businessProblem: "Sales team spends 2 hours per day manually responding to common customer enquiries.",
    desiredOutcome: "Reduce manual email response time by 60% within 60 days of deployment.",
    sponsor: "VP of Sales",
    objectives: ["Automate draft generation for common email enquiry types"],
    valueHypothesis: "An L2 AI agent drafting email replies saves 2 hours per sales rep per day, delivering approximately $18,000 per rep per year in recovered productivity.",
    constraints: ["Replies must be reviewed and sent by a human — no autonomous sending", "Must integrate with existing Gmail/Outlook"],
    baselineMetrics: {
      "bm-001": {
        name: "Manual email response time per sales rep per day",
        currentValue: 2,
        unit: "hours/day",
        source: "Sales ops time tracking Q1 2026",
        date: "2026-01-10",
      },
    },
  },

  mobilise: {
    deliveryRoles: [
      { role: "Program Sponsor", personKey: "sp-001", name: "Alice Ng", allocation: 0.1 },
      { role: "Program Manager", personKey: "pm-001", name: "Ben Carter", allocation: 1.0 },
      { role: "Developer", personKey: "dev-001", name: "Chloe Patel", allocation: 1.0 },
    ],
    raci: {
      "Email Auto-Responder Capability": {
        responsible: "Developer",
        accountable: "Program Sponsor",
        consulted: ["Program Manager"],
        informed: [],
      },
    },
    governanceModel: {
      steeringCommittee: ["Alice Ng"],
      reviewCadence: "weekly",
      escalationPath: "Program Manager → Program Sponsor",
    },
  },

  discover: {
    capabilityDNA: [
      {
        id: "cap-001",
        name: "Email Auto-Responder Capability",
        description: "Reads incoming customer emails, classifies enquiry type, drafts a reply using approved templates, and presents the draft to the sales rep for review and sending.",
        autonomyLevel: 2,
        approved: true,
        humanInTheLoop: true,
        hitlPolicy: "Every draft reviewed and approved by sales rep before sending. No autonomous email sending permitted.",
        dataClassification: "Internal",
        dataResidency: "US",
        integrations: ["Gmail API", "Outlook API"],
      },
    ],
    kpis: [
      {
        id: "kpi-001",
        name: "Manual email response time per rep per day",
        target: "60% reduction",
        unit: "hours/day",
        measuredValue: null,
      },
    ],
    stakeholders: [
      { name: "Alice Ng", role: "VP Sales / Sponsor", interest: "high", influence: "high" },
      { name: "Sales Team (12 reps)", role: "End Users", interest: "high", influence: "medium" },
    ],
    opportunityAssessment: {
      feasibility: "high",
      strategicAlignment: "high",
      estimatedEffort: "low",
      riskRating: "low",
      recommendation: "Proceed to Design",
    },
  },

  design: {
    architectureDecisions: [
      {
        id: "adr-001",
        title: "LLM selection for email drafting",
        decision: "Use OpenAI GPT-4o via API for email draft generation",
        decisionMaker: "Chloe Patel",
        alternatives: "Google Gemini, fine-tuned open-source model",
        constraints: "Cost per call must stay below $0.01; response time under 3 seconds",
        reversibility: "reversible",
        status: "approved",
        supersededBy: null,
      },
    ],
    agentBlueprint: {
      agentName: "ReplyBot",
      agentType: "assistive",
      autonomyLevel: 2,
      inputs: ["Incoming customer email text", "Sender name and account tier"],
      outputs: ["Draft reply for human review"],
      tools: ["OpenAI GPT-4o API", "Gmail API", "Outlook API"],
      guardrails: ["Never send autonomously", "Flag emails with complaints or legal language for human triage", "Max 3 draft attempts per email"],
    },
    skillCatalog: [
      { id: "sk-001", name: "Email classification", description: "Classify enquiry type from email body", type: "nlp" },
      { id: "sk-002", name: "Reply drafting", description: "Generate contextually appropriate reply draft", type: "nlp" },
    ],
  },

  build: {
    deploymentChecklist: {
      infraProvisioned: true,
      openAIConfigured: true,
      gmailIntegrationTested: true,
      outlookIntegrationTested: true,
      securityReviewPassed: true,
      performanceTestPassed: true,
      hitlWorkflowTested: true,
    },
    acceptanceCriteria: [
      { id: "ac-001", criterion: "Draft generated within 3 seconds of email receipt", status: "passed" },
      { id: "ac-002", criterion: "Correct enquiry classification on ≥ 85% of test emails", status: "passed" },
      { id: "ac-003", criterion: "HITL review UI presents draft before any send action", status: "passed" },
      { id: "ac-004", criterion: "Complaint and legal-flag detection working on test set", status: "passed" },
      { id: "ac-005", criterion: "Security review passed — no email content stored beyond session", status: "passed" },
    ],
    testPlan: {
      totalCases: 20,
      passed: 20,
      failed: 0,
      blocked: 0,
    },
    artifacts: [],
  },

  govern: {
    governanceFramework: {
      escalationPathDefined: true,
      auditReviewFrequency: "monthly",
      boardReportingCadence: "quarterly",
      separationOfDutiesEnforced: true,
      aiModelVersioningPolicy: true,
      aiModelVersioningPolicyDetail: "All OpenAI model version changes require regression test on 50-email test set and PM approval before production.",
    },
    riskRegister: [
      {
        id: "risk-001",
        risk: "Draft reply contains incorrect product information",
        likelihood: "medium",
        impact: "medium",
        mitigation: "HITL review required — sales rep validates all content before sending",
      },
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
      testCasesPassed: 20,
      userValidationCount: 4,
      monitoredHours: 48,
      hitlComplianceRate: 1.0,
    },
    runbookItems: [
      {
        id: "rb-001",
        scenario: "OpenAI API unavailable",
        procedure: "Fall back to manual email queue. Alert Ben Carter. Retry after 15 minutes.",
        owner: "Ben Carter",
      },
      {
        id: "rb-002",
        scenario: "Draft quality drops below acceptance threshold",
        procedure: "Suspend agent, notify Chloe Patel, re-run classification test set, review model version.",
        owner: "Chloe Patel",
      },
    ],
    monitoringSetup: {
      alertingConfigured: true,
      dashboardCreated: true,
      slasDefined: true,
    },
  },

  optimize: {
    optimizationLog: [],
    experimentsRun: 0,
    performanceBaseline: null,
  },

  valuerealize: {
    kpis: [
      {
        id: "kpi-001",
        name: "Manual email response time per rep per day",
        target: "60% reduction",
        unit: "hours/day",
        measuredValue: 0.7,
        achievedAt: "2026-06-08",
      },
    ],
    lessonsForNextCycle: "Email classification worked well for common enquiry types but struggled with multi-topic emails. Recommend splitting multi-topic emails before classification in the next iteration. HITL compliance was 100% — the review UI was intuitive. Initial deployment took longer than expected due to Gmail OAuth approval process — factor 2 weeks for OAuth review in future programs.",
    artifacts: [
      {
        id: "att-001",
        type: "stakeholderAttestation",
        status: "approved",
        title: "Stakeholder Outcome Attestation — Email Auto-Responder",
        createdBy: "pm-001",
        approvedBy: "sp-001",
        approvedAt: "2026-06-09",
      },
    ],
  },

  twinGraph: {
    nodes: [],
    edges: [],
  },
};
