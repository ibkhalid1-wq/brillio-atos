export type PhaseAgentTaskType =
  | "gate_assessment"
  | "draft_artifact"
  | "extract_adr"
  | "populate_fields"
  | "cross_phase_route"
  | "proactive_nudge"
  | "ask_question"
  | "revise_artifact"
  | "generate_briefing"
  | "generate_handoff"
  | "rebaseline_strategy"
  | "predict_downstream_risk"
  | "retro_adr_generation"
  | "populate_compliance_controls"
  | "escalate";

export type PhaseAgentTaskStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface ReasoningTrace {
  observations: Array<{ type: string; summary: string }>;
  planRationale: string;
  taskType: PhaseAgentTaskType;
  confidence: number;
  contextSignals: string[];
}

export interface PhaseAgentTask {
  id: string;
  type: PhaseAgentTaskType;
  phaseId: string;
  artifactId?: string;
  priority?: "critical" | "high" | "medium" | "low";
  reason?: string;
  meta?: Record<string, any>;
  description: string;
  status: PhaseAgentTaskStatus;
  result?: string;
  confidence?: number;
  reasoningTrace?: ReasoningTrace;
  createdAt: number;
  completedAt?: number;
}

export interface PhaseAgentAuditEntry {
  id: string;
  taskType: PhaseAgentTaskType;
  outcome: "accepted" | "rejected" | "skipped" | "error";
  ts: number;
  insight: string;
  reasoningTrace: string;
  observationSummary: string;
  planSummary: string;
  executionSummary: string;
  evaluationSummary: string;
  confidence: number;
  dataPoints: Array<{ key: string; value: string; weight: "high" | "medium" | "low" }>;
  humanReadable: string;
}

export interface PhaseAgentState {
  phaseId: string;
  programId: string;
  running: boolean;
  iteration: number;
  totalIterationsAllTime: number;
  tasks: PhaseAgentTask[];
  lastObservedReadiness: number;
  lastRanAt: number | null;
  rejectedArtifactIds: string[];
  rejectionCount?: number;
  lastRejectionReason?: string | null;
  successfulTaskTypes: PhaseAgentTaskType[];
  rejectionRate: number;
  acceptanceRate: number;
  draftOutcomeHistory: Array<"accepted" | "rejected">;
  autonomyMode: "high" | "normal" | "cautious";
  escalated: boolean;
  escalationSummary?: string;
  suppressedReason?: "collaborator_active" | "max_iterations" | null;
  auditLog?: PhaseAgentAuditEntry[];
  urgency?: { level: "none" | "medium" | "high" | "critical" | "overdue"; daysRemaining: number | null };
  consumedHandoff?: boolean;
  lastDraftConfidence?: number;
  readinessHistory?: Array<{ ts: string; value: number }>;
  lastBenchmarkDelta?: {
    type: string;
    currentReadiness: number;
    benchmarkReadiness: number;
    delta: number;
    daysInPhase: number | null;
    sampleSize: number;
      message: string;
  } | null;
  invalidatedArtifacts?: Array<{
    artifactId: string;
    sourcePhase: string;
    sourceField: string;
    flaggedAt: string;
  }>;
}

export interface AgentQuestion {
  id: string;
  phaseId: string;
  questions: string[];
  dispatchedAt: number;
  answeredAt?: number;
  answers?: string[];
  applied: boolean;
}

export interface PhaseAgentObservation {
  readiness: number;
  confidence: number;
  blockerCount: number;
  hasUpstreamBlockers: boolean;
  exitsPassing: boolean;
  missingSignatureArtifacts: string[];
  pendingADRCount: number;
  hasUnprocessedAttachments: boolean;
  documentInsightCount: number;
}

export interface PhaseEventPayload {
  sourcePhaseId: string;
  eventType:
    | "artifact_approved"
    | "artifact_rejected"
    | "gate_passed"
    | "gate_blocked"
    | "readiness_dropped"
    | "attachment_added"
    | "briefing_generated"
    | "question_answered"
    | "external_docs_ingested"
    | "state_updated_externally"
    | "preemptive_risk_received"
    | "artifact_invalidated"
    | "scope_change_detected";
  artifactId?: string;
  questionId?: string;
  readiness?: number;
  sourcePhase?: string;
  sourceField?: string;
  timestamp: number;
}

export interface CompletionEstimate {
  estimate: number;
  signals: {
    milestoneCompletion: number | null;
    exitPass: number | null;
    taskCompletion: number | null;
    artifactSignal: number | null;
  };
  generatedAt: string;
}
