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
    expect(inbox).toContain("`review the ${derived.length}`");
    expect(inbox, "the review must open the grid on those rows, not the open wall")
      .toContain("rows={derivedRows}");
    // …and it must be a TOGGLE. It opened the grid with no way back: the only thing
    // that closed it was committing a confirmation, so an operator who opened it to
    // LOOK had to answer something or reload the page.
    // MUTATION: revert to `setShowDerived(true)` → RED.
    expect(inbox).toContain("setShowDerived((v) => !v)");
    expect(inbox).toContain("setShowGrid((v) => !v)");
  });

  it("the no-system bucket opens its questions — in the card, not a dialog", () => {
    // It opened a MODAL while the two cards beside it expanded in place: the same
    // act, three interactions. Every reveal in this Inbox now opens where it was
    // asked for.
    // MUTATION: point the reveal back at `setPeek` → RED.
    expect(inbox).toContain("label: `show the ${unattributed.weight}`");
    expect(inbox).toContain("onToggle: () => setShowOrphans((v) => !v)");
  });

  it("every reveal in the dictionary section is the card's own reveal", () => {
    // The rule the four controls broke: "review 18, confirm the types here, chase
    // crm again, and show 37 all behave differently". Three of them are REVEALS and
    // now share one implementation; the fourth is a WRITE and is drawn as one.
    const reveals = inbox.match(/reveal=\{/g) ?? [];
    expect(reveals.length, "a reveal is being hand-rolled outside IbCard").toBeGreaterThanOrEqual(3);
    // MUTATION: give the chase button `ghost` again → RED. A write must not wear a
    // reveal's clothes; it is the only one of the four that changes the record.
    expect(inbox).toContain('className="v3ib-btn sm"');
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

describe("every section of the Inbox looks and acts the same", () => {
  /**
   * "inbox - make each section look and act consistently."
   *
   * Measured before the shared header existed: five of eight sections carried an
   * ownership or source tag and three did not; ONE collapsed and seven could not;
   * seven bolded their count and "Decided" printed a bare number in prose. No single
   * header was wrong, which is why it drifted — each was written beside its own
   * section, and the next one matched only if somebody remembered.
   *
   * These read the SOURCE rather than a render, because the contract is about what a
   * section is allowed to omit, and a render only shows the sections a fixture
   * happens to populate.
   */
  const inbox = SRC("OperatorInbox.tsx");

  it("the header is one component, not eight hand-written ones", () => {
    // MUTATION: inline a header back into a section → the count below rises.
    const handWritten = inbox.match(/<header className="v3ib-h">/g) ?? [];
    expect(handWritten.length,
      `${handWritten.length} hand-written headers — every section owes the reader the same parts`)
      .toBeLessThanOrEqual(2);
  });

  it("that component gives every section a tag, a verb, a count and a disclosure", () => {
    const at = inbox.indexOf("function IbSection");
    expect(at, "the shared header is gone").toBeGreaterThan(-1);
    const body = inbox.slice(at, at + 4200);
    for (const part of ['className="v3ib-disc"', "{tag}", 'className="v3ib-verb"', 'className="v3ib-n"']) {
      expect(body, `the shared header stopped rendering ${part}`).toContain(part);
    }
    // …and the disclosure actually collapses the body, rather than only turning a caret
    expect(body).toContain("{open ? <div id={bodyId}>{children}</div> : null}");
  });

  it("the disclosure names the section it hides, not just 'show'", () => {
    // Eight identical "show" buttons is the failure the a11y guard catches elsewhere;
    // this is the rule that prevents it at the source.
    const at = inbox.indexOf("function IbSection");
    expect(inbox.slice(at, at + 4200)).toContain('aria-label={`${open ? "Hide" : "Show"} ${verb}');
  });

  it("no section spells its own plural, and a compound noun pluralises correctly", () => {
    // `unit` is singular and pluralised once, in the header — so "1 conflict" and
    // "2 conflicts" cannot disagree between sections. Appending "s" is not enough on
    // its own: "system of record" rendered as "0 system of records" on the live
    // board, which is why a unit may state its own plural.
    // MUTATION: drop `unitPlural` and always append "s" → RED.
    const at = inbox.indexOf("function IbSection");
    const body = inbox.slice(at, at + 4200);
    expect(body).toContain("count === 1 ? unit : unitPlural ?? `${unit}s`");
    expect(inbox, "the compound unit is back to appending a bare s")
      .toContain('unitPlural="systems of record"');
  });
});
