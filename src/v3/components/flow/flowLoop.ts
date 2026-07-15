/**
 * The Prototype Loop — Envision (Design) and Show (Validate) modelled as ONE
 * iterative cycle, AREA-AWARE so parallel areas can converge independently.
 * `loopState` is the shared truth the rail node and both cockpits read: the
 * per-area breakdown, whose court the ball is in, and whether the loop has
 * CONVERGED — the chosen gate: EVERY AREA signs off (a majority of its voices
 * accept, none pending) AND the sponsor accepts. Lone objections inside an
 * otherwise-accepted area are logged, not blocking. Internally Design=envision
 * and Validate=show remain the movement units; this module couples them.
 */
import type { ProgramSummary } from "@/new/types";
import { demoAcceptance, readMovementInputs } from "@/v3/components/flow/flowShellData";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { sponsorStakeholder } from "@/v3/components/flow/flowStakeholders";
import { stakeholderPrimaryArea, GENERAL_AREA } from "@/v3/components/flow/flowAreas";

export type LoopCourt = "idle" | "design" | "stakeholders" | "converged";

/** One area's slice of the loop — how its own voices have landed. */
export interface AreaLoop {
  area: string;
  total: number;
  accepted: number;
  changes: number;
  objections: number;
  pending: number;
  /** The area has signed off: everyone weighed in and a majority accepted. */
  converged: boolean;
}

export interface LoopState {
  /** Which build⇄show iteration the programme is on (1-based). */
  round: number;
  /** Per-area breakdown — parallel areas converge on their own. */
  areas: AreaLoop[];
  total: number;
  /** Strict "Accepted" (excludes "Accepted with changes"). */
  accepted: number;
  changes: number;
  objections: number;
  pending: number;
  sponsorAccepted: boolean;
  /** Areas that have signed off / total areas with voices. */
  areasConverged: number;
  areasTotal: number;
  /** The Ship gate: every area signed off AND the sponsor accepted. */
  converged: boolean;
  hasPrototype: boolean;
  /** Change requests still open for Design to address (changes + objections). */
  openRequests: number;
  court: LoopCourt;
}

const isStrictAccepted = (v?: string): boolean => !!v && /accepted/i.test(v) && !/with changes/i.test(v);

export function loopState(program: ProgramSummary): LoopState {
  const tour = demoAcceptance(program);
  const rows = tour.rows;

  // Roll each demo verdict up to its stakeholder's area, so areas converge
  // independently — Adjudication can be signed off while Operations still iterates.
  const byArea = new Map<string, { total: number; accepted: number; changes: number; objections: number; pending: number }>();
  for (const r of rows) {
    const area = stakeholderPrimaryArea(program, String(r.stakeholder ?? "").trim()) || GENERAL_AREA;
    const b = byArea.get(area) ?? { total: 0, accepted: 0, changes: 0, objections: 0, pending: 0 };
    b.total += 1;
    if (isStrictAccepted(r.verdict)) b.accepted += 1;
    else if (/with changes/i.test(r.verdict ?? "")) b.changes += 1;
    else if (/objection/i.test(r.verdict ?? "")) b.objections += 1;
    else b.pending += 1;
    byArea.set(area, b);
  }
  const areas: AreaLoop[] = [...byArea.entries()]
    .map(([area, b]) => ({ area, ...b, converged: b.total > 0 && b.pending === 0 && b.accepted * 2 >= b.total }))
    .sort((a, b) => (a.area === GENERAL_AREA ? 1 : b.area === GENERAL_AREA ? -1 : a.area.localeCompare(b.area)));

  const total = tour.total;
  const accepted = rows.filter((r) => isStrictAccepted(r.verdict)).length;
  const changes = rows.filter((r) => /with changes/i.test(r.verdict ?? "")).length;
  const objections = rows.filter((r) => /objection/i.test(r.verdict ?? "")).length;
  const pending = rows.filter((r) => !r.verdict || /pending/i.test(r.verdict ?? "")).length;

  const sponsor = sponsorStakeholder(program);
  const sponsorRow = sponsor
    ? rows.find((r) => (r.stakeholder ?? "").trim().toLowerCase() === sponsor.name.trim().toLowerCase())
    : undefined;
  const sponsorAccepted = sponsorRow ? isStrictAccepted(sponsorRow.verdict) : false;

  const areasConverged = areas.filter((a) => a.converged).length;
  const areasTotal = areas.length;
  const hasPrototype = !!readArtifactDoc(program, "prototypeBuild");
  const round = Math.max(1, Math.round(Number(readMovementInputs(program, "show").iterationRound)) || 1);
  const openRequests = changes + objections;

  // Every area signs off + sponsor — the chosen gate. Objections inside an
  // accepted area are logged, not blocking.
  const converged = areasTotal > 0 && areasConverged === areasTotal && sponsorAccepted;
  const court: LoopCourt = !hasPrototype
    ? "idle"
    : converged
      ? "converged"
      : openRequests > 0
        ? "design"
        : "stakeholders";

  return { round, areas, total, accepted, changes, objections, pending, sponsorAccepted, areasConverged, areasTotal, converged, hasPrototype, openRequests, court };
}

/** A stakeholder's demo verdict that asks for a change — the unit that flows
 * back from Validate (Show) into Design (Envision), tagged to its area. */
export interface ChangeRequest {
  stakeholder: string;
  area: string;
  /** "Accepted with changes" | "Objection". */
  verdict: string;
  /** What they asked for — the reaction text on their demo row. */
  ask: string;
  blocking: boolean;
}

/** The open change requests the stakeholders raised on the current prototype —
 * Design's incoming work, area-tagged so it routes to the right workspace slice.
 * Objections are blocking; "with changes" are not. */
export function changeRequests(program: ProgramSummary): ChangeRequest[] {
  return demoAcceptance(program).rows
    .filter((r) => /objection|with changes/i.test(r.verdict ?? ""))
    .map((r) => ({
      stakeholder: (r.stakeholder ?? "").trim() || "—",
      area: stakeholderPrimaryArea(program, String(r.stakeholder ?? "").trim()) || GENERAL_AREA,
      verdict: r.verdict ?? "",
      ask: (r.reaction ?? "").trim(),
      blocking: /objection/i.test(r.verdict ?? ""),
    }));
}

/** One-line status for the loop node / headers. */
export function loopHeadline(s: LoopState): string {
  if (!s.total && !s.hasPrototype) return "Design the prototype";
  if (!s.hasPrototype) return "Build the prototype to start validating";
  if (s.converged) return "Approved — ready to ship";
  if (s.court === "design") return `${s.openRequests} change${s.openRequests === 1 ? "" : "s"} to fold into the design`;
  return `${s.areasConverged}/${s.areasTotal} areas signed off — awaiting verdicts`;
}
