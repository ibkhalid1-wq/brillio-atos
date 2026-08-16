/**
 * AN EMPTY SECTION MUST CITE THE ASSUMPTION THAT PRODUCED IT.
 *
 * "No Escalation yet" is the weakest state a screen has, and it was also a lie
 * of omission: the zero is not something the generator FOUND, it is something
 * it GUESSED — the seeder assumed a fan-out of 0–5 per parent, wrote that
 * assumption down with the Listen question that settles it, and then the
 * prototype rendered the guess as if it were a finding.
 *
 * The methodology's own claim is that a gap is evidence to collect. So the
 * declared assumption is rendered WITH the hole: "No Escalation yet — assumed
 * 0–5 per Account; confirm in Listen." A miss stays visible, and the emptiest
 * card on the page becomes the one that does the most work.
 *
 * The property pinned here is not "some prose appears near the word No". It is
 * that each empty region cites THE assumption for ITS OWN relation — resolved
 * from the region's `data-fabric-id` to the fabric node's relation pair to the
 * assumption `generateSeed` actually declared for that pair.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { generateSeed, type SeedAssumption } from "@shared/seedData.ts";
import { renderedDoc } from "./helpers/renderPrototype";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json") as Record<string, unknown>;
const atlas = snap("current-state-atlas.json") as Record<string, unknown>;

const fabric = deriveFabric(ontology, atlas);
const seed = generateSeed(ontology, fabric.version);
const doc = renderedDoc(assemblePrototype(ontology, atlas).html);

/** Every empty state on the build, paired with the region it sits inside. */
const emptyRegions = Array.from(doc.querySelectorAll(".m-empty")).map((el) => {
  const region = el.closest("[data-fabric-id]");
  return { el, id: region?.getAttribute("data-fabric-id") ?? "", text: (el.textContent ?? "").replace(/\s+/g, " ").trim() };
});

/** The assumption the SEED declared for this region's relation — looked up by
 *  the pair the fabric node carries, never by rebuilding the prose subject. */
const assumptionsFor = (id: string): SeedAssumption[] => {
  const node = fabric.nodes.find((n) => n.id === id);
  const rel = node?.source.relation;
  if (!rel) return seed.assumptions.filter((a) => !a.pair && a.subject === node?.source.entity);
  return seed.assumptions.filter((a) => a.pair && a.pair[0] === rel[0] && a.pair[1] === rel[1]);
};

describe("empty states teach", () => {
  it("the fixture actually reaches an empty state", () => {
    // Non-vacuity. Every assertion below is quantified over these; a fixture
    // that stopped producing a legitimate zero would pass by having nothing to
    // check, which is how this class of guard rots.
    expect(emptyRegions.length, "no empty region on the build — the guard would be vacuous").toBeGreaterThan(0);
  });

  it("every empty region sits inside a fabric region, so its cause is resolvable", () => {
    const orphaned = emptyRegions.filter((e) => !e.id);
    expect(orphaned.map((e) => e.text), "an empty state outside any fabric region").toEqual([]);
  });

  it("every empty region quotes the assumption declared for ITS OWN relation", () => {
    // MUTATION: render the bare `No X yet` again (drop the citation) → RED on
    // every empty region at once. MUTATION: cite the first assumption in the
    // list instead of the one for this pair → RED, because the quoted text
    // names the wrong parent.
    for (const e of emptyRegions) {
      const candidates = assumptionsFor(e.id);
      expect(candidates.length, `${e.id}: the seed declared no assumption for this relation`).toBeGreaterThan(0);
      const cited = candidates.filter((a) => e.text.includes(a.assumed));
      expect(cited.length, `${e.id} states "${e.text}" but declares ${JSON.stringify(candidates.map((c) => c.assumed))}`)
        .toBeGreaterThan(0);
    }
  });

  it("carries the Listen question that settles it, not just the guess", () => {
    // The point of the change: the weakest screen state becomes evidence
    // gathering. A citation without the question is half of it.
    for (const e of emptyRegions) {
      const cited = assumptionsFor(e.id).filter((a) => e.text.includes(a.assumed));
      expect(cited.some((a) => e.text.includes(a.listenQuestion)), `${e.id} cites an assumption without its question`).toBe(true);
      expect(e.text, `${e.id} does not route the reader anywhere`).toMatch(/Listen/);
    }
  });

  it("still says WHAT is missing", () => {
    // The citation is added to the empty state, not substituted for it — a card
    // that explains an assumption without naming the absent entity is worse
    // than the "No X yet" it replaced.
    for (const e of emptyRegions) {
      const title = e.el.querySelector(".m-empty-t")?.textContent ?? "";
      expect(title.trim().length, `${e.id} lost its title`).toBeGreaterThan(0);
    }
  });

  it("the assumption is addressed by the relation pair, not by a rebuilt sentence", () => {
    // The lookup this rests on: every relation-derived assumption carries the
    // pair it is about. MUTATION: drop `pair` from the seeder → RED (the
    // citation cannot be resolved and every empty region fails above).
    const relational = seed.assumptions.filter((a) => a.kind !== "orphan-entity" && a.kind !== "display-name");
    expect(relational.length).toBeGreaterThan(0);
    expect(relational.every((a) => Array.isArray(a.pair) && a.pair.length === 2 && a.pair.every(Boolean)),
      "a relation assumption with no addressable pair").toBe(true);
    // and the pair names real entities of the ontology
    const known = new Set(fabric.graph.entities);
    expect(relational.every((a) => known.has(a.pair![0]) && known.has(a.pair![1]))).toBe(true);
  });

  it("determinism survives the citation", () => {
    expect(generateSeed(ontology, fabric.version).assumptions).toEqual(seed.assumptions);
    expect(assemblePrototype(ontology, atlas).html).toBe(assemblePrototype(ontology, atlas).html);
    expect(deriveFabric(ontology, atlas).version).toBe(fabric.version);
  });
});
