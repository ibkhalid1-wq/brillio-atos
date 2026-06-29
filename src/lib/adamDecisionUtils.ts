import type { AgentQuestion, PhaseAgentState } from "@/lib/adamPhaseAgentTypes";

export type DecisionPriority = "critical" | "high" | "medium" | "info";

export type DecisionItemType =
  | "draft_review"
  | "question"
  | "escalation"
  | "exit_proposal"
  | "adr_proposal"
  | "revision_ready"
  | "briefing_ready"
  | "rebaseline"
  | "steering_pack"
  | "risk_mitigation"
  | "agent_conflict"
  | "handoff_ready"
  | "meeting_agenda"
  | "communication_ready"
  | "scope_change"
  | "hypothesis_alert"
  | "gate_approval"
  | "capacity_alert"
  | "uat_ready"
  | "milestone_slip"
  | "change_request"
  | "stakeholder_alert"
  | "benefit_alert"
  | "calendar_proposal"
  | "budget_alert"
  | "retro_ready"
  | "integration_conflict"
  | "closure_ready"
  | "data_governance_gap"
  | "critical_path_alert"
  | "escalation_raised"
  | "resource_alert"
  | "plan_action"
  | "inputs_incomplete"
  | "artifacts_incomplete";

const ADAM_PHASE_SEQUENCE_FALLBACK = [
  "strategy",
  "mobilise",
  "discover",
  "design",
  "build",
  "operate",
  "govern",
  "optimize",
  "valuerealize",
];

export const DECISION_QUEUE_PERSONAS = {
  executive: {
    label: "Executive",
    types: ["exit_proposal", "escalation", "briefing_ready", "rebaseline", "steering_pack", "risk_mitigation", "agent_conflict", "handoff_ready", "meeting_agenda", "communication_ready", "scope_change", "hypothesis_alert", "gate_approval", "capacity_alert", "milestone_slip", "change_request", "stakeholder_alert", "benefit_alert", "budget_alert", "closure_ready", "escalation_raised", "plan_action", "inputs_incomplete", "artifacts_incomplete"],
  },
  delivery_lead: {
    label: "Delivery Lead",
    types: ["draft_review", "revision_ready", "question", "escalation", "adr_proposal", "exit_proposal", "steering_pack", "risk_mitigation", "handoff_ready", "meeting_agenda", "communication_ready", "scope_change", "hypothesis_alert", "gate_approval", "capacity_alert", "uat_ready", "milestone_slip", "change_request", "stakeholder_alert", "calendar_proposal", "budget_alert", "retro_ready", "closure_ready", "critical_path_alert", "escalation_raised", "resource_alert", "plan_action", "inputs_incomplete", "artifacts_incomplete"],
  },
  architect: {
    label: "Architect",
    types: ["adr_proposal", "draft_review", "revision_ready", "exit_proposal", "steering_pack", "risk_mitigation", "agent_conflict", "handoff_ready", "communication_ready", "scope_change", "hypothesis_alert", "gate_approval", "capacity_alert", "integration_conflict", "data_governance_gap", "critical_path_alert", "plan_action", "inputs_incomplete", "artifacts_incomplete"],
  },
  all: {
    label: "All perspectives",
    types: null,
  },
} as const;

export const COMMUNICATION_AUDIENCES = {
  executive: {
    label: "Executive Sponsor",
    tone: "strategic, outcome-focused, minimal technical detail",
  },
  delivery_lead: {
    label: "Delivery Lead",
    tone: "operational, action-oriented, risk-aware",
  },
  end_user: {
    label: "End User / Business",
    tone: "plain English, impact-focused, no jargon",
  },
  architect: {
    label: "Technical Architect",
    tone: "technical, decision-rationale, dependency-aware",
  },
  steering: {
    label: "Steering Committee",
    tone: "formal, governance-focused, exception-based",
  },
} as const;

export interface DecisionItem {
  id: string;
  type: DecisionItemType;
  priority: DecisionPriority;
  phaseId: string;
  title: string;
  summary: string;
  artifactId?: string;
  questionId?: string;
  createdAt: number;
  actionLabel: string;
  dismissable: boolean;
  payload?: any;
}

function getCreatedAt(value: any) {
  if (!value) return Date.now();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function asArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? value : [];
}

function getNormalizedPhaseId(value: any, fallback = "portfolio") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

function getPhaseTitle(value: any) {
  const normalized = getNormalizedPhaseId(value, "program");
  if (normalized === "valuerealize") return "Value Realize";
  return normalized.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function hasMeaningfulValue(value: any): boolean {
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => hasMeaningfulValue(item));
  }
  if (typeof value === "number") return true;
  return String(value || "").trim().length > 0;
}

function getRaidEntries(projectData: any) {
  if (Array.isArray(projectData?.raidLog)) return projectData.raidLog;
  if (Array.isArray(projectData?.raidLog?.entries)) return projectData.raidLog.entries;
  return [];
}

function isRaidEntryClosed(entry: any) {
  const normalizedStatus = String(entry?.status || "").toLowerCase();
  return entry?.resolved === true || normalizedStatus === "closed" || normalizedStatus === "resolved";
}

function getRaidEntryType(entry: any) {
  return String(entry?.type || entry?.category || "").toLowerCase();
}

function formatRelativeTimeLabel(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) return "just now";
  if (hours < 24) return `${Math.max(1, Math.round(hours))}h`;
  const days = Math.max(1, Math.round(hours / 24));
  return `${days}d`;
}

function formatDueStatusLabel(value: any) {
  const timestamp = getCreatedAt(value);
  if (!value || !Number.isFinite(timestamp)) return "No due date";
  const delta = timestamp - Date.now();
  const hours = Math.round(Math.abs(delta) / 3_600_000);
  const formattedDate = new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (delta < 0) return `Overdue by ${formatRelativeTimeLabel(hours)} · was due ${formattedDate}`;
  if (hours <= 72) return `Due in ${formatRelativeTimeLabel(hours)} · ${formattedDate}`;
  return `Due ${formattedDate}`;
}

function getProjectPlan(projectData: any) {
  // The delivery plan is folded into the Strategic Roadmap container; fall back
  // to the legacy top-level plan for programs written before the fold.
  const roadmap = projectData?.strategicRoadmap ?? projectData?.data?.strategicRoadmap;
  if (roadmap?.deliveryPlan && typeof roadmap.deliveryPlan === "object") return roadmap.deliveryPlan;
  if (projectData?.plan && typeof projectData.plan === "object") return projectData.plan;
  if (projectData?.data?.plan && typeof projectData.data.plan === "object") return projectData.data.plan;
  return null;
}

function getProjectMilestones(projectData: any) {
  const roadmap = projectData?.strategicRoadmap ?? projectData?.data?.strategicRoadmap;
  if (Array.isArray(roadmap?.milestones) && roadmap.milestones.length) return roadmap.milestones;
  if (Array.isArray(projectData?.milestones) && projectData.milestones.length) return projectData.milestones;
  if (Array.isArray(projectData?.mobilise?.workplan?.milestones)) return projectData.mobilise.workplan.milestones;
  return [];
}

// A milestone is "achieved" — and so cannot be slipping — when its own status
// reads complete, or when its phase's gate has been approved. The gate is the
// authoritative signal: a phase-gate milestone (e.g. "Strategy Phase Gate")
// keeps a stale "delayed" status from before approval, so without this check an
// already-locked phase would keep raising a milestone-slip action forever.
const ACHIEVED_MILESTONE_STATUSES = new Set([
  "completed", "complete", "done", "achieved", "delivered", "closed",
]);

// A phase whose gate is approved is signed off — its synthetic blockers/actions
// (slipping milestones, outstanding artifacts) are no longer workable items and
// must stop surfacing, otherwise an approved phase keeps raising stale alerts.
function isPhaseGateApproved(projectData: any, phaseId: string | null | undefined): boolean {
  const id = String(phaseId || "").trim();
  if (!id) return false;
  return String(projectData?.gateReviews?.[id]?.status || "").toLowerCase() === "approved";
}

function isMilestoneAchieved(projectData: any, milestone: any): boolean {
  if (ACHIEVED_MILESTONE_STATUSES.has(String(milestone?.status || "").toLowerCase())) return true;
  return isPhaseGateApproved(projectData, milestone?.phaseId || milestone?.linkedPhase);
}

function buildSyntheticMilestoneSlipItems(projectData: any) {
  const items: DecisionItem[] = [];
  const existingQueueItems = asArray(projectData?.decisionQueue);
  const seenMilestones = new Set<string>();
  const addMilestoneItem = (item: DecisionItem, milestoneKey: string) => {
    if (!milestoneKey || seenMilestones.has(milestoneKey)) return;
    const alreadyQueued = existingQueueItems.some((queuedItem: any) => {
      if (queuedItem?.status === "dismissed" || queuedItem?.status === "resolved") return false;
      const queuedKey = String(
        queuedItem?.milestoneId
          || queuedItem?.payload?.slip?.milestoneId
          || queuedItem?.payload?.slip?.id
          || queuedItem?.payload?.milestoneId
          || queuedItem?.payload?.id
          || "",
      );
      return queuedItem?.type === "milestone_slip" && queuedKey === milestoneKey;
    });
    if (alreadyQueued) return;
    seenMilestones.add(milestoneKey);
    items.push(item);
  };

  asArray(projectData?.milestoneSlips)
    .slice()
    .sort((left: any, right: any) => getCreatedAt(right?.detectedAt || right?.createdAt) - getCreatedAt(left?.detectedAt || left?.createdAt))
    .forEach((slip: any, index: number) => {
      if (isMilestoneAchieved(projectData, slip)) return;
      const milestoneKey = String(slip?.milestoneId || slip?.id || slip?.milestoneName || `slip-${index}`);
      const slipDays = Number(slip?.slipDays || 0);
      addMilestoneItem({
        id: `synthetic-milestone-slip-${milestoneKey}`,
        type: "milestone_slip",
        priority: slipDays >= 14 ? "critical" : "high",
        phaseId: getNormalizedPhaseId(slip?.phaseId || slip?.linkedPhase, "delivery"),
        title: `Milestone slipping - ${slip?.milestoneName || "Program milestone"}`,
        summary: slip?.impactSummary || `Forecast slip of ${slipDays || 0} day${Math.abs(slipDays) === 1 ? "" : "s"} detected. Re-sequence dependencies and confirm recovery options.`,
        createdAt: getCreatedAt(slip?.detectedAt || slip?.createdAt || slip?.targetDate),
        actionLabel: "View Milestones",
        dismissable: false,
        payload: { slip },
      }, milestoneKey);
    });

  getProjectMilestones(projectData)
    .filter((milestone: any) => {
      if (isMilestoneAchieved(projectData, milestone)) return false;
      const status = String(milestone?.status || "").toLowerCase();
      const planned = getCreatedAt(milestone?.plannedDate || milestone?.dueDate || milestone?.targetDate);
      const forecast = getCreatedAt(milestone?.forecastDate || milestone?.projectedDate);
      return status === "slipping"
        || status === "delayed"
        || status === "at_risk"
        || (planned && forecast && forecast > planned);
    })
    .forEach((milestone: any, index: number) => {
      const milestoneKey = String(milestone?.id || milestone?.milestoneId || milestone?.title || milestone?.name || `milestone-${index}`);
      const planned = getCreatedAt(milestone?.plannedDate || milestone?.dueDate || milestone?.targetDate);
      const forecast = getCreatedAt(milestone?.forecastDate || milestone?.projectedDate);
      const slipDays = planned && forecast ? Math.max(0, Math.round((forecast - planned) / 86_400_000)) : 0;
      addMilestoneItem({
        id: `synthetic-milestone-status-${milestoneKey}`,
        type: "milestone_slip",
        priority: String(milestone?.status || "").toLowerCase() === "delayed" || slipDays >= 14 ? "critical" : "high",
        phaseId: getNormalizedPhaseId(milestone?.phaseId || milestone?.linkedPhase, "delivery"),
        title: `Milestone slipping - ${milestone?.title || milestone?.name || "Program milestone"}`,
        summary: slipDays > 0
          ? `Forecast is ${slipDays} day${slipDays === 1 ? "" : "s"} behind plan. Review dependencies and the recovery path.`
          : "Milestone status is at risk. Review the plan and confirm what has slipped.",
        createdAt: getCreatedAt(milestone?.lastUpdatedAt || milestone?.forecastDate || milestone?.dueDate || milestone?.targetDate),
        actionLabel: "View Milestones",
        dismissable: false,
        payload: {
          slip: {
            ...milestone,
            milestoneId: milestone?.id,
            milestoneName: milestone?.title || milestone?.name,
            slipDays,
          },
        },
      }, milestoneKey);
    });

  return items.slice(0, 3);
}

function buildSyntheticPlanActionItems(projectData: any) {
  const plan = getProjectPlan(projectData);
  const collected: DecisionItem[] = [];
  const seenTitles = new Set<string>();
  const addAction = ({
    id,
    title,
    phaseId,
    owner,
    rationale,
    dueDate,
    source,
  }: {
    id: string;
    title: string;
    phaseId: string;
    owner?: string | null;
    rationale?: string | null;
    dueDate?: string | null;
    source: "plan" | "workplan";
  }) => {
    const normalizedTitle = title.trim().toLowerCase();
    if (!normalizedTitle || seenTitles.has(normalizedTitle)) return;
    // A signed-off phase no longer has workable actions — drop plan/workplan items
    // for approved gates so they stop re-surfacing as stale decisions.
    if (isPhaseGateApproved(projectData, phaseId)) return;
    seenTitles.add(normalizedTitle);
    const dueTimestamp = dueDate ? getCreatedAt(dueDate) : 0;
    const overdue = dueTimestamp > 0 && dueTimestamp < Date.now();
    const dueSoon = dueTimestamp > Date.now() && dueTimestamp - Date.now() <= 3 * 86_400_000;
    collected.push({
      id,
      type: "plan_action",
      priority: overdue ? "critical" : dueSoon || source === "plan" ? "high" : "medium",
      phaseId,
      title,
      summary: [
        owner ? `Owner: ${owner}` : null,
        dueDate ? formatDueStatusLabel(dueDate) : null,
        rationale || null,
      ].filter(Boolean).join(" · "),
      createdAt: dueTimestamp || Date.now(),
      actionLabel: "Open workspace",
      dismissable: false,
      payload: { owner: owner || null, rationale: rationale || null, dueDate: dueDate || null, source },
    });
  };

  asArray(plan?.nextThreeActions).forEach((item: any, index: number) => {
    const title = String(item?.action || item?.title || "").trim();
    if (!title) return;
    addAction({
      id: `plan-next-action-${getNormalizedPhaseId(item?.phase || item?.phaseId, "delivery")}-${index}`,
      title,
      phaseId: getNormalizedPhaseId(item?.phase || item?.phaseId, "delivery"),
      owner: item?.owner || null,
      rationale: item?.rationale || item?.reason || null,
      dueDate: item?.dueDate || item?.targetDate || null,
      source: "plan",
    });
  });

  const workplanTasks = asArray(projectData?.mobilise?.workplan?.phases)
    .flatMap((phase: any) => asArray(phase?.workstreams).flatMap((workstream: any) => (
      asArray(workstream?.tasks).map((task: any) => ({
        ...task,
        phaseId: getNormalizedPhaseId(phase?.phaseId, "delivery"),
      }))
    )))
    .filter((task: any) => {
      const status = String(task?.status || "").toLowerCase();
      return status !== "complete" && status !== "done" && status !== "closed";
    })
    .sort((left: any, right: any) => {
      const leftDue = left?.dueDate ? getCreatedAt(left.dueDate) : Number.MAX_SAFE_INTEGER;
      const rightDue = right?.dueDate ? getCreatedAt(right.dueDate) : Number.MAX_SAFE_INTEGER;
      return leftDue - rightDue;
    });

  workplanTasks.slice(0, 4).forEach((task: any, index: number) => {
    const title = String(task?.name || "").trim();
    if (!title) return;
    addAction({
      id: `workplan-action-${task.phaseId}-${index}`,
      title,
      phaseId: task.phaseId,
      owner: task?.owner || task?.lead || null,
      rationale: (asArray(task?.dependencies).length ? `Depends on ${asArray(task?.dependencies).join(", ")}` : null),
      dueDate: task?.dueDate || null,
      source: "workplan",
    });
  });

  return collected.slice(0, 3);
}

/** One aggregate action per started phase whose input fields are not all answered. */
function buildSyntheticInputCompletionItems(projectData: any) {
  const workplanPhases = asArray(projectData?.mobilise?.workplan?.phases);
  return ADAM_PHASE_SEQUENCE_FALLBACK
    .map((phaseId) => {
      const phaseGuidance = projectData?.phaseGuidance?.[phaseId] ?? {};
      const fields = phaseGuidance?.fields ?? {};
      const fieldKeys = Object.keys(fields).filter((key) => key !== "aiBrief");
      if (!fieldKeys.length) return null;
      const answeredFields = fieldKeys.filter((key) => hasMeaningfulValue(fields[key])).length;
      const missing = fieldKeys.length - answeredFields;
      if (missing <= 0) return null;
      const artifacts = Object.values(projectData?.phaseArtifacts?.[phaseId] ?? {}) as any[];
      const draftedArtifacts = artifacts.filter((artifact) => String(artifact?.status || "").toLowerCase() !== "blank").length;
      const workplanPhase = workplanPhases.find((phase: any) => getNormalizedPhaseId(phase?.phaseId) === phaseId);
      const hasStarted = Boolean(phaseGuidance?.startedAt)
        || answeredFields > 0
        || draftedArtifacts > 0
        || Boolean(workplanPhase?.actualStart || workplanPhase?.plannedStart);
      if (!hasStarted) return null;
      const pct = Math.round((answeredFields / fieldKeys.length) * 100);
      return {
        id: `inputs-incomplete-${phaseId}`,
        type: "inputs_incomplete" as const,
        phaseId,
        priority: "medium" as DecisionPriority,
        title: `${getPhaseTitle(phaseId)} inputs incomplete`,
        summary: `${answeredFields}/${fieldKeys.length} inputs captured (${pct}%) · ${missing} remaining`,
        createdAt: getCreatedAt(phaseGuidance?.lastUpdated || phaseGuidance?.startedAt || workplanPhase?.plannedStart),
        actionLabel: "Complete inputs",
        dismissable: false,
        payload: { answeredFields, totalFields: fieldKeys.length, missing, pct },
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

/** One aggregate blocker per started phase whose artifacts are not all approved. */
function buildSyntheticArtifactBlockerItems(projectData: any) {
  const workplanPhases = asArray(projectData?.mobilise?.workplan?.phases);
  return ADAM_PHASE_SEQUENCE_FALLBACK
    .map((phaseId) => {
      // A gate-approved phase is signed off — don't flag its artifacts as
      // "incomplete" just because one optional artifact is still a draft.
      if (isPhaseGateApproved(projectData, phaseId)) return null;
      const phaseGuidance = projectData?.phaseGuidance?.[phaseId] ?? {};
      const artifacts = Object.values(projectData?.phaseArtifacts?.[phaseId] ?? {}) as any[];
      if (!artifacts.length) return null;
      const approvedArtifacts = artifacts.filter((artifact) => String(artifact?.status || "").toLowerCase() === "approved").length;
      const incomplete = artifacts.length - approvedArtifacts;
      if (incomplete <= 0) return null;
      const draftedArtifacts = artifacts.filter((artifact) => String(artifact?.status || "").toLowerCase() !== "blank").length;
      const notStarted = artifacts.length - draftedArtifacts;
      const workplanPhase = workplanPhases.find((phase: any) => getNormalizedPhaseId(phase?.phaseId) === phaseId);
      const hasStarted = Boolean(phaseGuidance?.startedAt)
        || draftedArtifacts > 0
        || Boolean(workplanPhase?.actualStart || workplanPhase?.plannedStart);
      if (!hasStarted) return null;
      return {
        id: `artifacts-incomplete-${phaseId}`,
        type: "artifacts_incomplete" as const,
        phaseId,
        priority: "high" as DecisionPriority,
        title: `${getPhaseTitle(phaseId)} artifacts incomplete`,
        summary: `${approvedArtifacts}/${artifacts.length} artifacts approved · ${incomplete} outstanding${notStarted ? ` (${notStarted} not started)` : ""}`,
        createdAt: getCreatedAt(phaseGuidance?.lastUpdated || phaseGuidance?.startedAt || workplanPhase?.plannedStart),
        actionLabel: "Review artifacts",
        dismissable: false,
        payload: { approved: approvedArtifacts, total: artifacts.length, incomplete, notStarted },
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

export function buildDecisionQueue(
  phaseAgents: Record<string, { agentState: PhaseAgentState | null }>,
  projectData: any,
  personaId: keyof typeof DECISION_QUEUE_PERSONAS | string = "all",
): DecisionItem[] {
  const queue: DecisionItem[] = [];
  const raidEntries = getRaidEntries(projectData);

  for (const [phaseId, agent] of Object.entries(phaseAgents || {})) {
    const state = agent?.agentState;
    if (!state) continue;

    if (state.escalated && state.escalationSummary) {
      queue.push({
        id: `esc_${phaseId}`,
        type: "escalation",
        priority: "critical",
        phaseId,
        title: `${phaseId} phase blocked - decision needed`,
        summary: state.escalationSummary.slice(0, 120),
        createdAt: state.lastRanAt ?? Date.now(),
        actionLabel: "Resolve",
        dismissable: false,
      });
    }

    const phaseArtifacts = projectData?.phaseArtifacts?.[phaseId] ?? {};
    for (const [artifactId, artifact] of Object.entries(phaseArtifacts as Record<string, any>)) {
      if (
        artifact?.agentDrafted
        && artifact?.status === "draft"
        && !artifact?.agentDraftRevisionRequested
        && !artifact?.agentRevisedAt
      ) {
        queue.push({
          id: `draft_${phaseId}_${artifactId}`,
          type: "draft_review",
          priority: "high",
          phaseId,
          artifactId,
          title: `Review agent draft: ${artifactId}`,
          summary: `Agent drafted ${artifactId} in ${phaseId}. Review and approve the current version.`,
          createdAt: artifact?.agentDraftedAt ? getCreatedAt(artifact.agentDraftedAt) : Date.now(),
          actionLabel: "Review Draft",
          dismissable: true,
          payload: {
            qualityScore: projectData?.phaseArtifactQualityScores?.[phaseId]?.[artifactId] ?? null,
          },
        });
      }

      if (
        artifact?.agentDrafted
        && !artifact?.agentDraftRevisionRequested
        && artifact?.agentRevisedAt
      ) {
        queue.push({
          id: `rev_${phaseId}_${artifactId}`,
          type: "revision_ready",
          priority: "medium",
          phaseId,
          artifactId,
          title: `Revised draft ready: ${artifactId}`,
          summary: `Agent revised ${artifactId} based on your edits. Review the updated version.`,
          createdAt: getCreatedAt(artifact.agentRevisedAt),
          actionLabel: "Review Revision",
          dismissable: true,
        });
      }
    }
  }

  for (const [phaseId, agent] of Object.entries(phaseAgents || {})) {
    const invalidated = (agent?.agentState as any)?.invalidatedArtifacts
      ?? projectData?.phaseImpactedArtifacts?.[phaseId]
      ?? [];
    for (const item of invalidated) {
      if (!item?.artifactId) continue;
      queue.push({
        id: `invalidated-${phaseId}-${item.artifactId}`,
        type: "revision_ready",
        phaseId,
        artifactId: item.artifactId,
        priority: "high",
        title: `Re-evaluation needed: ${item.artifactId}`,
        summary: `"${item.sourceField}" changed in ${item.sourcePhase} — this artifact may be outdated`,
        createdAt: getCreatedAt(item.flaggedAt),
        actionLabel: "Review Revision",
        dismissable: false,
        payload: item,
      });
    }
  }

  const pendingQuestions: AgentQuestion[] = (projectData?.pendingAgentQuestions ?? [])
    .filter((question: AgentQuestion) => !question?.applied);

  for (const question of pendingQuestions) {
    queue.push({
      id: `q_${question.id}`,
      type: "question",
      priority: "high",
      phaseId: question.phaseId,
      questionId: question.id,
      title: `Answer needed: ${question.phaseId} phase`,
      summary: (question.questions ?? []).slice(0, 2).join(" · "),
      createdAt: question.dispatchedAt ?? Date.now(),
      actionLabel: "Answer",
      dismissable: false,
      payload: question,
    });
  }

  const exitProposals = projectData?.pendingExitProposals ?? {};
  for (const [phaseId, workflow] of Object.entries(projectData?.gateApprovalWorkflows ?? {}) as any[]) {
    if (!workflow || workflow.status !== "in_progress") continue;
    const pending = (workflow.requiredSignatories ?? []).filter((signatory: any) => (
      !(workflow.approvals ?? []).some((approval: any) => approval.roleId === signatory.roleId)
      && !(workflow.rejections ?? []).some((rejection: any) => rejection.roleId === signatory.roleId)
    ));
    const initiatedAt = getCreatedAt(workflow.initiatedAt);
    const overdueHours = Math.max(0, Math.round((Date.now() - initiatedAt) / 3_600_000));
    const isOverdue = pending.length > 0 && overdueHours >= 48;
    queue.push({
      id: `gate-approval-${phaseId}`,
      type: "gate_approval",
      phaseId,
      priority: "critical",
      title: isOverdue ? `Overdue Gate Approval - ${getPhaseTitle(phaseId)}` : `Gate Approval Required - ${getPhaseTitle(phaseId)}`,
      summary: isOverdue
        ? `${pending.length} pending signator${pending.length === 1 ? "y" : "ies"} · overdue by ${formatRelativeTimeLabel(overdueHours)}`
        : `${workflow.approvals?.length ?? 0}/${workflow.requiredSignatories?.length ?? 0} approvals received · ${pending.length} pending`,
      createdAt: initiatedAt,
      actionLabel: "Review Gate",
      dismissable: false,
      payload: { ...workflow, pendingSignatories: pending, overdueHours, isOverdue },
    });
  }

  for (const [phaseId, proposal] of Object.entries(exitProposals as Record<string, any>)) {
    if (proposal?.dismissed) continue;
    queue.push({
      id: `exit_${phaseId}`,
      type: "exit_proposal",
      priority: "info",
      phaseId,
      title: `${phaseId} is gate-ready`,
      summary: `Readiness ${proposal?.readiness ?? 0}%. All exit criteria passing. Initiate phase exit?`,
      createdAt: proposal?.proposedAt ?? Date.now(),
      actionLabel: "Initiate Exit",
      dismissable: true,
      payload: proposal,
    });
  }

  for (const [phaseId, proposal] of Object.entries(exitProposals as Record<string, any>)) {
    const workflow = projectData?.gateApprovalWorkflows?.[phaseId];
    if (proposal?.dismissed || workflow?.status === "in_progress") continue;
    const proposedAt = getCreatedAt(proposal?.proposedAt);
    const overdueHours = Math.max(0, Math.round((Date.now() - proposedAt) / 3_600_000));
    if (overdueHours < 48) continue;
    queue.push({
      id: `gate-approval-start-${phaseId}`,
      type: "gate_approval",
      phaseId,
      priority: "critical",
      title: `Gate review overdue - ${getPhaseTitle(phaseId)}`,
      summary: `Phase has been gate-ready for ${formatRelativeTimeLabel(overdueHours)}, but formal approval has not started.`,
      createdAt: proposedAt,
      actionLabel: "Start gate review",
      dismissable: false,
      payload: {
        phaseId,
        readiness: proposal?.readiness ?? 0,
        proposedAt: proposal?.proposedAt ?? null,
        targetGateDate: projectData?.phaseGuidance?.[phaseId]?.targetGateDate ?? null,
        requiredSignatories: [],
        approvals: [],
        rejections: [],
        pendingSignatories: [],
        overdueHours,
        notStarted: true,
      },
    });
  }

  const briefings = projectData?.phaseBriefings ?? {};
  for (const [phaseId, briefing] of Object.entries(briefings as Record<string, any>)) {
    if (!briefing?.content || briefing?.stale || briefing?.dismissed) continue;
    queue.push({
      id: `briefing_${phaseId}`,
      type: "briefing_ready",
      priority: "info",
      phaseId,
      title: `${phaseId} gate briefing ready`,
      summary: "Executive briefing generated after gate passage. Ready for steering committee.",
      createdAt: getCreatedAt(briefing?.generatedAt),
      actionLabel: "View Briefing",
      dismissable: true,
      payload: briefing,
    });
  }

  if (projectData?.lessonsLearned && !projectData?.lessonsLearned?.dismissed) {
    const lessons = projectData.lessonsLearned;
    queue.push({
      id: "lessons-learned",
      type: "briefing_ready",
      phaseId: "valuerealize",
      priority: "medium",
      title: "Lessons Learned Document Ready",
      summary: `${lessons?.adrCount ?? 0} ADR(s) · ${lessons?.resolvedRaidCount ?? 0} resolved RAID item(s) · contributed to library`,
      createdAt: getCreatedAt(lessons?.generatedAt),
      actionLabel: "Review Lessons",
      dismissable: true,
      payload: { ...lessons, isLessonsLearned: true },
    });
  }

  const adrProposals = (projectData?.pendingADRProposals ?? [])
    .filter((proposal: any) => proposal?.autoGenerated && proposal?.status === "draft");
  if (adrProposals.length > 0) {
    const byPhase: Record<string, number> = {};
    for (const proposal of adrProposals) {
      const phaseId = proposal?.sourceArtifactPhase ?? "design";
      byPhase[phaseId] = (byPhase[phaseId] ?? 0) + 1;
    }
    for (const [phaseId, count] of Object.entries(byPhase)) {
      queue.push({
        id: `adr_${phaseId}`,
        type: "adr_proposal",
        priority: "medium",
        phaseId,
        title: `${count} ADR proposal${count > 1 ? "s" : ""} to review`,
        summary: `${count} architecture decision${count > 1 ? "s" : ""} extracted from ${phaseId} artifacts. Accept or dismiss each.`,
        createdAt: Date.now(),
        actionLabel: "Review ADRs",
        dismissable: true,
      });
    }
  }

  const rebaselineProposal = projectData?.strategyData?.agentRebaselineProposal;
  if (rebaselineProposal && !rebaselineProposal?.dismissed) {
    queue.push({
      id: "rebaseline-strategy",
      type: "rebaseline",
      phaseId: "strategy",
      priority: "high",
      title: "Strategy Re-Baselining Proposal",
      summary: `${(rebaselineProposal?.variances ?? []).length} KPI(s) deviated ≥15% - agent recommends re-baselining`,
      createdAt: getCreatedAt(rebaselineProposal?.generatedAt),
      actionLabel: "Review Proposal",
      dismissable: true,
      payload: rebaselineProposal,
    });
  }

  if (projectData?.steeringPack && !projectData?.steeringPack?.dismissed) {
    const pack = projectData.steeringPack;
    queue.push({
      id: "steering-pack",
      type: "steering_pack",
      phaseId: "portfolio",
      priority: "high",
      title: "Steering Committee Pack",
      summary: `Covers ${(pack?.coveringPhases ?? []).length} phases · ${pack?.openEscalations ?? 0} escalation(s) · ${pack?.pendingExits ?? 0} gate exit(s)`,
      createdAt: getCreatedAt(pack?.generatedAt),
      actionLabel: "Open Pack",
      dismissable: true,
      payload: pack,
    });
  }

  if (projectData?.meetingAgenda && !projectData?.meetingAgenda?.dismissed) {
    const agenda = projectData.meetingAgenda;
    queue.push({
      id: "meeting-agenda",
      type: "meeting_agenda",
      phaseId: "portfolio",
      priority: "high",
      title: "Checkpoint Meeting Agenda",
      summary: `${agenda?.itemCount ?? 0} item(s) · ~${agenda?.estimatedMinutes ?? 0} min · auto-generated`,
      createdAt: getCreatedAt(agenda?.generatedAt),
      actionLabel: "Open Agenda",
      dismissable: true,
      payload: agenda,
    });
  }

  for (const comm of (projectData?.pendingCommunications ?? []) as any[]) {
    if (!comm || comm.sent || comm.dismissed) continue;
    queue.push({
      id: `comm-${comm.id}`,
      type: "communication_ready",
      phaseId: comm.phaseId || "portfolio",
      priority: comm.eventType === "escalation" ? "high" : "medium",
      title: `Draft Communication - ${comm.audienceLabel}`,
      summary: comm.subject || "Program update",
      createdAt: getCreatedAt(comm.generatedAt),
      actionLabel: "Review Draft",
      dismissable: true,
      payload: comm,
    });
  }

  for (const change of (projectData?.scopeChangeLog ?? []) as any[]) {
    if (!change || change.status !== "pending" || change.dismissed) continue;
    queue.push({
      id: `scope-${change.id}`,
      type: "scope_change",
      phaseId: change.phaseId,
      priority: change.severity === "high" ? "critical" : change.severity === "medium" ? "high" : "medium",
      title: `Scope Change - ${change.phaseId} / ${change.fieldId}`,
      summary: change.reason || "Potential scope change detected",
      createdAt: getCreatedAt(change.detectedAt),
      actionLabel: "Review Change",
      dismissable: true,
      payload: change,
    });
  }

  for (const [phaseId] of Object.entries(phaseAgents || {})) {
    const patches = projectData?.phaseCompliancePatches?.[phaseId] ?? {};
    for (const [frameworkId, patch] of Object.entries(patches as Record<string, any>)) {
      if (!patch || patch?.acknowledged) continue;
      queue.push({
        id: `compliance-${phaseId}-${frameworkId}`,
        type: "draft_review",
        phaseId,
        priority: "high",
        title: `Compliance Controls - ${patch.frameworkLabel ?? frameworkId}`,
        summary: `${patch.gaps?.length ?? 0} gap(s) addressed · ready for review`,
        createdAt: getCreatedAt(patch.generatedAt),
        actionLabel: "Review Patch",
        dismissable: true,
        payload: {
          content: patch.content,
          type: "compliance_patch",
          frameworkId,
          frameworkLabel: patch.frameworkLabel ?? frameworkId,
          gaps: patch.gaps ?? [],
        },
      });
    }
  }

  for (const [phaseId, agent] of Object.entries(phaseAgents || {})) {
    const mitigation = projectData?.phasePreemptiveRiskMitigations?.[phaseId];
    const risks = (projectData?.phasePreemptiveRisks?.[phaseId] ?? []).filter((risk: any) => !risk?.dismissed);
    if (mitigation?.content && !mitigation?.dismissed && risks.length) {
      queue.push({
        id: `risk-mitigation-${phaseId}`,
        type: "risk_mitigation",
        phaseId,
        priority: risks.some((risk: any) => risk?.severity === "high") ? "high" : "medium",
        title: `Preemptive Risk Mitigation - ${phaseId}`,
        summary: `${risks.length} upstream risk(s) · mitigation plan ready`,
        createdAt: getCreatedAt(mitigation?.generatedAt),
        actionLabel: "Review Plan",
        dismissable: true,
        payload: { mitigation, risks, agentState: agent?.agentState ?? null },
      });
    }
  }

  for (const conflict of projectData?.agentConflicts ?? []) {
    if (!conflict || conflict.dismissed) continue;
    queue.push({
      id: `conflict-${conflict.id}`,
      type: "agent_conflict",
      phaseId: conflict.phaseA,
      priority: "critical",
      title: `Agent Conflict: ${conflict.phaseA} ↔ ${conflict.phaseB}`,
      summary: conflict.description,
      createdAt: getCreatedAt(conflict.detectedAt),
      actionLabel: `Open ${conflict.phaseA}`,
      dismissable: true,
      payload: conflict,
    });
  }

  const handoffSequence = Array.isArray(projectData?.adamPhaseSequence) && projectData.adamPhaseSequence.length
    ? projectData.adamPhaseSequence
    : ADAM_PHASE_SEQUENCE_FALLBACK;
  for (const [index, phaseId] of handoffSequence.entries()) {
    const handoff = projectData?.phaseHandoffs?.[phaseId];
    if (!handoff || handoff?.dismissed) continue;
    // Agent data sometimes omits toPhaseId or echoes the current phase; fall back
    // to the next phase in the sequence so the card never shows "→ undefined" or
    // a nonsensical self-handoff.
    const targetPhaseId = handoff.toPhaseId && handoff.toPhaseId !== phaseId
      ? handoff.toPhaseId
      : handoffSequence[index + 1];
    if (!targetPhaseId) continue;
    // A handoff only signals readiness when the upstream PHASE agent actually
    // completed with something to hand over. Program-level support agents
    // (daily-briefing, status-report, …) and empty runs emit a default handoff
    // with no artifacts or decisions; surfacing that as "Handoff Ready" tells a
    // PM the phase is done to move on when nothing has been produced — so skip
    // handoffs that lack a phase-agent origin or any readiness evidence.
    const handoffArtifactCount = Array.isArray(handoff.artifactIds)
      ? handoff.artifactIds.length
      : (handoff.approvedArtifactCount ?? 0);
    const handoffDecisionCount = Array.isArray(handoff.keyDecisions) ? handoff.keyDecisions.length : 0;
    const fromPhaseAgent = !handoff.fromAgentId || handoffSequence.includes(handoff.fromAgentId);
    if (!fromPhaseAgent || (handoffArtifactCount === 0 && handoffDecisionCount === 0)) continue;
    const nextPhaseGuidance = projectData?.phaseGuidance?.[targetPhaseId]?.fields ?? {};
    const nextPhaseStarted = Object.values(nextPhaseGuidance)
      .some((value: any) => typeof value === "string" && value.length > 5)
      || getCreatedAt(projectData?.phaseIncomingHandoffs?.[targetPhaseId]?.generatedAt) > getCreatedAt(handoff.generatedAt);
    if (nextPhaseStarted) continue;
    const handoffOpenRisks = handoff.openRiskCount ?? 0;
    queue.push({
      id: `handoff-${phaseId}`,
      type: "handoff_ready",
      phaseId,
      priority: "medium",
      title: `Handoff Ready: ${phaseId} → ${targetPhaseId}`,
      summary: `${handoffArtifactCount} artifact${handoffArtifactCount === 1 ? "" : "s"} · ${handoffOpenRisks} open risk(s)`,
      createdAt: getCreatedAt(handoff.generatedAt),
      actionLabel: `Open ${targetPhaseId}`,
      dismissable: true,
      payload: handoff,
    });
  }

  const escalateRisks = raidEntries.filter((risk: any) => (
    getRaidEntryType(risk) === "risk"
    && !isRaidEntryClosed(risk)
    && risk?.likelihood === "high"
    && risk?.impact === "high"
  ));
  if (escalateRisks.length) {
    queue.push({
      id: "risk-matrix-escalate",
      type: "risk_mitigation",
      phaseId: "riskmatrix",
      priority: "critical",
      title: `${escalateRisks.length} Risk${escalateRisks.length > 1 ? "s" : ""} - Escalate Quadrant`,
      summary: escalateRisks.slice(0, 2).map((risk: any) => risk.title).join(" · "),
      createdAt: getCreatedAt(escalateRisks[0]?.extractedAt),
      actionLabel: "Review Risks",
      dismissable: false,
      payload: { risks: escalateRisks, fromMatrix: true },
    });
  }

  const criticalBlockers = (projectData?._fragilityCache ?? []).filter((entry: any) => entry?.downstream >= 5);
  if (criticalBlockers.length) {
    queue.push({
      id: "fragility-alert",
      type: "risk_mitigation",
      phaseId: criticalBlockers[0]?.phaseId || "graph",
      priority: "high",
      title: `Critical Path Blocker - ${criticalBlockers[0]?.artifactId || "Artifact"}`,
      summary: `Blocks ${criticalBlockers[0]?.downstream ?? 0} downstream artifact(s) — approve or draft urgently`,
      createdAt: Date.now(),
      actionLabel: "Review Blockers",
      dismissable: false,
      payload: { blockers: criticalBlockers.slice(0, 3), fromFragility: true },
    });
  }

  const invalidatedHypotheses = (projectData?.hypothesisLog ?? [])
    .filter((hypothesis: any) => hypothesis?.status === "invalidated" && !hypothesis?.dismissed);
  if (invalidatedHypotheses.length) {
    queue.push({
      id: "hypothesis-invalidated",
      type: "hypothesis_alert",
      phaseId: "strategy",
      priority: "high",
      title: `${invalidatedHypotheses.length} Business Hypothesis${invalidatedHypotheses.length > 1 ? "es" : ""} Invalidated`,
      summary: invalidatedHypotheses.slice(0, 2).map((hypothesis: any) => hypothesis.statement).join(" · "),
      createdAt: getCreatedAt(invalidatedHypotheses[0]?.evidence?.slice(-1)?.[0]?.addedAt || invalidatedHypotheses[0]?.extractedAt),
      actionLabel: "Review Hypotheses",
      dismissable: true,
      payload: invalidatedHypotheses,
    });
  }

  const atRiskPhases = (projectData?.phaseGuidance
    ? Object.entries(projectData.phaseGuidance)
    : []).filter(([phaseId, phase]: any) => {
      if (!phase?.targetGateDate) return false;
      const forecast = (projectData?.completionForecast?.phases ?? []).find((entry: any) => entry?.phaseId === phaseId);
      return !!forecast?.atRisk;
    });
  if (atRiskPhases.length >= 2) {
    queue.push({
      id: "capacity-alert",
      type: "capacity_alert",
      phaseId: "capacity",
      priority: "high",
      title: `Capacity Alert - ${atRiskPhases.length} phases at risk`,
      summary: "Current team size may be insufficient to hit target gate dates",
      createdAt: Date.now(),
      actionLabel: "Open Capacity Plan",
      dismissable: true,
      payload: { atRiskPhases: atRiskPhases.map(([phaseId]) => phaseId) },
    });
  }

  queue.push(...buildSyntheticMilestoneSlipItems(projectData));
  queue.push(...buildSyntheticPlanActionItems(projectData));
  queue.push(...buildSyntheticInputCompletionItems(projectData));
  queue.push(...buildSyntheticArtifactBlockerItems(projectData));

  for (const persistedItem of (projectData?.decisionQueue ?? []) as any[]) {
    if (!persistedItem || persistedItem.status === "dismissed" || persistedItem.status === "resolved") continue;
    const type = (() => {
      switch (persistedItem.type) {
        case "gate-approval":
          return "gate_approval";
        case "pcr-review":
          return "change_request";
        case "retro-action":
          return "retro_ready";
        case "agent-review":
        case "agent_review":
          return "draft_review";
        default:
          return persistedItem.type;
      }
    })() as DecisionItemType;
    if (!type) continue;
    const persistedPriority: DecisionPriority = type === "milestone_slip"
      || type === "change_request"
      || type === "stakeholder_alert"
      || type === "benefit_alert"
      || type === "budget_alert"
      || type === "integration_conflict"
      || type === "data_governance_gap"
      || type === "critical_path_alert"
      || type === "escalation_raised"
      || type === "resource_alert"
      || type === "plan_action"
      || type === "artifacts_incomplete"
      ? "high"
      : type === "uat_ready"
        || type === "calendar_proposal"
        || type === "retro_ready"
        || type === "closure_ready"
        || type === "inputs_incomplete"
        ? "medium"
        : "info";
    const persistedActionLabel = (() => {
      switch (type) {
        case "uat_ready":
          return "Open Test Plan";
        case "milestone_slip":
          return "View Milestones";
        case "change_request":
          return "Open Change Register";
        case "stakeholder_alert":
          return "Open Stakeholders";
        case "benefit_alert":
          return "Open Benefits";
        case "calendar_proposal":
          return "Open Calendar";
        case "budget_alert":
          return "Open Budget";
        case "retro_ready":
          return "Open Retrospective";
        case "integration_conflict":
          return "Review Integration";
        case "critical_path_alert":
          return "View Critical Path";
        case "escalation_raised":
          return "Open Escalations";
        case "resource_alert":
          return "Open Resources";
        case "plan_action":
          return "Open workspace";
        case "inputs_incomplete":
          return "Complete inputs";
        case "artifacts_incomplete":
          return "Review artifacts";
        case "closure_ready":
          return "Open Closure";
        case "data_governance_gap":
          return "Open Data Dictionary";
        default:
          return "Open";
      }
    })();
    queue.push({
      id: persistedItem.id || `persisted-${Date.now()}`,
      type,
      phaseId: persistedItem.phaseId || persistedItem.phase || "portfolio",
      priority: persistedPriority,
      title: persistedItem.title || "Decision item",
      summary: persistedItem.body || persistedItem.summary || persistedItem.recommendation || persistedItem.question || "",
      artifactId: persistedItem.artifactId,
      createdAt: getCreatedAt(persistedItem.createdAt),
      actionLabel: persistedActionLabel,
      dismissable: true,
      payload: persistedItem.payload ?? persistedItem,
    });
  }

  const PRIORITY_ORDER: Record<DecisionPriority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    info: 3,
  };

  const persona = DECISION_QUEUE_PERSONAS[personaId as keyof typeof DECISION_QUEUE_PERSONAS]
    ?? DECISION_QUEUE_PERSONAS.all;
  const filtered = persona.types
    ? queue.filter((item) => {
      if (item.type === "critical_path_alert") {
        return personaId === "delivery_lead" || personaId === "architect" || personaId === "all";
      }
      if (item.type === "resource_alert") {
        return personaId === "delivery_lead" || personaId === "all";
      }
      if (item.type === "escalation_raised") {
        const escalation = item.payload?.escalation || item.payload || null;
        const currentRole = [
          { level: 1, role: "delivery_lead" },
          { level: 2, role: "executive" },
          { level: 3, role: "programme_board" },
        ].find((entry) => entry.level === Number(escalation?.currentLevel || 1))?.role;
        if (personaId === "all") return true;
        return currentRole === personaId;
      }
      return (persona.types as readonly string[]).includes(item.type);
    })
    : queue;

  return filtered.sort((left, right) => {
    const priorityDelta = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
    if (priorityDelta !== 0) return priorityDelta;
    return (right.createdAt ?? 0) - (left.createdAt ?? 0);
  });
}

export function getPhaseAgentBadge(
  phaseId: string,
  agentState: PhaseAgentState | null,
  projectData: any,
): { count: number; level: "critical" | "high" | "medium" | "none" } {
  let count = 0;
  let level: "critical" | "high" | "medium" | "none" = "none";

  if (agentState?.urgency?.level === "overdue" || agentState?.urgency?.level === "critical") {
    return { count: Math.max(count, 1), level: "critical" };
  }

  if (agentState?.escalated) {
    count += 1;
    level = "critical";
  }

  if (agentState?.running) {
    count += 1;
    if (level === "none") level = "medium";
  }

  const phaseArtifacts = projectData?.phaseArtifacts?.[phaseId] ?? {};
  const draftCount = Object.values(phaseArtifacts as Record<string, any>)
    .filter((artifact: any) => artifact?.agentDrafted && artifact?.status === "draft")
    .length;
  if (draftCount > 0) {
    count += draftCount;
    if (level === "none" || level === "medium") level = "high";
  }

  const questionCount = (projectData?.pendingAgentQuestions ?? [])
    .filter((question: any) => question?.phaseId === phaseId && !question?.applied)
    .length;
  if (questionCount > 0) {
    count += questionCount;
    if (level === "none" || level === "medium") level = "high";
  }

  const briefing = projectData?.phaseBriefings?.[phaseId];
  if (briefing?.content && !briefing?.stale && !briefing?.dismissed) {
    count += 1;
    if (level === "none") level = "medium";
  }

  return { count, level };
}
