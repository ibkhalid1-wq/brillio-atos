/**
 * Evidence salience — which quotes deserve the column.
 *
 * The stakeholder-evidence column shows one pull-quote per captured entry, and
 * as documents pile up the list grows long while much of it is noise: copyright
 * lines, agenda headers, short acknowledgements. This ranks entries
 * DETERMINISTICALLY (no model call) so the column leads with what matters and
 * folds the rest behind "show all":
 *
 *   +3  the quote was claim-tagged by the operator (explicitly marked meaningful)
 *   +2  an attributed human voice (vs. an unattributed document excerpt)
 *   +1  carries a number, money, % or duration — measurable facts
 *   +1  substantive length (a sentence, not a fragment or a wall)
 *   -3  boilerplate (copyright / proprietary / agenda / page headers)
 *   -2  pure meta ("Document: …", "Scheduled on …", greetings/acks)
 *
 * Ties keep capture order, so ranking never shuffles equally-good quotes.
 */

export interface RankableEvidence {
  excerpt: string;
  kind: string;
  who: string;
  fieldLabel: string;
}

const BOILERPLATE = /proprietary|confidential|copyright|all rights reserved|internal use only|^\s*agenda\b|^\s*page \d|^\s*table of contents/i;
const META = /^\s*(document\s*:|scheduled\b|attached\b|thanks\b|thank you\b|hi\b|hello\b|regards\b|—)/i;
const MEASURABLE = /\d+\s*(%|percent|days?|weeks?|hours?|minutes?|x\b)|[$€£]\s?\d|\d{2,}/;

export function scoreEvidence(entry: RankableEvidence, taggedQuotes: string[]): number {
  const quote = (entry.excerpt ?? "").trim();
  if (!quote) return -10;
  let score = 0;
  const low = quote.toLowerCase();
  if (taggedQuotes.some((tag) => tag && (low.includes(tag) || tag.includes(low)))) score += 3;
  if (entry.kind === "transcript" && entry.who !== entry.fieldLabel && !/^document:/i.test(entry.who)) score += 2;
  if (MEASURABLE.test(quote)) score += 1;
  if (quote.length >= 40 && quote.length <= 220) score += 1;
  if (BOILERPLATE.test(quote)) score -= 3;
  if (META.test(quote)) score -= 2;
  return score;
}

const sigTokens = (text: string): Set<string> =>
  new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((t) => t !== "the" && t !== "and" && t !== "are" && t !== "using"));

/**
 * Overlap coefficient (Szymkiewicz–Simpson): shared tokens over the SMALLER
 * set. Unlike Jaccard it doesn't dilute when one quote is longer — so a short
 * pull-quote that is a subset of a fuller block still scores ~1.
 */
function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/**
 * Drop near-duplicate quotes — the same claim surfaced from two documents, or a
 * pull-quote and the block it came from. Uses significant-token overlap so
 * paraphrase-level and subset repeats collapse even when their edges differ.
 * The first (higher-ranked) survivor wins, so dedup runs AFTER ranking.
 */
export function dedupeEvidence<T extends RankableEvidence>(entries: T[]): T[] {
  const kept: Array<{ entry: T; tokens: Set<string> }> = [];
  for (const entry of entries) {
    const tokens = sigTokens(entry.excerpt ?? "");
    if (tokens.size < 3) { kept.push({ entry, tokens }); continue; } // too short to judge — keep
    const dup = kept.some(({ tokens: seen }) => seen.size >= 3 && tokenOverlap(tokens, seen) >= 0.8);
    if (!dup) kept.push({ entry, tokens });
  }
  return kept.map(({ entry }) => entry);
}

/**
 * Rank entries by salience, stably, then dedupe near-identical quotes.
 * `taggedQuotes` are the operator's claim tags (lower-cased) — the strongest
 * meaningful-ness signal we have.
 */
export function rankEvidence<T extends RankableEvidence>(entries: T[], taggedQuotes: string[] = []): T[] {
  const tags = taggedQuotes.map((quote) => quote.trim().toLowerCase()).filter(Boolean);
  const ranked = entries
    .map((entry, index) => ({ entry, index, score: scoreEvidence(entry, tags) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map(({ entry }) => entry);
  return dedupeEvidence(ranked);
}

/** How many entries the column shows before folding behind "show all". */
export const EVIDENCE_LEAD_COUNT = 4;

/** True when an entry is pure noise the column can drop entirely from the lead. */
export function isNoiseEvidence(entry: RankableEvidence): boolean {
  const quote = (entry.excerpt ?? "").trim();
  return !quote || BOILERPLATE.test(quote) || (META.test(quote) && quote.length < 60);
}
