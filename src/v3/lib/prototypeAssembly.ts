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
import { deriveFabric, type Fabric } from "./fabric";
import { deriveRoles, type ValueRole } from "./semanticRoles";
import { generateSeed } from "./seedData";
import { meridianStylesheet } from "./prototypeDesignSystem";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const slug = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
const money = (n: unknown) => (typeof n === "number" ? `$${n.toLocaleString("en-US")}` : esc(n));

/** Render one value by its semantic role — the role→component map, applied. */
function renderCell(role: ValueRole | undefined, value: unknown): string {
  if (value == null || value === "") return `<span class="m-cell-sub">—</span>`;
  switch (role) {
    case "monetary": return `<span style="font-variant-numeric:tabular-nums">${money(value)}</span>`;
    case "quantity": return `<span style="font-variant-numeric:tabular-nums">${esc(value)}</span>`;
    case "status": return `<span class="m-badge">${esc(value)}</span>`;
    case "health": case "priority": return `<span class="m-pill m-pill--warn"><span class="m-dot m-dot--warn"></span>${esc(value)}</span>`;
    case "boolean": return value ? `<span class="m-dot m-dot--good"></span> Yes` : `<span class="m-dot"></span> No`;
    case "parent-ref": case "cross-ref": return `<span class="m-chip">${esc(value)}</span>`;
    default: return esc(value);
  }
}

export interface AssembledPrototype { html: string; fabric: Fabric; regionCount: number; }

export function assemblePrototype(ontology: Record<string, unknown>, atlas: Record<string, unknown>): AssembledPrototype {
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
  // present the entities that carry rows first (a populated screen is the instrument)
  const ordered = [...names].sort((a, b) => (seed.counts[b] ?? 0) - (seed.counts[a] ?? 0));
  const es = new Map(names.map((n) => [n, slug(n)]));
  let regionCount = 0;
  const region = (id: string, inner: string) => { regionCount += 1; return `<div data-fabric-id="${esc(id)}">${inner}</div>`; };

  // ── one list screen per entity ──
  const listScreen = (name: string): string => {
    const s = es.get(name)!; const rows = seed.records[name] ?? []; const cols = attrsOf(name).slice(0, 5);
    const head = cols.map((c) => `<th class="m-th-sort${c === cols[0] ? " is-desc" : ""}">${esc(c)}</th>`).join("") + `<th style="text-align:right">Actions</th>`;
    const body = rows.length ? rows.slice(0, 24).map((r) => {
      const flagged = Object.values(r).some((v) => v === null);
      return `<tr${flagged ? ' class="is-flagged"' : ""}>` + cols.map((c, i) => i === 0
        ? `<td><div class="m-cell-main">${esc(r[c])}</div><div class="m-cell-sub">${esc(r.id)}</div></td>`
        : `<td>${renderCell(roleOf.get(`${name} ${c}`), r[c])}</td>`).join("")
        + `<td class="m-row-actions"><button class="m-btn m-btn--secondary m-btn--sm" onclick="show('detail-${s}')">Open</button></td></tr>`;
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

  // ── one detail screen per entity (first record) ──
  const detailScreen = (name: string): string => {
    const s = es.get(name)!; const rows = seed.records[name] ?? []; const r = rows[0]; const attrs = attrsOf(name);
    if (!r) return "";
    const dl = attrs.map((a) => `<div><dt>${esc(a)}</dt><dd>${renderCell(roleOf.get(`${name} ${a}`), r[a])}</dd></div>`).join("");
    // child collections from the fabric (region:{s}:{child})
    const childRegions = fabric.nodes.filter((n) => n.kind === "region" && n.id.startsWith(`region:${s}:`) && n.id !== `region:${s}:summary`);
    const children = childRegions.map((n) => {
      const childName = names.find((x) => es.get(x) === n.id.split(":")[2]);
      const crows = (childName ? seed.records[childName] ?? [] : []).filter((c) => String(c[`${name.toLowerCase()}Id`]) === String(r.id)).slice(0, 5);
      return region(n.id, `<section class="m-card" style="margin-top:16px"><div class="m-card-h"><div class="m-card-t">${esc(childName)}</div><span class="m-badge">${crows.length}</span></div>`
        + (crows.length ? `<div class="m-dl">${crows.map((c) => `<div><dt>${esc(c.id)}</dt><dd>${esc(Object.values(c).find((v) => typeof v === "string" && v !== c.id) ?? "")}</dd></div>`).join("")}</div>` : `<div class="m-empty"><div class="m-empty-t">No ${esc(childName)} yet</div></div>`) + `</section>`);
    }).join("");
    return `<section class="m-screen" data-screen="detail-${s}" hidden>
      <div class="m-crumbs"><a href="#" onclick="show('list-${s}')">${esc(name)}</a> / <span>${esc(r[attrs[0]] ?? r.id)}</span></div>
      <header class="m-page-h"><div><div class="m-eyebrow">${esc(name)}</div><h1 class="m-title">${esc(r[attrs[0]] ?? r.id)}</h1></div>
      <div style="display:flex;gap:10px"><button class="m-btn m-btn--secondary" onclick="show('form-${s}')">Edit</button><button class="m-btn m-btn--danger">Delete</button></div></header>
      ${region(`region:${s}:summary`, `<section class="m-card"><div class="m-card-t" style="margin-bottom:14px">Details</div><dl class="m-dl">${dl}</dl></section>`)}
      ${children}</section>`;
  };

  // ── one form per entity ──
  const formScreen = (name: string): string => {
    const s = es.get(name)!; const attrs = attrsOf(name);
    const fields = attrs.map((a) => {
      const role = roleOf.get(`${name} ${a}`);
      const req = role === "identifier" || role === "title" ? ` <span class="m-req">*</span>` : "";
      const input = role === "status" ? `<select class="m-select"><option>Open</option><option>In progress</option><option>Closed</option></select>`
        : role === "boolean" ? `<label class="m-checkbox"><input type="checkbox" /> ${esc(a)}</label>`
          : `<input class="m-input" placeholder="${esc(a)}" />`;
      return region(`field:${s}:${slug(a)}`, `<div class="m-field"><label class="m-label">${esc(a)}${req}</label>${input}</div>`);
    }).join("");
    return `<section class="m-screen" data-screen="form-${s}" hidden>
      <div class="m-crumbs"><a href="#" onclick="show('list-${s}')">${esc(name)}</a> / <span>New</span></div>
      <header class="m-page-h"><div><div class="m-eyebrow">${esc(name)}</div><h1 class="m-title">New ${esc(name)}</h1></div></header>
      <section class="m-card" style="max-width:620px">${fields}<div class="m-form-actions"><button class="m-btn m-btn--ghost" onclick="show('list-${s}')">Cancel</button><button class="m-btn m-btn--primary">Save</button></div></section></section>`;
  };

  const nav = ordered.map((n, i) => `<div class="m-nav-item${i === 0 ? " is-active" : ""}" onclick="show('list-${es.get(n)}',this)">${esc(n)}<span class="m-nav-count">${seed.counts[n] ?? 0}</span></div>`).join("");
  const screens = ordered.map((n) => listScreen(n) + detailScreen(n) + formScreen(n)).join("\n");
  const firstList = `list-${es.get(ordered[0])}`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Prototype — assembled from ontology + atlas</title><style>${meridianStylesheet()}
.m-screen[hidden]{display:none}.m-screen{display:block}</style></head><body>
<div class="m-app"><aside class="m-side"><div class="m-brand"><span class="m-brand-dot"></span>Assembled</div><nav class="m-nav"><div class="m-nav-sec">Records</div>${nav}</nav></aside>
<main class="m-main">${screens}</main></div>
<script>function show(id,el){document.querySelectorAll('.m-screen').forEach(s=>s.hidden=s.getAttribute('data-screen')!==id);if(el){document.querySelectorAll('.m-nav-item').forEach(n=>n.classList.remove('is-active'));el.classList.add('is-active')}window.scrollTo(0,0)}show('${firstList}')</script>
</body></html>`;
  return { html, fabric, regionCount };
}
