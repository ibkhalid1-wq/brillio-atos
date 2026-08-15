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
import { generateSeed, type SeedAssumption, type SeedRecord } from "./seedData.ts";
import { meridianStylesheet } from "./prototypeDesignSystem.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const slug = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";

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

export interface AssembledPrototype { html: string; fabric: Fabric; regionCount: number; }

/**
 * ── THE PAGE SHIPS ITS DATA, NOT NINETY-NINE PICTURES OF IT ──────────────────
 *
 * Every screen used to be baked markup: on a reviewed CRM build, 99 screens and
 * half a megabyte of HTML in which every row was a fixed string. One detail
 * screen existed per entity, so "Open" on row 12 showed row 1 — the control
 * promised navigation the document had no way to perform, because the document
 * held pictures of records rather than records.
 *
 * So the records ship as DATA — one JSON island — and a small renderer draws
 * each region's contents from it at load.
 *
 * WHAT DOES NOT MOVE is the skeleton. Every element carrying a `data-fabric-id`
 * is still emitted by the assembler, into the document, before any script runs:
 * `diffFabric` resolves a change to the regions it touches by that attribute,
 * and the refine post-condition compares the id set of a returned document
 * against the assembled one. Neither can be asked to wait for a script, and
 * neither should have to. Only the CONTENTS of a region — the rows, the values,
 * the chips, the counts — are drawn client-side, which is precisely the part
 * that has to become live before a control can stop lying.
 */

/**
 * ONE COLUMN'S VALUES, in whichever of three encodings states them shortest.
 *
 * This is where the payload claim is actually won or lost. A record-per-object
 * encoding repeats every key on every row: on the 33-entity fixture that is
 * 790KB of JSON for 2,647 records. Column-major removes the keys (393KB) and
 * then the columns themselves turn out to be highly regular, in two different
 * ways that need two different answers:
 *
 *   - a status, a category or a foreign key holds a handful of DISTINCT values
 *     across a hundred rows → state them once and index into them (`u`/`x`);
 *   - an id or a code shares a long PREFIX down the whole column
 *     ("practice-forecast-split-0001", "…-0002") → state the prefix once and
 *     keep the tails (`p`/`s`).
 *
 * Neither assumes anything about how the seeder builds a value — both are
 * measured on the column in front of them, and the raw array wins whenever it
 * is shorter, which on this fixture is a third of the columns. Together they
 * take the data block from 393KB to 250KB.
 */
type EncodedColumn = unknown[] | { u: unknown[]; x: number[] } | { p: string; s: string[] };

/** One entity's rows, column-major. The renderer addresses a value as
 *  (column, row), and a region's column list is three integers rather than
 *  three strings repeated across three hundred regions. */
interface SeedTable {
  cols: string[];
  c: EncodedColumn[];
  /** How many records — the columns are decoded lazily, so the count is stated. */
  n: number;
  /** Column index of the entity's title attribute, and of the seeder's
   *  `_display` fallback. -1 when the entity has neither. */
  t: number;
  d: number;
  /** Row indexes carrying a null — the seeder's planted missing-optional, which
   *  the list screen flags. Computed here so the renderer cannot disagree with
   *  the assembler about what "flagged" means. */
  f: number[];
}
/** The declared assumption a hole cites: what was assumed, and the Listen
 *  question that settles it. Null when nothing in the run accounts for it. */
interface EmptyCite { a: string; q: string }
/** Which columns a table shows: their index in the entity's `cols`, the heading
 *  a person reads, and the semantic role that picks the cell component. */
interface ColumnSpec { ix: number[]; head: string[]; role: number[] }
interface ListSpec extends ColumnSpec { region: string; emptyTitle: string; cite: EmptyCite | null }
interface SummarySpec extends ColumnSpec { region: string; row: number }
interface NavSpec { region: string; entity: string; slug: string; fk: number }
interface KidSpec extends ColumnSpec {
  region: string; entity: string; slug: string;
  /** A many-to-many is a SET: chips, resolved through its membership table
   *  (`junction`). A collection is a list of owned rows, resolved through the
   *  child's foreign-key column (`fk`, -1 when the relation declares none). */
  multi: boolean; fk: number; junction: string;
  emptyTitle: string; cite: EmptyCite | null;
}
interface ScreenSpec {
  entity: string; slug: string;
  list: ListSpec;
  detail: { summary: SummarySpec; navs: NavSpec[]; kids: KidSpec[] } | null;
}
/**
 * The shortest of the three statements of one column, measured rather than
 * guessed — and measured on the serialised bytes, because that is the thing
 * being paid for. Ties go to the plainest encoding, so the choice is a pure
 * function of the values and the same ontology always serialises identically.
 */
function encodeColumn(values: unknown[]): EncodedColumn {
  const rawSize = JSON.stringify(values).length;
  const uniques: unknown[] = [];
  const at = new Map<string, number>();
  const index = values.map((v) => {
    const key = JSON.stringify(v) ?? "undefined";
    let i = at.get(key);
    if (i === undefined) { i = uniques.length; at.set(key, i); uniques.push(v); }
    return i;
  });
  const dictionary = { u: uniques, x: index };
  const dictionarySize = JSON.stringify(dictionary).length;
  let prefixed: { p: string; s: string[] } | null = null;
  if (values.length && values.every((v) => typeof v === "string")) {
    const strings = values as string[];
    let p = strings[0];
    for (const s of strings) {
      let i = 0;
      while (i < p.length && i < s.length && p[i] === s[i]) i += 1;
      p = p.slice(0, i);
      if (!p) break;
    }
    // Two characters of shared prefix cannot pay for the wrapper around them.
    if (p.length > 2) prefixed = { p, s: strings.map((s) => s.slice(p.length)) };
  }
  const prefixSize = prefixed ? JSON.stringify(prefixed).length : Number.MAX_SAFE_INTEGER;
  if (rawSize <= dictionarySize && rawSize <= prefixSize) return values;
  return dictionarySize <= prefixSize ? dictionary : prefixed!;
}

interface PrototypeModel {
  /** The role vocabulary, once — regions carry indexes into it. */
  roles: string[];
  data: Record<string, SeedTable>;
  links: Record<string, Array<[string, string]>>;
  screens: ScreenSpec[];
}

/**
 * THE CLIENT RENDERER — the role→component map, applied to the data island.
 *
 * `mCell` IS that map: one value, one semantic role, one component. It used to
 * live in this module as a server-side `renderCell` and it now lives here,
 * because here is where a value meets a role. The rest is one plain function
 * per region kind and no framework — the document has to stay self-contained
 * and inspectable, and a region's markup has to be decided in exactly one
 * place. The collection / multi-select / parent-ref split below is the fabric's
 * own, read off each region's spec, so a region that renders as the wrong kind
 * is a difference between the fabric and the DOM — which is what the fidelity
 * guard reads.
 *
 * `Q` is a single quote. The renderer emits `onclick="show('detail-x')"`, and
 * spelling that with escapes inside a nested template literal is how a stray
 * backslash silently terminates a string and takes the whole page's script with
 * it.
 */
const PROTOTYPE_RENDERER = `
var Q=String.fromCharCode(39);
function mEsc(v){return String(v==null?"":v).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function mMoney(n){return typeof n==="number"?"$"+n.toLocaleString("en-US"):mEsc(n)}
function mCell(R,ri,v){
  if(v==null||v==="")return '<span class="m-cell-sub">—</span>';
  var r=ri<0?"":R[ri];
  if(r==="monetary")return '<span style="font-variant-numeric:tabular-nums">'+mMoney(v)+"</span>";
  if(r==="quantity")return '<span style="font-variant-numeric:tabular-nums">'+mEsc(v)+"</span>";
  if(r==="percent")return '<span style="font-variant-numeric:tabular-nums">'+mEsc(v)+"%</span>";
  if(r==="status"||r==="category")return '<span class="m-badge">'+mEsc(v)+"</span>";
  if(r==="health"||r==="priority")return '<span class="m-pill m-pill--warn"><span class="m-dot m-dot--warn"></span>'+mEsc(v)+"</span>";
  if(r==="boolean")return v?'<span class="m-dot m-dot--good"></span> Yes':'<span class="m-dot"></span> No';
  if(r==="parent-ref"||r==="cross-ref"||r==="person-ref")return '<span class="m-chip">'+mEsc(v)+"</span>";
  return mEsc(v);
}
(function(){
  var el=document.getElementById("m-seed");
  if(!el)return;
  var M=JSON.parse(el.textContent||"{}"),R=M.roles||[],D=M.data||{},L=M.links||{};
  // The three column encodings, undone. A column is decoded once, the first
  // time a region asks for it, and kept — a build with 33 entities renders 99
  // screens off a handful of them.
  function col(t,i){
    if(i<0)return null;
    if(!t.v)t.v=[];
    if(t.v[i])return t.v[i];
    var e=t.c[i],out=[],k;
    if(Object.prototype.toString.call(e)==="[object Array]")out=e;
    else if(e&&e.p!==undefined){for(k=0;k<e.s.length;k++)out.push(e.p+e.s[k])}
    else if(e){for(k=0;k<e.x.length;k++)out.push(e.u[e.x[k]])}
    t.v[i]=out;
    return out;
  }
  function at(t,ri,i){var c=col(t,i);return c?c[ri]:null}
  function nameOf(t,ri){var v=at(t,ri,t.t);if(typeof v==="string"&&v)return v;var d=at(t,ri,t.d);return String(d==null?at(t,ri,0):d)}
  // THE REGIONS, INDEXED ONCE. Written as an attribute-PRESENCE selector and a
  // getAttribute — never as the text of a fabric-id assignment. Every reader of
  // a prototype (the refine post-condition, the region-count guard) harvests
  // fabric ids by matching that assignment across the whole document, so a
  // selector spelled with one hands them a region that does not exist: the
  // first version of this line invented an id called "+id+" and the guards
  // caught it. The map is also 313 fewer document walks.
  var FID="data-fabric-id",BY={},els=document.querySelectorAll("[data-fabric-id]");
  for(var q=0;q<els.length;q++)BY[els[q].getAttribute(FID)]=els[q];
  function fill(id,html){var e=BY[id];if(e)e.innerHTML=html}
  function cells(t,spec,ri,slug,action){
    var out="",id=at(t,ri,0);
    for(var i=0;i<spec.ix.length;i++){
      var v=at(t,ri,spec.ix[i]);
      if(i===0){
        var lead=v;if(lead==null)lead=at(t,ri,t.d);if(lead==null)lead=id;
        out+='<td><div class="m-cell-main">'+mEsc(lead)+'</div><div class="m-cell-sub">'+mEsc(id)+"</div></td>";
      }else out+="<td>"+mCell(R,spec.role[i],v)+"</td>";
    }
    if(action)out+='<td class="m-row-actions"><button class="m-btn m-btn--secondary m-btn--sm" onclick="show('+Q+"detail-"+slug+Q+')">Open</button></td>';
    return out;
  }
  function heads(spec,sortable){
    var out="";
    for(var i=0;i<spec.head.length;i++)
      out+=sortable?'<th class="m-th-sort'+(i===0?" is-desc":"")+'">'+mEsc(spec.head[i])+"</th>":"<th>"+mEsc(spec.head[i])+"</th>";
    return out;
  }
  function empty(title,cite){
    return '<div class="m-empty"><div class="m-empty-t">'+mEsc(title)+'</div><div class="m-assumed">'
      +(cite
        ?'<span class="m-assumed-k">Assumed</span> '+mEsc(cite.a)+" — one of this run"+Q+"s declared assumptions."
          +'<span class="m-assumed-q">'+mEsc(cite.q)+" Confirm in Listen.</span>"
        :'<span class="m-assumed-k">Undeclared</span> no assumption in this run accounts for the gap.'
          +'<span class="m-assumed-q">Why is there nothing here? Confirm in Listen.</span>')
      +"</div></div>";
  }
  function renderList(sc){
    var t=D[sc.entity],spec=sc.list,total=t?t.n:0;
    if(!total){fill(spec.region,'<div class="m-card">'+empty(spec.emptyTitle,spec.cite)+"</div>");return}
    var flagged={};for(var i=0;i<t.f.length;i++)flagged[t.f[i]]=1;
    var body="",n=total<24?total:24;
    for(var r=0;r<n;r++)body+="<tr"+(flagged[r]?' class="is-flagged"':"")+">"+cells(t,spec,r,sc.slug,true)+"</tr>";
    fill(spec.region,'<div class="m-table-wrap"><table class="m-table"><thead><tr>'+heads(spec,true)
      +'<th style="text-align:right">Actions</th></tr></thead><tbody>'+body+"</tbody></table>"
      +'<div class="m-pagination"><span>1–'+n+" of "+total+'</span><span style="display:flex;gap:8px">'
      +'<button class="m-btn m-btn--secondary">Prev</button><button class="m-btn m-btn--secondary">Next</button></span></div></div>');
  }
  function renderNav(nv,st,sri){
    var t=D[nv.entity];if(!t){fill(nv.region,"");return}
    var pid=at(st,sri,nv.fk),label="—";
    if(pid!=null)for(var i=0;i<t.n;i++)if(String(at(t,i,0))===String(pid)){label=nameOf(t,i);break}
    fill(nv.region,'<button class="m-linkcard" onclick="show('+Q+"detail-"+nv.slug+Q+')">'
      +'<span class="m-linkcard-k">'+mEsc(nv.entity)+"</span>"
      +'<span class="m-linkcard-v">'+mEsc(label)+'</span><span class="m-linkcard-go">→</span></button>');
  }
  function renderKid(kd,recId){
    var t=D[kd.entity];if(!t){fill(kd.region,"");return}
    var all=[],i,r;
    if(kd.multi){
      var linked={},ls=L[kd.junction]||[];
      for(i=0;i<ls.length;i++)if(ls[i][0]===recId)linked[ls[i][1]]=1;
      for(r=0;r<t.n;r++)if(linked[String(at(t,r,0))])all.push(r);
    }else if(kd.fk>=0){
      for(r=0;r<t.n;r++)if(String(at(t,r,kd.fk))===recId)all.push(r);
    }
    var shown=all.slice(0,5),inner;
    var head='<div class="m-card-h"><div class="m-card-t">'+mEsc(kd.entity)+'</div><span class="m-badge">'+all.length+"</span></div>";
    if(kd.multi){
      if(shown.length){
        var chips="";for(i=0;i<shown.length;i++)chips+='<span class="m-chip">'+mEsc(nameOf(t,shown[i]))+"</span>";
        inner='<div class="m-chips">'+chips+"</div>";
      }else inner=empty(kd.emptyTitle,kd.cite);
    }else if(shown.length){
      var body="";for(i=0;i<shown.length;i++)body+="<tr>"+cells(t,kd,shown[i],kd.slug,false)+"</tr>";
      inner='<div class="m-table-wrap"><table class="m-table"><thead><tr>'+heads(kd,false)+"</tr></thead><tbody>"+body+"</tbody></table></div>"
        +(all.length>shown.length
          ?'<div class="m-card-f"><button class="m-btn m-btn--secondary m-btn--sm" onclick="show('+Q+"list-"+kd.slug+Q+')">View all '+all.length+" "+mEsc(kd.entity)+" →</button></div>"
          :"");
    }else inner=empty(kd.emptyTitle,kd.cite);
    fill(kd.region,'<section class="m-card" style="margin-top:16px">'+head+inner+"</section>");
  }
  function renderDetail(sc){
    var d=sc.detail;if(!d)return;
    var t=D[sc.entity];if(!t)return;
    var ri=d.summary.row;if(ri<0||ri>=t.n)return;
    var dl="",i;
    for(i=0;i<d.summary.ix.length;i++)
      dl+="<div><dt>"+mEsc(d.summary.head[i])+"</dt><dd>"+mCell(R,d.summary.role[i],at(t,ri,d.summary.ix[i]))+"</dd></div>";
    fill(d.summary.region,'<section class="m-card"><div class="m-card-t" style="margin-bottom:14px">Details</div><dl class="m-dl">'+dl+"</dl></section>");
    for(i=0;i<d.navs.length;i++)renderNav(d.navs[i],t,ri);
    for(i=0;i<d.kids.length;i++)renderKid(d.kids[i],String(at(t,ri,0)));
  }
  var screens=M.screens||[];
  for(var i=0;i<screens.length;i++){renderList(screens[i]);renderDetail(screens[i])}
})();`;

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

/**
 * THE OPERATOR'S CHOICE, READ OFF THE EXPERIENCE DESIGN — the one definition,
 * reached from both runtimes.
 *
 * The operator answers "which entities get a parent screen?" once, in Experience
 * Design, and `parentEntities` is the whole of that answer. Every surface that
 * assembles a prototype must read it the same way or they assemble different
 * applications: the studio's preview, the stakeholder's link, and the build the
 * refine agent is handed as its baseline. It lives here — in the module the
 * choice is spent in, importable from Deno by path and from the client by alias —
 * so there is no second reading to keep in step.
 *
 * Order matters: it IS the menu order, so a stored choice keeps its order. The
 * fallback reads the legacy `screens` array's entities, so a document authored in
 * the old screen designer still names its navigation.
 */
export function parentEntitiesFor(doc: unknown): string[] {
  const d = (typeof doc === "object" && doc !== null && !Array.isArray(doc)) ? doc as Record<string, unknown> : {};
  const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const chosen = (Array.isArray(d.parentEntities) ? d.parentEntities : []).map((v) => text(v).trim()).filter(Boolean);
  if (chosen.length) return [...new Set(chosen)];
  const legacy: string[] = [];
  for (const screen of (Array.isArray(d.screens) ? d.screens : [])) {
    if (typeof screen !== "object" || screen === null) continue;
    const entities = (screen as Record<string, unknown>).entities;
    for (const e of (Array.isArray(entities) ? entities : [])) {
      const t = text(e).trim();
      if (t && !legacy.includes(t)) legacy.push(t);
    }
  }
  return legacy;
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
  /**
   * A REGION THE CLIENT FILLS. Same element, same id, same place in the
   * document — emitted empty because its contents are records, and records now
   * arrive as data. Everything that addresses a region (the delta, the refine
   * post-condition, the fabric→DOM fidelity guard) addresses this element, so
   * it must exist in the served bytes and not merely after a script has run.
   */
  const slot = (id: string) => region(id, "");

  // ── the data island, assembled alongside the skeleton ──
  const roleLegend: string[] = [];
  const roleIx = new Map<string, number>();
  /** Roles are indexes into one legend: a region carries three integers rather
   *  than three role names, and there are three hundred regions. */
  const roleCode = (r: ValueRole | undefined): number => {
    if (!r) return -1;
    const at = roleIx.get(r);
    if (at !== undefined) return at;
    roleIx.set(r, roleLegend.length);
    roleLegend.push(r);
    return roleLegend.length - 1;
  };
  const screenSpecs: ScreenSpec[] = [];
  /** Only the entities the screens actually reach ship their rows — a curated
   *  build carries its four parents and their children, not the whole ontology. */
  const referenced = new Set<string>();
  const junctionsUsed = new Set<string>();
  /**
   * AN EMPTY STATE THAT TEACHES, carried to the renderer as its two facts.
   *
   * "No X yet" is the weakest state a screen has, and the generator used to
   * throw away the one thing that makes it useful: the zero is not a finding,
   * it is a guess the seeder declared out loud. So the assumption travels with
   * the hole, and the Listen question with it — a miss stays visible, and the
   * emptiest section on the page becomes the one that collects evidence.
   *
   * Null when nothing in the run accounts for the gap; the renderer says THAT,
   * because silence about a missing assumption is the same defect one level up.
   */
  const citeOf = (a: SeedAssumption | undefined): EmptyCite | null =>
    a ? { a: a.assumed, q: a.listenQuestion } : null;

  /**
   * EVERY ENTITY'S ROWS, COLUMNAR — built for all of them, shipped for the ones
   * the screens reach. `id` leads by construction so the renderer can address a
   * record's identity as column zero without carrying a second index for it.
   */
  const tableOf = (name: string): SeedTable => {
    const rows = seed.records[name] ?? [];
    const cols = ["id"];
    const seen = new Set(["id", "_synthetic", "_classification"]);
    for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
    const titleAttr = attrsOf(name).find((a) => roleOf.get(`${name} ${a}`) === "title");
    return {
      cols,
      // `undefined` and `null` both land as null: a column this row does not
      // carry and a value the seeder deliberately emptied render identically
      // (an em dash), and the flag below is computed from the record itself so
      // the two cannot be confused where it matters.
      c: cols.map((col) => encodeColumn(rows.map((r) => (r[col] === undefined ? null : r[col])))),
      n: rows.length,
      t: titleAttr ? cols.indexOf(titleAttr) : -1,
      d: cols.indexOf("_display"),
      f: rows.reduce<number[]>((out, r, i) => (Object.values(r).some((v) => v === null) ? [...out, i] : out), []),
    };
  };
  const tables = new Map<string, SeedTable>(names.map((n) => [n, tableOf(n)]));
  /** Where a named column sits in an entity's row array; -1 when the entity's
   *  rows never carry it (an FK on a relation the seeder could not fill). */
  const columnIndex = (name: string, col: string): number => tables.get(name)?.cols.indexOf(col) ?? -1;
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

  /**
   * WHICH DECLARED ASSUMPTION PRODUCED THIS HOLE.
   *
   * `generateSeed` already writes down every cardinality and optionality it had
   * to guess, each with the Listen question that settles it. The assumption is
   * addressed by its relation PAIR, not by rebuilding the prose subject line —
   * a lookup keyed on a rendered sentence is the string-guess this codebase has
   * already had to rescue the join key from.
   *
   * An entity with no relation at all still declares itself (`orphan-entity`),
   * which is the right citation for a whole list that came out empty.
   */
  const assumptionFor = (parent: string | undefined, entity: string): SeedAssumption | undefined => {
    const forPair = seed.assumptions.filter((a) => a.pair && a.pair[0] === parent && a.pair[1] === entity);
    // The fan-out is the one that decided HOW MANY, so it is the one that
    // explains a zero; optionality is the fallback when the relation declared
    // no fan-out at all (a 1:1, or an undeclared cardinality).
    return forPair.find((a) => a.kind === "fan-out") ?? forPair[0]
      ?? seed.assumptions.find((a) => a.kind === "orphan-entity" && a.subject === entity);
  };

  /** The parent the seeder actually fanned this entity out from — its first
   *  relation edge, read off the graph rather than guessed from a name. */
  const seedParentOf = (name: string) => graph.edges.find((e) => e.child === name)?.parent;

  /**
   * WHICH COLUMNS THIS TABLE SHOWS, as the renderer needs them: the position of
   * each column in the entity's own row array, the heading a person reads, and
   * the semantic role that picks the cell component. The three travel together
   * because they are one decision — `leadColumnsFor` makes it, here and on the
   * list screen and on every child collection, exactly once.
   */
  const columnSpec = (name: string, cols: string[]): ColumnSpec => ({
    ix: cols.map((c) => columnIndex(name, c)),
    head: cols.map((c) => headFor(name, c)),
    role: cols.map((c) => roleCode(roleOf.get(`${name} ${c}`))),
  });

  // ── one list screen per entity ──
  //
  // The header is the ontology's (a name and a count); the TABLE is the seed's,
  // so the table is a slot and the renderer draws it. What the client draws is
  // the same markup this function used to emit — the rules moved, not the
  // output — which is what lets the rendered DOM stay the fidelity guard's
  // subject rather than a second, weaker one.
  const listScreen = (name: string): string => {
    const s = es.get(name)!; const rows = seed.records[name] ?? [];
    referenced.add(name);
    screenSpecs.push({
      entity: name,
      slug: s,
      list: {
        region: `screen:${s}:list`,
        ...columnSpec(name, leadColumnsFor(name, 5)),
        emptyTitle: `No ${name} records yet`,
        cite: citeOf(assumptionFor(seedParentOf(name), name)),
      },
      detail: null,
    });
    return `<section class="m-screen" data-screen="list-${s}" hidden>
      <header class="m-page-h"><div><div class="m-eyebrow">${esc(name)}</div><h1 class="m-title">${esc(name)}</h1><p class="m-sub">${rows.length} record${rows.length === 1 ? "" : "s"} · synthetic seed data</p></div>
      <div style="display:flex;gap:10px"><button class="m-btn m-btn--secondary">Filter</button><button class="m-btn m-btn--primary" onclick="show('form-${s}')">New ${esc(name)}</button></div></header>
      ${slot(`screen:${s}:list`)}</section>`;
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
    //
    // THE JOIN KEY IS THE RELATION'S, NOT A GUESS. Both this count and the
    // render below used to rebuild the FK column as `name.toLowerCase()+"Id"` —
    // a convention reconstructed on the reading side and hoped to match the
    // writing side, which is not a key at all. It is read off the fabric region
    // that declares the relation (`joinKey`), and a many-to-many, which has no
    // FK in either direction, is counted from its membership table instead of
    // being silently counted as zero.
    const childNameOf = (n: { id: string }) => names.find((x) => es.get(x) === n.id.split(":")[2]);
    const linksOf = (n: { junctionKey?: string }) => seed.junctionLinks[n.junctionKey ?? ""] ?? [];
    const shown = new Map<string, number>();
    const bump = (v: unknown) => { if (v != null) shown.set(String(v), (shown.get(String(v)) ?? 0) + 1); };
    for (const n of childRegions) {
      if (n.role === "multi-select") { for (const l of linksOf(n)) bump(l.fromId); continue; }
      const cn = childNameOf(n);
      if (!cn || !n.joinKey) continue;
      for (const c of seed.records[cn] ?? []) bump(c[n.joinKey]);
    }
    const r = rows.reduce<SeedRecord | undefined>((best, row) =>
      best && (shown.get(String(best.id)) ?? 0) >= (shown.get(String(row.id)) ?? 0) ? best : row, rows[0]);
    if (!r) return "";
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
    // The role now travels to the renderer on the region's own spec, so the
    // three cases stay three cases: a collection is a real table headed the way
    // that entity's own list screen heads it (`leadColumnsFor`, the one
    // definition), a many-to-many is a set of chips resolved through its
    // membership table, and a reference is a link card.
    const kids: KidSpec[] = [];
    const childSpec = (n: (typeof childRegions)[number]): string => {
      const childName = childNameOf(n);
      // A region whose child entity has left the ontology still ships its
      // wrapper — the id is the delta's address, and an address that vanishes
      // because the thing behind it did is a silent drop.
      if (!childName) return slot(n.id);
      referenced.add(childName);
      const multi = n.role === "multi-select";
      if (multi && n.junctionKey) junctionsUsed.add(n.junctionKey);
      kids.push({
        region: n.id,
        entity: childName,
        slug: es.get(childName)!,
        multi,
        // A collection resolves through the child's FK column; a many-to-many
        // through its membership table, because neither side owns a key.
        fk: multi || !n.joinKey ? -1 : columnIndex(childName, n.joinKey),
        junction: multi ? (n.junctionKey ?? "") : "",
        ...columnSpec(childName, leadColumnsFor(childName, 4, n.joinKey)),
        emptyTitle: multi ? `No ${childName} linked` : `No ${childName} yet`,
        // A record with no links is a real zero now that membership is
        // generated — but the fan-out behind it is still assumed, so the empty
        // state cites the assumption rather than presenting a guess as a finding.
        cite: citeOf(assumptionFor(name, childName)),
      });
      return slot(n.id);
    };

    // THE PAGE HAS A BUDGET. A detail page carried thirteen child sections on a
    // reviewed CRM build — past roughly five it is a wall, and the relation that
    // matters is somewhere in it. So the sections are ORDERED by how much of the
    // ontology hangs off each child (`subtreeSize`, already on the graph node —
    // a child that owns half the model outranks a leaf), and only the leading
    // few stand open.
    //
    // The rest are COLLAPSED, NEVER DROPPED: they stay in the document, still
    // carrying their `data-fabric-id`, so the fabric→DOM fidelity guard finds
    // every node and a delta still resolves to the region it touches. Dropping
    // them would trade one honest wall for a silent omission, which is the
    // failure this whole track exists to stop.
    //
    // Ties break on fan-in and then on ontology order — never on array position,
    // so the same ontology always opens the same sections.
    const CHILD_SECTIONS_OPEN = 5;
    const weightOf = (n: (typeof childRegions)[number]): [number, number, number] => {
      const cn = childNameOf(n);
      const g = cn ? graph.byName[cn] : undefined;
      return [-(g?.subtreeSize ?? 1), -(g?.fanIn ?? 0), cn ? graph.entities.indexOf(cn) : Number.MAX_SAFE_INTEGER];
    };
    const byWeight = [...childRegions].sort((a, b) => {
      const [as, af, ai] = weightOf(a); const [bs, bf, bi] = weightOf(b);
      return as - bs || af - bf || ai - bi;
    });
    const open = byWeight.slice(0, CHILD_SECTIONS_OPEN).map(childSpec).join("");
    const rest = byWeight.slice(CHILD_SECTIONS_OPEN);
    const children = open + (rest.length
      ? `<details class="m-more"><summary>+${rest.length} more related</summary>${rest.map(childSpec).join("")}</details>`
      : "");

    // THE PARENT REFERENCES — an N:1 must produce a LINK.
    //
    // `deriveFabric` mints `nav:{child}:{parent}` nodes with role `parent-ref`
    // for exactly this, and the assembler read `kind === "nav"` zero times: a
    // reference relation rendered nothing at all, so the one direction the
    // ontology states most often was invisible. The record shown is the parent
    // the showcase record actually points at, so the link goes somewhere true.
    const parentNavs = fabric.nodes.filter((nd) => nd.kind === "nav" && nd.id.startsWith(`nav:${s}:`));
    const navs: NavSpec[] = [];
    const parents = parentNavs.map((nd) => {
      const parentName = nd.source.relation?.[0] ?? "";
      const ps = es.get(parentName);
      if (ps) {
        referenced.add(parentName);
        navs.push({ region: nd.id, entity: parentName, slug: ps, fk: nd.joinKey ? columnIndex(name, nd.joinKey) : -1 });
      }
      return slot(nd.id);
    }).join("");
    const parentBand = parents ? `<section class="m-card" style="margin-top:16px"><div class="m-card-t" style="margin-bottom:12px">Belongs to</div><div class="m-linkcards">${parents}</div></section>` : "";
    // The screen's own spec was pushed by `listScreen`, which runs first for
    // every entity — the detail hangs off it rather than opening a second entry,
    // so the renderer walks one list of screens and the two halves of a screen
    // cannot drift apart.
    const spec = screenSpecs.find((x) => x.entity === name);
    if (spec) {
      spec.detail = {
        summary: { region: `region:${s}:summary`, row: rows.indexOf(r), ...columnSpec(name, attrs) },
        navs,
        kids,
      };
    }
    return `<section class="m-screen" data-screen="detail-${s}" hidden>
      <div class="m-crumbs"><a href="#" onclick="show('list-${s}')">${esc(name)}</a> / <span>${esc(headline)}</span></div>
      <header class="m-page-h"><div><div class="m-eyebrow">${esc(name)}</div><h1 class="m-title">${esc(headline)}</h1></div>
      <div style="display:flex;gap:10px"><button class="m-btn m-btn--secondary" onclick="show('form-${s}')">Edit</button><button class="m-btn m-btn--danger">Delete</button></div></header>
      ${slot(`region:${s}:summary`)}
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
  // Every entity keeps exactly ONE home in the tree — its shallowest parent, or
  // the top level when the graph promoted it there — so nothing is listed twice
  // and nothing is orphaned. The other parents are not lost: each still carries
  // this entity as a child collection on its detail screen, which is where a
  // second or third owner belongs.
  const branch = (n: string, level: number): string => {
    const kids = (graph.byName[n]?.treeChildren ?? []).filter((k) => names.includes(k));
    if (!kids.length) return `<div class="m-nav-row">${navItem(n)}</div>`;
    // 32 entities nested and pinned open is a wall. The top band and its
    // immediate children are open; anything with descendants below that starts
    // collapsed, one click away. This used to open two levels, which was the
    // same intent measured against a tree one level deeper — every branch of the
    // ontology that put its central object under a footnote. Now that the graph
    // promotes that object to the top band, two levels IS the whole ontology.
    return `<details class="m-nav-group"${level < 1 ? " open" : ""}><summary class="m-nav-row">${navItem(n)}</summary>`
      + `<div class="m-nav-sub">${kids.map((k) => branch(k, level + 1)).join("")}</div></details>`;
  };
  // THE TREE STARTS WHERE THE TREE STARTS — `treeRoots`, not `roots`. The two
  // differ exactly where an entity was promoted for business primacy: `roots` is
  // the relation fact (nothing produces it) that the SEEDER needs, and reading it
  // here would build the nav from the promoted entity's old home and leave the
  // entity itself unreachable from the tree.
  const tree = graph.treeRoots.filter((r) => ordered.includes(r)).map((r) => branch(r, 0)).join("");
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

  // THE ISLAND. Built after the screens because the screens are what decide
  // which entities are reachable: a curated build ships its chosen parents and
  // the children they show, not the whole ontology. Key order is insertion
  // order throughout — ontology order for the tables, screen order for the
  // rest — so the same ontology serialises to the same bytes.
  const data: Record<string, SeedTable> = {};
  for (const n of names) if (referenced.has(n)) data[n] = tables.get(n)!;
  const links: Record<string, Array<[string, string]>> = {};
  for (const key of junctionsUsed) links[key] = (seed.junctionLinks[key] ?? []).map((l) => [l.fromId, l.toId]);
  const model: PrototypeModel = { roles: roleLegend, data, links, screens: screenSpecs };
  // `<` is the ONE character that can end a script block early; escaping it
  // keeps the island valid JSON (a `<` inside a JSON string is just `<`)
  // and unable to close its own element.
  const island = JSON.stringify(model).replace(/</g, "\\u003c");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Prototype — assembled from ontology + atlas</title><style>${meridianStylesheet()}
.m-screen[hidden]{display:none}.m-screen{display:block}</style></head><body>
<div class="m-app"><aside class="m-side"><div class="m-brand"><span class="m-brand-dot"></span>Assembled</div><nav class="m-nav">${nav}</nav></aside>
<main class="m-main">${screens}</main></div>
<script type="application/json" id="m-seed">${island}</script>
<script>function show(id){document.querySelectorAll('.m-screen').forEach(s=>s.hidden=s.getAttribute('data-screen')!==id);
var m=document.querySelectorAll('.m-nav-item[data-nav="'+id+'"]');
if(m.length){document.querySelectorAll('.m-nav-item').forEach(function(n){n.classList.remove('is-active')});
m.forEach(function(n){n.classList.add('is-active');for(var p=n.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true})}
window.scrollTo(0,0)}${PROTOTYPE_RENDERER}
show('${firstList}')</script>
</body></html>`;
  return { html, fabric, regionCount };
}
