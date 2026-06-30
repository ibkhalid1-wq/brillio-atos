import { getMethodology, getPhaseDefinition, type MethodologyVariant } from "@/v3/lib/methodology";
import { dynamicArtifactDefs, getDynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import { FORMAL_ARTIFACT_PHASES } from "@/v3/lib/formalArtifacts";

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
  const store = getDynamicSchemaStore(inner);
  const progress = new Map<string, number>();
  for (const p of phases) {
    const bucket = typeof phaseArtifacts[p.id] === "object" && phaseArtifacts[p.id] !== null
      ? phaseArtifacts[p.id] as Record<string, unknown>
      : {};
    const required = getPhaseDefinition(p.id)?.requiredArtifacts ?? [];
    // Progress is completion against the phase's *expected* deliverables: its
    // required artifacts plus any the planner declared for it (deduped, canonical).
    // Measuring against the expected set — not whatever happens to be in the
    // bucket — means ungenerated deliverables score zero and stray program-level
    // agent outputs bucketed under a phase id (e.g. an "adoption" draft written
    // into the locked Operate phase) can't inflate the bar.
    const expected = Array.from(new Set([
      ...required,
      ...dynamicArtifactDefs(p.id, store).map((d) => d.id),
    ]));
    if (expected.length === 0) {
      progress.set(p.id, 0);
      continue;
    }
    let credit = 0;
    for (const artifactId of expected) {
      const status = statusOf(bucket, artifactId);
      if (status === null || status === "archived") continue; // not generated yet → zero credit
      credit += creditFor(status);
    }
    progress.set(p.id, Math.round((credit / expected.length) * 100));
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
    const startMs = parseUtcDay(start) ?? todayMs;
    const endMs = parseUtcDay(end) ?? todayMs;
    // A gate-approved (complete) phase is healthy and done by definition: the
    // stakeholder sign-off is authoritative and overrides a stale agent RAG/risk
    // (e.g. a "gate reopened" note written before re-approval).
    const isComplete = p.status === "complete";
    // A phase the programme hasn't reached yet (status "inactive") can't be at
    // risk or blocked now: the health agent sometimes grades a future phase red
    // (e.g. "Adoption Plan not approved" against a not-yet-started Operate), so
    // its RAG/risk must not present a future concern as a live one. Such phases
    // read grey ("not started") regardless of the agent estimate.
    const notStarted = p.status === "inactive";
    // Progress reads from the gate first: an approved gate means the phase is
    // 100% complete regardless of how many of its artifacts the ledger happens
    // to mark "approved" (a single stale/draft artifact must not make a
    // signed-off phase read 83%). Otherwise it tracks artifact completion
    // deterministically, with the agent estimate only as a last-resort fallback.
    const progressPct = isComplete ? 100 : (artifactProgress.get(p.id) ?? h?.progressPct ?? 0);
    const rag = isComplete ? "green" : notStarted ? "grey" : (h?.rag ?? deriveRag(progressPct, startMs, endMs, todayMs));
    rows.push({
      id: p.id,
      name: getPhaseDefinition(p.id)?.displayName ?? p.id,
      start,
      end,
      progressPct,
      rag,
      risk: (isComplete || notStarted) ? null : (h?.risk ?? null),
    });
  }
  return rows;
}

/**
 * Schedule adherence 0–100 (or null when there is no usable schedule), measuring
 * whether work is keeping pace with the planned phase windows. This is the
 * dedicated "are we on time?" signal the confidence model was missing — gate
 * readiness and milestone health speak to *quality* and *risk*, but neither
 * penalises a phase that is simply running late against its own plan.
 *
 * Only in-flight phases are judged: a phase that hasn't started yet can't be
 * behind, and a phase already at 100% can't drag the score. For each in-flight
 * phase we compare actual progress to the progress its elapsed-time fraction
 * implies (today's position in its window) and credit `min(1, actual/expected)`
 * — fully on or ahead of pace scores 100, half the expected progress scores 50.
 * Returns null when no phase has parseable dates (so the caller can fall back to
 * a neutral default rather than tank the score on programmes with no roadmap).
 */
export interface ScheduleAdherence {
  /** 0–100 adherence, or null when there is no usable schedule. */
  score: number | null;
  /** Count of in-flight phases trailing their planned pace (actual < expected). */
  phasesBehind: number;
  /** Count of in-flight phases judged (started, not yet complete). */
  inFlight: number;
}

/**
 * Detailed schedule adherence: the 0–100 score AND the count of in-flight phases
 * actually behind pace. The confidence breakdown surfaces the count ("N in-flight
 * phase(s) are behind their planned pace") — without it the explanation could only
 * restate the percentage, so the human-readable reason is derived here from the
 * same per-phase comparison that drives the score (they can never disagree).
 */
export function computeScheduleAdherenceDetail(
  rawData: unknown,
  phases: Array<{ id: string; status?: string }>,
): ScheduleAdherence {
  const rows = buildRoadmapRows(rawData, phases);
  if (rows.length === 0) return { score: null, phasesBehind: 0, inFlight: 0 };
  const todayMs = parseUtcDay(new Date().toISOString().slice(0, 10)) ?? Date.now();
  const inFlight = rows.filter((r) => {
    const startMs = parseUtcDay(r.start);
    if (startMs === null) return false;
    if (startMs > todayMs) return false; // not started → can't be behind
    return (r.progressPct ?? 0) < 100; // already complete → not dragging pace
  });
  if (inFlight.length === 0) return { score: 100, phasesBehind: 0, inFlight: 0 }; // nothing in-flight is behind
  let phasesBehind = 0;
  const sum = inFlight.reduce((acc, r) => {
    const startMs = parseUtcDay(r.start)!;
    const endMs = parseUtcDay(r.end) ?? startMs;
    const expected = Math.max(0, Math.min(1, (todayMs - startMs) / Math.max(1, endMs - startMs)));
    const actual = Math.max(0, Math.min(1, (r.progressPct ?? 0) / 100));
    if (expected <= 0) return acc + 1; // window just opened → on pace by default
    const ratio = Math.max(0, Math.min(1, actual / expected));
    if (ratio < 1) phasesBehind++; // trailing the pace its elapsed window implies
    return acc + ratio;
  }, 0);
  return { score: Math.round((sum / inFlight.length) * 100), phasesBehind, inFlight: inFlight.length };
}

export function computeScheduleAdherence(
  rawData: unknown,
  phases: Array<{ id: string; status?: string }>,
): number | null {
  return computeScheduleAdherenceDetail(rawData, phases).score;
}

/** A validation/de-risking stage the user defined in the Strategy phase grid. */
export interface ValidationStage {
  id: string;
  /** POC / Prototype / Pilot / MVP — the stage label. */
  stage: string;
  /** What the stage covers / its considerations. */
  considerations: string;
  /** Target ISO yyyy-mm-dd, or "" when undated. */
  date: string;
}

/**
 * Parse the Strategy phase's `validationApproach` grid into ordered stages. The
 * grid persists as a JSON-stringified array of row objects; we tolerate either a
 * raw array or the stringified form, drop blank rows, and sort dated stages
 * chronologically (undated stages keep their authored order at the end). This is
 * the authoritative, user-supplied de-risking plan the roadmap surfaces.
 */
export function buildValidationStages(rawData: unknown): ValidationStage[] {
  const raw = unwrapInner(rawData);
  const phaseInputs = raw.phaseInputs;
  const strategyInputs = typeof phaseInputs === "object" && phaseInputs !== null
    ? (phaseInputs as Record<string, unknown>).strategy as Record<string, unknown> | undefined
    : undefined;
  const value = strategyInputs?.validationApproach;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const stages: ValidationStage[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const stage = typeof e.stage === "string" ? e.stage.trim() : "";
    const considerations = typeof e.considerations === "string" ? e.considerations.trim() : "";
    const date = typeof e.date === "string" && parseUtcDay(e.date) !== null ? e.date.trim() : "";
    if (!stage && !considerations && !date) continue;
    const id = typeof e.id === "string" && e.id ? e.id : `${stage}-${date || stages.length}`;
    stages.push({ id, stage, considerations, date });
  }
  stages.sort((a, b) => {
    const am = parseUtcDay(a.date);
    const bm = parseUtcDay(b.date);
    if (am === null && bm === null) return 0;
    if (am === null) return 1;
    if (bm === null) return -1;
    return am - bm;
  });
  return stages;
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

/**
 * The strategic roadmap is a Strategy-phase deliverable: it is shaped while
 * Strategy is in flight and becomes the committed baseline the moment that
 * phase's gate is approved. After approval the timeline must stop being directly
 * editable — any change is a re-baseline that belongs in change control (a CR),
 * not a quiet drag of a bar. The owning phase is read from the formal-artifact
 * registry rather than hard-coded so it stays in lockstep with methodology.
 */
export function isRoadmapBaselineLocked(
  gateReviews: Record<string, { status?: string } | null | undefined> | null | undefined,
): boolean {
  const ownerPhase = FORMAL_ARTIFACT_PHASES["strategic-roadmap"];
  if (!ownerPhase) return false;
  return gateReviews?.[ownerPhase]?.status === "approved";
}
