/**
 * A DETAIL PAGE HAS A BUDGET, AND NOTHING IS EVER DROPPED TO MEET IT.
 *
 * On a reviewed CRM build one detail page carried THIRTEEN child sections, each
 * a full card. Past roughly five the page is a wall: the relation the record is
 * actually about is somewhere below the fold, indistinguishable from a
 * three-row lookup table, and the reader stops before finding it.
 *
 * The fix must not become a second, worse defect. A generator that renders only
 * the top five and forgets the rest is a SILENT DROP — the exact failure the
 * fabric→DOM fidelity work exists to stop, and it would take the delta contract
 * with it, since a region with no element is a region a delta cannot resolve.
 *
 * So these pin two properties at once, against the rendered DOM:
 *   1. no detail screen stands more than five child sections OPEN, and the ones
 *      that stand open are the ones the ontology hangs the most off;
 *   2. every child region the fabric declares is still IN THE DOCUMENT, with
 *      its `data-fabric-id`, whether it is open or collapsed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { renderedDoc } from "./helpers/renderPrototype";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const wideOntology = snap("domain-ontology.json") as Record<string, unknown>;
const wideAtlas = snap("current-state-atlas.json") as Record<string, unknown>;

/** A small ontology: no entity here owns enough children to need collapsing. */
const ent = (name: string, attributes: string[]) => ({ name, attributes, definition: name });
const narrowOntology = {
  entities: [ent("Account", ["id", "name"]), ent("Opportunity", ["id", "name", "accountId"]), ent("Contact", ["id", "name", "accountId"])],
  relations: [
    { from: "Account", to: "Opportunity", cardinality: "1:N" },
    { from: "Account", to: "Contact", cardinality: "1:N" },
  ],
};

/**
 * An ontology that declares its most consequential relation LAST. Six leaf
 * children come first, then the one child that carries a subtree of its own —
 * so rendering in declaration order buries the only section that matters, and
 * the ordering rule is the difference between the two outcomes.
 */
const leaves = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];
const declarationOrderOntology = {
  entities: [
    ent("Root", ["id", "name"]),
    ...leaves.map((l) => ent(l, ["id", "name", "rootId"])),
    ent("Trunk", ["id", "name", "rootId"]),
    ent("Branch", ["id", "name", "trunkId"]),
    ent("Twig", ["id", "name", "trunkId"]),
    ent("Leafling", ["id", "name", "branchId"]),
  ],
  relations: [
    ...leaves.map((l) => ({ from: "Root", to: l, cardinality: "1:N" })),
    { from: "Root", to: "Trunk", cardinality: "1:N" },     // declared last, owns the deepest subtree
    { from: "Trunk", to: "Branch", cardinality: "1:N" },
    { from: "Trunk", to: "Twig", cardinality: "1:N" },
    { from: "Branch", to: "Leafling", cardinality: "1:N" },
  ],
};

/** Parsed AND scripted: the sections' contents are drawn at load from the
 *  data island, so a document that is only parsed carries the wrappers and
 *  none of the cards this file counts. */
const parse = (html: string) => renderedDoc(html);
const detailScreens = (doc: Document) => Array.from(doc.querySelectorAll('section[data-screen^="detail-"]'));
/**
 * Sections standing OPEN: the region divs nothing hides, minus the record's own
 * summary. Read by the DISTINCTION (not inside a `details`) rather than by
 * depth — "direct child of the screen" said open and meant one level down, so a
 * layout wrapper reported every section as dropped on a build where nothing had
 * moved.
 */
const openSections = (screen: Element) =>
  Array.from(screen.querySelectorAll("[data-fabric-id]"))
    .filter((e) => !e.closest("details"))
    .map((c) => c.getAttribute("data-fabric-id") ?? "")
    .filter((id) => id.startsWith("region:") && !id.endsWith(":summary"));
const collapsedSections = (screen: Element) =>
  Array.from(screen.querySelectorAll("details [data-fabric-id]")).map((e) => e.getAttribute("data-fabric-id") ?? "");

const CAP = 5;

describe("child sections are capped, and the cap collapses rather than drops", () => {
  const fabric = deriveFabric(wideOntology, wideAtlas);
  const doc = parse(assemblePrototype(wideOntology, wideAtlas).html);

  it("the fixture still exercises the wall (some entity owns more than the cap)", () => {
    // Non-vacuity: if the fixture ever loses its wide entity, these tests would
    // pass by having nothing to cap.
    const perParent = new Map<string, number>();
    for (const n of fabric.nodes) {
      if (n.kind !== "region" || n.id.endsWith(":summary") || !n.id.startsWith("region:")) continue;
      const p = n.id.split(":")[1];
      perParent.set(p, (perParent.get(p) ?? 0) + 1);
    }
    expect(Math.max(...perParent.values()), "no entity in the fixture owns more than the cap").toBeGreaterThan(CAP);
  });

  it("no detail screen stands more than five child sections open", () => {
    // MUTATION: render every child section inline (drop the slice) → RED.
    for (const screen of detailScreens(doc)) {
      const open = openSections(screen);
      expect(open.length, `${screen.getAttribute("data-screen")} stands ${open.length} sections open`).toBeLessThanOrEqual(CAP);
    }
  });

  it("collapses the tail instead of dropping it — every fabric region is still in the document", () => {
    // MUTATION: replace the collapsed branch with "" → RED here, and the
    // fabric→DOM fidelity guard goes red with it.
    const declared = fabric.nodes
      .filter((n) => n.kind === "region" && n.id.startsWith("region:") && !n.id.endsWith(":summary"))
      .map((n) => n.id);
    const rendered = new Set(detailScreens(doc).flatMap((s) => [...openSections(s), ...collapsedSections(s)]));
    const missing = declared.filter((id) => !rendered.has(id));
    expect(missing, `child regions the assembler dropped:\n${missing.join("\n")}`).toEqual([]);
    // and the collapsed ones are genuinely collapsed, not merely last
    const collapsed = detailScreens(doc).flatMap((s) => collapsedSections(s));
    expect(collapsed.length, "nothing was collapsed on a fixture that needs it").toBeGreaterThan(0);
  });

  it("the sections left open are the ones the ontology hangs the most off", () => {
    // The ORDERING property, not the sort call: the smallest subtree standing
    // open is at least as large as the largest one collapsed. MUTATION: drop
    // the sort and take the fabric's own order → RED.
    const childOf = (id: string) => {
      const cs = id.split(":")[2];
      return fabric.graph.entities.find((e) => e.toLowerCase().replace(/[^a-z0-9]+/g, "-") === cs);
    };
    const size = (id: string) => fabric.graph.byName[childOf(id) ?? ""]?.subtreeSize ?? 1;
    for (const screen of detailScreens(doc)) {
      const collapsed = collapsedSections(screen).filter((id) => id.startsWith("region:"));
      if (!collapsed.length) continue;
      const open = openSections(screen);
      const smallestOpen = Math.min(...open.map(size));
      const largestCollapsed = Math.max(...collapsed.map(size));
      expect(smallestOpen, `${screen.getAttribute("data-screen")} collapsed a bigger subtree than it opened`)
        .toBeGreaterThanOrEqual(largestCollapsed);
    }
  });

  it("keeps the biggest relation open even when the ontology declares it last", () => {
    // THE ordering property, on a fixture built so declaration order and
    // structural weight disagree. MUTATION: render `childRegions` in fabric
    // order → RED, the one section carrying a subtree is collapsed and six
    // leaves stand open in its place.
    const f = deriveFabric(declarationOrderOntology, {});
    const small = parse(assemblePrototype(declarationOrderOntology, {}).html);
    const root = detailScreens(small).find((s) => s.getAttribute("data-screen") === "detail-root")!;
    expect(root, "the fixture lost its wide parent").toBeTruthy();
    const biggest = [...f.graph.byName["Root"].children].sort((a, b) => f.graph.byName[b].subtreeSize - f.graph.byName[a].subtreeSize)[0];
    expect(f.graph.byName[biggest].subtreeSize, "the fixture stopped having a deepest child").toBeGreaterThan(1);
    expect(openSections(root), `${biggest} — the child with the largest subtree — was collapsed`)
      .toContain(`region:root:${biggest.toLowerCase()}`);
    expect(collapsedSections(root).length, "the fixture stopped exercising the cap").toBeGreaterThan(0);
  });

  it("the control states how many it is holding", () => {
    // MUTATION: hardcode the label, or count the wrong list → RED. A "+8 more"
    // that opens six is the drop defect wearing a label.
    for (const screen of detailScreens(doc)) {
      const more = screen.querySelector("details");
      if (!more) continue;
      const hidden = Array.from(more.querySelectorAll("[data-fabric-id]")).length;
      const label = more.querySelector("summary")?.textContent ?? "";
      expect(label, `${screen.getAttribute("data-screen")}: "${label}" holds ${hidden}`).toContain(`+${hidden} more`);
    }
  });

  it("offers no expander when there is nothing to expand", () => {
    // No zero-value affordance: a "+0 more related" on a two-section page is a
    // control that lies about there being more.
    const small = parse(assemblePrototype(narrowOntology, {}).html);
    for (const screen of detailScreens(small)) {
      expect(openSections(screen).length).toBeLessThanOrEqual(CAP);
      expect(screen.querySelector("details"), "an expander appeared with nothing behind it").toBeNull();
    }
  });

  it("assembles byte-identically twice — the ordering is derived, not incidental", () => {
    expect(assemblePrototype(wideOntology, wideAtlas).html).toBe(assemblePrototype(wideOntology, wideAtlas).html);
    expect(deriveFabric(wideOntology, wideAtlas).version).toBe(fabric.version);
  });
});
