import type { AgentRun } from "@/lib/adamSync";

export type AppView =
  | "home"
  | "twin"
  | "work"
  | "accelerators"
  | "narrative"
  | "plan"
  | "milestones"
  | "decisions"
  | "risks"
  | "budget"
  | "critical-path"
  | "change-impact"
  | "stakeholders"
  | "adoption"
  | "health-heatmap"
  | "retro"
  | "deck"
  | "scope-pcr"
  | "closure"
  | "intelligence"
  | "settings";
export type Persona = "executive" | "lead" | "architect" | "fde" | "engineer";
export type AgentStatus = "idle" | "running" | "paused" | "complete" | "failed";
export type DecisionPriority = "critical" | "high" | "medium" | "low";

export interface PhaseSummary {
  id: string;
  displayName: string;
  pct: number;
  status: "ready" | "at-risk" | "blocked" | "complete" | "inactive";
  objective: string;
}

export interface ArtifactSummary {
  id: string;
  phaseId: string;
  title: string;
  status: "draft" | "approved" | "stale" | "archived";
  agentConfidence?: number;
  agentGenerated: boolean;
  lastEditedBy: "agent" | "human";
  lastEditedAt: string;
  contentSummary: string;
  versionNumber: number;
}

export interface DecisionSummary {
  id: string;
  title: string;
  type: string;
  priority: DecisionPriority;
  phaseId: string;
  question: string;
  options: string[];
  createdAt: string;
  runId?: string;
  agentId?: string;
  status?: string;
  recommendation?: string;
  previewContent?: Record<string, unknown>;
  source?: string;
  resolvedBy?: string;
  /** Drill-down: the artifact this action was derived from (artifact id). */
  relatedArtifactId?: string | null;
  /** Drill-down: the input field ids this action relates to. */
  relatedInputIds?: string[];
  advisorAnalysis?: {
    options: Array<{
      label: string;
      description: string;
      pros: string[];
      cons: string[];
      effort: "low" | "medium" | "high";
      risk: "low" | "medium" | "high";
      timeImpactDays: number | null;
    }>;
    recommendation: string;
    recommendationRationale: string;
    confidence?: number;
    escalateTo?: string | null;
  };
}

export interface RiskSummary {
  id: string;
  label: string;
  severity: "critical" | "high" | "medium" | "low";
  owner?: string;
  action?: string;
  actionView?: AppView;
}

export type RAIDEntryType = "risk" | "blocker" | "assumption" | "dependency";
export type RAIDEntryStatus = "open" | "closed" | "monitoring";
export type RAIDEntrySource = "agent" | "human";

export interface RAIDEntry {
  id: string;
  type: RAIDEntryType;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  phase: string;
  owner: string | null;
  mitigation: string | null;
  status: RAIDEntryStatus;
  source: RAIDEntrySource;
  agentConfidence?: number;
  validatedAt?: string | null;
  createdAt: string;
  closedAt: string | null;
  closedBy: "agent" | "human" | null;
  closureNote: string | null;
  /** Drill-down: the artifact this entry was derived from (artifact id). */
  relatedArtifactId?: string | null;
  /** Drill-down: the input field ids this entry relates to. */
  relatedInputIds?: string[];
}

export interface PlanMilestone {
  id: string;
  phase: string;
  title: string;
  dueDate: string | null;
  status: "complete" | "on-track" | "at-risk" | "blocked" | "not-started";
  owner: string | null;
}

export interface PlanAction {
  action: string;
  owner: string | null;
  phase: string;
  rationale: string;
}

export interface PlanBlocker {
  blocker: string;
  phase: string;
  severity: "critical" | "high" | "medium";
  resolution: string | null;
}

export interface PlanSummary {
  milestones: PlanMilestone[];
  criticalPath: string[];
  nextThreeActions: PlanAction[];
  blockerSummary: PlanBlocker[];
  confidence: number;
}

export interface Milestone {
  id: string;
  title: string;
  phaseId: string;
  targetDate: string | null;
  status: "on-track" | "at-risk" | "delayed" | "complete";
  dependsOn: string[];
  exitCriteria: string[];
  confidence: number;
  source: "agent" | "human";
  lastUpdatedAt: string;
}

export interface PhaseBudget {
  phaseId: string;
  phaseName: string;
  budgetedEffort: string | null;
  actualEffort: string | null;
  status: "underspend" | "on-budget" | "overspend" | "unknown";
}

export interface BenefitMilestone {
  id: string;
  title: string;
  targetDate: string | null;
  estimatedValue: string;
  status: "pending" | "at-risk" | "realised";
  phaseId: string;
}

export interface BudgetTracking {
  projectedCost: number | null;
  actualSpend: number | null;
  projectedBenefits: number | null;
  realisedBenefits: number | null;
  roi: number | null;
  burnRate: "healthy" | "at-risk" | "overspend";
  valueDeliveryRate: "ahead" | "on-track" | "behind";
  phaseSpend: PhaseBudget[];
  benefitMilestones: BenefitMilestone[];
  healthSignal: "green" | "amber" | "red";
  healthReason: string;
  confidence: number;
}

export interface CriticalPathNode {
  phaseId: string;
  phaseName: string;
  status: "complete" | "in-progress" | "blocked" | "not-started";
  isBottleneck: boolean;
  blockerSummary: string | null;
  dependsOn: string[];
}

export interface CriticalBottleneck {
  phaseId: string;
  phaseName: string;
  reason: string;
  linkedRiskId: string | null;
  linkedDecisionId: string | null;
  recommendedAction: string;
}

export interface CriticalPathAnalysis {
  sequence: CriticalPathNode[];
  currentBottleneck: CriticalBottleneck | null;
  offCriticalPath: string[];
  estimatedCompletionDelta: string;
  confidence: number;
}

export interface GateArtifact {
  name: string;
  status: "complete" | "partial" | "missing";
  confidence: number;
}

export interface ExitCriterion {
  criterion: string;
  met: boolean;
  evidence: string | null;
}

export interface GateReview {
  phaseId: string;
  phaseName: string;
  status: "not-ready" | "pending-review" | "ready" | "approved" | "remediation-requested";
  readinessScore: number;
  artifactsSummary: GateArtifact[];
  openDecisions: number;
  openRisks: number;
  exitCriteriaStatus: ExitCriterion[];
  recommendation: string;
  generatedAt: string;
  humanNote?: string;
  approvedAt: string | null;
  approvedBy: string | null;
  remediationNote: string | null;
}

export interface Escalation {
  id: string;
  type: "stale-decision" | "phase-stalled" | "critical-blocker" | "milestone-slipping";
  severity: "high" | "critical";
  title: string;
  summary: string;
  costOfDelay: string;
  linkedDecisionId: string | null;
  linkedPhaseId: string | null;
  linkedRiskId: string | null;
  raisedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  status: "open" | "acknowledged" | "resolved";
  source: "agent";
}

export interface ClosureBenefitSummary {
  planned: string;
  realised: string;
  gap: string;
  commentary: string;
}

export interface LessonLearned {
  category: "process" | "technology" | "people" | "governance";
  lesson: string;
  source: string;
  applicability: string;
}

export interface ClosureArtifact {
  name: string;
  phaseId: string;
  confidenceAtClose: number;
}

export interface ProgramClosure {
  status: "not-ready" | "ready" | "approved" | "archived";
  readinessScore: number;
  notReadyReason?: string;
  benefitsSummary: ClosureBenefitSummary | null;
  lessonsLearned: LessonLearned[];
  keyArtifacts: ClosureArtifact[];
  recommendations: string[];
  closureDecisionId: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  archivedAt: string | null;
  generatedAt: string;
  confidence: number;
}

export interface ChangeImpactGroup {
  group: string;
  impactLevel: "critical" | "high" | "medium" | "low";
  changeType: "process" | "technology" | "culture" | "structural";
  affectedHeadcount: number | null;
  readinessScore: number;
  interventions: string[];
  owner: string | null;
}

export interface ChangeImpactAssessment {
  impactedGroups: ChangeImpactGroup[];
  overallChangeLoad: "high" | "medium" | "low";
  peakChangeWindow: string;
  resistanceRisk: "high" | "medium" | "low";
  topInterventions: string[];
  confidence: number;
  summary: string;
}

export interface StakeholderProfile {
  id: string;
  name: string;
  role: string;
  organisation: string | null;
  influence: "high" | "medium" | "low";
  interest: "high" | "medium" | "low";
  currentEngagement: "champion" | "supportive" | "neutral" | "resistant" | "unknown";
  targetEngagement: "champion" | "supportive" | "neutral";
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  riskOfDisengagement: "high" | "medium" | "low";
  recommendedActions: string[];
  owner: string | null;
  source?: "agent" | "human";
}

export interface StakeholderAssessment {
  stakeholders: StakeholderProfile[];
  engagementSummary: string;
  criticalRelationships: string[];
  confidence: number;
}

export interface AdoptionGroup {
  group: string;
  adoptionRate: number;
  trainingCompletion: number;
  toolUtilisation: number;
  readinessGap: "high" | "medium" | "low" | "none";
  barriers: string[];
  recommendedInterventions: string[];
}

export interface AdoptionAssessment {
  adoptionGroups: AdoptionGroup[];
  overallAdoptionRate: number;
  adoptionTrend: "improving" | "stable" | "declining" | "unknown";
  criticalAdoptionRisks: string[];
  goLiveReadiness: "ready" | "at-risk" | "not-ready";
  confidence: number;
  summary: string;
}

export interface HealthHeatmapPhase {
  phaseId: string;
  phaseName: string;
  rag: "green" | "amber" | "red" | "grey";
  score: number;
  confidence: number;
  healthNote: string;
  topRisk: string | null;
}

export interface HealthHeatmapSummary {
  phaseHealth: HealthHeatmapPhase[];
  overallHealthScore: number;
  overallRag: "green" | "amber" | "red";
  trend: "improving" | "stable" | "declining";
  programMomentum: "accelerating" | "steady" | "slowing" | "stalled";
  confidence: number;
  summary: string;
}

export interface RetroObservation {
  observation: string;
  impact: string;
  category: "people" | "process" | "technology" | "governance";
}

export interface RetroImprovement {
  observation: string;
  rootCause: string;
  category: "people" | "process" | "technology" | "governance";
}

export interface RetroActionItem {
  action: string;
  owner: string | null;
  targetPhase: string;
  priority: "high" | "medium" | "low";
  effort: "high" | "medium" | "low";
}

export interface PhaseRetro {
  wentWell: RetroObservation[];
  improvements: RetroImprovement[];
  actionItems: RetroActionItem[];
  overallSentiment: "positive" | "mixed" | "negative";
  healthScore: number;
  keyLearning: string;
  confidence: number;
}

export interface DeckSlide {
  slideNumber: number;
  title: string;
  type: "title" | "executive-summary" | "status" | "financials" | "risks" | "milestones" | "decisions" | "achievements" | "next-steps" | "appendix";
  talkingPoints: string[];
  dataCallouts: string[];
  recommendedVisual: string | null;
  speakerNotes: string;
}

export interface ExecutiveDeck {
  title: string;
  audience: string;
  slides: DeckSlide[];
  generatedAt: string;
  confidence: number;
  programHealthSummary: string;
}

export interface ArtifactQualityReview {
  score: number;
  dimensions: Record<string, number>;
  improvements: string[];
}

export interface InputQualityAssessment {
  overallScore: number;
  verdict: "sufficient" | "partial" | "insufficient";
  fieldAssessments: Array<{
    field: string;
    score: number;
    issue: string;
    suggestion: string;
  }>;
  missingCritical: string[];
  tasks: Array<Record<string, unknown>>;
  readyToRun: string[];
  blockedAgents: string[];
  assessedAt: string;
}

export interface GeneratedExitCriterion {
  criterion: string;
  category: "artifact" | "decision" | "approval" | "metric" | "activity";
  owner: string;
  verificationMethod: string;
  mandatory: boolean;
}

export interface GeneratedExitCriteriaBundle {
  criteria: GeneratedExitCriterion[];
  confidence: number;
  generatedAt: string;
}

export interface ContradictionFinding {
  id: string;
  severity: "critical" | "high" | "medium";
  artifactA: string;
  artifactB: string;
  description: string;
  recommendation: string;
}

export interface DependencyCheckIssue {
  severity: "blocking" | "warning";
  description: string;
  affectedArtifact: string;
  recommendation: string;
}

export interface DependencyCheckResult {
  passed: boolean;
  issues: DependencyCheckIssue[];
  summary: string;
  checkedAt: string;
}

export interface HandoffQualityReview {
  score: number;
  passed: boolean;
  missing: string[];
  strengths: string[];
  recommendation: string;
  reviewedAt: string;
}

export interface ScopeDriftSummary {
  driftIndex: number;
  driftLevel: "none" | "low" | "moderate" | "significant" | "critical";
  additions: string[];
  removals: string[];
  outOfScopeBreaches: string[];
  summary: string;
  recommendation: string;
  monitoredAt: string;
}

export interface BenefitsTrackingKpi {
  name: string;
  baseline: string;
  target: string;
  current: string;
  rag: "green" | "amber" | "red" | "unknown";
  trend: "improving" | "stable" | "declining" | "unknown";
  commentary: string;
}

export interface BenefitsTrackingSummary {
  overallRag: "green" | "amber" | "red";
  summary: string;
  kpis: BenefitsTrackingKpi[];
  atRisk: string[];
  onTrack: string[];
  confidence: number;
  trackedAt: string;
}

export interface BenchmarkComparisonRow {
  dimension: string;
  programValue: string;
  benchmarkRange: string;
  percentile: "bottom 25%" | "middle 50%" | "top 25%";
  signal: "concerning" | "normal" | "strong";
  insight: string;
}

export interface BenchmarkComparisonSummary {
  comparisons: BenchmarkComparisonRow[];
  overallPositioning: "below average" | "average" | "above average";
  keyRisks: string[];
  keyStrengths: string[];
  summary: string;
  confidence: number;
  sampleSize: number;
  comparedAt: string;
}

export interface WeeklyDigestSummary {
  weekSummary: string;
  topPriorities: Array<{ priority: string; reason: string; owner?: string }>;
  atRisk: Array<{ item: string; severity: "critical" | "high"; mitigationSuggestion: string }>;
  decisionsNeeded: string[];
  lastWeekHighlights: string[];
  weekHealthRag: "green" | "amber" | "red";
  motivationalNote: string;
  generatedAt: string;
  weekOf: string;
}

export interface ScopeSignal {
  id: string;
  description: string;
  source: "decision" | "risk" | "phase-evidence" | "stakeholder";
  phase: string;
  severity: "critical" | "high" | "medium" | "low";
  impactOnTimeline: string | null;
  impactOnBudget: string | null;
  recommendPcr: boolean;
  pcrRationale: string | null;
}

export interface ScopePcrSummary {
  scopeSignals: ScopeSignal[];
  overallScopeRisk: "high" | "medium" | "low" | "contained";
  recommendedActions: string[];
  openPcrCount: number;
  confidence: number;
  summary: string;
}

export interface PatternLibraryEntry {
  id: string;
  patternType: "risk" | "intervention" | "milestone-sequence" | "adoption-tactic" | "gate-criteria";
  phaseId: string | null;
  industry: string | null;
  programSize: "small" | "medium" | "large" | "enterprise" | null;
  title: string;
  body: Record<string, unknown>;
  outcome: "successful" | "failed" | "neutral" | null;
  confidence: number;
  sourceProgramId: string | null;
  createdAt: string;
  usedCount: number;
}

export interface AgentEventSummary {
  id: string;
  programId: string;
  agentId: string;
  phaseId: string | null;
  eventType: "triggered" | "completed" | "failed" | "stale";
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface ArtifactVersionSummary {
  id: string;
  programId: string;
  agentId: string;
  phaseId: string | null;
  version: number;
  content: Record<string, unknown>;
  confidence: number | null;
  generatedAt: string;
  supersededAt: string | null;
  supersededBy: string | null;
}

export interface AutonomySettingSummary {
  id: string;
  programId: string;
  agentId: string;
  trustThreshold: number;
  maxAutonomousActionsPerDay: number;
  requiresHumanAboveRisk: string;
  enabled: boolean;
  updatedAt: string;
}

export interface AutonomyLogEntry {
  id: string;
  programId: string;
  agentId: string;
  actionType: string;
  actionPayload: Record<string, unknown> | null;
  confidence: number | null;
  actedAutonomously: boolean;
  reason: string | null;
  createdAt: string;
}

export interface Workstream {
  id: string;
  label: string;
  phaseId: string;
  weight: number;
  pct: number;
  gateScore: number | null;
  owner: string | null;
  status: "active" | "at-risk" | "blocked" | "complete" | "inactive";
}

export type AutonomyLevel = "manual" | "queued" | "supervised" | "autonomous";

export interface ProgramSummary {
  id: string;
  name: string;
  client: string;
  industry: string;
  sponsor: string;
  objective: string;
  readiness: number;
  valueDelivered: number;
  valueProjected: number;
  phases: PhaseSummary[];
  activePhaseId: string;
  activePhaseName: string;
  narrative: string;
  narrativeGeneratedAt: string;
  narrativeConfidence?: number;
  plan: PlanSummary | null;
  planGeneratedAt: string;
  planConfidence?: number;
  milestones: Milestone[];
  milestonesGeneratedAt: string | null;
  milestonesIsRunning?: boolean;
  budgetTracking: BudgetTracking | null;
  budgetGeneratedAt: string | null;
  criticalPath: CriticalPathAnalysis | null;
  criticalPathGeneratedAt: string | null;
  gateReviews: Record<string, GateReview>;
  escalations: Escalation[];
  escalationsLastCheckedAt: string | null;
  closure: ProgramClosure | null;
  closureGeneratedAt: string | null;
  changeImpact: ChangeImpactAssessment | null;
  changeImpactGeneratedAt: string | null;
  stakeholders: StakeholderProfile[];
  stakeholderGeneratedAt: string | null;
  adoption: AdoptionAssessment | null;
  adoptionGeneratedAt: string | null;
  healthHeatmap: HealthHeatmapSummary | null;
  healthHeatmapGeneratedAt: string | null;
  retros: Record<string, PhaseRetro>;
  retrosGeneratedAt: Record<string, string>;
  deck: ExecutiveDeck | null;
  deckGeneratedAt: string | null;
  scopePcr: ScopePcrSummary | null;
  scopePcrGeneratedAt: string | null;
  benefitsTracking: BenefitsTrackingSummary | null;
  benchmarkComparison: BenchmarkComparisonSummary | null;
  weeklyDigest: WeeklyDigestSummary | null;
  methodology?: "atos-standard" | "atos-lite" | "atos-regulated";
  workstreams?: Workstream[];
  patternExtractGeneratedAt: string | null;
  patternExtractCount: number;
  patternQueryCache: Record<string, unknown>[];
  patternQueryCachedAt: string | null;
  patternLibrary: PatternLibraryEntry[];
  similarPatterns: PatternLibraryEntry[];
  agentEvents: AgentEventSummary[];
  artifactHistory: ArtifactVersionSummary[];
  autonomySettings: AutonomySettingSummary[];
  autonomyLog: AutonomyLogEntry[];
  decisionQueue: DecisionSummary[];
  artifacts: ArtifactSummary[];
  risks: RiskSummary[];
  raidEntries: RAIDEntry[];
  raidGeneratedAt: string;
  raidAgentRunning?: boolean;
  twinGraph: {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };
  rawData: Record<string, unknown>;
  updatedAt: string;
}

export interface AgentCardModel {
  agentId: string;
  phaseId: string;
  displayName: string;
  status: AgentStatus;
  autonomyLevel?: AutonomyLevel;
  currentTask?: string;
  confidence?: number;
  lastArtifact?: string;
  pendingDecision?: string;
  pauseReason?: string;
  run?: AgentRun;
}

export interface NudgeSummary {
  id: string;
  type: "insight" | "warning" | "recommendation" | "celebration";
  message: string;
  priority: "low" | "medium" | "high";
  actionLabel?: string;
  actionView?: AppView;
}

export interface ShellState {
  activeView: AppView;
  sidebarExpanded: boolean;
  sidebarPinned: boolean;
  railCollapsed: boolean;
  commandBarOpen: boolean;
  activePhaseId: string;
}
