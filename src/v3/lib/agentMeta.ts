export interface AgentMeta {
  id: string;
  label: string;
  description: string;
  estimatedSeconds: number;
  category: "narrative" | "analysis" | "gate" | "compliance" | "twin" | "onboarding" | "quality" | "governance" | "briefing" | "strategy";
  icon: string;
  outputArtifact?: string;
  confidence?: number;    // 0-100 score for how confident the agent's output typically is
  reasoning?: string;     // Short explanation of how this agent reaches conclusions
}

export const AGENT_META: Record<string, AgentMeta> = {
  "narrative": { id: "narrative", label: "Narrative", description: "Generates phase narrative summary", estimatedSeconds: 20, category: "narrative", icon: "✦", outputArtifact: "Phase Narrative" },
  "plan": { id: "plan", label: "Plan", description: "Builds structured delivery plan", estimatedSeconds: 25, category: "narrative", icon: "◎", outputArtifact: "Delivery Plan" },
  "risk": { id: "risk", label: "Risk", description: "Analyses and ranks programme risks", estimatedSeconds: 22, category: "analysis", icon: "⚑", outputArtifact: "Risk Register" },
  "milestone": { id: "milestone", label: "Milestones", description: "Reviews milestone health and forecasts", estimatedSeconds: 18, category: "analysis", icon: "◆", outputArtifact: "Milestone Review" },
  "budget": { id: "budget", label: "Budget", description: "Tracks budget variance and burn", estimatedSeconds: 20, category: "analysis", icon: "◈", outputArtifact: "Budget Report" },
  "critical-path": { id: "critical-path", label: "Critical Path", description: "Maps critical path and slack", estimatedSeconds: 30, category: "analysis", icon: "⟶", outputArtifact: "Critical Path" },
  "change-impact": { id: "change-impact", label: "Change Impact", description: "Assesses organisational change impact", estimatedSeconds: 28, category: "analysis", icon: "◫", outputArtifact: "Change Impact" },
  "stakeholder": { id: "stakeholder", label: "Stakeholders", description: "Stakeholder engagement analysis", estimatedSeconds: 22, category: "analysis", icon: "⊕", outputArtifact: "Stakeholder Map" },
  "health-heatmap": { id: "health-heatmap", label: "Health", description: "Programme health heatmap across phases", estimatedSeconds: 18, category: "analysis", icon: "◫", outputArtifact: "Health Heatmap" },
  "pattern-extract": { id: "pattern-extract", label: "Pattern Extract", description: "Extracts reusable patterns to library", estimatedSeconds: 20, category: "quality", icon: "✧", outputArtifact: "Pattern Entry" },
  "twin-sync": { id: "twin-sync", label: "Twin Sync", description: "Synchronises digital twin graph", estimatedSeconds: 15, category: "twin", icon: "⟳", outputArtifact: "Twin Graph" },
  "compliance-checker": { id: "compliance-checker", label: "Compliance", description: "Checks regulatory compliance posture", estimatedSeconds: 30, category: "compliance", icon: "⊞", outputArtifact: "Compliance Report" },
  "capacity-assessor": { id: "capacity-assessor", label: "Capacity", description: "Team capacity and demand assessment", estimatedSeconds: 25, category: "analysis", icon: "▤", outputArtifact: "Capacity Plan" },
  "vendor-risk-assessor": { id: "vendor-risk-assessor", label: "Vendor Risk", description: "Assesses vendor and partner risk", estimatedSeconds: 28, category: "analysis", icon: "⚑", outputArtifact: "Vendor Risk Report" },
  "phase-completion-estimator": { id: "phase-completion-estimator", label: "Completion Estimator", description: "Forecasts phase completion date", estimatedSeconds: 20, category: "analysis", icon: "◷", outputArtifact: "Completion Forecast" },
  "agent-schedule-optimiser": { id: "agent-schedule-optimiser", label: "Schedule Optimiser", description: "Optimises agent trigger schedule", estimatedSeconds: 15, category: "analysis", icon: "⟳" },
  "setup-prefill": { id: "setup-prefill", label: "Setup Pre-fill", description: "Pre-fills setup wizard from context", estimatedSeconds: 12, category: "onboarding", icon: "✧" },
  "discovery-guide-generator": { id: "discovery-guide-generator", label: "Discovery Guide", description: "Generates interview and workshop guides", estimatedSeconds: 25, category: "narrative", icon: "✦", outputArtifact: "Discovery Pack" },
  "sprint-planner": { id: "sprint-planner", label: "Sprint Planner", description: "Breaks phase into sprint plan", estimatedSeconds: 22, category: "narrative", icon: "◎", outputArtifact: "Sprint Plan" },
  "onboarding-briefer": { id: "onboarding-briefer", label: "Team Briefer", description: "Generates onboarding brief for new members", estimatedSeconds: 18, category: "onboarding", icon: "✦", outputArtifact: "Team Brief" },
  "steerco-agenda-builder": { id: "steerco-agenda-builder", label: "SteerCo Agenda", description: "Builds SteerCo meeting agenda", estimatedSeconds: 20, category: "governance", icon: "⬡", outputArtifact: "SteerCo Agenda" },
  "daily-briefing": { id: "daily-briefing", label: "Daily Briefing", description: "Generates your personalised 3 priorities for today", estimatedSeconds: 15, category: "briefing", icon: "☀", outputArtifact: "Daily Brief", confidence: 85, reasoning: "Analyses open decisions, overdue milestones, gate proximity, and risk changes since last briefing" },
  "steerco-prep": { id: "steerco-prep", label: "SteerCo Prep", description: "Builds full SteerCo pack: agenda, status, risks, decisions", estimatedSeconds: 40, category: "governance", icon: "⬡", outputArtifact: "SteerCo Pack", confidence: 82, reasoning: "Synthesises programme narrative, open risks, pending decisions, and gate status into a structured meeting pack" },
  "benefits-tracker": { id: "benefits-tracker", label: "Benefits Tracker", description: "Tracks benefits realisation against baseline from Strategy", estimatedSeconds: 22, category: "strategy", icon: "◆", outputArtifact: "Benefits Report", confidence: 78, reasoning: "Compares current KPI measurements against the value hypothesis established in the Strategy phase" },
  "portfolio-intelligence": { id: "portfolio-intelligence", label: "Portfolio Intelligence", description: "Cross-programme analysis: risk patterns, resource contention, gate forecasts", estimatedSeconds: 35, category: "analysis", icon: "◈", outputArtifact: "Portfolio Report", confidence: 72, reasoning: "Analyses all programmes in the portfolio to identify shared risks, delivery patterns, and resource conflicts" },
  "adoption": { id: "adoption", label: "Adoption", description: "Plans and tracks change adoption and readiness", estimatedSeconds: 22, category: "analysis", icon: "◭", outputArtifact: "Adoption Plan", confidence: 78, reasoning: "Assesses change readiness, adoption metrics, and resistance signals against the operate-phase baseline" },
  "closure": { id: "closure", label: "Closure", description: "Produces the programme closure and benefits-realisation pack", estimatedSeconds: 28, category: "governance", icon: "⬡", outputArtifact: "Closure Report", confidence: 80, reasoning: "Confirms benefits measured against baseline, lessons captured, and all phases at closure readiness" },
  "input-quality": { id: "input-quality", label: "Input Quality", description: "Checks the completeness and quality of phase inputs", estimatedSeconds: 12, category: "quality", icon: "✓", confidence: 82, reasoning: "Scores each required input for completeness, specificity, and internal consistency" },
  "charter": { id: "charter", label: "Transformation Charter", description: "Drafts the formal programme mandate, scope, and success criteria", estimatedSeconds: 30, category: "strategy", icon: "◆", outputArtifact: "Transformation Charter", confidence: 80, reasoning: "Synthesises sponsor, business objective, scope, success metrics, and governance into the foundational programme mandate" },
  "business-case": { id: "business-case", label: "Business Case", description: "Builds the cost/benefit case and value hypothesis", estimatedSeconds: 30, category: "strategy", icon: "◈", outputArtifact: "Business Case", confidence: 76, reasoning: "Quantifies investment, projected value, and ROI against the captured KPIs and constraints" },
  "outcome-framework": { id: "outcome-framework", label: "Outcome Framework", description: "Structures strategic outcomes, KPIs, and leading indicators", estimatedSeconds: 25, category: "strategy", icon: "◎", outputArtifact: "Outcome Framework", confidence: 80, reasoning: "Maps strategic outcomes to measurable KPIs (baseline/target) and leading indicators for benefits traceability" },
  "strategic-roadmap": { id: "strategic-roadmap", label: "Strategic Roadmap", description: "Sequences the transformation into a phase-level roadmap", estimatedSeconds: 25, category: "strategy", icon: "⟶", outputArtifact: "Strategic Roadmap", confidence: 78, reasoning: "Sequences phases, milestones, dependencies, and gates into a coherent delivery roadmap" },
  "governance-model": { id: "governance-model", label: "Governance Model", description: "Defines decision bodies, cadence, and escalation paths", estimatedSeconds: 28, category: "governance", icon: "⬡", outputArtifact: "Governance Model", confidence: 80, reasoning: "Derives decision bodies, authority thresholds, and escalation paths from stakeholders and decision flow" },
  "raci-matrix": { id: "raci-matrix", label: "RACI Matrix", description: "Maps activities to accountable, responsible, consulted, informed roles", estimatedSeconds: 22, category: "governance", icon: "▤", outputArtifact: "RACI Matrix", confidence: 78, reasoning: "Assigns single accountability per activity across the programme role set" },
  "requirements-catalog": { id: "requirements-catalog", label: "Requirements Catalog", description: "Captures and prioritises programme requirements", estimatedSeconds: 28, category: "analysis", icon: "☰", outputArtifact: "Requirements Catalog", confidence: 76, reasoning: "Structures requirements with MoSCoW priority, source, and acceptance criteria traceable to outcomes" },
  "future-state-design": { id: "future-state-design", label: "Future State Design", description: "Describes target capabilities and process changes", estimatedSeconds: 30, category: "analysis", icon: "◫", outputArtifact: "Future State Design", confidence: 76, reasoning: "Defines future-state capabilities and process changes grounded in requirements and outcomes" },
  "target-operating-model": { id: "target-operating-model", label: "Target Operating Model", description: "Defines people, process, technology, and governance for the future state", estimatedSeconds: 30, category: "analysis", icon: "◈", outputArtifact: "Target Operating Model", confidence: 75, reasoning: "Specifies how the organisation operates across people/process/technology/governance dimensions" },
  "solution-architecture": { id: "solution-architecture", label: "Solution Architecture", description: "Specifies components, integrations, data flows, and NFRs", estimatedSeconds: 32, category: "analysis", icon: "⊞", outputArtifact: "Solution Architecture", confidence: 74, reasoning: "Derives components, integrations, NFRs, and architecture decisions from requirements and constraints" },
  "test-plan": { id: "test-plan", label: "Test Plan", description: "Defines test strategy, criteria, and key test cases", estimatedSeconds: 26, category: "quality", icon: "✓", outputArtifact: "Test Plan", confidence: 78, reasoning: "Maps requirements to test types, environments, entry/exit criteria, and representative cases" },
  "runbook": { id: "runbook", label: "Runbook", description: "Produces operational procedures, monitoring, and incident response", estimatedSeconds: 26, category: "governance", icon: "◷", outputArtifact: "Runbook", confidence: 78, reasoning: "Defines routine operations, monitoring thresholds, and incident-response procedures for live running" },
  "support-model": { id: "support-model", label: "Support Model", description: "Defines support tiers, SLAs, roles, and escalation", estimatedSeconds: 24, category: "governance", icon: "⊕", outputArtifact: "Support Model", confidence: 78, reasoning: "Specifies support tiers, SLAs, and escalation aligned to operating stakeholders" },
  "optimization-backlog": { id: "optimization-backlog", label: "Optimization Backlog", description: "Prioritises continuous-improvement opportunities", estimatedSeconds: 22, category: "strategy", icon: "✧", outputArtifact: "Optimization Backlog", confidence: 76, reasoning: "Ranks improvement opportunities by value vs effort against baseline KPIs and operating signals" },
};

/**
 * Synonym artifact-id → canonical producing-agent id. The phase planner
 * sometimes emits a dynamic artifact under a descriptive synonym ("risk-log")
 * instead of the canonical producing-agent id ("risk"). The run-agent edge
 * function only accepts canonical ids, so an un-aliased synonym 400s with
 * `Unknown agentId`. Mapping the known synonyms here — in the producing-agent
 * registry, the single source of truth — lets every surface (Generate, Improve
 * quality, flow wiring) resolve to a real agent without hard-coding aliases in
 * components or the edge. Keep keys lowercase and hyphenated.
 */
export const AGENT_ID_ALIASES: Record<string, string> = {
  "risk-log": "risk",
  "risk-register": "risk",
};

export function getAgentMeta(agentId: string): AgentMeta {
  return AGENT_META[agentId] ?? {
    id: agentId, label: agentId, description: "Agent run",
    estimatedSeconds: 20, category: "narrative", icon: "◌",
  };
}
