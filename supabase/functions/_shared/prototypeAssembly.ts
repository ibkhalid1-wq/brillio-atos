/**
 * Prototype assembly (docs/aura — the four concerns joined):
 *   fabric = structure, semantic roles = bridge, Meridian = appearance,
 *   seed data = content.
 *
 * This module is the ONE place the four meet — the assembly layer, analogous to
 * the role→component map. It keeps the separation the specs require: it imports
 * the fabric (no tokens), Meridian (no ontology), and seed data (content) and
 * wires them; none of those three references another. Every rendered region is
 * tagged `data-fabric-id` with its fabric node id (stable, non-positional) so an
 * incremental delta can resolve to exactly the regions it touches.
 */
import { deriveFabric, type Fabric } from "./fabric.ts";
import { deriveRoles, type ValueRole } from "./semanticRoles.ts";
import { generateSeed, type SeedRecord } from "./seedData.ts";
import { meridianStylesheet } from "./prototypeDesignSystem.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const slug = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
const money = (n: unknown) => (typeof n === "number" ? `$${n.toLocaleString("en-US")}` : esc(n));

/**
 * An ontology attribute as a human-readable label — the ONE definition, used
 * by every place a field name is shown to a person (column heads, detail
 * terms, form labels).
 *
 * The ontology stores field names the way a schema does (`buyingRole`,
 * `close_date`), and the design system upper-cases table heads, so rendering
 * the raw key printed `BUYINGROLE` at the top of a client-facing demo — a
 * database column showing through the product. Splitting camelCase and
 * snake_case first gives `Buying Role`, which upper-cases legibly and reads
 * correctly everywhere else.
 */
export function humanizeField(name: unknown): string {
  const raw = String(name ?? "").trim();
  if (!raw) return "";
  const words = raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")     // camelCase → camel Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")  // ACRONYMWord → ACRONYM Word
    .replace(/\s+/g, " ")
    .trim();
  // A single schema-shaped token becomes a proper label ("close_date" → "Close
  // Date"); anything the ontology already wrote as a phrase is left as its
  // author wrote it, so "Number of employees" doesn't become "Number Of
  // Employees". Existing capitals are never lowered — acronyms survive.
  return /\s/.test(raw)
    ? words.replace(/^./, (c) => c.toUpperCase())
    : words.replace(/(^|\s)(\S)/g, (_m, lead: string, c: string) => `${lead}${c.toUpperCase()}`);
}

/** Render one value by its semantic role — the role→component map, applied. */
function renderCell(role: ValueRole | undefined, value: unknown): string {
  if (value == null || value === "") return `<span class="m-cell-sub">—</span>`;
  switch (role) {
    case "monetary": return `<span style="font-variant-numeric:tabular-nums">${money(value)}</span>`;
    case "quantity": return `<span style="font-variant-numeric:tabular-nums">${esc(value)}</span>`;
    // A percent shows its unit — the number alone is what let 145 pass for a share.
    case "percent": return `<span style="font-variant-numeric:tabular-nums">${esc(value)}%</span>`;
    case "status": case "category": return `<span class="m-badge">${esc(value)}</span>`;
    case "health": case "priority": return `<span class="m-pill m-pill--warn"><span class="m-dot m-dot--warn"></span>${esc(value)}</span>`;
    case "boolean": return value ? `<span class="m-dot m-dot--good"></span> Yes` : `<span class="m-dot"></span> No`;
    case "parent-ref": case "cross-ref": case "person-ref": return `<span class="m-chip">${esc(value)}</span>`;
    default: return esc(value);
  }
}

export interface AssembledPrototype { html: string; fabric: Fabric; regionCount: number; }

/**
 * THE OPERATOR'S NAVIGATION, when they have chosen one.
 *
 * `navOrder` is DERIVED — it ranks entities by how central the graph says they are,
 * which is a decent guess and is nobody's decision. Experience Design now asks the
 * operator directly: which entities get a parent screen? When they have answered,
 * that answer IS the menu, in their order. When they have not, the derived order
 * stands exactly as before, so a programme nobody has curated still assembles.
 *
 * Only entities the ontology actually holds survive — a stale name left over from a
 * regenerated ontology must not mint a menu item pointing at nothing.
 */
export function navigationFor(
  chosen: readonly string[] | undefined,
  derived: readonly string[],
  known: readonly string[],
): string[] {
  const picked = curatedNavigation(chosen, known);
  return picked.length ? picked : [...derived];
}

/**
 * The operator's choice alone — empty when they have not chosen, or when every
 * name they chose has since been retired from the ontology.
 *
 * `navigationFor` folds this together with the derived order, which is what the
 * SCREENS need. The sidebar needs the two cases apart: a curated menu is a flat
 * list in the operator's order, while an uncurated one is the derived spine and
 * tree. Deriving "did they choose?" by comparing the two outputs would be wrong
 * the moment a choice happens to equal the derived order.
 */
export function curatedNavigation(
  chosen: readonly string[] | undefined,
  known: readonly string[],
): string[] {
  const set = new Set(known);
  return [...new Set((chosen ?? []).map((n) => n.trim()).filter((n) => n && set.has(n)))];
}

export function assemblePrototype(ontology: Record<string, unknown>, atlas: Record<string, unknown>, parentEntities?: readonly string[]): AssembledPrototype {
  const fabric = deriveFabric(ontology, atlas);
  const roles = deriveRoles(ontology);
  const seed = generateSeed(ontology, fabric.version);
  const roleOf = new Map(roles.attributeRoles.map((r) => [`${r.entity} ${r.attribute}`, r.role] as const));
  const entities = (Array.isArray(ontology.entities) ? ontology.entities : []) as Array<Record<string, unknown>>;
  const names = entities.map((e) => String(e.name ?? "")).filter(Boolean);
  const attrsOf = (name: string) => {
    const e = entities.find((x) => String(x.name) === name);
    return (Array.isArray(e?.attributes) ? e!.attributes : []).map((a) => (typeof a === "string" ? a : String((a as { name?: unknown })?.name ?? ""))).filter(Boolean);
  };
  // ORDER BY STRUCTURE. This line used to sort by `seed.counts` — by how many
  // rows the generator happened to make — so a 120-row forecast-split junction
  // table led the navigation of a CRM and Account sat 20 rows down. Row volume
  // is an artefact of generation; the information architecture is the ontology's
  // shape, so it comes from the graph: roots first, each entity's children
  // beneath it, depth-first.
  const graph = fabric.graph;
  // The menu: the operator's chosen parent entities when they have chosen, else the
  // derived order. Everything else still exists — it appears inside the detail of
  // whatever owns it, which is what the related-collection regions below render.
  const curated = curatedNavigation(parentEntities, names);
  const ordered = curated.length ? curated : graph.navOrder.filter((n) => names.includes(n));
  const es = new Map(names.map((n) => [n, slug(n)]));
  let regionCount = 0;
  const region = (id: string, inner: string) => { regionCount += 1; return `<div data-fabric-id="${esc(id)}">${inner}</div>`; };
  /** What to CALL one record — its title attribute, else the display name the
   *  seed supplied because the ontology gives the entity none, else its id. */
  const displayNameOf = (entity: string, r: Record<string, unknown>): string => {
    const t = attrsOf(entity).find((a) => roleOf.get(`${entity} ${a}`) === "title");
    const v = t ? r[t] : undefined;
    return String((typeof v === "string" && v ? v : undefined) ?? r._display ?? r.id ?? "");
  };

  /**
   * THE ONE DEFINITION of "which columns lead a table of this entity", used by
   * the list screen and by every child collection on a detail screen — so a
   * collection is a real list OF THAT ENTITY, headed the way its own list
   * screen heads it, rather than a second, differently-chosen set of columns.
   *
   * Lead with the entity's TITLE attribute, not with whatever the ontology
   * happened to list first: a positional pick put Contact's `buyingRole` where
   * the contact's name belongs, account names under "Category" and opportunity
   * names under "Stage". When the ontology names no title attribute the lead
   * column is the record's DISPLAY NAME, headed with the entity itself.
   */
  const leadColumnsFor = (name: string, limit: number, exclude?: string): string[] => {
    // `exclude` drops the attribute that points BACK at the context. Inside
    // Account's detail, an "Account Id" column on every Opportunity row is the
    // same value repeated down the table — it says only "these are this
    // account's", which the card's heading already said.
    const all = attrsOf(name).filter((a) => !exclude || a.toLowerCase() !== exclude.toLowerCase());
    const titleAttr = all.find((a) => roleOf.get(`${name} ${a}`) === "title");
    return (titleAttr ? [titleAttr, ...all.filter((a) => a !== titleAttr)] : ["_display", ...all]).slice(0, limit);
  };
  const headFor = (name: string, c: string) => (c === "_display" ? name : humanizeField(c));

  /** One row of an entity's table — the same cell rules wherever it appears. */
  const rowCells = (name: string, cols: string[], r: Record<string, unknown>, s: string, withAction: boolean): string =>
    cols.map((c, i) => i === 0
      ? `<td><div class="m-cell-main">${esc(r[c] ?? r._display ?? r.id)}</div><div class="m-cell-sub">${esc(r.id)}</div></td>`
      : `<td>${renderCell(roleOf.get(`${name} ${c}`), r[c])}</td>`).join("")
    + (withAction ? `<td class="m-row-actions"><button class="m-btn m-btn--secondary m-btn--sm" onclick="show('detail-${s}')">Open</button></td>` : "");

  // ── one list screen per entity ──
  const listScreen = (name: string): string => {
    const s = es.get(name)!; const rows = seed.records[name] ?? [];
    const cols = leadColumnsFor(name, 5);
    const headOf = (c: string) => headFor(name, c);
    const head = cols.map((c) => `<th class="m-th-sort${c === cols[0] ? " is-desc" : ""}">${esc(headOf(c))}</th>`).join("") + `<th style="text-align:right">Actions</th>`;
    const body = rows.length ? rows.slice(0, 24).map((r) => {
      const flagged = Object.values(r).some((v) => v === null);
      return `<tr${flagged ? ' class="is-flagged"' : ""}>` + rowCells(name, cols, r, s, true) + `</tr>`;
    }).join("") : "";
    const table = rows.length
      ? `<div class="m-table-wrap"><table class="m-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
        + `<div class="m-pagination"><span>1–${Math.min(24, rows.length)} of ${rows.length}</span><span style="display:flex;gap:8px"><button class="m-btn m-btn--secondary">Prev</button><button class="m-btn m-btn--secondary">Next</button></span></div></div>`
      : `<div class="m-card"><div class="m-empty"><div class="m-empty-t">No ${esc(name)} records yet</div>Create the first one to get started.</div></div>`;
    return `<section class="m-screen" data-screen="list-${s}" hidden>
      <header class="m-page-h"><div><div class="m-eyebrow">${esc(name)}</div><h1 class="m-title">${esc(name)}</h1><p class="m-sub">${rows.length} record${rows.length === 1 ? "" : "s"} · synthetic seed data</p></div>
      <div style="display:flex;gap:10px"><button class="m-btn m-btn--secondary">Filter</button><button class="m-btn m-btn--primary" onclick="show('form-${s}')">New ${esc(name)}</button></div></header>
      ${region(`screen:${s}:list`, table)}</section>`;
  };

  // ── one detail screen per entity (the SHOWCASE record) ──
  const detailScreen = (name: string): string => {
    const s = es.get(name)!; const rows = seed.records[name] ?? []; const attrs = attrsOf(name);
    // child collections from the fabric (region:{s}:{child})
    const childRegions = fabric.nodes.filter((n) => n.kind === "region" && n.id.startsWith(`region:${s}:`) && n.id !== `region:${s}:summary`);
    // THE RECORD SHOWN IS THE ONE WITH THE MOST TO SHOW. It was `rows[0]` — and
    // the seed deliberately gives the FIRST parent row zero children as the
    // cardinality extreme, so every detail page demoed the empty extreme: on a
    // reviewed CRM build 16 of 22 child sections read "No X yet" with 95
    // opportunities sitting in the seed. The extreme stays in the seed, where
    // stress belongs; the ONE record each entity gets to show stops being it.
    // Count only children the fabric will actually render, so the pick cannot
    // be won by rows a hidden relation owns. Ties keep the earliest row, so a
    // childless entity still shows rows[0] and the pick stays deterministic.
    const childNamesOf = childRegions
      .map((n) => names.find((x) => es.get(x) === n.id.split(":")[2]))
      .filter((x): x is string => Boolean(x));
    const fk = `${name.toLowerCase()}Id`;
    const shown = new Map<string, number>();
    for (const cn of childNamesOf) {
      for (const c of seed.records[cn] ?? []) {
        const v = c[fk]; if (v == null) continue;
        shown.set(String(v), (shown.get(String(v)) ?? 0) + 1);
      }
    }
    const r = rows.reduce<SeedRecord | undefined>((best, row) =>
      best && (shown.get(String(best.id)) ?? 0) >= (shown.get(String(row.id)) ?? 0) ? best : row, rows[0]);
    if (!r) return "";
    const dl = attrs.map((a) => `<div><dt>${esc(humanizeField(a))}</dt><dd>${renderCell(roleOf.get(`${name} ${a}`), r[a])}</dd></div>`).join("");
    const headline = displayNameOf(name, r);
    // RENDER BY ROLE, NOT BY ID PREFIX.
    //
    // Every child region used to render identically: a `<dl>` of up to five
    // id/name pairs. The ontology draws a distinction the fabric already
    // carries and this threw away — `relationshipRolesFor` maps 1:N to
    // `collection`, N:M to `multi-select`, N:1 and 1:1 to `parent-ref` — so a
    // one-to-many showed as a pair-list rather than as a LIST OF THE CHILD
    // ENTITY, and a many-to-many looked exactly the same as it.
    //
    // A collection is now a real table headed the way that entity's own list
    // screen heads it (`leadColumnsFor`, the one definition), so the prototype
    // says what the ontology said.
    const childrenOf = (childName: string) =>
      (seed.records[childName] ?? []).filter((c) => String(c[`${name.toLowerCase()}Id`]) === String(r.id));
    const children = childRegions.map((n) => {
      const childName = names.find((x) => es.get(x) === n.id.split(":")[2]);
      if (!childName) return region(n.id, "");
      const cs = es.get(childName)!;
      const all = childrenOf(childName);
      const shownRows = all.slice(0, 5);
      const head = `<div class="m-card-h"><div class="m-card-t">${esc(childName)}</div><span class="m-badge">${all.length}</span></div>`;
      // A many-to-many is a set of tags, not a table of owned rows. Its
      // membership is not materialised in the seed yet (the seeder declares
      // that skip as an assumption), so it states the gap rather than
      // rendering an empty table that implies there is nothing there.
      if (n.role === "multi-select") {
        const chips = shownRows.length
          ? `<div class="m-chips">${shownRows.map((c) => `<span class="m-chip">${esc(displayNameOf(childName, c))}</span>`).join("")}</div>`
          : `<div class="m-empty"><div class="m-empty-t">No ${esc(childName)} linked</div>Many-to-many membership is not generated in the seed — see the run's assumptions.</div>`;
        return region(n.id, `<section class="m-card" style="margin-top:16px">${head}${chips}</section>`);
      }
      // `collection` (1:N, and the default for an undeclared cardinality).
      const cols = leadColumnsFor(childName, 4, `${name.toLowerCase()}Id`);
      const body = shownRows.map((c) => `<tr>${rowCells(childName, cols, c, cs, false)}</tr>`).join("");
      const table = shownRows.length
        ? `<div class="m-table-wrap"><table class="m-table"><thead><tr>${cols.map((c) => `<th>${esc(headFor(childName, c))}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`
          + (all.length > shownRows.length
            ? `<div class="m-card-f"><button class="m-btn m-btn--secondary m-btn--sm" onclick="show('list-${cs}')">View all ${all.length} ${esc(childName)} →</button></div>`
            : "")
        : `<div class="m-empty"><div class="m-empty-t">No ${esc(childName)} yet</div></div>`;
      return region(n.id, `<section class="m-card" style="margin-top:16px">${head}${table}</section>`);
    }).join("");

    // THE PARENT REFERENCES — an N:1 must produce a LINK.
    //
    // `deriveFabric` mints `nav:{child}:{parent}` nodes with role `parent-ref`
    // for exactly this, and the assembler read `kind === "nav"` zero times: a
    // reference relation rendered nothing at all, so the one direction the
    // ontology states most often was invisible. The record shown is the parent
    // the showcase record actually points at, so the link goes somewhere true.
    const parentNavs = fabric.nodes.filter((nd) => nd.kind === "nav" && nd.id.startsWith(`nav:${s}:`));
    const parents = parentNavs.map((nd) => {
      const parentName = nd.source.relation?.[0] ?? "";
      const ps = es.get(parentName);
      if (!ps) return region(nd.id, "");
      const pid = r[`${parentName.toLowerCase()}Id`];
      const prow = (seed.records[parentName] ?? []).find((p) => String(p.id) === String(pid));
      const label = prow ? displayNameOf(parentName, prow) : "—";
      return region(nd.id, `<button class="m-linkcard" onclick="show('detail-${ps}')">`
        + `<span class="m-linkcard-k">${esc(parentName)}</span>`
        + `<span class="m-linkcard-v">${esc(label)}</span><span class="m-linkcard-go">→</span></button>`);
    }).join("");
    const parentBand = parents ? `<section class="m-card" style="margin-top:16px"><div class="m-card-t" style="margin-bottom:12px">Belongs to</div><div class="m-linkcards">${parents}</div></section>` : "";
    return `<section class="m-screen" data-screen="detail-${s}" hidden>
      <div class="m-crumbs"><a href="#" onclick="show('list-${s}')">${esc(name)}</a> / <span>${esc(headline)}</span></div>
      <header class="m-page-h"><div><div class="m-eyebrow">${esc(name)}</div><h1 class="m-title">${esc(headline)}</h1></div>
      <div style="display:flex;gap:10px"><button class="m-btn m-btn--secondary" onclick="show('form-${s}')">Edit</button><button class="m-btn m-btn--danger">Delete</button></div></header>
      ${region(`region:${s}:summary`, `<section class="m-card"><div class="m-card-t" style="margin-bottom:14px">Details</div><dl class="m-dl">${dl}</dl></section>`)}
      ${parentBand}
      ${children}</section>`;
  };

  // ── one form per entity ──
  const formScreen = (name: string): string => {
    const s = es.get(name)!; const attrs = attrsOf(name);
    const fields = attrs.map((a) => {
      const role = roleOf.get(`${name} ${a}`);
      const req = role === "identifier" || role === "title" ? ` <span class="m-req">*</span>` : "";
      const input = role === "status" ? `<select class="m-select"><option>Open</option><option>In progress</option><option>Closed</option></select>`
        : role === "boolean" ? `<label class="m-checkbox"><input type="checkbox" /> ${esc(humanizeField(a))}</label>`
          : `<input class="m-input" placeholder="${esc(humanizeField(a))}" />`;
      return region(`field:${s}:${slug(a)}`, `<div class="m-field"><label class="m-label">${esc(humanizeField(a))}${req}</label>${input}</div>`);
    }).join("");
    return `<section class="m-screen" data-screen="form-${s}" hidden>
      <div class="m-crumbs"><a href="#" onclick="show('list-${s}')">${esc(name)}</a> / <span>New</span></div>
      <header class="m-page-h"><div><div class="m-eyebrow">${esc(name)}</div><h1 class="m-title">New ${esc(name)}</h1></div></header>
      <section class="m-card" style="max-width:620px">${fields}<div class="m-form-actions"><button class="m-btn m-btn--ghost" onclick="show('list-${s}')">Cancel</button><button class="m-btn m-btn--primary">Save</button></div></section></section>`;
  };

  // ── navigation: the spine, then the whole tree ──
  // The spine is the 5–7 entities the rest of the ontology points at (fan-in),
  // in structural order. It is NOT a hardcoded CRM list: on a three-entity
  // surgical ontology the spine is simply all three, because at that size a flat
  // list is already the right answer.
  // THE MENU IS THE OPERATOR'S, WHEN THEY HAVE MADE ONE. `ordered` already held
  // their choice, but it only ever reached the SCREENS — the sidebar below was
  // still walking `names`, every entity in the ontology. That shipped three
  // faults at once: an entity they switched OFF still got a nav row pointing at
  // a screen that was never built (a dead click), an entity they switched ON was
  // filed under its structural parent instead of standing as its own menu item,
  // and `lead` could name a screen outside `ordered` — so the prototype opened
  // blank. All three are the same omission.
  //
  // When they HAVE curated: a flat list, in their order. Experience Design's
  // promise is "each one ON becomes a menu item"; nesting one chosen entity
  // under another silently downgrades that promise, and the structural tree is
  // exactly the IA they overrode by choosing. Unchosen entities are not lost —
  // they render as child collections inside the detail of whatever owns them.
  //
  // When they have NOT: the derived spine and tree, unchanged.
  const lead = curated.length ? ordered[0] : (graph.spine[0] ?? ordered[0]);
  const navItem = (n: string) =>
    `<span class="m-nav-item${n === lead ? " is-active" : ""}" data-nav="list-${es.get(n)}" onclick="event.preventDefault();event.stopPropagation();show('list-${es.get(n)}')">${esc(n)}<span class="m-nav-count">${seed.counts[n] ?? 0}</span></span>`;
  // Every entity keeps exactly ONE home in the tree — its shallowest parent — so
  // nothing is listed twice and nothing is orphaned. The other parents are not
  // lost: each still carries this entity as a child collection on its detail
  // screen, which is where a second or third owner belongs.
  const branch = (n: string, level: number): string => {
    const kids = (graph.byName[n]?.treeChildren ?? []).filter((k) => names.includes(k));
    if (!kids.length) return `<div class="m-nav-row">${navItem(n)}</div>`;
    // 32 entities nested and pinned open is a wall; the top two levels are open,
    // everything deeper starts collapsed and one click away.
    return `<details class="m-nav-group"${level < 2 ? " open" : ""}><summary class="m-nav-row">${navItem(n)}</summary>`
      + `<div class="m-nav-sub">${kids.map((k) => branch(k, level + 1)).join("")}</div></details>`;
  };
  const tree = graph.roots.filter((r) => ordered.includes(r)).map((r) => branch(r, 0)).join("");
  const spine = graph.spine.filter((n) => ordered.includes(n));
  const spineNav = spine.map((n) => `<div class="m-nav-row">${navItem(n)}</div>`).join("");
  const flat = ordered.map((n) => `<div class="m-nav-row">${navItem(n)}</div>`).join("");
  // Both sides of the comparison must count the SAME set. It read
  // `graph.spine.length < ordered.length` — the spine of every entity against a
  // possibly-curated menu — so a five-entity choice against a six-entity spine
  // collapsed the split for a reason that had nothing to do with the menu.
  const nav = curated.length
    ? `<div class="m-nav-sec">Records</div>${flat}`
    : spine.length && spine.length < ordered.length
      ? `<div class="m-nav-sec">Primary</div>${spineNav}<div class="m-nav-sec">All records</div>${tree}`
      : `<div class="m-nav-sec">Records</div>${tree}`;
  const screens = ordered.map((n) => listScreen(n) + detailScreen(n) + formScreen(n)).join("\n");
  const firstList = `list-${es.get(lead)}`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Prototype — assembled from ontology + atlas</title><style>${meridianStylesheet()}
.m-screen[hidden]{display:none}.m-screen{display:block}</style></head><body>
<div class="m-app"><aside class="m-side"><div class="m-brand"><span class="m-brand-dot"></span>Assembled</div><nav class="m-nav">${nav}</nav></aside>
<main class="m-main">${screens}</main></div>
<script>function show(id){document.querySelectorAll('.m-screen').forEach(s=>s.hidden=s.getAttribute('data-screen')!==id);
var m=document.querySelectorAll('.m-nav-item[data-nav="'+id+'"]');
if(m.length){document.querySelectorAll('.m-nav-item').forEach(function(n){n.classList.remove('is-active')});
m.forEach(function(n){n.classList.add('is-active');for(var p=n.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true})}
window.scrollTo(0,0)}show('${firstList}')</script>
</body></html>`;
  return { html, fabric, regionCount };
}
