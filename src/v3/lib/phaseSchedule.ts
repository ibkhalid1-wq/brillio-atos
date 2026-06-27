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

// ── Gantt layout ─────────────────────────────────────────────────────────────

/** A named phase with concrete dates — the input row for a Gantt chart. */
export interface GanttRow {
  id: string;
  name: string;
  /** ISO yyyy-mm-dd. */
  start: string;
  /** ISO yyyy-mm-dd. */
  end: string;
}

/** A row positioned on the timeline as percentages of the chart's full width. */
export interface GanttBar extends GanttRow {
  offsetPct: number;
  widthPct: number;
}

/** A month gridline / axis label, positioned as a percentage of chart width. */
export interface GanttMonthTick {
  label: string;
  offsetPct: number;
}

export interface GanttLayout {
  bars: GanttBar[];
  /** Full timeline span (ISO yyyy-mm-dd), padded out to whole month boundaries. */
  rangeStart: string;
  rangeEnd: string;
  months: GanttMonthTick[];
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** First-of-month UTC epoch for the month containing `ms`. */
function startOfUtcMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** First-of-month UTC epoch for the month after the one containing `ms`. */
function startOfNextUtcMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/**
 * Position phase rows on a shared timeline. The visible span is padded out to
 * whole-month boundaries so the axis reads in clean months, and each bar's
 * offset/width are percentages of that span (so the chart is fully responsive —
 * no pixel math leaks into layout). Rows with unparseable or inverted dates are
 * dropped; returns null when nothing can be laid out.
 */
export function layoutGantt(rows: GanttRow[]): GanttLayout | null {
  const parsed = rows
    .map((row) => ({ row, start: parseUtcDay(row.start), end: parseUtcDay(row.end) }))
    .filter((r): r is { row: GanttRow; start: number; end: number } =>
      r.start !== null && r.end !== null && r.end > r.start);
  if (parsed.length === 0) return null;

  const minStart = Math.min(...parsed.map((r) => r.start));
  const maxEnd = Math.max(...parsed.map((r) => r.end));
  // Pad to month boundaries for a clean axis.
  const rangeStartMs = startOfUtcMonth(minStart);
  const rangeEndMs = startOfNextUtcMonth(maxEnd);
  const totalMs = rangeEndMs - rangeStartMs;
  if (totalMs <= 0) return null;

  const bars: GanttBar[] = parsed.map(({ row, start, end }) => ({
    ...row,
    offsetPct: ((start - rangeStartMs) / totalMs) * 100,
    widthPct: ((end - start) / totalMs) * 100,
  }));

  const months: GanttMonthTick[] = [];
  for (let m = rangeStartMs; m < rangeEndMs; m = startOfNextUtcMonth(m)) {
    const d = new Date(m);
    months.push({
      label: `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      offsetPct: ((m - rangeStartMs) / totalMs) * 100,
    });
  }

  return { bars, rangeStart: formatUtcDay(rangeStartMs), rangeEnd: formatUtcDay(rangeEndMs), months };
}

/** Add `days` to an ISO yyyy-mm-dd date, returning a new ISO date (UTC-safe). */
export function shiftIsoDate(date: string, days: number): string {
  const ms = parseUtcDay(date);
  if (ms === null) return date;
  return formatUtcDay(ms + days * DAY_MS);
}

/** Whole days between two ISO dates (b - a); 0 if either is unparseable. */
export function daysBetween(a: string, b: string): number {
  const ams = parseUtcDay(a);
  const bms = parseUtcDay(b);
  if (ams === null || bms === null) return 0;
  return Math.round((bms - ams) / DAY_MS);
}
