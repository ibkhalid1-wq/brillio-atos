export const VALIDATION_SEED_PROGRAM = {
  id: "validation-hello-world",
  name: "Agentic Meeting Summary Assistant",
  createdAt: new Date().toISOString(),
  status: "active",

  strategy: {
    businessProblem: "Teams spend excessive time manually summarizing meetings and following up on action items. Estimated 8–10 hours per team per week lost.",
    desiredOutcome: "Reduce meeting follow-up effort by 50% within 90 days of deployment.",
    sponsor: "Chief Productivity Officer",
    objectives: [
      "Automate meeting transcript summarization",
      "Auto-generate action item lists",
      "Route action items to owners via existing tools",
    ],
    baselineMetrics: {
      m1: { name: "Meeting follow-up hours per team per week", currentValue: 10, unit: "hours/week", source: "Productivity survey Q1 2026", date: "2026-01-15" },
    },
    valueHypothesis: "By deploying an AI meeting summary agent, each team saves 5 hours/week, delivering $2,400/team/year in recovered productivity.",
    constraints: [
      "Must integrate with existing Teams and Zoom infrastructure",
      "Must comply with EU data residency policy",
      "HITL review required for all action item assignments",
    ],
  },

  mobilise: {
    deliveryRoles: [
      { role: "Program Sponsor", personKey: "cpo-001", name: "Sarah Chen", allocation: 0.2 },
      { role: "Program Manager", personKey: "pm-001", name: "Raj Mamodia", allocation: 1.0 },
      { role: "AI/ML Engineer", personKey: "ml-001", name: "Priya Nair", allocation: 1.0 },
      { role: "Solution Architect", personKey: "sa-001", name: "Tom Walsh", allocation: 0.5 },
      { role: "Business Analyst", personKey: "ba-001", name: "Aisha Kamara", allocation: 0.8 },
      { role: "Change Manager", personKey: "cm-001", name: "Luis Ortega", allocation: 0.5 },
    ],
    raci: {
      "Meeting Intelligence Capability": {
        responsible: "AI/ML Engineer",
        accountable: "Program Sponsor",
        consulted: ["Solution Architect", "Business Analyst"],
        informed: ["Change Manager"],
      },
    },
    governanceModel: {
      steeringCommittee: ["Sarah Chen", "CPO Office"],
      reviewCadence: "bi-weekly",
      escalationPath: "Program Manager → Program Sponsor → Executive Committee",
    },
  },

  discover: {
    capabilityDNA: [
      {
        id: "cap-001",
        name: "Meeting Intelligence Capability",
        description: "Ingests meeting recordings/transcripts, generates structured summaries, extracts action items, assigns owners, and routes to task management systems.",
        autonomyLevel: 3,
        approved: true,
        humanInTheLoop: true,
        hitlPolicy: "All action item assignments reviewed by meeting owner before routing",
        dataClassification: "Confidential",
        dataResidency: "EU",
        integrations: ["Microsoft Teams", "Zoom", "Jira", "Slack"],
        dependsOn: [],
      },
    ],
    kpis: [
      { id: "kpi-001", name: "Meeting follow-up time saved", target: "50% reduction", unit: "hours/week/team", measuredValue: null },
      { id: "kpi-002", name: "Action item routing accuracy", target: "≥ 90%", unit: "%", measuredValue: null },
      { id: "kpi-003", name: "User adoption rate", target: "≥ 80% of target teams", unit: "%", measuredValue: null },
    ],
    stakeholders: [
      { name: "Sarah Chen", role: "CPO", interest: "high", influence: "high" },
      { name: "Team Leads (20)", role: "End Users", interest: "medium", influence: "medium" },
      { name: "IT Security", role: "Compliance Gate", interest: "high", influence: "high" },
    ],
    opportunityAssessment: {
      feasibility: "high",
      strategicAlignment: "high",
      estimatedEffort: "medium",
      riskRating: "low-medium",
      recommendation: "Proceed to Design",
    },
  },

  design: {
    architectureDecisions: [
      {
        id: "adr-001",
        title: "Transcript processing model",
        decision: "Use Azure OpenAI GPT-4o for transcript summarization",
        decisionMaker: "Tom Walsh",
        alternatives: "AWS Bedrock Claude 3, on-premise open-source model",
        constraints: "EU data residency required — Azure EU region selected",
        reversibility: "partially-reversible",
        status: "approved",
        supersededBy: null,
      },
      {
        id: "adr-002",
        title: "Action item routing",
        decision: "Route via Jira API with Slack notification fallback",
        decisionMaker: "Tom Walsh",
        alternatives: "Email-only routing, manual assignment",
        constraints: "Must not create duplicate tasks",
        reversibility: "reversible",
        status: "approved",
        supersededBy: null,
      },
    ],
    agentBlueprint: {
      agentName: "MeetingMind",
      agentType: "workflow",
      autonomyLevel: 3,
      inputs: ["Meeting transcript (Teams/Zoom)", "Meeting metadata (attendees, date, duration)"],
      outputs: ["Structured summary", "Action item list with owners", "Jira tickets (pending HITL)", "Slack notifications"],
      tools: ["Azure OpenAI GPT-4o", "Jira API", "Slack API", "Microsoft Graph API"],
      guardrails: ["Max 10 action items per meeting", "Owner confidence threshold 85%", "All outputs reviewed before routing"],
    },
    skillCatalog: [
      { id: "sk-001", name: "Transcript ingestion", description: "Parse Teams/Zoom transcript formats", type: "data-processing" },
      { id: "sk-002", name: "Summarization", description: "Generate structured meeting summaries", type: "nlp" },
      { id: "sk-003", name: "Action item extraction", description: "Identify action items with owners and due dates", type: "nlp" },
      { id: "sk-004", name: "Task routing", description: "Create Jira tickets and Slack notifications", type: "integration" },
    ],
  },

  build: {
    deploymentChecklist: {
      infraProvisioned: true,
      azureOpenAIConfigured: true,
      jiraIntegrationTested: true,
      slackIntegrationTested: true,
      securityReviewPassed: true,
      performanceTestPassed: true,
      hitlWorkflowTested: true,
    },
    acceptanceCriteria: [
      { id: "ac-001", criterion: "Summary generated within 60 seconds of transcript upload", status: "passed" },
      { id: "ac-002", criterion: "Action item extraction accuracy ≥ 90% on test set of 20 meetings", status: "passed" },
      { id: "ac-003", criterion: "HITL review UI accessible and functional", status: "passed" },
      { id: "ac-004", criterion: "Security penetration test passed", status: "passed" },
      { id: "ac-005", criterion: "EU data residency verified via audit log", status: "passed" },
    ],
    testPlan: { totalCases: 45, passed: 45, failed: 0, blocked: 0 },
    artifacts: [],
  },

  govern: {
    governanceFramework: {
      escalationPathDefined: true,
      auditReviewFrequency: "monthly",
      boardReportingCadence: "quarterly",
      separationOfDutiesEnforced: true,
      aiModelVersioningPolicy: "Model upgrades are version-pinned, regression-tested in a staging environment, and require architecture plus governance approval before rollout or rollback.",
    },
    riskRegister: [
      { id: "risk-001", risk: "EU data residency breach via misconfigured endpoint", likelihood: "low", impact: "critical", mitigation: "Network policy enforced at Azure level, monthly audit" },
      { id: "risk-002", risk: "Action item misattribution causing team confusion", likelihood: "medium", impact: "medium", mitigation: "HITL review gate + 85% confidence threshold" },
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
      testCasesPassed: 38,
      userValidationCount: 5,
      monitoredHours: 72,
      hitlComplianceRate: 0.97,
    },
    runbookItems: [
      { id: "rb-001", scenario: "Azure OpenAI API rate limit exceeded", procedure: "Queue transcripts, notify user, auto-retry after 60s", owner: "Priya Nair" },
      { id: "rb-002", scenario: "Jira API authentication failure", procedure: "Fall back to Slack notification, create manual ticket reminder", owner: "Tom Walsh" },
    ],
    monitoringSetup: { alertingConfigured: true, dashboardCreated: true, slasDefined: true },
  },

  optimize: {
    optimizationLog: [],
    experimentsRun: 0,
    performanceBaseline: null,
  },

  valuerealize: {
    kpis: [
      { id: "kpi-001", name: "Meeting follow-up time saved", target: "50% reduction", unit: "hours/week/team", measuredValue: 5.4, baselineValue: 10, achievedPercent: 54 },
      { id: "kpi-002", name: "Action item routing accuracy", target: "≥ 90%", unit: "%", measuredValue: 93, achievedPercent: 103 },
      { id: "kpi-003", name: "User adoption rate", target: "≥ 80% of target teams", unit: "%", measuredValue: 84, achievedPercent: 105 },
    ],
    lessonsForNextCycle: "Start the security review earlier, involve end users in weekly validation checkpoints, and standardize transcript templates sooner so downstream routing confidence stays consistently high.",
    stakeholderAttestation: {
      approvedBy: "Sarah Chen",
      approvedAt: "2026-04-22T14:30:00.000Z",
      summary: "The program met its primary value target and reduced manual follow-up effort beyond the original hypothesis.",
    },
    artifacts: [
      {
        id: "att-001",
        type: "stakeholderAttestation",
        status: "approved",
        title: "Stakeholder Outcome Attestation",
        approvedBy: "Sarah Chen",
      },
    ],
  },

  twinGraph: {
    nodes: [],
    edges: [],
  },

  customContradictionRules: [],
};
