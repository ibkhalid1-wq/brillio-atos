/**
 * TRANSCRIPT → CANDIDATES — what somebody said in a meeting, matched to the
 * question it answers, and stopped one step short of the ledger.
 *
 * THE PROBLEM. A question pack carries its loci out and the reply comes back
 * carrying them home, so an answer given on somebody's own link closes the point
 * it was asked about. A MEETING does not work like that. The transcript is prose
 * with no addresses in it, so the most direct evidence a programme ever gets —
 * the stakeholder's own words, in the room — was the one kind that could not
 * reach the ledger.
 *
 * ── WHY THIS STOPS AT A CANDIDATE ───────────────────────────────────────────
 *
 * A model reading a transcript is inferring which question a sentence answers.
 * That inference is useful and it is not testimony. If it wrote straight to the
 * ledger, a paraphrase would become a person's assertion and the register would
 * say somebody was heard on a point they never addressed — the exact failure the
 * heard-count was corrected to stop. So the model's output is a QUEUE, every row
 * carries the verbatim quote it was drawn from, and a person confirms it.
 *
 * ── AND WHAT A CONFIRMED ONE IS ALLOWED TO CLAIM ────────────────────────────
 *
 * It closes the locus, attributed to the SPEAKER, with their words as verbatim
 * and `method: "transcript"` — not `"assertion"`, which belongs to a reply that
 * arrived through their own token-gated link, and not `"import"`, which would
 * mean a machine put it there. The distinction is visible on the claim for ever,
 * so a reader can always see how a thing came to be known.
 *
 * The codebase already draws this line once: a design-round verdict carries
 * `attestation: "self" | "operator"`, and an operator-attested one is invalid
 * unless it says what was said and where. Same rule here — a candidate with no
 * quote is not a candidate, and is dropped rather than queued.
 */

/** One thing the model believes was answered, and the words it read. */
export interface ReviewCandidate {
  /** The locus — `<elementId>#<slot>`. Must be one we actually asked about. */
  about: string;
  /** The speaker's own words. Without these there is nothing to attest. */
  quote: string;
  /** Who said it. A person; never a system token. */
  speaker: string;
  /** The model's own reading of the match, 0–1. Shown, never acted on. */
  confidence: number;
  /** Why the model matched this quote to this locus. */
  why?: string;
}

/**
 * SOMETHING SAID THAT ANSWERS NOTHING WE ASKED.
 *
 * The valuable residue, and the reason the agent is asked for it at all: a
 * transcript full of matched answers tells you the pack was good, while a
 * statement nobody had a question for is how you find the question you failed to
 * ask. Kept beside the candidates rather than discarded.
 */
export interface ReviewResidue {
  quote: string;
  speaker: string;
  /** What the model thinks this is about, in its own words. */
  note: string;
}

export interface ReviewCapture {
  candidates: ReviewCandidate[];
  unmatched: ReviewResidue[];
  /** Every candidate the reader refused, and why — never a silent drop. */
  refused: string[];
}

/** The locus list the agent is asked to match against, as the client stashes it. */
export interface ReviewAsk {
  about: string;
  question: string;
  owner?: string;
}

const text = (v: unknown): string => String(v ?? "").trim();
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Actors that are the SYSTEM, not a person — the same set the heard-count
 *  rejects, applied one step earlier so a bad row never becomes a claim. */
const SYSTEM_ACTORS = new Set(["prototype", "import", "system", "operator", "?", ""]);

/** Quotes shorter than this are not evidence of anything. */
const MIN_QUOTE = 8;

/**
 * Read what the agent returned, refusing anything that cannot honestly become a
 * closure — and SAYING what it refused.
 *
 * The refusals are the interesting half. A locus we never asked about means the
 * model invented an address, and applying it would close a question nobody put;
 * a missing quote means there is nothing to attest; a system actor in the
 * speaker slot means nobody said it.
 */
/**
 * The transcript with whitespace and case flattened, for the verbatim check.
 *
 * Deliberately forgiving about SHAPE and unforgiving about WORDS. A model that
 * re-wraps a line, collapses a double space or changes capitalisation has still
 * quoted the person; one that joins two fragments across a speaker change has
 * not, and produces a sentence nobody said. Only the second is refused.
 */
const flatten = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

export function readReviewCapture(
  raw: unknown,
  asked: readonly ReviewAsk[],
  /**
   * THE SOURCE, so a quote can be checked against it.
   *
   * MEASURED, on a real 9,105-word discovery session: of 13 candidates the
   * model returned, FOUR carried quotes that do not appear in the transcript —
   * stitched from fragments either side of a speaker change. The reader passed
   * every one, because it checked that a quote EXISTED and never that it was
   * true. The refusal list came back empty, which read as a clean run and was
   * actually the reader being too permissive.
   *
   * That is the failure this whole path exists to prevent: confirm one of those
   * and it enters the ledger as that person's own words, attributed, with
   * `method: "transcript"` and a verbatim that is not verbatim.
   *
   * Optional so existing callers keep working — but when it is absent NOTHING
   * is checked, so the edge always passes it.
   */
  transcript?: string,
): ReviewCapture {
  const doc = isRecord(raw) ? raw : {};
  const known = new Set(asked.map((a) => a.about));
  const source = typeof transcript === "string" && transcript.trim() ? flatten(transcript) : "";
  const candidates: ReviewCandidate[] = [];
  const refused: string[] = [];
  const seen = new Set<string>();

  for (const row of Array.isArray(doc.candidates) ? doc.candidates : []) {
    if (!isRecord(row)) continue;
    const about = text(row.about);
    const quote = text(row.quote);
    const speaker = text(row.speaker);
    if (!known.has(about)) {
      refused.push(`Matched to "${about || "(nothing)"}", which is not a question this review asked — dropped rather than applied.`);
      continue;
    }
    if (quote.length < MIN_QUOTE) {
      refused.push(`No quote for ${about} — an operator cannot confirm what they cannot read.`);
      continue;
    }
    if (!speaker || SYSTEM_ACTORS.has(speaker.toLowerCase())) {
      refused.push(`No named speaker for ${about} — a closure has to be attributed to a person.`);
      continue;
    }
    // THE ONE THAT WAS MISSING. A quote nobody said cannot become what somebody
    // said, however plausible it reads and however confident the model is.
    if (source && !source.includes(flatten(quote))) {
      refused.push(`The quote offered for ${about} does not appear in the transcript — "${quote.slice(0, 60)}…" attributed to ${speaker}. A stitched or paraphrased line cannot become their own words.`);
      continue;
    }
    // One candidate per locus per speaker: a model that quotes the same person
    // twice on one point has not found two answers.
    const key = `${about}\u0000${speaker.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const confidence = typeof row.confidence === "number" && Number.isFinite(row.confidence)
      ? Math.min(1, Math.max(0, row.confidence)) : 0;
    candidates.push({ about, quote, speaker, confidence, ...(text(row.why) ? { why: text(row.why) } : {}) });
  }

  const unmatched: ReviewResidue[] = [];
  for (const row of Array.isArray(doc.unmatched) ? doc.unmatched : []) {
    if (!isRecord(row)) continue;
    const quote = text(row.quote);
    if (quote.length < MIN_QUOTE) continue;
    unmatched.push({ quote, speaker: text(row.speaker), note: text(row.note) });
  }
  return { candidates, unmatched, refused };
}

/** One answer row, in the shape `readStakeholderAnswers` already reads. */
export interface ReviewAnswerRow {
  about: string;
  answer: string;
  saidByName: string;
  saidByRole?: string;
  at: string;
  via: string;
  /** How it arrived. Never "assertion" — see the header. */
  method: "transcript";
  /** Who confirmed the match. An operator-attested statement names its attester. */
  confirmedBy: string;
}

/**
 * A CONFIRMED candidate, as the answer channel's own row.
 *
 * The verbatim IS the answer: the person's words, not the model's summary of
 * them. Anything else would put a paraphrase in the ledger under somebody's
 * name, and the quote is the whole reason this is allowed to close anything.
 */
export function reviewAnswerRows(
  confirmed: readonly ReviewCandidate[],
  ctx: { via: string; at: string; confirmedBy: string; roleOf?: (speaker: string) => string | undefined },
): ReviewAnswerRow[] {
  return confirmed.map((c) => ({
    about: c.about,
    answer: c.quote,
    saidByName: c.speaker,
    ...(ctx.roleOf?.(c.speaker) ? { saidByRole: ctx.roleOf(c.speaker) } : {}),
    at: ctx.at,
    via: ctx.via,
    method: "transcript" as const,
    confirmedBy: ctx.confirmedBy,
  }));
}

/**
 * THE ASK, as the agent is given it. Trimmed on purpose: a transcript is long,
 * and a hundred loci with their full question text would crowd out the thing
 * being read. The question is what the model matches against; the owner is
 * carried so a candidate can be routed without a second lookup.
 */
export function reviewAskOf(rows: readonly { about: string; question: string; owner?: string }[], cap = 60): ReviewAsk[] {
  const out: ReviewAsk[] = [];
  for (const r of rows) {
    const about = text(r.about), question = text(r.question);
    if (!about || !question || out.some((o) => o.about === about)) continue;
    out.push({ about, question, ...(text(r.owner) ? { owner: text(r.owner) } : {}) });
    if (out.length >= cap) break;
  }
  return out;
}
