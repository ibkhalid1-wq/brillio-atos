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
  "phase-completion-estimator": { id: "phase-completion-estimator", label: "Phase Progress", description: "Estimates phase progress % from milestones, exit criteria, tasks and artifacts", estimatedSeconds: 20, category: "analysis", icon: "◷", outputArtifact: "Phase progress" },
  "setup-prefill": { id: "setup-prefill", label: "Setup Pre-fill", description: "Pre-fills setup wizard from context", estimatedSeconds: 12, category: "onboarding", icon: "✧" },
  "discovery-guide-generator": { id: "discovery-guide-generator", label: "Discovery Guide", description: "Generates interview and workshop guides", estimatedSeconds: 25, category: "narrative", icon: "✦", outputArtifact: "Discovery Pack" },
  "sprint-planner": { id: "sprint-planner", label: "Sprint Planner", description: "Breaks phase into sprint plan", estimatedSeconds: 22, category: "narrative", icon: "◎", outputArtifact: "Sprint Plan" },
  "steerco-agenda-builder": { id: "steerco-agenda-builder", label: "SteerCo Agenda", description: "Builds SteerCo meeting agenda", estimatedSeconds: 20, category: "governance", icon: "⬡", outputArtifact: "SteerCo Agenda" },
  "daily-briefing": { id: "daily-briefing", label: "Daily Briefing", description: "Generates your personalised 3 priorities for today", estimatedSeconds: 15, category: "briefing", icon: "☀", outputArtifact: "Daily Brief", confidence: 85, reasoning: "Analyses open decisions, overdue milestones, gate proximity, and risk changes since last briefing" },
  "steerco-prep": { id: "steerco-prep", label: "SteerCo Prep", description: "Builds full SteerCo pack: agenda, status, risks, decisions", estimatedSeconds: 40, category: "governance", icon: "⬡", outputArtifact: "SteerCo Pack", confidence: 82, reasoning: "Synthesises programme narrative, open risks, pending decisions, and gate status into a structured meeting pack" },
  "benefits-tracker": { id: "benefits-tracker", label: "Benefits Tracker", description: "Tracks benefits realisation against baseline from Strategy", estimatedSeconds: 22, category: "strategy", icon: "◆", outputArtifact: "Benefits Report", confidence: 78, reasoning: "Compares current KPI measurements against the value hypothesis established in the Strategy phase" },
  "portfolio-intelligence": { id: "portfolio-intelligence", label: "Portfolio Intelligence", description: "Cross-programme analysis: risk patterns, resource contention, gate forecasts", estimatedSeconds: 35, category: "analysis", icon: "◈", outputArtifact: "Portfolio Report", confidence: 72, reasoning: "Analyses all programmes in the portfolio to identify shared risks, delivery patterns, and resource conflicts" },
  "adoption": { id: "adoption", label: "Adoption", description: "Plans and tracks change adoption and readiness", estimatedSeconds: 22, category: "analysis", icon: "◭", outputArtifact: "Adoption Plan", confidence: 78, reasoning: "Assesses change readiness, adoption metrics, and resistance signals against the operate-phase baseline" },
  "closure": { id: "closure", label: "Closure", description: "Produces the programme closure and benefits-realisation pack", estimatedSeconds: 28, category: "governance", icon: "⬡", outputArtifact: "Closure Report", confidence: 80, reasoning: "Confirms benefits measured against baseline, lessons captured, and all phases at closure readiness" },
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
  // ── AURA Flow producing agents ────────────────────────────────────────────
  // The evidence-to-system pipeline's transformers: each consumes the previous
  // movement's evidence (transcripts, the Atlas, the Blueprint, demo verdicts)
  // and generates the next living artifact. Registered here so Flow movements
  // render real deliverable chips; their generators land with the Flow edge work.
  "discovery-kit": { id: "discovery-kit", label: "Discovery Kit", description: "Generates the discovery tour: a role-aware 45-minute agenda per stakeholder, question banks, schedule, and consent kit", estimatedSeconds: 25, category: "strategy", icon: "✦", outputArtifact: "Discovery Kit", confidence: 78, reasoning: "Derives who must be heard and what to ask each of them from the sponsor conversation, objective, and industry" },
  "current-state-atlas": { id: "current-state-atlas", label: "Current-State Atlas", description: "Synthesises every discovery transcript into current-state workflow maps and the pain-point heatmap, re-run on each new conversation", estimatedSeconds: 35, category: "analysis", icon: "◫", outputArtifact: "Current-State Atlas", confidence: 76, reasoning: "Cross-reads all interview transcripts, surfaces contradictions, and maps swimlane workflows with verbatim evidence" },
  // Listen's third deliverable: the Atlas says how the business runs today, and
  // Agentify says what should happen to each of those steps. It is the HOME of
  // the automate / assist / keep-manual decision (FutureMode in flowFutureState).
  "agentify": { id: "agentify", label: "Agentify", description: "Carries every Current-State Atlas workflow step into an agentification decision — automate, assist, or keep manual — with the reason, a candidate agent, and where a human stays in the loop", estimatedSeconds: 35, category: "analysis", icon: "⚡", outputArtifact: "Agentify", confidence: 72, reasoning: "Reads each atlas step against the pain it carries and the judgement it demands, then proposes automate / assist / keep manual with the evidence behind each call" },
  "domain-ontology": { id: "domain-ontology", label: "Domain Ontology", description: "Builds the domain ontology — entities, relations, systems, hand-offs — from the discovery conversations; drives the Blueprint's data model", estimatedSeconds: 30, category: "analysis", icon: "⊕", outputArtifact: "Domain Ontology", confidence: 74, reasoning: "Extracts entities and relationships across transcripts and normalises them into one navigable domain model" },
  "architecture-strategy": { id: "architecture-strategy", label: "Architecture Strategy", description: "Drafts candidate target architectures from the Atlas — agentic patterns, integration map, build-vs-buy — with trade-offs scored", estimatedSeconds: 35, category: "strategy", icon: "⟶", outputArtifact: "Architecture Strategy", confidence: 74, reasoning: "Maps current-state workflows and constraints to 2–3 candidate agentic architectures and scores the trade-offs" },
  "agentic-blueprint": { id: "agentic-blueprint", label: "Agentic Blueprint", description: "Compiles the chosen direction into a buildable spec: agents, tools, orchestration, data contracts, HITL points, and the eval plan", estimatedSeconds: 40, category: "strategy", icon: "⊞", outputArtifact: "Agentic Blueprint", confidence: 75, reasoning: "Targets the chosen agentic framework and derives the data model from the domain ontology" },
  "experience-design": { id: "experience-design", label: "Experience Design", description: "Designs the prototype's experience from the record — screens per journey stage, flows that answer quoted pains, wireframes speaking the ontology's vocabulary, and the workflow state machines the demo runs", estimatedSeconds: 45, category: "quality", icon: "▦", outputArtifact: "Experience Design", confidence: 70, reasoning: "Compiles journeys, atlas workflows and demo scripts into a buildable UX/UI/workflow spec" },
  "prototype-pack": { id: "prototype-pack", label: "Prototype Build Pack", description: "Compiles the Blueprint into a prototype build pack — scaffold spec, agent wiring, and seed data lifted from the discovery evidence", estimatedSeconds: 40, category: "quality", icon: "◎", outputArtifact: "Prototype Build Pack", confidence: 72, reasoning: "Turns the blueprint into buildable scaffolding with scenario seed data drawn from stakeholder transcripts" },
  "prototype-build": { id: "prototype-build", label: "Prototype Build", description: "Assembles the Experience Design, Blueprint agents and seed fixtures into a self-contained clickable prototype — the runnable app the Experience Designer refines and Show demonstrates", estimatedSeconds: 60, category: "quality", icon: "🖥", outputArtifact: "Prototype Build", confidence: 68, reasoning: "Renders the designed screens, flows and seeded records into a working clickable app a stakeholder can operate" },
  "demo-scripts": { id: "demo-scripts", label: "Demo Scripts", description: "Writes one prototype walkthrough per stakeholder, seeded with scenarios from their own transcript — everyone watches their own job run", estimatedSeconds: 30, category: "narrative", icon: "✦", outputArtifact: "Demo Scripts", confidence: 78, reasoning: "Pairs each stakeholder's stated pain points with the prototype flow that resolves them, quoting their own words" },
  "hardening-plan": { id: "hardening-plan", label: "Hardening Plan", description: "Plans prototype-to-production conversion: authn/z, error handling, observability, guardrails, and HITL insertion points", estimatedSeconds: 32, category: "quality", icon: "⊞", outputArtifact: "Hardening Plan", confidence: 76, reasoning: "Walks the blueprint's surfaces and marks what production requires beyond the prototype" },
  "eval-suite": { id: "eval-suite", label: "Eval Suite", description: "Generates the evaluation suite from discovery transcripts and demo acceptances — the tests that gate shipping", estimatedSeconds: 35, category: "quality", icon: "✓", outputArtifact: "Eval Suite", confidence: 74, reasoning: "Converts stakeholder-stated expectations and accepted demo behaviour into runnable eval cases" },
};

/**
 * Retired agent families. These ids still appear in AGENT_META (so historical
 * runs and stored artifacts keep their labels/icons) but their generator is gone:
 * the run-agent dispatch chokepoint short-circuits them to a no-op. This is the
 * single source of truth — `artifactGeneratorAgentId` consults it so a planner
 * artifact whose canonical id is retired routes to the generic phase agent
 * instead of a dead one, and AppShellV3's dispatch guard imports it rather than
 * re-declaring the list. Keep the hand-maintained status-grid groups in
 * IntelligenceView in lockstep (they exclude these by omission).
 */
export const RETIRED_AGENT_IDS = new Set<string>([
  "critical-path",
  "retro",
  "pattern-extract",
  "pattern-query",
  "twin-sync",
  "benchmark-comparator",
  "closure",
]);

/**
 * Internal/support artifacts: analysis and assist outputs produced by support
 * agents (capacity, compliance, vendor risk, sprint plan, etc.). They are stored
 * as phase-artifact stubs by `applyProgramSupportArtifact` in the run-agent edge
 * function, but they are NOT formal phase deliverables — they back cards/metrics
 * elsewhere. Surfaces that list deliverables (the phase artifacts column) must
 * exclude these so the column shows only real, gateable artifacts. This set is
 * the single source of truth for "which produced artifacts are internal".
 */
export const SUPPORT_ARTIFACT_IDS = new Set<string>([
  "discovery-guide-generator",
  "sprint-planner",
  "stakeholder-comms-drafter",
  "steerco-agenda-builder",
  "kpi-validator",
  "compliance-checker",
  "capacity-assessor",
  "lessons-synthesiser",
  "vendor-risk-assessor",
  "meeting-notes-extractor",
]);

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
  "risks-assumptions-log": "risk",
  "risks-and-assumptions-log": "risk",
  // The adoption agent's deliverable is the "Adoption Plan"; the planner
  // sometimes emits it under that descriptive id ("adoption-plan") rather than
  // the canonical agent id ("adoption"). Without this fold, canonicalArtifactId
  // resolves only the post-hyphen token ("plan", not an agent) and leaves the
  // variant as-is, so the planner artifact and the produced "adoption" orphan
  // render as two identical "Adoption Plan" chips in the operate phase.
  "adoption-plan": "adoption",
};

export function getAgentMeta(agentId: string): AgentMeta {
  return AGENT_META[agentId] ?? {
    id: agentId, label: agentId, description: "Agent run",
    estimatedSeconds: 20, category: "narrative", icon: "◌",
  };
}
