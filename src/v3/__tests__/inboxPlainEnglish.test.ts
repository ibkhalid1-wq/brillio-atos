/**
 * THE INBOX SPEAKS ENGLISH, AND EVERY STRIP ON IT CAN BE ACTED ON.
 *
 * Four reports in one sitting, all the same shape — "is this informational?", "how
 * does the operator action this?", "what is the operator action here?", "use plain
 * english". The Inbox is the surface for operator decisions, so a strip that only
 * describes a situation is in the wrong place, and a strip that names an act it does
 * not offer ("Reassign them below", with nothing below) is worse than silent.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { plainDisputeSides } from "@/v3/components/flow/flowDecisions";

const SRC = (f: string) => readFileSync(resolve(__dirname, `../components/flow/${f}`), "utf8");

describe("the two sides of a dispute, in English", () => {
  it("says what the real Laila dispute is between", () => {
    // Verbatim from the running programme. It printed in small caps as
    // "BRILLIO_OPPORTUNITY_CLEAN_SCHEMA - OPPORTUNITY OBJECT (1) VS TRANSFORMATION
    // CHARTER (BUSINESSOBJECTIVE)" — a filename, "VS", and a camelCase key.
    const out = plainDisputeSides(
      "Brillio_Opportunity_Clean_Schema - Opportunity Object (1) vs Transformation Charter (businessObjective)");
    expect(out).toContain("the file you uploaded");
    expect(out).toContain("business objective");
    // MUTATION: return `raw` unchanged → each of these is RED.
    expect(out, "the underscores are still there").not.toContain("_");
    expect(out, "the download suffix is still there").not.toContain("(1)");
    expect(out, "camelCase is not a word").not.toContain("businessObjective");
    expect(out, '"vs" is notation, not speech').not.toMatch(/\bvs\b/i);
  });

  it("reads as a sentence, not two labels", () => {
    expect(plainDisputeSides("Dana Patel vs Transformation Charter (approach)"))
      .toBe("Dana Patel and the transformation charter’s approach disagree");
  });

  it("says something true when there is nothing to say", () => {
    expect(plainDisputeSides("")).toBe("two sources disagree");
    expect(plainDisputeSides(null)).toBe("two sources disagree");
  });

  it("passes through a side it cannot improve, rather than half-translating", () => {
    // Not "vs"-shaped: leaving it alone beats mangling it.
    expect(plainDisputeSides("the sponsor and the CFO remember it differently"))
      .toBe("the sponsor and the CFO remember it differently");
  });
});

describe("a card's button names its own act", () => {
  it("does not print one particular resolution on every dispute", () => {
    // "Resolve — the newer account stands" appeared on a dispute between an uploaded
    // schema and the charter, where nothing "stands" and there is no "account".
    const shell = SRC("FlowShell.tsx");
    expect(shell, "a generic verdict is printed as this dispute's verdict")
      .not.toContain("Resolve — the newer account stands");
  });

  it("does not label a control with a bare preposition", () => {
    // "route to [choose…]" — the label was the plumbing verb, not the act.
    expect(SRC("FlowShell.tsx")).not.toMatch(/>\s*route to\s*</);
  });
});

describe("no strip describes an act it does not offer", () => {
  const inbox = SRC("OperatorInbox.tsx");

  it("'Nobody to ask' offers the handover it tells the operator to make", () => {
    // It said "Reassign them below" above a list of COUNTS. The loci were not even
    // carried to the surface, so there was nothing to reassign with.
    expect(inbox, "still pointing at a 'below' that is a list of counts")
      .not.toContain("Reassign them below");
    // MUTATION: delete the hand-over button → RED.
    expect(inbox).toContain("hand over all");
    expect(inbox, "the act must commit the role's own loci")
      .toContain("owner.abouts.map((about) => assignAction(about, picked!))");
  });

  it("the derived-types strip offers the review it describes", () => {
    // MUTATION: delete the "review the N" button → RED.
    expect(inbox).toContain("review the {derived.length}");
    expect(inbox, "the review must open the grid on those rows, not the open wall")
      .toContain("rows={derivedRows}");
  });

  it("the no-system bucket opens its questions", () => {
    expect(inbox).toContain("show the {unattributed.weight}");
  });
});

describe("the grid tells the truth about which population it is showing", () => {
  it("does not say 'still need a type' about types already on the record", () => {
    const grid = SRC("TypingGrid.tsx");
    // The derived rows HAVE a type — the weakest one the ledger holds. Saying they
    // need one would be false, and it is the sentence that would justify the wrong
    // action (answering them again) instead of the right one (accept or overrule).
    // MUTATION: drop the `given ?` branch → RED.
    expect(grid).toContain('{given ? "Aura typed from their names" : "still need a type"}');
    expect(grid).toContain("code-derived · weak");
  });
});
