/**
 * Sponsor briefs — the board pack, frozen and shareable. Minting captures a
 * dated SNAPSHOT of the derived numbers (never a live view: what the sponsor
 * opens is exactly what was sent, even as the programme moves on) plus a
 * secret token; the public flow-portal edge function serves it read-only to
 * whoever holds the link. Capped and attested like every other blob write.
 */
import type { ProgramSummary } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import {
  flowMovements, movementArtifacts, gateChecklist, gateReadiness,
  listenCoverage, demoAcceptance, daysToFirstDemo, wordsOfEvidence,
  readMovementInputs, parseGridRows,
} from "@/v3/components/flow/flowShellData";
import { readMetricRegistry } from "@/v3/components/flow/flowMetricRegistry";
import { listFlowAttestations, listOpenFlowDecisions } from "@/v3/components/flow/flowDecisions";

const BRIEF_CAP = 10;

export interface FlowBriefRecord {
  id: string;
  token: string;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function randomSecret(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The board pack's derived truth, serialised — same readers, frozen once. */
export function buildBriefSnapshot(program: ProgramSummary): Record<string, unknown> {
  const frame = readMovementInputs(program, "frame");
  const coverage = listenCoverage(program);
  const demos = demoAcceptance(program);
  const days = daysToFirstDemo(program);
  return {
    name: program.name,
    client: program.client ?? "",
    objective: String(frame.businessObjective ?? ""),
    sponsor: typeof frame.sponsor === "string" ? frame.sponsor : "",
    industry: typeof frame.industry === "string" ? frame.industry : "",
    daysToFirstDemo: days,
    numbers: {
      voicesHeard: coverage.done,
      voicesTotal: coverage.total,
      demosAccepted: demos.accepted,
      demosTotal: demos.total,
      words: wordsOfEvidence(program),
      waiting: listOpenFlowDecisions(program).length,
    },
    kpis: readMetricRegistry(program).map((kpi) => ({ name: kpi.name, baseline: kpi.baseline, target: kpi.target })),
    gates: flowMovements().map((movement) => {
      const artifacts = movementArtifacts(program, movement);
      const readiness = gateReadiness(program, movement, artifacts, gateChecklist(program, movement, artifacts));
      return { name: movement.displayName, tone: readiness.tone, headline: readiness.headline, detail: readiness.detail ?? "" };
    }),
    verdicts: demos.rows.map((row) => ({ stakeholder: row.stakeholder, verdict: row.verdict, reaction: row.reaction })),
    benefits: parseGridRows(readMovementInputs(program, "evolve").realisedBenefits),
    trail: listFlowAttestations(program).slice(0, 6).map((entry) => ({ action: entry.action, date: entry.ts })),
    builtAt: new Date().toISOString(),
  };
}

/** Mint a shareable brief. Returns the updated rawData blob, or null when
 * nothing changed. The fresh token rides the LAST entry of flowBriefs. */
export function mintBrief(program: ProgramSummary, actor: string): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const existing = Array.isArray(inner.flowBriefs) ? (inner.flowBriefs as unknown[]).filter(isRecord) : [];
  const now = new Date().toISOString();
  const brief: FlowBriefRecord = {
    id: `brief-${randomSecret().slice(0, 10)}`,
    token: randomSecret(),
    createdAt: now,
    snapshot: buildBriefSnapshot(program),
  };
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const attestation = {
    ts: now, agentId: actor, phaseId: "frame", tier: 2,
    action: "Shared a sponsor brief",
    detail: "A dated snapshot of the board pack — the link shows what was sent, not the live programme.",
  };
  return wrapProgramState(wrapper, {
    ...inner,
    flowBriefs: [...existing, brief].slice(-BRIEF_CAP),
    flowAttestations: [...log, attestation].slice(-200),
  }, usesNestedData);
}

export function briefLinkFor(programId: string, brief: { token: string }): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?flowBrief=${encodeURIComponent(`${programId}.${brief.token}`)}`;
}
