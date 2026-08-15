/**
 * THE MODEL EMITS A SPEC, NOT HTML.
 *
 * Free-form HTML is where the model-written build's defects live. On a reviewed
 * CRM build, all of these were true at once: stat cards positioned out of flow
 * over the tables, hiding columns on every screen; a row badged
 * "Qualified (BANT)" inside a table headed "Leads (Unqualified)"; three ontology
 * entities absent from the application while `gaps` came back `[]`. None of them
 * is a failure of taste — each is a structural claim the model had no way to
 * check and no reason to doubt.
 *
 * So the judgement and the drawing are separated. The model says WHAT a screen
 * deserves — "this one wants a funnel of Opportunity by Stage, and the total
 * value beside it" — as a small JSON document. This module validates that
 * document against a schema DERIVED FROM THE ONTOLOGY, and the assembler draws
 * it. What the split buys, and it buys it by construction rather than by review:
 *
 *   - AN INVALID REFERENCE CANNOT RENDER. An entity, an attribute or a screen
 *     the ontology does not hold fails validation and is named in the artifact's
 *     gaps. It never reaches the page as a plausible-looking card about a record
 *     type that does not exist.
 *   - A LABEL CANNOT CONTRADICT ITS OWN NUMBERS. Every heading here is DERIVED
 *     from the validated references; the model writes no prose at all. A filter
 *     is applied by the same code that names it, so "where Stage is Closed Won"
 *     is the rows being counted, not a caption over rows nobody filtered.
 *   - A FILTER VALUE THAT OCCURS NOWHERE IS A LOUD MISS. The seeded values are
 *     the second half of validation: a card headed with a state the data has
 *     never held is exactly the "Qualified (BANT)" defect, and it is refused
 *     with the values that DO occur quoted back.
 *   - NOTHING OVERLAPS. The widgets are laid out in normal flow by the assembler
 *     in two named bands; no rule the model can reach declares a position.
 *
 * Pure and deterministic throughout: no clock, no RNG, no model call. The same
 * ontology and the same spec produce the same bytes.
 */
import type { ValueRole } from "./semanticRoles.ts";

// ── the schema, derived from the ontology ────────────────────────────────────

export type WidgetKind = "stat" | "breakdown" | "funnel";
export type WidgetAgg = "count" | "sum" | "avg";

/** The roles a number can be aggregated from. Anything else is a label. */
const MEASURE_ROLES = new Set<ValueRole>(["monetary", "quantity", "percent"]);
/**
 * The roles a set of rows can be GROUPED BY — a small, repeating vocabulary.
 * A `code` is deliberately not one: a handle is unique per record, so a chart
 * of it has one bar per row and says nothing.
 */
const DIMENSION_ROLES = new Set<ValueRole>(["status", "category", "health", "priority", "boolean"]);

/** One entity as a spec may reference it: what it is called, which screen shows
 *  it, and which of its attributes can be measured and which grouped by. */
export interface SpecEntity {
  entity: string;
  /** The `data-screen` id of its list screen — the only slot a widget can take. */
  screen: string;
  /** Attributes that carry a number: legal for `sum` / `avg`. */
  measures: string[];
  /** The measures that are a SHARE OF A WHOLE — averaged, never totalled. Read
   *  off the derived role rather than guessed back out of the name, because the
   *  role is where that fact already lives. */
  shares: string[];
  /** Attributes that carry a repeating label: legal for grouping and filtering. */
  dimensions: string[];
}

export interface PrototypeSpecSchema {
  /** The fabric version the schema was derived from — a spec is only valid
   *  against the ontology that produced it, and this is how a caller can tell. */
  version: string;
  kinds: WidgetKind[];
  /** How many widgets one screen may carry. Past this the page is a dashboard
   *  standing in front of the records, which is the build this replaces. */
  maxWidgetsPerScreen: number;
  entities: SpecEntity[];
  /** Written for the model, and the same words the violations use. */
  rules: string[];
}

/** Everything the schema needs, as plain data the assembler already holds. */
export interface SpecSchemaInput {
  version: string;
  entities: Array<{
    entity: string;
    screen: string;
    attributes: Array<{ name: string; role?: ValueRole }>;
  }>;
}

/** How many widgets one screen may carry — a budget, not a suggestion. */
export const WIDGETS_PER_SCREEN = 4;

export function buildSpecSchema(input: SpecSchemaInput): PrototypeSpecSchema {
  return {
    version: input.version,
    kinds: ["stat", "breakdown", "funnel"],
    maxWidgetsPerScreen: WIDGETS_PER_SCREEN,
    entities: input.entities.map((e) => ({
      entity: e.entity,
      screen: e.screen,
      measures: e.attributes.filter((a) => a.role && MEASURE_ROLES.has(a.role)).map((a) => a.name),
      shares: e.attributes.filter((a) => a.role === "percent").map((a) => a.name),
      dimensions: e.attributes.filter((a) => a.role && DIMENSION_ROLES.has(a.role)).map((a) => a.name),
    })),
    rules: [
      'A widget names a "screen" from this schema, a "kind", and an "entity" this schema lists.',
      '"stat" is one number: the count of that entity, or "measure" set to one of its measures for a total. A measure this schema also lists under "shares" is averaged instead — a total of percentages states nothing.',
      '"breakdown" and "funnel" group the entity by "attribute", which must be one of its dimensions; a funnel is ordered by volume.',
      'Any widget may carry "where": { "attribute": <a dimension>, "equals": <a value that occurs in the data> } to count a subset.',
      "Every heading, every number and every layout decision is produced by the renderer from these references — do not write labels, captions or counts.",
      `At most ${WIDGETS_PER_SCREEN} widgets per screen. A screen you have nothing to say about takes none.`,
      "A reference this schema does not list is refused and reported as a gap; it is never drawn.",
    ],
  };
}

// ── validation ───────────────────────────────────────────────────────────────

/** A widget that survived validation: every reference resolved, every label
 *  derived here rather than taken from the model. */
export interface ValidWidget {
  kind: WidgetKind;
  entity: string;
  /** The measured attribute (`sum`/`avg`), or the grouped one (breakdown/funnel). */
  attribute?: string;
  agg: WidgetAgg;
  where?: { attribute: string; equals: string };
  label: string;
  note: string;
}
export interface ValidScreen { screen: string; widgets: ValidWidget[] }
export interface SpecValidation {
  screens: ValidScreen[];
  /** One line per refusal, in the language the model is asked to fix it in. */
  violations: string[];
  accepted: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
/** A bounded quotation of what WAS allowed — a refusal that does not say what
 *  would have worked teaches the next attempt nothing. */
const some = (xs: readonly string[], n = 8): string =>
  xs.length ? xs.slice(0, n).join(", ") + (xs.length > n ? `, +${xs.length - n} more` : "") : "none";

/** An attribute as a person reads it, for the derived labels. Deliberately a
 *  local copy of the assembly's `humanizeField` rule for the split-words case
 *  only: this module must not import the assembler, which imports it. */
export function specLabel(name: string): string {
  const words = String(name ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return "";
  return /\s/.test(String(name)) ? words.replace(/^./, (c) => c.toUpperCase())
    : words.replace(/(^|\s)(\S)/g, (_m, lead: string, c: string) => `${lead}${c.toUpperCase()}`);
}

/** The seeded values a column actually holds — the second half of validation. */
export interface SpecData { valuesOf(entity: string, attribute: string): string[] }

/**
 * THE GATE. Every reference is resolved against the schema, and every filter
 * value against the data; anything unresolved is refused BY NAME and does not
 * reach the renderer.
 */
export function validatePrototypeSpec(
  raw: unknown,
  schema: PrototypeSpecSchema,
  data?: SpecData,
): SpecValidation {
  const violations: string[] = [];
  const screens: ValidScreen[] = [];
  if (raw == null) return { screens, violations, accepted: 0 };
  if (!isRecord(raw)) {
    violations.push("The screen spec must be an object with a `screens` array; it was not.");
    return { screens, violations, accepted: 0 };
  }
  const rows = Array.isArray(raw.screens) ? raw.screens : null;
  if (!rows) {
    violations.push("The screen spec carries no `screens` array, so nothing in it could be drawn.");
    return { screens, violations, accepted: 0 };
  }
  const byScreen = new Map(schema.entities.map((e) => [e.screen, e] as const));
  const byEntity = new Map(schema.entities.map((e) => [e.entity, e] as const));
  const allScreens = schema.entities.map((e) => e.screen);
  const seenScreens = new Set<string>();

  for (const [i, rowRaw] of rows.entries()) {
    if (!isRecord(rowRaw)) {
      violations.push(`Screen entry ${i + 1} is not an object.`);
      continue;
    }
    const screen = str(rowRaw.screen);
    if (!byScreen.has(screen)) {
      violations.push(`"${screen || "(unnamed)"}" is not a screen this build has — widgets go on a list screen (${some(allScreens)}).`);
      continue;
    }
    if (seenScreens.has(screen)) {
      violations.push(`Screen "${screen}" appears twice in the spec; only the first was read.`);
      continue;
    }
    seenScreens.add(screen);
    const widgetRows = Array.isArray(rowRaw.widgets) ? rowRaw.widgets : [];
    const widgets: ValidWidget[] = [];
    for (const [w, widgetRaw] of widgetRows.entries()) {
      const at = `widget ${w + 1} on screen "${screen}"`;
      if (widgets.length >= schema.maxWidgetsPerScreen) {
        violations.push(`${at} was not drawn: a screen carries at most ${schema.maxWidgetsPerScreen} widgets, and this one already has that many.`);
        continue;
      }
      const widget = validateWidget(widgetRaw, at, schema, byEntity, data, violations);
      if (widget) widgets.push(widget);
    }
    if (widgets.length) screens.push({ screen, widgets });
  }
  return { screens, violations, accepted: screens.reduce((n, s) => n + s.widgets.length, 0) };
}

function validateWidget(
  raw: unknown,
  at: string,
  schema: PrototypeSpecSchema,
  byEntity: Map<string, SpecEntity>,
  data: SpecData | undefined,
  violations: string[],
): ValidWidget | null {
  if (!isRecord(raw)) { violations.push(`${at} is not an object.`); return null; }
  const kind = str(raw.kind) as WidgetKind;
  if (!schema.kinds.includes(kind)) {
    violations.push(`${at} asks for kind "${str(raw.kind) || "(none)"}", which this renderer does not draw (${schema.kinds.join(", ")}).`);
    return null;
  }
  const entity = str(raw.entity);
  const spec = byEntity.get(entity);
  if (!spec) {
    violations.push(`${at} names entity "${entity || "(none)"}", which this build does not hold (${some([...byEntity.keys()])}).`);
    return null;
  }
  const known = new Set([...spec.measures, ...spec.dimensions]);

  // ── the filter, and the value it filters on ──
  let where: ValidWidget["where"];
  if (raw.where != null) {
    if (!isRecord(raw.where)) {
      violations.push(`${at} carries a "where" that is not an object.`);
      return null;
    }
    const attribute = str(raw.where.attribute);
    const equals = str(raw.where.equals);
    if (!spec.dimensions.includes(attribute)) {
      violations.push(`${at} filters on "${attribute || "(none)"}", which is not a groupable attribute of ${entity} (${some(spec.dimensions)}).`);
      return null;
    }
    if (!equals) {
      violations.push(`${at} filters on ${entity}.${attribute} without naming a value.`);
      return null;
    }
    // THE VALUE HAS TO OCCUR. A card headed with a state the records have never
    // held is the "Qualified (BANT)" defect: a label that reads as a finding
    // over rows that say something else. Refused, with the real values quoted.
    if (data) {
      const values = data.valuesOf(entity, attribute);
      if (!values.includes(equals)) {
        violations.push(`${at} filters ${entity}.${attribute} on "${equals}", a value no record in this build holds (${some(values)}).`);
        return null;
      }
    }
    where = { attribute, equals };
  }
  const whereNote = where ? ` where ${specLabel(where.attribute)} is "${where.equals}"` : "";

  if (kind === "breakdown" || kind === "funnel") {
    const attribute = str(raw.attribute);
    if (!spec.dimensions.includes(attribute)) {
      violations.push(
        known.has(attribute)
          ? `${at} groups ${entity} by "${attribute}", which is a measured value rather than a repeating label (groupable: ${some(spec.dimensions)}).`
          : `${at} groups ${entity} by "${attribute || "(none)"}", which this ontology does not hold on ${entity} (groupable: ${some(spec.dimensions)}).`,
      );
      return null;
    }
    return {
      kind, entity, attribute, agg: "count", where,
      label: `${entity} by ${specLabel(attribute)}`,
      note: kind === "funnel"
        ? `Every ${entity}${whereNote}, grouped by ${specLabel(attribute)} and ordered by volume.`
        : `Every ${entity}${whereNote}, grouped by ${specLabel(attribute)}.`,
    };
  }

  // ── a stat: a count, or one measure totalled ──
  const measure = str(raw.measure) || str(raw.attribute);
  if (!measure) {
    return {
      kind, entity, agg: "count", where,
      label: where ? `${entity} — ${specLabel(where.attribute)}: ${where.equals}` : entity,
      note: `Counted from the ${entity} records in this build${whereNote}.`,
    };
  }
  if (!spec.measures.includes(measure)) {
    violations.push(
      known.has(measure)
        ? `${at} totals ${entity}.${measure}, which is a label rather than a number (measurable: ${some(spec.measures)}).`
        : `${at} totals "${measure}", which this ontology does not hold on ${entity} (measurable: ${some(spec.measures)}).`,
    );
    return null;
  }
  // An average is right for a bounded share and a total is right for money and
  // counts, so the DEFAULT is derived. A model may state the other one — and a
  // sum of percentages, which is the one combination that means nothing, is
  // refused rather than drawn.
  const derived: WidgetAgg = spec.shares.includes(measure) ? "avg" : "sum";
  const asked = str(raw.agg) as WidgetAgg;
  if (asked && asked !== "sum" && asked !== "avg") {
    violations.push(`${at} asks to aggregate by "${asked}", which is not one of sum, avg.`);
    return null;
  }
  if (asked === "sum" && derived === "avg") {
    violations.push(`${at} sums ${entity}.${measure}, which is a share of a whole — a total of percentages states nothing. Ask for "avg".`);
    return null;
  }
  const agg = asked || derived;
  return {
    kind, entity, attribute: measure, agg, where,
    label: `${agg === "avg" ? "Average" : "Total"} ${specLabel(measure)}`,
    note: `${agg === "avg" ? "Averaged" : "Summed"} across the ${entity} records in this build${whereNote}.`,
  };
}

// ── what the assembler draws ─────────────────────────────────────────────────

/** One widget as the client renderer reads it: no names, only addresses. */
export interface WidgetItem {
  kind: WidgetKind;
  /** The entity key into the data island. */
  entity: string;
  /** Column index of the measured or grouped attribute; -1 for a plain count. */
  col: number;
  /** The measure's role code, for formatting — -1 when there is nothing to format. */
  role: number;
  agg: WidgetAgg;
  /** `[column index, value]` — the filter, applied by the same code that names it. */
  fx?: [number, string];
  label: string;
  note: string;
}
/** One band of one screen: the element the renderer fills, and what goes in it. */
export interface WidgetGroup { region: string; items: WidgetItem[] }

export interface WidgetContext {
  /** Where a named column sits in that entity's row array (-1 when absent). */
  columnIndex(entity: string, attribute: string): number;
  /** The entity's role legend index for that attribute (-1 when it has none). */
  roleCode(entity: string, attribute: string): number;
}

/** What every summary band's region id begins with — the one definition, so a
 *  reader can tell the bands a spec owns from the queues it does not. */
export const WIDGET_REGION_PREFIX = "widget:";

/** The two bands, in the order they are drawn: numbers first, then the charts. */
export function widgetRegionId(screen: string, band: "stats" | "charts"): string {
  return `${WIDGET_REGION_PREFIX}${screen}:${band}`;
}

/**
 * The validated spec, resolved to addresses. A widget whose column the seeded
 * rows do not carry is dropped HERE and said so — the alternative is a card
 * reading zero for a reason nobody can see.
 */
export function widgetGroupsFor(
  screens: readonly ValidScreen[],
  ctx: WidgetContext,
  violations: string[] = [],
): WidgetGroup[] {
  const groups: WidgetGroup[] = [];
  for (const s of screens) {
    const stats: WidgetItem[] = [];
    const charts: WidgetItem[] = [];
    for (const w of s.widgets) {
      const col = w.attribute ? ctx.columnIndex(w.entity, w.attribute) : -1;
      if (w.attribute && col < 0) {
        violations.push(`A ${w.kind} of ${w.entity}.${w.attribute} on "${s.screen}" was not drawn: the seeded records carry no such column.`);
        continue;
      }
      let fx: [number, string] | undefined;
      if (w.where) {
        const fi = ctx.columnIndex(w.entity, w.where.attribute);
        if (fi < 0) {
          violations.push(`A ${w.kind} of ${w.entity} on "${s.screen}" was not drawn: the seeded records carry no ${w.where.attribute} column to filter on.`);
          continue;
        }
        fx = [fi, w.where.equals];
      }
      const item: WidgetItem = {
        kind: w.kind, entity: w.entity, col,
        role: w.attribute ? ctx.roleCode(w.entity, w.attribute) : -1,
        agg: w.agg, label: w.label, note: w.note, ...(fx ? { fx } : {}),
      };
      (w.kind === "stat" ? stats : charts).push(item);
    }
    if (stats.length) groups.push({ region: widgetRegionId(s.screen, "stats"), items: stats });
    if (charts.length) groups.push({ region: widgetRegionId(s.screen, "charts"), items: charts });
  }
  return groups;
}

/**
 * THE BANDS, IN NORMAL FLOW.
 *
 * Two block elements, one after the other, above the screen's own table. They
 * reserve their own space because they are laid out like everything else on the
 * page — which is the whole answer to cards that painted over the columns
 * underneath them. Emitted empty: the numbers are the seed's, and the seed is
 * drawn client-side from the data island like every other region.
 */
export function widgetBandsHtml(screen: string, groups: readonly WidgetGroup[], escape: (s: unknown) => string): string {
  const bands = (["stats", "charts"] as const)
    .filter((band) => groups.some((g) => g.region === widgetRegionId(screen, band)))
    .map((band) => `<div class="m-${band}" data-region="${escape(widgetRegionId(screen, band))}"></div>`)
    .join("");
  return bands ? `<div class="m-widgets">${bands}</div>` : "";
}

/**
 * THE CLIENT SEGMENT — appended to the prototype's renderer only when a build
 * has widgets, exactly as the persona segment is.
 *
 * Every number here is computed from the LIVE rows, the same array the tables
 * and the counts read, so a record deleted in this session leaves the summary
 * above it agreeing with the list below it. A stat baked at assembly time would
 * be a second source of truth, and a second source of truth is the contradiction
 * this module exists to make impossible.
 */
export const WIDGET_RENDERER = `
  var WIDG=M.widgets||[];
  function wRows(t,it){
    var ix=live(t),out=[],i,v;
    if(!it.fx)return ix;
    for(i=0;i<ix.length;i++){v=at(t,ix[i],it.fx[0]);if(v!=null&&String(v)===it.fx[1])out.push(ix[i])}
    return out;
  }
  function wNum(it,n){
    var r=it.role==null||it.role<0?"":R[it.role];
    if(r==="monetary")return mMoney(Math.round(n));
    if(r==="percent")return (Math.round(n*10)/10)+"%";
    return (Math.round(n*100)/100).toLocaleString("en-US");
  }
  function wStat(it){
    var t=D[it.entity];if(!t)return "";
    var rows=wRows(t,it),all=live(t).length,v,s=0,n=0,i,x;
    if(it.agg==="count")v=rows.length.toLocaleString("en-US");
    else{
      for(i=0;i<rows.length;i++){x=at(t,rows[i],it.col);if(typeof x==="number"){s+=x;n++}}
      v=n?wNum(it,it.agg==="avg"?s/n:s):"—";
    }
    return '<div class="m-stat"><div class="m-stat-k">'+mEsc(it.label)+'</div><div class="m-stat-v">'+v+"</div>"
      +'<div class="m-stat-n">'+mEsc(it.note)+" "+rows.length+" of "+all+" record"+(all===1?"":"s")+".</div></div>";
  }
  function wBars(it){
    var t=D[it.entity];if(!t)return "";
    var rows=wRows(t,it),by={},order=[],i,v,max=0,out="";
    for(i=0;i<rows.length;i++){v=at(t,rows[i],it.col);v=(v==null||v==="")?"Unset":String(v);if(by[v]===undefined){by[v]=0;order.push(v)}by[v]++}
    if(it.kind==="funnel")order.sort(function(a,b){return by[b]-by[a]||(a<b?-1:a>b?1:0)});else order.sort();
    for(i=0;i<order.length;i++)if(by[order[i]]>max)max=by[order[i]];
    for(i=0;i<order.length;i++){
      out+='<div class="m-bar"><div class="m-bar-k">'+mEsc(order[i])+'</div><div class="m-bar-track">'
        +'<span class="m-bar-fill" style="width:'+(max?Math.round(by[order[i]]/max*100):0)+'%"></span></div>'
        +'<div class="m-bar-v">'+by[order[i]]+"</div></div>";
    }
    return '<section class="m-card"><div class="m-card-h"><div class="m-card-t">'+mEsc(it.label)+'</div>'
      +'<span class="m-badge">'+order.length+" group"+(order.length===1?"":"s")+"</span></div>"
      +'<p class="m-cell-sub">'+mEsc(it.note)+"</p>"
      +(out?'<div class="m-bars">'+out+"</div>"
        :'<div class="m-cell-sub">No '+mEsc(it.entity)+" record in this build carries that value yet.</div>")+"</section>";
  }
  function renderWidgets(){
    for(var i=0;i<WIDG.length;i++){
      var g=WIDG[i],out="",k;
      for(k=0;k<g.items.length;k++)out+=(g.items[k].kind==="stat"?wStat:wBars)(g.items[k]);
      fill(g.region,out);
    }
  }
`;

/** What the model is told about the spec, shipped verbatim in the refine brief. */
export const SCREEN_SPEC_CONTRACT = [
  "YOU MAY ALSO RETURN A SCREEN SPEC — judgement about what a screen deserves, as data rather than as markup.",
  '"screenSpec" is { "screens": [ { "screen": <a data-screen id>, "widgets": [ … ] } ] }. The assembler draws it deterministically: in normal flow, above the screen\'s own table, with every heading and every number computed from the seeded records.',
  "prototypeRefineBrief.screenSpecSchema states exactly which screens, entities and attributes you may reference, and which of those attributes can be measured and which grouped by. A reference outside it is REFUSED and reported in the artifact's gaps — it is never drawn, so guessing costs you the widget.",
  "Write no labels, captions, counts or colours in the spec: the renderer derives all of them, which is what makes it impossible for a heading to contradict the rows under it.",
  "Return screenSpec INSTEAD of html, never both — the renderer produces the markup for the widgets, and a document you wrote cannot contain regions that did not exist when you were given it.",
].join("\n");
