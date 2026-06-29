import { getMethodology, getPhaseDefinition, type MethodologyVariant } from "@/v3/lib/methodology";

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

export type RagStatus = "green" | "amber" | "red" | "grey";

/** Per-phase health the roadmap-health agent maintains on top of the schedule. */
export interface PhaseHealth {
  /** Actual completion 0–100. */
  progressPct?: number;
  rag?: RagStatus;
  /** Headline risk for the phase, if any. */
  risk?: string | null;
}

function unwrapInner(rawData: unknown): Record<string, unknown> {
  if (typeof rawData !== "object" || rawData === null) return {};
  const record = rawData as Record<string, unknown>;
  return "data" in record && typeof record.data === "object" && record.data !== null
    ? record.data as Record<string, unknown>
    : record;
}

/**
 * Pull agent-maintained per-phase health, keyed by phaseId. The roadmap-health
 * agent folds `phaseHealth` into the strategicRoadmap container; we fall back to
 * the legacy top-level `healthHeatmap.phaseHealth` for programs written before
 * that fold so older roadmaps still colour in.
 */
function readPhaseHealth(inner: Record<string, unknown>): Map<string, PhaseHealth> {
  const map = new Map<string, PhaseHealth>();
  const roadmap = typeof inner.strategicRoadmap === "object" && inner.strategicRoadmap !== null
    ? inner.strategicRoadmap as Record<string, unknown>
    : {};
  const heatmap = typeof inner.healthHeatmap === "object" && inner.healthHeatmap !== null
    ? inner.healthHeatmap as Record<string, unknown>
    : {};
  const source = Array.isArray(roadmap.phaseHealth)
    ? roadmap.phaseHealth
    : Array.isArray(heatmap.phaseHealth) ? heatmap.phaseHealth : [];
  for (const entry of source) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.phaseId === "string" ? e.phaseId : null;
    if (!id) continue;
    const rag = typeof e.rag === "string" && ["green", "amber", "red", "grey"].includes(e.rag)
      ? e.rag as RagStatus : undefined;
    const progressPct = typeof e.progressPct === "number" ? e.progressPct : undefined;
    const risk = typeof e.topRisk === "string" ? e.topRisk : (typeof e.risk === "string" ? e.risk : null);
    map.set(id, { progressPct, rag, risk });
  }
  return map;
}

/**
 * Artifact-completion progress per phase, for the client fallback before the
 * agent runs. When a phase defines required artifacts, progress is the completion
 * share of exactly that mandated set — approved is full credit, draft/stale
 * partial, a required artifact not yet generated counts as zero. Non-required
 * artifacts the agent happens to emit (e.g. a draft completion-estimate) neither
 * help nor dilute the score, so a phase whose mandated artifacts are all approved
 * reads 100%. Phases with no required set fall back to the generated-artifact mix.
 */
function readArtifactProgress(inner: Record<string, unknown>, phases: Array<{ id: string }>): Map<string, number> {
  const phaseArtifacts = typeof inner.phaseArtifacts === "object" && inner.phaseArtifacts !== null
    ? inner.phaseArtifacts as Record<string, unknown>
    : {};
  const creditFor = (status: string): number =>
    status === "approved" ? 1 : status === "stale" ? 0.4 : 0.5;
  const statusOf = (bucket: Record<string, unknown>, artifactId: string): string | null => {
    const val = bucket[artifactId];
    if (typeof val !== "object" || val === null) return null;
    return String((val as Record<string, unknown>).status ?? "draft");
  };
  const progress = new Map<string, number>();
  for (const p of phases) {
    const bucket = typeof phaseArtifacts[p.id] === "object" && phaseArtifacts[p.id] !== null
      ? phaseArtifacts[p.id] as Record<string, unknown>
      : {};
    const required = getPhaseDefinition(p.id)?.requiredArtifacts ?? [];
    if (required.length > 0) {
      let credit = 0;
      for (const artifactId of required) {
        const status = statusOf(bucket, artifactId);
        if (status === null || status === "archived") continue; // not generated yet → zero credit
        credit += creditFor(status);
      }
      progress.set(p.id, Math.round((credit / required.length) * 100));
      continue;
    }
    let credit = 0;
    let generated = 0;
    for (const [artifactId, val] of Object.entries(bucket)) {
      // Delivery Plan + Milestone Review are folded into the roadmap — not phase artifacts.
      if (artifactId === "plan" || artifactId === "milestone") continue;
      const status = typeof val === "object" && val !== null ? String((val as Record<string, unknown>).status ?? "draft") : "draft";
      if (status === "archived") continue;
      generated += 1;
      credit += creditFor(status);
    }
    progress.set(p.id, generated > 0 ? Math.round((credit / generated) * 100) : 0);
  }
  return progress;
}

/** Schedule-aware RAG when the agent hasn't supplied one (compares actual vs expected progress). */
function deriveRag(progressPct: number, startMs: number, endMs: number, todayMs: number): RagStatus {
  if (startMs > todayMs) return "grey";
  if (progressPct >= 100) return "green";
  if (todayMs > endMs) return "red";
  const expected = Math.max(0, Math.min(1, (todayMs - startMs) / Math.max(1, endMs - startMs))) * 100;
  const gap = expected - progressPct;
  if (gap <= 5) return "green";
  if (gap <= 20) return "amber";
  return "red";
}

/**
 * Build the strategic-roadmap timeline rows for a program: the deterministic
 * window split (programme start → target end, weighted by each phase's typical
 * duration) with any saved manual date edits (the top-level `roadmapSchedule`
 * override) winning per phase. Each row is enriched with agent-maintained health
 * (progress %, RAG, top risk), falling back to milestone-completion progress and
 * a schedule-vs-today RAG when the agent hasn't run yet. Shared by the
 * strategy-stage artifact preview and the Roadmap workspace.
 */
export function buildRoadmapRows(rawData: unknown, phases: Array<{ id: string; status?: string }>): GanttRow[] {
  const raw = unwrapInner(rawData);
  const phaseInputs = raw.phaseInputs;
  const strategyInputs = typeof phaseInputs === "object" && phaseInputs !== null
    ? (phaseInputs as Record<string, unknown>).strategy as Record<string, unknown> | undefined
    : undefined;
  const startDate = typeof strategyInputs?.startDate === "string" ? strategyInputs.startDate : undefined;
  const targetEndDate = typeof strategyInputs?.targetEndDate === "string" ? strategyInputs.targetEndDate : undefined;
  const weights = phases.map((p) => {
    const def = getPhaseDefinition(p.id);
    return { id: p.id, weight: def ? (def.typicalDurationWeeks.min + def.typicalDurationWeeks.max) / 2 : 1 };
  });
  const defaultsById = new Map(buildPhaseSchedule(startDate, targetEndDate, weights).map((d) => [d.id, d]));
  const overrideRaw = raw.roadmapSchedule;
  const overrides = typeof overrideRaw === "object" && overrideRaw !== null
    ? overrideRaw as Record<string, { start?: unknown; end?: unknown }>
    : {};
  const health = readPhaseHealth(raw);
  const artifactProgress = readArtifactProgress(raw, phases);
  const todayMs = parseUtcDay(new Date().toISOString().slice(0, 10)) ?? Date.now();
  const rows: GanttRow[] = [];
  for (const p of phases) {
    const ov = overrides[p.id];
    const def = defaultsById.get(p.id);
    const start = typeof ov?.start === "string" ? ov.start : def?.start;
    const end = typeof ov?.end === "string" ? ov.end : def?.end;
    if (!start || !end) continue;
    const h = health.get(p.id);
    // Progress tracks artifact completion deterministically — the share of the
    // phase's required artifacts that are approved. The agent-maintained
    // phaseHealth.progressPct is only a fallback when no artifacts exist yet, so
    // a stale/low agent estimate can't contradict what the ledger actually holds.
    const progressPct = artifactProgress.get(p.id) ?? h?.progressPct ?? 0;
    const startMs = parseUtcDay(start) ?? todayMs;
    const endMs = parseUtcDay(end) ?? todayMs;
    // A gate-approved (complete) phase is healthy by definition: the stakeholder
    // sign-off is authoritative and overrides a stale agent RAG/risk that may
    // predate the approval (e.g. a "gate reopened" note written before re-approval).
    const isComplete = p.status === "complete";
    const rag = isComplete ? "green" : (h?.rag ?? deriveRag(progressPct, startMs, endMs, todayMs));
    rows.push({
      id: p.id,
      name: getPhaseDefinition(p.id)?.displayName ?? p.id,
      start,
      end,
      progressPct,
      rag,
      risk: isComplete ? null : (h?.risk ?? null),
    });
  }
  return rows;
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
  /** Actual completion 0–100 (agent-maintained, or milestone-derived). */
  progressPct?: number;
  /** Health status (agent-maintained, or schedule-vs-today derived). */
  rag?: RagStatus;
  /** Headline risk for the phase, if any. */
  risk?: string | null;
}

/** A row positioned on the timeline as percentages of the chart's full width. */
export interface GanttBar extends GanttRow {
  offsetPct: number;
  widthPct: number;
  /** Where 'today' falls inside this phase's own window, 0–100; null when today is outside it. */
  expectedPct: number | null;
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

  const todayMs = parseUtcDay(new Date().toISOString().slice(0, 10));
  const bars: GanttBar[] = parsed.map(({ row, start, end }) => ({
    ...row,
    offsetPct: ((start - rangeStartMs) / totalMs) * 100,
    widthPct: ((end - start) / totalMs) * 100,
    expectedPct: todayMs !== null && todayMs >= start && todayMs <= end
      ? ((todayMs - start) / Math.max(1, end - start)) * 100
      : null,
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
