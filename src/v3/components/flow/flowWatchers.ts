/**
 * Watchers — the system noticing, deterministically.
 *
 * A watcher reads the record after it changes and, when a specific
 * correctable condition holds, QUEUES a Tier-2 decision — never applies
 * anything itself. Propose-then-confirm end to end: the proposal carries the
 * ready-to-merge payload, the Inbox card shows exactly what changes, and
 * resolveFlowDecision applies it on confirm.
 *
 * First watcher: unrostered voices. Attributed transcript evidence naming
 * people the coverage ledger doesn't know means coverage reads complete
 * while voices are on record unmapped.
 *
 * Proposal ids are content-derived (the sorted names), so the same finding
 * is never asked twice — a decline permanently retires that exact set.
 */
import type { ProgramSummary } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import { flowMovements, movementEvidence, parseGridRows, readMovementInputs } from "@/v3/components/flow/flowShellData";
import { listFlowDecisions } from "@/v3/components/flow/flowDecisions";

function djb2(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return hash.toString(16);
}

export interface WatcherProposal {
  id: string;
  tier: 2;
  status: "open";
  agentId: string;
  movementId: string;
  title: string;
  summary: string;
  blocking: string;
  recommendation: { action: string; rationale: string; band: string };
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Attributed voices on record that the Listen roster doesn't know.
 * Returns a ready-to-queue proposal, or null when there is nothing to say
 * (or when this exact finding was already proposed, whatever its outcome).
 */
export function unrosteredVoicesProposal(program: ProgramSummary): WatcherProposal | null {
  const listen = flowMovements().find((movement) => movement.id === "listen");
  if (!listen) return null;
  const roster = parseGridRows(readMovementInputs(program, "listen").interviewRoster);
  const known = new Set(roster.map((row) => String(row.name ?? "").trim().toLowerCase()).filter(Boolean));

  const additions: Array<{ name: string; role: string }> = [];
  const seen = new Set<string>();
  for (const entry of movementEvidence(program, listen)) {
    if (entry.kind !== "transcript" || entry.who === entry.fieldLabel) continue;
    // "Dan Reyes, RevOps Lead, 2026-07-14" → name + role; document refs excluded.
    if (/^document:/i.test(entry.who)) continue;
    const parts = entry.who.split(",").map((part) => part.trim());
    const name = parts[0] ?? "";
    if (!name || name.split(/\s+/).length > 4) continue;
    const key = name.toLowerCase();
    if (known.has(key) || seen.has(key)) continue;
    seen.add(key);
    additions.push({ name, role: parts[1] && !/^\d{4}-/.test(parts[1]) ? parts[1] : "" });
  }
  if (!additions.length) return null;

  const id = `watch-roster-${djb2(additions.map((a) => a.name.toLowerCase()).sort().join("|"))}`;
  if (listFlowDecisions(program).some((decision) => decision.id === id)) return null;

  const names = additions.map((a) => a.name).join(", ");
  return {
    id,
    tier: 2,
    status: "open",
    agentId: "voice-watcher",
    movementId: "listen",
    title: `Add ${additions.length} voice${additions.length === 1 ? "" : "s"} to the coverage ledger`,
    summary: `Attributed evidence on record from ${names} — the coverage ledger doesn't map ${additions.length === 1 ? "this voice" : "these voices"}.`,
    blocking: "Coverage reads complete while unmapped voices sit in the evidence.",
    recommendation: {
      action: "Add them to the roster",
      rationale: "Every voice the record quotes should be a row coverage can count — heard already, so they land as Heard.",
      band: "proposal — additive, roster rows only",
    },
    payload: { rosterAdditions: additions },
    createdAt: new Date().toISOString(),
  };
}

/**
 * Queue a watcher proposal into flowDecisions (idempotent on id), with the
 * attestation the trail expects. Returns the next raw blob, or null when the
 * proposal already exists — the caller's persist skips a no-op.
 */
export function queueWatcherProposal(program: ProgramSummary, proposal: WatcherProposal): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const list = Array.isArray(inner.flowDecisions) ? (inner.flowDecisions as unknown[]) : [];
  if (list.some((entry) => typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).id === proposal.id)) {
    return null;
  }
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  return wrapProgramState(wrapper, {
    ...inner,
    flowDecisions: [...list, proposal].slice(-40),
    flowAttestations: [...log, {
      ts: proposal.createdAt, agentId: proposal.agentId, phaseId: proposal.movementId, tier: 2,
      action: `Proposed: ${proposal.title}`, detail: proposal.summary.slice(0, 160),
    }].slice(-200),
  }, usesNestedData);
}
