/**
 * WHAT EACH SCREEN LEADS WITH IS THE OPERATOR'S CALL — and the surface that
 * takes it must not offer anything the build will ignore.
 *
 * `parentEntities` answered WHICH entities get a screen. It said nothing about
 * what those screens lead with, and the assembler decided all three of the next
 * questions alone: which columns head the list, which related collections stand
 * open on the detail, and whether a list with a pipeline opens on its board.
 * `screenOptions` is the second authored input, in the same shape as the first —
 * one record on the document, everything else derived, an absent entry meaning
 * exactly the build there was before.
 *
 * These pin the three halves that must agree:
 *   1. THE READING — one definition, normalised the way the menu's is, and the
 *      default is stored as absence rather than as a decision.
 *   2. THE BUILD — a toggle here changes the rendered DOM: the heads of the
 *      table, the sections standing open, the view the list opens in. Asserted
 *      against a PARSED, SCRIPTED document, because the rows are drawn at load
 *      and a regex over the source would read the island rather than the screen.
 *   3. THE OFFER — every control this studio renders is one the assembler will
 *      spend: the columns are the entity's own attributes, the collections are
 *      the child regions the fabric declares, the board is offered exactly where
 *      a status exists, and a choice past the page's budget is NAMED rather than
 *      quietly truncated. A control that writes something the build drops is the
 *      same defect as the Copilot placeholder that offered removed editors.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import {
  assemblePrototype, screenOptionsFor, screenFactsFor, openSectionPlan, SCREEN_BUDGET,
} from "@shared/prototypeAssembly.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { pilotSliceFor } from "@shared/prototypePilot.ts";
import { prototypeBaselineFor, prototypeBaselineOfProgram } from "@shared/prototypeRefine.ts";
import PrototypeStudio from "@/v3/components/flow/studio/PrototypeStudio";
import ExperienceDesignStudio, {
  experienceScreenOptions, readScreenFacts,
} from "@/v3/components/flow/studio/ExperienceDesignStudio";
import { StudioLockContext } from "@/v3/components/flow/studio/StudioKit";
import { renderedDoc } from "./helpers/renderPrototype";

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const ent = (name: string, attributes: string[]) => ({ name, attributes, definition: `A ${name}` });

/**
 * Six children on one parent (one more than the page's budget, so something
 * collapses without anybody choosing), one child that owns a subtree of its own
 * (so the derived order is not the ontology's order), and exactly one entity
 * with a status attribute (so "offered where a board exists" has both cases).
 */
const ontology = {
  entities: [
    ent("Account", ["accountName", "industry", "region", "tier", "owner", "healthNote"]),
    ent("Opportunity", ["dealName", "stage", "amount", "closeDate", "accountId"]),
    ent("Contact", ["contactName", "accountId"]),
    ent("Invoice", ["invoiceName", "accountId"]),
    ent("Escalation", ["escalationName", "accountId"]),
    ent("Note", ["noteName", "accountId"]),
    ent("Visit", ["visitName", "accountId"]),
    ent("Task", ["taskName", "opportunityId"]),
  ],
  relations: [
    { from: "Account", to: "Opportunity", cardinality: "1:N" },
    { from: "Account", to: "Contact", cardinality: "1:N" },
    { from: "Account", to: "Invoice", cardinality: "1:N" },
    { from: "Account", to: "Escalation", cardinality: "1:N" },
    { from: "Account", to: "Note", cardinality: "1:N" },
    { from: "Account", to: "Visit", cardinality: "1:N" },
    { from: "Opportunity", to: "Task", cardinality: "1:N" },
  ],
} as Record<string, unknown>;
const atlas = {} as Record<string, unknown>;

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const build = (screenOptions?: Record<string, unknown>) =>
  assemblePrototype(ontology, atlas, undefined, screenOptions ? { screenOptions: screenOptions as never } : {});

const listRegion = (doc: Document, entity: string) =>
  doc.querySelector(`[data-fabric-id="screen:${slug(entity)}:list"]`)!;
const listHeads = (doc: Document, entity: string) =>
  [...listRegion(doc, entity).querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim())
    .filter((t) => t !== "Actions");
/** The application's own state, as the page ships it: the seed island is the
 *  contract between the assembler and the renderer, so what the assembler
 *  DECIDED is read here and what the page DREW is read from the tree. */
const listSpec = (doc: Document, entity: string) => {
  const island = JSON.parse(doc.querySelector("#m-seed")?.textContent ?? "{}");
  return (island.screens as Array<{ entity: string; list: { view?: string } }>).find((s) => s.entity === entity)!.list;
};
const detailScreen = (doc: Document, entity: string) =>
  doc.querySelector(`section[data-screen="detail-${slug(entity)}"]`)!;
/**
 * Sections standing OPEN: region divs the screen shows without a disclosure,
 * minus the record's own summary. Collapsed ones live inside a `details`.
 *
 * Read by that DISTINCTION rather than by depth. It used to walk
 * `screen.children`, which said "open" and meant "one level down from the
 * section" — so wrapping the detail screen in a two-column layout reported every
 * collection as missing on a build where nothing had moved. What makes a section
 * open is that nothing hides it, and that is what this asks.
 */
const openSections = (screen: Element) =>
  [...screen.querySelectorAll("[data-fabric-id]")]
    .filter((e) => !e.closest("details"))
    .map((c) => c.getAttribute("data-fabric-id") ?? "")
    .filter((id) => id.startsWith("region:") && !id.endsWith(":summary"));
const collapsedSections = (screen: Element) =>
  [...screen.querySelectorAll("details [data-fabric-id]")].map((e) => e.getAttribute("data-fabric-id") ?? "");
/** A child region id → the entity it holds, matched by slug. */
const sectionEntities = (ids: string[], names: string[]) =>
  ids.map((id) => names.find((n) => slug(n) === id.split(":")[2]) ?? id);
const ENTITY_NAMES = (ontology.entities as Array<{ name: string }>).map((e) => e.name);

/* ── 1 · the reading ──────────────────────────────────────────────────────── */

describe("what the operator chose, per screen", () => {
  it("reads the three options, in the operator's order", () => {
    expect(screenOptionsFor({
      screenOptions: { Account: { columns: ["owner", "industry"], collections: ["Visit"], view: "board" } },
    })).toEqual({ Account: { columns: ["owner", "industry"], collections: ["Visit"], view: "board" } });
  });

  it("trims, dedupes and drops the empties, exactly as the menu's reading does", () => {
    expect(screenOptionsFor({
      screenOptions: { " Account ": { columns: ["owner", " owner ", "", "  ", "tier"] } },
    })).toEqual({ Account: { columns: ["owner", "tier"] } });
  });

  it("stores the DEFAULT as absence — a document that recorded it would diff as a decision", () => {
    // "table" IS the derived view and an emptied list IS the derived pick, so
    // neither is an authored option and neither comes back as one.
    expect(screenOptionsFor({ screenOptions: { Account: { view: "table" } } })).toEqual({});
    expect(screenOptionsFor({ screenOptions: { Account: { columns: [], collections: [] } } })).toEqual({});
  });

  it("is empty for a document that carries nothing, and for one that carries nonsense", () => {
    expect(screenOptionsFor({})).toEqual({});
    expect(screenOptionsFor(null)).toEqual({});
    expect(screenOptionsFor({ screenOptions: ["Account"] })).toEqual({});
    expect(screenOptionsFor({ screenOptions: { Account: "board" } })).toEqual({});
  });

  it("the studio and the assembler read it through the ONE definition", () => {
    // MUTATION: give the studio its own parser → the two agree until the day
    // they do not, which is the failure this delegation exists to prevent.
    const doc = { screenOptions: { Account: { columns: ["owner"] } } };
    expect(experienceScreenOptions(doc)).toEqual(screenOptionsFor(doc));
  });
});

/* ── 2 · the build ────────────────────────────────────────────────────────── */

describe("a toggle changes the built application", () => {
  const plain = renderedDoc(build().html);

  it("the columns the operator named head the list, in their order", () => {
    // MUTATION: drop the authored branch in `leadColumnsFor` → RED. The derived
    // pick leads with the title attribute, so the two are never the same.
    const derived = listHeads(plain, "Account");
    expect(derived[0]).toBe("Account Name");
    const chosen = renderedDoc(build({ Account: { columns: ["owner", "industry"] } }).html);
    expect(listHeads(chosen, "Account")).toEqual(["Owner", "Industry"]);
  });

  it("…and head it wherever it appears as a related collection — one definition, not two", () => {
    // Contact's own list and Contact-inside-Account's-detail must agree about
    // what a table of Contacts leads with.
    const chosen = renderedDoc(build({ Contact: { columns: ["accountId", "contactName"] } }).html);
    expect(listHeads(chosen, "Contact")).toEqual(["Account Id", "Contact Name"]);
    const card = chosen.querySelector('[data-fabric-id="region:account:contact"]')!;
    const heads = [...card.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
    // The FK back to the context is dropped there (the same value down the
    // column), so what survives of the choice is the rest of it, in order. No
    // Actions column any more: the way in is the record's own name, inline.
    expect(heads).toEqual(["Contact Name"]);
  });

  it("drops a column the ontology no longer holds, and falls back when nothing survives", () => {
    // A stale document must not mint a column with nothing behind it.
    const stale = renderedDoc(build({ Account: { columns: ["retiredField", "tier"] } }).html);
    expect(listHeads(stale, "Account")).toEqual(["Tier"]);
    const allStale = renderedDoc(build({ Account: { columns: ["retiredField"] } }).html);
    expect(listHeads(allStale, "Account")).toEqual(listHeads(plain, "Account"));
  });

  it("the collection the operator named stands open, and the one it displaced collapses", () => {
    // MUTATION: ignore `optionsFor(name).collections` in the section ordering →
    // RED, Visit stays behind the expander where the derived weight put it.
    const account = detailScreen(plain, "Account");
    expect(sectionEntities(collapsedSections(account), ENTITY_NAMES), "the fixture stopped exercising the budget")
      .toContain("Visit");
    const chosen = renderedDoc(build({ Account: { collections: ["Visit"] } }).html);
    const screen = detailScreen(chosen, "Account");
    expect(sectionEntities(openSections(screen), ENTITY_NAMES)[0]).toBe("Visit");
    expect(collapsedSections(screen).length).toBe(1);
  });

  it("never drops a section to make room — the whole fabric is still in the document", () => {
    // The budget COLLAPSES; a delta still resolves to every region it touches.
    const chosen = renderedDoc(build({ Account: { collections: ["Visit", "Note"] } }).html);
    const declared = deriveFabric(ontology, atlas).nodes
      .filter((n) => n.kind === "region" && n.id.startsWith("region:") && !n.id.endsWith(":summary"))
      .map((n) => n.id);
    const rendered = new Set([...chosen.querySelectorAll("[data-fabric-id]")].map((e) => e.getAttribute("data-fabric-id")));
    expect(declared.filter((id) => !rendered.has(id)), "a section was dropped rather than collapsed").toEqual([]);
    const screen = detailScreen(chosen, "Account");
    expect(openSections(screen).length).toBeLessThanOrEqual(SCREEN_BUDGET.openSections);
  });

  it("the list opens on the board when the operator asked and the ontology can lane one", () => {
    // MUTATION: seed `st()` with "table" unconditionally → RED. Both halves are
    // asserted, because a board drawn under a highlighted Table tab is the
    // control disagreeing with the screen.
    expect(listRegion(plain, "Opportunity").querySelector(".m-board"), "a list opened on a board nobody asked for").toBeNull();
    const chosen = renderedDoc(build({ Opportunity: { view: "board" } }).html);
    expect(listSpec(chosen, "Opportunity").view).toBe("board");
    expect(listRegion(chosen, "Opportunity").querySelector(".m-board")).toBeTruthy();
    const active = chosen.querySelector('.m-tabs[data-view="opportunity"] .m-tab.is-active');
    expect((active?.textContent ?? "").trim()).toBe("Board");
  });

  it("ignores a board asked for on an entity with no status — there are no lanes to build one from", () => {
    // The same rule that decides whether the toggle exists at all. The studio
    // does not offer it (below); the assembler does not honour it either, so a
    // hand-edited document cannot produce a screen with a switch that is a lie.
    const chosen = renderedDoc(build({ Account: { view: "board" } }).html);
    // Refused at the assembler (the spec carries no opening view) AND at the
    // renderer (a board is never drawn without a status column to lane it by).
    expect(listSpec(chosen, "Account").view).toBeUndefined();
    expect(listRegion(chosen, "Account").querySelector(".m-board")).toBeNull();
    expect(listRegion(chosen, "Account").querySelector("table")).toBeTruthy();
    expect(chosen.querySelector('.m-tabs[data-view="account"]')).toBeNull();
  });

  it("an absent option assembles exactly the application there was before", () => {
    expect(build({}).html).toBe(build().html);
    expect(build({ Ghost: { columns: ["nope"] } }).html).toBe(build().html);
  });

  it("assembles byte-identically twice, and does not move the fabric", () => {
    // Determinism: the options are an INPUT, not a generation step. The fabric
    // is the ontology's, so a screen decision must not move it — and with it
    // every seeded value, which is keyed by the fabric version.
    const opts = { Account: { columns: ["owner"], collections: ["Visit"] }, Opportunity: { view: "board" } };
    expect(build(opts).html).toBe(build(opts).html);
    expect(build(opts).fabric.version).toBe(build().fabric.version);
  });
});

/* ── 2b · the same decision reaches every surface ─────────────────────────── */

describe("one document, one application, on every surface that assembles it", () => {
  // The operator's studio, the stakeholder's link and the refine baseline read
  // the SAME record. A surface that skips this input assembles a different
  // application from the one the decision was taken in — and the refine
  // baseline skipping it would check the model's answer against a build nobody
  // asked for. MUTATION: drop `screenOptions` from any of the three → RED.
  const design = { parentEntities: [], screenOptions: { Account: { columns: ["owner", "tier"] }, Opportunity: { view: "board" } } };
  const expected = assemblePrototype(ontology, atlas, undefined, { screenOptions: screenOptionsFor(design) }).html;

  it("the stakeholder's link carries the operator's screen decisions", () => {
    const portal = pilotSliceFor({ domainOntology: ontology, currentStateAtlas: atlas, experienceDesign: design });
    expect(portal.pilotHtml).toBe(expected);
    expect(listHeads(renderedDoc(portal.pilotHtml!), "Account")).toEqual(["Owner", "Tier"]);
  });

  it("the refine baseline is the build the operator is looking at", () => {
    const baseline = prototypeBaselineFor(ontology, atlas, design)!;
    expect(baseline.html).toBe(expected);
  });

  it("the operator's own preview is that same build", () => {
    // The studio that shows the prototype assembles it in the browser. It reads
    // the design document for the menu and the palette; skipping this input
    // would show the operator a build their stakeholders never get.
    const program = {
      id: "p-xd2", name: "Screen options fixture", client: "Fixture Co", methodology: "atos-flow",
      rawData: { data: { domainOntology: ontology, currentStateAtlas: atlas, experienceDesign: design } },
    } as unknown as ProgramSummary;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const r = createRoot(el);
    act(() => { r.render(createElement(PrototypeStudio, { doc: {}, program, onChange: () => {} })); });
    const frame = el.querySelector("iframe")!;
    expect(frame.getAttribute("srcdoc")).toBe(expected);
    act(() => { r.unmount(); });
    el.remove();
  });

  it("and an undecided document assembles the derived build on all of them", () => {
    const bare = assemblePrototype(ontology, atlas).html;
    expect(pilotSliceFor({ domainOntology: ontology, currentStateAtlas: atlas }).pilotHtml).toBe(bare);
    expect(prototypeBaselineFor(ontology, atlas, {})!.html).toBe(bare);
  });
});

/* ── 3 · the offer ────────────────────────────────────────────────────────── */

describe("the surface offers only what the build will spend", () => {
  const facts = Object.fromEntries(screenFactsFor(ontology, atlas).map((f) => [f.entity, f] as const));
  const plain = renderedDoc(build().html);

  it("the collections it offers ARE the child regions the detail page carries", () => {
    // MUTATION: derive the offer from the ontology's `relations` as written
    // rather than from the fabric → RED on the direction-normalised pairs.
    for (const name of ENTITY_NAMES) {
      const screen = detailScreen(plain, name);
      const rendered = sectionEntities([...openSections(screen), ...collapsedSections(screen)], ENTITY_NAMES);
      expect(new Set(facts[name].collections), `${name}`).toEqual(new Set(rendered));
    }
  });

  it("…in the same ORDER the page will stand them in, whatever the operator names", () => {
    // The studio tells the operator which sections stand open. It computes that
    // through `openSectionPlan`; the page computes it while rendering. The two
    // are the same rule or the surface is describing a different application.
    for (const authored of [[], ["Visit"], ["Note", "Visit"], ["Ghost"]]) {
      const chosen = renderedDoc(build({ Account: { collections: authored } }).html);
      const screen = detailScreen(chosen, "Account");
      const plan = openSectionPlan(facts["Account"].collections, authored);
      expect(sectionEntities(openSections(screen), ENTITY_NAMES), `authored ${authored.join()}`).toEqual(plan.open);
      expect(sectionEntities(collapsedSections(screen), ENTITY_NAMES)).toEqual(plan.collapsed);
    }
  });

  it("the columns it offers are the entity's own attributes — the exact set the build accepts", () => {
    for (const e of ontology.entities as Array<{ name: string; attributes: string[] }>) {
      expect(facts[e.name].attributes).toEqual(e.attributes);
    }
  });

  it("a status is stated for exactly the entities whose list gets a view switch", () => {
    // MUTATION: report a status for every entity → RED on the six without one.
    for (const name of ENTITY_NAMES) {
      const hasSwitch = !!plain.querySelector(`.m-tabs[data-view="${slug(name)}"]`);
      expect(!!facts[name].status, `${name}: switch=${hasSwitch}`).toBe(hasSwitch);
    }
    expect(facts["Opportunity"].status, "the fixture stopped having a pipeline").toBe("stage");
  });

  it("holds on the snapshot fixture too, at 33 entities", () => {
    const wide = screenFactsFor(snap("domain-ontology.json"), snap("current-state-atlas.json"));
    expect(wide.length).toBeGreaterThan(20);
    const built = renderedDoc(assemblePrototype(snap("domain-ontology.json"), snap("current-state-atlas.json")).html);
    const names = wide.map((f) => f.entity);
    for (const f of wide) {
      const screen = built.querySelector(`section[data-screen="detail-${slug(f.entity)}"]`);
      if (!screen) continue;
      const rendered = sectionEntities([...openSections(screen), ...collapsedSections(screen)], names);
      expect(new Set(f.collections), f.entity).toEqual(new Set(rendered));
      expect(!!f.status, `${f.entity} view switch`).toBe(!!built.querySelector(`.m-tabs[data-view="${slug(f.entity)}"]`));
    }
  });
});

/* ── 4 · the studio ───────────────────────────────────────────────────────── */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const PROGRAM = {
  id: "p-xd", name: "Screen options fixture", client: "Fixture Co", methodology: "atos-flow",
  rawData: { data: { domainOntology: ontology, currentStateAtlas: atlas } },
} as unknown as ProgramSummary;

/** The last document the studio wrote — every assertion reads this, so a control
 *  that renders and never writes fails the test it claims to pass. */
let wrote: Record<string, unknown> | null = null;
let root: Root | null = null;
let host: HTMLElement | null = null;

function Harness({ initial, locked }: { initial: Record<string, unknown>; locked: boolean }) {
  const [doc, setDoc] = useState(initial);
  return createElement(StudioLockContext.Provider, { value: locked },
    createElement(ExperienceDesignStudio, {
      doc, program: PROGRAM,
      onChange: (next: Record<string, unknown>) => { wrote = next; setDoc(next); },
    }));
}

function mount(initial: Record<string, unknown> = {}, locked = false): HTMLElement {
  wrote = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(createElement(Harness, { initial, locked })); });
  return host;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = null; host = null; wrote = null;
});

const click = (el: Element | null | undefined) => {
  if (!el) throw new Error("click: no element");
  act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
};
/** The options panel belonging to one entity's row. */
const panelFor = (el: ParentNode, name: string): HTMLElement => {
  const row = [...el.querySelectorAll(".v3ed-row")]
    .find((r) => (r.querySelector(".v3ed-name")?.textContent ?? "").trim() === name);
  const panel = row?.querySelector(".v3ed-opts");
  if (!panel) throw new Error(`no options panel for ${name}`);
  return panel as HTMLElement;
};
const chip = (panel: ParentNode, label: string): HTMLButtonElement => {
  const hit = [...panel.querySelectorAll(".v3ed-chip")]
    .find((b) => (b.textContent ?? "").replace(/#\d+$/, "").trim() === label);
  if (!hit) throw new Error(`no chip “${label}” among ${[...panel.querySelectorAll(".v3ed-chip")].map((b) => b.textContent).join(" / ")}`);
  return hit as HTMLButtonElement;
};
const text = (el: ParentNode) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("the studio takes the decision, and states what the build will do with it", () => {
  it("writes the chosen column onto the document, in click order", () => {
    const el = mount();
    click(chip(panelFor(el, "Account"), "Owner"));
    expect(screenOptionsFor(wrote)).toEqual({ Account: { columns: ["owner"] } });
    click(chip(panelFor(el, "Account"), "Tier"));
    expect(screenOptionsFor(wrote)).toEqual({ Account: { columns: ["owner", "tier"] } });
  });

  it("…and what it writes is what the build heads the table with", () => {
    // THE WHOLE POINT: the studio's write and the assembler's read are the same
    // decision. This closes the loop rather than asserting each half alone.
    const el = mount();
    click(chip(panelFor(el, "Account"), "Region"));
    const doc = renderedDoc(build(screenOptionsFor(wrote) as Record<string, unknown>).html);
    expect(listHeads(doc, "Account")).toEqual(["Region"]);
  });

  it("un-choosing the last one removes the entry — the default is never recorded", () => {
    const el = mount({ screenOptions: { Account: { columns: ["owner"] } } });
    click(chip(panelFor(el, "Account"), "Owner"));
    expect(wrote?.screenOptions).toEqual({});
    expect(screenOptionsFor(wrote)).toEqual({});
  });

  it("offers a board where the ontology can lane one, and NOTHING where it cannot", () => {
    // MUTATION: render the Table/Board pair unconditionally → RED. A switch that
    // writes a view the assembler discards is the placeholder defect again.
    const el = mount();
    expect(() => chip(panelFor(el, "Opportunity"), "Board")).not.toThrow();
    expect(() => chip(panelFor(el, "Account"), "Board")).toThrow();
    expect(text(panelFor(el, "Account"))).toContain("declares no status attribute");
    click(chip(panelFor(el, "Opportunity"), "Board"));
    expect(screenOptionsFor(wrote)).toEqual({ Opportunity: { view: "board" } });
  });

  it("offers a column for every attribute and a collection for every child region — no more", () => {
    const el = mount();
    const facts = readScreenFacts(PROGRAM);
    for (const name of ENTITY_NAMES) {
      const labels = [...panelFor(el, name).querySelectorAll(".v3ed-chip")]
        .map((b) => (b.textContent ?? "").replace(/#\d+$/, "").trim());
      const f = facts.get(name)!;
      for (const c of f.collections) expect(labels, `${name} offers ${c}`).toContain(c);
      // Nothing offered beyond the attributes, the collections and the (at most
      // two) view chips: an offer with no home in the ontology is the defect.
      const budget = f.attributes.length + f.collections.length + (f.status ? 2 : 0);
      expect(labels.length, `${name} offers ${labels.length} chips for ${budget} facts`).toBe(budget);
    }
  });

  it("names what will NOT appear when the choice runs past the page's budget", () => {
    // Silent truncation is the failure: the operator chose six columns and the
    // table shows five. The surface says which one is over the line.
    const over = ["owner", "tier", "region", "industry", "accountName", "healthNote"];
    const el = mount({ screenOptions: { Account: { columns: over } } });
    const panel = panelFor(el, "Account");
    expect(text(panel)).toContain("will not appear");
    expect(text(panel)).toContain("Health Note");
    const doc = renderedDoc(build({ Account: { columns: over } }).html);
    expect(listHeads(doc, "Account")).toHaveLength(SCREEN_BUDGET.listColumns);
    expect(listHeads(doc, "Account")).not.toContain("Health Note");
  });

  it("says which sections stand open and which collapse, by name", () => {
    const el = mount({ screenOptions: { Account: { collections: ["Visit"] } } });
    const said = text(panelFor(el, "Account"));
    const plan = openSectionPlan(readScreenFacts(PROGRAM).get("Account")!.collections, ["Visit"]);
    expect(said).toContain(`Stands open: ${plan.open.join(", ")}`);
    for (const c of plan.collapsed) expect(said, `${c} vanished from the account`).toContain(c);
  });

  it("offers options only for entities the build will give a screen to", () => {
    // Uncurated, every entity gets one. Curated, only the chosen — offering
    // options for a screen that will not exist is offering unspendable work.
    const uncurated = mount();
    for (const name of ENTITY_NAMES) expect(() => panelFor(uncurated, name)).not.toThrow();
    act(() => { root?.unmount(); }); host?.remove();
    const curated = mount({ parentEntities: ["Account"] });
    expect(() => panelFor(curated, "Account")).not.toThrow();
    expect(() => panelFor(curated, "Opportunity")).toThrow();
  });

  it("writes nothing at all when the artifact is locked", () => {
    const el = mount({}, true);
    click(chip(panelFor(el, "Account"), "Owner"));
    expect(wrote).toBeNull();
  });
});

/**
 * LIVE vs AS GENERATED — one build, two moments (2026-08-16, operator direction).
 *
 * The studio's preview re-assembled by hand and matched the edge on every input
 * it listed — and still showed a POORER build than the record held, because two
 * inputs were missing and both were ones a previous round had already earned:
 * the accepted screen spec, and the approved skin. That gap is what made
 * "Fabric vs Refined build" read as a choice between two designs.
 *
 * The preview now IS `prototypeBaselineOfProgram` — the function the edge builds
 * its refine baseline with — so the operator's preview, the stakeholder's link
 * and the post-condition the model is judged against are the same build by
 * construction rather than by a matching argument list.
 */
describe("the operator's preview carries what previous rounds earned", () => {
  const stored = (extra: Record<string, unknown>) => ({
    domainOntology: ontology,
    currentStateAtlas: atlas,
    experienceDesign: { parentEntities: [], screenOptions: {} },
    ...extra,
  });

  it("the accepted screen spec is drawn — a widget the operator has already seen does not vanish from the preview", () => {
    const spec = { screens: [{ screen: "list-account", widgets: [{ kind: "stat", entity: "Account" }] }] };
    const withSpec = prototypeBaselineOfProgram(stored({ prototypeBuild: { screenSpec: spec, html: "" } }))!;
    const without = prototypeBaselineOfProgram(stored({}))!;
    expect(withSpec.specAccepted).toBeGreaterThan(0);
    expect(without.specAccepted).toBe(0);
    expect(withSpec.html).not.toBe(without.html);
  });

  it("the approved skin is worn — the preview is not reset to the stock stylesheet", () => {
    const plain = prototypeBaselineOfProgram(stored({}))!;
    const reskinned = plain.stylesheet + "\n.m-approved-skin{color:#0b3d2e}";
    const priorHtml = plain.html.replace(plain.stylesheet, reskinned);
    const carried = prototypeBaselineOfProgram(stored({ prototypeBuild: { html: priorHtml } }))!;
    expect(carried.html).toContain(".m-approved-skin");
  });

  it("a skin that cannot parse is refused, so one bad restyle cannot poison the preview", () => {
    const plain = prototypeBaselineOfProgram(stored({}))!;
    const broken = plain.html.replace("box-sizing:border-box", "box-sizing:var(--never-closed");
    const carried = prototypeBaselineOfProgram(stored({ prototypeBuild: { html: broken } }))!;
    expect(carried.stylesheet).toBe(plain.stylesheet);
  });
});
