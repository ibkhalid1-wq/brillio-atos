/**
 * THE CACHE MUST CHANGE THE SPEED AND NOTHING ELSE.
 *
 * `renderQuestion` is the SINGLE producer of question text, so an optimisation
 * here is the most dangerous kind of change in this codebase: a silent wording
 * difference would propagate to the operator queue, the kit, the burn-down drill
 * and the stakeholder's linked page at once, and every one of them would agree
 * with the others while all being wrong.
 *
 * So the property under test is not "the cache is fast" — it is "the cache is
 * INVISIBLE". Every locus, both audiences, both programmes, rendered with and
 * without a cache, compared field by field.
 *
 * The staleness question is settled by construction rather than by assertion:
 * the cache is created and discarded inside one synchronous pass, so it cannot
 * observe two different states of the store. The test below still proves the
 * dangerous case explicitly — a cache reused across a MUTATION must not serve
 * the old name — because "by construction" is exactly the kind of claim that
 * stops being true when someone later hoists a cache to module scope.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";
import { renderQuestion, groupQuestions, createRenderCache } from "@/v3/lib/ledger/renderQuestion";

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

describe("the render cache is transparent", () => {
  const store = migrate(laila());
  const abouts = buildUnknownQueue(store).items.map((i) => i.about);

  it("has a corpus big enough to matter (not a vacuous comparison)", () => {
    expect(abouts.length).toBeGreaterThan(100);
  });

  for (const audience of ["operator", "stakeholder"] as const) {
    it(`renders every ${audience} locus identically with and without a cache`, () => {
      const cache = createRenderCache();
      const diffs: string[] = [];
      for (const about of abouts) {
        const cold = renderQuestion(store, about, audience);
        const warm = renderQuestion(store, about, audience, cache);
        if (JSON.stringify(cold) !== JSON.stringify(warm)) diffs.push(about);
      }
      expect(diffs, `cache changed the output for: ${diffs.slice(0, 5).join(", ")}`).toEqual([]);
    });
  }

  it("groupQuestions (which now caches internally) is unchanged field for field", () => {
    // Compare against the per-locus renders it is built from — the grouping must
    // still carry exactly the same question objects.
    const grouped = groupQuestions(store, abouts, "stakeholder");
    const flat = grouped.flatMap((g) => g.questions);
    expect(flat).toHaveLength(abouts.length);
    const byAbout = new Map(flat.map((q) => [q.id, q]));
    for (const about of abouts) {
      expect(JSON.stringify(byAbout.get(about))).toBe(JSON.stringify(renderQuestion(store, about, "stakeholder")));
    }
  });

  it("A STALE CACHE IS DETECTABLE — reusing one across a rename serves the OLD name", () => {
    // This is the failure mode the per-pass design avoids, demonstrated so that
    // hoisting the cache to module scope stops looking harmless. It documents a
    // hazard; it does not bless the behaviour.
    const s2 = migrate(laila());
    const target = buildUnknownQueue(s2).items[0].about;
    const cache = createRenderCache();
    const before = renderQuestion(s2, target, "operator", cache).elementName;

    const el = s2.elements().find((e) => target.startsWith(`${e.id}#`))!;
    s2.addElement({ ...el, name: `${el.name} RENAMED` });

    expect(renderQuestion(s2, target, "operator", cache).elementName, "a REUSED cache serves the old name").toBe(before);
    expect(renderQuestion(s2, target, "operator").elementName, "a fresh pass sees the rename").toContain("RENAMED");
  });

  it("no caller holds a cache beyond one synchronous pass", () => {
    // The structural guarantee behind the test above: `createRenderCache` may
    // only be called inside a function body, never at module scope where it
    // would outlive the store's state.
    const src = readFileSync(resolve(__dirname, "../lib/ledger/renderQuestion.ts"), "utf8");
    for (const line of src.split("\n")) {
      if (!line.includes("createRenderCache()")) continue;
      if (line.includes("export const createRenderCache")) continue;
      expect(line, `a cache is created at module scope: ${line.trim()}`).toMatch(/^\s+/);
    }
  });
});
