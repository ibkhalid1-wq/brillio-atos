/**
 * Confidence score history — the persistence layer that finally feeds the
 * (previously dead) trend + forecast machinery in confidenceScore.ts.
 *
 * `computeConfidenceScore` already knows how to read a `previousScore` (for the
 * up/down trend) and `forecastConfidence` can project a target date from a score
 * series — but nothing ever stored a history, so trend was permanently "stable"
 * and the forecaster was never called. Rather than write snapshots into the
 * programme's persisted `data` blob (the store wiped in the 2026-06-28 data-loss
 * incident — auto-writes there are exactly the risk we avoid), we keep a small,
 * append-only, per-programme history in localStorage. It is directional context,
 * not authoritative state, so device-local is the right scope.
 *
 * Snapshots are throttled to one per calendar day (same-day re-renders overwrite
 * the day's entry rather than spamming the series) and capped so the key can't
 * grow without bound.
 */
import { forecastConfidence, type ConfidenceForecast } from "@/v3/lib/confidenceScore";

export interface ScoreSnapshot {
  /** Epoch ms when the snapshot was taken. */
  ts: number;
  /** Confidence score 0–100 at that time. */
  score: number;
}

const KEY_PREFIX = "atlas-confidence-history:";
const MAX_SNAPSHOTS = 60;
const DAY_MS = 86_400_000;

function storageKey(programId: string): string {
  return `${KEY_PREFIX}${programId}`;
}

/** UTC start-of-day epoch for the day containing `ms`. */
function startOfDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null; // privacy mode / disabled storage
  }
}

/** Read the persisted snapshot series for a programme, oldest → newest. */
export function getConfidenceHistory(programId: string | null | undefined): ScoreSnapshot[] {
  if (!programId) return [];
  const store = safeStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(storageKey(programId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is ScoreSnapshot =>
          !!e && typeof e === "object" && typeof e.ts === "number" && typeof e.score === "number",
      )
      .sort((a, b) => a.ts - b.ts);
  } catch {
    return [];
  }
}

/**
 * The most recent score from a *prior* calendar day — the right baseline for the
 * day's trend (comparing against earlier today would read 0 drift all day). Falls
 * back to undefined when there is no prior-day history, so trend stays "stable".
 */
export function getPreviousScore(programId: string | null | undefined): number | undefined {
  const history = getConfidenceHistory(programId);
  if (history.length === 0) return undefined;
  const today = startOfDay(Date.now());
  for (let i = history.length - 1; i >= 0; i--) {
    if (startOfDay(history[i].ts) < today) return history[i].score;
  }
  return undefined;
}

/**
 * Append today's score (or overwrite an existing same-day entry), capped to the
 * most recent {@link MAX_SNAPSHOTS}. No-op when storage is unavailable or when the
 * score is unchanged from the latest stored value, so idle re-renders are cheap.
 */
export function recordConfidenceSnapshot(
  programId: string | null | undefined,
  score: number,
): void {
  if (!programId || !Number.isFinite(score)) return;
  const store = safeStorage();
  if (!store) return;
  const history = getConfidenceHistory(programId);
  const now = Date.now();
  const last = history[history.length - 1];
  if (last && startOfDay(last.ts) === startOfDay(now)) {
    if (last.score === score) return; // same day, same value → nothing to persist
    last.ts = now;
    last.score = score;
  } else {
    history.push({ ts: now, score });
  }
  const trimmed = history.slice(-MAX_SNAPSHOTS);
  try {
    store.setItem(storageKey(programId), JSON.stringify(trimmed));
  } catch {
    /* quota / disabled → silently skip; history is best-effort */
  }
}

export type GateRiskLevel = "on-track" | "watch" | "at-risk";

export interface GateRiskAssessment {
  level: GateRiskLevel;
  /** The latest score in the series (the assessment's anchor). */
  currentScore?: number;
  /** Average score change per snapshot across the recent window (points). */
  trendPerStep: number;
  /** Direction of the recent trend. */
  direction: "rising" | "falling" | "flat";
  /** Consecutive most-recent snapshot-over-snapshot declines. */
  consecutiveDeclines: number;
  /** The passing score the gate is assessed against. */
  passThreshold: number;
  /** One-line human explanation of the assessment. */
  detail: string;
}

/** Change smaller than this (points/step) is treated as flat, not a trend. */
const FLAT_EPSILON = 0.5;
/** How many steps ahead the decline is projected when judging failure risk. */
const LOOKAHEAD_STEPS = 2;

/**
 * Predict gate-failure risk from a confidence series — turning the retrospective
 * score into an early warning. Pure: it reads a snapshot series (oldest → newest)
 * and returns a level with its supporting trend, so it is fully unit-testable and
 * independent of storage.
 *
 * A gate is `at-risk` when the current score is already below `passThreshold`, or
 * when a falling trend projects it below the threshold within `LOOKAHEAD_STEPS`.
 * It is on `watch` when the trend is falling (or the score sits just above the
 * threshold) without yet projecting failure, and `on-track` otherwise. `window`
 * bounds how many recent steps the trend is measured over, so an old dip does not
 * dominate a since-recovered series.
 */
export function assessGateRisk(
  history: ScoreSnapshot[],
  passThreshold = 70,
  window = 3,
): GateRiskAssessment {
  const base: GateRiskAssessment = {
    level: "on-track",
    currentScore: undefined,
    trendPerStep: 0,
    direction: "flat",
    consecutiveDeclines: 0,
    passThreshold,
    detail: "No confidence history yet — gate risk cannot be assessed.",
  };
  if (!Array.isArray(history) || history.length === 0) return base;

  const series = [...history].sort((a, b) => a.ts - b.ts);
  const currentScore = series[series.length - 1].score;

  // Recent-window average change per step: (last - first) / steps over the tail.
  const recent = series.slice(-(window + 1));
  const steps = recent.length - 1;
  const trendPerStep = steps > 0 ? (recent[recent.length - 1].score - recent[0].score) / steps : 0;
  const direction: GateRiskAssessment["direction"] =
    trendPerStep <= -FLAT_EPSILON ? "falling" : trendPerStep >= FLAT_EPSILON ? "rising" : "flat";

  // Consecutive most-recent declines (a run of drops signals sustained erosion).
  let consecutiveDeclines = 0;
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i].score < series[i - 1].score) consecutiveDeclines += 1;
    else break;
  }

  const projected = currentScore + trendPerStep * LOOKAHEAD_STEPS;
  const belowNow = currentScore < passThreshold;
  const decliningToFailure = direction === "falling" && projected < passThreshold;

  let level: GateRiskLevel;
  let detail: string;
  if (belowNow) {
    level = "at-risk";
    detail = `Confidence ${currentScore} is below the ${passThreshold} gate threshold.`;
  } else if (decliningToFailure) {
    level = "at-risk";
    detail = `Confidence is falling ${Math.abs(trendPerStep).toFixed(1)}/step and projects below ${passThreshold} within ${LOOKAHEAD_STEPS} steps.`;
  } else if (direction === "falling" || currentScore - passThreshold < 10) {
    level = "watch";
    detail = direction === "falling"
      ? `Confidence ${currentScore} is above the gate but trending down ${Math.abs(trendPerStep).toFixed(1)}/step.`
      : `Confidence ${currentScore} is only just above the ${passThreshold} gate.`;
  } else {
    level = "on-track";
    detail = `Confidence ${currentScore} is comfortably above the ${passThreshold} gate.`;
  }

  return { level, currentScore, trendPerStep, direction, consecutiveDeclines, passThreshold, detail };
}

/**
 * Gate-risk for a live programme: reads the stored history, anchors the caller's
 * current score to the tail (today's snapshot may not be recorded yet), then
 * defers to the pure {@link assessGateRisk}. Mirrors getConfidenceForecast's
 * anchoring so the two read the same effective series.
 */
export function getGateRisk(
  programId: string | null | undefined,
  currentScore: number,
  passThreshold = 70,
): GateRiskAssessment {
  const series = [...getConfidenceHistory(programId)];
  const last = series[series.length - 1];
  if (!last || startOfDay(last.ts) < startOfDay(Date.now())) {
    series.push({ ts: Date.now(), score: currentScore });
  } else {
    last.score = currentScore;
  }
  return assessGateRisk(series, passThreshold);
}

/**
 * Forecast the time to reach `target` from the stored history. Ensures the
 * caller's current score anchors the series' tail (the snapshot for today may not
 * have been recorded yet at render time), then defers to {@link forecastConfidence}.
 */
export function getConfidenceForecast(
  programId: string | null | undefined,
  currentScore: number,
  target = 80,
): ConfidenceForecast {
  const history = getConfidenceHistory(programId);
  const series = [...history];
  const last = series[series.length - 1];
  if (!last || startOfDay(last.ts) < startOfDay(Date.now())) {
    series.push({ ts: Date.now(), score: currentScore });
  }
  return forecastConfidence(series, target);
}
