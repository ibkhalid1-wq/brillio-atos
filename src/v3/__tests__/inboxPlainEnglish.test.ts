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
    expect(grid).toContain("the weakest thing on it");
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

describe("a count you cannot open is not an answer", () => {
  /**
   * "what questions?" — asked of "Executive Sponsor · 7". The row printed a COUNT and
   * a hand-over control and nothing else, while every card beside it could be opened,
   * so the one thing an operator needs before handing seven questions to a colleague
   * — WHICH seven — was the one thing the surface would not say.
   */
  const inbox = SRC("OperatorInbox.tsx");

  it("each unbound role is a card that opens its own questions", () => {
    // MUTATION: revert to the one-line strip → RED.
    expect(inbox, "the role strip is back to a bare count").not.toContain('className="v3ib-unbound-row"');
    expect(inbox).toContain("label: `show the ${owner.open}`");
    expect(inbox, "it must list the role's OWN loci, not a re-derived set")
      .toContain("<QuestionList abouts={owner.abouts} assignable />");
  });

  it("the hand-over is still a write, and still commits every one of them", () => {
    expect(inbox).toContain("owner.abouts.map((about) => assignAction(about, picked!))");
  });

  it("and each question can go to a different person", () => {
    // Seven questions about two different workflows are not always one person's, and
    // the bulk act was the ONLY act — so routing them separately meant handing all
    // seven to somebody and reassigning six afterwards.
    // MUTATION: drop the `assignable` branch → RED.
    expect(inbox).toContain('className="v3ib-qrow-assign"');
    expect(inbox, "the per-row act must write through the same assign the bulk one uses")
      .toContain("run(about, assignAction(about, pickedOwner(about)!))");
  });
});

describe("the Inbox has ONE scale", () => {
  /**
   * "refine and polish inbox for a premium consistent UX." Measured off the running
   * page before touching anything: SEVEN button variants (the same small button at
   * 10px/2px 8px in twelve places and 11px/4px 11px in two), TWO select sizes, SIX
   * corner radii (4, 6, 7, 9, 11, 999) and type at 9, 10, 10.5, 11, 11.5, 12.5, 13.
   *
   * None of it wrong on its own — all of it arrived one component at a time, and the
   * sum is what reads as unfinished. These assert the scale exists in the stylesheet
   * rather than re-measuring a render, so a new component that reaches for its own
   * size has something to be wrong against.
   */
  const css = readFileSync(resolve(__dirname, "../components/flow/theLine.css"), "utf8");

  it("declares four type sizes, three radii and one control height — for the PRODUCT", () => {
    // The scale began as `--ib-*` while only the Inbox used it. Discover now reads the
    // same values, so it is named for the product; the `--ib-*` names stay as aliases
    // because forty Inbox rules already reference them and renaming those to prove a
    // point would be churn, not consistency.
    // MUTATION: delete the :root block → RED.
    for (const token of ["--aura-t-meta:10px", "--aura-t-body:11px", "--aura-t-title:12px",
                         "--aura-t-head:13px", "--aura-r-ctl:6px", "--aura-r-box:10px",
                         "--aura-ctl-h:26px"]) {
      expect(css, `the scale lost ${token}`).toContain(token);
    }
    // …and the aliases still resolve, or every Inbox rule silently loses its size.
    expect(css).toContain("--ib-t-meta:var(--aura-t-meta)");
    expect(css).toContain("--ib-ctl-h:var(--aura-ctl-h)");
  });

  it("a button and a select set beside each other are the same height", () => {
    // Padding alone left a button at 23.9px next to a select at 25px — a 1.1px step
    // nobody can name and everybody sees, on a row where the two read as one control.
    // MUTATION: drop the min-height rule → RED.
    expect(css).toContain(".v3ib .v3ib-btn,.v3ib select{box-sizing:border-box;");
    expect(css).toContain("min-height:var(--ib-ctl-h)");
  });

  it("no Inbox rule sets a half-pixel or one-off size", () => {
    // The sizes that existed only once each: 9px, 10.5px, 11.5px, 12.5px.
    const inboxRules = css.split("\n").filter((l) => l.startsWith(".v3ib"));
    for (const bad of ["font-size:9px", "font-size:10.5px", "font-size:11.5px", "font-size:12.5px"]) {
      const offenders = inboxRules.filter((l) => l.includes(bad));
      expect(offenders, `${bad} is back in: ${offenders[0] ?? ""}`).toHaveLength(0);
    }
  });

  it("no Inbox rule sets a radius outside the three", () => {
    const inboxRules = css.split("\n").filter((l) => l.startsWith(".v3ib"));
    for (const bad of ["border-radius:4px", "border-radius:7px", "border-radius:9px", "border-radius:11px"]) {
      const offenders = inboxRules.filter((l) => l.includes(bad));
      expect(offenders, `${bad} is back in: ${offenders[0] ?? ""}`).toHaveLength(0);
    }
  });
});

describe("the Inbox has one type system, not just one type scale", () => {
  /**
   * "inbox font is not refined." Fixing the SIZES had left the page still reading as
   * unfinished, which is the usual result of fixing sizes alone. Measured again, on
   * the text nodes only:
   *
   *   SIX weights          400, 600, 650, 700, 750, 800 — 650 and 750 are arbitrary
   *                        stops nobody chose
   *   FIVE line-heights    at 11px alone, so two paragraphs of one size sat on
   *                        different leading
   *   FIVE letter-spacings including −0.07px across forty-eight elements of BODY
   *                        text: negative tracking belongs to display sizes, and at
   *                        10–11px it closes the counters and reads as smudged
   *   ITALICS at 10px      a texture, not an emphasis
   */
  const css = readFileSync(resolve(__dirname, "../components/flow/theLine.css"), "utf8");
  const inboxRules = css.split("\n").filter((l) => l.startsWith(".v3ib"));

  it("uses three weights", () => {
    // MUTATION: put a 650 or 750 back → RED.
    for (const bad of ["font-weight:650", "font-weight:750", "font-weight:800"]) {
      const offenders = inboxRules.filter((l) => l.includes(bad));
      expect(offenders, `${bad} is back in: ${offenders[0] ?? ""}`).toHaveLength(0);
    }
  });

  it("sets its leading once and lets it inherit", () => {
    expect(css).toContain(".v3ib{line-height:1.5;font-variant-numeric:tabular-nums}");
  });

  it("tracks only the uppercase micro-labels", () => {
    // Caps set solid are hard to read at 10px; everything else is set normal, which
    // is what clears the −0.07px the body text was carrying.
    expect(css).toContain(".v3ib,.v3ib *{letter-spacing:normal}");
    expect(css).toMatch(/\.v3ib-qtype,\.v3ib \.v3ib-peek-tag[^\n]*letter-spacing:\.055em/);
  });

  it("does not use italic as emphasis", () => {
    expect(css).toContain(".v3ib .v3ib-unit,.v3ib .v3ib-peek-src{font-style:normal}");
  });

  it("brings the shared claim chips onto the scale INSIDE the Inbox only", () => {
    // Those chips carry the app's own weights and the appbar and hero are built on
    // them — restyling every surface to settle one board would be the wrong trade.
    expect(css).toContain(".v3ib .v3lc-src,.v3ib .v3lc-status,.v3ib .v3lc-own{font-weight:600}");
  });
});

describe("Discover reads and the Inbox acts — one system, one boundary", () => {
  /**
   * Run under the inbox + Discover redesign briefs. The load-bearing rule in both:
   * Discover is comprehension, the Inbox is action, and anything needing an operator
   * MOVE is stated on Discover and routed — never performed there.
   */
  const line = SRC("TheLine.tsx");
  const inbox = SRC("OperatorInbox.tsx");
  const css = readFileSync(resolve(__dirname, "../components/flow/theLine.css"), "utf8");

  it("no operator write is left on Discover", () => {
    // The two that were: confirming a lifecycle's stages, and applying an attached
    // file as a data dictionary. Both answer open questions programme-wide at the
    // strength a schema carries.
    // MUTATION: put either back → RED.
    expect(line, "a dictionary write is back on Discover").not.toContain("commitDictionary(csv");
    expect(line, "a dictionary write is back on Discover").not.toContain("commitDictionary(capDict");
  });

  it("each removed act is stated on Discover and routed to the Inbox", () => {
    // A boundary enforced by deletion alone would just lose the operator the act.
    // The lifecycle handoff went with the strip that carried it (2026-08-13): once
    // stage questions routed to their owners, every row on that strip pointed at the
    // person cards below it, so the strip was a second axis over the same facts.
    expect(line).toContain("apply it in the Inbox");
    expect(line, "the route needs somewhere to go").toContain("onOpenInbox");
  });

  it("and the Inbox actually carries the act it was handed", () => {
    // The failure this whole session has been clearing: a route that points at
    // nothing. Confirming stages did not exist on the Inbox until it was moved there.
    // MUTATION: delete the stage card → RED, and the handoff becomes a dead end.
    expect(inbox).toContain("confirm these stages");
    expect(inbox, "same CSV, same merge — a person's answer and a schema's must not diverge")
      .toContain("entity,field,values");
  });

  it("both surfaces reference ONE token set", () => {
    expect(css).toContain("--aura-t-body:11px");
    expect(css).toContain(".v3ln,.v3ln *{letter-spacing:normal}");
    expect(css).toContain(".v3ib,.v3ib *{letter-spacing:normal}");
    // one focus ring, one control height, both surfaces
    expect(css).toContain(".v3ib :focus-visible,.v3ln :focus-visible");
    expect(css).toContain(".v3ib select,.v3ln select{border-radius:var(--aura-r-ctl);height:var(--aura-ctl-h)}");
  });

  it("motion is one duration and honours reduced-motion", () => {
    expect(css).toContain("--aura-motion:160ms");
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[\s\S]{0,80}--aura-motion:0ms/);
  });

  it("does NOT grow a second empty state — the shell already owns that one", () => {
    // The redesign brief asks for a crafted zero state. One already exists, one level
    // up: the shell draws "Nothing needs you right now", gated on the same `rendered`
    // count, with a documented history of getting that predicate right. A card was
    // added here anyway and two standing guards caught it inside a minute.
    // MUTATION: add an empty state to the Inbox again → RED.
    // The comment explaining WHY still names it, so the check is for the markup.
    expect(inbox, "a second empty state for one condition").not.toContain('className="v3ib-clear"');
    expect(inbox, "the Inbox draws nothing and lets the shell speak")
      .toContain("if (queue.rendered === 0) return null;");
  });
});

describe("a question list states its subject once", () => {
  /**
   * "repeating". Four questions about one atlas step each restated the whole step:
   *
   *   One step in the process is: "Review pipeline, forecast, and performance
   *   reports; monitor commit, most likely, and stretch buckets." Who does this step?
   *   One step in the process is: "Review pipeline, forecast, and performance
   *   reports; monitor commit, most likely, and stretch buckets." What decides…?
   *
   * — the same forty words, four times, with six words of difference at the end.
   */
  const inbox = SRC("OperatorInbox.tsx");

  it("groups the rows by the element they are about", () => {
    // MUTATION: drop the grouping and map `abouts` flat → RED.
    expect(inbox).toContain("const groups: Array<{ id: string; abouts: string[] }> = [];");
    expect(inbox).toContain("const id = elementIdOf(about);");
  });

  it("derives the shared opening from the questions, not from how they were phrased", () => {
    // It could have re-implemented renderQuestion's prefixes and drifted from them
    // the first time one changed. Whatever the questions actually share is the
    // subject, so this can shorten a row but never invent a heading.
    expect(inbox).toContain("const sharedOpening = (questions: readonly string[]): string =>");
    expect(inbox, "a group of one has nothing to share and keeps its question whole")
      .toContain("if (questions.length < 2) return \"\";");
  });

  it("cuts the heading at a sentence end, never mid-clause", () => {
    expect(inbox).toContain('common.lastIndexOf(". ")');
    expect(inbox).toContain("cut > 20 ?");
  });

  it("and the row prints only what is left, when there is a shared opening", () => {
    // MUTATION: always print `q.question` → RED, and the wall of repetition is back.
    expect(inbox).toContain("q.question.slice(opening.length).trim()");
  });
});
