/**
 * THE TOAST NAMED A PLACE TO LOOK, AND THE PLACE HELD NOTHING LEGIBLE.
 *
 * The blob guard is the app's honesty layer for malformed data: it never
 * repairs, it reports, and the defensive readers keep the app standing while
 * the operator decides. Seeding a deliberately broken interview pack proved
 * the reporting half was hollow — the toast said
 *
 *   "…the app keeps working around it — details are in the console."
 *
 * and the console said `[blobGuard] <id> [object Object]`, roughly ten times
 * per load. Two separate failures wearing one symptom: the issue array was
 * logged as an object (unreadable), and the log sat OUTSIDE the once-per-
 * programme gate that the toast already had (repeated).
 *
 * A promise of detail that delivers none is worse than staying silent — it
 * spends the operator's trust and their time. So the format has ONE
 * definition, `formatBlobIssues`, and both halves are held here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateProgramBlob, formatBlobIssues } from "@/v3/lib/blobGuard";

describe("the design-round key is validated, and validated at the right depth", () => {
  it("a well-formed round passes", () => {
    expect(validateProgramBlob({
      flowDesignRounds: [{ id: "r1", ordinal: 1, participants: [{ name: "Priya", role: "Delivery" }] }],
    })).toEqual([]);
  });

  it("a round with no id is malformed — it cannot be addressed", () => {
    const issues = validateProgramBlob({ flowDesignRounds: [{ ordinal: 1 }] });
    expect(issues.map((i) => i.key)).toContain("flowDesignRounds");
  });

  it("a participant with no name is malformed — it resolves to nobody", () => {
    const issues = validateProgramBlob({
      flowDesignRounds: [{ id: "r1", participants: [{ role: "Delivery" }] }],
    });
    expect(issues.map((i) => i.key)).toContain("flowDesignRounds");
  });

  it("the whole key being the wrong TYPE is caught", () => {
    expect(validateProgramBlob({ flowDesignRounds: { id: "r1" } }).map((i) => i.key))
      .toContain("flowDesignRounds");
  });

  it("HISTORY is not malformed — a row written before a later field existed still parses", () => {
    // The same rule flowAttestations follows. A verdict with no `attestation`
    // is an OLD row, not a corrupt one; refusing to WRITE one without it is the
    // round module's job, and enforcing it here would flag real history as
    // broken and send an operator hunting for damage that isn't there.
    expect(validateProgramBlob({
      flowDesignRounds: [{ id: "r1", participants: [{ name: "Priya", response: { at: "2026-08-11", verdict: "approved" } }] }],
    })).toEqual([]);
  });

  it("an unknown FUTURE field is fine — the guard is forward compatible", () => {
    expect(validateProgramBlob({
      flowDesignRounds: [{ id: "r1", participants: [{ name: "Priya" }], somethingAddedLater: true }],
    })).toEqual([]);
  });
});

describe("blob issues are reported readably", () => {
  it("renders every issue as text naming the key and the reason", () => {
    // A pack list that is not a list, and comments whose entries lack an id —
    // the exact shape family the seeded programme hit.
    const issues = validateProgramBlob({
      flowInterviewPacks: "not-a-list",
      flowComments: [{ text: "orphan" }],
    });
    expect(issues.length).toBeGreaterThan(0);

    const text = formatBlobIssues(issues);
    // The whole point: a human can read what broke without opening a debugger.
    expect(text).not.toContain("[object Object]");
    for (const issue of issues) {
      expect(text).toContain(issue.key);
      expect(text).toContain(issue.reason);
    }
    // One line per issue, so a long list stays scannable.
    expect(text.split("\n")).toHaveLength(issues.length);
  });

  it("says nothing when nothing is wrong", () => {
    expect(formatBlobIssues(validateProgramBlob({ flowComments: [{ id: "c1", text: "fine" }] }))).toBe("");
  });

  it("logs the formatted text, once per programme, inside the same gate as the toast", () => {
    // Source scan: the effect is an inline hook in the live shell, and what
    // must hold is a placement fact — the warn sits inside the
    // `blobWarned` gate and passes formatted text, not the raw array.
    const shell = readFileSync(resolve(__dirname, "../AppShellV3.tsx"), "utf8");
    const start = shell.indexOf("const issues = validateProgramBlob(inner);");
    expect(start, "blob guard effect not found — re-anchor this scan").toBeGreaterThan(-1);
    const effect = shell.slice(start, shell.indexOf("}, [activeProgram?.id", start));

    expect(effect).toContain("formatBlobIssues(issues)");
    expect(effect, "the raw issue array is being logged again — that prints [object Object]")
      .not.toMatch(/console\.warn\([^)]*,\s*issues\s*\)/);

    const gate = effect.indexOf("blobWarned.current.add");
    const warn = effect.indexOf("console.warn");
    expect(gate, "the once-per-programme gate is gone").toBeGreaterThan(-1);
    expect(warn, "the console warning must sit INSIDE the once-per-programme gate, or it spams every render")
      .toBeGreaterThan(gate);
  });
});
