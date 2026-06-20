import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentQuestion, PhaseAgentState, ReasoningTrace } from "@/lib/adamPhaseAgentTypes";
import { COMMUNICATION_AUDIENCES, DECISION_QUEUE_PERSONAS } from "@/lib/adamDecisionUtils";
import type { DecisionItem } from "@/lib/adamDecisionUtils";
import { FormattedDocument } from "@/components/FormattedDocument";

type Props = {
  items: DecisionItem[];
  phaseAgents: Record<string, {
    agentState?: PhaseAgentState | null;
    resetSession?: () => void;
    markRejected?: (artifactId: string) => void;
  }>;
  projectData: any;
  activeItemId: string | null;
  onNavigate: (phaseId: string) => void;
  onOpenItemSource?: (item: DecisionItem, fallbackTarget?: string) => void;
  onDismissItem: (itemId: string) => void;
  onAction?: (itemId: string, action: string) => void;
  onSelectItem: (itemId: string) => void;
  onResetAgent: (phaseId: string) => void;
  onAcceptDraft: (phaseId: string, artifactId: string) => void;
  onRejectDraft: (phaseId: string, artifactId: string) => void;
  onAnswerQuestion: (questionId: string, answers: string[]) => void | Promise<void>;
  onRegenerateBriefing: (phaseId: string) => void;
  onExportBriefing: (phaseId: string) => void;
  personaId: string;
  onPersonaChange: (id: string) => void;
  onGenerateSteeringPack: () => void;
  onGenerateMeetingAgenda?: () => void;
  programQA: Array<{ question: string; answer: string; askedAt: string }>;
  onAskQuestion: (question: string) => void;
  qaLoading: boolean;
  onRegenerateCommunication?: (commId: string, audienceId: string) => void;
  onMarkCommunicationSent?: (commId: string) => void;
  onUpdateScopeChange?: (id: string, status: "approved" | "rejected") => void;
  onRollbackArtifact?: (phaseId: string, artifactId: string, version: number) => void;
  onApproveGate?: (phaseId: string, roleId: string) => void;
  onRejectGate?: (phaseId: string, roleId: string) => void;
  onSearchNavigate?: (query: string) => void;
  forecast?: any;
};

const COLORS = {
  shell: "#0f172a",
  panel: "#111827",
  card: "rgba(255,255,255,0.04)",
  cardSelected: "#ffffff",
  white: "#ffffff",
  gray100: "#f1f5f9",
  gray200: "#e2e8f0",
  gray400: "#94a3b8",
  gray500: "#64748b",
  gray700: "#334155",
  gray900: "#0f172a",
  blue: "#2563eb",
  blueSoft: "rgba(37,99,235,0.12)",
  red: "#dc2626",
  amber: "#d97706",
  cyan: "#0891b2",
  green: "#16a34a",
};

type DetailTone = "blue" | "amber" | "red" | "green" | "purple" | "slate";

const DETAIL_TONES: Record<DetailTone, { background: string; border: string; text: string }> = {
  blue: { background: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" },
  amber: { background: "#fff7ed", border: "#fdba74", text: "#9a3412" },
  red: { background: "#fef2f2", border: "#fecaca", text: "#b91c1c" },
  green: { background: "#f0fdf4", border: "#bbf7d0", text: "#166534" },
  purple: { background: "#faf5ff", border: "#d8b4fe", text: "#7e22ce" },
  slate: { background: "#f8fafc", border: "#e2e8f0", text: COLORS.gray700 },
};

const TYPE_ICONS: Record<string, string> = {
  escalation: "⚠",
  draft_review: "✦",
  question: "?",
  exit_proposal: "→",
  adr_proposal: "◊",
  revision_ready: "↺",
  briefing_ready: "§",
  rebaseline: "∆",
  steering_pack: "▣",
  risk_mitigation: "!",
  agent_conflict: "⚡",
  handoff_ready: "→",
  meeting_agenda: "☰",
  raid_alert: "⚠",
  communication_ready: "✉",
  scope_change: "∆",
  hypothesis_alert: "✕",
  gate_approval: "✓",
  capacity_alert: "👥",
  uat_ready: "🧪",
  milestone_slip: "📅",
  change_request: "🔄",
  stakeholder_alert: "👥",
  benefit_alert: "📈",
  calendar_proposal: "🗓️",
  budget_alert: "💰",
  retro_ready: "🔁",
  integration_conflict: "🔗",
  closure_ready: "🏁",
  data_governance_gap: "🗃️",
  critical_path_alert: "🔴",
  escalation_raised: "🚨",
  resource_alert: "👤",
  plan_action: "➜",
  checklist_alert: "☑",
};

const PHASE_LABELS: Record<string, string> = {
  strategy: "Strategy",
  mobilise: "Mobilise",
  discover: "Discover",
  design: "Design",
  agents: "Agent Studio",
  build: "Build",
  operate: "Operate",
  govern: "Govern",
  valuerealize: "Value Realization",
  adoption: "Adoption & Change",
  delivery: "Delivery",
  changeimpact: "Change Impact",
  stakeholders: "Stakeholders",
  pcr: "Change Requests",
  decisions: "Action Queue",
  intelligence: "Intelligence",
  assets: "Asset Library",
  twin: "Transformation Twin",
  heatmap: "Health Heatmap",
  benefits: "Benefits",
  budget: "Budget",
  retro: "Retrospective",
  closure: "Closure",
};

function getPriorityColor(priority: DecisionItem["priority"]) {
  if (priority === "critical") return COLORS.red;
  if (priority === "high") return COLORS.blue;
  if (priority === "medium") return COLORS.amber;
  return COLORS.cyan;
}

function getTimeAgo(createdAt: number) {
  const deltaMs = Math.max(Date.now() - Number(createdAt || 0), 0);
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getFilteredItems(items: DecisionItem[], filterId: string) {
  if (filterId === "action") {
    return items.filter((item) => item.priority === "critical" || item.priority === "high");
  }
  if (filterId === "review") {
    return items.filter((item) => item.priority === "medium");
  }
  if (filterId === "proposals") {
    return items.filter((item) => item.priority === "info" && !isExecutiveMaterialItem(item));
  }
  if (filterId === "materials") {
    return items.filter(isExecutiveMaterialItem);
  }
  return items;
}

function getFilterEmptyState(filterId: string) {
  if (filterId === "action") {
    return "No approvals, escalations, or input requests need attention right now.";
  }
  if (filterId === "review") {
    return "No drafts or review items are waiting for assessment right now.";
  }
  if (filterId === "proposals") {
    return "No lower-priority signals are waiting for review right now.";
  }
  if (filterId === "materials") {
    return "No executive materials are ready yet. Briefings, agendas, and steering packs will appear here.";
  }
  return "ADAM is working in the background. This inbox will surface the next action when your input is needed.";
}

function getSectionIdForItem(item: DecisionItem): "action" | "review" | "proposals" | "materials" {
  if (isExecutiveMaterialItem(item)) return "materials";
  if (item.priority === "critical" || item.priority === "high") return "action";
  if (item.priority === "medium") return "review";
  return "proposals";
}

function getDecisionPhaseLabel(phaseId?: string | null) {
  const normalized = String(phaseId || "").toLowerCase().trim();
  if (PHASE_LABELS[normalized]) return PHASE_LABELS[normalized];
  return String(phaseId || "Program")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getDecisionTypeLabel(item: DecisionItem) {
  const labels: Record<string, string> = {
    escalation: "Escalation",
    draft_review: "Artifact review",
    question: "Input needed",
    exit_proposal: "Gate review",
    adr_proposal: "Architecture review",
    revision_ready: "Revision ready",
    briefing_ready: "Executive briefing",
    rebaseline: "Re-baseline",
    steering_pack: "Steering pack",
    risk_mitigation: "Risk action",
    agent_conflict: "Conflict",
    handoff_ready: "Handoff",
    meeting_agenda: "Meeting agenda",
    raid_alert: "RAID alert",
    communication_ready: "Communication",
    scope_change: "Scope change",
    hypothesis_alert: "Hypothesis alert",
    gate_approval: "Approval",
    capacity_alert: "Capacity",
    uat_ready: "UAT review",
    milestone_slip: "Milestone",
    change_request: "Change request",
    stakeholder_alert: "Stakeholder",
    benefit_alert: "Benefit risk",
    calendar_proposal: "Scheduling",
    budget_alert: "Budget",
    retro_ready: "Retro",
    integration_conflict: "Integration",
    closure_ready: "Closure",
    data_governance_gap: "Data governance",
    critical_path_alert: "Critical path",
    escalation_raised: "Raised escalation",
    resource_alert: "Resource",
    plan_action: "Plan action",
    checklist_alert: "Checklist",
  };
  return labels[item.type] || "Action";
}

function getDecisionActionLabel(item: DecisionItem) {
  const labels: Record<string, string> = {
    escalation: "Review escalation",
    draft_review: "Review draft",
    question: "Answer now",
    exit_proposal: "Start exit review",
    adr_proposal: "Review decisions",
    revision_ready: "Review revision",
    briefing_ready: "Review briefing",
    rebaseline: "Review proposal",
    steering_pack: "Review pack",
    risk_mitigation: "Review risk",
    agent_conflict: "Resolve conflict",
    handoff_ready: "Review handoff",
    meeting_agenda: "Review agenda",
    raid_alert: "Review RAID",
    communication_ready: "Review draft",
    scope_change: "Review change",
    hypothesis_alert: "Review evidence",
    gate_approval: "Approve gate",
    capacity_alert: "Review capacity",
    uat_ready: "Review scenarios",
    milestone_slip: "Review milestone",
    change_request: "Review request",
    stakeholder_alert: "Review stakeholder",
    benefit_alert: "Review benefit",
    calendar_proposal: "Review calendar",
    budget_alert: "Review budget",
    retro_ready: "Open retrospective",
    integration_conflict: "Resolve conflict",
    closure_ready: "Review closure",
    data_governance_gap: "Review data gap",
    critical_path_alert: "Review path",
    escalation_raised: "Review escalation",
    resource_alert: "Review resource",
    plan_action: "Open action",
    checklist_alert: "Review checklist",
  };
  return item.actionLabel || labels[item.type] || "Open";
}

function isExecutiveMaterialItem(item: DecisionItem) {
  return item.type === "steering_pack"
    || item.type === "meeting_agenda"
    || item.type === "briefing_ready";
}

function getQueueSummary(items: DecisionItem[]) {
  return {
    action: items.filter((item) => item.priority === "critical" || item.priority === "high").length,
    review: items.filter((item) => item.priority === "medium").length,
    signals: items.filter((item) => item.priority === "info" && !isExecutiveMaterialItem(item)).length,
    materials: items.filter(isExecutiveMaterialItem).length,
  };
}

const TOP_ACTION_LIMIT = 5;

function getTopQueueItems(items: DecisionItem[]) {
  const actionableItems = items.filter((item) => !isExecutiveMaterialItem(item));
  const rankedItems = actionableItems.length ? actionableItems : items;
  return rankedItems.slice(0, TOP_ACTION_LIMIT);
}

function buildActionAiPrompt(item: DecisionItem) {
  return `Help me respond to this ADAM action queue item.

Workspace: ${getDecisionPhaseLabel(item.phaseId)}
Action type: ${getDecisionTypeLabel(item)}
Requested action: ${getDecisionActionLabel(item)}
Title: ${item.title}
Summary: ${item.summary}

Draft a concise, decision-ready response I can use right now.
Include:
1. the recommended response or decision,
2. the rationale tied to program risk, value, or delivery impact,
3. the immediate next steps,
4. a short message I can send or record back into the program.

If assumptions are required, state them clearly.`;
}

function buildQueueOutlookPrompt({
  queueSummary,
  forecast,
  personaLabel,
}: {
  queueSummary: { action: number; review: number; signals: number; materials: number };
  forecast?: { atRiskPhaseCount?: number; totalRemainingDays?: number } | null;
  personaLabel: string;
}) {
  return `Give me a concise ADAM queue outlook for the ${personaLabel} persona.

Current queue summary:
- Immediate actions: ${queueSummary.action}
- Reviews waiting: ${queueSummary.review}
- Signals waiting: ${queueSummary.signals}
- Executive materials ready: ${queueSummary.materials}
- At-risk phases: ${forecast?.atRiskPhaseCount ?? 0}
- Remaining program days: ${Number.isFinite(forecast?.totalRemainingDays) ? forecast?.totalRemainingDays : "unknown"}

Explain:
1. whether the queue is truly calm or if work is building elsewhere,
2. what ADAM is monitoring in the background,
3. the one thing leadership should check next.

Keep it short, executive-ready, and action-oriented.`;
}

function DecisionQuestionPanel({
  question,
  onAnswer,
}: {
  question: AgentQuestion;
  onAnswer: (questionId: string, answers: string[]) => void | Promise<void>;
}) {
  const [answers, setAnswers] = useState<string[]>(question?.answers ?? []);
  const totalQuestions = question?.questions?.length ?? 0;
  const answeredCount = answers.filter((answer) => String(answer || "").trim()).length;

  useEffect(() => {
    setAnswers(question?.answers ?? []);
  }, [question?.id]);

  return (
    <div>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          borderRadius: 999,
          padding: "6px 10px",
          fontSize: 10.5,
          fontWeight: 800,
          color: "#1d4ed8",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          marginBottom: 12,
        }}
      >
        Input needed
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.gray900, marginBottom: 8 }}>
        ADAM needs your answer before it can continue
      </div>
      <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.7, marginBottom: 16 }}>
        Respond to the questions below so the workspace can continue with clear direction instead of relying on assumptions.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            borderRadius: 999,
            padding: "4px 9px",
            fontSize: 10.5,
            fontWeight: 700,
            color: "#1d4ed8",
            background: "#dbeafe",
            border: "1px solid #bfdbfe",
          }}
        >
          {answeredCount} of {totalQuestions} answered
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            borderRadius: 999,
            padding: "4px 9px",
            fontSize: 10.5,
            fontWeight: 700,
            color: COLORS.gray500,
            background: "#f8fafc",
            border: `1px solid ${COLORS.gray200}`,
          }}
        >
          Next step: apply answers and continue
        </span>
      </div>
      <div
        style={{
          background: "rgba(239,246,255,0.98)",
          border: "1px solid #bfdbfe",
          borderRadius: 14,
          padding: "14px 15px",
        }}
      >
        {(question?.questions ?? []).map((entry, index) => (
          <div
            key={`${question.id}-${index}`}
            style={{
              marginBottom: 10,
              borderRadius: 12,
              background: "rgba(255,255,255,0.74)",
              border: "1px solid rgba(191,219,254,0.9)",
              padding: "12px 12px 10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 22,
                  height: 22,
                  borderRadius: 999,
                  background: answeredCount > index && String(answers[index] || "").trim() ? "#dbeafe" : "#eff6ff",
                  color: "#1d4ed8",
                  fontSize: 10.5,
                  fontWeight: 800,
                }}
              >
                {index + 1}
              </span>
              <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.gray900 }}>{entry}</div>
            </div>
            <textarea
              value={answers[index] || ""}
              onChange={(event) => {
                const next = [...answers];
                next[index] = event.target.value;
                setAnswers(next);
              }}
              rows={2}
              placeholder="Your answer..."
              style={{
                width: "100%",
                fontSize: 12,
                padding: "8px 10px",
                border: "1px solid #bfdbfe",
                borderRadius: 8,
                background: COLORS.white,
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ fontSize: 11.5, color: COLORS.gray500, lineHeight: 1.5 }}>
            ADAM will apply these answers to the workspace context and continue the queue.
          </div>
          <button
            type="button"
            disabled={!answers.some((answer) => String(answer || "").trim())}
            onClick={() => onAnswer(question.id, answers)}
            style={{
              border: "none",
              borderRadius: 10,
              background: COLORS.gray900,
              color: COLORS.white,
              fontSize: 11.5,
              fontWeight: 700,
              padding: "8px 12px",
              cursor: "pointer",
              opacity: answers.some((answer) => String(answer || "").trim()) ? 1 : 0.5,
            }}
          >
            Apply answers and continue
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentHistoryPanel({ agentState }: { agentState: PhaseAgentState | null }) {
  if (!agentState?.auditLog?.length) return null;
  return (
    <details style={{ marginTop: 24 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, color: COLORS.gray500 }}>
        Agent history ({agentState.auditLog.length} actions)
      </summary>
      <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto" }}>
        {[...(agentState.auditLog || [])].reverse().map((entry, index) => (
          <div
            key={`${entry.ts}-${entry.taskType}-${index}`}
            style={{
              fontSize: 11,
              padding: "4px 0",
              borderBottom: `1px solid ${COLORS.gray100}`,
              display: "flex",
              gap: 8,
            }}
          >
            <span style={{ color: "#9ca3af", whiteSpace: "nowrap" }}>{new Date(entry.ts).toLocaleTimeString()}</span>
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{entry.taskType}</span>
            <span style={{ color: entry.outcome === "accepted" ? COLORS.green : entry.outcome === "error" || entry.outcome === "rejected" ? COLORS.red : COLORS.amber }}>{entry.outcome}</span>
            {entry.insight ? <span style={{ color: COLORS.gray500, flex: 1 }}>{entry.insight}</span> : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function ProgramAskBar({
  onAsk,
  onSearchNavigate,
  loading,
  history,
  draftRequest,
  onDraftHandled,
}: {
  onAsk: (question: string) => void;
  onSearchNavigate?: (query: string) => void;
  loading: boolean;
  history: Array<{ question: string; answer: string; askedAt: string }>;
  draftRequest?: { id: string; prompt: string; sourceLabel?: string; autoSubmit?: boolean } | null;
  onDraftHandled?: () => void;
}) {
  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [contextLabel, setContextLabel] = useState<string | null>(null);

  useEffect(() => {
    if (loading) setIsOpen(true);
  }, [loading]);

  useEffect(() => {
    if (!draftRequest?.id || !draftRequest.prompt) return;
    setIsOpen(true);
    setExpanded(true);
    setContextLabel(draftRequest.sourceLabel || null);
    if (draftRequest.autoSubmit) {
      if (loading) {
        setInput(draftRequest.prompt);
        return;
      }
      onAsk(draftRequest.prompt);
      setInput("");
      onDraftHandled?.();
      return;
    }
    setInput(draftRequest.prompt);
    onDraftHandled?.();
  }, [draftRequest, loading, onAsk, onDraftHandled]);

  const submit = () => {
    if (!input.trim() || loading) return;
    const question = input.trim();
    const isContentSearch = /\b(find|show|where|what did|search)\b/i.test(question);
    if (isContentSearch && onSearchNavigate) {
      onSearchNavigate(question);
    } else {
      onAsk(question);
    }
    setInput("");
    setExpanded(true);
    setIsOpen(true);
  };

  return (
    <div style={{ borderBottom: `1px solid ${COLORS.gray200}`, background: "#f9fafb" }}>
      {isOpen ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 16px 8px",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.gray500, marginBottom: 3 }}>
              Ask ADAM
            </div>
            <div style={{ fontSize: 11.5, color: COLORS.gray700, lineHeight: 1.5 }}>
              Need context on a blocker, artifact, or decision? Ask without leaving the queue.
            </div>
            {contextLabel ? (
              <div style={{ fontSize: 10.5, color: COLORS.blue, lineHeight: 1.5, marginTop: 4, fontWeight: 700 }}>
                Drafting support for: {contextLabel}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              setContextLabel(null);
            }}
            style={{
              flexShrink: 0,
              padding: "7px 12px",
              borderRadius: 999,
              background: COLORS.gray900,
              color: COLORS.white,
              border: `1px solid ${COLORS.gray900}`,
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            Hide advisor
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "7px 16px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: COLORS.gray700 }}>
              Ask ADAM
            </div>
            <div style={{ fontSize: 11, color: COLORS.gray500, lineHeight: 1.4 }}>
              Ask for context without leaving the queue.
            </div>
          </div>
          <span
            style={{
              flexShrink: 0,
              padding: "5px 10px",
              borderRadius: 999,
              background: COLORS.white,
              color: COLORS.gray700,
              border: `1px solid ${COLORS.gray200}`,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {history.length ? `${history.length} saved` : "Open"}
          </span>
        </button>
      )}
      {isOpen ? (
        <div style={{ padding: "0 16px 12px" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                if (contextLabel) setContextLabel(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
                if (event.key === "Escape") setIsOpen(false);
              }}
              placeholder='Ask about this program… e.g. "Why did design gate fail?"'
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: 8,
                border: `1px solid ${COLORS.gray200}`,
                fontSize: 13,
                outline: "none",
                background: COLORS.white,
              }}
            />
            <button
              type="button"
              onClick={submit}
              disabled={loading || !input.trim()}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                background: COLORS.blue,
                color: COLORS.white,
                border: "none",
                cursor: loading ? "wait" : "pointer",
                fontSize: 13,
                opacity: loading || !input.trim() ? 0.6 : 1,
              }}
            >
              {loading ? "…" : "Ask"}
            </button>
          </div>
          {history.length ? (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                style={{ fontSize: 11, color: COLORS.gray500, background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                {expanded ? "▲" : "▼"} {history.length} previous answer{history.length > 1 ? "s" : ""}
              </button>
              {expanded ? (
                <div style={{ marginTop: 8, maxHeight: 300, overflowY: "auto" }}>
                  {history.map((item, index) => (
                    <div key={`${item.askedAt}-${index}`} style={{ marginBottom: 12, padding: 10, background: COLORS.white, borderRadius: 6, border: `1px solid ${COLORS.gray200}` }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Q: {item.question}</div>
                      <FormattedDocument content={item.answer} compact />
                      <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>{new Date(item.askedAt).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function VersionHistoryPanel({
  versions,
  currentContent,
  onRollback,
  onClose,
}: {
  versions: Array<{ version: number; savedAt: string; author: string; changeType: string; note: string | null; content: string }>;
  currentContent: string;
  onRollback: (version: number) => void;
  onClose: () => void;
}) {
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);

  const computeDiff = (a: string, b: string) => {
    const aLines = a.split("\n");
    const bLines = b.split("\n");
    const added = bLines.filter((line) => !aLines.includes(line)).length;
    const removed = aLines.filter((line) => !bLines.includes(line)).length;
    return { added, removed };
  };

  const changeLabels: Record<string, { label: string; color: string }> = {
    agent_draft: { label: "Agent draft", color: "#2563eb" },
    agent_revision: { label: "Agent revision", color: "#7c3aed" },
    approval: { label: "Approved", color: "#16a34a" },
    edit: { label: "Manual edit", color: "#d97706" },
    rollback: { label: "Rollback snap", color: "#6b7280" },
  };

  return (
    <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 340, background: "white", borderLeft: "1px solid #e5e7eb", overflowY: "auto", zIndex: 10, boxShadow: "-4px 0 12px rgba(0,0,0,0.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid #e5e7eb" }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Version History ({versions.length})</span>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 16 }}>×</button>
      </div>
      {versions.map((versionEntry) => {
        const diff = computeDiff(versionEntry.content, currentContent);
        const label = changeLabels[versionEntry.changeType] ?? { label: versionEntry.changeType, color: "#6b7280" };
        const isPreviewing = previewVersion === versionEntry.version;
        return (
          <div key={versionEntry.version} style={{ padding: "10px 16px", borderBottom: "1px solid #f3f4f6" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "#9ca3af" }}>v{versionEntry.version}</span>
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: `${label.color}20`, color: label.color, fontWeight: 600 }}>{label.label}</span>
              <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: "auto" }}>{new Date(versionEntry.savedAt).toLocaleDateString()}</span>
            </div>
            {versionEntry.note ? <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{versionEntry.note}</div> : null}
            <div style={{ display: "flex", gap: 4, fontSize: 10, color: "#9ca3af", marginBottom: 6 }}>
              <span style={{ color: "#16a34a" }}>+{diff.added}</span>
              <span style={{ color: "#dc2626" }}>−{diff.removed}</span>
              <span>lines vs current</span>
            </div>
            {isPreviewing ? (
              <pre style={{ fontSize: 10, background: "#f9fafb", padding: 8, borderRadius: 4, maxHeight: 120, overflowY: "auto", whiteSpace: "pre-wrap", marginBottom: 6 }}>
                {versionEntry.content.slice(0, 400)}{versionEntry.content.length > 400 ? "…" : ""}
              </pre>
            ) : null}
            <div style={{ display: "flex", gap: 4 }}>
              <button type="button" onClick={() => setPreviewVersion(isPreviewing ? null : versionEntry.version)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid #e5e7eb", cursor: "pointer", background: isPreviewing ? "#f3f4f6" : "white" }}>
                {isPreviewing ? "Hide" : "Preview"}
              </button>
              <button type="button" onClick={() => onRollback(versionEntry.version)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid #fbbf24", background: "#fef3c7", cursor: "pointer", color: "#92400e" }}>
                Restore
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QualityRadar({ scores }: { scores: { completeness: number; alignment: number } }) {
  const dimensions = [
    { label: "Completeness", value: scores.completeness },
    { label: "Alignment", value: scores.alignment },
  ];
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", marginBottom: 8 }}>Quality Score</div>
      {dimensions.map((dimension) => (
        <div key={dimension.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12, width: 100, color: COLORS.gray500 }}>{dimension.label}</span>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: COLORS.gray200 }}>
            <div
              style={{
                width: `${dimension.value}%`,
                height: "100%",
                borderRadius: 3,
                background: dimension.value >= 70 ? COLORS.green : dimension.value >= 50 ? COLORS.amber : COLORS.red,
                transition: "width 0.4s",
              }}
            />
          </div>
          <span style={{ fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", width: 30, textAlign: "right", color: "#374151" }}>
            {dimension.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function humanizeTraceLabel(value: string) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function humanizeTraceSignal(value: string) {
  const cleaned = String(value || "")
    .replace(/[.[\]]+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? humanizeTraceLabel(cleaned) : "Signal";
}

function ReasoningTracePanel({ trace, onClose }: { trace: ReasoningTrace; onClose: () => void }) {
  const contextSignals = trace.contextSignals || [];
  const observations = trace.observations || [];

  return (
    <div
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: 320,
        background: COLORS.white,
        borderLeft: `1px solid ${COLORS.gray200}`,
        padding: 20,
        overflowY: "auto",
        zIndex: 10,
        boxShadow: "-4px 0 12px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Why ADAM surfaced this</span>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#9ca3af" }}>×</button>
      </div>

      {contextSignals.length ? (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", marginBottom: 6 }}>Signals considered</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {contextSignals.map((signal, index) => (
              <span
                key={`${signal}-${index}`}
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: "4px 8px",
                  borderRadius: 999,
                  background: "#f8fafc",
                  border: `1px solid ${COLORS.gray200}`,
                  color: COLORS.gray700,
                }}
              >
                {humanizeTraceSignal(signal)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {observations.length ? (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", marginBottom: 6 }}>
            What ADAM noticed ({observations.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {observations.map((observation, index) => (
              <div
                key={`${observation.type}-${index}`}
                style={{
                  borderRadius: 10,
                  border: `1px solid ${COLORS.gray200}`,
                  background: "#f8fafc",
                  padding: "9px 10px",
                }}
              >
                <div style={{ fontSize: 10.5, fontWeight: 800, color: COLORS.blue, marginBottom: 4 }}>
                  {humanizeTraceLabel(observation.type)}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.6, color: COLORS.gray700 }}>
                  {observation.summary}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", marginBottom: 6 }}>Why this reached your queue</div>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "#374151" }}>{trace.planRationale}</p>
      </div>

      {trace.confidence > 0 ? (
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", marginBottom: 6 }}>Confidence</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: COLORS.gray200 }}>
              <div style={{ width: `${trace.confidence * 100}%`, height: "100%", borderRadius: 2, background: COLORS.blue }} />
            </div>
            <span style={{ fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              {Math.round(trace.confidence * 100)}%
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getTraceTaskType(item: DecisionItem | null) {
  if (!item) return null;
  if (item.type === "draft_review") return "draft_artifact";
  if (item.type === "question") return "ask_question";
  if (item.type === "escalation") return "escalate";
  if (item.type === "communication_ready") {
    return item.payload?.eventType === "escalation" ? "escalate" : "gate_assessment";
  }
  if (item.type === "briefing_ready") return "generate_briefing";
  if (item.type === "rebaseline") return "rebaseline_strategy";
  if (item.type === "risk_mitigation") return "predict_downstream_risk";
  if (item.type === "handoff_ready") return "generate_handoff";
  if (item.type === "meeting_agenda") return "proactive_nudge";
  return null;
}

function findReasoningTrace(item: DecisionItem | null, agentState: PhaseAgentState | null) {
  const taskType = getTraceTaskType(item);
  if (!taskType || !agentState?.tasks?.length) return null;
  const task = [...agentState.tasks].reverse().find((entry) => {
    if (entry.type !== taskType) return false;
    if (item?.artifactId && entry.artifactId && entry.artifactId !== item.artifactId) return false;
    return !!entry.reasoningTrace;
  });
  return task?.reasoningTrace || null;
}

function opensInDetailPane(item: DecisionItem) {
  return item.type === "steering_pack" || item.type === "meeting_agenda";
}

export function DecisionQueueView({
  items,
  phaseAgents,
  projectData,
  activeItemId,
  onNavigate,
  onOpenItemSource,
  onDismissItem,
  onAction,
  onSelectItem,
  onResetAgent,
  onAcceptDraft,
  onRejectDraft,
  onAnswerQuestion,
  onRegenerateBriefing,
  onExportBriefing,
  personaId,
  onPersonaChange,
  onGenerateSteeringPack,
  onGenerateMeetingAgenda,
  programQA,
  onAskQuestion,
  qaLoading,
  onRegenerateCommunication,
  onMarkCommunicationSent,
  onUpdateScopeChange,
  onRollbackArtifact,
  onApproveGate,
  onRejectGate,
  onSearchNavigate,
  forecast,
}: Props) {
  const [filterId, setFilterId] = useState("all");
  const filteredItems = useMemo(() => getFilteredItems(items, filterId), [items, filterId]);
  const topQueueItems = useMemo(() => getTopQueueItems(items), [items]);
  const queueSummary = useMemo(() => getQueueSummary(items), [items]);
  const groupedItems = useMemo(() => ({
    action: getFilteredItems(items, "action").filter((item) => !isExecutiveMaterialItem(item)),
    review: getFilteredItems(items, "review").filter((item) => !isExecutiveMaterialItem(item)),
    proposals: getFilteredItems(items, "proposals").filter((item) => !isExecutiveMaterialItem(item)),
    materials: items.filter(isExecutiveMaterialItem),
  }), [items]);
  const [materialsExpanded, setMaterialsExpanded] = useState(false);
  const [personaExpanded, setPersonaExpanded] = useState(false);
  const [shortcutsExpanded, setShortcutsExpanded] = useState(false);
  const [sectionExpanded, setSectionExpanded] = useState({
    action: true,
    review: false,
    proposals: false,
    materials: false,
  });
  const [selectedItemId, setSelectedItemId] = useState<string | null>(activeItemId);
  const [aiDraftRequest, setAiDraftRequest] = useState<{ id: string; prompt: string; sourceLabel?: string; autoSubmit?: boolean } | null>(null);
  const navigableItems = useMemo(() => {
    if (filterId === "all") {
      return topQueueItems;
    }
    return filteredItems;
  }, [filterId, filteredItems, topQueueItems]);
  const topQueueOverflowCount = useMemo(() => {
    const actionableItems = items.filter((item) => !isExecutiveMaterialItem(item));
    const rankedCount = (actionableItems.length ? actionableItems : items).length;
    return Math.max(rankedCount - topQueueItems.length, 0);
  }, [items, topQueueItems]);

  useEffect(() => {
    if (groupedItems.materials.length > 0) {
      setMaterialsExpanded(true);
    }
  }, [groupedItems.materials.length]);
  useEffect(() => {
    if (!selectedItemId) return;
    const selected = items.find((item) => item.id === selectedItemId);
    if (!selected) return;
    const sectionId = getSectionIdForItem(selected);
    setSectionExpanded((current) => (current[sectionId] ? current : { ...current, [sectionId]: true }));
  }, [items, selectedItemId]);
  const [showTrace, setShowTrace] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const openItemSource = (item: DecisionItem | null, fallbackTarget?: string) => {
    if (!item) {
      if (fallbackTarget) onNavigate(fallbackTarget);
      return;
    }
    if (onOpenItemSource) {
      onOpenItemSource(item, fallbackTarget);
      return;
    }
    onNavigate(fallbackTarget || item.phaseId);
  };

  useEffect(() => {
    if (filterId === "action" && !filteredItems.length && items.length) {
      setFilterId("all");
    }
  }, [filterId, filteredItems.length, items.length]);

  useEffect(() => {
    if (activeItemId) {
      setSelectedItemId(activeItemId);
      return;
    }
    if (!navigableItems.length) {
      setSelectedItemId(null);
      return;
    }
    if (!navigableItems.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(navigableItems[0].id);
    }
  }, [activeItemId, navigableItems, selectedItemId]);

  useEffect(() => {
    setShowTrace(false);
    setShowHistory(false);
  }, [selectedItemId]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || !navigableItems.length) return;
      const currentIndex = navigableItems.findIndex((item) => item.id === selectedItemId);
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = currentIndex >= 0 ? Math.min(currentIndex + 1, navigableItems.length - 1) : 0;
        const nextItem = navigableItems[nextIndex];
        if (nextItem) {
          setSelectedItemId(nextItem.id);
          onSelectItem(nextItem.id);
        }
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const nextIndex = currentIndex >= 0 ? Math.max(currentIndex - 1, 0) : 0;
        const nextItem = navigableItems[nextIndex];
        if (nextItem) {
          setSelectedItemId(nextItem.id);
          onSelectItem(nextItem.id);
        }
        return;
      }
      if (event.key === "Enter" || event.key === "o") {
        const currentItem = currentIndex >= 0 ? navigableItems[currentIndex] : navigableItems[0];
        if (!currentItem) return;
        event.preventDefault();
        if (opensInDetailPane(currentItem)) {
          setSelectedItemId(currentItem.id);
          onSelectItem(currentItem.id);
          return;
        }
        openItemSource(currentItem, currentItem.phaseId);
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsExpanded((value) => !value);
        return;
      }
      if ((event.key === "x" || event.key === "Backspace") && currentIndex >= 0) {
        const currentItem = navigableItems[currentIndex];
        if (!currentItem?.dismissable) return;
        event.preventDefault();
        dismissAndAdvance(currentItem.id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigableItems, onDismissItem, onSelectItem, openItemSource, selectedItemId]);

  const selectedItem = navigableItems.find((item) => item.id === selectedItemId)
    || items.find((item) => item.id === selectedItemId)
    || null;
  const selectedIndex = selectedItem
    ? navigableItems.findIndex((item) => item.id === selectedItem.id)
    : -1;
  const previousItem = selectedIndex > 0 ? navigableItems[selectedIndex - 1] : null;
  const nextItem = selectedIndex >= 0 && selectedIndex < navigableItems.length - 1
    ? navigableItems[selectedIndex + 1]
    : null;
  const primaryQueueItem = topQueueItems[0] || items[0] || null;
  const activePersonaLabel = DECISION_QUEUE_PERSONAS[personaId]?.label || "Executive";
  const activeQueueViewLabel = filterId === "all"
    ? "Top actions"
    : filterId === "action"
      ? "Needs action"
      : filterId === "review"
        ? "Review"
        : filterId === "proposals"
          ? "Signals"
          : "Materials";
  const activeQueueViewCount = filterId === "all" ? topQueueItems.length : filteredItems.length;
  const queueHasNoWaitingWork = queueSummary.action === 0
    && queueSummary.review === 0
    && queueSummary.signals === 0
    && queueSummary.materials === 0;
  const queueHeadline = queueSummary.action > 0
    ? `${queueSummary.action} action${queueSummary.action === 1 ? " needs" : "s need"} attention`
    : queueSummary.review > 0
      ? `${queueSummary.review} item${queueSummary.review === 1 ? "" : "s"} ready for review`
      : queueSummary.signals > 0
        ? `${queueSummary.signals} signal${queueSummary.signals === 1 ? "" : "s"} worth monitoring`
        : queueSummary.materials > 0
          ? `${queueSummary.materials} executive material${queueSummary.materials === 1 ? "" : "s"} ready to share`
        : "No outstanding actions right now";
  const queueStatusBadge = queueSummary.action > 0
    ? {
        label: queueSummary.action === 1 ? "Action waiting" : "Actions waiting",
        background: "rgba(220,38,38,0.18)",
        color: "rgba(254,242,242,0.96)",
        border: "rgba(248,113,113,0.28)",
      }
    : queueSummary.review > 0
      ? {
          label: queueSummary.review === 1 ? "Review ready" : "Reviews ready",
          background: "rgba(217,119,6,0.18)",
          color: "rgba(254,249,195,0.96)",
          border: "rgba(251,191,36,0.28)",
        }
      : queueSummary.signals > 0
        ? {
            label: queueSummary.signals === 1 ? "Signal waiting" : "Signals waiting",
            background: "rgba(37,99,235,0.16)",
            color: "rgba(219,234,254,0.96)",
            border: "rgba(96,165,250,0.24)",
          }
        : queueSummary.materials > 0
          ? {
              label: queueSummary.materials === 1 ? "Material ready" : "Materials ready",
              background: "rgba(99,102,241,0.16)",
              color: "rgba(224,231,255,0.96)",
              border: "rgba(129,140,248,0.24)",
            }
          : {
              label: "Queue clear",
              background: "rgba(22,163,74,0.14)",
              color: "rgba(220,252,231,0.95)",
              border: "rgba(74,222,128,0.22)",
            };
  const attentionNowAction = queueSummary.action > 0
    ? {
        label: queueSummary.action === 1 ? "Open urgent action" : "Focus urgent work",
        onClick: () => applyQueueFilter("action"),
      }
    : queueSummary.review > 0
      ? {
          label: queueSummary.review === 1 ? "Open review item" : "Review backlog",
          onClick: () => applyQueueFilter("review"),
        }
      : queueSummary.signals > 0
        ? {
            label: queueSummary.signals === 1 ? "Open signal" : "Review signals",
            onClick: () => applyQueueFilter("proposals"),
          }
        : queueSummary.materials > 0
          ? {
              label: queueSummary.materials === 1 ? "Open material" : "Review materials",
              onClick: () => applyQueueFilter("materials"),
            }
    : primaryQueueItem
      ? {
          label: "Open next action",
          onClick: openPrimaryQueueItem,
        }
      : {
          label: "Show everything",
          onClick: () => applyQueueFilter("all"),
        };
  const programOutlookAction = queueSummary.review > 0
    ? {
        label: queueSummary.review === 1 ? "Open review item" : "Review backlog",
        onClick: () => applyQueueFilter("review"),
      }
    : queueSummary.signals > 0
      ? {
          label: queueSummary.signals === 1 ? "Open signal" : "Review signals",
          onClick: () => applyQueueFilter("proposals"),
        }
      : queueSummary.materials > 0
        ? {
            label: queueSummary.materials === 1 ? "Open material" : "Review materials",
            onClick: () => applyQueueFilter("materials"),
          }
        : primaryQueueItem
          ? {
              label: "Open next action",
              onClick: openPrimaryQueueItem,
            }
          : {
              label: "Show everything",
              onClick: () => applyQueueFilter("all"),
            };
  const attentionNowCard = queueSummary.action > 0
    ? {
        title: "Attention now",
        value: `${queueSummary.action}`,
        summary: "Approvals, questions, and escalations",
      }
    : queueSummary.review > 0
      ? {
          title: "Ready for review",
          value: `${queueSummary.review}`,
          summary: "Drafts and review items ready now",
        }
      : queueSummary.signals > 0
        ? {
            title: "Signals to review",
            value: `${queueSummary.signals}`,
            summary: "Recommendations and lower-priority items",
          }
        : queueSummary.materials > 0
          ? {
              title: "Materials ready",
              value: `${queueSummary.materials}`,
              summary: "Briefings, packs, and agendas ready to share",
            }
          : {
              title: "Attention now",
              value: "Clear",
              summary: "No urgent actions are waiting",
            };
  const queueOutlookCard = queueSummary.review > 0
    ? {
        title: "Review backlog",
        value: `${queueSummary.review} waiting`,
        summary: "Drafts and review items are stacked behind urgent work.",
      }
    : queueSummary.signals > 0
      ? {
          title: "Signals waiting",
          value: `${queueSummary.signals} to assess`,
          summary: "Recommendations can be reviewed once immediate work is clear.",
        }
      : queueSummary.materials > 0
        ? {
            title: "Materials ready",
            value: `${queueSummary.materials} ready`,
            summary: "Executive outputs are available when leadership context is needed.",
          }
        : forecast?.atRiskPhaseCount > 0
          ? {
              title: "Downstream risk",
              value: `${forecast.atRiskPhaseCount} at risk`,
              summary: "The queue is clear, but delivery risk is building elsewhere in the plan.",
            }
          : Number.isFinite(forecast?.totalRemainingDays)
            ? {
                title: "Transformation stable",
                value: `${forecast.totalRemainingDays} days remaining`,
                summary: "No queue work is waiting right now.",
              }
            : {
                title: "Transformation stable",
                value: "On track",
                summary: "No queue work is waiting right now.",
              };
  const showMaterialsPanel = queueSummary.materials > 0 || materialsExpanded;

  const handleSelectQueueItem = (item: DecisionItem | null) => {
    if (!item) return;
    setSelectedItemId(item.id);
    onSelectItem(item.id);
  };

  const handlePersonaSelect = (id: string) => {
    onPersonaChange(id);
    setPersonaExpanded(false);
  };

  const getItemsForFilter = (nextFilterId: string) => {
    if (nextFilterId === "all") {
      return [
        ...groupedItems.action,
        ...groupedItems.review,
        ...groupedItems.proposals,
        ...groupedItems.materials,
      ];
    }
    return getFilteredItems(items, nextFilterId);
  };

  const applyQueueFilter = (nextFilterId: string) => {
    setFilterId(nextFilterId);
    const nextItems = getItemsForFilter(nextFilterId);
    const nextSelection = nextItems[0] || null;
    if (nextSelection) {
      setSelectedItemId(nextSelection.id);
      onSelectItem(nextSelection.id);
      return;
    }
    setSelectedItemId(null);
    onSelectItem("");
  };

  const openPrimaryQueueItem = () => {
    if (!primaryQueueItem) return;
    if (opensInDetailPane(primaryQueueItem)) {
      handleSelectQueueItem(primaryQueueItem);
      return;
    }
    openItemSource(primaryQueueItem, primaryQueueItem.phaseId);
  };

  const requestAiResponseForItem = (item: DecisionItem | null) => {
    if (!item) return;
    setAiDraftRequest({
      id: `${item.id}-${Date.now()}`,
      prompt: buildActionAiPrompt(item),
      sourceLabel: item.title,
      autoSubmit: true,
    });
  };

  const requestQueueOutlook = () => {
    setAiDraftRequest({
      id: `queue-outlook-${Date.now()}`,
      prompt: buildQueueOutlookPrompt({
        queueSummary,
        forecast,
        personaLabel: activePersonaLabel,
      }),
      sourceLabel: "Queue outlook",
      autoSubmit: true,
    });
  };

  const getAdjacentQueueItem = (itemId: string) => {
    const index = navigableItems.findIndex((item) => item.id === itemId);
    if (index < 0) return null;
    return navigableItems[index + 1] || navigableItems[index - 1] || null;
  };

  const advanceQueueSelection = (itemId: string) => {
    const adjacent = getAdjacentQueueItem(itemId);
    if (adjacent && adjacent.id !== itemId) {
      handleSelectQueueItem(adjacent);
      return;
    }
    setSelectedItemId(null);
  };

  const dismissAndAdvance = (itemId: string) => {
    advanceQueueSelection(itemId);
    onDismissItem(itemId);
  };

  const runActionAndAdvance = (itemId: string, action: string) => {
    advanceQueueSelection(itemId);
    if (onAction) {
      onAction(itemId, action);
      return;
    }
    onDismissItem(itemId);
  };

  const answerQuestionAndAdvance = (questionId: string, answers: string[], itemId: string) => {
    try {
      const result = onAnswerQuestion(questionId, answers);
      void Promise.resolve(result).then(() => {
        advanceQueueSelection(itemId);
      });
    } catch (error) {
      console.error("Failed to answer queue question", error);
    }
  };

  const markCommunicationSentAndAdvance = (communicationId: string, itemId: string) => {
    try {
      const result = onMarkCommunicationSent?.(communicationId);
      void Promise.resolve(result).then(() => {
        advanceQueueSelection(itemId);
      });
    } catch (error) {
      console.error("Failed to mark communication as sent", error);
    }
  };

  const acceptDraftAndAdvance = (phaseId: string, artifactId: string, itemId: string) => {
    advanceQueueSelection(itemId);
    onAcceptDraft(phaseId, artifactId);
  };

  const rejectDraftAndAdvance = (phaseId: string, artifactId: string, itemId: string) => {
    advanceQueueSelection(itemId);
    onRejectDraft(phaseId, artifactId);
  };

  const DetailHero = ({
    tone = "blue",
    eyebrow,
    title,
    summary,
    meta,
  }: {
    tone?: DetailTone;
    eyebrow: string;
    title: string;
    summary: string;
    meta?: string | null;
  }) => {
    const palette = DETAIL_TONES[tone];
    return (
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            borderRadius: 999,
            padding: "6px 10px",
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: palette.text,
            background: palette.background,
            border: `1px solid ${palette.border}`,
            marginBottom: 12,
          }}
        >
          {eyebrow}
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.gray900, marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.7, marginBottom: meta ? 8 : 0 }}>
          {summary}
        </div>
        {meta ? (
          <div style={{ fontSize: 11.5, color: COLORS.gray500, lineHeight: 1.6 }}>
            {meta}
          </div>
        ) : null}
      </div>
    );
  };

  const DetailSection = ({
    label,
    children,
    tone = "slate",
  }: {
    label: string;
    children: ReactNode;
    tone?: DetailTone;
  }) => {
    const palette = DETAIL_TONES[tone];
    return (
      <div
        style={{
          background: palette.background,
          border: `1px solid ${palette.border}`,
          borderRadius: 14,
          padding: "14px 15px",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: palette.text,
            marginBottom: 8,
          }}
        >
          {label}
        </div>
        {children}
      </div>
    );
  };

  const DetailMetricGrid = ({
    items: metricItems,
  }: {
    items: Array<{ label: string; value: string }>;
  }) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 16 }}>
      {metricItems.map((entry) => (
        <div key={entry.label} style={{ background: "#f8fafc", borderRadius: 10, padding: 10 }}>
          <div style={{ fontSize: 11, color: COLORS.gray500, marginBottom: 4 }}>{entry.label}</div>
          <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, fontWeight: 700, color: COLORS.gray900 }}>
            {entry.value}
          </div>
        </div>
      ))}
    </div>
  );

  const DetailActions = ({
    actions,
  }: {
    actions: Array<{ label: string; onClick: () => void; kind?: "primary" | "secondary" | "danger" }>;
  }) => {
    const primaryActions = actions.filter((action) => action.kind === "primary");
    const hasMultiplePrimaryActions = primaryActions.length > 1;
    const hasActionFirstPrimary = primaryActions.some((action) => !/^(open|view)\b/i.test(action.label));

    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {actions.map((action) => {
          const shouldDemoteContextAction = action.kind === "primary"
            && hasMultiplePrimaryActions
            && hasActionFirstPrimary
            && /^(open|view)\b/i.test(action.label);
          const kind = shouldDemoteContextAction ? "secondary" : (action.kind || "secondary");
        const isPrimary = kind === "primary";
        const isDanger = kind === "danger";
        return (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: isPrimary || isDanger ? "none" : `1px solid ${COLORS.gray200}`,
              background: isPrimary ? COLORS.gray900 : isDanger ? COLORS.red : COLORS.white,
              color: isPrimary ? COLORS.white : isDanger ? COLORS.white : COLORS.gray700,
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {action.label}
          </button>
        );
        })}
      </div>
    );
  };

  const renderDetail = () => {
    if (!selectedItem) {
      const canOpenPrimary = Boolean(primaryQueueItem);
      const isIdleQueue = !navigableItems.length;
      const isCalmEmptyState = isIdleQueue && !canOpenPrimary;
      const hasMaterials = queueSummary.materials > 0;
      const showEverything = filterId !== "all";
      const calmStateMetrics = [
        {
          label: "Immediate actions",
          value: "0",
          note: "Nothing is waiting for approval, review, or input.",
          tone: COLORS.green,
        },
        forecast?.atRiskPhaseCount > 0
          ? {
              label: "Program watch",
              value: `${forecast.atRiskPhaseCount} at risk`,
              note: "The queue is clear, but delivery risk is building outside the inbox.",
              tone: COLORS.amber,
            }
          : Number.isFinite(forecast?.totalRemainingDays)
            ? {
                label: "Program watch",
                value: `${forecast.totalRemainingDays} days`,
                note: "No queue work is waiting right now. ADAM is monitoring the remaining path.",
                tone: COLORS.blue,
              }
            : {
                label: "Program watch",
                value: "On track",
                note: "ADAM is monitoring milestones, blockers, and gate readiness in the background.",
                tone: COLORS.blue,
              },
      ];
      return (
        <div
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: COLORS.gray500,
            textAlign: "center",
            padding: 24,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: isCalmEmptyState ? 520 : 460,
              borderRadius: isCalmEmptyState ? 16 : 20,
              border: `1px solid ${COLORS.gray200}`,
              background: isCalmEmptyState ? "rgba(255,255,255,0.9)" : "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
              boxShadow: isCalmEmptyState ? "none" : "0 20px 50px rgba(15,23,42,0.08)",
              padding: isCalmEmptyState ? 18 : 24,
            }}
          >
            <div style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "6px 10px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: isCalmEmptyState ? COLORS.gray700 : "#1d4ed8", background: isCalmEmptyState ? "#f8fafc" : "#eff6ff", border: `1px solid ${isCalmEmptyState ? COLORS.gray200 : "#bfdbfe"}`, marginBottom: 12 }}>
              {isCalmEmptyState ? "Queue clear" : "Action queue"}
            </div>
            <div style={{ fontSize: isCalmEmptyState ? 18 : 22, fontWeight: 800, color: COLORS.gray900, marginBottom: 8 }}>
              {canOpenPrimary ? "Queue updated" : isIdleQueue ? "No actions waiting right now" : "No action selected"}
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.65, color: COLORS.gray700, marginBottom: isCalmEmptyState ? 12 : 16 }}>
              {canOpenPrimary
                ? `The next best item is ready when you are: ${primaryQueueItem?.title}.`
                : isIdleQueue
                  ? "ADAM is monitoring approvals, blockers, milestone drift, and plan actions in the background. The next human action will surface here automatically."
                  : "Approvals, inputs, escalations, and review work will surface here when ADAM needs your decision."}
            </div>
            {isCalmEmptyState ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                {calmStateMetrics.map((metric) => (
                  <div
                    key={metric.label}
                    style={{
                      textAlign: "left",
                      borderRadius: 14,
                      border: `1px solid ${COLORS.gray200}`,
                      background: "#f8fafc",
                      padding: "12px 12px 11px",
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 800, color: COLORS.gray500, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>
                      {metric.label}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: metric.tone, marginBottom: 4 }}>
                      {metric.value}
                    </div>
                    <div style={{ fontSize: 11, lineHeight: 1.5, color: COLORS.gray600 }}>
                      {metric.note}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: isCalmEmptyState ? 0 : 16 }}>
              {canOpenPrimary ? (
                <button
                  type="button"
                  onClick={() => {
                    if (primaryQueueItem) handleSelectQueueItem(primaryQueueItem);
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: "none",
                    background: COLORS.gray900,
                    color: COLORS.white,
                    fontSize: 11.5,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Open next action
                </button>
              ) : null}
              {isIdleQueue ? (
                <button
                  type="button"
                  onClick={() => onNavigate(forecast?.atRiskPhaseCount > 0 ? "raid" : "home")}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: `1px solid ${COLORS.gray200}`,
                    background: COLORS.white,
                    color: COLORS.gray700,
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {forecast?.atRiskPhaseCount > 0 ? "Open risks / blockers" : "Return to command center"}
                </button>
              ) : null}
              {isCalmEmptyState ? (
                <button
                  type="button"
                  onClick={requestQueueOutlook}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: `1px solid ${COLORS.gray200}`,
                    background: COLORS.white,
                    color: COLORS.gray700,
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Ask ADAM what it is watching
                </button>
              ) : null}
              {isCalmEmptyState ? (
                <button
                  type="button"
                  onClick={() => onNavigate("narrative")}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: `1px solid ${COLORS.gray200}`,
                    background: COLORS.white,
                    color: COLORS.gray700,
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Open plan
                </button>
              ) : null}
              {showEverything ? (
                <button
                  type="button"
                  onClick={() => applyQueueFilter("all")}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: `1px solid ${COLORS.gray200}`,
                    background: COLORS.white,
                    color: COLORS.gray700,
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Show everything
                </button>
              ) : null}
              {hasMaterials && filterId !== "materials" ? (
                <button
                  type="button"
                  onClick={() => applyQueueFilter("materials")}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: `1px solid ${COLORS.gray200}`,
                    background: COLORS.white,
                    color: COLORS.gray700,
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Review materials
                </button>
              ) : null}
            </div>
            {!isCalmEmptyState && (queueSummary.action > 0 || queueSummary.review > 0) ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11.5,
                  color: COLORS.gray600,
                }}
              >
                {queueSummary.action > 0 ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 10px",
                      borderRadius: 999,
                      border: `1px solid ${COLORS.gray200}`,
                      background: COLORS.white,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: COLORS.amber, flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, color: COLORS.gray800 }}>
                      {queueSummary.action} {queueSummary.action === 1 ? "item needs action" : "items need action"}
                    </span>
                  </span>
                ) : null}
                {queueSummary.review > 0 ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 10px",
                      borderRadius: 999,
                      border: `1px solid ${COLORS.gray200}`,
                      background: COLORS.white,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: "#2563eb", flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, color: COLORS.gray800 }}>
                      {queueSummary.review} {queueSummary.review === 1 ? "item is ready for review" : "items are ready for review"}
                    </span>
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    const phaseId = selectedItem.phaseId;
    const agentState = phaseAgents?.[phaseId]?.agentState ?? null;
    const reasoningTrace = findReasoningTrace(selectedItem, agentState);
    const artifact = selectedItem.artifactId
      ? projectData?.phaseArtifacts?.[phaseId]?.[selectedItem.artifactId] ?? null
      : null;
    const versions = selectedItem.artifactId
      ? projectData?.phaseArtifactVersions?.[phaseId]?.[selectedItem.artifactId] ?? []
      : [];
    const question = selectedItem.questionId
      ? (projectData?.pendingAgentQuestions ?? []).find((entry: AgentQuestion) => entry.id === selectedItem.questionId) ?? null
      : null;
    const exitProposal = projectData?.pendingExitProposals?.[phaseId] ?? null;
    const briefing = projectData?.phaseBriefings?.[phaseId] ?? null;
    const adrProposals = (projectData?.pendingADRProposals ?? [])
      .filter((proposal: any) => (proposal?.sourceArtifactPhase ?? "design") === phaseId && proposal?.autoGenerated && proposal?.status === "draft");
    const withTrace = (content) => (
      <div style={{ position: "relative", height: "100%" }}>
        {reasoningTrace ? (
          <button
            type="button"
            onClick={() => setShowTrace((value) => !value)}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              zIndex: 2,
              padding: "4px 10px",
              borderRadius: 6,
              border: `1px solid ${COLORS.gray200}`,
              fontSize: 11,
              cursor: "pointer",
              color: COLORS.gray500,
              background: COLORS.white,
            }}
          >
            Why this?
          </button>
        ) : null}
        <div style={{ paddingRight: showTrace && reasoningTrace ? 332 : 0, height: "100%", overflowY: "auto" }}>
          {content}
        </div>
        {showTrace && reasoningTrace ? (
          <ReasoningTracePanel trace={reasoningTrace} onClose={() => setShowTrace(false)} />
        ) : null}
      </div>
    );
    const withAgentHistory = (content) => (
      <>
        {content}
        <AgentHistoryPanel agentState={agentState} />
      </>
    );

    if (selectedItem.type === "escalation") {
      return withTrace(withAgentHistory(
        <div>
          <DetailHero
            tone="red"
            eyebrow="Human decision required"
            title={`${getDecisionPhaseLabel(phaseId)} has escalated for leadership input`}
            summary="The workspace agent cannot safely continue without a human call on the issue below."
          />
          <DetailSection label="What happened" tone="red">
            <FormattedDocument content={agentState?.escalationSummary || selectedItem.summary} compact />
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Workspace", onClick: () => openItemSource(selectedItem, phaseId), kind: "primary" },
              { label: "Reset Agent", onClick: () => onResetAgent(phaseId) },
            ]}
          />
        </div>,
      ));
    }

    if (selectedItem.type === "draft_review") {
      if (selectedItem.payload?.type === "compliance_patch") {
        const patch = selectedItem.payload as any;
        return withTrace(withAgentHistory(
          <div>
            <DetailHero
              tone="blue"
              eyebrow="Compliance controls"
              title={`${patch.frameworkLabel || patch.frameworkId} is ready for review`}
              summary="ADAM has prepared a compliance control patch so the workspace can close identified gaps without delaying downstream governance decisions."
              meta={`${getDecisionPhaseLabel(phaseId)} · ${(patch.gaps ?? []).length} gap(s) addressed`}
            />
            <DetailMetricGrid
              items={[
                { label: "Framework", value: String(patch.frameworkLabel || patch.frameworkId || "—") },
                { label: "Gaps addressed", value: `${(patch.gaps ?? []).length}` },
                { label: "Next step", value: "Review patch" },
                { label: "Workspace", value: getDecisionPhaseLabel(phaseId) },
              ]}
            />
            <DetailSection label="Why it matters" tone="blue">
              <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
                Resolving control gaps now reduces the chance of late-stage compliance rework and keeps approval-ready artifacts aligned with the governance posture.
              </div>
            </DetailSection>
            {(patch.gaps ?? []).length ? (
              <DetailSection label="Gaps addressed" tone="amber">
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(patch.gaps ?? []).slice(0, 6).map((gap: string) => (
                    <span key={gap} style={{ fontSize: 10.5, color: COLORS.amber, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 999, padding: "4px 8px" }}>
                      {gap}
                    </span>
                  ))}
                </div>
              </DetailSection>
            ) : null}
            <DetailSection label="Control patch" tone="slate">
              <div style={{ border: `1px solid ${COLORS.gray200}`, borderRadius: 14, background: COLORS.white, padding: 14 }}>
                <FormattedDocument content={patch.content || ""} compact />
              </div>
            </DetailSection>
            <DetailActions
              actions={[
                { label: "Open in Workspace", onClick: () => openItemSource(selectedItem, phaseId), kind: "primary" },
                { label: "Acknowledge", onClick: () => dismissAndAdvance(selectedItem.id) },
              ]}
            />
          </div>,
        ));
      }
      const preview = String(artifact?.content ?? "").trim().slice(0, 400);
      const assumedCount = (String(artifact?.content ?? "").match(/\[ASSUMED\]/g) || []).length;
      const draftTask = [...(agentState?.tasks ?? [])]
        .reverse()
        .find((entry) => entry.type === "draft_artifact" && entry.artifactId === selectedItem.artifactId);
      const draftConfidence = Math.round(((draftTask?.confidence ?? 0.55) * 100));
      return withTrace(withAgentHistory(
        <div style={{ position: "relative" }}>
          <DetailHero
            tone="blue"
            eyebrow="Draft ready for review"
            title={`${selectedItem.artifactId} is ready for approval`}
            summary="ADAM has prepared a new draft for this workspace. Review the evidence below, then approve, revise, or reject it."
            meta={`${getDecisionPhaseLabel(phaseId)} · Confidence ${draftConfidence}% · ${assumedCount} assumption flag${assumedCount === 1 ? "" : "s"}`}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            {versions.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowHistory((value) => !value)}
                style={{ marginLeft: "auto", padding: "5px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 11, cursor: "pointer", background: "white" }}
              >
                History ({versions.length})
              </button>
            ) : null}
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ height: 8, borderRadius: 999, background: COLORS.gray200, overflow: "hidden" }}>
              <div style={{ width: `${draftConfidence}%`, height: "100%", background: COLORS.blue }} />
            </div>
          </div>
          {selectedItem.payload?.qualityScore?.dimensions ? (
            <QualityRadar scores={selectedItem.payload.qualityScore.dimensions} />
          ) : null}
          <DetailSection label="Draft preview" tone="slate">
            <FormattedDocument content={preview || "No preview available."} compact />
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Workspace", onClick: () => openItemSource(selectedItem, phaseId), kind: "primary" },
              { label: "Accept Draft", onClick: () => selectedItem.artifactId && acceptDraftAndAdvance(phaseId, selectedItem.artifactId, selectedItem.id), kind: "primary" },
              { label: "Reject", onClick: () => selectedItem.artifactId && rejectDraftAndAdvance(phaseId, selectedItem.artifactId, selectedItem.id), kind: "danger" },
            ]}
          />
          {showHistory && versions.length > 0 && selectedItem.artifactId ? (
            <VersionHistoryPanel
              versions={versions}
              currentContent={projectData?.phaseArtifacts?.[phaseId]?.[selectedItem.artifactId]?.content ?? ""}
              onRollback={(version) => {
                onRollbackArtifact?.(phaseId, selectedItem.artifactId!, version);
                setShowHistory(false);
              }}
              onClose={() => setShowHistory(false)}
            />
          ) : null}
        </div>,
      ));
    }

    if (selectedItem.type === "question" && question) {
      return withTrace(withAgentHistory(
        <DecisionQuestionPanel
          question={question}
          onAnswer={(questionId, answers) => answerQuestionAndAdvance(questionId, answers, selectedItem.id)}
        />
      ));
    }

    if (selectedItem.type === "exit_proposal") {
      return withTrace(withAgentHistory(
        <div>
          <DetailHero
            tone="green"
            eyebrow="Ready for exit review"
            title={`${getDecisionPhaseLabel(phaseId)} can move to formal review`}
            summary={`Readiness is ${exitProposal?.readiness ?? 0}%. Exit criteria are currently passing and ADAM is recommending formal exit review.`}
          />
          <DetailSection label="Why it matters" tone="green">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              Moving promptly into exit review keeps momentum high and prevents already-complete workspaces from sitting idle.
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Initiate Exit Review", onClick: () => openItemSource(selectedItem, phaseId), kind: "primary" },
              { label: "Not Yet", onClick: () => dismissAndAdvance(selectedItem.id) },
            ]}
          />
        </div>,
      ));
    }

    if (selectedItem.type === "adr_proposal") {
      return withTrace(withAgentHistory(
        <div>
          <DetailHero
            tone="amber"
            eyebrow="Architecture review"
            title={`${adrProposals.length} architecture decision proposal${adrProposals.length === 1 ? "" : "s"} need confirmation`}
            summary={`ADAM has extracted decision candidates from ${getDecisionPhaseLabel(phaseId)} artifacts so they can be confirmed before architecture assumptions spread further downstream.`}
          />
          <DetailMetricGrid
            items={[
              { label: "Proposals", value: `${adrProposals.length}` },
              { label: "Workspace", value: getDecisionPhaseLabel(phaseId) },
              { label: "Next step", value: "Confirm ADRs" },
              { label: "Source", value: "Approved artifacts" },
            ]}
          />
          <DetailSection label="Why it matters" tone="amber">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              Confirming architecture decisions early prevents inconsistent technical direction from leaking across delivery, integration, and governance artifacts.
            </div>
          </DetailSection>
          <DetailSection label="Decisions to confirm" tone="slate">
            <div style={{ border: `1px solid ${COLORS.gray200}`, borderRadius: 14, background: COLORS.white, padding: 14 }}>
              {(adrProposals.slice(0, 6) || []).map((proposal: any, index: number) => (
                <div key={`${proposal?.id || proposal?.title || index}-${index}`} style={{ fontSize: 12, color: COLORS.gray700, lineHeight: 1.6, marginBottom: index === adrProposals.slice(0, 6).length - 1 ? 0 : 8 }}>
                  {proposal?.title || proposal?.decision || proposal?.summary || "Architecture decision"}
                </div>
              ))}
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Review ADRs", onClick: () => openItemSource(selectedItem, phaseId), kind: "primary" },
            ]}
          />
        </div>,
      ));
    }

    if (selectedItem.type === "revision_ready") {
      return withTrace(withAgentHistory(
        <div>
          <DetailHero
            tone="purple"
            eyebrow="Updated draft ready"
            title={`${selectedItem.artifactId} has been revised`}
            summary="ADAM has updated the draft based on your feedback. Review the revision before moving it back into approval."
          />
          {selectedItem.payload?.sourceField ? (
            <div style={{ fontSize: 11.5, color: COLORS.gray500, marginBottom: 14 }}>
              Triggered by change to <strong>{selectedItem.payload.sourceField}</strong> in {selectedItem.payload.sourcePhase}.
            </div>
          ) : null}
          <DetailActions
            actions={[
              { label: "Review Revision", onClick: () => openItemSource(selectedItem, phaseId), kind: "primary" },
            ]}
          />
        </div>,
      ));
    }

    if (selectedItem.type === "rebaseline") {
      const proposal = selectedItem.payload as { content: string; variances: any[]; generatedAt: string };
      return withTrace(withAgentHistory(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="amber"
            eyebrow="Re-baselining"
            title="Strategy assumptions need to be re-based"
            summary="Performance against the original baseline has drifted enough that ADAM is recommending a formal re-baselining discussion."
            meta={`Generated ${proposal?.generatedAt ? new Date(proposal.generatedAt).toLocaleString() : "recently"} · ${(proposal?.variances ?? []).length} KPI variance(s)`}
          />
          <DetailMetricGrid
            items={[
              { label: "KPI variances", value: `${(proposal?.variances ?? []).length}` },
              { label: "Recommended action", value: "Review baseline" },
            ]}
          />
          <DetailSection label="Why it matters" tone="amber">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              If the baseline no longer reflects reality, the program risks making delivery and investment decisions against assumptions that no longer hold.
            </div>
          </DetailSection>
          <DetailSection label="Variance summary" tone="amber">
            <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, padding: 12 }}>
            {(proposal?.variances ?? []).map((variance) => (
              <div key={variance.kpiId} style={{ fontSize: 13, marginBottom: 4 }}>
                <strong>{variance.kpiId}</strong>: target {variance.target} → actual {variance.actual}{" "}
                <span style={{ color: variance.variancePct < 0 ? COLORS.red : COLORS.green }}>
                  ({variance.variancePct > 0 ? "+" : ""}{variance.variancePct}%)
                </span>
              </div>
            ))}
          </div>
          </DetailSection>
          <DetailSection label="Re-baselining proposal" tone="slate">
            <FormattedDocument content={proposal?.content || ""} />
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Acknowledge", onClick: () => dismissAndAdvance(selectedItem.id), kind: "primary" },
            ]}
          />
        </div>,
      ));
    }

    if (selectedItem.type === "risk_mitigation") {
      const { mitigation, risks, fromMatrix, blockers, fromFragility } = selectedItem.payload as any;
      if (fromMatrix) {
        return withTrace(
          <div style={{ padding: 24 }}>
            <DetailHero
              tone="red"
              eyebrow="Critical risks"
              title="Escalate the highest-risk items now"
              summary="These risks sit in the highest-impact, highest-likelihood quadrant. They now need active leadership attention before they affect delivery or gate outcomes."
              meta={`${(risks || []).length} risk${(risks || []).length === 1 ? "" : "s"} flagged across the transformation.`}
            />
            <DetailSection label="Why it matters" tone="red">
              <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
                Leaving quadrant risks unmanaged creates a direct path to milestone slips, approval delays, and unplanned delivery escalation.
              </div>
            </DetailSection>
            {(risks || []).map((risk: any) => (
              <div key={risk.id || risk.riskId} style={{ border: "1px solid #fecaca", borderRadius: 8, padding: 14, marginBottom: 10, background: "#fef2f2" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#991b1b", marginBottom: 4 }}>{risk.title}</div>
                <div style={{ fontSize: 12, color: COLORS.gray700, lineHeight: 1.6, marginBottom: 6 }}>{risk.description}</div>
                <div style={{ fontSize: 11, color: COLORS.gray500 }}>
                  {risk.phaseId} · likelihood {risk.likelihood} · impact {risk.impact}
                </div>
              </div>
            ))}
            <DetailActions
              actions={[
                { label: "Open Risk Matrix", onClick: () => openItemSource(selectedItem, "riskmatrix"), kind: "primary" },
                { label: "Open RAID Log", onClick: () => openItemSource(selectedItem, "raid") },
              ]}
            />
          </div>,
        );
      }
      if (fromFragility) {
        return withTrace(
          <div style={{ padding: 24 }}>
            <DetailHero
              tone="amber"
              eyebrow="Critical path blockers"
              title="Unblock the highest-leverage artifacts first"
              summary="These missing artifacts carry the largest downstream dependency load. Finishing them first removes the most drag from the delivery path."
              meta={`${(blockers || []).length} blocker${(blockers || []).length === 1 ? "" : "s"} identified by the artifact graph.`}
            />
            <DetailSection label="Why it matters" tone="amber">
              <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
                Clearing these artifacts first reduces rework and prevents dependent workspaces from stalling behind incomplete evidence.
              </div>
            </DetailSection>
            {(blockers || []).map((blocker: any) => (
              <div key={`${blocker.phaseId}-${blocker.artifactId}`} style={{ border: "1px solid #fed7aa", borderRadius: 8, padding: 14, marginBottom: 10, background: "#fff7ed" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#9a3412", marginBottom: 4 }}>
                  {blocker.artifactId}
                </div>
                <div style={{ fontSize: 12, color: COLORS.gray700, lineHeight: 1.6 }}>
                  {blocker.phaseId} · blocks {blocker.downstream} downstream artifact(s)
                </div>
              </div>
            ))}
            <DetailActions
              actions={[
                { label: "Open Artifact Graph", onClick: () => openItemSource(selectedItem, "graph"), kind: "primary" },
                ...(blockers?.[0]?.phaseId
                  ? [{ label: `Open ${getDecisionPhaseLabel(blockers[0].phaseId)}`, onClick: () => openItemSource(selectedItem, blockers[0].phaseId) }]
                  : []),
              ]}
            />
          </div>,
        );
      }
      return withTrace(withAgentHistory(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="amber"
            eyebrow="Risk action"
            title="Prevent emerging risks before they compound"
            summary="ADAM has prepared a mitigation response for the upstream risks now gaining momentum. Reviewing it early is the fastest way to protect schedule and value."
            meta={`${(risks || []).length} upstream risk${(risks || []).length === 1 ? "" : "s"} · ${mitigation?.generatedAt ? new Date(mitigation.generatedAt).toLocaleString() : "Generated recently"}`}
          />
          <div style={{ marginBottom: 16 }}>
            {(risks || []).map((risk: any) => (
              <span
                key={risk.riskId}
                style={{
                  display: "inline-block",
                  marginRight: 6,
                  marginBottom: 6,
                  padding: "2px 8px",
                  borderRadius: 10,
                  fontSize: 11,
                  background: risk.severity === "high" ? "#fee2e2" : "#fef3c7",
                  color: risk.severity === "high" ? "#991b1b" : "#92400e",
                }}
              >
                {risk.riskId} · from {risk.sourcePhase}
              </span>
            ))}
          </div>
          <DetailSection label="Recommended mitigation" tone="slate">
            <FormattedDocument content={mitigation?.content || ""} />
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Acknowledge", onClick: () => dismissAndAdvance(selectedItem.id), kind: "primary" },
            ]}
          />
        </div>,
      ));
    }

    if (selectedItem.type === "gate_approval") {
      const workflow = selectedItem.payload as any;
      const requiredSignatories = workflow?.requiredSignatories ?? [];
      const approvals = workflow?.approvals ?? [];
      const rejections = workflow?.rejections ?? [];
      const pendingSignatories = requiredSignatories.filter((signatory: any) => (
        !approvals.some((entry: any) => entry.roleId === signatory.roleId) &&
        !rejections.some((entry: any) => entry.roleId === signatory.roleId)
      ));
      const respondedSignatories = requiredSignatories
        .map((signatory: any) => {
          const approval = approvals.find((entry: any) => entry.roleId === signatory.roleId);
          const rejection = rejections.find((entry: any) => entry.roleId === signatory.roleId);
          if (!approval && !rejection) return null;
          return { signatory, approval, rejection };
        })
        .filter(Boolean) as Array<{ signatory: any; approval?: any; rejection?: any }>;
      const approvalCount = approvals.length;
      const rejectionCount = rejections.length;
      const pendingCount = pendingSignatories.length;
      const overdueHours = Number(workflow?.overdueHours || 0);
      const isNotStarted = Boolean(workflow?.notStarted);
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="blue"
            eyebrow={isNotStarted ? "Gate review overdue" : "Approval required"}
            title={isNotStarted
              ? `${getDecisionPhaseLabel(workflow.phaseId)} is ready, but the gate review has not started`
              : `${getDecisionPhaseLabel(workflow.phaseId)} is waiting on sign-off`}
            summary={isNotStarted
              ? "The phase looks ready for review, but the formal gate workflow has not been opened yet. Start the gate review so signatories can respond."
              : "This workspace is ready for formal approval, but the gate cannot close until the required signatories respond."}
            meta={isNotStarted
              ? `${workflow?.proposedAt ? `Ready since ${new Date(workflow.proposedAt).toLocaleString()}` : "Ready recently"}${overdueHours ? ` · overdue by ${Math.max(1, Math.round(overdueHours / 24))}d` : ""}`
              : `Initiated ${workflow?.initiatedAt ? new Date(workflow.initiatedAt).toLocaleString() : "recently"} · ${pendingCount} pending · ${approvalCount} approved${rejectionCount ? ` · ${rejectionCount} rejected` : ""}${workflow?.isOverdue && overdueHours ? ` · overdue by ${Math.max(1, Math.round(overdueHours / 24))}d` : ""}`}
          />
          <DetailMetricGrid
            items={[
              { label: "Pending sign-off", value: `${pendingCount}` },
              { label: "Approvals received", value: `${approvalCount}` },
              { label: "Rejections recorded", value: `${rejectionCount}` },
              { label: "Signatories required", value: `${requiredSignatories.length}` },
            ]}
          />
          <DetailSection label="What to do now" tone="blue">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              {isNotStarted
                ? "Open the workspace, confirm the gate package is complete, and initiate the approval workflow so the right reviewers can respond."
                : pendingCount > 0
                ? `Review the ${pendingCount} outstanding signator${pendingCount === 1 ? "y" : "ies"} below and capture approvals or rejections so the gate decision can complete cleanly.`
                : "All required signatories have responded. Review the recorded responses below, then return to the workspace to close out the gate decision cleanly."}
            </div>
          </DetailSection>
          {pendingCount > 0 ? (
            <DetailSection label="Awaiting response" tone="amber">
              {pendingSignatories.map((signatory: any) => (
                <div key={signatory.roleId} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, marginBottom: 10, background: COLORS.white }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.gray900 }}>{signatory.roleName}</div>
                      <div style={{ fontSize: 11, color: COLORS.gray500, marginTop: 4 }}>
                        Still awaiting a decision for this gate.
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" onClick={() => onApproveGate?.(workflow.phaseId, signatory.roleId)} style={{ padding: "4px 12px", borderRadius: 6, background: "#16a34a", color: "white", border: "none", cursor: "pointer", fontSize: 12 }}>
                        Approve
                      </button>
                      <button type="button" onClick={() => onRejectGate?.(workflow.phaseId, signatory.roleId)} style={{ padding: "4px 12px", borderRadius: 6, background: "#dc2626", color: "white", border: "none", cursor: "pointer", fontSize: 12 }}>
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </DetailSection>
          ) : null}
          {respondedSignatories.length > 0 ? (
            <DetailSection label="Responses recorded" tone={pendingCount > 0 ? "slate" : "green"}>
              {respondedSignatories.map(({ signatory, approval, rejection }) => (
                <div key={signatory.roleId} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, marginBottom: 10, background: COLORS.white }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: approval || rejection ? 8 : 0 }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{signatory.roleName}</span>
                      {approval ? <span style={{ marginLeft: 8, fontSize: 11, color: "#16a34a", fontWeight: 600 }}>✓ Approved by {approval.approvedBy}</span> : null}
                      {rejection ? <span style={{ marginLeft: 8, fontSize: 11, color: "#dc2626", fontWeight: 600 }}>✗ Rejected by {rejection.rejectedBy}</span> : null}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: approval ? "#16a34a" : "#dc2626" }}>
                      {approval ? "Response recorded" : "Rejected"}
                    </span>
                  </div>
                  {approval?.note ? <p style={{ margin: 0, fontSize: 11, color: COLORS.gray500 }}>Note: {approval.note}</p> : null}
                  {rejection?.reason ? <p style={{ margin: 0, fontSize: 11, color: "#dc2626" }}>Reason: {rejection.reason}</p> : null}
                </div>
              ))}
            </DetailSection>
          ) : null}
          <DetailActions
            actions={[
              { label: "Open Workspace", onClick: () => openItemSource(selectedItem, workflow.phaseId) },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "capacity_alert") {
      const payload = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="amber"
            eyebrow="Capacity alert"
            title="Team capacity may not support the current delivery plan"
            summary={selectedItem.summary || payload?.body || "Current team capacity may be insufficient to hit the target gate dates for multiple phases."}
          />
          <DetailMetricGrid
            items={[
              { label: "Workspaces at risk", value: `${(payload?.atRiskPhases ?? []).length}` },
              { label: "Recommended action", value: "Rebalance" },
            ]}
          />
          <DetailSection label="Why it matters" tone="amber">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              If capacity remains tight, approvals, testing, and downstream gates will start to compress at the same time, reducing room to recover later.
            </div>
          </DetailSection>
          {(payload?.atRiskPhases ?? []).length ? (
            <DetailSection label="Workspaces under pressure" tone="red">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(payload?.atRiskPhases ?? []).map((phaseId: string) => (
                  <span key={phaseId} style={{ padding: "3px 8px", borderRadius: 999, background: "#fee2e2", color: "#991b1b", fontSize: 11, fontWeight: 600 }}>
                    {getDecisionPhaseLabel(phaseId)}
                  </span>
                ))}
              </div>
            </DetailSection>
          ) : null}
          <DetailActions
            actions={[
              { label: "Open Capacity Plan", onClick: () => openItemSource(selectedItem, "capacity"), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "uat_ready") {
      const payload = selectedItem.payload as any;
      const scenarios = payload?.scenarios || [];
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="blue"
            eyebrow="Test readiness"
            title="UAT scenarios are ready for review"
            summary={selectedItem.summary || payload?.body || "New UAT scenarios are ready for review."}
          />
          <DetailMetricGrid
            items={[
              { label: "Scenarios prepared", value: `${scenarios.length}` },
              { label: "Next step", value: "Review" },
            ]}
          />
          <DetailSection label="What to review" tone="blue">
            <div style={{ display: "grid", gap: 8 }}>
            {scenarios.map((scenario: any) => (
              <div key={scenario.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: COLORS.gray900, marginBottom: 2 }}>{scenario.feature}</div>
                <div style={{ color: COLORS.gray500, marginBottom: 4 }}>{scenario.role} · {scenario.priority} priority</div>
                <div style={{ color: COLORS.gray700, lineHeight: 1.5 }}>{scenario.expectedResult}</div>
              </div>
            ))}
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Test Plan", onClick: () => openItemSource(selectedItem, "testplan"), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "milestone_slip") {
      const payload = selectedItem.payload as any;
      const slip = payload?.slip || payload;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="red"
            eyebrow="Milestone slip"
            title={`Timeline is forecast to move by +${slip?.slipDays ?? "?"} days`}
            summary={selectedItem.summary || payload?.body || "A program milestone is forecast to slip beyond its current plan."}
          />
          <DetailSection label="Why it matters" tone="red">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              This shift can cascade into downstream approvals, benefit timing, and critical-path delivery commitments if it is not addressed now.
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "View Milestones", onClick: () => openItemSource(selectedItem, "milestones"), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "plan_action") {
      const payload = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="blue"
            eyebrow="Next action"
            title={selectedItem.title}
            summary={payload?.rationale || "This is one of the highest-value next actions in the current transformation plan."}
            meta={[
              payload?.owner ? `Owner: ${payload.owner}` : null,
              payload?.dueDate ? `Due ${new Date(payload.dueDate).toLocaleDateString()}` : null,
              payload?.source === "workplan" ? "From delivery workplan" : "From transformation plan",
            ].filter(Boolean).join(" · ")}
          />
          <DetailMetricGrid
            items={[
              { label: "Workspace", value: getDecisionPhaseLabel(selectedItem.phaseId) },
              { label: "Owner", value: payload?.owner || "Unassigned" },
              { label: "Timing", value: payload?.dueDate ? new Date(payload.dueDate).toLocaleDateString() : "No due date" },
            ]}
          />
          <DetailSection label="Why this matters now" tone="blue">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              {payload?.rationale || "Completing this action now keeps the delivery plan moving and prevents the next gate or milestone from drifting."}
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Workspace", onClick: () => openItemSource(selectedItem, selectedItem.phaseId), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "checklist_alert") {
      const payload = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone={payload?.blockerCount ? "red" : payload?.atRisk ? "amber" : "blue"}
            eyebrow="Checklist gap"
            title={`${getDecisionPhaseLabel(selectedItem.phaseId)} still has open checklist items`}
            summary="The workspace has started moving, but the gate package is still incomplete. Close these gaps before they turn into approval or milestone churn."
            meta={[
              payload?.targetGateDate ? `Target gate ${new Date(payload.targetGateDate).toLocaleDateString()}` : null,
              payload?.openGaps ? `${payload.openGaps} open gap${payload.openGaps === 1 ? "" : "s"}` : null,
            ].filter(Boolean).join(" · ")}
          />
          <DetailMetricGrid
            items={[
              { label: "Inputs captured", value: `${payload?.answeredFields ?? 0}/${payload?.totalFields ?? 0}` },
              { label: "Artifacts ready", value: `${payload?.draftedArtifacts ?? 0}/${payload?.totalArtifacts ?? 0}` },
              { label: "Blockers", value: `${payload?.blockerCount ?? 0}` },
              { label: "Exit checks", value: `${payload?.exitComplete ?? 0}/${payload?.exitTotal ?? 0}` },
            ]}
          />
          {payload?.blockers?.length ? (
            <DetailSection label="Current blockers" tone="red">
              <div style={{ display: "grid", gap: 8 }}>
                {payload.blockers.map((blocker: any) => (
                  <div key={blocker.id || blocker.title} style={{ border: "1px solid #fecaca", borderRadius: 8, padding: 10, background: "#fef2f2" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "#991b1b", marginBottom: 4 }}>{blocker.title || blocker.label || "Open blocker"}</div>
                    <div style={{ fontSize: 11.5, color: "#7f1d1d", lineHeight: 1.6 }}>
                      {blocker.description || blocker.impactSummary || blocker.mitigation || "Review the RAID log and close this blocker before the next gate checkpoint."}
                    </div>
                  </div>
                ))}
              </div>
            </DetailSection>
          ) : null}
          <DetailSection label="What to do now" tone={payload?.blockerCount ? "red" : "blue"}>
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              {payload?.blockerCount
                ? "Resolve the active blockers first, then complete the remaining checklist evidence in the workspace."
                : "Complete the remaining inputs and evidence in the workspace so the gate package can move forward without rework."}
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Workspace", onClick: () => openItemSource(selectedItem, selectedItem.phaseId), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "budget_alert") {
      const payload = selectedItem.payload as any;
      const ev = payload?.ev || {};
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone={payload?.severity === "critical" ? "red" : "amber"}
            eyebrow={`${String(payload?.severity || "warning").replace(/^\w/, (char: string) => char.toUpperCase())} budget alert`}
            title="Budget health needs intervention"
            summary={selectedItem.summary || payload?.body || "Budget health needs attention."}
          />
          <DetailMetricGrid
            items={[
              { label: "CPI", value: ev.cpi?.toFixed(2) ?? "—" },
              { label: "SPI", value: ev.spi?.toFixed(2) ?? "—" },
              { label: "EAC", value: ev.eac ? `$${Math.round(ev.eac).toLocaleString()}` : "—" },
              { label: "VAC", value: ev.vac != null ? `$${Math.round(ev.vac).toLocaleString()}` : "—" },
            ]}
          />
          <DetailSection label="Why it matters" tone={payload?.severity === "critical" ? "red" : "amber"}>
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              If cost and schedule performance continue to drift, the program will need reallocation, scope control, or revised value expectations.
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Budget Controls", onClick: () => openItemSource(selectedItem, "budget"), kind: "primary" },
              { label: "Acknowledge", onClick: () => dismissAndAdvance(selectedItem.id) },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "critical_path_alert") {
      const payload = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="red"
            eyebrow="Critical path at risk"
            title="Delivery dependencies need intervention"
            summary={selectedItem.summary || payload?.body || "Critical-path work is at risk and needs intervention."}
          />
          <DetailSection label="Why it matters" tone="red">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65, whiteSpace: "pre-line" }}>
              A critical-path delay affects more than one task. It can move gate dates, compress testing, and reduce room for recovery later.
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "View Critical Path", onClick: () => openItemSource(selectedItem, "criticalpath"), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "escalation_raised") {
      const payload = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="amber"
            eyebrow="Escalation"
            title="Leadership attention is needed"
            summary={selectedItem.summary || payload?.body || "An issue has been escalated for leadership attention."}
          />
          <DetailSection label="Why it matters" tone="amber">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              Escalated issues usually indicate a blocker that could not be resolved inside the workspace. Clearing it quickly protects momentum and prevents wider delivery drag.
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Escalations", onClick: () => openItemSource(selectedItem, "escalations"), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "resource_alert") {
      const payload = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="amber"
            eyebrow="Resource alert"
            title="Resource allocation needs intervention"
            summary={selectedItem.summary || payload?.body || "Resource allocation needs attention."}
          />
          <DetailSection label="Why it matters" tone="amber">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              Misaligned staffing slows delivery, weakens accountability, and makes recovery harder when work starts to bunch around the same milestones.
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Resource Matrix", onClick: () => openItemSource(selectedItem, "resources"), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "retro_ready") {
      const payload = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="green"
            eyebrow="Learning cycle"
            title="A retrospective is ready to run"
            summary={selectedItem.summary || payload?.body || "A retrospective is ready for this phase."}
          />
          <DetailMetricGrid
            items={[
              { label: "Questions prepared", value: `${payload?.questions?.length || 0}` },
              { label: "Next step", value: "Facilitate" },
            ]}
          />
          <DetailSection label="Why it matters" tone="green">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              Closing the loop on what worked and what did not helps the next workspace move faster with fewer repeated mistakes.
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Retrospective", onClick: () => openItemSource(selectedItem, "retro"), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "closure_ready") {
      const payload = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="green"
            eyebrow="Closure ready"
            title="The program closure pack is ready for sign-off"
            summary={selectedItem.summary || payload?.body || "The program closure report is ready for sign-off."}
          />
          <DetailSection label="Why it matters" tone="green">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              Formal closure captures outcomes, releases residual actions, and locks in the transformation record before the program fully hands off.
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Closure Report", onClick: () => openItemSource(selectedItem, "closure"), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "change_request") {
      const payload = selectedItem.payload as any;
      const impact = payload?.impact;
      const levels = impact?.dimensions
        ? Object.entries(impact.dimensions).map(([key, value]: any) => ({ key, level: value?.level }))
        : [];
      const levelColor = (level: string) => (
        level === "high" ? "#dc2626" : level === "medium" ? "#d97706" : "#16a34a"
      );
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="amber"
            eyebrow="Change request"
            title="Scope change needs a leadership decision"
            summary={selectedItem.summary || payload?.body || "A formal change request has been submitted for review."}
          />
          {levels.length ? (
            <DetailSection label="Impact across the program" tone="amber">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
              {levels.map(({ key, level }: any) => (
                <div key={key} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", fontSize: 11.5 }}>
                  <span style={{ textTransform: "capitalize", color: COLORS.gray500 }}>{key}</span>
                  <span style={{ marginLeft: 6, fontWeight: 700, color: levelColor(level) }}>{level}</span>
                </div>
              ))}
              </div>
            </DetailSection>
          ) : null}
          {impact?.recommendation ? (
            <DetailSection label="ADAM recommendation" tone="blue">
              <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
                <strong>{impact.recommendation}</strong> {impact.rationale ? `— ${impact.rationale}` : ""}
              </div>
            </DetailSection>
          ) : null}
          <DetailActions
            actions={[
              { label: "Open Change Register", onClick: () => openItemSource(selectedItem, "pcr"), kind: "primary" },
              { label: "Open Impact Assessment", onClick: () => openItemSource(selectedItem, "changeimpact") },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "stakeholder_alert") {
      const payload = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="amber"
            eyebrow="Stakeholder alert"
            title="A key stakeholder needs attention"
            summary={selectedItem.summary || payload?.body || "A high-influence stakeholder needs attention."}
          />
          <DetailSection label="Why it matters" tone="amber">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              Unmanaged stakeholder friction can slow approvals, weaken sponsorship, and amplify change resistance across the program.
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Stakeholder Register", onClick: () => openItemSource(selectedItem, "stakeholders"), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "benefit_alert") {
      const payload = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="red"
            eyebrow="Benefit at risk"
            title="Expected value is under pressure"
            summary={selectedItem.summary || payload?.body || "A tracked benefit is at risk and needs intervention."}
          />
          <DetailSection label="Why it matters" tone="red">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              If the benefit trajectory weakens now, the program may still deliver work while missing the case for value realization.
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Benefits Tracker", onClick: () => openItemSource(selectedItem, "benefits"), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "data_governance_gap") {
      const payload = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="amber"
            eyebrow="Data governance gap"
            title="Sensitive data lacks governance coverage"
            summary={selectedItem.summary || payload?.body || "Sensitive data entries are missing governance coverage."}
          />
          <DetailSection label="Why it matters" tone="amber">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65, whiteSpace: "pre-line" }}>
              Governance gaps create avoidable compliance and controls risk, especially when agent-generated outputs depend on the same data lineage.
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Data Dictionary", onClick: () => openItemSource(selectedItem, "datadict"), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "calendar_proposal") {
      const payload = selectedItem.payload as any;
      const events = payload?.events || [];
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="blue"
            eyebrow="Calendar proposal"
            title="Program events are ready to schedule"
            summary={selectedItem.summary || payload?.body || "The agent has proposed upcoming program events to schedule."}
          />
          <DetailMetricGrid
            items={[
              { label: "Events proposed", value: `${events.length}` },
              { label: "Next step", value: "Schedule" },
            ]}
          />
          <DetailSection label="What is ready to schedule" tone="blue">
            <div style={{ display: "grid", gap: 8 }}>
            {events.map((event: any) => (
              <div key={event.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: COLORS.gray900 }}>{event.title}</span>
                <span style={{ marginLeft: 8, color: COLORS.gray500 }}>{event.date}</span>
              </div>
            ))}
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Calendar", onClick: () => openItemSource(selectedItem, "calendar"), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "integration_conflict") {
      const payload = selectedItem.payload as any;
      const conflict = payload?.conflict || payload;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="amber"
            eyebrow="Integration conflict"
            title={`${conflict?.integrationName || "Integration"} references do not agree`}
            summary={selectedItem.summary || payload?.body || "Integration references conflict across approved artifacts."}
          />
          <DetailSection label="Why it matters" tone="amber">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              Conflicting integration assumptions create rework risk later in delivery, especially when approved artifacts no longer describe the same interface contract.
            </div>
          </DetailSection>
          <DetailSection label="Conflicting references" tone="slate">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Phase", "Artifact", "Protocol", "Direction"].map((header) => (
                    <th key={header} style={{ border: "1px solid #e5e7eb", padding: "6px 8px", textAlign: "left" }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(conflict?.conflicts || []).map((ref: any, index: number) => (
                  <tr key={`${ref?.artifactId || "ref"}-${index}`}>
                    <td style={{ border: "1px solid #e5e7eb", padding: "6px 8px" }}>{ref.phaseId}</td>
                    <td style={{ border: "1px solid #e5e7eb", padding: "6px 8px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{ref.artifactId}</td>
                    <td style={{ border: "1px solid #e5e7eb", padding: "6px 8px" }}>{ref.protocol || "—"}</td>
                    <td style={{ border: "1px solid #e5e7eb", padding: "6px 8px" }}>{ref.direction || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Mark Resolved", onClick: () => runActionAndAdvance(selectedItem.id, "resolve"), kind: "primary" },
              { label: "Dismiss", onClick: () => runActionAndAdvance(selectedItem.id, "dismiss") },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "agent_conflict") {
      const conflict = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="red"
            eyebrow="Agent conflict"
            title={`${getDecisionPhaseLabel(conflict.phaseA)} and ${getDecisionPhaseLabel(conflict.phaseB)} are in conflict`}
            summary={conflict.description}
          />
          <DetailSection label="Recommended resolution" tone="green">
            <div style={{ fontSize: 12.5, color: "#14532d", lineHeight: 1.65 }}>
              {conflict.resolution}
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: `Open ${getDecisionPhaseLabel(conflict.phaseA)}`, onClick: () => openItemSource(selectedItem, conflict.phaseA), kind: "primary" },
              { label: `Open ${getDecisionPhaseLabel(conflict.phaseB)}`, onClick: () => openItemSource(selectedItem, conflict.phaseB) },
              { label: "Dismiss", onClick: () => dismissAndAdvance(selectedItem.id) },
            ]}
          />
        </div>
      );
    }

    if (selectedItem.type === "handoff_ready") {
      const handoff = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="green"
            eyebrow="Handoff ready"
            title={`${getDecisionPhaseLabel(handoff.fromPhase)} is ready to hand off to ${getDecisionPhaseLabel(handoff.toPhase)}`}
            summary="ADAM has consolidated the outputs, open risks, and approved artifacts needed for the next workspace to pick up cleanly."
            meta={`${handoff?.generatedAt ? new Date(handoff.generatedAt).toLocaleString() : "Generated recently"} · ${handoff.approvedArtifactCount} artifact(s) · ${handoff.openRiskCount} open risk(s)`}
          />
          <DetailMetricGrid
            items={[
              { label: "Approved artifacts", value: `${handoff.approvedArtifactCount ?? 0}` },
              { label: "Open risks", value: `${handoff.openRiskCount ?? 0}` },
            ]}
          />
          <DetailSection label="Handoff brief" tone="green">
            <FormattedDocument content={handoff.content} />
          </DetailSection>
          <DetailActions
            actions={[
              { label: `Open ${getDecisionPhaseLabel(handoff.toPhase)}`, onClick: () => openItemSource(selectedItem, handoff.toPhase), kind: "primary" },
              {
                label: "Export .md",
                onClick: () => {
                  const blob = new Blob([handoff.content], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = `handoff-${handoff.fromPhase}-to-${handoff.toPhase}.md`;
                  anchor.click();
                  URL.revokeObjectURL(url);
                },
              },
              { label: "Dismiss", onClick: () => dismissAndAdvance(selectedItem.id) },
            ]}
          />
        </div>
      );
    }

    if (selectedItem.type === "briefing_ready" && selectedItem.payload?.isLessonsLearned) {
      const lessons = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="green"
            eyebrow="Lessons learned"
            title="Reusable learning has been captured"
            summary="ADAM has consolidated the most important delivery and transformation lessons from this program into a reusable reference."
            meta={`${lessons.programName} · ${new Date(lessons.generatedAt).toLocaleString()}`}
          />
          <DetailSection label="Why it matters" tone="green">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              Reusing proven lessons improves decision quality for future programs and shortens the time needed to reach confident delivery patterns.
            </div>
          </DetailSection>
          <DetailSection label="Captured learning" tone="slate">
            <FormattedDocument content={lessons.content} />
          </DetailSection>
          <DetailActions
            actions={[
              {
                label: "Export .md",
                onClick: () => {
                  const blob = new Blob([lessons.content], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = "lessons-learned.md";
                  anchor.click();
                  URL.revokeObjectURL(url);
                },
                kind: "primary",
              },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "briefing_ready" && briefing?.content) {
      return withTrace(withAgentHistory(
        <div style={{ padding: "16px 18px" }}>
          <DetailHero
            tone="blue"
            eyebrow="Executive briefing"
            title={`${getDecisionPhaseLabel(selectedItem.phaseId)} is ready for review`}
            summary="This briefing consolidates readiness, risks, and the current recommendation so you can make the next gate or steering decision quickly."
          />
          <DetailMetricGrid
            items={[
              { label: "Workspace", value: getDecisionPhaseLabel(selectedItem.phaseId) },
              { label: "Status", value: briefing?.stale ? "Needs refresh" : "Current" },
              { label: "Next step", value: "Review or export" },
              { label: "Source", value: "Phase artifacts" },
            ]}
          />
          <DetailSection label="Why it matters" tone="blue">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              A concise, current briefing makes it easier for sponsors and leaders to make the next decision without reopening every underlying artifact.
            </div>
          </DetailSection>
          {briefing?.stale ? (
            <DetailSection label="Refresh recommended" tone="amber">
              <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
                This briefing may be outdated. Phase artifacts have changed since it was generated.
              </div>
            </DetailSection>
          ) : null}
          <DetailSection label="Briefing" tone="slate">
            <FormattedDocument content={briefing.content} />
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open Source Workspace", onClick: () => openItemSource(selectedItem, selectedItem.phaseId), kind: "primary" },
              { label: "Refresh Briefing", onClick: () => onRegenerateBriefing(selectedItem.phaseId) },
              { label: "Export Briefing", onClick: () => onExportBriefing(selectedItem.phaseId) },
            ]}
          />
        </div>,
      ));
    }

    if (selectedItem.type === "hypothesis_alert") {
      const hypotheses = selectedItem.payload as any[];
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="red"
            eyebrow="Hypothesis alert"
            title="Core strategy assumptions have been invalidated"
            summary="Later-phase evidence now contradicts one or more of the assumptions supporting the current transformation strategy."
          />
          <DetailMetricGrid
            items={[
              { label: "Hypotheses affected", value: `${hypotheses.length}` },
              { label: "Next step", value: "Revisit strategy" },
            ]}
          />
          <DetailSection label="Why it matters" tone="red">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              If invalid assumptions remain in place, the program can continue to execute while steering toward the wrong value case or operating model.
            </div>
          </DetailSection>
          <DetailSection label="Contradicted assumptions" tone="red">
            {hypotheses.map((hypothesis: any) => (
              <div key={hypothesis.id} style={{ border: "1px solid #fecaca", borderRadius: 8, padding: 14, marginBottom: 12, background: "#fef2f2" }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#991b1b" }}>
                  ✗ {hypothesis.statement}
                </div>
                <div style={{ fontSize: 11, color: COLORS.gray500, marginBottom: 6 }}>
                  Source: {getDecisionPhaseLabel(hypothesis.sourcePhase)} · Type: {hypothesis.type}
                </div>
                {hypothesis.evidence?.length ? (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", marginBottom: 4 }}>Evidence</div>
                    {hypothesis.evidence.map((evidence: any, index: number) => (
                      <div key={`${hypothesis.id}-${index}`} style={{ fontSize: 12, color: "#374151", marginBottom: 2 }}>
                        [{getDecisionPhaseLabel(evidence.phaseId)}] {evidence.summary}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Acknowledge", onClick: () => dismissAndAdvance(selectedItem.id), kind: "primary" },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "steering_pack") {
      const pack = selectedItem.payload as {
        content: string;
        generatedAt: string;
        coveringPhases: string[];
        openEscalations: number;
        pendingExits: number;
      };
      const coveredWorkspaces = (pack?.coveringPhases || []).map((phaseId) => getDecisionPhaseLabel(phaseId));
      const leadershipActions = (pack?.openEscalations ?? 0) + (pack?.pendingExits ?? 0);
      const steeringMetrics = [
        { label: "Workspaces covered", value: `${coveredWorkspaces.length}` },
        { label: "Leadership actions", value: leadershipActions ? `${leadershipActions} flagged` : "None flagged" },
        { label: "Next step", value: "Review or export" },
        { label: "Pack posture", value: coveredWorkspaces.length > 0 ? "Program snapshot" : "Board-level summary" },
      ];
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="blue"
            eyebrow="Steering pack"
            title="Executive steering materials are ready"
            summary="This pack consolidates the latest transformation signals so leadership can review status, value, and required decisions in one place."
            meta={`${pack?.generatedAt ? new Date(pack.generatedAt).toLocaleString() : "Generated recently"} · ${(pack?.coveringPhases ?? []).length} workspaces`}
          />
          <DetailMetricGrid items={steeringMetrics} />
          <DetailSection label="Why it matters" tone="blue">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              A current steering pack reduces meeting prep, keeps leadership focused on the real tradeoffs, and creates a shared decision baseline across the program.
            </div>
          </DetailSection>
          <DetailSection label="Coverage" tone="slate">
            {coveredWorkspaces.length ? (
              <>
                <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65, marginBottom: 10 }}>
                  This pack currently brings together the latest signals from the workspaces below.
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {coveredWorkspaces.map((workspace) => (
                    <span
                      key={workspace}
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: COLORS.gray700,
                        background: "#f8fafc",
                        border: `1px solid ${COLORS.gray200}`,
                        borderRadius: 999,
                        padding: "6px 10px",
                      }}
                    >
                      {workspace}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
                This pack is framed as a program-wide leadership summary rather than a workspace-specific packet.
              </div>
            )}
          </DetailSection>
          <DetailSection label="Pack content" tone="slate">
            <FormattedDocument content={pack?.content || ""} />
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Refresh Pack", onClick: () => onGenerateSteeringPack() },
              {
                label: "Export Pack",
                onClick: () => {
                  const blob = new Blob([pack?.content || ""], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = `steering-pack-${new Date().toISOString().slice(0, 10)}.md`;
                  anchor.click();
                  URL.revokeObjectURL(url);
                },
                kind: "primary",
              },
            ]}
          />
        </div>
      );
    }

    if (selectedItem.type === "meeting_agenda") {
      const agenda = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="blue"
            eyebrow="Meeting agenda"
            title="Checkpoint agenda is ready to run"
            summary="ADAM has prepared the agenda, timing, and discussion flow for the next checkpoint so the session can stay focused on status, decisions, and follow-through."
            meta={`~${agenda?.estimatedMinutes} min · ${agenda?.itemCount} item(s) · ${agenda?.generatedAt ? new Date(agenda.generatedAt).toLocaleString() : "Generated recently"}`}
          />
          <DetailMetricGrid
            items={[
              { label: "Estimated time", value: `~${agenda?.estimatedMinutes ?? 0} min` },
              { label: "Agenda items", value: `${agenda?.itemCount ?? 0}` },
              { label: "Next step", value: "Run or export" },
              { label: "Source", value: "Current program state" },
            ]}
          />
          <DetailSection label="Why it matters" tone="blue">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              A focused agenda keeps checkpoint conversations on decisions, ownership, and follow-through instead of status drift or side discussions.
            </div>
          </DetailSection>
          <DetailSection label="Agenda" tone="slate">
            <FormattedDocument content={agenda?.content || ""} />
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Refresh Agenda", onClick: () => onGenerateMeetingAgenda?.() },
              {
                label: "Export Agenda",
                onClick: () => {
                  const blob = new Blob([agenda?.content || ""], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const el = document.createElement("a");
                  el.href = url;
                  el.download = `agenda-${new Date().toISOString().slice(0, 10)}.md`;
                  el.click();
                  URL.revokeObjectURL(url);
                },
                kind: "primary",
              },
              { label: "Dismiss", onClick: () => dismissAndAdvance(selectedItem.id) },
            ]}
          />
        </div>,
      );
    }

    if (selectedItem.type === "communication_ready") {
      const communication = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="blue"
            eyebrow="Draft communication"
            title="A stakeholder-ready message is prepared"
            summary={`Prepared for ${communication.audienceLabel}. Review the message below, then send or refine it before distribution.`}
            meta={`${String(communication.eventType || "").replace(/_/g, " ")} · ${communication.generatedAt ? new Date(communication.generatedAt).toLocaleString() : "Generated recently"}`}
          />
          <DetailSection label="Audience options" tone="blue">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-start" }}>
              {Object.entries(COMMUNICATION_AUDIENCES).map(([audienceId, audience]) => (
                <button
                  key={audienceId}
                  type="button"
                  onClick={() => onRegenerateCommunication?.(communication.id, audienceId)}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 6,
                    border: "1px solid",
                    borderColor: communication.audienceId === audienceId ? COLORS.blue : COLORS.gray200,
                    background: communication.audienceId === audienceId ? "#eff6ff" : COLORS.white,
                    fontSize: 10,
                    cursor: "pointer",
                    color: communication.audienceId === audienceId ? COLORS.blue : COLORS.gray500,
                  }}
                >
                  {audience.label}
                </button>
              ))}
            </div>
          </DetailSection>
          <DetailSection label="Draft message" tone="slate">
            <div style={{ background: "#f9fafb", border: `1px solid ${COLORS.gray200}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "#374151" }}>
              Subject: {communication.subject}
            </div>
            <FormattedDocument content={communication.body} />
          </div>
          </DetailSection>
          <DetailActions
            actions={[
              {
                label: "Copy to Clipboard",
                onClick: () => {
                  navigator.clipboard?.writeText(`Subject: ${communication.subject}\n\n${communication.body}`);
                },
                kind: "primary",
              },
              { label: "Mark as Sent", onClick: () => markCommunicationSentAndAdvance(communication.id, selectedItem.id) },
              { label: "Dismiss", onClick: () => dismissAndAdvance(selectedItem.id) },
            ]}
          />
        </div>
      );
    }

    if (selectedItem.type === "scope_change") {
      const change = selectedItem.payload as any;
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone={change.severity === "high" ? "red" : "amber"}
            eyebrow="Scope change"
            title={`${getDecisionPhaseLabel(change.phaseId)} needs a change decision`}
            summary={`A proposed change to ${change.fieldId} could alter downstream assumptions, artifacts, or delivery commitments.`}
            meta={`${String(change.severity || "medium").replace(/^\w/, (char: string) => char.toUpperCase())} severity`}
          />
          <DetailMetricGrid
            items={[
              { label: "Workspace", value: getDecisionPhaseLabel(change.phaseId) },
              { label: "Field", value: String(change.fieldId || "—") },
              { label: "Impacted artifacts", value: `${change.impactedArtifacts?.length || 0}` },
              { label: "Next step", value: "Approve or revert" },
            ]}
          />
          <DetailSection label="What is changing" tone="blue">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", marginBottom: 4 }}>Baseline</div>
                <div style={{ fontSize: 12, color: COLORS.gray500, background: "#f9fafb", padding: 10, borderRadius: 6, lineHeight: 1.6 }}>{change.baselineValue}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: COLORS.blue, textTransform: "uppercase", marginBottom: 4 }}>Proposed</div>
                <div style={{ fontSize: 12, color: "#374151", background: "#eff6ff", padding: 10, borderRadius: 6, lineHeight: 1.6 }}>{change.newValue}</div>
              </div>
            </div>
          </DetailSection>
          <DetailSection label="Why it matters" tone={change.severity === "high" ? "red" : "amber"}>
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              {change.impactSummary}
            </div>
          </DetailSection>
          {change.impactedArtifacts?.length ? (
            <DetailSection label="Artifacts that will need review" tone="amber">
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {change.impactedArtifacts.map((artifact: any) => (
                  <span key={`${artifact.phase}-${artifact.artifactId}`} style={{ padding: "2px 8px", borderRadius: 4, background: "#fee2e2", color: "#991b1b", fontSize: 11 }}>
                    {getDecisionPhaseLabel(artifact.phase)} / {artifact.artifactId}
                  </span>
                ))}
              </div>
            </DetailSection>
          ) : null}
          <DetailActions
            actions={[
              {
                label: "Approve Change",
                onClick: () => {
                  onUpdateScopeChange?.(change.id, "approved");
                  dismissAndAdvance(selectedItem.id);
                },
                kind: "primary",
              },
              {
                label: "Reject and Revert",
                onClick: () => {
                  onUpdateScopeChange?.(change.id, "rejected");
                  dismissAndAdvance(selectedItem.id);
                },
                kind: "danger",
              },
            ]}
          />
        </div>
      );
    }

    if (selectedItem.type === "raid_alert") {
      const blockers = Array.isArray(selectedItem.payload?.blockers) ? selectedItem.payload.blockers : [];
      return withTrace(
        <div style={{ padding: 24 }}>
          <DetailHero
            tone="red"
            eyebrow="RAID alert"
            title={blockers.length ? "Open blockers need intervention" : "High-severity RAID items need attention"}
            summary={blockers.length
              ? `There ${blockers.length === 1 ? "is" : "are"} ${blockers.length} active blocker${blockers.length === 1 ? "" : "s"} in this slice of the RAID log. Review them before they compound into delivery, cost, or gate issues.`
              : `The RAID log now contains ${selectedItem.payload?.count ?? 0} unresolved high-severity entries. Review them before they compound into delivery, cost, or gate issues.`}
          />
          {blockers.length ? (
            <DetailSection label="What is open right now" tone="red">
              <div style={{ display: "grid", gap: 8 }}>
                {blockers.map((entry: any) => (
                  <div key={entry.id || entry.title} style={{ border: "1px solid #fecaca", borderRadius: 8, padding: 10, background: COLORS.white }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.gray900 }}>{entry.title || entry.label || "Open RAID item"}</div>
                    <div style={{ fontSize: 11.5, color: COLORS.gray500, marginTop: 4 }}>
                      {getDecisionPhaseLabel(entry.phaseId || entry.phase)} · {String(entry.severity || "medium").replace(/^\w/, (char) => char.toUpperCase())}
                    </div>
                    {(entry.description || entry.impactSummary || entry.mitigation) ? (
                      <div style={{ fontSize: 11.5, color: COLORS.gray700, lineHeight: 1.6, marginTop: 6 }}>
                        {entry.description || entry.impactSummary || entry.mitigation}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </DetailSection>
          ) : null}
          <DetailSection label="Why it matters" tone="red">
            <div style={{ fontSize: 12.5, color: COLORS.gray700, lineHeight: 1.65 }}>
              RAID items are manageable individually, but when they remain unresolved they tend to cascade across milestones, dependencies, and executive confidence.
            </div>
          </DetailSection>
          <DetailActions
            actions={[
              { label: "Open RAID Log", onClick: () => openItemSource(selectedItem, "raid"), kind: "primary" },
            ]}
          />
        </div>
      );
    }

    return null;
  };

  const renderQueueCard = (item: DecisionItem) => {
    const isSelected = item.id === selectedItemId;
    const sectionId = getSectionIdForItem(item);
    const priorityLabel = item.priority === "critical"
      ? "Critical priority"
      : item.priority === "high"
        ? "High priority"
        : item.priority === "medium"
          ? "Medium priority"
          : "Monitor";
    const showPriorityBadge = item.priority === "critical" || item.priority === "high";
    return (
      <div
        key={item.id}
        onClick={() => handleSelectQueueItem(item)}
        style={{
          width: "100%",
          textAlign: "left",
          border: isSelected ? `1px solid ${COLORS.blue}` : "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          background: isSelected ? COLORS.cardSelected : COLORS.card,
          padding: 0,
          cursor: "pointer",
          overflow: "hidden",
          boxShadow: isSelected ? "0 16px 28px rgba(37,99,235,0.18)" : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "stretch" }}>
          <div style={{ width: 4, background: getPriorityColor(item.priority), flexShrink: 0 }} />
          <div style={{ flex: 1, padding: "12px 12px 11px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: isSelected ? COLORS.gray700 : "rgba(255,255,255,0.72)" }}>
                  {getDecisionPhaseLabel(item.phaseId)}
                </span>
                <span style={{ fontSize: 12, color: getPriorityColor(item.priority) }}>
                  {TYPE_ICONS[item.type] || "•"}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: isSelected ? COLORS.gray500 : "rgba(255,255,255,0.62)",
                    border: `1px solid ${isSelected ? COLORS.gray200 : "rgba(255,255,255,0.12)"}`,
                    borderRadius: 999,
                    padding: "2px 6px",
                    background: isSelected ? COLORS.white : "rgba(255,255,255,0.04)",
                  }}
                >
                  {getDecisionTypeLabel(item)}
                </span>
              </div>
              <span style={{ fontSize: 10.5, color: isSelected ? COLORS.gray500 : "rgba(255,255,255,0.48)" }}>
                {getTimeAgo(item.createdAt)}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? COLORS.gray900 : COLORS.white, marginBottom: 4 }}>
              {item.title}
            </div>
            <div style={{ fontSize: 11.5, color: isSelected ? COLORS.gray500 : "rgba(255,255,255,0.62)", overflow: "hidden", marginBottom: 10, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", lineHeight: 1.5 }}>
              {item.summary}
            </div>
            {showPriorityBadge ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    borderRadius: 999,
                    padding: "3px 8px",
                    border: isSelected ? `1px solid ${COLORS.gray200}` : "1px solid rgba(255,255,255,0.10)",
                    background: isSelected ? COLORS.white : "rgba(255,255,255,0.03)",
                    color: isSelected ? COLORS.gray500 : "rgba(255,255,255,0.58)",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {priorityLabel}
                </span>
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (opensInDetailPane(item)) {
                    handleSelectQueueItem(item);
                    return;
                  }
                  openItemSource(item, item.phaseId);
                }}
                style={{
                  border: "none",
                  borderRadius: 999,
                  background: isSelected ? COLORS.gray900 : "rgba(255,255,255,0.09)",
                  color: COLORS.white,
                  fontSize: 10.5,
                  fontWeight: 800,
                  padding: "6px 9px",
                  cursor: "pointer",
                }}
              >
                {getDecisionActionLabel(item)}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleSelectQueueItem(item);
                  requestAiResponseForItem(item);
                }}
                disabled={qaLoading}
                style={{
                  border: isSelected ? `1px solid ${COLORS.gray200}` : "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 999,
                  background: isSelected ? COLORS.white : "transparent",
                  color: isSelected ? COLORS.gray500 : "rgba(255,255,255,0.78)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: "6px 9px",
                  cursor: qaLoading ? "wait" : "pointer",
                  opacity: qaLoading ? 0.6 : 1,
                }}
              >
                {qaLoading ? "ADAM…" : "AI draft"}
              </button>
              {item.dismissable ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    dismissAndAdvance(item.id);
                  }}
                  style={{
                    border: isSelected ? `1px solid ${COLORS.gray200}` : "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 999,
                    background: isSelected ? COLORS.white : "transparent",
                    color: isSelected ? COLORS.gray500 : "rgba(255,255,255,0.68)",
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: "6px 9px",
                    cursor: "pointer",
                  }}
                >
                  Dismiss
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  };
  const queueIsIdle = !selectedItem && !navigableItems.length;

  const renderQueueSection = (sectionId: "action" | "review" | "proposals" | "materials", sectionItems: DecisionItem[]) => {
    const labels = {
      action: {
        title: "Needs action",
        detail: "Approvals, inputs, and escalations that block progress until someone responds.",
        color: "rgba(254,242,242,0.96)",
      },
      review: {
        title: "Ready for review",
        detail: "Drafts and materials that are ready to assess but are not blocking execution yet.",
        color: "rgba(254,249,195,0.96)",
      },
      proposals: {
        title: "Signals",
        detail: "Background recommendations and lower-priority signals to review when timing allows.",
        color: "rgba(219,234,254,0.96)",
      },
      materials: {
        title: "Materials",
        detail: "Generated briefings, packs, and agendas that support leadership conversations without interrupting the action flow.",
        color: "rgba(191,219,254,0.96)",
      },
    } as const;
    const label = labels[sectionId];
    const expanded = sectionExpanded[sectionId];
    const previewItem = sectionItems[0] || null;
    const criticalCount = sectionItems.filter((item) => item.priority === "critical").length;
    const previewText = previewItem
      ? `${getDecisionActionLabel(previewItem)} · ${previewItem.title}`
      : label.detail;
    const previewMeta = previewItem
      ? `${getDecisionPhaseLabel(previewItem.phaseId)} · ${getDecisionTypeLabel(previewItem)} · ${getTimeAgo(previewItem.createdAt)}`
      : null;
    const sectionSummary = sectionId === "action"
      ? criticalCount > 0
        ? `${criticalCount} critical · ${sectionItems.length} total`
        : `${sectionItems.length} total`
      : sectionId === "review"
        ? `${sectionItems.length} awaiting assessment`
        : sectionId === "proposals"
          ? `${sectionItems.length} signal${sectionItems.length === 1 ? "" : "s"} in backlog`
          : `${sectionItems.length} material${sectionItems.length === 1 ? "" : "s"} available`;
    return (
      <div key={sectionId} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button
          type="button"
          onClick={() => setSectionExpanded((current) => ({ ...current, [sectionId]: !current[sectionId] }))}
          style={{
            padding: "2px 2px 0",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: label.color, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {label.title}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.54)" }}>
                {sectionItems.length}
              </div>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
                {expanded ? "▲" : "▼"}
              </span>
            </div>
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.5, color: expanded ? "rgba(255,255,255,0.54)" : "rgba(255,255,255,0.68)" }}>
            {expanded ? label.detail : previewText}
          </div>
          {expanded ? (
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.46)", marginTop: 4 }}>
              {sectionSummary}
            </div>
          ) : previewMeta ? (
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.46)", marginTop: 4 }}>
              {previewMeta}
            </div>
          ) : null}
          {!expanded && sectionItems.length > 1 ? (
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.46)", marginTop: 4 }}>
              {sectionItems.length - 1} more item{sectionItems.length - 1 === 1 ? "" : "s"} in this section
            </div>
          ) : null}
        </button>
        {expanded ? sectionItems.map(renderQueueCard) : null}
      </div>
    );
  };

  return (
    <div>
      <ProgramAskBar
        onAsk={onAskQuestion}
        onSearchNavigate={onSearchNavigate}
        loading={qaLoading}
        history={programQA}
        draftRequest={aiDraftRequest}
        onDraftHandled={() => setAiDraftRequest(null)}
      />
      <div style={{ display: "flex", gap: 20, minHeight: "calc(100vh - 180px)" }}>
      <div
        style={{
          width: 340,
          flexShrink: 0,
          borderRadius: 20,
          background: COLORS.panel,
          border: "1px solid rgba(255,255,255,0.08)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 28px 60px rgba(2,6,23,0.22)",
        }}
      >
        <div style={{ padding: "18px 18px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginBottom: 8 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: 999,
                padding: "4px 9px",
                fontSize: 10.5,
                fontWeight: 700,
                background: queueStatusBadge.background,
                color: queueStatusBadge.color,
                border: `1px solid ${queueStatusBadge.border}`,
              }}
            >
              {queueStatusBadge.label}
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.white, lineHeight: 1.2, marginBottom: 8 }}>
            {queueHeadline}
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)", lineHeight: 1.65, marginBottom: 12 }}>
            {primaryQueueItem
              ? `Next action: ${primaryQueueItem.title}.`
              : "ADAM will surface work only when your input is needed."}
          </div>
          {primaryQueueItem ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <button
                type="button"
                onClick={openPrimaryQueueItem}
                style={{
                  padding: "7px 12px",
                  borderRadius: 999,
                  border: "none",
                  background: COLORS.blue,
                  color: COLORS.white,
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {getDecisionActionLabel(primaryQueueItem)}
              </button>
            </div>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <button
              type="button"
              onClick={attentionNowAction.onClick}
              style={{ borderRadius: 14, padding: "10px 11px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", textAlign: "left", cursor: "pointer", gridColumn: queueHasNoWaitingWork ? "1 / -1" : undefined }}
            >
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.52)", marginBottom: 4 }}>{attentionNowCard.title}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.white }}>{attentionNowCard.value}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.58)", lineHeight: 1.5 }}>{attentionNowCard.summary}</div>
              {queueHasNoWaitingWork ? (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, marginTop: 6 }}>
                  {Number.isFinite(forecast?.totalRemainingDays)
                    ? `${forecast.totalRemainingDays} days remain in the current plan.`
                    : "No approvals, escalations, or review work are waiting right now."}
                </div>
              ) : null}
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.82)", marginTop: 8 }}>{attentionNowAction.label}</div>
            </button>
            {!queueHasNoWaitingWork ? (
              <button
                type="button"
                onClick={programOutlookAction.onClick}
                style={{ borderRadius: 14, padding: "10px 11px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", textAlign: "left", cursor: "pointer" }}
              >
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.52)", marginBottom: 4 }}>{queueOutlookCard.title}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.white }}>{queueOutlookCard.value}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.58)", lineHeight: 1.5 }}>{queueOutlookCard.summary}</div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.82)", marginTop: 8 }}>{programOutlookAction.label}</div>
              </button>
            ) : null}
          </div>
        </div>
        {items.length ? (
        <div style={{ padding: "18px 18px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.white }}>{activeQueueViewLabel}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.62)" }}>
              {activeQueueViewCount}
            </div>
          </div>
          {items.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {[
                { label: "Everything", value: items.length, color: "rgba(255,255,255,0.96)", bg: "rgba(255,255,255,0.08)", border: "rgba(255,255,255,0.16)", filter: "all" },
                { label: "Needs action", value: queueSummary.action, color: "rgba(254,242,242,0.96)", bg: "rgba(220,38,38,0.18)", border: "rgba(248,113,113,0.34)", filter: "action" },
                { label: "Review", value: queueSummary.review, color: "rgba(254,249,195,0.96)", bg: "rgba(217,119,6,0.18)", border: "rgba(251,191,36,0.30)", filter: "review" },
                { label: "Signals", value: queueSummary.signals, color: "rgba(219,234,254,0.96)", bg: "rgba(37,99,235,0.16)", border: "rgba(96,165,250,0.28)", filter: "proposals" },
                { label: "Materials", value: queueSummary.materials, color: "rgba(224,231,255,0.96)", bg: "rgba(99,102,241,0.14)", border: "rgba(129,140,248,0.26)", filter: "materials" },
              ]
                .filter((entry) => entry.filter === "all" || entry.value > 0 || entry.filter === filterId)
                .map((entry) => (
                <button
                  key={entry.label}
                  type="button"
                  onClick={() => applyQueueFilter(entry.filter)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    borderRadius: 999,
                    padding: "4px 8px",
                    border: `1px solid ${filterId === entry.filter ? entry.color : entry.border}`,
                    background: filterId === entry.filter ? entry.color : entry.bg,
                    color: entry.color,
                    fontSize: 10.5,
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: filterId === entry.filter ? "0 0 0 1px rgba(255,255,255,0.14) inset" : "none",
                  }}
                >
                    <span>{entry.label}</span>
                    <span>{entry.value}</span>
                  </button>
                ))}
            </div>
          ) : null}
          <div
            style={{
              marginTop: 10,
              borderRadius: 14,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setPersonaExpanded((value) => !value)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "10px 12px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.48)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 2 }}>
                  Persona
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.white }}>
                  {activePersonaLabel}
                </div>
              </div>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, flexShrink: 0 }}>
                {personaExpanded ? "▲" : "▼"}
              </span>
            </button>
            {personaExpanded ? (
              <div style={{ display: "flex", gap: 6, padding: "0 12px 12px", flexWrap: "wrap" }}>
                {Object.entries(DECISION_QUEUE_PERSONAS).map(([id, persona]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handlePersonaSelect(id)}
                    style={{
                      padding: "3px 10px",
                      borderRadius: 12,
                      fontSize: 11,
                      border: "1px solid",
                      borderColor: personaId === id ? COLORS.blue : "rgba(255,255,255,0.16)",
                      background: personaId === id ? "rgba(239,246,255,0.16)" : "rgba(255,255,255,0.04)",
                      color: personaId === id ? COLORS.white : "rgba(255,255,255,0.78)",
                      cursor: "pointer",
                    }}
                  >
                    {persona.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {showMaterialsPanel ? (
            <div
              style={{
                marginTop: 12,
                borderRadius: 14,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => setMaterialsExpanded((value) => !value)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "12px 12px 10px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.54)" }}>
                    Materials
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 24,
                      height: 24,
                      borderRadius: 999,
                      padding: "0 8px",
                      background: "rgba(99,102,241,0.16)",
                      border: "1px solid rgba(129,140,248,0.24)",
                      color: "rgba(224,231,255,0.96)",
                      fontSize: 10.5,
                      fontWeight: 700,
                    }}
                  >
                    {queueSummary.materials}
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
                    {materialsExpanded ? "▲" : "▼"}
                  </span>
                </div>
              </button>
              {materialsExpanded ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "0 12px 12px" }}>
                  <button
                    type="button"
                    onClick={() => onGenerateSteeringPack()}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.08)",
                      color: COLORS.white,
                      border: "1px solid rgba(255,255,255,0.12)",
                      cursor: "pointer",
                      fontSize: 11.5,
                      fontWeight: 700,
                    }}
                  >
                    Generate Steering Pack
                  </button>
                  <button
                    type="button"
                    onClick={() => onGenerateMeetingAgenda?.()}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.04)",
                      color: "rgba(255,255,255,0.84)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      cursor: "pointer",
                      fontSize: 11.5,
                      fontWeight: 700,
                    }}
                  >
                    Generate Meeting Agenda
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setMaterialsExpanded(true)}
              style={{
                marginTop: 14,
                padding: 0,
                background: "transparent",
                border: "none",
                color: "rgba(224,231,255,0.82)",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              Open materials
            </button>
          )}
          <div
            style={{
              marginTop: 10,
              paddingTop: 10,
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <button
              type="button"
              onClick={() => setShortcutsExpanded((value) => !value)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "0",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.72)", marginBottom: shortcutsExpanded ? 0 : 4 }}>
                  Keyboard shortcuts
                </div>
                {!shortcutsExpanded ? (
                  <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.52)", lineHeight: 1.5 }}>
                    J/K move · Enter open · X dismiss · ? help
                  </div>
                ) : null}
              </div>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, flexShrink: 0 }}>
                {shortcutsExpanded ? "▲" : "▼"}
              </span>
            </button>
            {shortcutsExpanded ? (
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                  marginTop: 10,
                }}
              >
                {[
                  ["J / ↓", "Next"],
                  ["K / ↑", "Previous"],
                  ["Enter / O", "Open"],
                  ["X", "Dismiss"],
                  ["?", "Show / hide shortcuts"],
                ].map(([key, label]) => (
                  <span
                    key={key}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      borderRadius: 999,
                      padding: "4px 8px",
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: "rgba(255,255,255,0.62)",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <span style={{ color: COLORS.white }}>{key}</span>
                    <span>{label}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        ) : null}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {!navigableItems.length ? (
            items.length ? (
              <div
                style={{
                  padding: 18,
                  borderRadius: 16,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,0.86)", marginBottom: 6 }}>
                  {filterId === "all" ? "All caught up" : "Nothing in this view right now"}
                </div>
                <div style={{ color: "rgba(255,255,255,0.66)", fontSize: 11.5, lineHeight: 1.6, marginBottom: 12 }}>
                  {getFilterEmptyState(filterId)}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {filterId !== "all" ? (
                    <button
                      type="button"
                      onClick={() => applyQueueFilter("all")}
                      style={{
                        padding: "7px 12px",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(255,255,255,0.06)",
                        color: COLORS.white,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Show everything
                    </button>
                  ) : null}
                  {queueSummary.materials > 0 && filterId !== "materials" ? (
                    <button
                      type="button"
                      onClick={() => applyQueueFilter("materials")}
                      style={{
                        padding: "7px 12px",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(255,255,255,0.06)",
                        color: COLORS.white,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Review materials
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {filterId === "all" && topQueueOverflowCount > 0 ? (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.72)",
                  }}
                >
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: COLORS.white, marginBottom: 4 }}>
                    Showing the top {topQueueItems.length} actions
                  </div>
                  <div style={{ fontSize: 11, lineHeight: 1.55 }}>
                    {topQueueOverflowCount} more queue item{topQueueOverflowCount === 1 ? "" : "s"} remain in the background and will surface here as priorities change.
                  </div>
                </div>
              ) : null}
              {(filterId === "all" ? topQueueItems : filteredItems).map(renderQueueCard)}
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          borderRadius: 22,
          background: queueIsIdle ? "linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)" : COLORS.white,
          border: `1px solid ${queueIsIdle ? "#dbe3f0" : COLORS.gray200}`,
          boxShadow: "0 24px 60px rgba(15,23,42,0.08)",
          padding: 24,
          overflow: "hidden",
        }}
      >
        {selectedItem ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              paddingBottom: 16,
              marginBottom: 16,
              borderBottom: `1px solid ${COLORS.gray200}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: 999,
                  padding: "5px 9px",
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  color: "#1d4ed8",
                  fontSize: 10.5,
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                {selectedIndex >= 0 ? `${selectedIndex + 1} of ${navigableItems.length}` : "Selected"}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: 999,
                  padding: "5px 9px",
                  background: "#f8fafc",
                  border: `1px solid ${COLORS.gray200}`,
                  color: COLORS.gray700,
                  fontSize: 10.5,
                  fontWeight: 700,
                }}
              >
                {getDecisionPhaseLabel(selectedItem.phaseId)} · {getDecisionTypeLabel(selectedItem)}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => requestAiResponseForItem(selectedItem)}
                disabled={qaLoading}
                style={{
                  padding: "7px 12px",
                  borderRadius: 999,
                  background: COLORS.white,
                  color: qaLoading ? COLORS.gray400 : COLORS.gray700,
                  border: `1px solid ${COLORS.gray200}`,
                  cursor: qaLoading ? "wait" : "pointer",
                  fontSize: 11.5,
                  fontWeight: 700,
                  opacity: qaLoading ? 0.6 : 1,
                }}
              >
                {qaLoading ? "ADAM drafting…" : "Draft with ADAM"}
              </button>
              <button
                type="button"
                onClick={() => handleSelectQueueItem(previousItem)}
                disabled={!previousItem}
                style={{
                  padding: "7px 12px",
                  borderRadius: 999,
                  background: COLORS.white,
                  color: previousItem ? COLORS.gray700 : COLORS.gray400,
                  border: `1px solid ${COLORS.gray200}`,
                  cursor: previousItem ? "pointer" : "default",
                  fontSize: 11.5,
                  fontWeight: 700,
                  opacity: previousItem ? 1 : 0.6,
                }}
              >
                ← Previous
              </button>
              <button
                type="button"
                onClick={() => handleSelectQueueItem(nextItem)}
                disabled={!nextItem}
                style={{
                  padding: "7px 12px",
                  borderRadius: 999,
                  background: nextItem ? COLORS.gray900 : COLORS.white,
                  color: nextItem ? COLORS.white : COLORS.gray400,
                  border: nextItem ? "none" : `1px solid ${COLORS.gray200}`,
                  cursor: nextItem ? "pointer" : "default",
                  fontSize: 11.5,
                  fontWeight: 700,
                  opacity: nextItem ? 1 : 0.6,
                }}
              >
                Next →
              </button>
            </div>
          </div>
        ) : null}
        {renderDetail()}
        {selectedItem ? (
          <div
            style={{
              marginTop: 18,
              paddingTop: 16,
              borderTop: `1px solid ${COLORS.gray200}`,
            }}
          >
            {nextItem ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  padding: "14px 16px",
                  borderRadius: 16,
                  background: "#f8fafc",
                  border: `1px solid ${COLORS.gray200}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.gray500, marginBottom: 4 }}>
                    Next in queue
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.gray900, marginBottom: 4 }}>
                    {nextItem.title}
                  </div>
                  <div style={{ fontSize: 11.5, color: COLORS.gray500, lineHeight: 1.55 }}>
                    {getDecisionActionLabel(nextItem)} · {getDecisionPhaseLabel(nextItem.phaseId)} · {getDecisionTypeLabel(nextItem)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleSelectQueueItem(nextItem)}
                  style={{
                    flexShrink: 0,
                    padding: "8px 14px",
                    borderRadius: 999,
                    background: COLORS.blue,
                    color: COLORS.white,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 11.5,
                    fontWeight: 800,
                  }}
                >
                  Open next action
                </button>
              </div>
            ) : (
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 16,
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                }}
              >
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#166534", marginBottom: 4 }}>
                  End of current view
                </div>
                <div style={{ fontSize: 13, color: "#166534", lineHeight: 1.6 }}>
                  You’re at the end of this queue view. Finish this action and return to the inbox for a fresh snapshot.
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
      </div>
    </div>
  );
}
