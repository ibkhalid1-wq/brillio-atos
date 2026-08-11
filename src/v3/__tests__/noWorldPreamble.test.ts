/**
 * NO "IN YOUR WORLD" PREAMBLE.
 *
 * A relation's meaning question opened with `In ${your} world, …`, where `your`
 * is the audience switch — "your" for a stakeholder, "the" for an operator. Two
 * problems, one line:
 *
 *   · to a stakeholder it was filler. The question already asks what the
 *     connection means to them; the preamble adds words without adding an ask.
 *   · to an OPERATOR it was broken English: "In the world, what does the
 *     connection between Account and Opportunity mean, exactly?" Nobody wrote
 *     that sentence on purpose — it fell out of a shared template.
 *
 * Removing it also makes the two meaning questions parallel. An ENTITY is asked
 * "What does X mean, exactly?"; a RELATION is now asked the same question about
 * a different kind of thing, and sounds like it.
 *
 * `${your}` is still correct in the two places that earn it — "One step in your
 * process is…" and "Which phase of your process…" — where the possessive marks
 * whose workflow is being described. This test does not touch those.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { renderQuestion } from "@/v3/lib/ledger/renderQuestion";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";

const dir = resolve(__dirname, "../../../docs/laila/snapshot-2026-08-07");
const read = (f: string): Record<string, unknown> => {
  const raw = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as Record<string, unknown>;
  const nested = (raw as { data?: unknown }).data;
  return (nested && typeof nested === "object" ? nested : raw) as Record<string, unknown>;
};
const laila = (): Snapshot => ({
  ontology: read("domain-ontology.json"),
  atlas: read("current-state-atlas.json"),
  overrides: JSON.parse(readFileSync(resolve(dir, "operator-overrides.json"), "utf8")) as Array<Record<string, unknown>>,
});

describe("generated questions carry no world preamble", () => {
  const store = migrate(laila());
  const all = buildUnknownQueue(store).items.map((i) => i.about);
  const semantics = all.filter((a) => a.endsWith("#semantics"));

  it("the record actually holds relation meaning questions (not a vacuous scan)", () => {
    const relational = semantics.filter((a) => a.startsWith("el:rel:"));
    expect(relational.length).toBeGreaterThan(0);
  });

  for (const audience of ["stakeholder", "operator"] as const) {
    it(`no ${audience} question anywhere says "in your world" or "in the world"`, () => {
      const offenders = all
        .map((about) => renderQuestion(store, about, audience).question)
        .filter((q) => /\bin (your|the) world\b/i.test(q));
      expect(offenders, `preamble survives in: ${offenders.slice(0, 3).join(" | ")}`).toEqual([]);
    });
  }

  it("a relation's meaning question reads like an entity's — same ask, different subject", () => {
    const rel = semantics.find((a) => a.startsWith("el:rel:"))!;
    const q = renderQuestion(store, rel, "stakeholder").question;
    expect(q).toMatch(/^What does the connection between .+ and .+ mean, exactly\?$/);
  });

  it("both audiences get the SAME meaning question — nothing here varies by reader", () => {
    for (const about of semantics.filter((a) => a.startsWith("el:rel:")).slice(0, 20)) {
      expect(renderQuestion(store, about, "stakeholder").question)
        .toBe(renderQuestion(store, about, "operator").question);
    }
  });

  it("the possessive SURVIVES where it earns its place — step and phase questions", () => {
    // Guard against over-correction: this change removes one preamble, not the
    // audience switch itself.
    const steps = all.filter((a) => a.startsWith("el:step:"));
    if (steps.length) {
      expect(renderQuestion(store, steps[0], "stakeholder").question).toContain("your process");
      expect(renderQuestion(store, steps[0], "operator").question).toContain("the process");
    }
    const phase = all.find((a) => a.endsWith("#phase"));
    if (phase) {
      expect(renderQuestion(store, phase, "stakeholder").question).toContain("your process");
      expect(renderQuestion(store, phase, "operator").question).toContain("the process");
    }
  });
});
