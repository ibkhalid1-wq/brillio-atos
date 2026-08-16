/**
 * THE TREE STARTS AT THE OBJECT THE BUSINESS STARTS AT.
 *
 * "All records" filed every entity under its `primaryParent` — the SHALLOWEST
 * parent over the relation graph. On the reviewed CRM ontology that put Account,
 * the object seven other entities reference, underneath Partner, which exactly
 * one entity references, because that single relation happened to start a level
 * higher. Graph-theoretically defensible; backwards to anyone who has ever used
 * a CRM, and the first thing on screen. Fan-in already identified the centre —
 * it is the head of the spine — and only the root choice ignored it.
 *
 * The fix is a RULE, not a list of names: an entity stands as its own tree root
 * when it is on the spine AND its fan-in materially exceeds its structural
 * parent's (`PRIMACY_RATIO`× as many entities pointing at it). This file guards
 * both directions, because the two failure modes are symmetric — a rule that
 * promotes everything is as wrong as one that promotes nothing:
 *
 *   PROMOTES  · the CRM snapshot (Account out of Partner, 7× fan-in) and a
 *               logistics ontology from another domain entirely (Shipment out of
 *               Tariff Schedule, 6×) — so the rule is not "Account".
 *   DECLINES  · a 13-entity facilities hierarchy that is genuinely deep
 *               (site → building → floor → room → asset → work order): every
 *               level is a near miss on fan-in and every level keeps its place.
 *               Plus, on the snapshot itself, the twelve entities the rule
 *               leaves exactly where the graph put them.
 *
 * And what promotion must NOT touch: the relation is untouched, so the seeder
 * still fans Account out of Partner rows and Partner's detail still lists its
 * Accounts. The promotion is where the entity is FILED, nothing else.
 *
 * Assertions are made against the parsed sidebar, not a regex over the HTML.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveOntologyGraph } from "@shared/ontologyGraph.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { generateSeed } from "@shared/seedData.ts";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { renderedDoc } from "./helpers/renderPrototype";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8")) as Record<string, unknown>;
const ontology = snap("domain-ontology.json");
const atlas = snap("current-state-atlas.json");

const rel = (from: string, to: string) => ({ from, to, cardinality: "1:N", relation: "produces" });
const ent = (name: string) => ({ name, attributes: ["name", "status"] });

/**
 * A GENUINELY DEEP HIERARCHY, from a domain with no CRM in it. Thirteen entities
 * — past the flat-list threshold, so the spine and the promotion rule are both
 * live — and six levels of real containment. Every level is referenced by the
 * level below it, and the two near misses are deliberate: Asset out-references
 * Room 4 to 2, and Room out-references Floor 2 to 1. Both are 2×; a rule keyed
 * on "more than its parent", or on any small difference, promotes them and
 * shreds the hierarchy.
 */
const facilitiesOntology = {
  entities: [
    ent("Site"), ent("Building"), ent("Floor"), ent("Room"), ent("Asset"), ent("Booking"),
    ent("Work Order"), ent("Inspection"), ent("Sensor Reading"), ent("Maintenance Log"),
    ent("Part"), ent("Labour Entry"), ent("Technician Assignment"),
  ],
  relations: [
    rel("Site", "Building"), rel("Building", "Floor"), rel("Floor", "Room"),
    rel("Room", "Asset"), rel("Room", "Booking"),
    rel("Asset", "Work Order"), rel("Asset", "Inspection"), rel("Asset", "Sensor Reading"), rel("Asset", "Maintenance Log"),
    rel("Work Order", "Part"), rel("Work Order", "Labour Entry"), rel("Work Order", "Technician Assignment"),
  ],
} as unknown as Record<string, unknown>;

/** A shipping ontology whose centre is buried under a rate card that nothing
 *  else references — the same defect shape, a different domain, a different
 *  entity name. If the rule were a hardcoded list this fixture would fail. */
const logisticsOntology = {
  entities: [
    ent("Tariff Schedule"), ent("Shipment"), ent("Leg"), ent("Package"), ent("Customs Entry"),
    ent("Proof Of Delivery"), ent("Exception Event"), ent("Invoice Line"), ent("Depot"), ent("Vehicle"), ent("Driver"),
  ],
  relations: [
    rel("Tariff Schedule", "Shipment"),
    rel("Shipment", "Leg"), rel("Shipment", "Package"), rel("Shipment", "Customs Entry"),
    rel("Shipment", "Proof Of Delivery"), rel("Shipment", "Exception Event"), rel("Shipment", "Invoice Line"),
    rel("Depot", "Vehicle"), rel("Depot", "Driver"),
  ],
} as unknown as Record<string, unknown>;

/**
 * A CROWDED SPINE. Eight clinical objects that four other entities all reference
 * by name, so the seven spine slots are taken by entities with a fan-in of 4.
 * Ward, at 3, is the ninth — it clears the promotion MARGIN comfortably (three
 * entities point at it, one points at its Facility) and is still not one of the
 * objects this ontology is navigated by. It must stay where the graph filed it:
 * the margin says an entity is more central than its container, and only spine
 * membership says it is central enough to sit in the top band at all.
 */
const clinicalHubs = ["Patient", "Encounter", "Order", "Result", "Medication", "Allergy", "Problem", "Procedure"];
const clinicalOntology = {
  entities: [
    ...clinicalHubs.map((name) => ({ name, attributes: ["name", "status"] })),
    // each of these names every hub as an attribute — that is the fan-in
    ...["Chart Note", "Audit Trail", "Billing Line", "Interface Message"].map((name) => ({ name, attributes: clinicalHubs.map((h) => h.toLowerCase()) })),
    { name: "Facility", attributes: ["name", "region"] },
    { name: "Ward", attributes: ["name", "beds"] },
    { name: "Bed", attributes: ["label"] }, { name: "Shift", attributes: ["start"] }, { name: "Cleaning Task", attributes: ["state"] },
  ],
  relations: [rel("Facility", "Ward"), rel("Ward", "Bed"), rel("Ward", "Shift"), rel("Ward", "Cleaning Task")],
} as unknown as Record<string, unknown>;

/**
 * THE RENDERED SIDEBAR, PARSED. The tree is nested `<details>`/`<div>` markup, so
 * "is Account top-level" is a DOM question — a regex over the HTML cannot tell a
 * top-level row from one buried three levels down, which is the entire subject of
 * this file.
 */
function sidebar(html: string) {
  const doc = renderedDoc(html);
  const nav = doc.querySelector("aside.m-side nav.m-nav");
  if (!nav) throw new Error("the assembled page has no sidebar");
  const nameOf = (el: Element): string => (el.querySelector(".m-nav-item")?.childNodes[0]?.textContent ?? "").trim();
  const section = (title: string): Element[] => {
    const head = [...nav.querySelectorAll(".m-nav-sec")].find((s) => s.textContent === title);
    if (!head) return [];
    const out: Element[] = [];
    for (let el = head.nextElementSibling; el && !el.classList.contains("m-nav-sec"); el = el.nextElementSibling) out.push(el);
    return out;
  };
  return {
    /** The entities the tree section starts at — top level, nothing above them. */
    topLevel: (title: string) => section(title).map(nameOf).filter(Boolean),
    /** Everything nested BENEATH a named entry, at any depth. */
    under: (title: string, parent: string) => {
      const branch = section(title).find((el) => nameOf(el) === parent);
      return branch ? [...branch.querySelectorAll(".m-nav-sub .m-nav-item")].map((i) => (i.childNodes[0]?.textContent ?? "").trim()) : [];
    },
    /** Every entity named anywhere in the sidebar — nothing may be lost. */
    all: () => [...nav.querySelectorAll(".m-nav-item")].map((i) => (i.childNodes[0]?.textContent ?? "").trim()),
  };
}

// ── it promotes, and the promotion reaches the screen ──────────────────────────
describe("a central object buried under a footnote is promoted to the top band", () => {
  it("the CRM snapshot: the seven-referenced object leads, not the one-referenced one", () => {
    const g = deriveOntologyGraph(ontology);
    const account = g.byName.Account, partner = g.byName.Partner;
    // the defect's preconditions, stated so the fixture cannot drift out from
    // under the assertion
    expect(account.parents).toContain("Partner");
    expect(account.fanIn).toBeGreaterThanOrEqual(3 * partner.fanIn);
    expect(g.spine).toContain("Account");
    // the promotion itself, and its receipt
    expect(g.treeRoots).toContain("Account");
    expect(account.primaryParent).toBeNull();
    expect(account.promotedFrom).toBe("Partner");
    expect(partner.treeChildren).not.toContain("Account");
  });

  it("the tree section OPENS on it — checked in the parsed sidebar, not by regex", () => {
    const { html } = assemblePrototype(ontology, atlas);
    const nav = sidebar(html);
    expect(nav.topLevel("All records")).toContain("Account");
    expect(nav.topLevel("All records")[0]).toBe("Account");
    expect(nav.under("All records", "Partner"), "Account is still filed inside Partner").not.toContain("Account");
    // its own children came with it — promotion moves a subtree, not one row
    expect(nav.under("All records", "Account")).toEqual(expect.arrayContaining(["Opportunity", "Engagement", "Contact"]));
    // and nothing was dropped on the way
    for (const n of deriveOntologyGraph(ontology).entities) expect(nav.all(), `${n} vanished from the sidebar`).toContain(n);
  });

  it("is a RULE, not a name: another domain promotes another entity", () => {
    const g = deriveOntologyGraph(logisticsOntology);
    const promoted = g.nodes.filter((n) => n.promotedFrom);
    expect(promoted.map((n) => `${n.name} out of ${n.promotedFrom}`)).toEqual(["Shipment out of Tariff Schedule"]);
    expect(g.treeRoots[0]).toBe("Shipment");
    const nav = sidebar(assemblePrototype(logisticsOntology, {}).html);
    expect(nav.topLevel("All records")).toContain("Shipment");
    expect(nav.under("All records", "Tariff Schedule")).not.toContain("Shipment");
  });
});

// ── and it declines, which is the harder half ──────────────────────────────────
describe("a hierarchy that is genuinely deep keeps every level", () => {
  const g = deriveOntologyGraph(facilitiesOntology);

  it("the fixture really does exercise the rule (not vacuously past a threshold)", () => {
    expect(g.entities.length).toBeGreaterThan(8);          // past the flat-list size
    expect(Math.max(...g.nodes.map((n) => n.depth))).toBeGreaterThanOrEqual(4);
    // the two near misses: a spine object whose parent is out-referenced, one of
    // them by a parent that is NOT itself on the spine. Only the margin declines
    // these — remove it and both are promoted.
    expect(g.spine).toContain("Asset");
    expect(g.byName.Asset.fanIn).toBeGreaterThan(g.byName.Room.fanIn);
    expect(g.spine).toContain("Room");
    expect(g.spine).not.toContain("Floor");
    expect(g.byName.Room.fanIn).toBeGreaterThan(g.byName.Floor.fanIn);
  });

  it("promotes NOTHING, and the chain survives end to end", () => {
    expect(g.nodes.filter((n) => n.promotedFrom).map((n) => n.name)).toEqual([]);
    expect(g.treeRoots).toEqual(g.roots);
    for (const [child, parent] of [["Building", "Site"], ["Floor", "Building"], ["Room", "Floor"], ["Asset", "Room"], ["Work Order", "Asset"]] as const) {
      expect(g.byName[child].primaryParent, `${child} was lifted out of ${parent}`).toBe(parent);
    }
    const nav = sidebar(assemblePrototype(facilitiesOntology, {}).html);
    expect(nav.topLevel("All records")).toEqual(["Site"]);
    expect(nav.under("All records", "Site")).toEqual(expect.arrayContaining(["Building", "Floor", "Room", "Asset", "Work Order"]));
  });

  it("clearing the margin is not enough — the top band is for objects the ontology points at", () => {
    // Ward is 3× its Facility and would be promoted on the margin alone. It is
    // the ninth-most-referenced entity of seventeen, in an ontology whose seven
    // spine slots are all taken, so it is not one of the things this system is
    // navigated by and it keeps its place.
    const c = deriveOntologyGraph(clinicalOntology);
    expect(c.entities.length).toBeGreaterThan(8);
    expect(c.byName.Ward.fanIn).toBeGreaterThanOrEqual(3 * c.byName.Facility.fanIn);
    expect(c.spine, "the fixture stopped crowding the spine — the case is not being made").not.toContain("Ward");
    expect(c.spine.length).toBeGreaterThanOrEqual(5);
    expect(c.byName.Ward.promotedFrom).toBeNull();
    expect(c.byName.Ward.primaryParent).toBe("Facility");
    expect(c.nodes.filter((n) => n.promotedFrom)).toEqual([]);
    const nav = sidebar(assemblePrototype(clinicalOntology, {}).html);
    expect(nav.topLevel("All records"), "Ward climbed into the top band").not.toContain("Ward");
    expect(nav.under("All records", "Facility")).toContain("Ward");
  });

  it("the CRM snapshot's OTHER entities are left where the graph put them", () => {
    // The same fixture that proves promotion also proves restraint: one entity
    // moved, thirty-two did not — including the two that out-reference their own
    // parents (Opportunity 14 vs Account 7, Engagement 8 vs Account 7).
    const crm = deriveOntologyGraph(ontology);
    expect(crm.nodes.filter((n) => n.promotedFrom).map((n) => n.name)).toEqual(["Account"]);
    for (const n of ["Opportunity", "Engagement", "Contract", "Contact", "Lead"]) {
      expect(crm.byName[n].fanIn, `${n} is not a spine object — the case is not being made`).toBeGreaterThan(1);
      expect(crm.byName[n].promotedFrom, `${n} was promoted out of ${crm.byName[n].primaryParent}`).toBeNull();
      expect(crm.byName[n].primaryParent).not.toBeNull();
    }
    expect(crm.byName.Opportunity.fanIn).toBeGreaterThan(crm.byName.Account.fanIn);
  });
});

// ── the relation is untouched: this is a filing decision, nothing more ──────────
describe("promotion changes where an entity is FILED and nothing else", () => {
  it("the relation graph still says Partner produces Account", () => {
    const g = deriveOntologyGraph(ontology);
    expect(g.byName.Account.parents).toContain("Partner");
    expect(g.byName.Partner.children).toContain("Account");
    expect(g.edges.some((e) => e.parent === "Partner" && e.child === "Account")).toBe(true);
    // `roots` is the RELATION fact the seeder needs — Account is not one of them
    expect(g.roots).not.toContain("Account");
    expect(g.roots).toContain("Partner");
  });

  it("the seed still fans Account rows out of Partner rows", () => {
    // If promotion had leaked into `isRoot`, the seeder would generate Account as
    // a top-level table with no partnerId — and Partner's detail would show an
    // empty Accounts collection on an ontology that has one.
    const fabric = deriveFabric(ontology, atlas);
    const seed = generateSeed(ontology, fabric.version);
    const accounts = seed.records.Account ?? [];
    expect(accounts.length).toBeGreaterThan(3);
    expect(accounts.every((r) => r.partnerId != null), "Account rows lost their Partner").toBe(true);
    const partnerIds = new Set((seed.records.Partner ?? []).map((r) => String(r.id)));
    for (const a of accounts) expect(partnerIds.has(String(a.partnerId))).toBe(true);
  });

  it("Partner's detail still carries its Accounts, rendered", () => {
    const fabric = deriveFabric(ontology, atlas);
    expect(fabric.nodes.some((n) => n.id === "region:partner:account")).toBe(true);
    const doc = renderedDoc(assemblePrototype(ontology, atlas).html);
    const regionEl = doc.querySelector('[data-fabric-id="region:partner:account"]');
    expect(regionEl, "Partner's Accounts region is not in the DOM").toBeTruthy();
    expect(regionEl!.querySelector("table"), "Partner's Accounts collection rendered no rows").toBeTruthy();
  });

  it("is deterministic, and the fabric does not move", () => {
    const a = deriveOntologyGraph(ontology), b = deriveOntologyGraph(ontology);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // The fabric is built from edges and junctions, never from the tree, so a
    // filing decision cannot change a node id or the version they hash to.
    expect(deriveFabric(ontology, atlas).version).toBe(deriveFabric(ontology, atlas).version);
    expect(assemblePrototype(ontology, atlas).html).toBe(assemblePrototype(ontology, atlas).html);
  });
});

// ── every entity still has exactly one home ────────────────────────────────────
describe("the tree still covers the ontology exactly once", () => {
  for (const [label, o] of [["CRM snapshot", ontology], ["facilities", facilitiesOntology], ["logistics", logisticsOntology], ["clinical", clinicalOntology]] as const) {
    it(`${label}: one home each, and treeRoots is where the walk starts`, () => {
      const g = deriveOntologyGraph(o);
      const placed = g.nodes.flatMap((n) => n.treeChildren).concat(g.treeRoots);
      expect(placed).toHaveLength(g.entities.length);
      expect(new Set(placed).size).toBe(g.entities.length);
      expect(g.treeRoots).toEqual(g.nodes.filter((n) => n.primaryParent === null).map((n) => n.name).sort((x, y) => g.treeRoots.indexOf(x) - g.treeRoots.indexOf(y)));
      expect(g.navOrder).toHaveLength(g.entities.length);
      // a promoted entity is a tree root and NOT a relation root; the reverse
      // never happens (a relation root has no parent to be promoted out of)
      for (const n of g.nodes) {
        if (n.promotedFrom) { expect(g.treeRoots).toContain(n.name); expect(g.roots).not.toContain(n.name); }
        if (n.isRoot) expect(g.treeRoots).toContain(n.name);
      }
    });
  }

  it("the curated path is unaffected — a chosen menu is flat, with no tree at all", () => {
    const chosen = ["Opportunity", "Account", "Partner"];
    const html = assemblePrototype(ontology, atlas, chosen).html;
    const doc = renderedDoc(html);
    const nav = doc.querySelector("aside.m-side nav.m-nav")!;
    expect(nav.querySelector(".m-nav-sub"), "a curated menu grew a tree").toBeNull();
    expect([...nav.querySelectorAll(".m-nav-item")].map((i) => (i.childNodes[0]?.textContent ?? "").trim())).toEqual(chosen);
  });
});

// ── the sidebar stays legible now that the tree is a level shallower ───────────
describe("the top band is open and the depth below it is one click away", () => {
  it("every tree root is expanded; branches beneath them ship collapsed", () => {
    const { html } = assemblePrototype(ontology, atlas);
    const doc = renderedDoc(html);
    const nav = doc.querySelector("aside.m-side nav.m-nav")!;
    const groups = [...nav.querySelectorAll("details.m-nav-group")];
    expect(groups.length).toBeGreaterThan(2);
    const isTop = (el: Element) => !el.parentElement?.classList.contains("m-nav-sub");
    for (const g of groups) {
      if (isTop(g)) expect((g as HTMLDetailsElement).open, `a top-level branch ships collapsed: ${g.querySelector(".m-nav-item")?.textContent}`).toBe(true);
    }
    // and the wall is still prevented: something below the top band is collapsed
    expect(groups.some((g) => !isTop(g) && !(g as HTMLDetailsElement).open), "every branch is pinned open — 33 entities is a wall").toBe(true);
  });
});
