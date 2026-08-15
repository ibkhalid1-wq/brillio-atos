/**
 * ONE OPEN DECISION PER QUESTION.
 *
 * `queueFlowDecision` appended unconditionally with a fresh random id, so a
 * question the operator had not answered yet was asked again on every run that
 * raised it. Observed live: four identical "Regenerated Agentify covers LESS
 * than the record" rows in one Inbox, minted 04:45, 14:04, 14:38 and 15:08 —
 * same tier, same title, same summary, differing only by id and timestamp.
 *
 * The duplication is the visible half. The dangerous half is that each row
 * carries its OWN `payload.artifactDocs` — the draft from the run that minted
 * it — so confirming the oldest row would overwrite the record with a draft
 * generated hours ago, and nothing on the surface tells the operator which is
 * which. Collapsing to one row is therefore a correctness fix, not tidying.
 *
 * The rule: a decision may carry a `dedupeKey` naming the QUESTION it asks
 * (not the run that raised it). While a decision with that key is still open,
 * a re-raise REFRESHES it in place — newest payload, newest summary, original
 * id and `createdAt` preserved, because the question has genuinely been open
 * since then and any surface holding that id must keep resolving. A decision
 * without a key keeps the old append-always behaviour, so no existing caller
 * changes shape.
 *
 * Refreshing rather than skipping is the point: the operator must be able to
 * confirm the LATEST proposal, never a stale one.
 */

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** How many decisions the programme blob retains (oldest fall off the front). */
export const FLOW_DECISION_CAP = 60;

/**
 * Append a decision, or refresh the open one that already asks this question.
 *
 * Pure and clock-free — `newId` and `now` are supplied by the caller, so the
 * behaviour is testable without stubbing Date or Math.random.
 */
export function upsertFlowDecision(
  list: readonly unknown[],
  decision: Rec,
  newId: string,
  now: string,
  cap: number = FLOW_DECISION_CAP,
): unknown[] {
  const key = typeof decision.dedupeKey === "string" ? decision.dedupeKey.trim() : "";
  if (key) {
    // Only an OPEN row is refreshed. A confirmed or declined decision is a
    // closed question and part of the trace — re-raising after it was settled
    // is a NEW question and must mint a new row, or the record would lose the
    // fact that the operator once answered.
    const ix = list.findIndex((d) => isRec(d) && d.status === "open" && d.dedupeKey === key);
    if (ix >= 0) {
      const prev = list[ix] as Rec;
      const superseded = typeof prev.supersededCount === "number" ? prev.supersededCount : 0;
      const next = list.slice();
      next[ix] = {
        ...prev,
        ...decision,
        // Identity and age survive the refresh; everything the run produced
        // (payload, summary, title) is replaced by the newest.
        id: prev.id,
        status: "open",
        createdAt: prev.createdAt,
        updatedAt: now,
        supersededCount: superseded + 1,
      };
      // Length is unchanged, so the cap cannot evict anything on a refresh.
      return next;
    }
  }
  return [...list, { id: newId, status: "open", createdAt: now, ...decision }].slice(-cap);
}
