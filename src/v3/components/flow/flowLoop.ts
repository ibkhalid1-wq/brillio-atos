/**
 * The Prototype Loop — Envision (Design) and Show (Validate) modelled as ONE
 * iterative cycle. `loopState` is the shared truth the rail's loop node and both
 * cockpits read: which iteration we're on, how many stakeholders approve,
 * whether the ball is in DESIGN's court (open change requests to address) or the
 * STAKEHOLDERS' court (awaiting verdicts), and whether the loop has CONVERGED —
 * the chosen gate: sponsor + majority accepted (open objections logged, not
 * blocking). Internally Design=envision and Validate=show remain the movement
 * units; this module couples them into the loop the operator experiences.
 */
import type { ProgramSummary } from "@/new/types";
import { demoAcceptance, readMovementInputs } from "@/v3/components/flow/flowShellData";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { sponsorStakeholder } from "@/v3/components/flow/flowStakeholders";

export type LoopCourt = "idle" | "design" | "stakeholders" | "converged";

export interface LoopState {
  /** Which build⇄show iteration the loop is on (1-based). */
  round: number;
  total: number;
  /** Strict "Accepted" (excludes "Accepted with changes"). */
  accepted: number;
  changes: number;
  objections: number;
  pending: number;
  sponsorAccepted: boolean;
  majority: boolean;
  /** The Ship gate: sponsor accepted AND a majority accepted. */
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

  const majority = total > 0 && accepted * 2 >= total;
  const hasPrototype = !!readArtifactDoc(program, "prototypeBuild");
  const round = Math.max(1, Math.round(Number(readMovementInputs(program, "show").iterationRound)) || 1);
  const openRequests = changes + objections;

  // Sponsor + majority is the gate; open objections are logged, not blocking.
  const converged = total > 0 && sponsorAccepted && majority;
  const court: LoopCourt = !hasPrototype
    ? "idle"
    : converged
      ? "converged"
      : openRequests > 0
        ? "design"
        : "stakeholders";

  return { round, total, accepted, changes, objections, pending, sponsorAccepted, majority, converged, hasPrototype, openRequests, court };
}

/** A stakeholder's demo verdict that asks for a change — the unit that flows
 * back from Validate (Show) into Design (Envision). */
export interface ChangeRequest {
  stakeholder: string;
  /** "Accepted with changes" | "Objection". */
  verdict: string;
  /** What they asked for — the reaction text on their demo row. */
  ask: string;
  blocking: boolean;
}

/** The open change requests the stakeholders raised on the current prototype —
 * Design's incoming work. Objections are blocking; "with changes" are not. */
export function changeRequests(program: ProgramSummary): ChangeRequest[] {
  return demoAcceptance(program).rows
    .filter((r) => /objection|with changes/i.test(r.verdict ?? ""))
    .map((r) => ({
      stakeholder: (r.stakeholder ?? "").trim() || "—",
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
  return `${s.accepted}/${s.total} approved — awaiting verdicts`;
}
