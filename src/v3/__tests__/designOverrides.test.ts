/**
 * A DECISION THAT MUST SURVIVE REGENERATION HAS TO BE DATA, NOT PIXELS.
 *
 * `prototypeBuild.html` is a snapshot: the skeleton is re-derived from the
 * ontology every run, so an operator who renamed a column and a stakeholder who
 * said "we call that Demand gen" both made decisions that lasted until the next
 * generation and then vanished without a word. The programme has solved this
 * once already for the evidence documents (`flowOperatorOverrides`); the
 * prototype was left out of that mechanism.
 *
 * The cases below are the contract, in the order the design argues it:
 *   1 · the override is worn by the build,
 *   2 · it is worn AGAIN by the next build — the whole point,
 *   3 · one that no longer resolves is NAMED, never dropped,
 *   4 · nothing is re-bound automatically, because that would move somebody's
 *       decision onto a field they never saw,
 *   5 · precedence matches the ledger's, so the two cannot disagree about who wins.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { prototypeBaselineOfProgram } from "@shared/prototypeRefine.ts";
import {
  readDesignOverrides, projectOverrides, resolveOverrides, worldOf, classifyOverride,
  targetKey, orphanGaps, type DesignOverride,
} from "@shared/designOverrides.ts";

const snap = (f: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json") as Record<string, unknown>;
const atlas = snap("current-state-atlas.json") as Record<string, unknown>;

const entityOf = (i = 0) => (ontology.entities as Array<{ name: string; attributes: unknown[] }>)[i];
const ENTITY = entityOf().name;
const ATTR = (() => {
  const a = entityOf().attributes[0];
  return typeof a === "string" ? a : String((a as { name?: unknown }).name);
})();

const override = (o: Partial<DesignOverride>): DesignOverride => ({
  id: "o1", at: "2026-08-16T10:00:00.000Z", by: "Priya", via: "operator",
  kind: "label", target: { of: "entity", entity: ENTITY }, ...o,
} as DesignOverride);

const build = (overrides: unknown) => assemblePrototype(ontology, atlas, undefined, { overrides });

/* ── 1 · worn ─────────────────────────────────────────────────────────────── */

describe("the build wears the decisions people made about it", () => {
  it("renames what an entity is called, everywhere it is called that", () => {
    const plain = build([]);
    const renamed = build([override({ value: "Demand gen" })]);
    expect(plain.html).not.toContain("Demand gen");
    expect(renamed.html).toContain("Demand gen");
    expect(renamed.overridesApplied).toBe(1);
  });

  it("renames a field without touching the key the record is stored under", () => {
    // THE LINE THAT MATTERS. A rename is a LABEL: the slug, the route, the seed's
    // own record map and every join stay on the ontology's name. If a rename
    // moved the key, the next build would seed a different application.
    const renamed = build([override({
      kind: "label", target: { of: "attribute", entity: ENTITY, attribute: ATTR }, value: "Health",
    })]);
    expect(renamed.html).toContain("Health");
    // the data island still keys the value the way the ontology spells it
    expect(renamed.html).toContain(`"${ENTITY}"`);
    expect(renamed.fabric.version).toBe(build([]).fabric.version);
  });

  it("takes a hidden field off the build — not just off the table", () => {
    // "Hidden from tables" would be a weaker promise than the control makes. A
    // field a stakeholder asked to remove, reappearing one click deeper on the
    // detail screen, is the kind of half-kept decision that costs a round.
    const plain = build([]);
    const hidden = build([override({ kind: "hide", target: { of: "attribute", entity: ENTITY, attribute: ATTR } })]);
    expect(hidden.overridesApplied).toBe(1);
    expect(hidden.html.length).toBeLessThan(plain.html.length);
    expect(hidden.html).not.toContain(`field:${ENTITY.toLowerCase()}:${ATTR.toLowerCase()}`);
    expect(plain.html).toContain(`field:${ENTITY.toLowerCase()}:${ATTR.toLowerCase()}`);
  });

  it("an untouched build is byte-identical to one that never had the mechanism", () => {
    // The guarantee every option on this assembler carries: absent, it changes
    // nothing at all.
    expect(build([]).html).toBe(assemblePrototype(ontology, atlas).html);
    expect(build(undefined).html).toBe(assemblePrototype(ontology, atlas).html);
  });
});

/* ── 2 · worn again ───────────────────────────────────────────────────────── */

describe("the next generation wears them too — the whole point", () => {
  const record = (extra: Record<string, unknown>) => ({
    domainOntology: ontology, currentStateAtlas: atlas, ...extra,
  });

  it("a rebuild from the programme's record re-applies the decision", () => {
    const stored = [override({ value: "Demand gen" })];
    // Two independent builds off the same record — the second one is what a
    // regeneration produces, and it must not be the thing that erases the first.
    const first = prototypeBaselineOfProgram(record({ designOverrides: stored }))!;
    const second = prototypeBaselineOfProgram(record({ designOverrides: stored, prototypeBuild: { html: first.html } }))!;
    expect(first.html).toContain("Demand gen");
    expect(second.html).toContain("Demand gen");
    expect(second.overridesApplied).toBe(1);
  });

  it("carries no orphan when every decision still resolves", () => {
    const clean = prototypeBaselineOfProgram(record({ designOverrides: [override({ value: "Demand gen" })] }))!;
    expect(clean.overrideOrphans).toEqual([]);
  });
});

/* ── 3 · named, never dropped ─────────────────────────────────────────────── */

describe("a decision the ontology can no longer honour is named", () => {
  it("reports the orphan with who made it and what it said", () => {
    const out = build([override({
      by: "Daniel", byRole: "Sales ops", value: "Health",
      target: { of: "attribute", entity: ENTITY, attribute: "aFieldThatWasRenamedAway" },
    })]);
    expect(out.overridesApplied).toBe(0);
    expect(out.overrideOrphans).toHaveLength(1);
    const gap = out.overrideOrphans[0];
    expect(gap).toContain("Daniel");
    expect(gap).toContain("Sales ops");
    expect(gap).toContain("Health");
    expect(gap).toContain(ENTITY);
  });

  it("distinguishes a missing entity from a missing attribute — different problems", () => {
    const world = worldOf(ontology);
    const noEntity = resolveOverrides([override({ target: { of: "entity", entity: "Nonesuch" }, value: "X" })], world);
    const noAttr = resolveOverrides([override({ target: { of: "attribute", entity: ENTITY, attribute: "gone" }, value: "X" })], world);
    expect(noEntity.orphaned[0].reason).toMatch(/no entity named/);
    expect(noAttr.orphaned[0].reason).toMatch(/no longer has an attribute/);
  });

  it("the orphan reaches the build's own gaps, on the branch that keeps the assembly", () => {
    const doc = prototypeBaselineOfProgram({
      domainOntology: ontology, currentStateAtlas: atlas,
      designOverrides: [override({ target: { of: "entity", entity: "Nonesuch" }, value: "X" })],
    })!;
    expect(doc.overrideOrphans[0]).toContain("Nonesuch");
  });
});

/* ── 4 · no silent re-binding ─────────────────────────────────────────────── */

describe("nothing is re-bound automatically", () => {
  const world = {
    entities: new Map([["Campaign", ["status"]], ["Lead", ["status"]]]),
    relations: [] as Array<[string, string]>,
  };

  it("suggests the single candidate rather than moving the decision onto it", () => {
    const res = resolveOverrides(
      [override({ target: { of: "attribute", entity: "Programme", attribute: "status" }, value: "State" })],
      { entities: new Map([["Campaign", ["status"]]]), relations: [] },
    );
    expect(res.applied.size).toBe(0);
    expect(res.orphaned[0].suggestion).toEqual({ of: "attribute", entity: "Campaign", attribute: "status" });
    expect(orphanGaps(res.orphaned)[0]).toContain("Re-point it at Campaign.status");
  });

  it("two candidates is a question, not a suggestion", () => {
    const res = resolveOverrides(
      [override({ target: { of: "attribute", entity: "Programme", attribute: "status" }, value: "State" })],
      world,
    );
    expect(res.orphaned[0].suggestion).toBeUndefined();
    expect(orphanGaps(res.orphaned)[0]).not.toContain("Re-point");
  });
});

/* ── 5 · precedence, and the shape of the log ─────────────────────────────── */

describe("the log projects to one answer per address", () => {
  it("a stakeholder's decision is not overturned by an operator editing afterwards", () => {
    // The claims ledger's own ordering — `asserted` outranks the operator —
    // applied here so the two cannot disagree about who wins.
    const held = projectOverrides([
      override({ id: "a", via: "asserted", by: "Priya", value: "Demand gen" }),
      override({ id: "b", via: "operator", by: "Ops", value: "Marketing", at: "2026-08-17T10:00:00.000Z" }),
    ]);
    expect([...held.values()][0].value).toBe("Demand gen");
  });

  it("later wins among equals", () => {
    const held = projectOverrides([
      override({ id: "a", value: "First" }),
      override({ id: "b", value: "Second" }),
    ]);
    expect([...held.values()][0].value).toBe("Second");
  });

  it("a withdrawal assembles as if the decision never happened", () => {
    // The withdrawal CLEARS the address rather than storing an opposite: a
    // "visible" instruction, or the derived name written back as a label, would
    // freeze today's ontology into the log — and that name is exactly what is
    // allowed to change upstream.
    const target = { of: "attribute" as const, entity: ENTITY, attribute: ATTR };
    const both = [
      override({ id: "a", kind: "hide", target }),
      override({ id: "b", kind: "label", target, value: "Health" }),
      override({ id: "c", kind: "reset", target }),
    ];
    expect(projectOverrides(both).size).toBe(0);
    expect(build(both).html).toBe(build([]).html);
  });

  it("an operator's withdrawal does not overturn a stakeholder's decision", () => {
    // That is an adjudication, and it belongs in the deviation register where
    // both sides are visible — not in a × on a chip.
    const target = { of: "entity" as const, entity: ENTITY };
    const held = projectOverrides([
      override({ id: "a", via: "asserted", by: "Priya", kind: "label", target, value: "Demand gen" }),
      override({ id: "b", via: "operator", by: "Ops", kind: "reset", target }),
    ]);
    expect([...held.values()].map((o) => o.value)).toEqual(["Demand gen"]);
  });

  it("a fragment is dropped rather than half-applied to a client-facing build", () => {
    expect(readDesignOverrides([
      { kind: "label", by: "Priya" },                                    // no target
      { target: { of: "entity", entity: "X" }, by: "Priya" },            // no kind
      { target: { of: "entity", entity: "X" }, kind: "label", by: "P" }, // no value
      { target: { of: "entity", entity: "X" }, kind: "label", value: "Y" }, // no author
    ])).toEqual([]);
  });

  it("one definition of what the same locus means", () => {
    expect(targetKey({ of: "attribute", entity: "Campaign", attribute: "Status" }))
      .toBe(targetKey({ of: "attribute", entity: "campaign", attribute: "status" }));
  });
});

/* ── the boundary between a label and a rule ──────────────────────────────── */

describe("presentation goes to the build; a rule goes to the spine", () => {
  it("reads a naming decision as presentation", () => {
    expect(classifyOverride("We'd call this Demand gen, not Marketing")).toBe("presentation");
    expect(classifyOverride("Put the owner column first")).toBe("presentation");
  });

  it("reads a constraint as the ontology's, not the build's", () => {
    // Routing this into an override would put a business rule in the pixels,
    // where the questions, the seed and every downstream document cannot see it.
    expect(classifyOverride("A campaign cannot be cancelled after it closes")).toBe("spine");
    expect(classifyOverride("Close date is required")).toBe("spine");
    expect(classifyOverride("Only the owner may approve it")).toBe("spine");
  });
});
