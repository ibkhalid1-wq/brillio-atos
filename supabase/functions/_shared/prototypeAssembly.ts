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
import { meridianStylesheet, valueTone, type PrototypeTheme } from "./prototypeDesignSystem.ts";
import { deriveScreenActions, type ScreenAction } from "./experienceActions.ts";
import { businessRole, deriveWorkbenches, type AtlasRole, type AtlasWorkflow } from "./atlasWorkbenches.ts";
import { deriveAgenticSurface, agentsOnEntity, gatedAgents, type SurfacedAgent } from "./agenticSurface.ts";
import { entityNameResolver, joinKeyFor, type OntologyGraph } from "./ontologyGraph.ts";
import {
  buildSpecSchema, validatePrototypeSpec, widgetBandsHtml, widgetGroupsFor,
  WIDGET_RENDERER, type PrototypeSpecSchema, type WidgetGroup,
} from "./prototypeScreenSpec.ts";

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

export interface AssembledPrototype {
  html: string;
  fabric: Fabric;
  regionCount: number;
  /**
   * WHAT A SCREEN SPEC MAY REFERENCE — derived from THIS ontology and THIS
   * build's screens, so the model that writes one is writing against the
   * application that exists rather than against a remembered one.
   */
  specSchema: PrototypeSpecSchema;
  /**
   * Every widget this build was asked for and did not draw, and why. Empty when
   * no spec was handed in. The caller writes these into the artifact's `gaps`:
   * a reference the ontology cannot honour has to be visible, and the failure
   * this whole path replaces was a silent one.
   */
  specViolations: string[];
  /** How many widgets the spec actually put on the page. */
  specAccepted: number;
  /**
   * EVERY ONTOLOGY ENTITY THIS BUILD RENDERS NO SCREEN FOR, named and reasoned.
   *
   * The menu is the operator's, and the drill-through closure below builds a
   * detail for anything a menu entity relates to — so what is left is an entity
   * the ontology holds, the navigation does not offer, and no relation reaches:
   * absent from the application entirely. That is a legitimate curation
   * outcome and it is still an ABSENCE, and on a reviewed CRM build it was a
   * silent one — the entities were gone from the app while nothing in `gaps`,
   * `warnings` or `assumptions` said a word.
   *
   * So the assembly states it here, in the artifact's own words, and the caller
   * writes it into `gaps` (`resolvePrototypeDoc`). The render-QA gate reads the
   * same list: an undeclared absence is an ERROR there, a declared one a
   * warning. Empty when the build covers the whole ontology.
   */
  coverageGaps: string[];
}

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
interface ListSpec extends ColumnSpec {
  region: string; emptyTitle: string; cite: EmptyCite | null;
  /** The view this list OPENS on. Absent means the table — the default, so an
   *  unoptioned build ships no key for it and serialises as it always did. */
  view?: "board";
  /** Column index of the entity's STATUS attribute, -1 when it declares none.
   *  It is what decides whether this list is offered a board view at all: an
   *  entity with no status gets no switch, because a board with one nameless
   *  lane is a zero-value affordance. */
  status: number;
}
interface SummarySpec extends ColumnSpec { region: string; row: number }
interface NavSpec {
  region: string; entity: string; slug: string; fk: number;
  /** The parent's DETAIL exists (the closure guarantees it for anything
   *  reachable), so the card may navigate to the named record. */
  linked: boolean;
  /** The parent also has a LIST — only true for menu entities. Without it the
   *  "browse all" fallback has nowhere to go, so it is not offered. */
  listed: boolean;
}
interface KidSpec extends ColumnSpec {
  region: string; entity: string; slug: string;
  /** A many-to-many is a SET: chips, resolved through its membership table
   *  (`junction`). A collection is a list of owned rows, resolved through the
   *  child's foreign-key column (`fk`, -1 when the relation declares none). */
  multi: boolean; fk: number; junction: string;
  /** The ontology has not confirmed this relation's cardinality, so the section
   *  renders as a list AND says so. See `relationshipRolesFor`. */
  provisional?: boolean;
  /** Does this entity have a LIST screen? A reachable-only entity has just a
   *  detail, so "View all N" would navigate nowhere. Drilling into one record
   *  still works — that is the whole point of the closure. */
  listed?: boolean;
  emptyTitle: string; cite: EmptyCite | null;
}
interface ScreenSpec {
  entity: string; slug: string;
  list: ListSpec;
  detail: { summary: SummarySpec; navs: NavSpec[]; kids: KidSpec[] } | null;
}
/** One entity's rows as they appear on a PERSON's screen: the same columns its
 *  own list screen leads with, plus the status column so the workbench can
 *  count the lanes the role actually works in. */
interface QueueSpec extends ColumnSpec {
  region: string; entity: string; slug: string; status: number;
  emptyTitle: string; cite: EmptyCite | null;
}
interface WorkbenchSpec { slug: string; queues: QueueSpec[] }
/** One gated agent's queue. `key` addresses this session's decisions and is the
 *  agent's slug — an agent renamed in the blueprint is a different gate, which
 *  is correct: the decisions were about the old one. */
interface ApprovalSpec extends ColumnSpec { region: string; key: string; entity: string; slug: string }
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
  /** The entity slug the RECORDS group leads with — the operator's curated
   *  first choice, and the fallback landing screen. */
  first: string;
  /** The route the application opens on when the URL names none: a person's
   *  workbench (`<wbRoute>/<slug>`). Absent when the atlas named no roles, and
   *  then the app opens on `first` exactly as it always did. */
  home?: string;
  /** The atlas's roles, each with its queues. Empty when the atlas has none. */
  work: WorkbenchSpec[];
  /** The gated agents' queues. Empty when the blueprint is absent or gates nothing. */
  appr: ApprovalSpec[];
  /** The two reserved route words (see `reserveRoute`). */
  wbRoute: string;
  apRoute: string;
  /**
   * The summary bands a validated screen spec asked for — the model's judgement,
   * resolved to column addresses. Absent (not empty) when no spec was handed in,
   * so a build nobody wrote a spec for serialises byte-for-byte as it did before
   * this existed.
   */
  widgets?: WidgetGroup[];
  /**
   * The DESIGNED VERBS this build carries, by screen slug — each resolved to
   * something the renderer can actually do: a column and the value written into
   * it (`set`), or the slug of the form that opens (`create`/`assign`). Absent
   * when the Experience Design authored none this ontology could carry, so a
   * build without them serialises exactly as it did before they existed.
   */
  acts?: Record<string, Array<{ kind: string; label: string; col: number; value: string; target: string }>>;
  /**
   * value → the verdict it states ("good" | "warn" | "risk"), for the
   * state-shaped columns. Absent when nothing on this build states one, so a
   * build of neutral stages serialises exactly as it did before tones existed.
   */
  tones?: Record<string, string>;
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
 * ── THE CONTROLS EITHER WORK OR THEY ARE NOT THERE ───────────────────────────
 *
 * A reviewed CRM build shipped 165 buttons that did nothing: Filter, Prev,
 * Next, Delete, and a Save that did not even return to the list. "Open" on row
 * 12 showed row 1, because one static detail per entity was all there was. A
 * control that is drawn and does nothing is worse than an absent one — it is
 * the demo asserting a capability the record does not contain, and the client
 * validating it.
 *
 * So the seed is now the application's STATE, not its decoration:
 *
 *   - every table row addresses ITS OWN record, and the URL says which one
 *     (`#account/account-0002`), so a demo moment is linkable and Back works;
 *   - Filter filters, the column heads sort, Prev/Next page, Save appends or
 *     updates a visible row and returns to the list, Delete removes with an
 *     Undo that puts the row back where it was;
 *   - and where a control still could not work it was REMOVED. The "Filter"
 *     button that opened nothing is now the filter field itself.
 *
 * Mutations are in-memory and per-session: `t.ix` is the live row order, so a
 * delete is a splice and an append is an unshift, and every region that counts
 * or lists that entity — child collections on other entities' details included
 * — reads the same list. The served bytes never move, so the build stays
 * byte-identical for the same ontology.
 *
 * ── A PICKER SAVES THE RELATION, NOT A LABEL ─────────────────────────────────
 *
 * A relation-typed field renders as a `<select>` whose option values are the
 * parent's ids. Saving wrote that id into the ATTRIBUTE column — the one the
 * detail prints as a name and the list heads as one — and nowhere else, while
 * the link card (`NavSpec.fk`) and the parent's collection (`KidSpec.fk`) both
 * resolve the relation through the JOIN KEY. One save then left a record
 * stating its parent three ways: a raw id where a name belongs, a link card
 * still pointing at the parent the user had just replaced, and a parent whose
 * collection never moved.
 *
 * So a picker carries the join-key COLUMN NAME (`data-fkc`, minted by
 * `joinKeyFor` at assembly — the reading side never rebuilds the convention),
 * `saveRec` writes BOTH halves from the one record chosen (name to the column a
 * person reads, id to the key the application reads, in that order so an
 * attribute that IS the key keeps the id), and `pickerVal` re-opens the form on
 * the parent the record actually has. Bytes here are the whole document's, and
 * this cost ~700 of them; see `DOCUMENT_REFINE_BUDGET`.
 *
 * `TONE` is the verdict lookup: value → "good" | "warn" | "risk", decided
 * server-side by `valueTone` and filled from the island, so a state that
 * carries a verdict wears it and this renderer cannot invent one. A toned
 * badge borrows the PILL modifier — same semantic tokens, and those rules
 * already follow `.m-badge` in the sheet, so no duplicate CSS is shipped.
 * Health used to be pinned to `--warn` for EVERY value, so a record reading
 * "Healthy" was drawn as a warning.
 *
 * `Q` is a single quote. The renderer emits `onclick="go('#account/…')"`, and
 * spelling that with escapes inside a nested template literal is how a stray
 * backslash silently terminates a string and takes the whole page's script with
 * it.
 */
const PROTOTYPE_RENDERER = `
var Q=String.fromCharCode(39);
var TONE={};
function mEsc(v){return String(v==null?"":v).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function mMoney(n){return typeof n==="number"?"$"+n.toLocaleString("en-US"):mEsc(n)}
function mCell(R,ri,v){
  if(v==null||v==="")return '<span class="m-cell-sub">—</span>';
  var r=ri<0?"":R[ri];
  if(r==="monetary")return '<span style="font-variant-numeric:tabular-nums">'+mMoney(v)+"</span>";
  if(r==="quantity")return '<span style="font-variant-numeric:tabular-nums">'+mEsc(v)+"</span>";
  if(r==="percent")return '<span style="font-variant-numeric:tabular-nums">'+mEsc(v)+"%</span>";
  var tn=TONE[String(v)];
  if(r==="status"||r==="category")return '<span class="m-badge'+(tn?" m-pill--"+tn:"")+'">'+mEsc(v)+"</span>";
  if(r==="health"||r==="priority")return '<span class="m-pill'+(tn?" m-pill--"+tn:"")+'"><span class="m-dot'+(tn?" m-dot--"+tn:"")+'"></span>'+mEsc(v)+"</span>";
  if(r==="boolean")return v?'<span class="m-dot m-dot--good"></span> Yes':'<span class="m-dot"></span> No';
  if(r==="parent-ref"||r==="cross-ref"||r==="person-ref")return '<span class="m-chip">'+mEsc(v)+"</span>";
  return mEsc(v);
}
(function(){
  var el=document.getElementById("m-seed");
  if(!el)return;
  var M=JSON.parse(el.textContent||"{}"),R=M.roles||[],D=M.data||{},L=M.links||{};
  TONE=M.tones||{};
  // 20 rows a page. The seeder gives a root entity 24 rows FOR THIS REASON —
  // "> page size (20) → a second page" is written into its own defaults — so a
  // pager set to 24 would put every root table on exactly one page and the
  // control would be honest and useless at the same time.
  var SCREENS=M.screens||[],SC={},HOME=M.first||"",HOMEW=M.home||"",PAGE=20,i;
  for(i=0;i<SCREENS.length;i++)SC[SCREENS[i].slug]=SCREENS[i];
  // Workbenches, approval queues, and the two RESERVED route words.
  var WORK=M.work||[],WB={},APPR=M.appr||[],WBR=M.wbRoute||"workbench",APR=M.apRoute||"approvals";
  for(i=0;i<WORK.length;i++)WB[WORK[i].slug]=WORK[i];
  // ONE STATE OBJECT PER SCREEN — the page, the filter, the sort, the view, and
  // which record its detail is showing. Keyed by entity slug, never by index.
  var S={},FORM={},UNDO=null,HASH="";
  // The OPENING view is the screen's own — the operator can ask a list with a
  // status to open on its board — and everything after the first render is this
  // session's. Read off the spec, so the served tab state and the drawn region
  // cannot disagree about which view the screen is in.
  function st(sl){
    if(S[sl])return S[sl];
    var sc=SC[sl],v=sc&&sc.list&&sc.list.view==="board"?"board":"table";
    return S[sl]={page:0,q:"",view:v,sort:-1,dir:1,rec:-1};
  }
  // The three column encodings, undone. A column is decoded once, the first
  // time a region asks for it, and kept — a build with 33 entities renders 99
  // screens off a handful of them.
  function col(t,i){
    if(i<0)return null;
    if(!t.v)t.v=[];
    if(t.v[i])return t.v[i];
    var e=t.c[i],out=[],k;
    if(Object.prototype.toString.call(e)==="[object Array]")out=e.slice(0);
    else if(e&&e.p!==undefined){for(k=0;k<e.s.length;k++)out.push(e.p+e.s[k])}
    else if(e){for(k=0;k<e.x.length;k++)out.push(e.u[e.x[k]])}
    t.v[i]=out;
    return out;
  }
  // THE LIVE ROWS, as physical row indexes. Everything that lists or counts this
  // entity reads this one array, so a delete on the detail page is also gone
  // from the list, from the child collection on its parent, and from the count
  // badge — a record removed in one place and still present in another is the
  // same lie the dead buttons were.
  function live(t){if(!t.ix){t.ix=[];for(var k=0;k<t.n;k++)t.ix.push(k)}return t.ix}
  // A row index at or past the seeded count is one this session ADDED; its
  // values live in t.add. Physical indexes are never reused, so a delete cannot
  // renumber the rows a link already points at.
  function at(t,ri,i){
    if(i<0||ri<0)return null;
    if(ri>=t.n){var a=(t.add||[])[ri-t.n];var v=a?a[i]:null;return v===undefined?null:v}
    var c=col(t,i);return c?c[ri]:null;
  }
  function setAt(t,ri,i,v){
    if(i<0||ri<0)return;
    if(ri>=t.n){var a=(t.add||[])[ri-t.n];if(a)a[i]=v;return}
    var c=col(t,i);if(c)c[ri]=v;
  }
  function nameOf(t,ri){var v=at(t,ri,t.t);if(typeof v==="string"&&v)return v;var d=at(t,ri,t.d);return String(d==null?at(t,ri,0):d)}
  function rowOf(t,id){var ix=live(t),k;for(k=0;k<ix.length;k++)if(String(at(t,ix[k],0))===String(id))return ix[k];return -1}
  // A RECORD'S ADDRESS. The id is percent-encoded so it survives both the URL
  // and the single-quoted JavaScript string the attribute carries it in.
  function href(sl,id){return "#"+sl+"/"+encodeURIComponent(String(id)).replace(/'/g,"%27")}
  function act(h){return "go("+Q+h+Q+")"}
  // THE REGIONS, INDEXED ONCE. Written as an attribute-PRESENCE selector and a
  // getAttribute — never as the text of a fabric-id assignment. Every reader of
  // a prototype (the refine post-condition, the region-count guard) harvests
  // fabric ids by matching that assignment across the whole document, so a
  // selector spelled with one hands them a region that does not exist: the
  // first version of this line invented an id called "+id+" and the guards
  // caught it. The map is also 313 fewer document walks.
  // Persona and approval queues carry data-region, NOT a fabric id.
  var FID="data-fabric-id",BY={},els=document.querySelectorAll("[data-fabric-id],[data-region]");
  for(var q=0;q<els.length;q++){var qk=els[q].getAttribute(FID)||els[q].getAttribute("data-region");if(qk&&!BY[qk])BY[qk]=els[q]}
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
    // OPEN THIS ROW, not the one the entity happens to showcase.
    if(action)out+='<td class="m-row-actions"><button class="m-btn m-btn--secondary m-btn--sm" onclick="'+act(href(slug,id))+'">Open</button></td>';
    return out;
  }
  // A column head SORTS. It used to be painted with a descending arrow on the
  // first column and no handler anywhere — a stated sort order that was not one.
  function heads(spec,sl){
    var out="",s=sl?st(sl):null;
    for(var i=0;i<spec.head.length;i++){
      var ci=spec.ix[i];
      if(sl&&ci>=0){
        var on=s.sort===ci;
        out+='<th class="m-th-sort'+(on?(s.dir<0?" is-desc":" is-asc"):"")+'" onclick="sortBy('+Q+sl+Q+","+i+')">'+mEsc(spec.head[i])+"</th>";
      }else out+="<th>"+mEsc(spec.head[i])+"</th>";
    }
    return out;
  }
  function empty(title,cite){
    return '<div class="m-empty"><div class="m-empty-t">'+mEsc(title)+'</div><div class="m-assumed">'
      +(cite
        ?'<span class="m-assumed-k">Note</span> '+mEsc(cite.a)+"."
          +'<span class="m-assumed-q">'+mEsc(cite.q)+" To confirm with the team.</span>"
        :'<span class="m-assumed-k">Note</span> nothing accounts for this gap yet.'
          +'<span class="m-assumed-q">Why is there nothing here? To confirm with the team.</span>')
      +"</div></div>";
  }
  // WHICH ROWS THIS LIST IS SHOWING — the live rows, through the filter, in the
  // sort order. One definition, so the pager, the board and the footer count
  // can never disagree about what "these records" means.
  function rowsFor(sc){
    var t=D[sc.entity],spec=sc.list,s=st(sc.slug),ix=live(t),out=[],i,j;
    if(s.q){
      var qq=s.q.toLowerCase();
      for(i=0;i<ix.length;i++){
        var hit=false,idv=at(t,ix[i],0);
        if(idv!=null&&String(idv).toLowerCase().indexOf(qq)>=0)hit=true;
        for(j=0;!hit&&j<spec.ix.length;j++){
          var cv=at(t,ix[i],spec.ix[j]);
          if(cv!=null&&String(cv).toLowerCase().indexOf(qq)>=0)hit=true;
        }
        if(hit)out.push(ix[i]);
      }
    }else out=ix.slice(0);
    if(s.sort>=0){
      out.sort(function(a,b){
        var x=at(t,a,s.sort),y=at(t,b,s.sort);
        if(x==null&&y==null)return 0;
        if(x==null)return 1;
        if(y==null)return -1;
        if(typeof x==="number"&&typeof y==="number")return (x-y)*s.dir;
        var sx=String(x),sy=String(y);
        return (sx<sy?-1:sx>sy?1:0)*s.dir;
      });
    }
    return out;
  }
  function board(sc,rows){
    var t=D[sc.entity],ci=sc.list.status,order=[],by={},i,v;
    for(i=0;i<rows.length;i++){
      v=at(t,rows[i],ci);v=(v==null||v==="")?"Unset":String(v);
      if(!by[v]){by[v]=[];order.push(v)}
      by[v].push(rows[i]);
    }
    order.sort();
    var out='<div class="m-board">';
    for(i=0;i<order.length;i++){
      var lane=by[order[i]],cards="",k;
      for(k=0;k<lane.length&&k<12;k++){
        var id=at(t,lane[k],0);
        cards+='<button class="m-board-card" onclick="'+act(href(sc.slug,id))+'">'
          +'<div class="m-cell-main">'+mEsc(nameOf(t,lane[k]))+"</div>"
          +'<div class="m-cell-sub">'+mEsc(id)+"</div></button>";
      }
      if(lane.length>12)cards+='<div class="m-board-more">+'+(lane.length-12)+" more</div>";
      out+='<div class="m-board-col"><div class="m-board-h"><span>'+mEsc(order[i])+'</span><span class="m-badge">'+lane.length+"</span></div>"+cards+"</div>";
    }
    return out+"</div>";
  }
  function renderList(sc){
    var t=D[sc.entity],spec=sc.list,s=st(sc.slug);
    if(!t||!live(t).length){fill(spec.region,'<div class="m-card">'+empty(spec.emptyTitle,spec.cite)+"</div>");return}
    var all=live(t),rows=rowsFor(sc),i,r;
    if(!rows.length){
      fill(spec.region,'<div class="m-card"><div class="m-empty"><div class="m-empty-t">No '+mEsc(sc.entity)+" matches "+Q+mEsc(s.q)+Q+'</div>'
        +'<div class="m-assumed">'+all.length+" record"+(all.length===1?"":"s")+' in this build. '
        +'<button class="m-btn m-btn--secondary m-btn--sm" onclick="setFilter('+Q+sc.slug+Q+","+Q+Q+')">Clear filter</button></div></div></div>');
      return;
    }
    if(s.view==="board"&&spec.status>=0){fill(spec.region,board(sc,rows));return}
    if(s.page*PAGE>=rows.length)s.page=0;
    var start=s.page*PAGE,end=start+PAGE;if(end>rows.length)end=rows.length;
    var flagged={};for(i=0;i<t.f.length;i++)flagged[t.f[i]]=1;
    var body="";
    for(r=start;r<end;r++)body+="<tr"+(flagged[rows[r]]?' class="is-flagged"':"")+">"+cells(t,spec,rows[r],sc.slug,true)+"</tr>";
    fill(spec.region,'<div class="m-table-wrap"><table class="m-table"><thead><tr>'+heads(spec,sc.slug)
      +'<th style="text-align:right">Actions</th></tr></thead><tbody>'+body+"</tbody></table>"
      +'<div class="m-pagination"><span>'+(start+1)+"–"+end+" of "+rows.length
      +(rows.length===all.length?"":" (filtered from "+all.length+")")+'</span><span style="display:flex;gap:8px">'
      +'<button class="m-btn m-btn--secondary" onclick="pageBy('+Q+sc.slug+Q+',-1)"'+(s.page<=0?" disabled":"")+">Prev</button>"
      +'<button class="m-btn m-btn--secondary" onclick="pageBy('+Q+sc.slug+Q+',1)"'+(end>=rows.length?" disabled":"")+">Next</button></span></div></div>");
  }
  // THE PARENT LINK GOES TO THE PARENT RECORD. It used to name the parent
  // ENTITY and open whichever record that entity showcases, which on any row
  // but one is a link to the wrong record.
  function renderNav(nv,t,sri){
    var pt=D[nv.entity];if(!pt){fill(nv.region,"");return}
    var pid=at(t,sri,nv.fk),pri=pid==null?-1:rowOf(pt,pid);
    var k='<span class="m-linkcard-k">'+mEsc(nv.entity)+"</span>";
    // WHERE THIS RECORD NAMES NO PARENT, the card says so and still goes
    // somewhere true: the parent entity's own list. It used to render a button
    // labelled "—" that opened whichever record that entity showcases — a
    // control that both stated nothing and went to the wrong place. A
    // many-to-many reaches here by construction (neither side owns a key), so
    // this is not an edge case.
    if(pri<0){
      if(!nv.listed){fill(nv.region,'<div class="m-linkcard is-flat">'+k
        +'<span class="m-linkcard-v">— none named</span></div>');return}
      fill(nv.region,'<button class="m-linkcard" onclick="go('+Q+"#"+nv.slug+Q+')">'+k
        +'<span class="m-linkcard-v">— none named; browse '+mEsc(nv.entity)+'</span><span class="m-linkcard-go">→</span></button>');
      return;
    }

    fill(nv.region,'<button class="m-linkcard" onclick="'+act(href(nv.slug,at(pt,pri,0)))+'">'+k
      +'<span class="m-linkcard-v">'+mEsc(nameOf(pt,pri))+'</span><span class="m-linkcard-go">→</span></button>');
  }
  function renderKid(kd,recId){
    var t=D[kd.entity];if(!t){fill(kd.region,"");return}
    var all=[],ix=live(t),i,r;
    if(kd.multi){
      var linked={},ls=L[kd.junction]||[];
      for(i=0;i<ls.length;i++)if(ls[i][0]===recId)linked[ls[i][1]]=1;
      for(r=0;r<ix.length;r++)if(linked[String(at(t,ix[r],0))])all.push(ix[r]);
    }else if(kd.fk>=0){
      for(r=0;r<ix.length;r++)if(String(at(t,ix[r],kd.fk))===recId)all.push(ix[r]);
    }
    var shown=all.slice(0,5),inner;
    var head='<div class="m-card-h"><div class="m-card-t">'+mEsc(kd.entity)+"</div>"
      +(kd.provisional?'<span class="m-prov" title="Not confirmed yet — drawn from the industry standard">to confirm</span>':"")
      +'<span class="m-badge">'+all.length+"</span></div>";
    if(kd.multi){
      if(shown.length){
        var chips="";
        for(i=0;i<shown.length;i++)
          chips+='<button class="m-chip" onclick="'+act(href(kd.slug,at(t,shown[i],0)))+'">'+mEsc(nameOf(t,shown[i]))+"</button>";
        inner='<div class="m-chips">'+chips+"</div>";
      }else inner=empty(kd.emptyTitle,kd.cite);
    }else if(shown.length){
      var body="";for(i=0;i<shown.length;i++)body+="<tr>"+cells(t,kd,shown[i],kd.slug,false)+"</tr>";
      inner='<div class="m-table-wrap"><table class="m-table"><thead><tr>'+heads(kd,"")+"</tr></thead><tbody>"+body+"</tbody></table></div>"
        +(all.length>shown.length&&kd.listed
          ?'<div class="m-card-f"><button class="m-btn m-btn--secondary m-btn--sm" onclick="go('+Q+"#"+kd.slug+Q+')">View all '+all.length+" →</button></div>"
          :"");
    }else inner=empty(kd.emptyTitle,kd.cite);
    fill(kd.region,'<section class="m-card" style="margin-top:16px">'+head+inner+"</section>");
  }
  /*PERSONA-RENDERER*/
  /*WIDGET-RENDERER*/
  /** WHICH RECORD THIS DETAIL IS SHOWING: the one the URL named, else the
   *  entity's showcase, else whatever is still there after a delete. */
  function detailRow(sc){
    var t=D[sc.entity],ix=live(t),s=st(sc.slug);
    if(s.rec>=0&&ix.indexOf(s.rec)>=0)return s.rec;
    var d=sc.detail?sc.detail.summary.row:-1;
    if(d>=0&&ix.indexOf(d)>=0)return d;
    return ix.length?ix[0]:-1;
  }
  function renderDetail(sc){
    var d=sc.detail;if(!d)return;
    var t=D[sc.entity];if(!t)return;
    var ri=detailRow(sc);if(ri<0)return;
    st(sc.slug).rec=ri;
    var dl="",i;
    for(i=0;i<d.summary.ix.length;i++)
      dl+="<div><dt>"+mEsc(d.summary.head[i])+"</dt><dd>"+mCell(R,d.summary.role[i],at(t,ri,d.summary.ix[i]))+"</dd></div>";
    fill(d.summary.region,'<section class="m-card"><div class="m-card-t" style="margin-bottom:14px">Details</div><dl class="m-dl">'+dl+"</dl></section>");
    // The heading names the record on screen. It was baked once, from the
    // showcase record, so every other record wore somebody else's name.
    var nm=nameOf(t,ri),h1=document.querySelector('[data-headline="'+sc.slug+'"]'),cr=document.querySelector('[data-crumb="'+sc.slug+'"]');
    if(h1)h1.textContent=nm;
    if(cr)cr.textContent=nm;
    for(i=0;i<d.navs.length;i++)renderNav(d.navs[i],t,ri);
    for(i=0;i<d.kids.length;i++)renderKid(d.kids[i],String(at(t,ri,0)));
  }
  // ── the form: a record in, a record out ────────────────────────────────────
  function formHost(sl){return document.querySelector('[data-form="'+sl+'"]')}
  // The parent a picker is showing, by ID: its key where the row has one, else
  // the stored name resolved back to the record that bears it.
  function pickerVal(c,t,ri){
    var pt=D[c.getAttribute("data-fk")],fc=c.getAttribute("data-fkc"),v;
    if(!pt)return "";
    if(fc){v=at(t,ri,t.cols.indexOf(fc));return v==null?"":String(v)}
    v=at(t,ri,t.cols.indexOf(c.getAttribute("data-f")));
    if(v==null||v==="")return "";
    var ix=live(pt),k;
    for(k=0;k<ix.length;k++)if(String(at(pt,ix[k],0))===String(v)||nameOf(pt,ix[k])===String(v))return String(at(pt,ix[k],0));
    return "";
  }
  function renderForm(sc,ri){
    var sl=sc.slug,t=D[sc.entity],host=formHost(sl);
    FORM[sl]=ri;
    if(!host)return;
    var ctrls=host.querySelectorAll("[data-f]"),i;
    for(i=0;i<ctrls.length;i++){
      var c=ctrls[i],ci=t?t.cols.indexOf(c.getAttribute("data-f")):-1;
      if(c.getAttribute("data-fk")){c.value=ri>=0&&t?pickerVal(c,t,ri):"";continue}
      var v=ri>=0&&t?at(t,ri,ci):null;
      if(c.type==="checkbox")c.checked=!!v;else c.value=v==null?"":String(v);
    }
    var ttl=document.querySelector('[data-form-title="'+sl+'"]'),cb=document.querySelector('[data-form-crumb="'+sl+'"]');
    var nm=ri>=0&&t?nameOf(t,ri):"";
    if(ttl)ttl.textContent=ri>=0?"Edit "+nm:"New "+sc.entity;
    if(cb)cb.textContent=ri>=0?nm:"New";
  }
  function addRow(t,sc,vals){
    if(!t.add)t.add=[];
    var row=[],ci;
    for(ci=0;ci<t.cols.length;ci++){var k=t.cols[ci];row[ci]=Object.prototype.hasOwnProperty.call(vals,k)?vals[k]:null}
    var ri=t.n+t.add.length;
    row[0]=sc.slug+"-new-"+(t.add.length+1);
    if(t.t>=0&&!row[t.t])row[t.t]="New "+sc.entity;
    if(t.d>=0&&!row[t.d])row[t.d]=(t.t>=0?row[t.t]:null)||("New "+sc.entity);
    t.add.push(row);
    live(t).unshift(ri);   // at the top, so the row a person just saved is one they can see
    return ri;
  }
  function saveRec(sl){
    var sc=SC[sl];if(!sc)return;
    var t=D[sc.entity],host=formHost(sl);if(!t||!host)return;
    var ctrls=host.querySelectorAll("[data-f]"),vals={},i;
    // A picker writes BOTH halves of the relation: the name a person reads,
    // then the join key the application reads.
    for(i=0;i<ctrls.length;i++){
      var c=ctrls[i],f=c.getAttribute("data-f"),pk=c.getAttribute("data-fk"),fc=c.getAttribute("data-fkc");
      if(c.type==="checkbox"){vals[f]=!!c.checked;continue}
      if(pk){
        var pt=D[pk],pri=(pt&&c.value)?rowOf(pt,c.value):-1;
        vals[f]=pri>=0?nameOf(pt,pri):"";
        if(fc)vals[fc]=pri>=0?String(at(pt,pri,0)):null;
        continue;
      }
      vals[f]=c.value;
    }
    var ri=FORM[sl];if(ri==null)ri=-1;
    if(ri>=0){for(var k in vals)if(Object.prototype.hasOwnProperty.call(vals,k))setAt(t,ri,t.cols.indexOf(k),vals[k])}
    else ri=addRow(t,sc,vals);
    FORM[sl]=-1;
    st(sl).q="";st(sl).page=0;st(sl).rec=ri;
    var inp=document.querySelector('[data-search="'+sl+'"]');if(inp)inp.value="";
    renderAll();
    go("#"+sl);   // Save returns to the list, which is where the new row is
  }
  function editRec(sl){
    var sc=SC[sl];if(!sc)return;
    var t=D[sc.entity];if(!t)return;
    var ri=detailRow(sc);if(ri<0)return;
    go(href(sl,at(t,ri,0))+"/edit");
  }
  /*ACTION-RENDERER*/
  function delRec(sl){
    var sc=SC[sl];if(!sc)return;
    var t=D[sc.entity];if(!t)return;
    var ri=detailRow(sc),ix=live(t),k=ix.indexOf(ri);
    if(k<0)return;
    UNDO={t:t,row:ri,at:k,slug:sl,name:nameOf(t,ri)};
    ix.splice(k,1);
    st(sl).rec=-1;
    renderAll();
    toast("Deleted "+UNDO.name);
    go("#"+sl);
  }
  function undoDel(){
    if(!UNDO)return;
    var u=UNDO;UNDO=null;
    live(u.t).splice(u.at,0,u.row);
    st(u.slug).rec=u.row;
    hideToast();
    renderAll();
    go(href(u.slug,at(u.t,u.row,0)));
  }
  // u defaults TRUE; false where there is nothing to undo.
  function toast(msg,u){
    var el2=document.getElementById("m-toast");
    if(!el2){el2=document.createElement("div");el2.id="m-toast";el2.className="m-toast";document.body.appendChild(el2)}
    el2.innerHTML=mEsc(msg)+(u===undefined||u
      ?' <button class="m-btn m-btn--sm" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.4)" onclick="undoDel()">Undo</button>'
      :"");
    el2.hidden=false;
  }
  function hideToast(){var el2=document.getElementById("m-toast");if(el2)el2.hidden=true}
  // ── the pickers: a relation-typed field is a choice, not free text ─────────
  function fillPickers(){
    var sels=document.querySelectorAll("select[data-fk]"),i,r;
    for(i=0;i<sels.length;i++){
      var s2=sels[i],t=D[s2.getAttribute("data-fk")],keep=s2.value;
      var out='<option value="">— none —</option>';
      if(t){var ix=live(t);for(r=0;r<ix.length&&r<200;r++)out+='<option value="'+mEsc(at(t,ix[r],0))+'">'+mEsc(nameOf(t,ix[r]))+"</option>"}
      s2.innerHTML=out;
      if(keep)s2.value=keep;
    }
    // A status field offers the values the data actually holds, rather than a
    // vocabulary invented in the template.
    var vs=document.querySelectorAll("select[data-vals]");
    for(i=0;i<vs.length;i++){
      var s3=vs[i],host=s3.closest?s3.closest("[data-form]"):null,sc=host?SC[host.getAttribute("data-form")]:null;
      var t3=sc?D[sc.entity]:null,ci=t3?t3.cols.indexOf(s3.getAttribute("data-f")):-1,seen={},vals=[];
      if(t3&&ci>=0){
        var ix3=live(t3);
        for(r=0;r<ix3.length;r++){var v=at(t3,ix3[r],ci);if(v==null||v==="")continue;v=String(v);if(!seen[v]){seen[v]=1;vals.push(v)}}
      }
      vals.sort();
      var keep3=s3.value,out3='<option value="">— none —</option>';
      for(r=0;r<vals.length&&r<40;r++)out3+='<option value="'+mEsc(vals[r])+'">'+mEsc(vals[r])+"</option>";
      s3.innerHTML=out3;
      if(keep3)s3.value=keep3;
    }
  }
  function renderAll(){
    for(var k=0;k<SCREENS.length;k++){renderList(SCREENS[k]);renderDetail(SCREENS[k])}
    // The summary bands, where a screen spec asked for any. Drawn from the same
    // live rows as the table under them, so the two cannot disagree; absent
    // entirely — segment and all — when no spec was accepted.
    if(typeof renderWidgets==="function")renderWidgets();
    // Same live rows as every other region; both arrays are EMPTY unless the
    // persona segment shipped.
    for(k=0;k<WORK.length;k++)if(WORK[k].queues.length)renderWorkbench(WORK[k]);
    if(APPR.length)renderApprovals();
    fillPickers();
  }
  // ── routing: the URL names the screen AND the record ──────────────────────
  function setFilter(sl,v){
    var s=st(sl);s.q=v;s.page=0;
    var inp=document.querySelector('[data-search="'+sl+'"]');
    if(inp&&inp.value!==v)inp.value=v;
    renderList(SC[sl]);
  }
  function setView(sl,v){
    var s=st(sl);s.view=v;s.page=0;
    var tabs=document.querySelectorAll('[data-view="'+sl+'"] .m-tab');
    for(var k=0;k<tabs.length;k++)tabs[k].className="m-tab"+(tabs[k].getAttribute("data-v")===v?" is-active":"");
    renderList(SC[sl]);
  }
  function pageBy(sl,d){var s=st(sl);s.page=s.page+d;if(s.page<0)s.page=0;renderList(SC[sl])}
  function sortBy(sl,k){
    var sc=SC[sl],s=st(sl),ci=sc.list.ix[k];
    if(ci==null||ci<0)return;
    if(s.sort===ci)s.dir=-s.dir;else{s.sort=ci;s.dir=1}
    s.page=0;renderList(sc);
  }
  function go(h){HASH=h;try{if(location.hash!==h)location.hash=h}catch(e){}route()}
  function route(){
    var h="";
    try{h=location.hash||""}catch(e){h=""}
    if(!h)h=HASH;
    // An address that names nothing lands where the app opens — a person's
    // workbench when the atlas gave one, else the lead entity's list.
    if(!h.replace(/^#/,"")&&HOMEW)h="#"+HOMEW;
    var parts=h.replace(/^#/,"").split("/");
    if(parts[0]===WBR&&WB[parts[1]]){if(WB[parts[1]].queues.length)renderWorkbench(WB[parts[1]]);show("work-"+parts[1]);return}
    if(parts[0]===APR&&APPR.length){renderApprovals();show("approvals");return}
    var sl=parts[0]&&SC[parts[0]]?parts[0]:HOME,sc=SC[sl];
    if(!sc)return;
    if(parts[1]==="new"){renderForm(sc,-1);show("form-"+sl);return}
    if(parts[1]){
      var t=D[sc.entity],ri=t?rowOf(t,decodeURIComponent(parts[1])):-1;
      if(ri>=0){
        if(parts[2]==="edit"){renderForm(sc,ri);show("form-"+sl);return}
        st(sl).rec=ri;renderDetail(sc);show("detail-"+sl);return;
      }
    }
    renderList(sc);show("list-"+sl);
  }
  window.go=go;window.setFilter=setFilter;window.setView=setView;window.pageBy=pageBy;window.sortBy=sortBy;
  window.saveRec=saveRec;window.editRec=editRec;window.delRec=delRec;window.undoDel=undoDel;
  try{window.addEventListener("hashchange",function(){HASH=location.hash;route()})}catch(e){}
  renderAll();
  route();
})();`;

/**
 * THE PERSONA AND AGENT RENDERER — shipped only where there is something for it
 * to draw.
 *
 * It draws the workbench queues and the approval queues, and it is appended to
 * the renderer above ONLY when the build actually has one: an atlas with no
 * entities on its steps produces no queue, a programme with no blueprint
 * produces no approvals, and neither should pay 6KB for a renderer that would
 * loop over an empty array. The base renderer's own calls are already guarded
 * by those arrays being empty, so this is an omission the document cannot
 * notice — the same rule as a board toggle on an entity with no status.
 */
const PERSONA_RENDERER = `
  // ── THE WORKBENCH: one person's work, not one table's rows ────────────────
  //
  // The atlas states who owns each workflow and which entities its steps touch,
  // and the application built from it had no screen that belonged to a person —
  // only one list and one detail per entity. So each role gets its queue: the
  // records of the entities its own workflows name, headed the way that
  // entity's list screen heads it, with its status values counted beside it.
  // Nothing here is invented: the role, the workflows and the entities are the
  // atlas's, and the rows are the same seed every other screen reads.
  function lanes(t,ci,rows){
    if(ci<0)return "";
    var by={},order=[],i,v;
    for(i=0;i<rows.length;i++){v=at(t,rows[i],ci);v=(v==null||v==="")?"Unset":String(v);if(by[v]===undefined){by[v]=0;order.push(v)}by[v]++}
    order.sort();
    var out="";
    for(i=0;i<order.length;i++)out+='<span class="m-badge">'+mEsc(order[i])+" · "+by[order[i]]+"</span>";
    return out?'<span class="m-lanes">'+out+"</span>":"";
  }
  // The lane counts describe the WHOLE queue and sit under the rows they
  // summarise, not between the heading and the table: a strip of counts
  // immediately above a table reads as that table's heading — to a person and
  // to the render gate alike — and a five-row page under a heading saying 52 is
  // the header/rows contradiction the gate exists to catch. The same reason the
  // footer says "View all": the page states that it is a page.
  function renderQueue(qs){
    var t=D[qs.entity];if(!t){fill(qs.region,"");return}
    var ix=live(t),shown=ix.slice(0,5),body="",i;
    for(i=0;i<shown.length;i++)body+="<tr>"+cells(t,qs,shown[i],qs.slug,true)+"</tr>";
    var inner=shown.length
      ?'<div class="m-table-wrap"><table class="m-table"><thead><tr>'+heads(qs,"")+'<th style="text-align:right">Actions</th></tr></thead><tbody>'
        +body+"</tbody></table></div>"
        +'<div class="m-card-f"><span style="margin-right:auto">'+lanes(t,qs.status,ix)+"</span>"
        +'<button class="m-btn m-btn--secondary m-btn--sm" onclick="go('+Q+"#"+qs.slug+Q+')">View all '+ix.length+" →</button></div>"
      :empty(qs.emptyTitle,qs.cite);
    fill(qs.region,'<section class="m-card" style="margin-top:16px">'
      +'<div class="m-card-h"><div class="m-card-t">'+mEsc(qs.entity)+'</div><span class="m-badge">'+ix.length+"</span></div>"
      +inner+"</section>");
  }
  function renderWorkbench(wb){for(var i=0;i<wb.queues.length;i++)renderQueue(wb.queues[i])}
  // ── THE APPROVAL QUEUE: where a gated agent stops ─────────────────────────
  //
  // The blueprint says which agents a human has to clear before they act. The
  // prototype used to say nothing at all, so the one screen that makes an
  // agentic system different from a system did not exist. The rows are real
  // seeded records of the entity the agent writes; the decision is this
  // session's and says so.
  var DECIDED={};
  function decide(k,id,ok){
    DECIDED[k+"|"+decodeURIComponent(id)]=ok?1:2;
    renderApprovals();
    toast((ok?"Approved ":"Sent back ")+decodeURIComponent(id),0);
  }
  function renderApproval(ap){
    var t=D[ap.entity];if(!t){fill(ap.region,"");return}
    var ix=live(t),body="",waiting=0,done=0,i,id,enc;
    for(i=0;i<ix.length;i++){
      id=String(at(t,ix[i],0));
      if(DECIDED[ap.key+"|"+id]){done++;continue}
      waiting++;
      if(waiting>5)continue;
      enc=encodeURIComponent(id).replace(/'/g,"%27");
      body+="<tr>"+cells(t,ap,ix[i],ap.slug,false)
        +'<td class="m-row-actions">'
        +'<button class="m-btn m-btn--secondary m-btn--sm" onclick="decide('+Q+ap.key+Q+","+Q+enc+Q+',0)">Send back</button>'
        +'<button class="m-btn m-btn--primary m-btn--sm" onclick="decide('+Q+ap.key+Q+","+Q+enc+Q+',1)">Approve</button></td></tr>';
    }
    var inner=body
      ?'<div class="m-table-wrap"><table class="m-table"><thead><tr>'+heads(ap,"")+'<th style="text-align:right">Decision</th></tr></thead><tbody>'
        +body+"</tbody></table></div>"
      :'<div class="m-empty"><div class="m-empty-t">Nothing waiting on you</div><div class="m-assumed">'
        +'<span class="m-assumed-k">This session</span> every '+mEsc(ap.entity)+" this queue held has been decided.</div></div>";
    fill(ap.region,inner+'<div class="m-card-f"><span class="m-cell-sub">'+waiting+" awaiting · "+done+" decided this session</span></div>");
  }
  function renderApprovals(){for(var i=0;i<APPR.length;i++)renderApproval(APPR[i])}
  window.decide=decide;
`;

/** The renderer for one build: the base, plus the persona/agent segment when
 *  that build has queues to draw and the widget segment when a screen spec was
 *  accepted. A function replacer, never a pattern one — the segments are code
 *  and `$&` inside them must stay `$&`. */
/**
 * A DESIGNED VERB, PERFORMED — emitted only for a build that carries one.
 *
 * The button was drawn only where the assembly could ground it (see
 * `experienceActions.ts`), so every branch does the thing its label says: "set"
 * writes a state the record's own attribute holds, "create" opens the form for
 * the record the verb names, "assign" opens this record's form at the field
 * being assigned.
 *
 * It rides the same optional-slot mechanism as the persona and widget
 * renderers, and for the same reason: this is a FIXED COST on every document
 * otherwise, and the refine budget is paid for rather than budgeted for (see
 * DOCUMENT_REFINE_BUDGET). A build whose design authored no verb this ontology
 * could carry serialises byte-for-byte as it did before verbs existed.
 */
const ACTION_RENDERER = `  function doAct(sl,ix){
    var list=(M.acts||{})[sl];if(!list)return;
    var a=list[ix];if(!a)return;
    if(a.kind==="create"){go("#"+a.target+"/new");return}
    var sc=SC[sl];if(!sc)return;
    var t=D[sc.entity];if(!t)return;
    var ri=detailRow(sc);if(ri<0)return;
    if(a.kind==="assign"){go(href(sl,at(t,ri,0))+"/edit");return}
    if(a.col<0)return;
    if(String(at(t,ri,a.col))===a.value){toast(nameOf(t,ri)+" is already "+a.value,false);return}
    setAt(t,ri,a.col,a.value);
    renderAll();
    toast(a.label+" \u2014 "+nameOf(t,ri)+" is now "+a.value,false);
  }
  window.doAct=doAct;
`;

function rendererFor(persona: boolean, widgets: boolean, acts: boolean): string {
  return PROTOTYPE_RENDERER
    .replace("/*PERSONA-RENDERER*/", () => (persona ? PERSONA_RENDERER : ""))
    .replace("/*WIDGET-RENDERER*/", () => (widgets ? WIDGET_RENDERER : ""))
    .replace("/*ACTION-RENDERER*/", () => (acts ? ACTION_RENDERER : ""));
}

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

/**
 * THE CLIENT'S PALETTE, READ OFF THE EXPERIENCE DESIGN — the one definition,
 * reached from every surface that assembles or exports a prototype.
 *
 * Meridian has been tokenised since it was written (`--m-brand`, `--m-accent`,
 * …) and the Experience Design studio has always stored a governed `theme` —
 * and the assembler called `meridianStylesheet()` with no argument, so every
 * build shipped the house indigo and the palette reached only the ZIP export's
 * `design-tokens.json`. A demo that could have landed as the client's product
 * landed as ours, and the input that would have changed that was already on the
 * record.
 *
 * The reading lives beside `parentEntitiesFor` for the same reason: the
 * operator's studio, the stakeholder's link and the refine baseline must all
 * read the palette identically or they assemble three differently-skinned
 * applications. Keys are filtered to the governed surface — an unknown key
 * cannot become a custom property — and every VALUE is validated downstream by
 * `resolveTheme`, which keeps the house default for anything that does not fit
 * its slot.
 */
export function paletteFor(doc: unknown): Partial<PrototypeTheme> {
  const d = (typeof doc === "object" && doc !== null && !Array.isArray(doc)) ? doc as Record<string, unknown> : {};
  const raw = (typeof d.theme === "object" && d.theme !== null && !Array.isArray(d.theme)) ? d.theme as Record<string, unknown> : {};
  const out: Record<string, unknown> = {};
  // The governed surface, named once. `radius` is the only number.
  const KEYS = ["brand", "brandSoft", "accent", "ink", "inkSoft", "muted", "bg", "surface", "surface2",
    "line", "positive", "warn", "danger", "radius", "fontSans", "fontDisplay"] as const;
  for (const k of KEYS) {
    const v = raw[k];
    if (k === "radius") { if (typeof v === "number") out[k] = v; continue; }
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out as Partial<PrototypeTheme>;
}

/**
 * ── WHAT A SCREEN LEADS WITH — the operator's second authored input ──────────
 *
 * `parentEntities` answers WHICH entities get a screen. It says nothing about
 * what those screens lead with, and the three questions a delivery team asks
 * next are exactly three the assembler already decides for itself and never
 * asked about: which columns head this entity's list, which of its related
 * collections stand open on the detail, and — where the entity declares a
 * status — whether the list opens on the board rather than the table.
 *
 * Same shape as `parentEntities`, for the same reason: ONE authored input on the
 * Experience Design document, everything else derived, and an ABSENT input
 * assembles byte-for-byte the application it assembled before. An entry naming
 * an attribute, a relation or a view this ontology cannot support is dropped
 * (`resolveScreenOptions`) — a stale document must not mint a column that does
 * not exist — and the studio offers only what `screenFactsFor` says the
 * ontology can honour, so nothing is offered that the assembler will ignore.
 */
export interface EntityScreenOptions {
  /** The columns that LEAD this entity's list, in the operator's order. Absent
   *  (or emptied of everything the ontology still holds) → the derived pick. */
  columns?: string[];
  /** The child collections that lead its detail page, in the operator's order.
   *  Never a filter: the ones not named still render, below, and the ones past
   *  the page's budget collapse into the "+N more" expander exactly as a
   *  derived tail does. Nothing is ever dropped from the document. */
  collections?: string[];
  /** Which view the list OPENS on. `board` is honoured only where the entity
   *  declares a status attribute — there is nothing to lane a board by
   *  without one, which is the same rule that decides whether the toggle is
   *  rendered at all. */
  view?: "table" | "board";
  /** What an EMPTY list of this entity says — the Experience Design's own
   *  `states.empty` copy for the screen that shows it. The designer already
   *  wrote the business-language line ("No leads or opportunities. Awaiting
   *  handoff from Marketing."); before this the assembler discarded it and
   *  every empty list read the generic "No X records yet". */
  emptyText?: string;
}

/**
 * WHAT A SCREEN CAN HOLD, before anyone chooses anything.
 *
 * Every budget in the assembly, stated once and exported, because the surface
 * that OFFERS the choice has to state the same number the assembler applies.
 * A studio that lets an operator pick seven columns for a table that shows five
 * is a control that lies, and the lie is undetectable from either side alone.
 */
export const SCREEN_BUDGET = {
  /** Columns leading an entity's own list screen. */
  listColumns: 5,
  /** Columns of that entity where it appears as a related collection — one
   *  fewer, because the card is narrower than the page. */
  relatedColumns: 4,
  /** Child sections standing OPEN on a detail page; the rest collapse. */
  openSections: 5,
} as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Trimmed, de-duplicated, empties dropped — the reading `parentEntitiesFor`
 *  gives the menu, applied to every authored name list. */
const authoredNames = (v: unknown): string[] => [...new Set(
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === "string" ? x : x == null ? "" : String(x)).trim())
    .filter(Boolean),
)];

/**
 * THE DESIGN'S METRIC BLOCKS, AS A SCREEN SPEC.
 *
 * A wireframe block of kind `metric` names an entity and the field it measures
 * — the same judgement a screen spec's `stat` widget records. Translating
 * rather than drawing keeps ONE validated path: the spec this returns is
 * checked against the schema derived from this ontology, so a metric naming a
 * field the entity does not hold is refused by name instead of rendered.
 *
 * The block's own `entity` decides which screen the number lands on (its list),
 * not the screen that happened to draw it: a metric about opportunities belongs
 * on the opportunities list wherever the designer put the tile. Returns null
 * when the design carries no usable metric, so the absent case stays absent.
 */
function metricSpecFrom(design: unknown, slugOf: Map<string, string>): { screens: Array<{ screen: string; widgets: Array<Record<string, unknown>> }> } | null {
  const d = isRecord(design) ? design : {};
  const byScreen = new Map<string, Array<Record<string, unknown>>>();
  for (const screen of (Array.isArray(d.screens) ? d.screens : []).filter(isRecord)) {
    for (const region of (Array.isArray(screen.wireframe) ? screen.wireframe : []).filter(isRecord)) {
      for (const block of (Array.isArray(region.blocks) ? region.blocks : []).filter(isRecord)) {
        if ((typeof block.kind === "string" ? block.kind.trim().toLowerCase() : "") !== "metric") continue;
        const entity = typeof block.entity === "string" ? block.entity.trim() : "";
        const slug = entity ? slugOf.get(entity) : undefined;
        if (!slug) continue;
        const target = `list-${slug}`;
        const widgets = byScreen.get(target) ?? [];
        // The first named field is the measure; a metric that names none is a
        // COUNT of the records, which is what a tile with no measure means.
        const measure = authoredNames(block.fields)[0];
        const widget: Record<string, unknown> = { kind: "stat", entity, ...(measure ? { measure } : {}) };
        if (!widgets.some((w) => w.entity === entity && w.measure === widget.measure)) widgets.push(widget);
        byScreen.set(target, widgets);
      }
    }
  }
  if (!byScreen.size) return null;
  return {
    screens: [...byScreen.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([screen, widgets]) => ({ screen, widgets })),
  };
}

/**
 * THE PER-ENTITY SCREEN OPTIONS, READ OFF THE EXPERIENCE DESIGN — the one
 * definition, reached from both runtimes, exactly as `parentEntitiesFor` and
 * `paletteFor` are. An option the document does not carry comes back absent,
 * and absent means "as it was derived".
 */
export function screenOptionsFor(doc: unknown): Record<string, EntityScreenOptions> {
  const d = isRecord(doc) ? doc : {};
  const raw = isRecord(d.screenOptions) ? d.screenOptions : {};
  const out: Record<string, EntityScreenOptions> = {};
  for (const [key, value] of Object.entries(raw)) {
    const entity = key.trim();
    if (!entity || !isRecord(value)) continue;
    const opt: EntityScreenOptions = {};
    const columns = authoredNames(value.columns);
    const collections = authoredNames(value.collections);
    if (columns.length) opt.columns = columns;
    if (collections.length) opt.collections = collections;
    // "table" IS the default, so it is stored as nothing — a document that
    // records the default would assemble the same bytes and diff differently.
    if (value.view === "board") opt.view = "board";
    // The designed (or authored) empty-state line survives re-normalisation:
    // assemblePrototype runs every caller's options back through this reader,
    // so a key this loop does not parse is a key the assembly never sees.
    const emptyText = typeof value.emptyText === "string" ? value.emptyText.trim() : "";
    if (emptyText && emptyText.length <= 160) opt.emptyText = emptyText;
    if (Object.keys(opt).length) out[entity] = opt;
  }
  // ── THE WIREFRAME IS A DESIGN DECISION, NOT DECORATION ────────────────────
  //
  // Every generated screen carries `wireframe` regions of blocks, and each
  // table/list block names an entity AND the fields it shows. That is exactly
  // the decision `columns` records — which fields lead this entity's table —
  // and the set of entity tables on one screen is exactly `collections`: which
  // related records that screen puts in front of a person, in the designer's
  // order. The assembler derived both from the ontology and threw the design's
  // answer away, so a designer could specify the screen and watch the build
  // ignore it.
  //
  // Read here, beside the empty states, because this is the ONE reader both
  // runtimes reach and because everything it emits is spent through the
  // existing per-entity validation: a column the entity does not hold and a
  // collection the fabric does not declare are dropped where they are applied,
  // exactly as an operator's own choices are. So the design can direct the
  // build and still cannot make it lie.
  //
  // OPERATOR-AUTHORED OPTIONS WIN: the loop above filled `out` from
  // `screenOptions`, and every write below is guarded on the key being absent.
  for (const screen of (Array.isArray(d.screens) ? d.screens : []).filter(isRecord)) {
    const states = isRecord(screen.states) ? screen.states : {};
    const line = typeof states.empty === "string" ? states.empty.trim() : "";
    const listed = authoredNames(screen.entities);
    const primary = listed[0];
    if (line && line.length <= 160 && primary && !out[primary]?.emptyText) {
      out[primary] = { ...out[primary], emptyText: line };
    }
    // The tabular blocks, in the order the design lays them out.
    const tables = (Array.isArray(screen.wireframe) ? screen.wireframe : [])
      .filter(isRecord)
      .flatMap((region) => (Array.isArray(region.blocks) ? region.blocks : []).filter(isRecord))
      .filter((b) => {
        const kind = typeof b.kind === "string" ? b.kind.trim().toLowerCase() : "";
        return kind === "table" || kind === "list";
      });
    for (const block of tables) {
      const entity = typeof block.entity === "string" ? block.entity.trim() : "";
      const fields = authoredNames(block.fields);
      // FIRST SCREEN TO SAY SO WINS, so a design that shows one entity on
      // several screens leads its table the same way on all of them — the
      // alternative is a table whose columns depend on which screen was
      // authored last.
      if (entity && fields.length && !out[entity]?.columns) {
        out[entity] = { ...out[entity], columns: fields };
      }
    }
    // …and which of them this screen puts BESIDE its primary record.
    const related = [...new Set(tables
      .map((b) => (typeof b.entity === "string" ? b.entity.trim() : ""))
      .filter((e) => !!e && e !== primary))];
    if (primary && related.length && !out[primary]?.collections) {
      out[primary] = { ...out[primary], collections: related };
    }
  }
  return out;
}

/**
 * THE DERIVED LEAD COLUMNS — what a table of this entity heads with when
 * nobody has chosen.
 *
 * Lead with the entity's TITLE attribute, not with whatever the ontology
 * happened to list first: a positional pick put a contact's buying role where
 * the contact's name belongs. When the ontology names no title attribute the
 * lead column is the record's DISPLAY NAME, headed with the entity itself.
 */
function derivedLeadColumns(attrs: readonly string[], roleOf: (a: string) => ValueRole | undefined, limit: number): string[] {
  const titleAttr = attrs.find((a) => roleOf(a) === "title");
  return (titleAttr ? [titleAttr, ...attrs.filter((a) => a !== titleAttr)] : ["_display", ...attrs]).slice(0, limit);
}

/**
 * THE ORDER A DETAIL PAGE'S CHILD SECTIONS STAND IN — the operator's named ones
 * first, in their order, then the derived weight.
 *
 * The derived weight is how much of the ontology hangs off each child
 * (`subtreeSize` — a child that owns half the model outranks a leaf), then
 * fan-in, then ontology order. Never array position, so the same ontology
 * always opens the same sections. Sorting is TOTAL and pure: the comparator
 * reads only the authored rank and the graph, so two runs cannot disagree.
 */
function orderChildSections<T>(
  items: readonly T[],
  childOf: (t: T) => string | undefined,
  graph: OntologyGraph,
  authored: readonly string[] = [],
): T[] {
  const weightOf = (t: T): [number, number, number] => {
    const cn = childOf(t);
    const g = cn ? graph.byName[cn] : undefined;
    return [-(g?.subtreeSize ?? 1), -(g?.fanIn ?? 0), cn ? graph.entities.indexOf(cn) : Number.MAX_SAFE_INTEGER];
  };
  const byWeight = [...items].sort((a, b) => {
    const [as, af, ai] = weightOf(a); const [bs, bf, bi] = weightOf(b);
    return as - bs || af - bf || ai - bi;
  });
  return authoredFirst(byWeight, childOf, authored);
}

/** THE ONE RULE for "the operator's named ones lead, the rest keep the derived
 *  order" — applied to fabric regions by the assembler and to entity names by
 *  the surface that says what will happen. A name nobody derived is not
 *  promoted: it is not there to promote. */
function authoredFirst<T>(ordered: readonly T[], keyOf: (t: T) => string | undefined, authored: readonly string[]): T[] {
  const rank = new Map(authored.map((n, i) => [n, i] as const));
  const named: T[] = [], rest: T[] = [];
  for (const t of ordered) (rank.has(keyOf(t) ?? "") ? named : rest).push(t);
  named.sort((a, b) => rank.get(keyOf(a) ?? "")! - rank.get(keyOf(b) ?? "")!);
  return [...named, ...rest];
}

/**
 * WHICH RELATED COLLECTIONS STAND OPEN ON A DETAIL PAGE, AND WHICH COLLAPSE —
 * the one definition, read by the assembler when it does it and by the studio
 * when it tells the operator what will happen.
 *
 * `collections` is the derived order (`EntityScreenFacts.collections`). Nothing
 * is ever dropped: past the budget a section collapses behind the "+N more"
 * expander, keeps its `data-fabric-id`, and stays addressable by a delta.
 */
export function openSectionPlan(
  collections: readonly string[],
  authored: readonly string[] = [],
): { open: string[]; collapsed: string[] } {
  const ordered = authoredFirst(collections, (c) => c, authored);
  return { open: ordered.slice(0, SCREEN_BUDGET.openSections), collapsed: ordered.slice(SCREEN_BUDGET.openSections) };
}

/**
 * WHAT THIS ONTOLOGY CAN HONOUR, per entity — the offer sheet the studio reads.
 *
 * Derived from the same fabric and the same roles the assembler builds from,
 * through the same two helpers, so the choice a surface offers and the choice
 * the assembler spends cannot describe different applications. Read it before
 * rendering a control: an entity whose `status` is null has no board to open
 * on, and an attribute not in `attributes` is not a column anything can lead
 * with.
 */
export interface EntityScreenFacts {
  entity: string;
  /** Every attribute the ontology holds for it — the columns a list can lead with. */
  attributes: string[];
  /** What the list heads with when nothing is authored. */
  columns: string[];
  /** The child collections its detail page carries, in the derived order — the
   *  first `SCREEN_BUDGET.openSections` of these stand open. */
  collections: string[];
  /** The attribute a board would lane by; null when the entity declares none,
   *  and then there is no board and no toggle. */
  status: string | null;
}

export function screenFactsFor(ontology: Record<string, unknown>, atlas: Record<string, unknown> = {}): EntityScreenFacts[] {
  const fabric = deriveFabric(ontology, atlas);
  const roles = deriveRoles(ontology);
  const roleOf = new Map<string, ValueRole>(roles.attributeRoles.map((r) => [`${r.entity} ${r.attribute}`, r.role] as const));
  const entities = (Array.isArray(ontology.entities) ? ontology.entities : []) as Array<Record<string, unknown>>;
  const out: EntityScreenFacts[] = [];
  for (const e of entities) {
    const name = String(e.name ?? "").trim();
    if (!name) continue;
    const attributes = (Array.isArray(e.attributes) ? e.attributes : [])
      .map((a) => (typeof a === "string" ? a : String((a as { name?: unknown })?.name ?? ""))).filter(Boolean);
    // The child regions this entity's detail carries, addressed by the RELATION
    // the fabric node declares rather than by its id's middle segment — the id
    // is a slug, and two entities whose names slug alike would otherwise trade
    // collections.
    const regions = fabric.nodes.filter((n) => n.kind === "region" && n.source.relation?.[0] === name);
    out.push({
      entity: name,
      attributes,
      columns: derivedLeadColumns(attributes, (a) => roleOf.get(`${name} ${a}`), SCREEN_BUDGET.listColumns),
      collections: orderChildSections(regions, (n) => n.source.relation?.[1], fabric.graph)
        .map((n) => n.source.relation![1]),
      status: attributes.find((a) => roleOf.get(`${name} ${a}`) === "status") ?? null,
    });
  }
  return out;
}

/**
 * The programme's stored inputs that are NOT the ontology or the atlas:
 *
 *   - `vocabulary` — the value vocabulary, a `{ "Entity.attribute": [values] }`
 *     artifact produced by a single model call per ontology change and consumed
 *     deterministically by the seeder (see `valueVocabulary.ts`). Passing it
 *     changes what the category and status columns SAY; omitting it changes
 *     nothing at all.
 *   - `theme` — the client's governed palette (see `paletteFor`). Omitting it
 *     ships the house default, exactly as before.
 *
 * Every one is OPTIONAL and absent means "as it was": the assembly is a pure
 * function of what it is given, so the same programme always assembles the same
 * bytes on every surface that reads these the same way.
 */
export interface AssemblyOptions {
  vocabulary?: unknown;
  theme?: Partial<PrototypeTheme> | null;
  /**
   * The agentic blueprint. Passing it puts the agents ON the records they act
   * on and gives the gated ones an approval queue; omitting it assembles
   * exactly the application it assembled before — the blueprint adds surfaces,
   * it never changes the ones derived from the ontology.
   */
  blueprint?: unknown;
  /**
   * The operator's per-entity screen options (see `screenOptionsFor`), threaded
   * the way `parentEntities` is: read once off the Experience Design document
   * by every surface that assembles, so the studio's preview, the stakeholder's
   * link and the refine baseline cannot describe different applications.
   * Omitting it assembles exactly what it assembled before.
   */
  screenOptions?: Record<string, EntityScreenOptions> | null;
  /**
   * A SCREEN SPEC — the model's judgement about what a screen deserves, as data
   * (see `prototypeScreenSpec.ts`). Validated here against a schema derived from
   * this ontology, and drawn by the deterministic renderer: an entity, attribute
   * or screen it names that this build does not hold is refused into
   * `specViolations` rather than rendered. Omitting it assembles exactly the
   * application it assembled before, byte for byte.
   */
  spec?: unknown;
  /**
   * What the application CALLS ITSELF — the document title and the sidebar
   * brand. The programme's own name (`projectMeta.name`), threaded from every
   * surface that knows it. The slot used to be hardcoded "Assembled" with a
   * title that read "assembled from ontology + atlas": the one line of chrome a
   * stakeholder reads on every screen named the pipeline, not their product.
   * Absent, the neutral "Prototype" — never the machinery.
   */
  appName?: string | null;
  /**
   * THE EXPERIENCE DESIGN DOCUMENT ITSELF — for the parts of it that cannot be
   * pre-digested into `screenOptions`. The verbs it authors (`primaryActions`,
   * and the state machines whose transitions name them) resolve against THIS
   * ontology, which only the assembly holds, so the document rides along and
   * `deriveScreenActions` grounds it here. Absent, the build carries the
   * Open/Edit/Delete/New vocabulary it always did — no verb is invented.
   */
  experienceDesign?: unknown;
}

export function assemblePrototype(ontology: Record<string, unknown>, atlas: Record<string, unknown>, parentEntities?: readonly string[], options: AssemblyOptions = {}): AssembledPrototype {
  const fabric = deriveFabric(ontology, atlas);
  const roles = deriveRoles(ontology);
  const seed = generateSeed(ontology, fabric.version, { vocabulary: options.vocabulary });
  const roleOf = new Map<string, ValueRole>(roles.attributeRoles.map((r) => [`${r.entity} ${r.attribute}`, r.role] as const));
  /** What a reference-typed attribute POINTS AT, as the ontology itself
   *  answered it (`deriveAttributeReferences`). The form's pickers are
   *  populated from this and from nothing else — a target guessed from the
   *  column name is the string-guess the join key already had to be rescued
   *  from. */
  const refOf = new Map<string, string | undefined>(roles.attributeRoles.map((r) => [`${r.entity} ${r.attribute}`, r.refEntity] as const));
  const entities = (Array.isArray(ontology.entities) ? ontology.entities : []) as Array<Record<string, unknown>>;
  const names = entities.map((e) => String(e.name ?? "")).filter(Boolean);
  const attrsOf = (name: string) => {
    const e = entities.find((x) => String(x.name) === name);
    return (Array.isArray(e?.attributes) ? e!.attributes : []).map((a) => (typeof a === "string" ? a : String((a as { name?: unknown })?.name ?? ""))).filter(Boolean);
  };
  // THE OPERATOR'S PER-ENTITY SCREEN OPTIONS, normalised through the same
  // reader both runtimes use — a raw object handed in by a caller is held to
  // exactly the shape the document is held to. Every one of the three is
  // validated where it is SPENT (against this entity's attributes, against the
  // child regions the fabric actually declares, against whether a status
  // exists), because that is the only place the answer is known.
  const screenOptions = screenOptionsFor({ screenOptions: options.screenOptions });
  const optionsFor = (name: string): EntityScreenOptions => screenOptions[name] ?? {};
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
  /**
   * A SCREEN CARRIES ITS OWN FABRIC ID, on the element that IS the screen.
   *
   * `deriveFabric` emits two `screen:` nodes per entity — `screen:{s}` for the
   * detail and `screen:{s}:list` for the list. The list one was addressable
   * because its table slot happens to be keyed by it; the detail one was
   * addressable nowhere, so on the snapshot build 33 of 66 screen nodes had no
   * element in the document at all. Nothing noticed: every fidelity assertion
   * in the suite filtered to `region`, `nav` and `field`, so an entire node
   * KIND could stop being rendered in silence — the exact failure mode the
   * fabric→DOM contract exists to stop.
   *
   * The attribute goes on the `<section>` rather than a wrapper: the section is
   * the screen, and a wrapper would put a second element between the router's
   * `.m-screen` and its container for no gain. It is counted like a region
   * because `regionCount` is the count of elements a delta can address, and
   * this element is now one of them.
   */
  const screenFid = (id: string) => { regionCount += 1; return ` data-fabric-id="${esc(id)}"`; };

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
   * The operator's choice, where they have made one, IS that definition: the
   * columns they named lead every table of this entity, for the same reason the
   * derived pick did. Names the ontology no longer holds are dropped rather
   * than minting a column with nothing behind it, and a choice left with
   * nothing standing falls back to the derived pick — an absent input is
   * exactly the build there was before, which is the `parentEntities` contract.
   */
  const leadColumnsFor = (name: string, limit: number, exclude?: string): string[] => {
    // `exclude` drops the attribute that points BACK at the context. Inside
    // Account's detail, an "Account Id" column on every Opportunity row is the
    // same value repeated down the table — it says only "these are this
    // account's", which the card's heading already said.
    const all = attrsOf(name).filter((a) => !exclude || a.toLowerCase() !== exclude.toLowerCase());
    const authored = (optionsFor(name).columns ?? []).filter((a) => all.includes(a));
    if (authored.length) return authored.slice(0, limit);
    return derivedLeadColumns(all, (a) => roleOf.get(`${name} ${a}`), limit);
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
  /** WHERE THIS ENTITY'S STATUS LIVES, -1 when it declares none — the one
   *  definition, read by the list screen's board toggle and by every persona
   *  queue that counts the lanes a role is working in. */
  const statusIndexOf = (name: string): number => {
    const attr = attrsOf(name).find((a) => roleOf.get(`${name} ${a}`) === "status");
    return attr ? columnIndex(name, attr) : -1;
  };
  const columnSpec = (name: string, cols: string[]): ColumnSpec => ({
    ix: cols.map((c) => columnIndex(name, c)),
    head: cols.map((c) => headFor(name, c)),
    role: cols.map((c) => roleCode(roleOf.get(`${name} ${c}`))),
  });

  // ── THE DESIGNED VERBS ────────────────────────────────────────────────────
  //
  // Experience Design authors what the business DOES with a record — "Convert
  // to Opportunity", "End Campaign", "Assign Sales Rep" — and every screen used
  // to offer the same Open / Edit / Delete / New regardless. The resolution is
  // `experienceActions.ts`: each authored verb is grounded against this
  // ontology or refused, so a control is drawn only where it can act. The
  // grounding needs two facts only the assembly holds — which entities this
  // build drew a screen for, and which attribute is person-shaped — so they are
  // supplied here rather than re-derived there.
  const derivedActions = deriveScreenActions(options.experienceDesign ?? null, ontology, {
    hasScreen: (entity: string) => ordered.includes(entity),
    isPersonAttr: (entity: string, attribute: string) => roleOf.get(`${entity} ${attribute}`) === "person-ref",
  });
  const actionsFor = (name: string): ScreenAction[] => derivedActions.byEntity[name] ?? [];
  /** The action list the RENDERER acts on, as data: index-addressed so the
   *  markup carries no values and the handler cannot be told a lie by a
   *  hand-edited attribute. */
  const actionSpecs: Record<string, Array<{ kind: string; label: string; col: number; value: string; target: string }>> = {};
  const registerActions = (name: string): void => {
    if (actionSpecs[name]) return;
    actionSpecs[name] = actionsFor(name).map((a) => ({
      kind: a.kind,
      label: a.label,
      col: a.kind === "set" && a.attribute ? columnIndex(name, a.attribute) : -1,
      value: a.value ?? "",
      target: a.target ? (es.get(a.target) ?? "") : "",
    }));
  };
  /** Verbs that act on ONE record — they belong beside Edit on the detail page. */
  const recordActionsFor = (name: string, s: string): string => {
    registerActions(name);
    return actionsFor(name).filter((a) => a.scope === "record").map((a, i) => {
      const ix = actionsFor(name).indexOf(a);
      return `<button class="m-btn m-btn--secondary" title="${esc(a.basis)}" onclick="doAct('${s}',${ix})"${i === 0 ? ' data-act-first="1"' : ""}>${esc(a.label)}</button>`;
    }).join("");
  };
  /** Verbs that need no record — they belong in the list's toolbar, beside New. */
  const listActionsFor = (name: string): string => {
    registerActions(name);
    const s = es.get(name)!;
    return actionsFor(name).filter((a) => a.scope === "list").map((a) => {
      const ix = actionsFor(name).indexOf(a);
      return `<button class="m-btn m-btn--secondary" title="${esc(a.basis)}" onclick="doAct('${s}',${ix})">${esc(a.label)}</button>`;
    }).join("");
  };

  // ── THE MODEL'S JUDGEMENT, AS DATA ────────────────────────────────────────
  //
  // What a screen deserves is a design question, and the deterministic path has
  // no way to answer it: it can say that Opportunity has a status, not that this
  // screen is the one a funnel of it belongs on. The free-form path answered it
  // by writing the HTML, and paid for it — cards positioned out of flow over the
  // tables, a heading that contradicted its own rows, entities that vanished
  // while `gaps` came back empty.
  //
  // So the answer arrives as a SPEC and the drawing stays here. The schema is
  // derived from this ontology and this build's screens, every reference in the
  // spec is resolved against it, and anything unresolved is refused by name into
  // `specViolations` — which the caller writes into the artifact's gaps, because
  // a miss the operator cannot see is the defect, not the miss.
  const specSchema = buildSpecSchema({
    version: fabric.version,
    entities: ordered.map((name) => ({
      entity: name,
      screen: `list-${es.get(name)}`,
      attributes: attrsOf(name).map((a) => ({ name: a, role: roleOf.get(`${name} ${a}`) })),
    })),
  });
  const specViolations: string[] = [];
  /**
   * THE DESIGN'S OWN METRICS, THROUGH THE SAME DOOR.
   *
   * A wireframe's `metric` blocks are the designer saying which number leads a
   * screen — the identical judgement a screen spec records, authored earlier
   * and by someone whose job it is. They become a spec here rather than a
   * second drawing path, so every reference is resolved against the SAME
   * schema and anything unresolvable is refused by name into `specViolations`:
   * the design can ask for a number, and still cannot invent a field.
   *
   * A CARRIED SPEC WINS. `options.spec` is what a previous round accepted (the
   * model's judgement, which the operator has seen); this fills only when there
   * is none, so the design seeds the first build and never overwrites a
   * decision already taken.
   */
  const designMetricSpec = options.spec != null ? null : metricSpecFrom(options.experienceDesign, es);
  const effectiveSpec = options.spec ?? designMetricSpec;
  const validSpec = effectiveSpec == null
    ? { screens: [], violations: [], accepted: 0 }
    : validatePrototypeSpec(effectiveSpec, specSchema, {
      // The seeded values are the second half of validation: a card headed with
      // a state no record holds is a label that reads as a finding.
      valuesOf: (entity, attribute) => [...new Set((seed.records[entity] ?? [])
        .map((r) => (r[attribute] == null ? "" : String(r[attribute]))).filter(Boolean))].sort(),
    });
  specViolations.push(...validSpec.violations);
  const widgetGroups = widgetGroupsFor(validSpec.screens, {
    columnIndex,
    roleCode: (entity, attribute) => roleCode(roleOf.get(`${entity} ${attribute}`)),
  }, specViolations);
  const widgetBands = (screen: string): string => widgetBandsHtml(screen, widgetGroups, esc);

  // ── THE ATLAS'S PEOPLE, AND THE BLUEPRINT'S AGENTS ────────────────────────
  //
  // Two documents the prototype was assembled beside and never read.
  //
  // The ATLAS names, per workflow, an owner and the entities each step touches:
  // a persona and its work surface, already written down. The assembler used it
  // for nothing but `flow:` fabric nodes that had no rendering at all, so the
  // application had no screen that belonged to a person — and the free-form
  // path's twelve fabricated dashboards were reaching for exactly this screen.
  //
  // The BLUEPRINT names, per agent, the entities it consumes and produces and
  // whether a human stands in its path. None of it reached the prototype, so a
  // client walked an application in which nothing was agentic and then read a
  // document in which everything was.
  //
  // Both are derived in their own pure modules and joined here, which is what
  // this file is for. Both are OPTIONAL: an atlas with no workflows produces no
  // workbenches and a programme with no blueprint produces no agent surfaces,
  // and in each case the rest of the application is byte-for-byte what it was.
  //
  // NEITHER EXISTS WITHOUT AN ONTOLOGY. An ontology with no entities is an
  // empty shell rather than a prototype — every caller treats a build with no
  // regions as "nothing to show yet" — and a workbench full of atlas prose over
  // an application with no records would turn that honest nothing into a page
  // that looks like something.
  const roleWorkbenches = names.length ? deriveWorkbenches(atlas) : [];
  const surface = names.length
    ? deriveAgenticSurface(options.blueprint, names)
    : { agents: [], unattributedGates: [] };
  /** A name written in the atlas or the blueprint → this ontology's entity, or
   *  null. ONE resolution, so a queue and an agent feed can never disagree
   *  about whether "Invoices" is `Invoice`. */
  const asEntity = entityNameResolver(names);
  /** …and whether this BUILD can show it. An entity outside the operator's
   *  curated menu has no list or detail screen, so a queue of it would offer
   *  rows that open nothing. Those are stated, not queued. */
  const hasScreen = (e: string | null): e is string => !!e && ordered.includes(e);
  /** A region the client fills that is NOT a fabric node — see the renderer's
   *  index. It carries no `data-fabric-id` precisely because the fabric never
   *  declared it: an invented id would corrupt the delta's address space. */
  const fillSlot = (id: string) => `<div data-region="${esc(id)}"></div>`;
  /**
   * A ROUTE WORD NO ENTITY OWNS. `#workbench/sales-operations` and `#approvals`
   * are addresses in the same space as `#account`, so an ontology holding an
   * entity called "Workbench" would lose its list screen to a persona. Reserved
   * by walking away from the collision rather than by hoping.
   */
  const reserveRoute = (base: string): string => {
    let word = base;
    for (let n = 2; names.some((x) => es.get(x) === word); n += 1) word = `${base}-${n}`;
    return word;
  };
  const WB_ROUTE = reserveRoute("workbench");
  const AP_ROUTE = reserveRoute("approvals");

  /**
   * WHERE AN AGENT TOUCHES A RECORD, THE RECORD SAYS SO.
   *
   * On the detail screen of every entity an agent reads or writes: what it is,
   * what it does, how much autonomy it has, and what gates it. `reads` and
   * `writes` are the blueprint's own inputs and outputs resolved against the
   * ontology, so this cannot name an entity the model merely mentioned.
   *
   * An agent that names an entity the ontology does not hold appears with that
   * miss printed on it rather than silently narrowed to the part that matched.
   */
  const agentBand = (name: string): string => {
    const acting = agentsOnEntity(surface, name);
    if (!acting.length) return "";
    const item = (a: SurfacedAgent): string => {
      const verbs = [a.reads.includes(name) ? "reads" : "", a.writes.includes(name) ? "writes" : ""].filter(Boolean);
      const risk = [a.autonomy && `autonomy: ${a.autonomy}`, a.blastRadius && `blast radius: ${a.blastRadius}`,
        a.reversibility && `${a.reversibility}`].filter(Boolean).join(" · ");
      const gate = a.gate
        ? `<div class="m-agent-gate"><span class="m-pill m-pill--warn"><span class="m-dot m-dot--warn"></span>${a.gate.source === "operator" ? "Gated by an operator decision" : "A human approves"}</span>`
          + `${a.gate.where ? ` <span class="m-cell-sub">${esc(a.gate.where)}</span>` : ""}`
          + `${apprSlugs.has(a.slug) ? ` <button class="m-btn m-btn--secondary m-btn--sm" onclick="go('#${AP_ROUTE}')">Approval queue →</button>` : ""}</div>`
        : `<div class="m-agent-gate"><span class="m-pill m-pill--risk"><span class="m-dot m-dot--risk"></span>No human gate stated</span></div>`;
      const miss = a.unmapped.length
        ? `<div class="m-assumed"><span class="m-assumed-k">Unmapped</span> this agent also names ${esc(a.unmapped.join(", "))}, which this ontology does not hold.`
          + `<span class="m-assumed-q">Is that a record the system must keep? To confirm with the team.</span></div>`
        : "";
      return `<li class="m-agent"><div class="m-agent-h"><span class="m-agent-n">${esc(a.name)}</span>`
        + verbs.map((v) => `<span class="m-badge">${v}</span>`).join("")
        + `${a.replaces ? `<span class="m-cell-sub">${esc(a.replaces)}</span>` : ""}</div>`
        + `${a.purpose ? `<div class="m-agent-p">${esc(a.purpose)}</div>` : ""}`
        + `${risk ? `<div class="m-cell-sub">${esc(risk)}</div>` : ""}${gate}${miss}</li>`;
    };
    return `<section class="m-card" style="margin-top:16px"><div class="m-card-h"><div class="m-card-t">Agent activity</div>`
      + `<span class="m-badge">${acting.length}</span></div>`
      + `<p class="m-cell-sub">Agents that work on ${esc(name)} records — and where a person stays in control.</p>`
      + `<ul class="m-agents">${acting.map(item).join("")}</ul></section>`;
  };

  /**
   * THE APPROVAL QUEUE — the screen that makes an agentic system different.
   *
   * One card per GATED agent: the gate the blueprint states, and the records it
   * would be holding. The rows are the same seeded records every other screen
   * reads, and the decision is this session's and says so — nothing here
   * pretends to be an audit trail.
   *
   * A gated agent whose entities this build has no screen for gets a card that
   * SAYS that, rather than an empty table that reads as "nothing pending".
   * Gates the blueprint states without naming an agent are listed too: a
   * decision with no owner on the diagram is a finding, not a blank.
   */
  const apprSpecs: ApprovalSpec[] = [];
  const apprSlugs = new Set<string>();
  const gated = gatedAgents(surface);
  const approvalsScreen = (): string => {
    if (!gated.length && !surface.unattributedGates.length) return "";
    const cards = gated.map((a) => {
      // The entity it WRITES is the one a human is being asked to sign off;
      // where it writes nothing this build can show, its first read stands in.
      const target = [...a.writes, ...a.reads].find(hasScreen) ?? null;
      const named = [...a.writes, ...a.reads, ...a.unmapped];
      const head = `<div class="m-card-h"><div class="m-card-t">${esc(a.name)}</div>`
        + `<span class="m-badge">${esc(a.gate?.mechanism || "approve")}</span></div>`
        + `${a.gate?.why ? `<p class="m-cell-sub">${esc(a.gate.why)}</p>` : ""}`
        + `${a.gate?.where ? `<p class="m-cell-sub">Gate — ${esc(a.gate.where)}</p>` : ""}`
        + `${a.gate?.source === "operator" ? `<p class="m-cell-sub">Added on the blueprint as an operator decision.</p>` : ""}`;
      if (!target) {
        return `<section class="m-card" style="margin-top:16px">${head}<div class="m-assumed">`
          + `<span class="m-assumed-k">No queue</span> this agent acts on ${named.length ? esc(named.join(", ")) : "nothing this ontology names"}`
          + `, which this build has no screen for — so there is nothing here to approve.`
          + `<span class="m-assumed-q">Should that record type be in the prototype? Confirm in Experience Design.</span></div></section>`;
      }
      apprSlugs.add(a.slug);
      apprSpecs.push({
        region: `approve:${a.slug}`,
        key: a.slug,
        entity: target,
        slug: es.get(target)!,
        ...columnSpec(target, leadColumnsFor(target, 3)),
      });
      return `<section class="m-card" style="margin-top:16px">${head}`
        + `<p class="m-cell-sub">Every ${esc(target)} this agent would act on, from the seeded records. Decisions are this session's.</p>`
        + `${fillSlot(`approve:${a.slug}`)}</section>`;
    }).join("");
    const orphans = surface.unattributedGates.length
      ? `<section class="m-card" style="margin-top:16px"><div class="m-card-h"><div class="m-card-t">Gates with no agent named</div>`
        + `<span class="m-badge">${surface.unattributedGates.length}</span></div><ul class="m-agents">`
        + surface.unattributedGates.map((g) => `<li class="m-agent"><div class="m-agent-h"><span class="m-agent-n">${esc(g.where || "A gated decision")}</span>`
          + `${g.mechanism ? `<span class="m-badge">${esc(g.mechanism)}</span>` : ""}</div>`
          + `${g.why ? `<div class="m-agent-p">${esc(g.why)}</div>` : ""}`
          + `<div class="m-assumed"><span class="m-assumed-k">Unattributed</span> the blueprint states this gate without naming the agent it sits on.`
          + `<span class="m-assumed-q">Which agent stops here? Confirm on the blueprint.</span></div></li>`).join("")
        + `</ul></section>`
      : "";
    return `<section class="m-screen" data-screen="approvals" hidden>
      <header class="m-page-h"><div><div class="m-eyebrow">Agents</div><h1 class="m-title">Approvals</h1>
      <p class="m-sub">${gated.length} agent${gated.length === 1 ? "" : "s"} in the blueprint cannot act until a person clears the work.</p></div></header>
      ${cards}${orphans}</section>`;
  };

  /**
   * A PERSONA'S WORKBENCH — the atlas's own role, with the work it owns.
   *
   * Its queues are the entities its workflows name, with the status values the
   * seeded records actually carry counted beside them; its workflows are the
   * atlas's steps, rendered on the `flow:` fabric node that stood for each one
   * and had no rendering until now.
   *
   * EVERY NAME THE ATLAS STATES SURVIVES. An entity a step names that the
   * ontology does not hold is printed as an unmodelled name with the question
   * that settles it. An entity the ontology holds but this build has no screen
   * for is printed as that. An actor who appears in a step without owning a
   * workflow is printed as a collaborator on the role that does. None of them
   * is quietly dropped, which is what a filtered list would have done.
   */
  const workSpecs: WorkbenchSpec[] = [];
  const flowNodes = fabric.nodes.filter((n) => n.kind === "flow");
  const flowIdFor = (w: AtlasWorkflow): string => {
    const node = flowNodes[w.index];
    return node && String(node.source.atlasWorkflow ?? "").trim() === w.name ? node.id : "";
  };
  const QUEUES_MAX = 4;
  const workbenchScreen = (r: AtlasRole): string => {
    const title = r.role || "Unattributed";
    const seen = new Set<string>();
    const queued: string[] = [];
    const offMenu: string[] = [];
    const unmodelled: string[] = [];
    for (const raw of r.entities) {
      const hit = asEntity(raw);
      if (!hit) { if (!unmodelled.includes(raw)) unmodelled.push(raw); continue; }
      if (seen.has(hit)) continue;
      seen.add(hit);
      (hasScreen(hit) ? queued : offMenu).push(hit);
    }
    const spec = { slug: r.slug, queues: [] as QueueSpec[] };
    const queues = queued.slice(0, QUEUES_MAX).map((entity) => {
      const region = `queue:${r.slug}:${es.get(entity)}`;
      spec.queues.push({
        region,
        entity,
        slug: es.get(entity)!,
        status: statusIndexOf(entity),
        ...columnSpec(entity, leadColumnsFor(entity, 4)),
        emptyTitle: optionsFor(entity).emptyText ?? `No ${entity} records yet`,
        cite: citeOf(assumptionFor(seedParentOf(entity), entity)),
      });
      return fillSlot(region);
    }).join("");
    workSpecs.push(spec);
    // THE THIRD EMITTER of a bare list address. An agent band names the records
    // it reads and writes, and each name was a control pointing at `#<entity>`
    // — the LIST. A reachable-only entity has only a detail (it is not in the
    // menu), so on a curated build these were 24 controls that changed the URL
    // and landed the viewer somewhere else. The flat variant already existed for
    // a chip with no entity behind it; an entity with no list screen is the same
    // case — the fact is worth stating, the navigation is not there to offer.
    const chip = (label: string, entity?: string) => entity && ordered.includes(entity)
      ? `<button class="m-chip" onclick="go('#${es.get(entity)}')">${esc(label)}</button>`
      : `<span class="m-chip m-chip--flat">${esc(label)}</span>`;
    const rest = queued.slice(QUEUES_MAX);
    const alsoQueued = rest.length
      ? `<p class="m-sub">Also this role's: ${rest.map((e) => chip(e, e)).join(" ")}</p>` : "";
    const notHere = offMenu.length
      ? `<div class="m-assumed"><span class="m-assumed-k">No screen</span> ${esc(offMenu.join(", "))} — in the ontology, but not in this build's menu, so there is no queue for ${offMenu.length === 1 ? "it" : "them"} here.`
        + `<span class="m-assumed-q">Should this role get ${offMenu.length === 1 ? "that screen" : "those screens"}? Confirm in Experience Design.</span></div>` : "";
    const notModelled = unmodelled.length
      ? `<div class="m-assumed"><span class="m-assumed-k">Not modelled</span> the atlas names ${esc(unmodelled.join(", "))} in this role's steps; the ontology holds no such entity.`
        + `<span class="m-assumed-q">${unmodelled.length === 1 ? "Is that a record" : "Are those records"} the system must keep? To confirm with the team.</span></div>` : "";
    const step = (s: { action: string; actor: string; system: string; entities: string[] }): string => {
      // The step's actor reads as a job title too, or the header says
      // "Marketing" while the step beneath it says "Marketing SME".
      const stepActor = businessRole(s.actor);
      const meta = [stepActor && stepActor !== r.role ? stepActor : "", s.system].filter(Boolean).join(" · ");
      const chips = s.entities.map((e) => { const hit = asEntity(e); return chip(hit ?? e, hasScreen(hit) ? hit : undefined); }).join(" ");
      return `<li class="m-step"><div class="m-step-a">${esc(s.action || "—")}</div>`
        + `${meta ? `<div class="m-cell-sub">${esc(meta)}</div>` : ""}`
        + `${chips ? `<div class="m-chips">${chips}</div>` : ""}</li>`;
    };
    const flows = r.workflows.map((w) => {
      const inner = `<section class="m-card" style="margin-top:16px">`
        + `<div class="m-card-h"><div class="m-card-t">${esc(w.name)}</div>`
        + `<span class="m-badge">${w.steps.length} step${w.steps.length === 1 ? "" : "s"}</span></div>`
        + `${w.trigger ? `<p class="m-cell-sub">Trigger — ${esc(w.trigger)}</p>` : ""}`
        + `${w.steps.length ? `<ol class="m-steps">${w.steps.map(step).join("")}</ol>` : `<div class="m-assumed"><span class="m-assumed-k">No steps</span> the atlas names this workflow without stating how it runs.<span class="m-assumed-q">What are the steps? To confirm with the team.</span></div>`}`
        + `${w.handoffs.length ? `<p class="m-cell-sub">Hands off — ${esc(w.handoffs.join("; "))}</p>` : ""}</section>`;
      const fid = flowIdFor(w);
      // The fabric declares one node per atlas workflow and nothing rendered
      // them. Where the pairing holds, this IS that node's rendering; where it
      // cannot be established the block still ships, unaddressed rather than
      // wrongly addressed.
      return fid ? region(fid, inner) : inner;
    }).join("");
    const works = r.collaborators.length
      ? `<p class="m-sub">Works with ${esc(r.collaborators.join(", "))} — the people these workflows hand off to.</p>` : "";
    const unowned = r.role ? "" : `<div class="m-assumed"><span class="m-assumed-k">Unattributed</span> the atlas names neither an owner nor an actor for ${r.workflows.length === 1 ? "this workflow" : "these workflows"}.<span class="m-assumed-q">Who runs it? To confirm with the team.</span></div>`;
    return `<section class="m-screen" data-screen="work-${r.slug}" hidden>
      <header class="m-page-h"><div><div class="m-eyebrow">Workbench</div><h1 class="m-title">${esc(title)}</h1>
      <p class="m-sub">${r.workflows.length} workflow${r.workflows.length === 1 ? "" : "s"} mapped today${r.systems.length ? ` · ${esc(r.systems.join(", "))}` : ""}</p>
      ${works}</div></header>
      ${unowned}${queues}${alsoQueued}${notHere}${notModelled}${flows}</section>`;
  };

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
    // A BOARD IS OFFERED ONLY WHERE THE ONTOLOGY DECLARES A STATUS.
    //
    // The refined path's twelve fabricated dashboards are evidence of real
    // demand for a pipeline view, and the roles already say which attribute is
    // the pipeline: `status`. So the toggle is derived, with no model call —
    // and an entity that has no status attribute gets NO toggle, because a
    // board of one nameless lane is a control that offers nothing.
    const statusIx = statusIndexOf(name);
    // WHICH VIEW THIS LIST OPENS ON. The operator can ask for the board — a
    // pipeline is what a sales demo opens on — and the ask is honoured ONLY
    // where the ontology declares a status, because that is the same condition
    // that decides whether a board exists at all. Absent, the list opens on the
    // table exactly as it always did, and the spec carries no `view` key, so an
    // unoptioned build is byte-identical to the one before this existed.
    const board = statusIx >= 0 && optionsFor(name).view === "board";
    screenSpecs.push({
      entity: name,
      slug: s,
      list: {
        region: `screen:${s}:list`,
        ...columnSpec(name, leadColumnsFor(name, SCREEN_BUDGET.listColumns)),
        // The Experience Design's own empty-state line where one was written —
        // business language a designer chose — else the generic fallback.
        emptyTitle: optionsFor(name).emptyText ?? `No ${name} records yet`,
        cite: citeOf(assumptionFor(seedParentOf(name), name)),
        status: statusIx,
        ...(board ? { view: "board" as const } : {}),
      },
      detail: null,
    });
    // The "Filter" BUTTON is gone. It opened nothing, and the honest version of
    // it is the field itself — a control that filters as it is typed into.
    // The ACTIVE tab is the view the screen opens on: a board-first list under
    // a highlighted "Table" tab is the control disagreeing with the screen.
    const toggle = statusIx >= 0
      ? `<div class="m-tabs" data-view="${s}"><button class="m-tab${board ? "" : " is-active"}" data-v="table" onclick="setView('${s}','table')">Table</button><button class="m-tab${board ? " is-active" : ""}" data-v="board" onclick="setView('${s}','board')">Board</button></div>`
      : "";
    // THE SUMMARY BANDS SIT ABOVE THE TABLE, IN FLOW, AND THE TABLE SAYS SO.
    //
    // A band of filtered numbers immediately above an unfiltered table is read
    // as that table's heading — by a person and by the render gate alike — and
    // that is precisely the "Qualified (BANT)" contradiction. So where a spec
    // put a band on this screen, the list below it gets its own heading, which
    // is true of the rows under it: all of them.
    const bands = widgetBands(`list-${s}`);
    return `<section class="m-screen" data-screen="list-${s}" hidden>
      <header class="m-page-h"><div><div class="m-eyebrow">${esc(name)}</div><h1 class="m-title">${esc(name)}</h1><p class="m-sub">${rows.length} record${rows.length === 1 ? "" : "s"} · sample data</p></div>
      <div class="m-toolbar">${toggle}<input class="m-input m-search" type="search" data-search="${s}" aria-label="Filter ${esc(name)}" placeholder="Filter ${esc(name)}" oninput="setFilter('${s}',this.value)" />${listActionsFor(name)}<button class="m-btn m-btn--primary" onclick="go('#${s}/new')">New ${esc(name)}</button></div></header>
      ${bands}${bands ? `<div class="m-section-h">All ${esc(name)}</div>` : ""}${slot(`screen:${s}:list`)}</section>`;
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
        ...columnSpec(childName, leadColumnsFor(childName, SCREEN_BUDGET.relatedColumns, n.joinKey)),
        emptyTitle: multi ? `No ${childName} linked` : `No ${childName} yet`,
        // AN UNCONFIRMED SHAPE SAYS SO ON THE PAGE. `undetermined` is what a
        // relation carries before an interview settles its cardinality, which
        // on a provisional draft is every relation the generator wrote. The
        // section still renders as a list — the screen has to be usable — and
        // the badge is the difference between a prototype that ASKS and one
        // that quietly answers for the client.
        provisional: n.role === "undetermined",
        // A record with no links is a real zero now that membership is
        // generated — but the fan-out behind it is still assumed, so the empty
        // state cites the assumption rather than presenting a guess as a finding.
        listed: ordered.includes(childName),
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
    //
    // THE OPERATOR OUTRANKS THE WEIGHT, and outranks it only by ORDER: a
    // collection they named leads the page, the rest follow by weight, and the
    // budget still holds. Naming a sixth collection therefore collapses it
    // rather than growing the wall back — which is why the studio states the
    // budget instead of letting the choice be quietly truncated.
    const CHILD_SECTIONS_OPEN = SCREEN_BUDGET.openSections;
    const byWeight = orderChildSections(childRegions, childNameOf, graph, optionsFor(name).collections ?? []);
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
        // A LINK IS A PROMISE THAT THE DESTINATION EXISTS. Screens are built for
        // the CURATED entities only, while `es` slugs every entity in the
        // ontology — so on an operator's curated build this pushed a link card
        // for every parent, most of which had no screen, and the router quietly
        // fell back to the home list while the URL claimed otherwise. Measured
        // on a reviewed CRM build: 166 such cards. The relation is still worth
        // showing; the navigation is not, so an unbuilt parent renders as text.
        navs.push({ region: nd.id, entity: parentName, slug: ps, fk: nd.joinKey ? columnIndex(name, nd.joinKey) : -1,
          listed: ordered.includes(parentName), linked: true /* the closure below builds a detail screen for every reachable parent */ });
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
    // The crumb is a real link to a real address (`#account`), so Back works and
    // the browser can show where it goes. The heading and the crumb tail carry
    // the SHOWCASE record in the served bytes — the refine post-condition reads
    // that text — and the renderer rewrites both to whichever record the URL
    // named, because a detail page headed with somebody else's name is the
    // "Open on row 12 shows row 1" defect wearing a different hat.
    return `<section class="m-screen" data-screen="detail-${s}"${screenFid(`screen:${s}`)} hidden>
      <div class="m-crumbs">${listed.has(name)
        // THE BREADCRUMB IS A CONTROL TOO — the third emitter, and the one that
        // scaled with the closure: every reachable-only detail screen carries
        // one, so it produced a dead link per drilled-into entity (24 on a
        // reviewed CRM build). An entity absent from the menu has no list to go
        // "up" to, so the crumb names its type without offering the journey.
        ? `<a href="#${s}">${esc(name)}</a>`
        : `<span class="m-crumb-flat">${esc(name)}</span>`} / <span data-crumb="${s}">${esc(headline)}</span></div>
      <header class="m-page-h"><div><div class="m-eyebrow">${esc(name)}</div><h1 class="m-title" data-headline="${s}">${esc(headline)}</h1></div>
      <div class="m-page-acts">${recordActionsFor(name, s)}<button class="m-btn m-btn--secondary" onclick="editRec('${s}')">Edit</button><button class="m-btn m-btn--danger" onclick="delRec('${s}')">Delete</button></div></header>
      ${slot(`region:${s}:summary`)}
      ${parentBand}
      ${agentBand(name)}
      ${children}</section>`;
  };

  // ── one form per entity ──
  //
  // A RELATION-TYPED FIELD IS A CHOICE, NOT FREE TEXT. "New Partner" rendered
  // Account as an empty text box: the one place the ontology's relations should
  // constrain what a person can enter, and they did not. Any field the roles
  // read as `parent-ref` or `cross-ref` now renders a `<select>`, and the
  // renderer fills it with the referenced entity's own display names.
  //
  // The TARGET comes from the ontology — `refEntity`, which `deriveRoles` sets
  // when the attribute's name IS an entity of this ontology — never from a
  // convention rebuilt out of the column name. Where the role says "reference"
  // and nothing says to what, the field stays a text box AND SAYS SO: a miss
  // that renders as an ordinary input is a miss nobody can see.
  //
  // AND THE PICKER SAVES THE RELATION. Its options are ids, and it wrote that
  // id straight into the ATTRIBUTE column — the column the detail page prints
  // as a name and the list heads as one — while the parent link card and the
  // parent's child collection both resolve the relation through the JOIN KEY
  // (`joinKeyFor`, the one definition, which is what `NavSpec.fk` and
  // `KidSpec.fk` index). So one save left the same record stating its parent
  // three different ways: a raw id where a name belongs, a link card still
  // pointing at the record the user had just replaced, and a parent whose
  // collection never moved. The picker now carries the join-key COLUMN NAME
  // (`data-fkc`) and the renderer writes both halves — the id to the key the
  // application reads, the name to the column a person reads.
  const formScreen = (name: string): string => {
    const s = es.get(name)!; const attrs = attrsOf(name);
    // WHICH FIELD OWNS THE JOIN KEY. There is exactly ONE key column per parent
    // entity, so where an ontology names two attributes pointing at the same
    // parent (a contract's billing account and its primary account) only one of
    // them can be that column — otherwise two pickers write the same key and
    // the record contradicts itself again, this time between its own fields.
    // The attribute that IS the key column owns it; failing that, the first the
    // ontology declares. The others still pick a real record and still store
    // its name, and the form SAYS the link is not theirs to write.
    const fkOwner = new Map<string, string>();
    for (const a of attrs) {
      const r = roleOf.get(`${name} ${a}`);
      if (r !== "parent-ref" && r !== "cross-ref") continue;
      const t = refOf.get(`${name} ${a}`);
      if (!t || !names.includes(t) || columnIndex(name, joinKeyFor(t)) < 0) continue;
      if (!fkOwner.has(t) || a === joinKeyFor(t)) fkOwner.set(t, a);
    }
    const fields = attrs.map((a) => {
      const key = `${name} ${a}`;
      const role = roleOf.get(key);
      const req = role === "identifier" || role === "title" ? ` <span class="m-req">*</span>` : "";
      const isRef = role === "parent-ref" || role === "cross-ref";
      const target = isRef ? refOf.get(key) : undefined;
      const picker = target && names.includes(target) && (seed.records[target] ?? []).length ? target : undefined;
      if (picker) referenced.add(picker);
      const label = esc(humanizeField(a));
      // The join key travels on the control that WRITES it, so the renderer
      // never rebuilds the convention on the reading side — the guess this key
      // already had to be rescued from once.
      const owns = picker ? fkOwner.get(picker) === a : false;
      const fkc = owns ? ` data-fkc="${esc(joinKeyFor(picker!))}"` : "";
      const input = picker ? `<select class="m-select" data-f="${esc(a)}" data-fk="${esc(picker)}"${fkc}></select>`
        : role === "status" ? `<select class="m-select" data-f="${esc(a)}" data-vals="1"></select>`
          : role === "boolean" ? `<label class="m-checkbox"><input type="checkbox" data-f="${esc(a)}" /> ${label}</label>`
            : `<input class="m-input" data-f="${esc(a)}" placeholder="${label}" />`;
      const gap = isRef && !picker
        ? `<div class="m-help">Reads as a reference, but the ontology names no entity for it — so this stays free text. Which record should it point at? To confirm with the team.</div>`
        : picker && fkOwner.has(picker) && !owns
          ? `<div class="m-help">The model holds one link from ${esc(name)} to ${esc(picker)}, and ${esc(humanizeField(fkOwner.get(picker)))} writes it — so this field stores the name only. Are these two different links? To confirm with the team.</div>`
          : "";
      return region(`field:${s}:${slug(a)}`, `<div class="m-field"><label class="m-label">${label}${req}</label>${input}${gap}</div>`);
    }).join("");
    return `<section class="m-screen" data-screen="form-${s}" hidden>
      <div class="m-crumbs"><a href="#${s}">${esc(name)}</a> / <span data-form-crumb="${s}">New</span></div>
      <header class="m-page-h"><div><div class="m-eyebrow">${esc(name)}</div><h1 class="m-title" data-form-title="${s}">New ${esc(name)}</h1></div></header>
      <section class="m-card" style="max-width:620px" data-form="${s}">${fields}<div class="m-form-actions"><button class="m-btn m-btn--ghost" onclick="go('#${s}')">Cancel</button><button class="m-btn m-btn--primary" onclick="saveRec('${s}')">Save</button></div></section></section>`;
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
    `<span class="m-nav-item${n === lead ? " is-active" : ""}" data-nav="list-${es.get(n)}" onclick="event.preventDefault();event.stopPropagation();go('#${es.get(n)}')">${esc(n)}<span class="m-nav-count">${seed.counts[n] ?? 0}</span></span>`;
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
  // THE APPROVAL QUEUE IS BUILT FIRST, because the entity detail pages link to
  // it: an agent's gate on a record's own page is only offered a queue where a
  // queue exists, and that is decided here.
  const approvals = approvalsScreen();
  // DRILL-THROUGH: THE MENU DECIDES WHAT IS LISTED, NOT WHAT CAN BE OPENED.
  //
  // Screens were built for the curated menu alone, so every related record shown
  // on a detail page was a dead end — the control changed the URL and the router
  // fell back to the home list. "What belongs in the navigation" and "what can a
  // person open" are different questions, and only the first is the operator's.
  //
  // So the build closes over reachability, and an entity that arrives only by
  // being referenced gets its DETAIL screen and nothing else. That is what a
  // drill-through needs: somewhere to land. It deliberately does not get a list
  // (it is not in the menu, so nothing should offer to browse all of them) or a
  // form (nothing offers to create one). Building all three for the closure was
  // measured on the 33-entity snapshot at 95 screens and 439,745 bytes against
  // 13 and 247,110 — curation stopped reducing the build at all. Detail-only
  // keeps the drill-through and most of the saving.
  //
  // `listScreen`/`detailScreen` are what populate `referenced`, so the closure
  // must run them as it discovers rather than over a set computed up front.
  const listed = new Set(ordered);
  const builtDetail = new Set<string>();
  let frontier: string[] = [...ordered];
  let screensHtml = "";
  while (frontier.length) {
    for (const n of frontier) {
      if (builtDetail.has(n) || !names.includes(n)) continue;
      builtDetail.add(n);
      screensHtml += (listed.has(n) ? listScreen(n) : "") + detailScreen(n)
        + (listed.has(n) ? formScreen(n) : "") + "\n";
    }
    frontier = [...new Set([...referenced])].filter((r) => !builtDetail.has(r) && names.includes(r));
  }
  const screens = screensHtml;

  // WHAT THE ONTOLOGY HOLDS AND THIS BUILD DOES NOT SHOW — said out loud.
  //
  // `builtDetail` is the closure's own answer to "which entities can be
  // opened", so the complement of it against the ontology's entity list is
  // exactly the set with no screen of any kind: not in the navigation, and not
  // reached from anything that is. Their rows are not in the data island either
  // (it is keyed by `referenced`), so nothing about them is in the application.
  //
  // Derived from the build rather than from the operator's input, because the
  // question is what the DOCUMENT covers: an entity the operator left out of
  // the menu but a chosen entity relates to is rendered, and must not be
  // declared missing. Order is ontology order, so the same ontology and the
  // same menu produce the same declaration.
  const coverageGaps = names.filter((n) => !builtDetail.has(n)).map((n) =>
    `${n} has no screen in this prototype: it is not in the navigation and no relation reaches it from an entity that is, `
    + `so none of its records appear anywhere in the application. `
    + `Add it in Experience Design if it belongs in the product, or say why the ontology holds a record type the product does not.`)
    // …and every designed verb this model could not carry. A refused action is
    // a finding — the state the design assumes may simply be missing from the
    // ontology — and it belongs in the same channel as a missing screen.
    .concat(derivedActions.refused);

  const workbenches = roleWorkbenches.map(workbenchScreen).join("\n");
  /**
   * WHAT THE APPLICATION OPENS ON — a person's work, not a filing drawer.
   *
   * It opened on the lead entity's LIST, so the first thing a stakeholder saw
   * was a table of every campaign: true, complete, and nobody's job. The
   * workbench is the screen that answers "how does my day change" — their
   * records, and their workflow beside them — and it sat below the record menu
   * where a demo reached it last.
   *
   * The operator's curated menu is still honoured for what it decides: WHICH
   * ENTITY leads the records group. This decides something else — where the app
   * starts — and falls back to that same first entity whenever the atlas names
   * no roles, so a programme without an atlas opens exactly as it always did.
   */
  const primaryWorkbench = roleWorkbenches[0];
  const firstList = `list-${es.get(lead)}`;
  const entryScreen = primaryWorkbench ? `work-${primaryWorkbench.slug}` : firstList;

  // THE SECOND NAVIGATION — the people and the agents.
  //
  // Its own `<nav>`, not more rows in the records menu: these are not record
  // types, and the operator's curated menu is a statement about record types.
  // A landmark each, so the two are distinguishable to a screen reader as well
  // as on the screen.
  const workNav = roleWorkbenches.map((r) =>
    `<div class="m-nav-row"><span class="m-nav-item" data-nav="work-${r.slug}" onclick="event.preventDefault();event.stopPropagation();go('#${WB_ROUTE}/${r.slug}')">${esc(r.role || "Unattributed")}<span class="m-nav-count">${r.workflows.length}</span></span></div>`).join("");
  const apprNav = approvals
    ? `<div class="m-nav-sec">Agents</div><div class="m-nav-row"><span class="m-nav-item" data-nav="approvals" onclick="event.preventDefault();event.stopPropagation();go('#${AP_ROUTE}')">Approvals<span class="m-nav-count">${gated.length}</span></span></div>`
    : "";
  const auxNav = workNav || apprNav
    ? `<nav class="m-nav" aria-label="Workbenches and agents">${workNav ? `<div class="m-nav-sec">Workbenches</div>${workNav}` : ""}${apprNav}</nav>`
    : "";

  // THE ISLAND. Built after the screens because the screens are what decide
  // which entities are reachable: a curated build ships its chosen parents and
  // the children they show, not the whole ontology. Key order is insertion
  // order throughout — ontology order for the tables, screen order for the
  // rest — so the same ontology serialises to the same bytes.
  const data: Record<string, SeedTable> = {};
  for (const n of names) if (referenced.has(n)) data[n] = tables.get(n)!;
  const links: Record<string, Array<[string, string]>> = {};
  for (const key of junctionsUsed) links[key] = (seed.junctionLinks[key] ?? []).map((l) => [l.fromId, l.toId]);
  // The designed verbs the renderer performs, keyed by the screen slug that
  // draws them. Empty for a build with no Experience Design, and then the
  // renderer's action branch is unreachable rather than merely unused.
  const acts: Record<string, Array<{ kind: string; label: string; col: number; value: string; target: string }>> = {};
  for (const [name, list] of Object.entries(actionSpecs)) {
    const s = es.get(name);
    if (s && list.length) acts[s] = list;
  }
  // THE VERDICT EACH STATE CARRIES, decided here and shipped as a lookup — the
  // classification is TypeScript a test can run, and the renderer only reads a
  // map. Built from the values that actually reach the page (the seeded rows of
  // the columns the roles call state-shaped), so it costs a few dozen bytes on
  // a build that has states and nothing at all on one that does not.
  const tones: Record<string, string> = {};
  for (const entity of names) {
    for (const attr of attrsOf(entity)) {
      const role = roleOf.get(`${entity} ${attr}`);
      if (role !== "status" && role !== "category" && role !== "health" && role !== "priority") continue;
      for (const row of (seed.records[entity] ?? [])) {
        const value = row[attr];
        const text = typeof value === "string" ? value : "";
        if (!text || tones[text]) continue;
        const tone = valueTone(text);
        if (tone) tones[text] = tone;
      }
    }
  }
  const model: PrototypeModel = {
    roles: roleLegend, data, links, screens: screenSpecs, first: es.get(lead) ?? "",
    // Where the app starts when the URL names nothing — a workbench route when
    // the atlas gives one, else the lead entity's list (`first`).
    ...(primaryWorkbench ? { home: `${WB_ROUTE}/${primaryWorkbench.slug}` } : {}),
    work: workSpecs, appr: apprSpecs, wbRoute: WB_ROUTE, apRoute: AP_ROUTE,
    ...(widgetGroups.length ? { widgets: widgetGroups } : {}),
    ...(Object.keys(acts).length ? { acts } : {}),
    ...(Object.keys(tones).length ? { tones } : {}),
  };
  // `<` is the ONE character that can end a script block early; escaping it
  // keeps the island valid JSON (a `<` inside a JSON string is just `<`)
  // and unable to close its own element.
  const island = JSON.stringify(model).replace(/</g, "\\u003c");

  const appName = String(options.appName ?? "").trim() || "Prototype";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(appName)}</title><style>${meridianStylesheet(options.theme)}
.m-screen[hidden]{display:none}.m-screen{display:block}</style></head><body>
<div class="m-app"><aside class="m-side"><div class="m-brand"><span class="m-brand-dot"></span>${esc(appName)}</div>${auxNav}<nav class="m-nav" aria-label="Records">${nav}</nav></aside>
<main class="m-main">${screens}
${workbenches}
${approvals}</main></div>
<script type="application/json" id="m-seed">${island}</script>
<script>function show(id){document.querySelectorAll('.m-screen').forEach(s=>s.hidden=s.getAttribute('data-screen')!==id);
var m=document.querySelectorAll('.m-nav-item[data-nav="'+id+'"]');
if(m.length){document.querySelectorAll('.m-nav-item').forEach(function(n){n.classList.remove('is-active')});
m.forEach(function(n){n.classList.add('is-active');for(var p=n.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true})}
window.scrollTo(0,0)}${rendererFor(workSpecs.some((w) => w.queues.length > 0) || apprSpecs.length > 0, widgetGroups.length > 0, Object.keys(acts).length > 0)}
if(!document.querySelector('.m-screen:not([hidden])'))show('${entryScreen}')</script>
</body></html>`;
  // What was ACCEPTED is what is on the page, counted off the bands themselves —
  // not what validation let through, which a missing column can still stop.
  const specAccepted = widgetGroups.reduce((n, g) => n + g.items.length, 0);
  return { html, fabric, regionCount, specSchema, specViolations, specAccepted, coverageGaps };
}
