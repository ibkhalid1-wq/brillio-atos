/**
 * Suppresses AI quality-review "improvements" that are false positives because
 * they ask the user to re-declare something the system already owns.
 *
 * The artifact quality reviewer is fed the artifact content — including the
 * `seed-…` ids the agent stamps on every grid row at seed time — and naively
 * recommends "add a unique milestone/requirement ID for traceability". But those
 * ids already exist (see the seed-row stamping in run-agent), and the suggestion
 * even cites the real id verbatim. Acting on it is impossible: the user cannot
 * hand-author the generator's id, so the suggestion is pure noise. This is the
 * same class as the exit-criteria / grounding false positives — never tell the
 * user to provide a system-owned value.
 */

// "add / assign / include …" a "unique [noun…] id / identifier".
const ADD_VERB = "(?:add|assign|include|introduce|create|provide|attach|generate|append)";
const UNIQUE_ID = "unique\\s+(?:\\w+\\s+){0,3}(?:id|ids|identifier|identifiers)\\b";
const ADD_UNIQUE_ID = new RegExp(`\\b${ADD_VERB}\\b[\\s\\S]{0,60}?\\b${UNIQUE_ID}`, "i");

// A literal system-generated seed id (e.g. seed-1782761143653-0-d40k0). Its mere
// presence in an improvement means the reviewer is echoing an existing id back.
const SEED_ID_LITERAL = /\bseed-\d{6,}-\d+-[a-z0-9]+/i;

/** Whether an improvement asks the user to add an identifier the system owns. */
export function isSystemOwnedIdSuggestion(text: string): boolean {
  if (!text) return false;
  return SEED_ID_LITERAL.test(text) || ADD_UNIQUE_ID.test(text);
}

/** Drop the system-owned-id false positives from an improvements list. */
export function filterActionableImprovements(improvements: string[]): string[] {
  return improvements.filter((item) => !isSystemOwnedIdSuggestion(item));
}
