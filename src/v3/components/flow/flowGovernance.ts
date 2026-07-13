/**
 * Governance — the standing rules the fleet runs under, client side.
 *
 * rawData.flowGovernance holds the halt flags and per-movement token budgets
 * the run-agent edge enforces before any model call. Every change made here
 * appends a tier-2 HUMAN attestation, so the trail records who pulled which
 * lever — governance actions are as on-the-record as agent runs. Mutators are
 * pure blob transforms; callers persist via updateProgramData.
 */
import type { ProgramSummary } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import type { GateCheckItem } from "@/v3/components/flow/flowShellData";

/**
 * Gate-approval integrity (audit F-001, read-time defence).
 *
 * A recorded approval lives in the client-writable blob and — as the T6 probe
 * proved — can be forged by a direct API write with no readiness or approver
 * check. Server-side prevention is the real fix (see the gate-enforcement
 * migration); this is the read-time backstop: cross-check every recorded
 * approval against its OWN live criteria. An approval whose criteria are not
 * currently met is **indefensible** — the UI, board pack, and exports must not
 * present it as a legitimate gate, so a forgery can never masquerade as one.
 */
export interface GateApprovalIntegrity {
  approved: boolean;
  /** True only when every gate criterion is currently met. */
  defensible: boolean;
  unmet: number;
  reason?: string;
}

export function gateApprovalIntegrity(program: ProgramSummary, movementId: string, checks: GateCheckItem[]): GateApprovalIntegrity {
  const approved = program.gateReviews?.[movementId]?.status === "approved";
  if (!approved) return { approved: false, defensible: true, unmet: 0 };
  const unmet = checks.filter((c) => !c.done).length;
  return {
    approved: true,
    defensible: unmet === 0,
    unmet,
    reason: unmet ? `Recorded as approved, but ${unmet} gate criteri${unmet === 1 ? "on is" : "a are"} not met — not defensible` : undefined,
  };
}

export interface FlowGovernance {
  haltAll: boolean;
  haltedAgents: string[];
  /** movementId → token cap (absent/0 = uncapped). */
  movementBudgets: Record<string, number>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function innerData(program: ProgramSummary): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  return typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
}

export function readFlowGovernance(program: ProgramSummary): FlowGovernance {
  const raw = innerData(program).flowGovernance;
  const source = isRecord(raw) ? raw : {};
  const budgetsRaw = isRecord(source.movementBudgets) ? source.movementBudgets : {};
  const movementBudgets: Record<string, number> = {};
  for (const [movement, value] of Object.entries(budgetsRaw)) {
    const cap = Number(value);
    if (Number.isFinite(cap) && cap > 0) movementBudgets[movement] = cap;
  }
  return {
    haltAll: source.haltAll === true,
    haltedAgents: Array.isArray(source.haltedAgents) ? source.haltedAgents.map(String).filter(Boolean) : [],
    movementBudgets,
  };
}

/** Tier map mirror of the edge's flowAgentTier — 2 proposes, 1 acts. */
export function flowAgentTier(agentId: string): 1 | 2 | 3 {
  return agentId === "phase-input-planner" ? 2 : 1;
}

type GovernancePatch = Partial<{
  haltAll: boolean;
  haltedAgents: string[];
  movementBudgets: Record<string, number>;
}>;

function mutateGovernance(
  program: ProgramSummary,
  patch: GovernancePatch,
  attestation: { actor: string; action: string; detail?: string },
): Record<string, unknown> {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const current = isRecord(inner.flowGovernance) ? (inner.flowGovernance as Record<string, unknown>) : {};
  const nextGovernance: Record<string, unknown> = { ...current, ...patch };
  if (patch.movementBudgets) {
    const merged = { ...(isRecord(current.movementBudgets) ? current.movementBudgets : {}), ...patch.movementBudgets };
    // A zero cap means "remove the cap" — keep the stored object clean.
    for (const [movement, cap] of Object.entries(merged)) {
      if (!Number.isFinite(Number(cap)) || Number(cap) <= 0) delete merged[movement];
    }
    nextGovernance.movementBudgets = merged;
  }
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const entry = {
    ts: new Date().toISOString(),
    agentId: attestation.actor,
    phaseId: "governance",
    tier: 2,
    action: attestation.action,
    ...(attestation.detail ? { detail: attestation.detail } : {}),
  };
  return wrapProgramState(wrapper, {
    ...inner,
    flowGovernance: nextGovernance,
    flowAttestations: [...log, entry].slice(-200),
  }, usesNestedData);
}

export function setHaltAll(program: ProgramSummary, halted: boolean, actor: string): Record<string, unknown> {
  return mutateGovernance(program, { haltAll: halted }, {
    actor,
    action: halted ? "Halted the programme — every agent run blocks" : "Resumed the programme",
  });
}

export function toggleAgentHalt(program: ProgramSummary, agentId: string, halted: boolean, actor: string): Record<string, unknown> {
  const current = readFlowGovernance(program).haltedAgents;
  const next = halted ? [...new Set([...current, agentId])] : current.filter((id) => id !== agentId);
  return mutateGovernance(program, { haltedAgents: next }, {
    actor,
    action: halted ? `Halted ${agentId}` : `Resumed ${agentId}`,
  });
}

export function setMovementBudget(program: ProgramSummary, movementId: string, tokens: number, actor: string): Record<string, unknown> {
  return mutateGovernance(program, { movementBudgets: { [movementId]: tokens } }, {
    actor,
    action: tokens > 0
      ? `Set the ${movementId} budget to ${tokens.toLocaleString()} tokens`
      : `Removed the ${movementId} budget cap`,
  });
}
