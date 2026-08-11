/**
 * NUMBERS THAT WERE ARITHMETICALLY RIGHT AND HUMANLY WRONG.
 *
 * Each of these shipped, rendered, and read as a broken screen to the person
 * looking at it — an overdue programme counting "-17d to demo", a 100-word
 * transcript weighing "0.1k words", an executive KPI reading "0/?". None was a
 * crash; all of them cost trust in the number beside them.
 *
 * The rules now live as pure exported functions on FlowShell, one definition
 * each, so every surface that renders these numbers phrases them identically
 * and a test can hold the phrasing. The source-level checks at the bottom cover
 * the two fixes that ARE the markup (FlowShell mounts the whole app graph, so
 * rendering it here would test the mocks — see oneFlowView.test.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { demoCountdown, evidenceVolume, kpiRatio } from "@/v3/components/flow/FlowShell";

const SHELL = resolve(__dirname, "../components/flow/FlowShell.tsx");
const shell = readFileSync(SHELL, "utf8");

describe("demoCountdown — overdue is a word, never a minus sign", () => {
  it("renders an overdue programme as '17d overdue', not '-17d to demo'", () => {
    const past = demoCountdown(-17);
    expect(past.short).toBe("17d overdue");
    expect(past.short).not.toContain("-");
    expect(past.overdue).toBe(true);
    expect(past.magnitude).toBe(17);
  });

  it("agrees with the hero line's long form — the same direction, the same words", () => {
    // The hero already said it properly; the short form now shares its
    // vocabulary instead of inventing a second one.
    expect(demoCountdown(-17).phrase).toBe("past the first-demo target");
    expect(demoCountdown(12).phrase).toBe("to first demo");
    expect(demoCountdown(12).short).toBe("12d to demo");
  });

  it("never renders a negative magnitude anywhere a count is shown", () => {
    for (const days of [-90, -17, -1, 0, 1, 45]) {
      expect(demoCountdown(days).magnitude).toBeGreaterThanOrEqual(0);
    }
  });

  it("an unset date says so — it does not become day zero", () => {
    expect(demoCountdown(null).known).toBe(false);
    expect(demoCountdown(null).short).toBe("no demo date");
    expect(demoCountdown(null).phrase).toBe("first-demo date unset");
  });

  it("every countdown surface reads through it — no site re-derives the sign", () => {
    expect(shell).not.toMatch(/\$\{s?\.?days\}d to demo/);
    expect(shell).not.toMatch(/days >= 0 \? "to first demo"/);
  });
});

describe("evidenceVolume — the 'k' only when it earns its place", () => {
  it("THE BUG: a 100-word transcript is '100 words', not '0.1k words'", () => {
    expect(evidenceVolume(100, 1)).toBe("100 words");
    expect(evidenceVolume(999, 3)).toBe("999 words");
    expect(evidenceVolume(100, 1)).not.toContain("k");
  });

  it("keeps the compact form where it reads sensibly", () => {
    expect(evidenceVolume(1000, 2)).toBe("1.0k words");
    expect(evidenceVolume(19314, 40)).toBe("19k words");
  });

  it("falls back to the item count only when there is barely any text", () => {
    expect(evidenceVolume(0, 2)).toBe("2 items");
    expect(evidenceVolume(40, 1)).toBe("1 item");
  });
});

describe("kpiRatio — an executive KPI never renders a '?'", () => {
  it("THE BUG: no demonstrations scheduled reads in words, not '0/?'", () => {
    const kpi = kpiRatio(0, 0, "demonstrations accepted", "no demonstrations scheduled yet");
    expect(kpi.of).toBeNull();
    expect(kpi.label).toBe("no demonstrations scheduled yet");
    expect(`${kpi.value}${kpi.of ?? ""}`).not.toContain("?");
  });

  it("invents no denominator — the unknown total is absent, not guessed", () => {
    // A fabricated "0/1" or "0/5" would read complete and be a lie; the honest
    // shape is a stood-down number and a label that says why.
    expect(kpiRatio(0, 0, "x", "none yet").value).toBe("—");
  });

  it("shows the real ratio the moment there is one", () => {
    const kpi = kpiRatio(3, 8, "demonstrations accepted", "no demonstrations scheduled yet");
    expect(kpi.value).toBe("3");
    expect(kpi.of).toBe("/8");
    expect(kpi.label).toBe("demonstrations accepted");
  });

  it("no Pulse KPI still falls back to a literal question mark", () => {
    expect(shell).not.toMatch(/\|\| "\?"/);
  });
});

describe("the copy fixes that ARE the markup", () => {
  it("an unfamiliar role names the vocabulary it is missing from, not the programme", () => {
    // "Finance" fired «isn't a role this programme recognises» on a programme
    // whose ledger was routing five open questions to Finance. Two vocabularies
    // (the Discovery Kit's cast vs the ledger's functions) were being surfaced
    // through one word, so the app contradicted itself.
    expect(shell).not.toMatch(/isn&rsquo;t a role this programme recognises/);
    expect(shell).toMatch(/isn&rsquo;t in the Discovery Kit&rsquo;s cast/);
  });

  it("the Pulse KPI strip measures progress, not volume of text", () => {
    // 19,314 words of evidence is not an outcome. The slot now shows track
    // pace — a number already defined by computePfStats, not a new one.
    expect(shell).not.toMatch(/words of evidence/);
    expect(shell).not.toMatch(/wordsOfEvidence/);
    expect(shell).toMatch(/const pf = computePfStats\(program\)/);
  });

  it("opening a programme and renaming it stay separate gestures, keyboard included", () => {
    // Rename is armed only by its own pencil. The head's key handler ignores
    // events that bubbled up from a nested control — without that, Enter on
    // "Rename" armed the rename and immediately navigated off the card.
    //
    // The guard used to be written inline on this ONE row, and was pinned here as
    // source text. The accessibility audit (2026-08-11) found the other four
    // role="button" rows had never been given it — two of them nest a real button —
    // so the rule moved into a single `rowActivate` helper that every row now uses.
    // This still pins the card, through the helper; the BEHAVIOUR it protects (Enter
    // and Space both activate, a key on a nested control does not) is now asserted
    // against the live DOM in a11yFlowKeyboard.test.ts.
    const head = shell.slice(shell.indexOf('className="v3fs-pf-head"'));
    const keyDown = head.slice(head.indexOf("onKeyDown"), head.indexOf("onKeyDown") + 220);
    expect(keyDown).toMatch(/rowActivate\(/);
    expect(shell).toMatch(/const rowActivate = [\s\S]{0,240}e\.target !== e\.currentTarget/);
    expect(shell).toMatch(/aria-label=\{`Rename \$\{entry\.name\}`\}/);
  });
});
