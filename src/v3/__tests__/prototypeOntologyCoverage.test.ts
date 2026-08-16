/**
 * AN ENTITY IS EITHER IN THE APPLICATION OR IT IS NAMED IN A DECLARATION.
 *
 * The menu is the operator's decision, and the drill-through closure builds a
 * detail screen for anything a menu entity relates to. What is left over is an
 * entity the ontology holds, the navigation does not offer, and no relation
 * reaches: absent from the product entirely. On a curated snapshot build that
 * was FIVE of thirty-three record types, and nothing anywhere said so — not
 * `gaps`, not `warnings`, not `assumptions`. The build simply did not contain
 * them, and the only way to find out was to notice.
 *
 * Curating is legitimate; the silence is not — "a miss stays visible" is the
 * brief's rule and this is the largest miss the assembler can make. So the
 * assembly returns `coverageGaps`, `resolvePrototypeDoc` writes it into the
 * artifact's `gaps`, and the render-QA gate — which already errors on an
 * undeclared absence and warns on a declared one — reads the same list.
 *
 * WHAT THESE ASSERT, and why each one is here:
 *
 *   · the PARTITION, on a curated AND an uncurated build: every ontology
 *     entity is rendered or declared, never both and never neither. The
 *     uncurated side is not a formality — it is where "declared" must stay
 *     EMPTY, so a fix that declared everything and rendered nothing fails here
 *     rather than reading as coverage.
 *   · the declaration is TRUE: nothing named in it has a screen. A gap list
 *     padded with entities that are actually rendered is noise that trains a
 *     reader to skip it.
 *   · the gate's verdict FLIPS on the declaration and on nothing else — error
 *     without it, no error with it, same document both times.
 *
 * Measured against the PARSED, SCRIPTED document. A screen counts as rendered
 * only when the element the router addresses also carries the entity's own
 * name on the page, so an id that survives while the screen stops naming its
 * record type does not read as coverage.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { prototypeBaselineFor, resolvePrototypeDoc } from "@shared/prototypeRefine.ts";
import { auditPrototype } from "@/v3/lib/prototypeQa";
import { loadPrototype } from "./helpers/renderPrototype";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json") as Record<string, unknown>;
const atlas = snap("current-state-atlas.json") as Record<string, unknown>;

const entityNames = (o: Record<string, unknown>): string[] =>
  (Array.isArray(o.entities) ? o.entities : [])
    .map((e) => String((e as { name?: unknown }).name ?? "")).filter(Boolean);

/** The document's own address for an entity — the same slug the deep-link
 *  router matches (`#account/account-0002`), which is why a screen can be
 *  found by it at all. */
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";

/**
 * WHICH ENTITIES THIS DOCUMENT ACTUALLY SHOWS.
 *
 * Two conditions, deliberately: a screen the router can reach AND that screen
 * naming the entity in its own visible text. Either alone can pass while the
 * build is broken — an orphaned `data-screen` nothing routes to, or a page of
 * rows belonging to a record type it never names.
 */
function screenedEntities(html: string, names: readonly string[]): string[] {
  const doc = loadPrototype(html).doc;
  const byId = new Map<string, Element>();
  for (const s of Array.from(doc.querySelectorAll("[data-screen]"))) byId.set(s.getAttribute("data-screen") ?? "", s);
  return names.filter((n) => {
    const el = byId.get(`detail-${slug(n)}`) ?? byId.get(`list-${slug(n)}`);
    return !!el && (el.textContent ?? "").includes(n);
  });
}

/**
 * WHICH ENTITY EACH LINE OF THE DECLARATION IS ABOUT — one line, one entity,
 * named at the front of it, because a reader scanning a gaps list reads the
 * subject first.
 *
 * The LONGEST matching name wins: "Lead Score has no screen…" is a statement
 * about Lead Score, and resolving it to "Lead" would report a rendered entity
 * as missing and an absent one as covered — both directions of wrong, from one
 * ambiguity. An unrecognised line resolves to "", which fails the partition
 * rather than passing quietly.
 */
const declaredEntities = (gaps: readonly string[], names: readonly string[]): string[] =>
  gaps.map((g) => names.filter((n) => g.startsWith(n)).sort((a, b) => b.length - a.length)[0] ?? "");

/**
 * ONE BUILD, FULLY PARTITIONED. Runs for every case below, so a claim proven
 * on the snapshot is proven the same way on a three-entity ontology from
 * another domain — the assembler must not have learned one shape.
 */
function partition(o: Record<string, unknown>, at: Record<string, unknown>, parents?: string[]) {
  const built = assemblePrototype(o, at, parents);
  const names = entityNames(o);
  const rendered = screenedEntities(built.html, names);
  const declared = declaredEntities(built.coverageGaps, names);
  return { built, names, rendered, declared };
}

describe("every ontology entity is rendered or declared — curated", () => {
  const parents = ["Account"];
  const { built, names, rendered, declared } = partition(ontology, atlas, parents);

  it("partitions the ontology: nothing in both, nothing in neither", () => {
    expect(names.length).toBeGreaterThan(20);
    expect([...rendered, ...declared].sort()).toEqual([...names].sort());
    expect(rendered.filter((n) => declared.includes(n))).toEqual([]);
  });

  it("really is a curated build — some entities are declared, and each declaration is true", () => {
    // The branch under test EXISTS on this fixture: curation drops record types
    // the drill-through does not reach. Without this the partition above would
    // hold on a build that declared nothing because it dropped nothing.
    expect(declared.length).toBeGreaterThan(0);
    expect(rendered.length).toBeGreaterThan(0);
    // One line per entity, each naming an entity that is genuinely absent.
    expect(built.coverageGaps.length).toBe(declared.length);
    expect(new Set(declared).size).toBe(declared.length);
    for (const n of declared) {
      expect(screenedEntities(built.html, [n])).toEqual([]);
      const line = built.coverageGaps.find((g) => g.startsWith(`${n} `))!;
      expect(line).toMatch(/no screen/i);
    }
  });

  it("declares an absence the render-QA gate would otherwise call a silent drop", () => {
    const errorsWith = (gaps: readonly string[]) =>
      auditPrototype(loadPrototype(built.html, { entities: names, gaps }))
        .byCheck["entity-coverage"].filter((f) => f.severity === "error");
    // The gate reads the SAME document both times; only the declaration moves.
    const silent = errorsWith([]);
    expect(silent.length).toBeGreaterThan(0);
    expect(errorsWith(built.coverageGaps)).toEqual([]);
    // …and it is not that the gate stopped looking: what it no longer calls an
    // error it now calls a stated miss.
    const stated = auditPrototype(loadPrototype(built.html, { entities: names, gaps: built.coverageGaps }))
      .byCheck["entity-coverage"].filter((f) => f.severity === "warning");
    expect(stated.length).toBeGreaterThanOrEqual(silent.length);
  });

  it("says the same thing twice — the declaration is derived, not sampled", () => {
    expect(assemblePrototype(ontology, atlas, parents).coverageGaps).toEqual(built.coverageGaps);
  });
});

describe("every ontology entity is rendered or declared — uncurated", () => {
  const { built, names, rendered, declared } = partition(ontology, atlas);

  it("renders the whole ontology, so the declaration is empty", () => {
    expect(rendered.sort()).toEqual([...names].sort());
    expect(declared).toEqual([]);
    expect(built.coverageGaps).toEqual([]);
  });

  it("and the gate agrees there is nothing to declare", () => {
    const report = auditPrototype(loadPrototype(built.html, { entities: names, gaps: [] }));
    expect(report.byCheck["entity-coverage"]).toEqual([]);
  });
});

/**
 * A DIFFERENT DOMAIN, A DIFFERENT SHAPE. Three entities, one of them related
 * to nothing — the smallest ontology on which curation can strand a record
 * type. Nothing here comes from the snapshot's vocabulary or scale.
 */
const theatre = {
  entities: [
    { name: "Case", attributes: ["id", "name", "status"] },
    { name: "Anesthesia Record", attributes: ["id", "type", "caseId"] },
    { name: "Consent Form", attributes: ["id", "signedBy"] },
  ],
  relations: [{ from: "Case", to: "Anesthesia Record", cardinality: "1:N" }],
} as unknown as Record<string, unknown>;

describe("the partition holds on an ontology from another domain", () => {
  it("curated to one entity: the reachable child renders, the stranded one is declared", () => {
    const { names, rendered, declared } = partition(theatre, {}, ["Case"]);
    expect([...rendered, ...declared].sort()).toEqual([...names].sort());
    expect(rendered).toContain("Case");
    expect(rendered).toContain("Anesthesia Record");   // reached by drill-through
    expect(declared).toEqual(["Consent Form"]);        // in the ontology, nowhere in the app
  });

  it("uncurated: everything renders and nothing is declared", () => {
    const { built, names, rendered } = partition(theatre, {});
    expect(rendered.sort()).toEqual([...names].sort());
    expect(built.coverageGaps).toEqual([]);
  });
});

describe("the declaration reaches the artifact's gaps", () => {
  const baseline = prototypeBaselineFor(ontology, atlas, { parentEntities: ["Account"] })!;

  it("carries the assembly's coverage gaps onto the baseline", () => {
    expect(baseline.coverageGaps.length).toBeGreaterThan(0);
    expect(baseline.coverageGaps).toEqual(assemblePrototype(ontology, atlas, ["Account"]).coverageGaps);
  });

  it("writes them into gaps on every branch, and never twice", () => {
    // A run in which the model returned nothing: the assembled build stands and
    // the absences are still stated.
    const assembled = resolvePrototypeDoc({}, baseline);
    expect(assembled.source).toBe("assembled");
    const gaps = (assembled.doc.gaps as string[]) ?? [];
    for (const g of baseline.coverageGaps) expect(gaps).toContain(g);
    // A model that echoed the declaration back does not get it printed twice.
    const echoed = resolvePrototypeDoc({ gaps: [...baseline.coverageGaps] }, baseline);
    const echoedGaps = (echoed.doc.gaps as string[]) ?? [];
    for (const g of baseline.coverageGaps) {
      expect(echoedGaps.filter((x) => x === g).length).toBe(1);
    }
  });

  it("a build that covers the whole ontology adds nothing to gaps", () => {
    const whole = prototypeBaselineFor(ontology, atlas)!;
    expect(whole.coverageGaps).toEqual([]);
    const out = resolvePrototypeDoc({}, whole);
    const gaps = (out.doc.gaps as string[]) ?? [];
    // The one line it does carry is the "no refinement this run" note — the
    // coverage channel contributes nothing when there is nothing to report.
    expect(gaps.some((g) => /no screen in this prototype/i.test(g))).toBe(false);
  });
});
