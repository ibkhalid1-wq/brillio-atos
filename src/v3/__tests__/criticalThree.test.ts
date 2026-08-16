/**
 * THE THREE CRITICALS THE GATE COULD NOT SEE.
 *
 * A 205-file, 3096-test suite was green while all three of these were live —
 * which is the point of writing them down here. Each was found by adversarial
 * review, not by the build.
 *
 *   C1  On a CURATED build the parent link cards navigate to entities that have
 *       no screen. Screens are built for the curated menu only; `es` slugs every
 *       entity in the ontology. 166 such cards on a reviewed CRM build — each a
 *       control that changes the URL and silently lands on the home list.
 *   C2  The refine post-condition's guarded value set was computed from a seed
 *       generated WITHOUT the value vocabulary, while the page it checks was
 *       assembled WITH it. On any programme holding a vocabulary the guarded set
 *       collapsed and the only check between the model's output and the stored
 *       artifact stopped checking.
 *   C3  The stakeholder's pilot assembled a DIFFERENT APPLICATION from the
 *       operator's studio: it passed `undefined` for the menu and never passed
 *       the blueprint, so the person asked to validate the prototype validated a
 *       menu nobody authored, with the agents missing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { pilotSliceFor } from "@shared/prototypePilot.ts";
import { renderedDoc } from "./helpers/renderPrototype";

const ent = (name: string, attributes: string[]) => ({ name, attributes, definition: name });
const ontology = {
  entities: [
    ent("Account", ["id", "name"]),
    ent("Opportunity", ["id", "name", "stage", "accountId"]),
    ent("Partner", ["id", "name"]),
    ent("Invoice", ["id", "ref", "accountId"]),
  ],
  relations: [
    { from: "Partner", to: "Account", cardinality: "1:N" },
    { from: "Account", to: "Opportunity", cardinality: "1:N" },
    { from: "Account", to: "Invoice", cardinality: "1:N" },
  ],
};
const atlas = { workflows: [] };

describe("C1 · a link is a promise the destination exists", () => {
  // Account is curated; Partner — its structural parent — is NOT, so Account's
  // detail carries a parent reference to a screen this build never made.
  const doc = renderedDoc(assemblePrototype(ontology, atlas, ["Account", "Opportunity"]).html);

  it("renders no control whose destination was not built", () => {
    // MUTATION: drop the closure → RED. A record link (#slug/id) needs a DETAIL
    // screen; a browse link (#slug) needs a LIST. The first version of this
    // guard checked both against the list screens, which was the pre-closure
    // contract: it called a working drill-through broken.
    const screens = new Set([...doc.querySelectorAll("[data-screen]")]
      .map((s) => s.getAttribute("data-screen") || ""));
    const broken: string[] = [];
    for (const el of doc.querySelectorAll("button.m-linkcard")) {
      const m = (el.getAttribute("onclick") || "").match(/#([a-z0-9-]+)(\/)?/);
      if (!m) continue;
      const want = m[2] ? `detail-${m[1]}` : `list-${m[1]}`;
      if (!screens.has(want)) broken.push(want);
    }
    expect(broken, `link cards pointing at screens that do not exist: ${broken.join(", ")}`).toEqual([]);
  });

  it("leaves a link alone when the parent IS in the build", () => {
    const all = renderedDoc(assemblePrototype(ontology, atlas).html);   // uncurated: every screen exists
    const links = [...all.querySelectorAll("button.m-linkcard")];
    expect(links.length, "the uncurated build lost its parent links").toBeGreaterThan(0);
  });
});

describe("C2 · the refine baseline reads the seed the page was drawn from", () => {
  // Asserted on the SOURCE because the failure is an argument that was omitted:
  // there is no output difference to observe on a programme with no vocabulary,
  // which is exactly why it survived a green suite.
  const src = readFileSync(resolve(__dirname, "../../../supabase/functions/_shared/prototypeRefine.ts"), "utf8");

  it("passes the vocabulary to generateSeed, as the assembly is passed it", () => {
    // MUTATION: drop the opts argument → RED.
    const call = src.match(/generateSeed\(ontology,\s*fabric\.version[^)]*\)/);
    expect(call, "the baseline no longer seeds — move or drop this guard").not.toBeNull();
    expect(call![0], "the baseline seeds without the vocabulary the page used").toContain("vocabulary");
  });
});

describe("C3 · one record, one application, on both surfaces", () => {
  const inner = {
    domainOntology: ontology,
    currentStateAtlas: atlas,
    experienceDesign: { parentEntities: ["Account", "Opportunity"] },
    // An agent is bound to a record through its inputs/outputs — the field the
    // blueprint actually uses (`deriveAgenticSurface` resolves those names), not
    // a bare `entity`. Probed against the assembler rather than assumed.
    agenticBlueprint: { agents: [{ name: "Renewal Watch", purpose: "Watch renewals", inputs: ["Account"], outputs: ["Opportunity"], autonomyLevel: "high" }] },
  };

  it("the stakeholder's pilot honours the operator's menu", () => {
    // MUTATION: pass `undefined` for parentEntities again → RED. The pilot built
    // every entity's screen while the studio built two.
    const html = pilotSliceFor(inner).pilotHtml ?? "";
    expect(html, "the pilot produced no prototype").toBeTruthy();
    const pilotScreens = [...renderedDoc(html).querySelectorAll("[data-screen^='list-']")]
      .map((s) => s.getAttribute("data-screen")).sort();
    const studioScreens = [...renderedDoc(assemblePrototype(ontology, atlas, ["Account", "Opportunity"], {
      blueprint: inner.agenticBlueprint,
    }).html).querySelectorAll("[data-screen^='list-']")].map((s) => s.getAttribute("data-screen")).sort();
    expect(pilotScreens).toEqual(studioScreens);
  });

  it("the pilot carries the blueprint, so the agents are on the records", () => {
    // MUTATION: drop `blueprint` from the pilot's options → RED.
    expect(pilotSliceFor(inner).pilotHtml ?? "").toContain("Renewal Watch");
  });
});

describe("drill-through: the menu decides what is LISTED, not what can be opened", () => {
  const doc = renderedDoc(assemblePrototype(ontology, atlas, ["Account", "Opportunity"]).html);
  const screens = new Set([...doc.querySelectorAll("[data-screen]")]
    .map((s) => s.getAttribute("data-screen") || ""));

  it("gives every reachable entity a DETAIL page to land on", () => {
    // MUTATION: build screens for `ordered` only → RED. Partner is Account's
    // parent and absent from the menu, so before the closure its link card had
    // nowhere to go.
    expect(screens.has("detail-partner"), "a reachable parent is still a dead end").toBe(true);
    expect(screens.has("detail-invoice"), "a reachable child is still a dead end").toBe(true);
  });

  it("does NOT give it a list or a form — it is not in the menu", () => {
    // The saving, and the meaning of curation. MUTATION: build list+form for the
    // closure too → RED, and a 33-entity snapshot goes 13 screens → 95.
    expect(screens.has("list-partner")).toBe(false);
    expect(screens.has("form-partner")).toBe(false);
    expect(screens.has("list-account"), "a menu entity lost its list").toBe(true);
  });

  it("keeps the menu exactly as the operator set it", () => {
    const navs = [...doc.querySelectorAll("[data-nav]")].map((n) => n.getAttribute("data-nav")).sort();
    expect(navs).toEqual(["list-account", "list-opportunity"]);
  });

  it("offers no control that needs a screen this build lacks", () => {
    // "View all N" and the browse fallback both target a LIST. On a
    // reachable-only entity there is none, so neither may be rendered.
    const built = new Set([...screens]);
    const dead: string[] = [];
    for (const el of doc.querySelectorAll("button[onclick]")) {
      const m = (el.getAttribute("onclick") || "").match(/#([a-z0-9-]+)(\/)?/);
      if (!m) continue;
      const want = m[2] ? `detail-${m[1]}` : `list-${m[1]}`;
      if (!built.has(want) && !built.has(`detail-${m[1]}`)) dead.push(want);
    }
    expect([...new Set(dead)], `controls with no destination: ${dead.join(", ")}`).toEqual([]);
  });
});
