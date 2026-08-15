/**
 * E3 · THE ATLAS ALREADY KNEW WHO DOES THE WORK.
 *
 * A current-state atlas states, per workflow, an owner and a sequence of steps
 * each carrying an actor, a system and the entities it touches. The assembled
 * prototype used none of it: `deriveFabric` minted one `flow:` node per
 * workflow and the assembler read `kind === "flow"` exactly zero times, so the
 * application had one list and one detail per entity and not one screen that
 * belonged to a person. The refined path's twelve fabricated dashboards were
 * reaching for that screen and had to invent it, because the derived path
 * offered nothing to reach for.
 *
 * These pin the workbench as DERIVED rather than invented:
 *
 *   - every role the atlas names gets one, and every workflow lands on exactly
 *     one of them;
 *   - its queue is real seeded records of the entities its own steps name,
 *     headed the way that entity's own list screen heads it, and every row
 *     opens THAT record;
 *   - its lanes are the status values those records actually carry;
 *   - every name the atlas states survives: an actor who owns no workflow is a
 *     collaborator on the role that does, an entity the ontology does not hold
 *     is printed as unmodelled, and an entity outside this build's menu is
 *     printed as having no screen — none of them is quietly filtered out;
 *   - and the `flow:` nodes finally have a rendering.
 *
 * Everything is read off the RENDERED document (parsed, script run), because
 * the queues are drawn client-side from the data island and a source grep would
 * pass with the renderer deleted.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { generateSeed } from "@shared/seedData.ts";
import { deriveWorkbenches, atlasWorkflows, roleOf } from "@shared/atlasWorkbenches.ts";
import { loadPrototype } from "./helpers/renderPrototype";

const ROOT = resolve(__dirname, "../../..");
const snap = (f: string) => JSON.parse(readFileSync(resolve(ROOT, `docs/laila/snapshot-2026-08-07/${f}`), "utf8")) as Record<string, unknown>;
const ontology = snap("domain-ontology.json");
const atlas = snap("current-state-atlas.json");

/** A three-entity ontology and its atlas, from a domain that is not a CRM —
 *  nothing below may have learned one build's shape. */
const clinic = {
  entities: [
    { name: "Case", attributes: ["id", "name", "status", "acuity"] },
    { name: "Theatre", attributes: ["id", "label"] },
    { name: "Anesthesia Record", attributes: ["id", "type", "caseId"] },
  ],
  relations: [{ from: "Case", to: "Anesthesia Record", cardinality: "1:N" }],
} as unknown as Record<string, unknown>;
const clinicAtlas = {
  workflows: [
    {
      name: "Case Cancellation Review", owner: "Theatre Scheduler", trigger: "A case is cancelled",
      steps: [
        { action: "Read the cancelled case and its reason", actor: "Theatre Scheduler", system: "Theatre system", entities: ["Case", "Theatre"] },
        { action: "Re-book the list", actor: "Ward Clerk", entities: ["Case", "Consent Form"] },
      ],
      handoffs: ["Scheduler → Ward"],
    },
    { name: "Recovery Handover", owner: "Recovery Nurse", steps: [{ action: "Hand the patient over", actor: "Recovery Nurse", entities: ["Anesthesia Record"] }] },
  ],
} as unknown as Record<string, unknown>;

const built = assemblePrototype(ontology, atlas);
const doc = loadPrototype(built.html).doc;
const clinicBuilt = assemblePrototype(clinic, clinicAtlas);
const clinicDoc = loadPrototype(clinicBuilt.html).doc;

const screen = (d: Document, id: string) => d.querySelector(`[data-screen="${id}"]`);
const textOf = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("every role the atlas names has a workbench", () => {
  it("one screen per role, and every workflow lands on exactly one", () => {
    // MUTATION: drop the workbench screens from the document → RED.
    const roles = deriveWorkbenches(atlas);
    expect(roles.length).toBeGreaterThan(3);
    for (const r of roles) {
      const s = screen(doc, `work-${r.slug}`);
      expect(s, `no workbench screen for "${r.role}"`).toBeTruthy();
      expect(textOf(s)).toContain(r.role);
    }
    // Every named workflow appears on exactly one workbench, by name.
    for (const w of atlasWorkflows(atlas)) {
      const hosts = roles.filter((r) => r.workflows.some((x) => x.name === w.name));
      expect(hosts.length, `${w.name} is on ${hosts.length} workbenches`).toBe(1);
      expect(textOf(screen(doc, `work-${hosts[0].slug}`))).toContain(w.name);
    }
  });

  it("the atlas's flow nodes finally have a rendering", () => {
    // The fabric mints `flow:{slug}` per workflow and the assembler read
    // `kind === "flow"` zero times. MUTATION: return the workflow block without
    // its region wrapper → RED.
    const flows = deriveFabric(ontology, atlas).nodes.filter((n) => n.kind === "flow");
    expect(flows.length).toBeGreaterThan(5);
    for (const n of flows) {
      const el = doc.querySelector(`[data-fabric-id="${n.id}"]`);
      expect(el, `flow node ${n.id} has no rendering`).toBeTruthy();
      expect(textOf(el), `flow node ${n.id} rendered empty`).toContain(String(n.source.atlasWorkflow));
    }
  });

  it("no atlas, no workbenches — a section with nothing in it is not drawn", () => {
    const bare = assemblePrototype(ontology, {});
    const bareDoc = loadPrototype(bare.html).doc;
    expect(bareDoc.querySelector('[data-screen^="work-"]')).toBeNull();
    expect(bareDoc.querySelector('nav[aria-label="Workbenches and agents"]')).toBeNull();
    expect(bareDoc.querySelector('aside.m-side nav[aria-label="Records"]')).toBeTruthy();
    // …and an ontology with no entities assembles nothing at all, atlas or no.
    expect(assemblePrototype({ entities: [] }, atlas).regionCount).toBe(0);
  });
});

describe("a queue is that role's records, not a table of everything", () => {
  const roles = deriveWorkbenches(atlas);
  const withQueue = roles.find((r) => r.entities.includes("Contract"))!;

  it("lists real seeded records of an entity the role's own steps name", () => {
    // MUTATION: drop renderQueue from the persona renderer → RED. The card
    // wrapper is served; the rows are the renderer's, so this reads the tree.
    const s = screen(doc, `work-${withQueue.slug}`)!;
    const card = s.querySelector('[data-region$=":contract"]')!;
    expect(card, "no Contract queue on the role whose steps name it").toBeTruthy();
    const rows = [...card.querySelectorAll("tbody tr")];
    expect(rows.length).toBeGreaterThan(0);
    const seed = generateSeed(ontology, deriveFabric(ontology, atlas).version);
    const ids = new Set((seed.records.Contract ?? []).map((r) => String(r.id)));
    for (const tr of rows) expect([...ids].some((id) => textOf(tr).includes(id)), `a queue row names no real Contract: ${textOf(tr)}`).toBe(true);
  });

  it("every row opens THAT record, and the card states the true total", () => {
    const card = screen(doc, `work-${withQueue.slug}`)!.querySelector('[data-region$=":contract"]')!;
    const seed = generateSeed(ontology, deriveFabric(ontology, atlas).version);
    const total = (seed.records.Contract ?? []).length;
    expect(textOf(card.querySelector(".m-card-h"))).toContain(String(total));
    for (const tr of [...card.querySelectorAll("tbody tr")]) {
      const id = textOf(tr.querySelector(".m-cell-sub"));
      const open = tr.querySelector("button")!;
      expect(open.getAttribute("onclick"), "a queue row's Open goes somewhere else").toContain(id);
    }
    // A five-row page of a longer list SAYS it is a page — the header/rows
    // contradiction the render gate exists to catch.
    if (total > 5) expect(textOf(card)).toMatch(/View all \d+ Contract/);
  });

  it("its lanes are the status values the records actually carry", () => {
    // MUTATION: emit lanes for an entity with no status column → RED below.
    const card = screen(doc, `work-${withQueue.slug}`)!.querySelector('[data-region$=":contract"]')!;
    const seed = generateSeed(ontology, deriveFabric(ontology, atlas).version);
    const lanes = [...card.querySelectorAll(".m-lanes .m-badge")].map((b) => textOf(b));
    const statusAttr = (ontology.entities as Array<Record<string, unknown>>)
      .find((e) => e.name === "Contract")!.attributes as string[];
    if (statusAttr.some((a) => /status|stage|state/i.test(a))) {
      expect(lanes.length).toBeGreaterThan(0);
      const counted = lanes.map((l) => Number(l.split("·").pop())).reduce((a, b) => a + b, 0);
      expect(counted, "the lanes do not add up to the queue").toBe((seed.records.Contract ?? []).length);
    }
    // An entity with no status attribute is offered no lanes at all.
    const theatre = screen(clinicDoc, "work-theatre-scheduler")!.querySelector('[data-region$=":theatre"]');
    expect(theatre && theatre.querySelector(".m-lanes")).toBeFalsy();
  });
});

describe("every name the atlas states stays visible", () => {
  it("an actor who owns no workflow is named as a collaborator, on the role that does", () => {
    // MUTATION: drop `collaborators` from the header → RED. "Ward Clerk" acts
    // in a step and owns nothing; filtering the roles down to owners would make
    // that person a name buried in one step of one workflow — so the header of
    // the role they work with has to carry them, not only the step does.
    const actors = new Set<string>();
    for (const w of atlasWorkflows(clinicAtlas)) { actors.add(roleOf(w)); for (const s of w.steps) if (s.actor) actors.add(s.actor); }
    const everything = textOf(clinicDoc.body);
    for (const a of actors) expect(everything, `the atlas names "${a}" and the application does not`).toContain(a);
    const header = textOf(screen(clinicDoc, "work-theatre-scheduler")!.querySelector(".m-page-h"));
    expect(header, "the persona's own header does not say who they work with").toContain("Ward Clerk");
    expect(header).not.toContain("Recovery Nurse");   // a different role's, not this one's
  });

  it("two roles that reduce to the same slug get two screens, not one", () => {
    // MUTATION: drop the slug uniquifier → RED. Two workbenches sharing a
    // `data-screen` is one persona silently shadowing another — the positional
    // -identity defect this codebase has already paid for three times.
    const twins = {
      workflows: [
        { name: "Intake", owner: "Sales Ops", steps: [{ action: "Take the call", actor: "Sales Ops", entities: ["Case"] }] },
        { name: "Triage", owner: "sales ops", steps: [{ action: "Sort the queue", actor: "sales ops", entities: ["Case"] }] },
      ],
    } as unknown as Record<string, unknown>;
    const roles = deriveWorkbenches(twins);
    expect(roles.map((r) => r.role)).toEqual(["Sales Ops", "sales ops"]);
    expect(new Set(roles.map((r) => r.slug)).size, "two roles collapsed onto one address").toBe(2);
    const d = loadPrototype(assemblePrototype(clinic, twins).html).doc;
    for (const r of roles) expect(textOf(screen(d, `work-${r.slug}`)), `no screen for "${r.role}"`).toContain(r.workflows[0].name);
  });

  it("an entity the ontology does not hold is printed as unmodelled", () => {
    // "Consent Form" is named by a step and is in no ontology here. A filtered
    // list would drop it silently; a miss has to stay visible.
    const s = screen(clinicDoc, "work-theatre-scheduler")!;
    expect(textOf(s)).toContain("Consent Form");
    expect(textOf(s)).toMatch(/Not modelled/i);
    expect(textOf(s)).toMatch(/Confirm in Listen/i);
  });

  it("an entity outside this build's menu is printed as having no screen", () => {
    // A curated build has screens for the chosen entities only. An atlas step
    // naming one of the others must say so rather than queue a row that opens
    // nothing.
    const curated = assemblePrototype(ontology, atlas, ["Account"]);
    const cdoc = loadPrototype(curated.html).doc;
    const roles = deriveWorkbenches(atlas);
    const legal = roles.find((r) => r.entities.includes("Contract"))!;
    const s = screen(cdoc, `work-${legal.slug}`)!;
    expect(textOf(s)).toMatch(/No screen/i);
    expect(textOf(s)).toContain("Contract");
    expect(s.querySelector('[data-region$=":contract"]'), "queued an entity with no screen to open").toBeNull();
  });
});

describe("the workbench is addressable and deterministic", () => {
  it("a deep link opens the persona's screen", () => {
    const role = deriveWorkbenches(atlas)[0];
    const deep = loadPrototype(built.html, { url: `https://prototype.test/#workbench/${role.slug}` });
    const shown = [...deep.doc.querySelectorAll(".m-screen")].filter((s) => !s.hasAttribute("hidden"));
    expect(shown.map((s) => s.getAttribute("data-screen"))).toEqual([`work-${role.slug}`]);
    expect(deep.consoleErrors).toEqual([]);
  });

  it("the route word is reserved against the ontology's own slugs", () => {
    // An entity called "Workbench" must keep its own list screen; the persona
    // route steps aside rather than shadowing it.
    const clash = {
      entities: [{ name: "Workbench", attributes: ["id", "name"] }, { name: "Job", attributes: ["id", "name", "workbenchId"] }],
      relations: [{ from: "Workbench", to: "Job", cardinality: "1:N" }],
    } as unknown as Record<string, unknown>;
    const page = assemblePrototype(clash, clinicAtlas);
    const loaded = loadPrototype(page.html, { url: "https://prototype.test/#workbench" });
    const shown = [...loaded.doc.querySelectorAll(".m-screen")].filter((s) => !s.hasAttribute("hidden"));
    expect(shown.map((s) => s.getAttribute("data-screen"))).toEqual(["list-workbench"]);
    expect(page.html).toContain("#workbench-2/");
  });

  it("same atlas, same workbenches — no clock, no RNG", () => {
    expect(deriveWorkbenches(atlas)).toEqual(deriveWorkbenches(atlas));
    expect(assemblePrototype(ontology, atlas).html).toBe(built.html);
    const src = readFileSync(resolve(ROOT, "supabase/functions/_shared/atlasWorkbenches.ts"), "utf8");
    for (const forbidden of ["Date.now", "new Date", "Math.random"]) expect(src).not.toContain(forbidden);
  });

  it("the workbench navigation is its own landmark, not more record rows", () => {
    // The operator's curated menu is a statement about RECORD types; a persona
    // is not one, and must not appear to be one.
    const records = doc.querySelector('aside.m-side nav[aria-label="Records"]')!;
    const aux = doc.querySelector('aside.m-side nav[aria-label="Workbenches and agents"]')!;
    expect(records).toBeTruthy();
    expect(aux).toBeTruthy();
    expect(records.textContent).not.toContain("Workbenches");
    const roles = deriveWorkbenches(atlas);
    expect([...aux.querySelectorAll(".m-nav-item")].length).toBeGreaterThanOrEqual(roles.length);
  });
});
