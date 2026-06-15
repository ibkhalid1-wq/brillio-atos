export const COPY = {
  errors: {
    network: "Connection lost. Changes will sync when you're back online.",
    networkReconnected: "Back online — syncing your changes.",
    agentFailed: (agentId: string) => `The ${agentId} agent couldn't complete. Try again in a moment.`,
    saveFailed: "Couldn't save. Check your connection and try again.",
    concurrency: "Someone else updated this programme. Refresh to see the latest version.",
    notFound: (resource: string) => `${resource} not found.`,
    unknown: "Something went wrong. If this keeps happening, contact support.",
  },
  agents: {
    running: (label: string) => `${label} is running…`,
    complete: (label: string) => `${label} complete`,
    failed: (label: string) => `${label} failed`,
    preflightBlocked: (missingCount: number) =>
      missingCount === 1
        ? "1 required field is missing before this agent can run."
        : `${missingCount} required fields are missing before this agent can run.`,
    lowConfidence: "This output was generated with limited inputs — review carefully.",
  },
  gates: {
    approveConfirm: "Approve this gate? This action moves the programme to the next phase.",
    approveSuccess: (phaseLabel: string) => `${phaseLabel} gate approved`,
    remediationRequested: "Remediation requested — the gate has been sent back.",
    reopened: (phaseLabel: string) => `${phaseLabel} gate reopened`,
    noReview: "No gate review available yet. Run a gate review agent first.",
  },
  decisions: {
    recorded: "Decision recorded",
    deferred: "Decision deferred",
    noOpen: "No open decisions — programme is on track.",
  },
  program: {
    created: (name: string) => `Programme "${name}" created`,
    deleted: (name: string) => `"${name}" has been deleted`,
    saved: "Changes saved",
    noPrograms: "No programmes yet. Create your first one to get started.",
    switchConfirm: "Switch to a different programme?",
  },
  onboarding: {
    welcomeTitle: "Welcome to ATOS",
    welcomeBody: "ATOS guides your transformation programme from strategy to value realisation. Let's set up your programme.",
    step1: "Name your programme",
    step2: "Define your objective",
    step3: "Set your phase timeline",
    complete: "Programme set up — ready to start.",
  },
  tooltips: {
    commandPalette: "Search commands, agents, and phases",
    contextDrawer: "Programme inputs and documents",
    gateReadiness: "How ready this phase is for gate approval (0–100%)",
    confidenceScore: "Weighted signal across gate readiness, risk, milestones, decisions, and input completeness",
    agentRunning: "An AI agent is generating outputs for this phase",
  },
  actions: {
    save: "Save",
    cancel: "Cancel",
    confirm: "Confirm",
    delete: "Delete",
    edit: "Edit",
    view: "View",
    close: "Close",
    runAgent: "Run Agent",
    regenerate: "Regenerate",
    approve: "Approve",
    defer: "Defer",
    dismiss: "Dismiss",
    export: "Export",
    copy: "Copy",
    copied: "Copied ✓",
  },
  empty: {
    artifacts: "No artifacts yet. Run phase agents to generate outputs.",
    decisions: "No open decisions.",
    risks: "No risks recorded. Run the Risk agent to analyse programme risks.",
    milestones: "No milestones yet. Add milestones or run the Plan agent.",
    stakeholders: "No stakeholders mapped. Run the Stakeholder agent.",
    narrative: "No narrative yet. Run the Narrative agent to summarise this phase.",
    kpis: "No KPIs defined. Add KPIs to track programme outcomes.",
  },
} as const;

export type CopyKey = keyof typeof COPY;
