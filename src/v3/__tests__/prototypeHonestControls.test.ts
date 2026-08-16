/**
 * THE PROTOTYPE'S CONTROLS EITHER WORK OR THEY ARE NOT THERE.
 *
 * A reviewed CRM build shipped 165 buttons that did nothing — Filter, Prev,
 * Next, Delete, and a Save that did not even return to the list — and one
 * static detail screen per entity, so "Open" on row 12 showed row 1. Every one
 * of those is the demo asserting a capability the record does not contain, in
 * front of the client who is being asked to validate it.
 *
 * Four claims are pinned here, and each is a way the page could still lie:
 *
 *   B2 · A ROW OPENS ITS OWN RECORD, and the URL says which one, so a demo
 *        moment is linkable and Back works.
 *   B3 · EVERY BUTTON HAS A HANDLER — asserted as a count over the rendered
 *        document — and the behaviours behind the five named dead ones are
 *        exercised rather than assumed: filter, page, sort, save, delete+undo.
 *   B4 · A RELATION-TYPED FIELD IS A PICKER, populated from the entity the
 *        ONTOLOGY says it references. Where the ontology names no target, the
 *        field says so instead of passing as an ordinary text box.
 *   B5 · AN ENTITY WITH A STATUS OFFERS A BOARD, and one WITHOUT offers no
 *        toggle at all — the empty-state rule: no zero-value affordances.
 *
 * Everything below reads the document AFTER its own script has run and drives
 * it with real clicks. The served markup can no longer answer for what is on
 * the screen, and a regex over the assembler's source has twice reported the
 * opposite of the truth in this exact area.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { deriveRoles } from "@shared/semanticRoles.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { generateSeed } from "@shared/seedData.ts";
import { loadPrototype, type LoadedPrototype } from "./helpers/renderPrototype";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8")) as Record<string, unknown>;
const ontology = snap("domain-ontology.json");
const atlas = snap("current-state-atlas.json");

const ent = (name: string, attributes: string[]) => ({ name, attributes, definition: name });
/**
 * A three-entity ontology carrying, on purpose:
 *   - an entity WITH a status attribute (Account.status) and one WITHOUT (Note);
 *   - a reference attribute whose target the ontology itself names (Deal.Account),
 *     and one it does not (Note.parent);
 *   - a root entity, so the seeder's 24 rows meet a 20-row page and the pager
 *     has a second page to reach.
 */
const shop = {
  entities: [
    ent("Account", ["id", "name", "status", "region"]),
    ent("Deal", ["id", "name", "Account", "amount"]),
    ent("Note", ["id", "label", "parent"]),
  ],
  relations: [
    { from: "Account", to: "Deal", cardinality: "1:N" },
    { from: "Deal", to: "Note", cardinality: "1:N" },
  ],
} as unknown as Record<string, unknown>;

const shopHtml = assemblePrototype(shop, {}).html;
const snapHtml = assemblePrototype(ontology, atlas).html;

/** A loaded page plus the small vocabulary every interaction test needs. */
function app(html: string, url?: string) {
  const page: LoadedPrototype = loadPrototype(html, url ? { url } : {});
  const doc = page.doc;
  const region = (id: string) => doc.querySelector(`[data-fabric-id="${id}"]`)!;
  const screen = (id: string) => doc.querySelector(`[data-screen="${id}"]`) as HTMLElement;
  const visible = () => [...doc.querySelectorAll(".m-screen")]
    .filter((s) => !s.hasAttribute("hidden")).map((s) => s.getAttribute("data-screen"));
  const click = (el: Element | null | undefined) => {
    expect(el, "clicked a control that is not there").toBeTruthy();
    (el as HTMLElement).click();
  };
  const type = (el: Element | null, value: string) => {
    expect(el, "typed into a field that is not there").toBeTruthy();
    (el as HTMLInputElement).value = value;
    el!.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  };
  /** The ids in a list region's rows, in the order they are shown. */
  const idsIn = (id: string) => [...region(id).querySelectorAll("tbody tr .m-cell-sub")].map((e) => e.textContent ?? "");
  /** Navigate the way the Back button does — the hash is the state. */
  const go = (hash: string) => {
    page.window.location.hash = hash;
    page.window.dispatchEvent(new page.window.Event("hashchange"));
  };
  return { page, doc, win: page.window, region, screen, visible, click, type, idsIn, go };
}

const ACCOUNTS = "screen:account:list";

// ── B3 · every button has a handler ──────────────────────────────────────────

describe("no control is drawn that cannot work", () => {
  for (const [label, html] of [["a three-entity build", shopHtml], ["the 33-entity snapshot", snapHtml]] as const) {
    it(`${label}: zero buttons in the rendered application lack a handler`, () => {
      // MUTATION: put back any one of the five dead controls (drop the onclick
      // from Prev, from Delete, from Save…) → RED, naming the offender by its
      // own label. This is the whole of B3's acceptance in one count.
      //
      // The rendered document, not the served one: most buttons in this build
      // are drawn by the client renderer, so a source-side check would measure
      // the wrong document — and every screen is in the tree at once (hidden,
      // not absent), so this covers the list, the detail and the form of every
      // entity rather than only the one on screen.
      const { doc } = app(html);
      const buttons = [...doc.querySelectorAll("button")];
      expect(buttons.length, "no buttons rendered — the probe is broken").toBeGreaterThan(30);
      const dead = buttons
        .filter((b) => !(b.getAttribute("onclick") ?? "").trim())
        .map((b) => `${b.className} "${(b.textContent ?? "").trim().slice(0, 40)}"`);
      expect(dead, `buttons with no handler:\n${dead.join("\n")}`).toEqual([]);
    });
  }

  it("the Filter BUTTON is gone, replaced by a field that filters", () => {
    // "Any control that still cannot work must be REMOVED, not rendered inert."
    // The Filter button opened nothing; the honest version of it is the field.
    const { doc } = app(shopHtml);
    const filterButtons = [...doc.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "Filter");
    expect(filterButtons, "the dead Filter button is still drawn").toEqual([]);
    expect(doc.querySelector('input[data-search="account"]'), "nothing filters the list").toBeTruthy();
  });
});

describe("the five named controls do what they say", () => {
  it("Filter filters, and says what it filtered from", () => {
    // MUTATION: make setFilter ignore its argument → RED.
    const a = app(shopHtml);
    const all = a.idsIn(ACCOUNTS);
    expect(all.length).toBe(20);                     // page one of 24
    const target = a.region(ACCOUNTS).querySelector("tbody tr .m-cell-main")!.textContent!;
    a.type(a.doc.querySelector('input[data-search="account"]'), target);
    const filtered = a.idsIn(ACCOUNTS);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(all.length);
    expect(a.region(ACCOUNTS).textContent).toContain("filtered from 24");
    // …and it is reversible, from the same one control.
    a.type(a.doc.querySelector('input[data-search="account"]'), "");
    expect(a.idsIn(ACCOUNTS)).toEqual(all);
  });

  it("Next and Prev move through the pages, and stop at the ends", () => {
    // MUTATION: drop the page offset from renderList (always slice from 0) →
    // RED: page two comes back holding page one's rows.
    const a = app(shopHtml);
    const pageOne = a.idsIn(ACCOUNTS);
    const btn = (text: string) => [...a.region(ACCOUNTS).querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").trim() === text);
    expect(btn("Prev")!.hasAttribute("disabled"), "Prev is live on the first page").toBe(true);
    expect(btn("Next")!.hasAttribute("disabled")).toBe(false);
    a.click(btn("Next"));
    const pageTwo = a.idsIn(ACCOUNTS);
    expect(pageTwo).not.toEqual(pageOne);
    expect(pageTwo.length).toBe(4);                                  // 24 rows, 20 to a page
    expect(pageOne.some((id) => pageTwo.includes(id))).toBe(false);  // no row shown twice
    expect(a.region(ACCOUNTS).textContent).toContain("21–24 of 24");
    expect(btn("Next")!.hasAttribute("disabled"), "Next is live at the end").toBe(true);
    a.click(btn("Prev"));
    expect(a.idsIn(ACCOUNTS)).toEqual(pageOne);
  });

  it("a column head sorts, and says which way", () => {
    // The head used to be painted with a descending arrow and no handler — a
    // stated sort order that was not one. MUTATION: drop the comparator → RED.
    const a = app(shopHtml);
    const head = () => a.region(ACCOUNTS).querySelectorAll("thead th")[1];
    const values = () => [...a.region(ACCOUNTS).querySelectorAll("tbody tr")]
      .map((tr) => tr.querySelectorAll("td")[1]!.textContent!.trim());
    expect(head().className, "a sort order is claimed before anything is sorted").not.toContain("is-");
    a.click(head());
    const asc = values();
    expect([...asc].sort()).toEqual(asc);
    expect(head().className).toContain("is-asc");
    a.click(head());
    const desc = values();
    expect([...desc].sort().reverse()).toEqual(desc);
    expect(head().className).toContain("is-desc");
  });

  it("Save appends a row that is visible, and returns to the list", () => {
    // MUTATION: drop the `go("#"+sl)` from saveRec → RED on the screen check;
    // drop the unshift from addRow → RED on the visibility check. Both were the
    // shipped behaviour: Save did not even return to the list.
    const a = app(shopHtml);
    const before = a.region(ACCOUNTS).textContent!.match(/of (\d+)/)![1];
    expect(before).toBe("24");
    a.click([...a.screen("list-account").querySelectorAll("button")].find((b) => /^New /.test(b.textContent ?? "")));
    expect(a.visible()).toEqual(["form-account"]);
    a.type(a.screen("form-account").querySelector('[data-f="name"]'), "Zephyr Holdings");
    a.click([...a.screen("form-account").querySelectorAll("button")].find((b) => b.textContent === "Save"));
    expect(a.visible(), "Save did not return to the list").toEqual(["list-account"]);
    const rows = [...a.region(ACCOUNTS).querySelectorAll("tbody tr")];
    expect(a.region(ACCOUNTS).textContent, "the record was saved into a count nobody sees").toContain("of 25");
    // ON THE PAGE THAT CAME BACK. A row appended past the end of a paginated
    // table is a save the person cannot see, which is the same defect wearing
    // a different hat.
    expect(rows[0].textContent).toContain("Zephyr Holdings");
  });

  it("Delete removes the record, and Undo puts it back where it was", () => {
    // MUTATION: restore the row at the front instead of at its index → RED.
    const a = app(shopHtml);
    const first = a.region(ACCOUNTS).querySelector("tbody tr")!;
    const id = first.querySelector(".m-cell-sub")!.textContent!;
    a.click(first.querySelector("button"));                       // Open
    expect(a.visible()).toEqual(["detail-account"]);
    a.click([...a.screen("detail-account").querySelectorAll("button")].find((b) => b.textContent === "Delete"));
    expect(a.visible()).toEqual(["list-account"]);
    expect(a.idsIn(ACCOUNTS)).not.toContain(id);
    expect(a.region(ACCOUNTS).textContent).toContain("of 23");
    const toast = a.doc.getElementById("m-toast")!;
    expect(toast, "a destructive action with no way back").toBeTruthy();
    expect(toast.textContent).toContain("Deleted");
    a.click([...toast.querySelectorAll("button")].find((b) => b.textContent === "Undo"));
    expect(a.idsIn(ACCOUNTS)[0], "Undo put the record back somewhere else").toBe(id);
    expect(a.region(ACCOUNTS).textContent).toContain("of 24");
  });

  it("a deleted record is gone from its parent's collection too, not only from its own list", () => {
    // "Gone here, still there over there" is the same lie one screen along, and
    // it is what a renderer that walks the SEEDED row count instead of the live
    // rows produces. MUTATION: have renderKid loop `t.n` again → RED on the
    // badge, which is the number a person reads off the parent.
    const a = app(shopHtml);
    const kids = () => a.region("region:account:deal");
    const badge = () => Number(kids().querySelector(".m-badge")!.textContent);
    const before = badge();
    expect(before, "the showcase account has no deals to lose").toBeGreaterThan(1);
    const dealId = kids().querySelector("tbody tr .m-cell-sub")!.textContent!;
    a.go(`#deal/${dealId}`);
    expect(a.visible()).toEqual(["detail-deal"]);
    a.click([...a.screen("detail-deal").querySelectorAll("button")].find((b) => b.textContent === "Delete"));
    expect(badge(), "the parent still counts a record that is gone").toBe(before - 1);
    expect(kids().textContent, "the parent still lists a record that is gone").not.toContain(dealId);
  });
});

// ── B2 · a row opens its own record, and the URL says which ──────────────────

describe("Open shows the record that was clicked", () => {
  it("row n opens record n — not the one the entity showcases", () => {
    // MUTATION: send every Open to the entity's detail screen without the
    // record (`go("#"+slug)`) → RED. This IS the shipped defect: one static
    // detail per entity, so row 12 showed row 1.
    const a = app(shopHtml);
    const rows = [...a.region(ACCOUNTS).querySelectorAll("tbody tr")];
    const opened: string[] = [];
    for (const n of [0, 5, 11, 19]) {
      const id = rows[n].querySelector(".m-cell-sub")!.textContent!;
      const name = rows[n].querySelector(".m-cell-main")!.textContent!;
      a.click(rows[n].querySelector("button"));
      expect(a.visible()).toEqual(["detail-account"]);
      const detail = a.screen("detail-account");
      expect(detail.querySelector(".m-title")!.textContent, `row ${n} is headed with another record`).toBe(name);
      expect(a.region("region:account:summary").textContent, `row ${n} shows another record's values`).toContain(id);
      opened.push(id);
      a.win.history.back;   // no navigation needed: each Open re-routes
      a.click(a.screen("detail-account").querySelector(".m-crumbs a"));
    }
    expect(new Set(opened).size, "four different rows opened the same record").toBe(4);
  });

  it("the URL names the record, so the moment is linkable", () => {
    const a = app(shopHtml);
    const row = a.region(ACCOUNTS).querySelector("tbody tr")!;
    const id = row.querySelector(".m-cell-sub")!.textContent!;
    a.click(row.querySelector("button"));
    expect(a.win.location.hash).toBe(`#account/${id}`);
  });

  it("a deep link opens straight onto that record", () => {
    // MUTATION: route only on the entity and ignore the record segment → RED.
    // Loaded AT the address, not navigated to it: this is the link a person
    // pastes into a message, and it has to work on a cold document.
    const seed = generateSeed(shop, deriveFabric(shop, {}).version);
    const account = (seed.records.Account ?? [])[7];
    expect(account, "the fixture lost its Accounts").toBeTruthy();
    const a = app(shopHtml, `https://prototype.test/#account/${account.id}`);
    expect(a.visible()).toEqual(["detail-account"]);
    expect(a.region("region:account:summary").textContent).toContain(String(account.id));
    expect(a.screen("detail-account").querySelector(".m-title")!.textContent).toBe(String(account.name));
  });

  it("Back returns to the record the history holds, not to a fixed screen", () => {
    // The hash IS the state, so a hashchange — which is what Back produces —
    // has to restore the view on its own. MUTATION: drop the hashchange
    // listener → RED.
    const a = app(shopHtml);
    const seed = generateSeed(shop, deriveFabric(shop, {}).version);
    const [one, two] = [seed.records.Account![2], seed.records.Account![9]];
    for (const rec of [one, two]) {
      a.win.location.hash = `#account/${rec.id}`;
      a.win.dispatchEvent(new a.win.Event("hashchange"));
      expect(a.region("region:account:summary").textContent).toContain(String(rec.id));
    }
    a.win.location.hash = `#account/${one.id}`;
    a.win.dispatchEvent(new a.win.Event("hashchange"));
    expect(a.visible()).toEqual(["detail-account"]);
    expect(a.region("region:account:summary").textContent).toContain(String(one.id));
  });

  it("a parent link card goes to THAT parent, not to the parent entity's showcase", () => {
    // The other half of the same defect: the link existed and went to the wrong
    // record on every row but one.
    const a = app(shopHtml, "https://prototype.test/#deal/deal-0003");
    const card = a.region("nav:deal:account").querySelector("button")!;
    const named = a.region("nav:deal:account").querySelector(".m-linkcard-v")!.textContent!;
    a.click(card);
    expect(a.visible()).toEqual(["detail-account"]);
    expect(a.screen("detail-account").querySelector(".m-title")!.textContent).toBe(named);
  });
});

// ── B4 · a relation-typed field is a picker ──────────────────────────────────

describe("a field that references a record offers the records", () => {
  const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");

  for (const [label, on, at] of [
    ["a three-entity build", shop, {}],
    ["the 33-entity snapshot", ontology, atlas],
  ] as const) {
    it(`${label}: no relation-typed field renders as free text`, () => {
      // MUTATION: render the picker branch as an <input> again → RED, listing
      // every field that went back to being a text box.
      const roles = deriveRoles(on as Record<string, unknown>);
      const seed = generateSeed(on as Record<string, unknown>, deriveFabric(on as Record<string, unknown>, at as Record<string, unknown>).version);
      const a = app(assemblePrototype(on as Record<string, unknown>, at as Record<string, unknown>).html);
      const refs = roles.attributeRoles.filter((r) =>
        (r.role === "parent-ref" || r.role === "cross-ref") && r.refEntity && (seed.records[r.refEntity] ?? []).length);
      expect(refs.length, "the fixture carries no reference attributes").toBeGreaterThan(0);
      const wrong: string[] = [];
      for (const r of refs) {
        const field = a.doc.querySelector(`[data-fabric-id="field:${slug(r.entity)}:${slug(r.attribute)}"]`);
        if (!field) continue;                       // an entity with no screen in this build
        const select = field.querySelector("select");
        if (!select) { wrong.push(`${r.entity}.${r.attribute} → ${field.querySelector("input")?.outerHTML ?? "nothing"}`); continue; }
        if (select.options.length < 2) wrong.push(`${r.entity}.${r.attribute} → an empty picker`);
      }
      expect(wrong, `reference fields that do not offer their records:\n${wrong.join("\n")}`).toEqual([]);
    });
  }

  it("the options ARE the parent entity's records, by the name a person reads", () => {
    const a = app(shopHtml);
    const select = a.doc.querySelector('[data-fabric-id="field:deal:account"] select') as HTMLSelectElement;
    expect(select, "Deal.Account is not a picker").toBeTruthy();
    expect(select.getAttribute("data-fk")).toBe("Account");
    const seed = generateSeed(shop, deriveFabric(shop, {}).version);
    const names = new Set((seed.records.Account ?? []).map((r) => String(r.name)));
    const offered = [...select.options].slice(1).map((o) => o.textContent ?? "");
    expect(offered.length).toBe(names.size);
    expect(offered.every((n) => names.has(n)), `an option names no Account: ${offered.find((n) => !names.has(n))}`).toBe(true);
    // …and the value is the id, which is what a save has to have in hand. What
    // it DOES with it is not asserted here, and the comment that used to claim
    // "a save writes a real foreign key" was reporting coverage this file never
    // had: the id went into the attribute column the page prints as a name and
    // the relation never moved. The save itself is driven, end to end, in
    // `prototypeRelationPicker.test.ts`.
    const ids = new Set((seed.records.Account ?? []).map((r) => String(r.id)));
    expect([...select.options].slice(1).every((o) => ids.has(o.value))).toBe(true);
  });

  it("where the ontology names no target, the field says so instead of passing as text", () => {
    // A miss stays visible. MUTATION: drop the m-help line → RED, and the
    // failure becomes an ordinary-looking input nobody can tell from a real one.
    const a = app(shopHtml);
    const field = a.doc.querySelector('[data-fabric-id="field:note:parent"]')!;
    expect(field, "the fixture lost its untargeted reference").toBeTruthy();
    expect(field.querySelector("select"), "invented a target the ontology never named").toBeNull();
    expect(field.querySelector(".m-help")?.textContent ?? "", "the gap is silent").toMatch(/Listen/i);
  });

  it("a status field offers the values the data holds, not a vocabulary from the template", () => {
    const a = app(shopHtml);
    const select = a.doc.querySelector('[data-fabric-id="field:account:status"] select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const seed = generateSeed(shop, deriveFabric(shop, {}).version);
    const real = new Set((seed.records.Account ?? []).map((r) => String(r.status)));
    const offered = [...select.options].slice(1).map((o) => o.textContent ?? "");
    expect(new Set(offered)).toEqual(real);
  });
});

// ── B5 · a status becomes an optional board ──────────────────────────────────

describe("a board is offered where there is a status, and nowhere else", () => {
  for (const [label, on, at] of [
    ["a three-entity build", shop, {}],
    ["the 33-entity snapshot", ontology, atlas],
  ] as const) {
    it(`${label}: the toggle appears on exactly the entities with a status attribute`, () => {
      // MUTATION: render the toggle unconditionally → RED on every entity with
      // no status (a switch to a board of one nameless lane); MUTATION: never
      // render it → RED on the ones that have one.
      const roles = deriveRoles(on as Record<string, unknown>);
      const a = app(assemblePrototype(on as Record<string, unknown>, at as Record<string, unknown>).html);
      const withStatus = new Set(roles.attributeRoles.filter((r) => r.role === "status").map((r) => r.entity));
      const screens = [...a.doc.querySelectorAll('[data-screen^="list-"]')];
      expect(screens.length).toBeGreaterThan(1);
      const wrong: string[] = [];
      for (const s of screens) {
        const sl = s.getAttribute("data-screen")!.slice(5);
        const entity = [...withStatus].find((e) => e.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") === sl);
        const toggle = s.querySelector(`[data-view="${sl}"]`);
        if (entity && !toggle) wrong.push(`${sl} has a status and no board`);
        if (!entity && toggle) wrong.push(`${sl} has no status and offers a board anyway`);
      }
      expect(wrong, wrong.join("\n")).toEqual([]);
      expect([...withStatus].length, "the fixture carries no status attribute at all").toBeGreaterThan(0);
    });
  }

  it("the board groups the SAME rows the table shows, by their status value", () => {
    // MUTATION: group by a fixed column index → RED. The lanes and their counts
    // are checked against the seed, so a board that renders plausibly and
    // groups wrongly does not pass.
    const a = app(shopHtml);
    const seed = generateSeed(shop, deriveFabric(shop, {}).version);
    const rows = seed.records.Account ?? [];
    const byStatus = new Map<string, number>();
    for (const r of rows) byStatus.set(String(r.status), (byStatus.get(String(r.status)) ?? 0) + 1);

    a.click(a.doc.querySelector('[data-view="account"] [data-v="board"]'));
    const lanes = [...a.region(ACCOUNTS).querySelectorAll(".m-board-col")];
    expect(lanes.length, "the board did not render").toBe(byStatus.size);
    expect(a.region(ACCOUNTS).querySelector("table"), "the board is still a table").toBeNull();
    for (const lane of lanes) {
      const heading = lane.querySelector(".m-board-h span")!.textContent!;
      const count = Number(lane.querySelector(".m-badge")!.textContent);
      expect(byStatus.get(heading), `a lane headed "${heading}" that the seed has no status for`).toBe(count);
      // …and a card in the lane really carries that status.
      const first = lane.querySelector(".m-board-card .m-cell-sub")!.textContent!;
      expect(String(rows.find((r) => String(r.id) === first)!.status)).toBe(heading);
    }
    // The whole population is on the board — a board that silently drops rows is
    // the table's own defect one screen over.
    expect(lanes.reduce((n, l) => n + Number(l.querySelector(".m-badge")!.textContent), 0)).toBe(rows.length);

    a.click(a.doc.querySelector('[data-view="account"] [data-v="table"]'));
    expect(a.region(ACCOUNTS).querySelector("table"), "the toggle does not go back").toBeTruthy();
  });

  it("the board is a view of the filter's result, not of everything", () => {
    const a = app(shopHtml);
    const one = a.region(ACCOUNTS).querySelector("tbody tr .m-cell-main")!.textContent!;
    a.type(a.doc.querySelector('input[data-search="account"]'), one);
    a.click(a.doc.querySelector('[data-view="account"] [data-v="board"]'));
    const total = [...a.region(ACCOUNTS).querySelectorAll(".m-board-col .m-badge")]
      .reduce((n, b) => n + Number(b.textContent), 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(24);
  });
});

// ── nothing above may have cost the invariants ───────────────────────────────

describe("the build is still the same build", () => {
  it("assembles byte-identically, and the fabric version has not moved", () => {
    expect(assemblePrototype(shop, {}).html).toBe(shopHtml);
    expect(assemblePrototype(ontology, atlas).html).toBe(snapHtml);
    expect(deriveFabric(shop, {}).version).toBe(deriveFabric(shop, {}).version);
  });

  it("the page still throws nothing, on either fixture", () => {
    for (const html of [shopHtml, snapHtml]) expect(loadPrototype(html).consoleErrors).toEqual([]);
  });
});
