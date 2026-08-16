/**
 * A RELATION PICKER SAVES THE RELATION.
 *
 * B4 made a field whose role is `parent-ref` / `cross-ref` render as a `<select>`
 * of the parent's records, with the parent's ID as each option's value. Saving
 * then wrote that id into the ATTRIBUTE column — the one the detail page prints
 * as a name and the list heads as one — and nowhere else, while the parent link
 * card (`NavSpec.fk`) and the parent's child collection (`KidSpec.fk`) both
 * resolve the relation through the JOIN KEY (`joinKeyFor`, the one definition).
 * One save therefore left a single record stating its parent three ways at
 * once: a raw `account-0001` where a name belongs, a link card still pointing at
 * the account the user had just replaced, and a parent whose collection never
 * moved. It was a Save that did not save the relation.
 *
 * The claim under test is a ROUND TRIP, because either half alone passes while
 * the application still contradicts itself:
 *
 *   1. the detail shows the chosen parent's NAME, in the column that is a name;
 *   2. the link card names that parent AND opens that parent's record;
 *   3. the chosen parent's own collection now CONTAINS the record;
 *   4. and the parent it was taken from no longer does.
 *
 * Everything below drives the rendered document — the page's own script, real
 * clicks on the real Save — because the served markup ships no rows at all and a
 * regex over the assembler's source has twice reported the opposite of the truth
 * in this exact area.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype, humanizeField } from "@shared/prototypeAssembly.ts";
import { joinKeyFor } from "@shared/ontologyGraph.ts";
import { loadPrototype, type LoadedPrototype } from "./helpers/renderPrototype";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8")) as Record<string, unknown>;
const ontology = snap("domain-ontology.json");
const atlas = snap("current-state-atlas.json");
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");

const ent = (name: string, attributes: string[]) => ({ name, attributes, definition: name });

/** Account owns Deals; `Deal.Account` is the reference attribute the ontology
 *  itself names, so the build has both a picker and a join key (`accountId`)
 *  for the same relation — which is exactly where the two came apart. */
const shop = {
  entities: [
    ent("Account", ["id", "name", "status", "region"]),
    ent("Deal", ["id", "name", "Account", "amount"]),
  ],
  relations: [{ from: "Account", to: "Deal", cardinality: "1:N" }],
} as unknown as Record<string, unknown>;

/** The page, plus the vocabulary a save needs. */
function app(html: string, url?: string) {
  const page: LoadedPrototype = loadPrototype(html, url ? { url } : {});
  const doc = page.doc;
  const region = (id: string) => {
    const el = doc.querySelector(`[data-fabric-id="${id}"]`);
    expect(el, `no region ${id}`).toBeTruthy();
    return el!;
  };
  const go = (hash: string) => {
    page.window.location.hash = hash;
    page.window.dispatchEvent(new page.window.Event("hashchange"));
  };
  const picker = (fieldId: string) => {
    const sel = doc.querySelector(`[data-fabric-id="${fieldId}"] select`) as HTMLSelectElement | null;
    expect(sel, `no picker at ${fieldId}`).toBeTruthy();
    return sel!;
  };
  const save = (entitySlug: string) => {
    const btn = [...doc.querySelectorAll(`[data-form="${entitySlug}"] button`)]
      .find((b) => (b.getAttribute("onclick") ?? "").includes("saveRec"));
    expect(btn, `no Save on the ${entitySlug} form`).toBeTruthy();
    (btn as HTMLElement).click();
  };
  /** What the detail page PRINTS for one attribute — the `<dd>` beside its own
   *  `<dt>`, so the assertion is about the field that carries the reference and
   *  not about the page containing the string somewhere. */
  const shown = (summaryId: string, attribute: string) => {
    const label = humanizeField(attribute);
    const row = [...region(summaryId).querySelectorAll("dt")].find((dt) => (dt.textContent ?? "").trim() === label);
    expect(row, `the summary prints no ${label}`).toBeTruthy();
    return (row!.nextElementSibling?.textContent ?? "").trim();
  };
  /** The record ids in a collection region's rows. */
  const idsIn = (id: string) => [...region(id).querySelectorAll("tbody tr .m-cell-sub")].map((e) => (e.textContent ?? "").trim());
  const title = (screen: string) => (doc.querySelector(`[data-screen="${screen}"] .m-title`)?.textContent ?? "").trim();
  return { page, doc, go, region, picker, save, shown, idsIn, title };
}

// ── the round trip, on a build small enough to read ──────────────────────────

describe("picking a parent and saving re-parents the record", () => {
  const html = assemblePrototype(shop, {}).html;

  it("the detail names the parent, the link card opens it, and the parent's collection holds the record", () => {
    // MUTATION: drop `if(fc)vals[fc]=…` from saveRec (write only the attribute
    // column, as before) → RED on all three halves at once: the summary prints
    // an id, the link card still names the old account, and the new account's
    // Deal collection does not contain the deal.
    const a = app(html, "https://prototype.test/#deal/DEA-00001");
    const before = a.shown("region:deal:summary", "Account");
    const oldCard = (a.region("nav:deal:account").querySelector(".m-linkcard-v")?.textContent ?? "").trim();
    expect(oldCard, "the record starts with no parent — the probe proves nothing").toBe(before);

    a.go("#deal/DEA-00001/edit");
    const sel = a.picker("field:deal:account");
    const chosen = [...sel.options].find((o) => o.value && o.value !== sel.value)!;
    expect(chosen, "the picker offers no second account").toBeTruthy();
    const chosenId = chosen.value, chosenName = (chosen.textContent ?? "").trim();
    expect(chosenName).not.toBe(chosenId);          // a name is not an id; otherwise 1 below is vacuous
    sel.value = chosenId;
    a.save("deal");

    a.go("#deal/DEA-00001");
    // 1 · the column the page prints as a NAME holds the name.
    expect(a.shown("region:deal:summary", "Account")).toBe(chosenName);
    // 2 · the link card names that parent, and goes to that parent's record.
    expect((a.region("nav:deal:account").querySelector(".m-linkcard-v")?.textContent ?? "").trim()).toBe(chosenName);
    (a.region("nav:deal:account").querySelector("button") as HTMLElement).click();
    expect(a.title("detail-account")).toBe(chosenName);
    // 3 · the chosen parent's collection contains the record…
    expect(a.idsIn("region:account:deal")).toContain("DEA-00001");
    // 4 · …and the parent it was taken from does not.
    const from = [...sel.options].find((o) => (o.textContent ?? "").trim() === before)!;
    expect(from, "the deal's original account is not among the options").toBeTruthy();
    a.go(`#account/${from.value}`);
    expect(a.idsIn("region:account:deal")).not.toContain("DEA-00001");
  });

  it("a NEW record saved with a parent lands in that parent's collection", () => {
    // The other entry point into the same save. MUTATION: as above → RED.
    const a = app(html, "https://prototype.test/#deal/new");
    const sel = a.picker("field:deal:account");
    const chosen = [...sel.options].find((o) => o.value)!;
    const chosenName = (chosen.textContent ?? "").trim();
    sel.value = chosen.value;
    a.save("deal");
    a.go("#deal/deal-new-1");
    expect(a.shown("region:deal:summary", "Account")).toBe(chosenName);
    expect((a.region("nav:deal:account").querySelector(".m-linkcard-v")?.textContent ?? "").trim()).toBe(chosenName);
    a.go(`#account/${chosen.value}`);
    expect(a.idsIn("region:account:deal")).toContain("deal-new-1");
  });

  it("opening a record for edit shows the parent it already has", () => {
    // MUTATION: read the picker's value from the display column again (drop the
    // `data-fk` branch in renderForm) → RED: the select falls to "— none —" over
    // a record that has a parent, and saving from that form drops the relation.
    const a = app(html, "https://prototype.test/#deal/DEA-00001");
    const named = (a.region("nav:deal:account").querySelector(".m-linkcard-v")?.textContent ?? "").trim();
    a.go("#deal/DEA-00001/edit");
    const sel = a.picker("field:deal:account");
    expect(sel.value, "the form opened with no parent selected").toBeTruthy();
    expect(([...sel.options].find((o) => o.value === sel.value)?.textContent ?? "").trim()).toBe(named);
  });

  it("clearing the picker clears both halves — the name and the link", () => {
    // MUTATION: write the id but leave the display column alone → RED here,
    // because the summary would keep naming an account the record no longer
    // belongs to.
    const a = app(html, "https://prototype.test/#deal/DEA-00001/edit");
    const sel = a.picker("field:deal:account");
    sel.value = "";
    a.save("deal");
    a.go("#deal/DEA-00001");
    expect(a.shown("region:deal:summary", "Account")).toBe("—");
    expect((a.region("nav:deal:account").querySelector(".m-linkcard-v")?.textContent ?? "")).toMatch(/none named/);
  });
});

// ── the same trip, on every picker of the 33-entity build ───────────────────

describe("the snapshot build: every picker that owns a join key round-trips", () => {
  const a = app(assemblePrototype(ontology, atlas).html);
  /** The columns each entity's rows actually carry, read from the island the
   *  page ships — the same table the renderer indexes. */
  const island = JSON.parse(a.doc.getElementById("m-seed")!.textContent ?? "{}") as { data: Record<string, { cols: string[] }> };
  /** Slug back to the entity NAME the island is keyed by — the form carries the
   *  slug, the data carries the name, and the columns are the data's. */
  const nameOfSlug = new Map(Object.keys(island.data).map((n) => [slug(n), n] as const));
  const cols = (entitySlug: string) => island.data[nameOfSlug.get(entitySlug) ?? ""]?.cols ?? [];

  /** Every picker on the build, with the regions that READ its relation. Built
   *  from the rendered document, so a picker the build stops emitting shrinks
   *  the list rather than passing. */
  const pickers = [...a.doc.querySelectorAll("select[data-fk]")].map((sel) => {
    const entitySlug = sel.closest("[data-form]")!.getAttribute("data-form")!;
    const parent = sel.getAttribute("data-fk")!;
    const field = sel.closest("[data-fabric-id]")!.getAttribute("data-fabric-id")!;
    return {
      entitySlug, parent, parentSlug: slug(parent), field,
      attribute: sel.getAttribute("data-f")!,
      owns: sel.getAttribute("data-fkc"),
      nav: `nav:${entitySlug}:${slug(parent)}`,
      collection: `region:${slug(parent)}:${entitySlug}`,
    };
  });

  it("the key a picker writes is the key the fabric mints, and exactly one field writes it", () => {
    // The completeness half, over every picker in the build: a picker that
    // should own a key and does not is the original defect back again, and one
    // that owns a key nobody reads writes into nothing.
    //
    // MUTATION: emit `data-fkc` on every picker → RED on the one-writer count.
    // (Every parent entity in this ontology is single-word, so the key's
    // DERIVATION is put under mutation on the multi-word fixture below, where
    // the convention and `joinKeyFor` disagree.)
    expect(pickers.filter((p) => p.owns).length).toBeGreaterThan(20);
    const wrong: string[] = [];
    // Counted per (entity, key): a key its rows carry must have exactly ONE
    // writer, and a key they do not carry must have none — a picker claiming a
    // column that is not there writes into nothing.
    const writers = new Map<string, number>();
    for (const p of pickers) {
      const key = joinKeyFor(p.parent);
      if (p.owns && p.owns !== key) wrong.push(`${p.field} writes ${p.owns}, the relation's key is ${key}`);
      if (!cols(p.entitySlug).includes(key)) {
        if (p.owns) wrong.push(`${p.field} claims ${p.owns}, a column ${p.entitySlug} has not got`);
        continue;
      }
      writers.set(`${p.entitySlug}|${key}`, (writers.get(`${p.entitySlug}|${key}`) ?? 0) + (p.owns ? 1 : 0));
    }
    expect(writers.size).toBeGreaterThan(20);
    for (const [k, n] of writers) if (n !== 1) wrong.push(`${k}: ${n} fields write one join key`);
    expect(wrong, `pickers that do not agree with the fabric's key:\n${wrong.join("\n")}`).toEqual([]);
  });

  /** One relation per DISTINCT join key — every key column the build has, and
   *  the widest coverage a round trip can buy: each save re-renders the whole
   *  33-entity application, so driving all 31 costs a minute of CI to re-prove
   *  the same code path against the same column index. */
  const candidates = pickers
    .filter((c) => c.owns && a.doc.querySelector(`[data-fabric-id="${c.collection}"]`))
    .filter((c, i, all) => all.findIndex((x) => x.parent === c.parent) === i);

  it("each distinct relation moves the record", () => {
    // MUTATION: drop the join-key write → RED naming every relation that did not
    // move. The same claim as the hand-built pair above, against real ontology
    // relations, so no rule below can have learned one build's shape.
    expect(candidates.length).toBeGreaterThan(3);
    const broken: string[] = [];
    for (const c of candidates) {
      // The FIRST row of the entity: lowest physical index, so it leads any
      // collection it joins and a five-row window cannot hide it.
      const first = [...a.doc.querySelectorAll(`[data-screen="list-${c.entitySlug}"] tbody tr .m-cell-sub`)][0];
      expect(first, `the ${c.entitySlug} list shows no rows`).toBeTruthy();
      const id = (first!.textContent ?? "").trim();
      a.go(`#${c.entitySlug}/${encodeURIComponent(id)}/edit`);
      const sel = a.picker(c.field);
      const chosen = [...sel.options].find((o) => o.value && o.value !== sel.value)!;
      expect(chosen, `${c.entitySlug}.${c.attribute} offers no second ${c.parent}`).toBeTruthy();
      const name = (chosen.textContent ?? "").trim();
      sel.value = chosen.value;
      a.save(c.entitySlug);

      a.go(`#${c.entitySlug}/${encodeURIComponent(id)}`);
      const printed = a.shown(`region:${c.entitySlug}:summary`, c.attribute);
      const card = (a.region(c.nav).querySelector(".m-linkcard-v")?.textContent ?? "").trim();
      a.go(`#${c.parentSlug}/${encodeURIComponent(chosen.value)}`);
      const held = a.idsIn(c.collection).includes(id);
      if (printed !== name) broken.push(`${c.entitySlug}.${c.attribute}: detail prints "${printed}", chose "${name}"`);
      if (card !== name) broken.push(`${c.entitySlug}.${c.attribute}: link card reads "${card}", chose "${name}"`);
      if (!held) broken.push(`${c.entitySlug}.${c.attribute}: ${c.parent} ${chosen.value} does not hold ${id}`);
    }
    expect(broken, `pickers whose save did not save the relation:\n${broken.join("\n")}`).toEqual([]);
  });
});

// ── one join key, one field that writes it ──────────────────────────────────

/**
 * An ontology may name two attributes that both point at the same parent, and
 * there is only ONE join-key column per parent. If both pickers wrote it, the
 * record would contradict itself between its own two fields — the defect above
 * wearing a different hat — so exactly one owns the key, the other stores the
 * name it displays, and the form says which.
 *
 * The parent is deliberately MULTI-WORD. `joinKeyFor` derives the key from the
 * entity's name words (`masterAccountId`); the convention this codebase had to
 * be rescued from — `name.toLowerCase() + "Id"` — would produce a column with a
 * space in it, which is no identifier and matches nothing. A single-word parent
 * cannot tell the two apart.
 */
const twoRefs = {
  entities: [
    ent("Master Account", ["id", "name", "status"]),
    ent("Contract", ["id", "name", "Master Account", "masterAccountId", "value"]),
  ],
  relations: [{ from: "Master Account", to: "Contract", cardinality: "1:N" }],
} as unknown as Record<string, unknown>;

describe("two fields pointing at one parent", () => {
  const a = app(assemblePrototype(twoRefs, {}).html, "https://prototype.test/#contract/CON-00001/edit");
  const pickers = [...a.doc.querySelectorAll('[data-form="contract"] select[data-fk="Master Account"]')] as HTMLSelectElement[];

  it("both fields pick real records; exactly one of them writes the join key", () => {
    // MUTATION: drop the `fkOwner` map and give every picker a `data-fkc` → RED,
    // because two controls would then write one column. MUTATION: spell the key
    // `parent.toLowerCase()+"Id"` → RED, because no field would own one at all.
    expect(pickers.length).toBe(2);
    const owners = pickers.filter((p) => p.getAttribute("data-fkc") === joinKeyFor("Master Account"));
    expect(owners.length).toBe(1);
    // The attribute that IS the key column is the one that owns it.
    expect(owners[0].getAttribute("data-f")).toBe("masterAccountId");
    // The other still offers the records, and says why the link is not its own.
    const other = pickers.find((p) => !p.hasAttribute("data-fkc"))!;
    expect(other.options.length).toBeGreaterThan(1);
    expect(other.closest(".m-field")!.querySelector(".m-help")?.textContent ?? "").toMatch(/Confirm in Listen/);
  });

  it("the owner moves the record; the other stores the name it shows", () => {
    // MUTATION: write the display name into the key column too (drop the
    // "AFTER the name" ordering in saveRec) → RED: the collection would be
    // looked up by a name against a column of ids and lose the record.
    const owner = pickers.find((p) => p.hasAttribute("data-fkc"))!;
    const other = pickers.find((p) => !p.hasAttribute("data-fkc"))!;
    const to = [...owner.options].find((o) => o.value && o.value !== owner.value)!;
    const elsewhere = [...other.options].find((o) => o.value && o.value !== to.value)!;
    owner.value = to.value;
    other.value = elsewhere.value;
    a.save("contract");

    a.go("#contract/CON-00001");
    // The key field prints the id it stores; the name field prints a name.
    expect(a.shown("region:contract:summary", "masterAccountId")).toBe(to.value);
    expect(a.shown("region:contract:summary", "Master Account")).toBe((elsewhere.textContent ?? "").trim());
    // And the relation itself followed the owner.
    expect((a.region("nav:contract:master-account").querySelector(".m-linkcard-v")?.textContent ?? "").trim()).toBe((to.textContent ?? "").trim());
    a.go(`#master-account/${to.value}`);
    expect(a.idsIn("region:master-account:contract")).toContain("CON-00001");
  });

  it("a picker with no key of its own still re-opens on the record it stored", () => {
    // The name-only path, which is also the path of a reference the ontology
    // names without declaring a relation: there is no key column, so the stored
    // NAME is what the form has to reopen from.
    // MUTATION: drop the name-resolution loop in `pickerVal` (return "" when
    // there is no `data-fkc`) → RED, and every such field silently reads "—
    // none —" over a record that holds one.
    const b = app(assemblePrototype(twoRefs, {}).html, "https://prototype.test/#contract/CON-00002/edit");
    const other = [...b.doc.querySelectorAll('[data-form="contract"] select[data-fk="Master Account"]')]
      .find((p) => !p.hasAttribute("data-fkc")) as HTMLSelectElement;
    const chosen = [...other.options].find((o) => o.value && o.value !== other.value)!;
    const name = (chosen.textContent ?? "").trim();
    other.value = chosen.value;
    b.save("contract");
    b.go("#contract/CON-00002");
    expect(b.shown("region:contract:summary", "Master Account")).toBe(name);
    b.go("#contract/CON-00002/edit");
    const again = [...b.doc.querySelectorAll('[data-form="contract"] select[data-fk="Master Account"]')]
      .find((p) => !p.hasAttribute("data-fkc")) as HTMLSelectElement;
    expect(again.value).toBe(chosen.value);
  });
});
