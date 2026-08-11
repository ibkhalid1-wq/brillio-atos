/**
 * THE TWO FIXES THE BOUNDED AGENTS CORRECTLY REFUSED TO MAKE.
 *
 * Both were reported rather than edited because each sat outside the file an
 * agent owned — and in one case because making it *inside* that file would
 * have been a fabrication. Holding them here, together, keeps the reasoning
 * attached to the code.
 *
 * 1. THE INVITATION EMAIL. Fixing "Hi Head," on the linked page left the same
 *    truncation in `mailtoLink` — its own private copy of `split(" ")[0]`. The
 *    email is the artefact that actually lands in an executive's inbox, so the
 *    page was fixed and the worse instance shipped on. One rule, one
 *    definition, both surfaces.
 *
 * 2. THE TOKEN CAP. Control renders "· no cap" for every movement, and none is
 *    set anywhere. The tempting fix — a default in the view — is a lie twice
 *    over: enforcement lives in the edge (`run-agent`: `if (movementCap > 0)`),
 *    so a ceiling rendered here enforces nothing; and any default below a
 *    movement's existing spend would halt live work the moment it landed
 *    (Listen has already spent ~4.9M tokens). So the fix proposes from
 *    MEASURED spend and leaves the write to the operator.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mailtoLink } from "@/v3/components/flow/flowMeetings";
import { recommendedCap } from "@/v3/components/flow/FlowShell";

const bodyOf = (link: string): string =>
  decodeURIComponent((link.split("body=")[1] ?? "").replace(/\+/g, " "));

const invite = (stakeholder: string) =>
  bodyOf(mailtoLink("x@example.com", { stakeholder, programmeName: "Meridian", link: "https://example.com/r" }));

describe("the invitation email greets like the page does", () => {
  it("does not greet an executive by the first word of their job title", () => {
    const body = invite("Head of Sales");
    expect(body).not.toContain("Hi Head,");
    expect(body).toContain("Hi Head of Sales,");
  });

  it("still uses a first name when the recipient is a person", () => {
    // The behaviour flowLibs.test.ts:2750 pins — a real name is shortened.
    expect(invite("Dan Whitfield")).toContain("Hi Dan,");
  });

  it("never lets the stored placeholder token reach an inbox", () => {
    const body = invite("Finance SME — TBC");
    expect(body).not.toContain("TBC");
    expect(body).not.toContain("Hi Finance,");
    // Nobody is named yet, so nobody is named — a neutral opener, not an
    // invented recipient.
    expect(body.split("\n")[0]).toBe("Hello,");
  });

  it("reads the shared rule instead of keeping a private copy", () => {
    const src = readFileSync(resolve(__dirname, "../components/flow/flowMeetings.ts"), "utf8");
    expect(src).toContain("greetingName(");
    expect(src, "a second truncation rule has grown back").not.toMatch(/stakeholder\.split\(" "\)\[0\]/);
  });
});

describe("token caps are proposed from spend, never invented", () => {
  it("proposes real headroom above what a movement has already spent", () => {
    const spent = 4_896_308;                       // Listen, on the live programme
    const cap = recommendedCap(spent);
    // Not merely "above spend" — rounding alone would clear that bar while
    // leaving the movement one run from a halt. The headroom has to be real
    // enough that accepting the suggestion doesn't stop work tomorrow.
    expect(cap, "a cap at or barely above current spend would halt the movement almost at once")
      .toBeGreaterThan(spent * 1.25);
    expect(cap).toBeLessThan(spent * 2);           // headroom, not a blank cheque
  });

  it("gives an unstarted movement a floor rather than zero", () => {
    // 0 means UNCAPPED everywhere in this codebase — proposing it would be
    // proposing nothing while looking like a decision.
    expect(recommendedCap(0)).toBeGreaterThan(0);
    expect(recommendedCap(null)).toBe(recommendedCap(0));
  });

  it("proposes round numbers a human would choose", () => {
    for (const spent of [0, 1_207_550, 4_896_308, 62_342]) {
      expect(recommendedCap(spent) % 50_000, `${spent} → ${recommendedCap(spent)}`).toBe(0);
    }
  });

  it("rises with spend, so a busy movement is not capped like an idle one", () => {
    expect(recommendedCap(5_000_000)).toBeGreaterThan(recommendedCap(1_000_000));
  });

  it("only DRAFTS the cap — the operator still writes it", () => {
    const src = readFileSync(resolve(__dirname, "../components/flow/FlowShell.tsx"), "utf8");
    const start = src.indexOf("Suggest caps from spend");
    expect(start, "the suggest control is gone").toBeGreaterThan(-1);
    // Walk back to the button's own onClick — it must touch drafts only.
    const handler = src.slice(src.lastIndexOf("onClick", start), start);
    expect(handler).toContain("setCapDrafts");
    expect(handler, "the suggestion writes a cap directly instead of drafting one")
      .not.toContain("onSetMovementBudget");
  });
});
