import { generateId } from "@/lib/adamUtils";

export interface ProactiveNudge {
  id: string;
  type: "insight" | "warning" | "recommendation" | "celebration";
  message: string;
  actionLabel?: string;
  actionViewId?: string;
  priority: "low" | "medium" | "high";
  expiresAfterMs?: number;
}

type PhaseAgentSnapshot = {
  lastRanAt?: number | null;
  running?: boolean;
};

type ProgramLike = {
  id?: string;
  currentHealthScore?: number | null;
  decisionQueue?: Array<Record<string, unknown>>;
  phaseArtifacts?: Record<string, Record<string, Record<string, unknown>>>;
  phaseAgentStates?: Record<string, PhaseAgentSnapshot | null>;
  valueDelivered?: string | number | null;
  projectedValue?: string | number | null;
};

const MILESTONE_STORAGE_PREFIX = "adam_proactive_milestones_";
const PHASE_SEQUENCE = [
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

function parseNumberLike(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const numeric = Number(value.replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function getMarkerKey(programId: string): string {
  return `${MILESTONE_STORAGE_PREFIX}${programId}`;
}

function readMarkers(programId: string): string[] {
  if (!programId || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(getMarkerKey(programId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeMarkers(programId: string, markers: string[]): void {
  if (!programId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(getMarkerKey(programId), JSON.stringify(markers));
  } catch {
    // Ignore local storage failures for non-critical UX nudges.
  }
}

function pushMarker(programId: string, marker: string): void {
  const existing = new Set(readMarkers(programId));
  existing.add(marker);
  writeMarkers(programId, Array.from(existing));
}

function getPendingHighPriorityDecisions(programState: ProgramLike): Array<Record<string, unknown>> {
  return (programState.decisionQueue ?? []).filter((item) => {
    const status = String(item.status || "pending");
    const priority = String(item.priority || item.severity || "");
    return status !== "resolved" && status !== "dismissed" && (priority === "high" || priority === "critical");
  });
}

function getPhaseApprovalMilestone(programState: ProgramLike): { phaseId: string; approvedCount: number } | null {
  for (const phaseId of PHASE_SEQUENCE) {
    const artifacts = Object.values(programState.phaseArtifacts?.[phaseId] ?? {});
    const realArtifacts = artifacts.filter((artifact) => String(artifact.status || "blank") !== "blank");
    if (!realArtifacts.length) continue;
    const allApproved = realArtifacts.every((artifact) => artifact.status === "approved");
    if (allApproved) {
      return { phaseId, approvedCount: realArtifacts.length };
    }
  }
  return null;
}

function getIdleAgentPhase(programState: ProgramLike): string | null {
  const now = Date.now();
  for (const [phaseId, state] of Object.entries(programState.phaseAgentStates ?? {})) {
    if (!state?.lastRanAt || state.running) continue;
    if (now - state.lastRanAt > 30 * 60 * 1000) return phaseId;
  }
  return null;
}

export function evaluateProactiveNudges(programState: unknown): ProactiveNudge[] {
  const state = (programState ?? {}) as ProgramLike;
  const nudges: ProactiveNudge[] = [];
  const programId = state.id || "default";

  const healthScore = Number(state.currentHealthScore ?? 0);
  if (healthScore > 0 && healthScore < 60) {
    const pendingDecisions = getPendingHighPriorityDecisions(state).slice(0, 2);
    const blockerSummary = pendingDecisions.length
      ? pendingDecisions.map((item) => String(item.title || item.summary || "Decision pending")).join("; ")
      : "Critical blockers need attention before the next phase decision.";
    nudges.push({
      id: `readiness-warning-${programId}`,
      type: "warning",
      message: `Readiness has dropped below 60. ${blockerSummary}`,
      actionLabel: "Open decisions",
      actionViewId: "decisions",
      priority: "high",
      expiresAfterMs: 60 * 60 * 1000,
    });
  }

  const pendingHighPriority = getPendingHighPriorityDecisions(state);
  if (pendingHighPriority.length > 3) {
    nudges.push({
      id: `decision-backlog-${programId}`,
      type: "warning",
      message: `${pendingHighPriority.length} high-priority decisions are still unresolved. ATOS recommends a focused decision-clearing pass now.`,
      actionLabel: "Review queue",
      actionViewId: "decisions",
      priority: "high",
      expiresAfterMs: 45 * 60 * 1000,
    });
  }

  const idlePhase = getIdleAgentPhase(state);
  if (idlePhase) {
    nudges.push({
      id: `idle-agent-${programId}-${idlePhase}`,
      type: "recommendation",
      message: `The ${idlePhase} phase agent has been idle for more than 30 minutes. Re-run it now if this phase is still active.`,
      actionLabel: "Open workspace",
      actionViewId: idlePhase,
      priority: "medium",
      expiresAfterMs: 30 * 60 * 1000,
    });
  }

  const approvedPhase = getPhaseApprovalMilestone(state);
  if (approvedPhase) {
    const marker = `phase-approved-${approvedPhase.phaseId}`;
    if (!readMarkers(programId).includes(marker)) {
      pushMarker(programId, marker);
      nudges.push({
        id: `phase-approved-${programId}-${approvedPhase.phaseId}`,
        type: "celebration",
        message: `All active artifacts in ${approvedPhase.phaseId} are approved. This is a good moment to start gate review.`,
        actionLabel: "Open delivery",
        actionViewId: "delivery",
        priority: "medium",
        expiresAfterMs: 24 * 60 * 60 * 1000,
      });
    }
  }

  const deliveredValue = parseNumberLike(state.valueDelivered);
  const projectedValue = parseNumberLike(state.projectedValue);
  if (deliveredValue !== null && projectedValue && projectedValue > 0) {
    const progressPct = Math.round((deliveredValue / projectedValue) * 100);
    const milestone = [75, 50, 25].find((threshold) => progressPct >= threshold);
    if (milestone) {
      const marker = `value-${milestone}`;
      if (!readMarkers(programId).includes(marker)) {
        pushMarker(programId, marker);
        nudges.push({
          id: `value-milestone-${programId}-${milestone}`,
          type: "insight",
          message: `Value delivered has crossed ${milestone}% of the projected target. ATOS recommends capturing the drivers behind that progress while they are still fresh.`,
          actionLabel: "Review value",
          actionViewId: "valuerealize",
          priority: milestone >= 50 ? "high" : "medium",
          expiresAfterMs: 24 * 60 * 60 * 1000,
        });
      }
    }
  }

  return nudges.sort((left, right) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[left.priority] - priorityOrder[right.priority];
  }).map((nudge) => ({ ...nudge, id: nudge.id || generateId() }));
}
