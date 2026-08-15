/**
 * THE PROTOTYPE MUST READ AS THE ONTOLOGY IT WAS BUILT FROM.
 *
 * Driving Laila's real CRM prototype turned up a flat schema dump: the left nav
 * was 32 sibling entities led by "Practice Forecast Split (120)" — a junction
 * table at the top of a CRM because the generator happened to make 120 rows of
 * it — with Account and Opportunity buried far down and nothing nested under
 * anything. The ontology it was assembled FROM says Account produces
 * Opportunity produces eleven things; none of that reached the screen.
 *
 * The values had the same character. On one list screen:
 *   SPLIT PERCENT   145, 181, 107   — a share of a whole, over the whole
 *   FORECAST CATEGORY  PRA-5570     — a handle where a label belongs
 *   OPPORTUNITY     "Northwind sync" — an activity where an opportunity belongs,
 *                                     though the ontology HAS an Opportunity
 *                                     entity and the row HAS an FK to one.
 *
 * Every assertion below fails on the pre-change tree. Measured on the real
 * 33-entity / 35-relation snapshot that exposed it, and on a 3-entity surgical
 * ontology so that none of the rules quietly assume Laila's scale.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveOntologyGraph, deriveAttributeReferences } from "@shared/ontologyGraph.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { deriveRoles } from "@shared/semanticRoles.ts";
import { generateSeed } from "@shared/seedData.ts";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { renderedDoc, renderedHtml } from "./helpers/renderPrototype";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json") as Record<string, unknown>;
const atlas = snap("current-state-atlas.json") as Record<string, unknown>;

/** A small ontology from another domain entirely — the spine and the nesting
 *  rules have to hold at 3 entities as well as at 33. */
const surgeryOntology = {
  entities: [
    { name: "Case", attributes: ["status", "priority", "acuity"] },
    { name: "Anesthesia Record", attributes: ["type", "case"] },
    { name: "OR Slot", attributes: ["state"] },
  ],
  relations: [{ from: "Case", to: "Anesthesia Record", relation: "requires", cardinality: "1:1" }],
} as unknown as Record<string, unknown>;
const surgeryAtlas = { workflows: [{ name: "Case Cancellation Review", steps: [] }] } as unknown as Record<string, unknown>;

const navItems = (html: string) => [...html.matchAll(/data-nav="list-([a-z0-9-]+)"/g)].map((m) => m[1]);
const seedOf = (o: Record<string, unknown>, a: Record<string, unknown>) => generateSeed(o, deriveFabric(o, a).version);
/**
 * WHAT THE SNAPSHOT BUILD SHOWS, rendered once for the whole file.
 *
 * The assembled document ships its seed as one JSON island and draws every
 * row from it at load, so an assertion about a VALUE on the screen has to read
 * the document after its script has run; the served markup would answer for
 * the island instead. Assertions about structure the assembler emits directly
 * (the nav, the screens, the ids) keep reading the source, which is where that
 * structure has to be.
 */
let renderedOnce: string | null = null;
const shown = (): string => (renderedOnce ??= renderedHtml(assemblePrototype(ontology, atlas).html));

// ── STEP 1: the graph exists, and it is the ONE copy ───────────────────────────
describe("the ontology graph is a first-class result", () => {
  it("exposes roots, parents, children, depth and fan-in for every entity", () => {
    const g = deriveOntologyGraph(ontology);
    expect(g.nodes).toHaveLength(g.entities.length);
    for (const n of g.nodes) {
      expect(Array.isArray(n.parents)).toBe(true);
      expect(Array.isArray(n.children)).toBe(true);
      expect(Number.isFinite(n.depth)).toBe(true);
      expect(n.depth).toBeGreaterThanOrEqual(0);
      expect(n.fanIn).toBe(n.fanInFrom.length);
    }
    // the relations, read back: Account owns Opportunity, Opportunity owns its line items
    expect(g.byName.Opportunity.parents).toContain("Account");
    expect(g.byName.Account.children).toContain("Opportunity");
    expect(g.byName["Opportunity Line Item"].parents).toEqual(["Opportunity"]);
    // an N:1 is read from the parent's side: "Contact is part of Account"
    expect(g.byName.Contact.parents).toContain("Account");
    expect(g.byName.Account.children).toContain("Contact");
    // roots are the entities nothing produces
    expect(g.roots).toContain("Partner");
    expect(g.roots).not.toContain("Opportunity");
    expect(g.nodes.filter((n) => n.isRoot).map((n) => n.name).sort()).toEqual([...g.roots].sort());
  });

  it("the seed and the fabric return the SAME graph — nobody derives a second one", () => {
    const fabric = deriveFabric(ontology, atlas);
    const seed = generateSeed(ontology, fabric.version);
    const direct = deriveOntologyGraph(ontology);
    expect(JSON.stringify(seed.graph)).toBe(JSON.stringify(direct));
    expect(JSON.stringify(fabric.graph)).toBe(JSON.stringify(direct));
  });

  it("is deterministic — same ontology in, byte-identical graph out", () => {
    expect(JSON.stringify(deriveOntologyGraph(ontology))).toBe(JSON.stringify(deriveOntologyGraph(ontology)));
  });

  it("the seeding order still respects every parent edge (a child never precedes a parent)", () => {
    const g = deriveOntologyGraph(ontology);
    const at = new Map(g.order.map((n, i) => [n, i] as const));
    expect(g.order).toHaveLength(g.entities.length);
    for (const e of g.edges) {
      if (e.parent === e.child) continue;
      expect(at.get(e.parent)!, `${e.child} is generated before its parent ${e.parent}`).toBeLessThan(at.get(e.child)!);
    }
  });
});

// ── STEP 2: order by structure, not by how many rows got generated ─────────────
describe("the navigation is ordered by the ontology, not by seed volume", () => {
  it("leads with the top of the graph, not with the biggest table", () => {
    const { html } = assemblePrototype(ontology, atlas);
    const items = navItems(html);
    const seed = seedOf(ontology, atlas);
    // The shipped order was `counts` descending, so whatever saturated its cap
    // led the nav. Row volume still does NOT track structure: the biggest table
    // is a leaf several levels down, and it has more rows than Account.
    const g = deriveOntologyGraph(ontology);
    const biggest = Object.entries(seed.counts).sort((a, b) => b[1] - a[1])[0][0];
    expect(g.byName[biggest].depth).toBeGreaterThan(1);
    expect(g.byName[biggest].children).toHaveLength(0);
    expect(seed.counts["Practice Forecast Split"]).toBeGreaterThan(seed.counts.Account);
    expect(items[0], "the nav still leads with the biggest table").not.toBe(biggest.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    expect(items[0]).not.toBe("practice-forecast-split");
    // and the full listing is the graph's own order, top to bottom
    const tail = navItems(html.slice(html.indexOf(">All records<")));
    expect(tail).toEqual(g.navOrder.map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-")));
    expect(items[0]).toBe("account");
    expect(items.indexOf("account")).toBeLessThan(items.indexOf("practice-forecast-split"));
    expect(items.indexOf("opportunity")).toBeLessThan(items.indexOf("practice-forecast-split"));
  });

  it("the first screen shown follows the same order", () => {
    const { html } = assemblePrototype(ontology, atlas);
    expect(html).toContain("show('list-account')</script>");
  });

  it("a child never appears above its parent in the tree", () => {
    const { html } = assemblePrototype(ontology, atlas);
    const g = deriveOntologyGraph(ontology);
    const order = g.navOrder;
    for (const n of g.nodes) {
      if (!n.primaryParent) continue;
      expect(order.indexOf(n.primaryParent), `${n.name} sits above its parent`).toBeLessThan(order.indexOf(n.name));
    }
    expect(html).toContain("Opportunity Line Item");
  });
});

// ── STEP 3: nesting, with exactly one home per entity ──────────────────────────
describe("children are rendered under their parent", () => {
  it("renders a collapsible branch, not 33 siblings", () => {
    const { html } = assemblePrototype(ontology, atlas);
    expect(html).toContain('<details class="m-nav-group"');
    expect(html).toContain('<div class="m-nav-sub">');
    // and it can be closed: at least one branch ships collapsed
    expect(html).toMatch(/<details class="m-nav-group"><summary/);
  });

  it("EVERY entity is reachable, and each has exactly ONE home", () => {
    const { html } = assemblePrototype(ontology, atlas);
    const g = deriveOntologyGraph(ontology);
    const items = navItems(html);
    for (const n of g.entities) {
      const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      expect(items, `${n} is not reachable from the nav`).toContain(slug);
    }
    // one home in the TREE (the spine section is an explicit shortcut, not a home)
    const homes = new Map<string, number>();
    for (const n of g.nodes) homes.set(n.name, n.primaryParent ? 1 : 0);
    for (const n of g.nodes) expect([0, 1]).toContain(homes.get(n.name));
    // and the tree covers everything exactly once. Counted from `treeRoots`,
    // which is where the tree actually starts: `roots` is the relation fact
    // (nothing produces it), and an entity promoted to the top band for business
    // primacy is in one list and not the other.
    const placed = g.nodes.flatMap((n) => n.treeChildren).concat(g.treeRoots);
    expect(new Set(placed).size).toBe(g.entities.length);
    expect(placed.length).toBe(g.entities.length);
  });

  it("a multi-parent entity nests under its shallowest parent and stays visible on the others", () => {
    const g = deriveOntologyGraph(ontology);
    // Invoice is produced by Account, Engagement AND Contract.
    const invoice = g.byName.Invoice;
    expect(invoice.parents.length).toBeGreaterThan(1);
    expect(invoice.primaryParent).toBe("Account");
    for (const p of invoice.parents) expect(g.byName[p].depth).toBeGreaterThanOrEqual(g.byName["Account"].depth);
    // the parents that did NOT get the nav slot still show it as a child collection
    const fabric = deriveFabric(ontology, atlas);
    for (const p of invoice.parents) {
      const slug = p.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      expect(fabric.nodes.some((n) => n.id === `region:${slug}:invoice`), `${p} lost its Invoice collection`).toBe(true);
    }
  });

  it("an N:1 relation puts the collection and the back-link on the right sides", () => {
    // "Contact is part of Account" [N:1]. Read as written, the parent got a
    // parent-ref nav TO ITS OWN CHILD and no collection at all: Account's detail
    // listed no contacts while claiming to belong to one.
    const fabric = deriveFabric(ontology, atlas);
    const has = (id: string) => fabric.nodes.some((n) => n.id === id);
    expect(has("region:account:contact"), "Account's detail has no Contacts collection").toBe(true);
    expect(has("nav:contact:account"), "a Contact does not link back to its Account").toBe(true);
    expect(has("nav:account:contact"), "Account claims to be the child of its own child").toBe(false);
  });

  it("a relation CYCLE still gives every entity exactly one home", () => {
    // A → B → C → A: nothing has zero parents, so a naive root scan finds none
    // and a naive tree either loops forever or drops all three.
    const cyclic = {
      entities: [
        { name: "Alpha", attributes: ["name", "gamma"] },
        { name: "Beta", attributes: ["name"] },
        { name: "Gamma", attributes: ["name"] },
      ],
      relations: [
        { from: "Alpha", to: "Beta", cardinality: "1:N" },
        { from: "Beta", to: "Gamma", cardinality: "1:N" },
        { from: "Gamma", to: "Alpha", cardinality: "1:N" },
      ],
    } as unknown as Record<string, unknown>;
    const g = deriveOntologyGraph(cyclic);
    expect(g.cycleBroken.length).toBe(1);
    expect(g.roots).toEqual(g.cycleBroken);
    expect(g.nodes.every((n) => Number.isFinite(n.depth))).toBe(true);
    expect(g.navOrder.sort()).toEqual(["Alpha", "Beta", "Gamma"]);
    const placed = g.nodes.flatMap((n) => n.treeChildren).concat(g.roots);
    expect(placed.length).toBe(3);
    expect(new Set(placed).size).toBe(3);
    // and the assembly reaches all three
    const { html } = assemblePrototype(cyclic, { workflows: [] } as unknown as Record<string, unknown>);
    for (const slug of ["alpha", "beta", "gamma"]) expect(navItems(html)).toContain(slug);
  });
});

// ── STEP 4: lead with the spine ────────────────────────────────────────────────
describe("the spine leads, the long tail is reachable behind it", () => {
  it("is 5–7 objects chosen by fan-in — falling out of the ontology, not hardcoded", () => {
    const g = deriveOntologyGraph(ontology);
    expect(g.spine.length).toBeGreaterThanOrEqual(5);
    expect(g.spine.length).toBeLessThanOrEqual(7);
    // every spine member is referenced by more entities than every non-member
    const minSpine = Math.min(...g.spine.map((n) => g.byName[n].fanIn));
    const maxRest = Math.max(...g.entities.filter((n) => !g.spine.includes(n)).map((n) => g.byName[n].fanIn));
    expect(minSpine).toBeGreaterThanOrEqual(maxRest);
    // on THIS ontology that means the CRM objects, arrived at structurally
    expect(g.spine).toContain("Account");
    expect(g.spine).toContain("Opportunity");
    expect(g.spine).not.toContain("Practice Forecast Split");
  });

  it("the spine is presented before the long tail, and the tail is still there", () => {
    const { html } = assemblePrototype(ontology, atlas);
    const g = deriveOntologyGraph(ontology);
    expect(html.indexOf(">Primary<")).toBeGreaterThan(-1);
    expect(html.indexOf(">Primary<")).toBeLessThan(html.indexOf(">All records<"));
    const items = navItems(html);
    for (let i = 0; i < g.spine.length; i += 1) {
      expect(items[i]).toBe(g.spine[i].toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    }
  });

  it("a SMALL ontology gets no spine section — a flat list is already right there", () => {
    const g = deriveOntologyGraph(surgeryOntology);
    expect(g.entities).toHaveLength(3);
    expect(g.spine).toEqual(g.navOrder);                 // everything is primary
    const { html } = assemblePrototype(surgeryOntology, surgeryAtlas);
    expect(html).not.toContain(">Primary<");
    expect(html).toContain(">Records<");
    expect(navItems(html).sort()).toEqual(["anesthesia-record", "case", "or-slot"]);
    // and the ONE relation still nests
    expect(g.byName["Anesthesia Record"].primaryParent).toBe("Case");
  });
});

// ── STEP 5: the three values a stakeholder would have caught ───────────────────
describe("a percent is a percent", () => {
  it("never exceeds 100 — the shipped column showed 145, 181, 107", () => {
    const roles = deriveRoles(ontology).attributeRoles;
    expect(roles.find((r) => r.entity === "Practice Forecast Split" && r.attribute === "split_percent")?.role).toBe("percent");
    const seed = seedOf(ontology, atlas);
    const values = (seed.records["Practice Forecast Split"] ?? []).map((r) => r.split_percent).filter((v) => v != null);
    expect(values.length).toBeGreaterThan(10);
    for (const v of values) {
      expect(typeof v).toBe("number");
      expect(v as number, `${v} is a percent over 100`).toBeLessThanOrEqual(100);
      expect(v as number).toBeGreaterThanOrEqual(0);
    }
  });

  it("renders with its unit, so a bare number can never pass for a share again", () => {
    // Cells are drawn by the page from the seed it ships as data, so the unit
    // is a fact about the RENDERED document — the served markup carries the
    // number without any component around it.
    expect(shown()).toMatch(/tabular-nums">\d{1,3}%<\/span>/);
  });
});

describe("a category is a label, not a code", () => {
  it("does not mint XXX-NNNN for a category/type/tier/segment column", () => {
    const roles = deriveRoles(ontology).attributeRoles;
    expect(roles.find((r) => r.entity === "Practice Forecast Split" && r.attribute === "forecast_category")?.role).toBe("category");
    const seed = seedOf(ontology, atlas);
    const CODE = /^[A-Z]{2,4}-\d{3,5}$/;
    for (const [entity, rows] of Object.entries(seed.records)) {
      for (const r of rows.slice(0, 6)) {
        for (const [k, v] of Object.entries(r)) {
          const role = roles.find((x) => x.entity === entity && x.attribute === k)?.role;
          if (role !== "category" || typeof v !== "string") continue;
          expect(CODE.test(v), `${entity}.${k} = "${v}" — a code where a category belongs`).toBe(false);
          expect(v.length).toBeGreaterThan(2);
        }
      }
    }
  });

  it("does not print one label into every category column of a row", () => {
    // Account carries SIX of them (category, tier, region, industry, type, segment).
    const seed = seedOf(ontology, atlas);
    const roles = deriveRoles(ontology).attributeRoles;
    const cats = roles.filter((r) => r.entity === "Account" && r.role === "category").map((r) => r.attribute);
    expect(cats.length).toBeGreaterThanOrEqual(4);
    const rows = (seed.records.Account ?? []).slice(0, 8);
    const distinct = new Set(rows.flatMap((r) => cats.map((c) => String(r[c]))));
    expect(distinct.size).toBeGreaterThan(3);
  });
});

describe("an attribute that names an entity is a reference to it", () => {
  it("reads the ONTOLOGY, not a hardcoded word list", () => {
    const refs = deriveAttributeReferences(ontology);
    const ref = (e: string, a: string) => refs.find((r) => r.entity === e && r.attribute === a)?.target;
    // none of these is in the `account|parent|lead` word list that shipped
    expect(ref("Practice Forecast Split", "opportunity")).toBe("Opportunity");
    expect(ref("Timesheet", "engagement")).toBe("Engagement");
    expect(ref("SOW", "contract")).toBe("Contract");
    expect(ref("Signal Action", "signal")).toBe("Signal");
    // an entity's own name attribute is not a reference to itself
    expect(ref("Partner", "partner_name")).toBeUndefined();
    // and a person-shaped name that merely ENDS in an entity name is not a
    // reference either, because the ontology declares no Engagement↔Lead relation
    expect(ref("Engagement", "delivery_lead")).toBeUndefined();
    const roles = deriveRoles(ontology).attributeRoles;
    const pfs = roles.find((r) => r.entity === "Practice Forecast Split" && r.attribute === "opportunity")!;
    expect(pfs.role).toBe("parent-ref");
    expect(pfs.refEntity).toBe("Opportunity");
  });

  it("a qualified name counts only when a relation corroborates it", () => {
    const refs = deriveAttributeReferences(ontology);
    // Lead → Opportunity is a declared relation, so `convertedOpportunity` is one
    expect(refs.find((r) => r.entity === "Lead" && r.attribute === "convertedOpportunity")?.target).toBe("Opportunity");
    // Lead → Account is not declared, so `convertedAccount` is not
    expect(refs.find((r) => r.entity === "Lead" && r.attribute === "convertedAccount")).toBeUndefined();
  });

  it("the value is the referenced record's own title, and it is the RIGHT record", () => {
    const seed = seedOf(ontology, atlas);
    const rows = seed.records["Practice Forecast Split"] ?? [];
    expect(rows.length).toBeGreaterThan(10);
    const opportunities = new Map((seed.records.Opportunity ?? []).map((o) => [String(o.id), o]));
    const ACTIVITY = /\b(review|renewal|expansion|migration|pilot|rollout|audit|handoff|escalation|onboarding|assessment|sync)\b/i;
    for (const r of rows.slice(0, 20)) {
      const shown = String(r.opportunity);
      expect(shown, `"${shown}" names an activity, not an opportunity`).not.toMatch(ACTIVITY);
      // the column and the foreign key agree — the reference points where it says
      const parent = opportunities.get(String(r.opportunityId));
      expect(parent, "the split has no real parent opportunity").toBeTruthy();
      expect(shown).toBe(String(parent!.opportunity_name ?? parent!.name ?? shown));
    }
  });

  it("a reference with no named target still reads as a name, never as an activity", () => {
    // `convertedAccount` falls through to the word list — the fallback path.
    const seed = seedOf(ontology, atlas);
    const ACTIVITY = /\b(review|renewal|sync|audit|pilot)\b/i;
    for (const r of (seed.records.Lead ?? []).slice(0, 10)) {
      if (r.convertedAccount == null) continue;
      expect(String(r.convertedAccount)).not.toMatch(ACTIVITY);
    }
  });
});

describe("a record is called something, and the column heading says what", () => {
  it("an entity with NO name attribute gets a display name, not another column's value", () => {
    // Account declares category, tier, region, industry, type, segment,
    // annualRevenue, owner — and no name. The shipped code made `category` the
    // title, so the demo's landing screen had account names under CATEGORY and
    // no category anywhere.
    const roles = deriveRoles(ontology).attributeRoles;
    expect(roles.find((r) => r.entity === "Account" && r.attribute === "category")?.role).toBe("category");
    expect(roles.filter((r) => r.entity === "Account" && r.role === "title")).toHaveLength(0);
    const seed = seedOf(ontology, atlas);
    const first = (seed.records.Account ?? [])[0];
    expect(String(first._display)).toMatch(/Account/);
    // it is reported to Listen rather than papered over
    const gap = seed.assumptions.find((a) => a.kind === "display-name" && a.subject === "Account");
    expect(gap?.listenQuestion).toContain("Account");
    // the list screen heads that column with the ENTITY, and the real category
    // is rendered as the label it is
    const screen = renderedDoc(assemblePrototype(ontology, atlas).html)
      .querySelector('[data-screen="list-account"]')!.outerHTML;
    expect(screen).toContain(">Account</th>");
    expect(screen).toContain(">Category</th>");
    expect(screen).not.toMatch(/m-cell-main">[^<]*<\/div><div class="m-cell-sub">account-0001<\/div><\/td><td>Northwind Account/);
  });

  it("an entity that DOES name itself keeps using its own attribute", () => {
    const roles = deriveRoles(ontology).attributeRoles;
    expect(roles.find((r) => r.entity === "Contact" && r.attribute === "title")?.role).toBe("title");
    const seed = seedOf(ontology, atlas);
    expect((seed.records.Contact ?? [])[0]._display).toBeUndefined();
  });

  it("a child collection names its rows — it used to print the classification marker", () => {
    const { html } = assemblePrototype(ontology, atlas);
    expect(html, "SYNTHETIC-SEED is rendered as if it were a record's name").not.toContain("SYNTHETIC-SEED");
    // the honesty label is where it belongs — on the page, not in a value cell
    expect(html).toContain("synthetic seed data");
  });

  it("a title is never a pointer at another entity", () => {
    const o = {
      entities: [
        { name: "Ticket", attributes: ["subject"] },
        { name: "Reply", attributes: ["ticket", "body"] },   // first attribute is a reference
      ],
      relations: [{ from: "Ticket", to: "Reply", cardinality: "1:N" }],
    } as unknown as Record<string, unknown>;
    const roles = deriveRoles(o).attributeRoles;
    expect(roles.find((r) => r.entity === "Reply" && r.attribute === "ticket")?.role).toBe("parent-ref");
    expect(roles.filter((r) => r.entity === "Reply" && r.role === "title")).toHaveLength(0);
    const seed = generateSeed(o, "v-test");
    const reply = (seed.records.Reply ?? [])[0];
    expect(reply).toBeTruthy();
    expect(String(reply._display)).toContain("Reply");
    expect(String(reply.ticket)).not.toBe(String(reply._display));
  });
});

describe("a schema-shaped name still finds its role", () => {
  it("annualRevenue is money — the anchors only matched at an underscore", () => {
    const roles = deriveRoles(ontology).attributeRoles;
    expect(roles.find((r) => r.entity === "Account" && r.attribute === "annualRevenue")?.role).toBe("monetary");
    expect(roles.find((r) => r.entity === "Engagement" && r.attribute === "healthRag")?.role).toBe("health");
    const seed = seedOf(ontology, atlas);
    for (const r of (seed.records.Account ?? []).slice(0, 6)) {
      if (r.annualRevenue == null) continue;
      expect(typeof r.annualRevenue, `annual revenue is "${r.annualRevenue}"`).toBe("number");
    }
    const { html } = assemblePrototype(ontology, atlas);
    expect(html).toContain("Annual Revenue");
  });

  it("an invoice NUMBER is a handle; a number OF things is a count", () => {
    const o = { entities: [{ name: "Invoice", attributes: ["invoice_number", "number_of_lines"] }], relations: [] } as unknown as Record<string, unknown>;
    const roles = deriveRoles(o).attributeRoles;
    expect(roles.find((r) => r.attribute === "invoice_number")?.role).toBe("code");
    expect(roles.find((r) => r.attribute === "number_of_lines")?.role).toBe("quantity");
  });
});

// ── the whole thing still holds together ───────────────────────────────────────
describe("the assembled prototype survives all of it", () => {
  it("is deterministic and still reaches every entity's three screens", () => {
    const a = assemblePrototype(ontology, atlas);
    expect(a.html).toBe(assemblePrototype(ontology, atlas).html);
    const g = deriveOntologyGraph(ontology);
    for (const n of g.entities) {
      const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      expect(a.html, `${n} has no list screen`).toContain(`data-screen="list-${slug}"`);
    }
  });

  it("an entity's own value columns are still its own — no schema keys, no leakage", () => {
    const { html } = assemblePrototype(ontology, atlas);
    expect(html).toContain("Split Percent");        // humanised, not SPLIT_PERCENT
    expect(/laila/i.test(html)).toBe(false);
  });
});
