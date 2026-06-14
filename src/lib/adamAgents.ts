/**
 * Integration status:
 * - This registry powers the legacy multi-specialist orchestration model (`strategist`, `architect`, etc.).
 * - The V3 shell and `run-agent` edge function currently use the ATOS delivery-agent family (`narrative`, `plan`, `risk`, etc.).
 * - Keep this file as the canonical registry for the legacy orchestration path; do not reuse it for V3 agent-id validation without an explicit id mapping layer.
 */
export type AgentId = "strategist" | "architect" | "governance" | "insight" | "coach";

export type LLMCall = (
  system: string,
  user: string,
  opts?: { max_tokens?: number; description?: string },
) => Promise<string>;

export type AgentDef = {
  id: AgentId;
  name: string;
  description: string;
  applicablePhases: string[];
  maxTokens: number;
  systemPromptAddendum: string;
};

export type AgentResult = {
  agentId: AgentId;
  content: string;
  durationMs: number;
  error?: string;
};

export type OrchestratorDecision = {
  agents: AgentId[];
  parallel: boolean;
  reasoning: string;
};

export type OrchestrationTrace = {
  agents: AgentId[];
  results: AgentResult[];
  orchestrationMs: number;
  synthesized: boolean;
  timedOut?: boolean;
};

export const AGENT_REGISTRY: Record<AgentId, AgentDef> = {
  strategist: {
    id: "strategist",
    name: "Strategy & Value Agent",
    description: "business value, executive mandate, KPIs, ROI, value hypothesis, baseline metrics, program justification",
    applicablePhases: ["strategy", "discover", "valuerealize"],
    maxTokens: 900,
    systemPromptAddendum: `You are the ADAM Strategy & Value specialist. Focus exclusively on: business problem clarity, executive mandate strength, KPI definition, ROI framing, value hypothesis, and baseline metrics. Be specific and evidence-based. Reference actual metrics and mandate data from context. Ignore architecture and governance questions.`,
  },
  architect: {
    id: "architect",
    name: "Architecture & Design Agent",
    description: "technology decisions, architecture patterns, ADRs, integration design, autonomy levels, agent patterns, NFRs",
    applicablePhases: ["design", "build"],
    maxTokens: 900,
    systemPromptAddendum: `You are the ADAM Architecture & Design specialist. Focus exclusively on: technology stack decisions, architecture patterns, agent design patterns, autonomy level selection, integration specifications, NFR constraints, and Architecture Decision Records. Reference existing design decisions from context. Ignore business case and governance questions.`,
  },
  governance: {
    id: "governance",
    name: "Governance & Risk Agent",
    description: "stage gate status, contradictions, compliance, RACI gaps, HITL policy, audit, ethics, risk, trust graduation",
    applicablePhases: ["operate", "govern", "mobilise"],
    maxTokens: 700,
    systemPromptAddendum: `You are the ADAM Governance & Risk specialist. Focus exclusively on: stage gate blockers, contradiction detection, RACI gaps, compliance requirements (GDPR/SOX/HIPAA), HITL policy, audit trail, AI ethics, and trust graduation evidence. Surface specific gaps and blockers with recommended actions.`,
  },
  insight: {
    id: "insight",
    name: "Data & Insight Agent",
    description: "KPI actuals vs baseline, value realization metrics, ROI calculation, performance benchmarks, drift analysis",
    applicablePhases: ["valuerealize", "optimize"],
    maxTokens: 700,
    systemPromptAddendum: `You are the ADAM Data & Insight specialist. Focus exclusively on: quantitative KPI comparison (actual vs baseline), ROI and value realization calculations, performance benchmark analysis, model drift data, and cost efficiency. Always cite specific numbers from context.`,
  },
  coach: {
    id: "coach",
    name: "Methodology Coach Agent",
    description: "methodology guidance, phase navigation, what to do next, best practices, how-to, exit criteria, artifact guidance",
    applicablePhases: ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"],
    maxTokens: 600,
    systemPromptAddendum: `You are the ADAM Methodology Coach. Focus exclusively on: explaining ADAM phases, guiding what to do next, clarifying exit criteria, recommending artifacts to produce, and answering how-to questions. Be prescriptive and action-oriented.`,
  },
};

export function getAgentDef(id: AgentId): AgentDef {
  return AGENT_REGISTRY[id];
}
