import { getMethodology, type MethodologyVariant } from "@/v3/lib/methodology";

/**
 * Deterministic phase scheduling. The strategic-roadmap agent was asked to both
 * "distribute the phases across the window" and "mark unknown dates 'TBD'" — a
 * self-contradiction that left every intermediate phase boundary as TBD even
 * though the programme's start and target-end dates are known. Splitting a fixed
 * window across an ordered phase list is pure arithmetic, not a judgement call,
 * so we compute it on the client and stop asking the model to guess.
 */

export interface PhaseWeight {
  id: string;
  /** Relative share of the total window this phase occupies. */
  weight: number;
}

export interface ScheduledPhase {
  id: string;
  /** ISO yyyy-mm-dd. */
  start: string;
  /** ISO yyyy-mm-dd. */
  end: string;
}

const DAY_MS = 86_400_000;

/** Parse a yyyy-mm-dd (or ISO) date as a UTC midnight epoch, or null if invalid. */
function parseUtcDay(value: string | undefined | null): number | null {
  if (!value || typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(ms) ? null : ms;
}

function formatUtcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Split the [startDate, targetEndDate] window across `phases` in order, each
 * phase taking a contiguous slice sized by its relative weight. The first phase
 * starts on startDate, the last ends exactly on targetEndDate (rounding drift is
 * absorbed by the final boundary), and adjacent phases share a boundary day.
 * Returns [] when the inputs can't yield a sane schedule.
 */
export function buildPhaseSchedule(
  startDate: string | undefined | null,
  targetEndDate: string | undefined | null,
  phases: PhaseWeight[],
): ScheduledPhase[] {
  const startMs = parseUtcDay(startDate);
  const endMs = parseUtcDay(targetEndDate);
  if (startMs === null || endMs === null) return [];
  if (endMs <= startMs) return [];
  if (phases.length === 0) return [];

  // Clamp weights to non-negative; fall back to equal weighting if the total is
  // not positive (e.g. all zero/negative).
  const weights = phases.map((p) => (Number.isFinite(p.weight) && p.weight > 0 ? p.weight : 0));
  let totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let shares = weights;
  if (totalWeight <= 0) {
    shares = phases.map(() => 1);
    totalWeight = phases.length;
  }

  const totalMs = endMs - startMs;
  const result: ScheduledPhase[] = [];
  let cursor = startMs;
  let accWeight = 0;

  for (let i = 0; i < phases.length; i++) {
    accWeight += shares[i];
    const isLast = i === phases.length - 1;
    // Anchor each boundary off the cumulative weight (not incremental sums) so
    // rounding never accumulates; snap the very last boundary to targetEndDate.
    const boundary = isLast ? endMs : startMs + Math.round((totalMs * accWeight) / totalWeight / DAY_MS) * DAY_MS;
    const end = Math.max(boundary, cursor);
    result.push({ id: phases[i].id, start: formatUtcDay(cursor), end: formatUtcDay(end) });
    cursor = end;
  }

  return result;
}

/**
 * Convenience: schedule the methodology's phases, weighting each by the midpoint
 * of its `typicalDurationWeeks`. Keeps the duration model in the registry rather
 * than duplicating it at the call site.
 */
export function buildMethodologyPhaseSchedule(
  startDate: string | undefined | null,
  targetEndDate: string | undefined | null,
  variant: MethodologyVariant = "atos-lite",
): ScheduledPhase[] {
  const phases = getMethodology(variant).phases.map((phase) => ({
    id: phase.id,
    weight: (phase.typicalDurationWeeks.min + phase.typicalDurationWeeks.max) / 2,
  }));
  return buildPhaseSchedule(startDate, targetEndDate, phases);
}
