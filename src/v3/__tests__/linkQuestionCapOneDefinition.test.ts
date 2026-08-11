/**
 * THE LINK QUESTION CAP — ONE DEFINITION, PROVED BY SUBSTITUTION.
 *
 * The number 8 had three homes: `LINK_QUESTION_CAP` in `ownedLoad.ts` (what the Discover
 * card promises) and a bare `8` in `flowPortal.ts` TWICE (what `mintFollowUpPack` and
 * `mintReviewPack` actually send). They were held together by a test that read
 * `flowPortal.ts` as TEXT and regex'd its literal out — the `answerCapLockstep` idiom,
 * which exists for the client↔Deno boundary where a shared import is impossible. All
 * three sites here are client-side TypeScript. There was no boundary; there was a
 * missing import. That grep lived in `discoverCardReconciliation.test.ts` and is deleted.
 *
 * A source grep proves the two literals MATCH. It cannot prove they are the SAME NUMBER.
 * This file proves the stronger thing the way only a shared definition allows: it
 * SUBSTITUTES the export and watches the mints move. If a mint ever goes back to its own
 * literal, the substituted cap stops reaching it and every case below fails.
 *
 * (The card's half needs no proof of this kind: `ownedLoadFor` slices with the same
 * constant declared in its own module, so the card cannot disagree with it. What the card
 * promises equals what the mint sends is pinned on the real Laila record by
 * `discoverCardReconciliation.test.ts`.)
 */
import { describe, it, expect, vi } from "vitest";

// Hoisted above the imports by vitest — the factory therefore takes a LITERAL, not an
// outer const. 3 is deliberately far from 8: nothing can pass by coincidence.
vi.mock("@/v3/lib/ledger/ownedLoad", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/v3/lib/ledger/ownedLoad")>()),
  LINK_QUESTION_CAP: 3,
}));

import type { ProgramSummary } from "@/new/types";
import { LINK_QUESTION_CAP } from "@/v3/lib/ledger/ownedLoad";
import { listInterviewPacks, mintFollowUpPack, mintReviewPack } from "@/v3/components/flow/flowPortal";

const SUBSTITUTED = 3;
const programme = (inner: Record<string, unknown>): ProgramSummary =>
  ({ id: "p1", name: "Test", rawData: inner } as unknown as ProgramSummary);
/** Twelve asks: comfortably over the substituted cap AND over the real one, so a mint
 *  that ignored the export and kept its own 8 is visibly wrong either way. */
const ASKS = Array.from({ length: 12 }, (_, i) => `Question ${i + 1}?`);
const LOCI = ASKS.map((_, i) => `el:thing#slot${i + 1}`);

const packsOf = (blob: Record<string, unknown> | null) =>
  listInterviewPacks(programme(blob ?? {}));

describe("LINK_QUESTION_CAP — the mints read the ONE export, not a literal of their own", () => {
  it("the substitution is actually in force (pre-condition — otherwise every case below is vacuous)", () => {
    expect(LINK_QUESTION_CAP).toBe(SUBSTITUTED);
    expect(SUBSTITUTED).not.toBe(8);
  });

  it("mintFollowUpPack caps its ask at the SUBSTITUTED cap — questions and loci together", () => {
    const blob = mintFollowUpPack(programme({}),
      { movementId: "listen", who: "Sarah", questions: ASKS, loci: LOCI, captureField: "interviewTranscripts" }, "you");
    const pack = packsOf(blob)[0];
    expect(pack.questions).toEqual(ASKS.slice(0, SUBSTITUTED));
    // The cap cuts BOTH arrays with one slice, so `questionLoci[i]` never stops
    // pointing at `questions[i]` — a cap read from two places could desync them.
    expect(pack.questionLoci).toEqual(LOCI.slice(0, SUBSTITUTED));
  });

  it("mintReviewPack caps its ask at the SAME substituted cap", () => {
    const blob = mintReviewPack(programme({}), {
      movementId: "envision", who: "Sarah", role: "Reviewer", captureField: "x",
      reviewKind: "agentify", review: { kind: "agentify" }, questions: ASKS, loci: LOCI, intro: "i",
    }, "you");
    const pack = packsOf(blob)[0];
    expect(pack.questions).toEqual(ASKS.slice(0, SUBSTITUTED));
    expect(pack.questionLoci).toEqual(LOCI.slice(0, SUBSTITUTED));
  });

  it("both mints send the same count — one cap, not two that happen to agree", () => {
    const follow = packsOf(mintFollowUpPack(programme({}),
      { movementId: "listen", who: "A", questions: ASKS, captureField: "x" }, "you"))[0];
    const review = packsOf(mintReviewPack(programme({}), {
      movementId: "envision", who: "B", role: "R", captureField: "x",
      reviewKind: "agentify", review: { kind: "agentify" }, questions: ASKS, intro: "i",
    }, "you"))[0];
    expect(follow.questions.length).toBe(review.questions.length);
    expect(follow.questions.length).toBe(LINK_QUESTION_CAP);
  });
});
