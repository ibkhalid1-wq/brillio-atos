export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue | undefined }
  | JsonValue[];

export type AgentRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "complete"
  | "failed"
  | "cancelled";

export type RunTriggeredBy = "user" | "trigger" | "schedule" | "handoff";

export interface AgentHandoff {
  fromAgentId: string;
  fromPhaseId: string;
  toPhaseId: string;
  completedAt: string;
  summary: string;
  keyDecisions: string[];
  artifactIds: string[];
  openQuestions: string[];
  confidence: number;
  recommendedNextAction: string;
}

export interface RunAgentRequest {
  programId: string;
  agentId: string;
  phaseId: string;
  triggeredBy: RunTriggeredBy;
  triggerEvent?: string;
  incomingHandoff?: AgentHandoff | null;
  runId?: string;
  crossPhaseContext?: string;
  decisionId?: string;
  documentId?: string;
  artifactId?: string;
  docText?: string;
  audienceGroup?: "executive" | "operational" | "all";
  memberName?: string;
  memberRole?: string;
  meetingDate?: string;
  meetingDurationMins?: number;
}

export interface RunAgentResponse {
  status: AgentRunStatus;
  runId: string;
  output?: Record<string, JsonValue> | null;
  handoff?: AgentHandoff | null;
  decisionId?: string;
  error?: string;
}

export interface ResumeAgentRequest {
  runId: string;
  decisionId: string;
  resolution: "approved" | "rejected" | "modified";
  humanNote?: string;
  modifiedContent?: string;
}

export interface CopilotThreadMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

export interface CopilotChatRequest {
  programId: string;
  workspaceId: string;
  memoryContext?: string;
  message: string;
  stream?: boolean;
}

export interface AgentObservationRecord {
  runId: string;
  programId: string;
  agentId: string;
  phaseId: string;
  observationType:
    | "context_built"
    | "memory_retrieved"
    | "prompt_sent"
    | "response_received"
    | "artifact_drafted"
    | "decision_queued"
    | "handoff_created"
    | "trigger_fired"
    | "error"
    | "pause_requested"
    | "resume";
  payload?: JsonValue;
  tokens?: number;
  latencyMs?: number;
}

export interface AgentRunRow {
  id: string;
  program_id: string;
  agent_id: string;
  phase_id: string;
  status: AgentRunStatus;
  trigger_event: string | null;
  input_context: JsonValue | null;
  output: JsonValue | null;
  handoff: JsonValue | null;
  reasoning_trace: string[] | null;
  confidence: number | null;
  tokens_used: number | null;
  error_message: string | null;
  awaiting_decision_id: string | null;
  scheduled_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  owner_id: string | null;
}
