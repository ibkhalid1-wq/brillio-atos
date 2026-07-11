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
    summary: `${names} ${additions.length === 1 ? "is" : "are"} quoted in the evidence but not on the roster.`,
    blocking: "Coverage looks complete while people who spoke are missing from the list.",
    recommendation: {
      action: "Add them to the roster",
      rationale: "Everyone quoted in the evidence should be counted — they have spoken already, so they join as Heard.",
      band: "proposal — additive, roster rows only",
    },
    payload: { rosterAdditions: additions },
    createdAt: new Date().toISOString(),
  };
}

/**
 * Rework verdicts with no live re-invite: the iterate-until-approval engine.
 * When a stakeholder said "needs rework", their change asks are on the
 * record and no unanswered demo link is waiting on them, propose fresh
 * links — one confirm re-opens the loop until they accept.
 */
export function reDemoProposal(program: ProgramSummary): WatcherProposal | null {
  const inner = ((program.rawData ?? {}) as Record<string, unknown>);
  const root = typeof inner.data === "object" && inner.data !== null ? (inner.data as Record<string, unknown>) : inner;
  const doc = root.demoScripts;
  const scripts = doc && typeof doc === "object" && !Array.isArray(doc) && Array.isArray((doc as Record<string, unknown>).scripts)
    ? ((doc as Record<string, unknown>).scripts as unknown[]).filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    : [];
  if (!scripts.length) return null;
  const scripted = new Set(scripts.map((script) => String(script.stakeholder ?? "").trim().toLowerCase()));

  const tour = parseGridRows(readMovementInputs(program, "show").demoTour);
  const invites = Array.isArray(root.flowDemoInvites) ? (root.flowDemoInvites as unknown[]) : [];
  const waitingOn = new Set(invites
    .filter((invite): invite is Record<string, unknown> => typeof invite === "object" && invite !== null)
    .filter((invite) => typeof invite.respondedAt !== "string")
    .map((invite) => String(invite.stakeholder ?? "").trim().toLowerCase()));

  const names = [...new Set(tour
    .filter((row) => /rework|not yet/i.test(row.verdict ?? ""))
    .map((row) => String(row.stakeholder ?? "").trim())
    .filter((name) => name
      && scripted.has(name.toLowerCase())
      && !waitingOn.has(name.toLowerCase())))];
  if (!names.length) return null;

  const id = `watch-redemo-${djb2(names.map((name) => name.toLowerCase()).sort().join("|"))}`;
  if (listFlowDecisions(program).some((decision) => decision.id === id)) return null;

  return {
    id,
    tier: 2,
    status: "open",
    agentId: "redemo-watcher",
    movementId: "show",
    title: `Invite ${names.length} stakeholder${names.length === 1 ? "" : "s"} to re-demonstrate`,
    summary: `${names.join(", ")} said "needs rework" and no new demo link is waiting on them.`,
    blocking: "Show cannot reach every-stakeholder-accepted while a rework verdict has no road back to the room.",
    recommendation: {
      action: "Send fresh demo links",
      rationale: "Their change asks are on the record — a fresh link against the current build lets them re-judge it.",
      band: "proposal — old unanswered links retire, fresh ones mint",
    },
    payload: { reDemoStakeholders: names },
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
