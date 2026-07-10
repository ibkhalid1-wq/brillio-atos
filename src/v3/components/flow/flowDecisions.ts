/**
 * Decisions & attestations — the Command Deck's spine, client side.
 *
 * The run-agent edge writes open Tier-2/3 DECISIONS (rawData.flowDecisions)
 * instead of silently applying consequential results on Flow programmes, and
 * appends an ATTESTATION entry (rawData.flowAttestations) for every applied
 * run. This module reads both, derives the "next moments" agenda, and builds
 * the full next-data blob a confirm/decline writes back (the resolver is pure —
 * the caller persists via updateProgramData, the app's standard write path).
 */
import type { ProgramSummary } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import { readMovementInputs, parseGridRows } from "@/v3/components/flow/flowShellData";

export interface FlowDecision {
  id: string;
  tier: 2 | 3;
  status: "open" | "confirmed" | "declined";
  agentId: string;
  movementId: string;
  title: string;
  summary: string;
  blocking: string;
  recommendation: { action: string; rationale: string; band: string } | null;
  /** Ready-to-merge payload the edge prepared (e.g. { dynamicSchema }). */
  payload: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface FlowAttestation {
  ts: string;
  agentId: string;
  phaseId: string;
  tier: 1 | 2 | 3;
  action: string;
  detail?: string;
}

export interface NextMoment {
  date: string;
  label: string;
  kind: "demo" | "session" | "target";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function innerData(program: ProgramSummary): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  return typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
}

export function listFlowDecisions(program: ProgramSummary): FlowDecision[] {
  const list = innerData(program).flowDecisions;
  if (!Array.isArray(list)) return [];
  return list.filter(isRecord).map((entry): FlowDecision => ({
    id: String(entry.id ?? ""),
    tier: entry.tier === 3 ? 3 : 2,
    status: entry.status === "confirmed" || entry.status === "declined" ? entry.status : "open",
    agentId: String(entry.agentId ?? "agent"),
    movementId: String(entry.movementId ?? ""),
    title: String(entry.title ?? "Decision"),
    summary: String(entry.summary ?? ""),
    blocking: String(entry.blocking ?? ""),
    recommendation: isRecord(entry.recommendation)
      ? {
          action: String(entry.recommendation.action ?? ""),
          rationale: String(entry.recommendation.rationale ?? ""),
          band: String(entry.recommendation.band ?? ""),
        }
      : null,
    payload: isRecord(entry.payload) ? entry.payload : null,
    createdAt: String(entry.createdAt ?? ""),
    resolvedAt: typeof entry.resolvedAt === "string" ? entry.resolvedAt : undefined,
    resolvedBy: typeof entry.resolvedBy === "string" ? entry.resolvedBy : undefined,
  })).filter((decision) => decision.id);
}

export function listOpenFlowDecisions(program: ProgramSummary): FlowDecision[] {
  return listFlowDecisions(program).filter((decision) => decision.status === "open");
}

export function listFlowAttestations(program: ProgramSummary): FlowAttestation[] {
  const list = innerData(program).flowAttestations;
  if (!Array.isArray(list)) return [];
  return list.filter(isRecord).map((entry): FlowAttestation => ({
    ts: String(entry.ts ?? ""),
    agentId: String(entry.agentId ?? "agent"),
    phaseId: String(entry.phaseId ?? ""),
    tier: entry.tier === 3 ? 3 : entry.tier === 2 ? 2 : 1,
    action: String(entry.action ?? ""),
    detail: typeof entry.detail === "string" ? entry.detail : undefined,
  })).filter((entry) => entry.ts).reverse(); // newest first
}

/**
 * Resolve a decision and return the FULL next data blob to persist via
 * updateProgramData. Confirming merges the edge-prepared payload (per-phase
 * dynamicSchema entries) additively; declining only marks the record. Both
 * append their own attestation — human resolutions are on the record too.
 */
export function resolveFlowDecision(
  program: ProgramSummary,
  decisionId: string,
  resolution: "confirmed" | "declined",
  resolvedBy: string,
): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const list = Array.isArray(inner.flowDecisions) ? (inner.flowDecisions as unknown[]) : [];
  const target = list.filter(isRecord).find((entry) => entry.id === decisionId);
  if (!target || (target.status !== "open" && target.status !== undefined)) return null;

  const now = new Date().toISOString();
  const nextDecisions = list.map((entry) =>
    isRecord(entry) && entry.id === decisionId
      ? { ...entry, status: resolution, resolvedAt: now, resolvedBy }
      : entry,
  );

  let nextInner: Record<string, unknown> = { ...inner, flowDecisions: nextDecisions };

  // Apply the prepared payload on confirm. dynamicSchema merges per top-level
  // section, per phase — additive, never clobbering other phases' entries.
  const payload = isRecord(target.payload) ? target.payload : null;
  if (resolution === "confirmed" && payload && isRecord(payload.dynamicSchema)) {
    const incoming = payload.dynamicSchema as Record<string, unknown>;
    const current = isRecord(nextInner.dynamicSchema) ? (nextInner.dynamicSchema as Record<string, unknown>) : {};
    const merged: Record<string, unknown> = { ...current };
    for (const [section, value] of Object.entries(incoming)) {
      merged[section] = isRecord(value) && isRecord(current[section])
        ? { ...(current[section] as Record<string, unknown>), ...value }
        : value;
    }
    nextInner.dynamicSchema = merged;
  }

  // Track plans merge by id: new tracks append, existing ones keep their
  // show/refine record (a re-adopted plan must never erase demonstrations).
  if (resolution === "confirmed" && payload && Array.isArray(payload.tracks)) {
    const current = Array.isArray(nextInner.tracks) ? (nextInner.tracks as unknown[]) : [];
    const currentIds = new Set(current.filter(isRecord).map((t) => String(t.id ?? "")));
    const additions = payload.tracks.filter(isRecord).filter((t) => t.id && !currentIds.has(String(t.id)));
    if (additions.length) nextInner = { ...nextInner, tracks: [...current, ...additions].slice(-24) };
  }

  // Governance payloads (e.g. the cap-raise the budget gate queues) merge
  // shallowly, with movement budgets folded per movement.
  if (resolution === "confirmed" && payload && isRecord(payload.flowGovernance)) {
    const incoming = payload.flowGovernance as Record<string, unknown>;
    const current = isRecord(nextInner.flowGovernance) ? (nextInner.flowGovernance as Record<string, unknown>) : {};
    const budgets = {
      ...(isRecord(current.movementBudgets) ? current.movementBudgets : {}),
      ...(isRecord(incoming.movementBudgets) ? incoming.movementBudgets : {}),
    };
    nextInner = { ...nextInner, flowGovernance: { ...current, ...incoming, movementBudgets: budgets } };
  }

  const attestation = {
    ts: now,
    agentId: resolvedBy,
    phaseId: String(target.movementId ?? ""),
    tier: target.tier === 3 ? 3 : 2,
    action: `${resolution === "confirmed" ? "Confirmed" : "Declined"}: ${String(target.title ?? "decision")}`,
  };
  const log = Array.isArray(nextInner.flowAttestations) ? (nextInner.flowAttestations as unknown[]) : [];
  nextInner = { ...nextInner, flowAttestations: [...log, attestation].slice(-200) };

  return wrapProgramState(wrapper, nextInner, usesNestedData);
}

/** The human moments ahead: booked sessions, pending demos, the demo target. */
export function listNextMoments(program: ProgramSummary): NextMoment[] {
  const moments: NextMoment[] = [];
  const frame = readMovementInputs(program, "frame");
  if (typeof frame.targetFirstDemoDate === "string" && frame.targetFirstDemoDate) {
    moments.push({ date: frame.targetFirstDemoDate, label: "First-demonstration target", kind: "target" });
  }
  for (const row of parseGridRows(readMovementInputs(program, "listen").interviewRoster)) {
    if (/booked/i.test(row.status ?? "") && row.date) {
      moments.push({ date: row.date, label: `${row.name || "Stakeholder"} — discovery session`, kind: "session" });
    }
  }
  for (const row of parseGridRows(readMovementInputs(program, "show").demoTour)) {
    if (/pending/i.test(row.verdict ?? "Pending") && row.date) {
      moments.push({ date: row.date, label: `${row.stakeholder || "Stakeholder"} — demonstration`, kind: "demo" });
    }
  }
  return moments.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
}
