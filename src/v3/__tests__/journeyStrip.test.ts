/**
 * THE JOURNEY STRIP DRAWS MOVEMENT, NOT EXISTENCE.
 *
 * Measured on the live CRM: 21 roster rows, 42 journey segments, every one
 * reading `state=open`, every dot the same colour, every title "Listen — open"
 * or "Loop — open". Two columns of every row spent on a fact the engagement chip
 * beside them already carried ("Ready" — nothing has happened yet). A badge that
 * is identical on every row is not a badge, it is a border.
 *
 * `open` is the state everybody starts in: sign-off items exist for them, none is
 * approved, none is in review. It is the DEFAULT, and the information was always
 * in the transition out of it.
 *
 * Worse than redundant, the Loop segment was also untrue. Its items appear as
 * soon as the prototype artifact does — that says the person COULD be asked, not
 * that they were — so all 21 rows claimed "Loop — open" while the Design Loop
 * band directly above them said the round had not been opened.
 *
 * The risk in fixing this is deleting the feature instead of focusing it, so the
 * cases below are weighted to what must still APPEAR.
 */
import { describe, it, expect } from "vitest";
import { journeySegments, phaseState } from "@/v3/components/flow/TheLine";

type Item = Parameters<typeof phaseState>[0][number];

const item = (over: Partial<Item> = {}): Item => ({
  artifactId: "a1",
  artifactTitle: "Domain Ontology",
  status: "open",
  preDatesDocument: false,
  ...over,
} as Item);

const journey = (over: Partial<Parameters<typeof journeySegments>[0]> = {}) => ({
  listen: [] as Item[], loop: [] as Item[], verdict: null as string | null, ...over,
});

describe("phaseState — the precondition these rules are built on", () => {
  it("'open' really is the default a person sits in before anything happens", () => {
    expect(phaseState([])).toBe("none");
    expect(phaseState([item()])).toBe("open");
    expect(phaseState([item({ status: "approved" })])).toBe("approved");
    expect(phaseState([item({ status: "in-review" })])).toBe("pending");
    // an approval that predates the document it approves is NOT fresh approval
    expect(phaseState([item({ status: "approved", preDatesDocument: true })])).toBe("open");
  });
});

describe("what still appears — the half that must not be lost", () => {
  it("an APPROVED Listen sign-off draws the Listen segment", () => {
    const s = journeySegments(journey({ listen: [item({ status: "approved" })] }), false);
    expect(s.listen).toBe("approved");
  });

  it("a Listen sign-off OUT FOR REVIEW draws it too — that is movement", () => {
    expect(journeySegments(journey({ listen: [item({ status: "in-review" })] }), false).listen).toBe("pending");
  });

  it("a recorded VERDICT draws Loop even with no round and no sign-off items", () => {
    // The verdict is its own evidence: somebody reacted to the demo. It must not
    // be gated behind a round record that may have been opened after the fact.
    const s = journeySegments(journey({ verdict: "changes" }), false);
    expect(s.loop).not.toBeNull();
    expect(s.verdict).toBe("changes");
  });

  it("once a round IS open, a Loop sign-off in play draws the segment", () => {
    expect(journeySegments(journey({ loop: [item({ status: "in-review" })] }), true).loop).toBe("pending");
    expect(journeySegments(journey({ loop: [item({ status: "approved" })] }), true).loop).toBe("approved");
  });

  it("Listen and Loop are independent — signing one does not silence the other", () => {
    const s = journeySegments(journey({
      listen: [item({ status: "approved" })], loop: [item({ status: "in-review" })],
    }), true);
    expect(s.listen).toBe("approved");
    expect(s.loop).toBe("pending");
  });
});

describe("what stops appearing — the 42 identical chips", () => {
  it("REGRESSION: the default 'open' state draws nothing", () => {
    const s = journeySegments(journey({ listen: [item()], loop: [item()] }), true);
    expect(s.listen, "every row drew 'Listen — open' again").toBeNull();
    expect(s.loop, "every row drew 'Loop — open' again").toBeNull();
  });

  it("REGRESSION: Loop is not drawn when no round has been opened", () => {
    // The exact live state: prototype exists, so loop items exist, but nobody was
    // asked anything. The band said "round not opened"; the rows disagreed.
    const s = journeySegments(journey({ loop: [item({ status: "in-review" })] }), false);
    expect(s.loop, "a person was shown as mid-Loop with no round in existence").toBeNull();
  });

  it("a person with nothing at all draws nothing", () => {
    const s = journeySegments(journey(), true);
    expect(s.listen).toBeNull();
    expect(s.loop).toBeNull();
  });

  it("an empty verdict string is not a verdict", () => {
    expect(journeySegments(journey({ verdict: "   " }), false).loop).toBeNull();
  });
});
