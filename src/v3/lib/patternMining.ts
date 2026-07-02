/**
 * Cross-programme learning — the pure core that turns one programme's lived RAID
 * history into reusable {@link PatternLibraryEntry} candidates, and ranks a pool
 * of library patterns by relevance to a target programme.
 *
 * The existing `usePatternLibrary` hook only ever *reads* the DB table and matches
 * "similar" patterns by exact-industry equality — nothing mines a programme's own
 * risks into the library, and the similarity match is all-or-nothing. This module
 * supplies the two missing halves as storage-free, deterministic functions so they
 * are unit-testable and can feed either the hook or an edge-function writer:
 *
 *  - {@link mineRiskPatterns} distils resolved/managed RAID risks & blockers into
 *    library entries (a *closed* risk is a *successful* mitigation to learn from).
 *  - {@link rankSimilarPatterns} scores candidate patterns against a target
 *    programme's profile (industry, size, active phase, outcome, track record),
 *    so the UI can surface the few most-relevant precedents instead of an
 *    industry-filtered dump.
 *
 * Neither function touches supabase, React, or the DOM — mining is a pure map over
 * `program.raidEntries` and ranking is a pure sort over its inputs.
 */
import type { PatternLibraryEntry, ProgramSummary, RAIDEntry } from "@/new/types";

export type ProgramSize = PatternLibraryEntry["programSize"];

/** The few dimensions relevance is judged against — cheap to derive per programme. */
export interface ProgramProfile {
  programId: string;
  industry: string | null;
  programSize: ProgramSize;
  /** The phase the programme is currently in — boosts phase-matched precedents. */
  activePhaseId?: string | null;
}

/** A candidate scored against a target profile, with human-readable rationale. */
export interface ScoredPattern {
  entry: PatternLibraryEntry;
  /** Composite relevance 0–1 (higher = more relevant). */
  score: number;
  /** Ordered, plain-language reasons that contributed to the score. */
  reasons: string[];
}

/** RAID types worth distilling into the risk pattern library. */
const MINEABLE_TYPES: ReadonlySet<RAIDEntry["type"]> = new Set(["risk", "blocker"]);

/**
 * A closed entry is a *learned* outcome (the risk was managed to closure); an
 * entry still open or under watch is directional but unproven, so `neutral`.
 */
function outcomeForStatus(status: RAIDEntry["status"]): PatternLibraryEntry["outcome"] {
  return status === "closed" ? "successful" : "neutral";
}

/**
 * Distil a programme's RAID risks & blockers into pattern-library candidates —
 * one entry per mineable entry, carrying the mitigation and severity as the
 * reusable body. Deterministic ids (`mined:<program>:<raid>`) make re-mining
 * idempotent. Entries with no mitigation recorded are skipped: a risk with no
 * documented response teaches nothing.
 */
export function mineRiskPatterns(
  program: ProgramSummary,
  profile?: Partial<ProgramProfile>,
): PatternLibraryEntry[] {
  if (!program || !Array.isArray(program.raidEntries)) return [];
  const industry = profile?.industry ?? program.industry ?? null;
  const programSize = profile?.programSize ?? null;
  const sourceProgramId = profile?.programId ?? program.id;

  const out: PatternLibraryEntry[] = [];
  for (const raid of program.raidEntries) {
    if (!raid || !MINEABLE_TYPES.has(raid.type)) continue;
    const mitigation = (raid.mitigation ?? "").trim();
    if (!mitigation) continue; // no documented response → nothing to learn
    out.push({
      id: `mined:${program.id}:${raid.id}`,
      patternType: "risk",
      phaseId: raid.phase || null,
      industry,
      programSize,
      title: raid.title,
      body: {
        raidType: raid.type,
        severity: raid.severity,
        description: raid.description,
        mitigation,
        status: raid.status,
      },
      outcome: outcomeForStatus(raid.status),
      confidence: typeof raid.agentConfidence === "number" ? raid.agentConfidence : 0.5,
      sourceProgramId,
      createdAt: raid.createdAt,
      usedCount: 0,
    });
  }
  return out;
}

// Relevance weights — sum of positive contributions is bounded, so scores stay
// comparable across candidates. Popularity is deliberately the smallest lever so
// a widely-reused-but-off-context pattern never outranks a precise match.
const W_INDUSTRY = 0.4;
const W_SIZE = 0.2;
const W_PHASE = 0.15;
const W_OUTCOME = 0.15;
const W_CONFIDENCE = 0.1;
const W_POPULARITY = 0.1;
const POPULARITY_SATURATION = 10;

/**
 * Rank library candidates by relevance to a target programme. Excludes the
 * target's own patterns (you don't learn from yourself), then scores each on
 * industry / size / phase alignment, proven outcome, stored confidence, and how
 * often it has already been reused. Returns candidates sorted most-relevant
 * first; ties break deterministically by title then id so the order is stable
 * across renders.
 */
export function rankSimilarPatterns(
  candidates: PatternLibraryEntry[],
  target: ProgramProfile,
  limit?: number,
): ScoredPattern[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const scored: ScoredPattern[] = [];
  for (const entry of candidates) {
    if (!entry) continue;
    if (entry.sourceProgramId && entry.sourceProgramId === target.programId) continue;

    let score = 0;
    const reasons: string[] = [];

    if (target.industry && entry.industry && entry.industry === target.industry) {
      score += W_INDUSTRY;
      reasons.push(`Same industry (${entry.industry})`);
    }
    if (target.programSize && entry.programSize && entry.programSize === target.programSize) {
      score += W_SIZE;
      reasons.push(`Same programme size (${entry.programSize})`);
    }
    if (target.activePhaseId && entry.phaseId && entry.phaseId === target.activePhaseId) {
      score += W_PHASE;
      reasons.push(`Relevant to the current phase`);
    }
    if (entry.outcome === "successful") {
      score += W_OUTCOME;
      reasons.push(`Proven successful elsewhere`);
    }
    const confidence = Number.isFinite(entry.confidence) ? Math.max(0, Math.min(1, entry.confidence)) : 0;
    if (confidence > 0) {
      score += confidence * W_CONFIDENCE;
    }
    const popularity = Math.min(Math.max(entry.usedCount, 0), POPULARITY_SATURATION) / POPULARITY_SATURATION;
    if (popularity > 0) {
      score += popularity * W_POPULARITY;
      reasons.push(`Reused ${entry.usedCount}×`);
    }

    scored.push({ entry, score, reasons });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const byTitle = a.entry.title.localeCompare(b.entry.title);
    if (byTitle !== 0) return byTitle;
    return a.entry.id.localeCompare(b.entry.id);
  });

  return typeof limit === "number" && limit >= 0 ? scored.slice(0, limit) : scored;
}
