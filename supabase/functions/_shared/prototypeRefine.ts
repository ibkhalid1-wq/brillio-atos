/**
 * THE REFINE PATH, ASSEMBLED FIRST.
 *
 * The prototype-build agent used to regenerate the whole application free-form
 * on every run: no fabric, no regions, no diffability, a fresh die-roll each
 * time. The cost was not theoretical — a refine asking for detail-page
 * breadcrumbs and related-entity tabs came back with the first half applied and
 * the second half correctly declined, "no detail screens exist in the current
 * design", because the free-form path never builds any. The model was being
 * asked to re-derive structure it has no way to derive, and the structure the
 * assembler DOES derive was thrown away before the call.
 *
 * So the order is inverted. The build is ASSEMBLED first — deterministically,
 * from the ontology and the atlas, with every region carrying its stable
 * `data-fabric-id` — and the model is handed that build plus the operator's
 * direction, with one instruction: change PRESENTATION, never structure.
 *
 * Two things make that instruction enforceable rather than hopeful:
 *
 *   1. WHAT THE MODEL IS ASKED FOR IS SIZED TO WHAT IT CAN RETURN. A real
 *      programme assembles to hundreds of KB — far beyond any output budget, so
 *      "return the whole document, modified" is a request that can only fail.
 *      Above that budget the ask is the STYLESHEET ALONE, spliced back into the
 *      assembled document here: a restyle that cannot touch structure because it
 *      never holds any. Below it, the whole document, checked on return.
 *   2. THE POST-CONDITION IS A PURE FUNCTION, not a prompt promise.
 *      `checkRefinedPrototype` compares the returned document against the
 *      assembled one: the same set of `data-fabric-id`s, no duplicates, the same
 *      screens, and no seed value dropped. A document that fails is NOT shipped —
 *      the assembled build stands and the failure is written into the artifact's
 *      gaps, because a structure-losing rewrite that ships silently is the exact
 *      defect this module exists to end.
 *
 * Every function here is pure and takes no clock: the transformation is testable
 * end to end without a model call, which is the only way any of it can be
 * guarded.
 */
import { assemblePrototype, paletteFor, parentEntitiesFor, screenOptionsFor } from "./prototypeAssembly.ts";
import { generateSeed } from "./seedData.ts";
import { SCREEN_SPEC_CONTRACT, WIDGET_REGION_PREFIX, type PrototypeSpecSchema } from "./prototypeScreenSpec.ts";

/** The assembled build a refine starts from, plus everything a refine must preserve. */
export interface PrototypeBaseline {
  /** The assembled, self-contained document. The fallback when a refine fails. */
  html: string;
  /** Same ontology → same version. Stamped on the artifact for traceability. */
  fabricVersion: string;
  /** Every `data-fabric-id` the assembly rendered, sorted. The identity contract. */
  fabricIds: string[];
  /** Every `data-screen` the assembly rendered, sorted. The navigation contract. */
  screenIds: string[];
  /** Seed record ids and display names that actually reach the page, sorted. */
  seedValues: string[];
  /**
   * Every `data-region` the assembly rendered, sorted — the regions the client
   * renderer FILLS that are not fabric nodes: the persona queues, the approval
   * queues, and the summary bands a screen spec put on a screen. They carry no
   * `data-fabric-id` because the fabric never declared them (an invented id
   * would corrupt the delta's address space), and they are still structure a
   * refine must not drop, so they are checked the same way.
   */
  regionIds: string[];
  /** The assembled document's stylesheet — what a restyle replaces. */
  stylesheet: string;
  regionCount: number;
  /** What a screen spec may reference — derived from this ontology and this
   *  build's screens (see `prototypeScreenSpec.ts`). */
  specSchema: PrototypeSpecSchema;
  /**
   * The screen spec this baseline was ASSEMBLED WITH — the one a previous round
   * accepted, carried forward off the stored build exactly as the approved skin
   * is. Without it the skeleton is re-derived every run and the model's own
   * judgement would be discarded each time: the loop would turn without
   * accumulating. Null when no round has produced one.
   */
  screenSpec: unknown;
  /**
   * How many of the CARRIED spec's widgets this build draws, and what it could
   * not draw — re-validated against the current ontology on every run, so a
   * widget whose entity has since left the model is a stated miss rather than
   * one that quietly stopped appearing.
   */
  specAccepted: number;
  specViolations: string[];
  /**
   * RE-ASSEMBLE THIS BUILD WITH A SCREEN SPEC APPLIED. The closure is how the
   * ontology reaches the result handler without the handler having to hold it:
   * `resolvePrototypeDoc` is handed a baseline, and a spec can only be drawn by
   * the assembler that derived it. Null-safe — a baseline built without an
   * ontology (there is none) simply has no way to apply one.
   */
  applySpec(spec: unknown): { html: string; violations: string[]; accepted: number } | null;
}

/**
 * How much assembled HTML can be handed over and asked for back. The output
 * budget is the binding constraint (a build agent runs at 16k output tokens ≈
 * 60KB), and a document the model cannot finish comes back truncated, which
 * fails the post-condition and wastes the whole run. Below this the model gets
 * the document; above it, the stylesheet alone.
 *
 * WHY THIS MOVED FROM 40,000. The assembled document is no longer markup with
 * values baked into it: it carries a stylesheet AND a client renderer that
 * together are a fixed ~29KB floor before a single entity is added, because the
 * prototype is now a working application rather than pictures of one. At 40,000
 * even a TWO-ENTITY build (47KB) fell over the line, so the threshold had
 * stopped being a threshold — every build took the stylesheet path and document
 * mode was dead code. The ceiling itself has not moved; this sits under it with
 * less room than before, and the failure mode is unchanged and safe: a
 * truncated answer fails the post-condition and the assembled build is kept.
 *
 * The right fix is smaller than this number: the renderer and the data island
 * are exactly the two things the contract FORBIDS the model to change, so
 * neither needs to be in the document it is asked to return. Eliding them on
 * the way out and restoring them on the way back would take ~17KB off both
 * sides and make the guarantee structural instead of asked-for.
 *
 * WHY IT MOVED AGAIN, from 52,000. The stylesheet grew by ~1.4KB when the
 * summary-band vocabulary joined the design system — a fixed cost every build
 * carries whether or not a screen spec ever asks for a band, because one
 * stylesheet is what makes a restyle reach every screen at once. That pushed the
 * two-entity fixture (54.3KB) back over the line and would have killed document
 * mode a second time for a reason that has nothing to do with how much ontology
 * a build holds. The CEILING is still the model's output budget and still has
 * not moved; this sits under it with less room again, and the failure mode is
 * unchanged and safe.
 */
export const DOCUMENT_REFINE_BUDGET = 56_000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The values of one attribute across a document, in document order.
 *
 * Tolerant of every quoting form on purpose: a review of this area produced two
 * false readings, one of them a search for `class="` in HTML written with single
 * quotes that reported the feature absent. The model writes the HTML on the
 * refined path, so the reader cannot assume the assembler's own quoting.
 */
export function attrValuesIn(html: string, attribute: string): string[] {
  const re = new RegExp(`${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "gi");
  const out: string[] = [];
  for (let m = re.exec(html); m; m = re.exec(html)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

export function fabricIdsIn(html: string): string[] {
  return attrValuesIn(html, "data-fabric-id");
}
export function screenIdsIn(html: string): string[] {
  return attrValuesIn(html, "data-screen");
}
export function regionIdsIn(html: string): string[] {
  return attrValuesIn(html, "data-region");
}

/**
 * The document's CONTENT, as the set of its text nodes plus one flattened
 * string. Content is compared through this rather than through the markup: a
 * refine is allowed to move a value into a different element, and is not
 * allowed to drop it. Style bodies and executable script are not content.
 *
 * A JSON DATA ISLAND IS. The assembled build ships its seeded records as one
 * `<script type="application/json">` block and draws the rows from it at load,
 * so a reader that strips every script — which this did — sees a document
 * whose tables are empty and concludes the records were never there. The
 * consequence was not academic: `seedValues` is collected by asking what of the
 * seed reaches the page, and the post-condition below is the only thing
 * standing between a model rewrite and a silently emptied application. So the
 * island's strings are read as what they are, the page's content, one step
 * earlier than the browser reads them.
 *
 * An island that no longer parses contributes nothing, which is correct: a
 * candidate that corrupted the data block has dropped its records whatever its
 * markup looks like, and the check must say so rather than trust the bytes.
 */
export function documentText(html: string): { nodes: Set<string>; flat: string } {
  const nodes = new Set<string>();
  const stripped = html
    .replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, (_m, attrs: string, body: string) => {
      if (/type\s*=\s*(?:"[^"]*json[^"]*"|'[^']*json[^']*'|[^\s"'>]*json[^\s"'>]*)/i.test(attrs)) collectJsonStrings(body, nodes);
      return " ";
    })
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const parts: string[] = [];
  for (const raw of stripped.split(/<[^>]*>/)) {
    const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
    if (!text) continue;
    nodes.add(text);
    parts.push(text);
  }
  return { nodes, flat: parts.join(" ") };
}

/** Every string a JSON data island holds, at any depth. Object KEYS are not
 *  content — they are the island's schema, and a value that happens to equal
 *  one must not be counted present because the schema names it. */
function collectJsonStrings(body: string, into: Set<string>): void {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return; }
  const walk = (v: unknown, depth: number): void => {
    if (depth > 12) return;
    if (typeof v === "string") { const t = v.trim(); if (t) into.add(t); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (v && typeof v === "object") { for (const x of Object.values(v)) walk(x, depth + 1); }
  };
  walk(parsed, 0);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** The contents of the document's first `<style>` block ("" when it has none). */
export function stylesheetIn(html: string): string {
  const m = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html);
  return m ? m[1] : "";
}

/**
 * The assembled document wearing a different stylesheet.
 *
 * This is the whole of a restyle: the markup — and therefore every
 * `data-fabric-id`, every screen and every seeded value — is the assembler's,
 * untouched, so the post-condition holds by construction rather than by
 * inspection. Anything in the replacement that could close the block early or
 * open a script is removed: the model's CSS is untrusted input.
 */
export function withStylesheet(html: string, css: string): string {
  const safe = String(css ?? "").replace(/<\/\s*style/gi, "&lt;/style").replace(/<\s*script/gi, "&lt;script");
  const m = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html);
  if (!m) return html.replace(/<\/head>/i, `<style>${safe}</style></head>`);
  return html.slice(0, m.index) + `<style>${safe}</style>` + html.slice(m.index + m[0].length);
}

/**
 * Assemble the baseline a refine starts from.
 *
 * Deterministic and re-derivable: the context builder and the result handler
 * each call this on the same record and get the same document, so the build the
 * model was shown and the build its answer is checked against cannot diverge.
 * Returns null when the record cannot produce an assembly at all — the caller
 * then falls back to the free-form path rather than pretending it has a skeleton.
 */
export function prototypeBaselineFor(
  ontology: unknown,
  atlas: unknown,
  experienceDesign?: unknown,
  /** The programme's other stored inputs. They must be the SAME ones the studio
   *  and the stakeholder's link assemble with: this baseline is what a refine is
   *  checked against, and a baseline missing an input the studio had would
   *  reject the operator's own build for structure it never lost. */
  inputs: { vocabulary?: unknown; blueprint?: unknown; screenSpec?: unknown } = {},
): PrototypeBaseline | null {
  if (!isRecord(ontology) || !isRecord(atlas)) return null;
  try {
    const parents = parentEntitiesFor(experienceDesign);
    const carried = inputs.screenSpec ?? null;
    /** THE ONE ASSEMBLY, called with the carried spec and with a new one. Both
     *  calls must pass the same inputs or the build the model was shown and the
     *  build its spec is drawn into are two different applications. */
    const assemble = (spec: unknown = carried) => assemblePrototype(ontology, atlas, parents, {
      vocabulary: inputs.vocabulary,
      theme: paletteFor(experienceDesign),
      // What each screen leads with is authored on the SAME document as the
      // menu. A baseline assembled without it is a different application from
      // the one the operator is looking at, and the post-condition would check
      // the model's answer against a build nobody asked for.
      screenOptions: screenOptionsFor(experienceDesign),
      blueprint: inputs.blueprint,
      ...(spec == null ? {} : { spec }),
    });
    const { html, fabric, regionCount, specSchema, specAccepted, specViolations } = assemble();
    if (!regionCount) return null;
    // THE SAME SEED THE PAGE WAS DRAWN FROM. This called `generateSeed` without
    // the vocabulary while the assembly above was passed it — so on any
    // programme that HAS a value vocabulary the two seeds produced different
    // strings, almost none of the guarded set survived the `text.nodes.has`
    // filter below, and the post-condition quietly shrank to guarding nothing.
    // A safety check that silently stops checking is worse than none: it
    // reports PASS on a refine that dropped the client's data.
    const seed = generateSeed(ontology, fabric.version, { vocabulary: inputs.vocabulary });
    const text = documentText(html);
    // WHAT THE PAGE SAYS, from the seed that said it. Every string a seeded
    // record carries — its id, its display name, and each of its own values —
    // that ACTUALLY reaches the rendered text. Filtering by presence is what
    // makes this a fact about the document rather than about the seeder: a value
    // the assembly formats (a sum, a percentage) or does not show simply is not
    // in the set, so the check can never demand something that was never there.
    const values = new Set<string>();
    for (const rows of Object.values(seed.records)) {
      for (const row of rows) {
        for (const v of Object.values(row)) {
          const s = typeof v === "string" ? v.trim() : "";
          if (s.length >= 2 && s.length <= 160 && text.nodes.has(s)) values.add(s);
        }
      }
    }
    return {
      html,
      fabricVersion: fabric.version,
      fabricIds: [...new Set(fabricIdsIn(html))].sort(),
      screenIds: [...new Set(screenIdsIn(html))].sort(),
      seedValues: [...values].sort(),
      regionIds: [...new Set(regionIdsIn(html))].sort(),
      stylesheet: stylesheetIn(html),
      regionCount,
      specSchema,
      screenSpec: carried,
      specAccepted,
      specViolations,
      applySpec(spec: unknown) {
        try {
          const out = assemble(spec);
          return { html: out.html, violations: out.specViolations, accepted: out.specAccepted };
        } catch {
          return null;
        }
      },
    };
  } catch {
    return null;
  }
}

/**
 * THE SKIN ALREADY APPROVED, KEPT.
 *
 * The skeleton is re-assembled every run, so without this the baseline would
 * arrive wearing the stock stylesheet and each round would discard the round
 * before it — the delivery loop would turn without accumulating. When the stored
 * build is structurally THIS assembly (identical id set, so it came from this
 * pipeline and from this ontology), its stylesheet is the one the operator has
 * been looking at: it becomes the baseline's skin, which makes it both the
 * starting point the model iterates from and the fallback a rejected refine
 * falls back to. A stored build from the old free-form path carries no fabric
 * ids, so it is correctly ignored rather than half-adopted.
 */
export function baselineWithPriorSkin(baseline: PrototypeBaseline, priorHtml: unknown): PrototypeBaseline {
  if (typeof priorHtml !== "string" || !priorHtml.trim()) return baseline;
  const ids = [...new Set(fabricIdsIn(priorHtml))].sort();
  if (ids.length !== baseline.fabricIds.length || ids.join(" ") !== baseline.fabricIds.join(" ")) return baseline;
  const css = stylesheetIn(priorHtml);
  if (!css.trim() || css === baseline.stylesheet) return baseline;
  return { ...baseline, html: withStylesheet(baseline.html, css), stylesheet: css };
}

/** Whether the model can be handed the whole document, or only its stylesheet. */
export function refineModeFor(baseline: PrototypeBaseline): "document" | "stylesheet" {
  return baseline.html.length <= DOCUMENT_REFINE_BUDGET ? "document" : "stylesheet";
}

/** What a refine must preserve, and what it may change. Shipped to the model verbatim. */
export const REFINE_CONTRACT = [
  "THE STRUCTURE IS ALREADY DERIVED — YOU ARE RESTYLING IT, NOT REBUILDING IT.",
  "The baseline in prototypeRefineBrief is ASSEMBLED deterministically from the domain ontology and the current-state atlas: its screens, its navigation, its regions and its seeded records ARE the record. You are not being asked to invent an application; one exists.",
  "NEVER alter structure. Every element carrying a data-fabric-id must still be there, exactly once, with the same id — that attribute is how an incremental change resolves to the region it touches, so an id you drop, rename, duplicate or invent breaks the pipeline downstream of you.",
  "NEVER alter navigation: the same data-screen ids, the same links between them.",
  "NEVER alter seed values: every record id, name and value the baseline shows must still be shown. You may re-present a value; you may not remove, replace or invent one.",
  'The baseline carries its records as ONE JSON data island — a <script type="application/json"> block — which the page renders into the regions at load. Return that block byte for byte. Editing it, reformatting it or dropping it empties every table in the application, and the check reads it as records lost.',
  "DO change presentation INSIDE the regions and in the stylesheet: spacing, hierarchy, type, colour, density, elevation, the component vocabulary, the chrome. That is the whole of your contribution and it is a large one.",
  "If the direction asks for something presentation cannot deliver without moving structure, DO NOT move the structure — name it in gaps instead, so it reaches the people who can change the ontology or the design.",
  "",
  SCREEN_SPEC_CONTRACT,
].join("\n");

export interface PrototypeChangeRequest { stakeholder: string; area: string; verdict: string; ask: string }

/** The refine brief handed to the build agent — pure, so what the model sees is guardable. */
export interface PrototypeRefineBrief {
  mode: "document" | "stylesheet";
  baselineSource: "assembled";
  round: number;
  fabricVersion: string;
  regionCount: number;
  contract: string;
  /** Document mode: the assembled application, to be returned restyled. */
  baselineHtml?: string;
  /** Stylesheet mode: the assembled application's stylesheet, to be returned rewritten. */
  baselineStylesheet?: string;
  /** Stylesheet mode: why the document itself is not in context. Stated, never implied. */
  baselineNote?: string;
  /** The screens the assembled build already has — so a direction naming one can be answered. */
  screenIds: string[];
  /**
   * WHAT A SCREEN SPEC MAY REFERENCE. Derived from the ontology, so the model is
   * choosing from what exists rather than recalling what it read: the screens,
   * the entities, and which of each entity's attributes can be measured and
   * which grouped by. A reference outside it is refused, never drawn.
   */
  screenSpecSchema: PrototypeSpecSchema;
  designInstruction: string;
  openChangeRequests: PrototypeChangeRequest[];
}

/** How many screen ids ride along. Enough to answer a direction that names a screen;
 *  bounded so a 33-entity ontology cannot push the brief past the context budget. */
const SCREEN_ID_CAP = 80;

export function buildPrototypeRefineBrief(
  baseline: PrototypeBaseline,
  direction: { round?: number; designInstruction?: string; openChangeRequests?: PrototypeChangeRequest[] } = {},
): PrototypeRefineBrief {
  const mode = refineModeFor(baseline);
  return {
    mode,
    baselineSource: "assembled",
    round: Math.max(1, Math.round(Number(direction.round)) || 1),
    fabricVersion: baseline.fabricVersion,
    regionCount: baseline.regionCount,
    contract: REFINE_CONTRACT,
    ...(mode === "document"
      ? { baselineHtml: baseline.html }
      : {
        baselineStylesheet: baseline.stylesheet,
        baselineNote: `The assembled application is ${baseline.html.length.toLocaleString("en-US")} characters — more than can be returned in one response, so it is NOT in your context and you must not attempt to reproduce it. Return "styleCss" only: a complete replacement stylesheet for the classes below. It is spliced into the assembled document, so the restyle reaches every one of its ${baseline.regionCount} regions and cannot disturb any of them.`,
      }),
    screenIds: baseline.screenIds.slice(0, SCREEN_ID_CAP),
    screenSpecSchema: baseline.specSchema,
    designInstruction: String(direction.designInstruction ?? ""),
    openChangeRequests: direction.openChangeRequests ?? [],
  };
}

/** What a returned document did to the structure it was told not to touch. */
export interface RefineVerdict {
  ok: boolean;
  droppedRegions: string[];
  addedRegions: string[];
  duplicatedRegions: string[];
  droppedScreens: string[];
  /** Filled regions (`data-region`) the returned document no longer has — the
   *  queues and the summary bands. Empty on a build that has none. */
  droppedFills: string[];
  droppedSeedValues: string[];
  /** One line per breach, in the operator's language. Empty when ok. */
  violations: string[];
}

/** How many misses are spelled out before the list is summarised. */
const NAMED = 6;
/** Beyond this many missing values the document is a rewrite, not a refine — stop counting. */
const VALUE_MISS_CAP = 500;

/**
 * THE POST-CONDITION. Pure, and the only thing standing between a model's
 * enthusiasm and a structure-losing rewrite in the record.
 */
export function checkRefinedPrototype(baseline: PrototypeBaseline, candidateHtml: string): RefineVerdict {
  const html = String(candidateHtml ?? "");
  const ids = fabricIdsIn(html);
  const idSet = new Set(ids);
  const baseSet = new Set(baseline.fabricIds);
  const seen = new Map<string, number>();
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  const droppedRegions = baseline.fabricIds.filter((id) => !idSet.has(id));
  const addedRegions = [...idSet].filter((id) => !baseSet.has(id)).sort();
  const duplicatedRegions = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id).sort();
  const screens = new Set(screenIdsIn(html));
  const droppedScreens = baseline.screenIds.filter((s) => !screens.has(s));
  // The client-filled regions are structure too: a queue or a summary band the
  // document no longer carries is a region that renders as nothing at all, and
  // it would otherwise pass every check here because it holds no fabric id.
  const fills = new Set(regionIdsIn(html));
  const droppedFills = (baseline.regionIds ?? []).filter((r) => !fills.has(r));

  const text = documentText(html);
  const droppedSeedValues: string[] = [];
  for (const value of baseline.seedValues) {
    if (text.nodes.has(value)) continue;
    // A refine may re-present a value inside different elements — the flattened
    // text is what says it is still ON THE PAGE, which is the property that matters.
    if (text.flat.includes(value)) continue;
    droppedSeedValues.push(value);
    if (droppedSeedValues.length >= VALUE_MISS_CAP) break;
  }

  const list = (xs: string[]) => xs.slice(0, NAMED).join(", ") + (xs.length > NAMED ? `, +${xs.length - NAMED} more` : "");
  const violations: string[] = [];
  if (droppedRegions.length) violations.push(`${droppedRegions.length} region${droppedRegions.length === 1 ? "" : "s"} lost their data-fabric-id (${list(droppedRegions)})`);
  if (addedRegions.length) violations.push(`${addedRegions.length} data-fabric-id${addedRegions.length === 1 ? " was" : "s were"} invented (${list(addedRegions)})`);
  if (duplicatedRegions.length) violations.push(`${duplicatedRegions.length} data-fabric-id${duplicatedRegions.length === 1 ? " appears" : "s appear"} more than once (${list(duplicatedRegions)})`);
  if (droppedScreens.length) violations.push(`${droppedScreens.length} screen${droppedScreens.length === 1 ? "" : "s"} disappeared (${list(droppedScreens)})`);
  if (droppedFills.length) violations.push(`${droppedFills.length} filled region${droppedFills.length === 1 ? "" : "s"} disappeared — a queue or a summary band the page draws into (${list(droppedFills)})`);
  if (droppedSeedValues.length) violations.push(`${droppedSeedValues.length} seeded value${droppedSeedValues.length === 1 ? "" : "s"} no longer appear (${list(droppedSeedValues)})`);
  return {
    ok: violations.length === 0,
    droppedRegions, addedRegions, duplicatedRegions, droppedScreens, droppedFills, droppedSeedValues, violations,
  };
}

export interface PrototypeResolution {
  /** The document to store: the model's when it honoured the contract, the assembly otherwise. */
  doc: Record<string, unknown>;
  source: "refined" | "restyled" | "assembled";
  verdict: RefineVerdict | null;
}

/**
 * WHAT ACTUALLY GETS STORED, and what the operator is told about it.
 *
 * A refine that honoured the contract ships. A restyle ships (its structure is
 * the assembler's by construction). Anything else keeps the ASSEMBLED build and
 * says so in `gaps` — the artifact's own visible-miss channel — because the
 * failure mode this replaces was a silent one: a rewrite that looked plausible,
 * dropped three entities, and reported `gaps: []`.
 */
export function resolvePrototypeDoc(
  doc: Record<string, unknown>,
  baseline: PrototypeBaseline,
): PrototypeResolution {
  const gaps: string[] = (Array.isArray(doc.gaps) ? doc.gaps : []).map((g) => String(g));
  const candidate = typeof doc.html === "string" ? doc.html.trim() : "";
  const css = typeof doc.styleCss === "string" ? doc.styleCss.trim() : "";
  // THE SPEC IS DRAWN BEFORE ANYTHING ELSE IS JUDGED, because everything after
  // it is measured against the build the operator will actually get.
  const { baseline: effective, notes: specNotes, widgets, spec } = applyScreenSpec(doc.screenSpec, baseline);
  const stamp = (html: string, source: PrototypeResolution["source"], verdict: RefineVerdict | null, notes: string[]) => {
    const out: Record<string, unknown> = { ...doc, html, gaps: [...gaps, ...specNotes, ...notes] };
    delete out.styleCss;
    // THE SPEC THAT PRODUCED THIS BUILD IS STORED WITH IT, so the next round
    // re-assembles the same application rather than one the model's judgement
    // has quietly fallen out of. A round that drew nothing stores nothing.
    if (spec == null) delete out.screenSpec; else out.screenSpec = spec;
    out._prototypeStructure = {
      source,
      fabricVersion: baseline.fabricVersion,
      regionCount: baseline.regionCount,
      widgets,
      violations: verdict ? verdict.violations : [],
    };
    return { doc: out, source, verdict };
  };

  let verdict: RefineVerdict | null = null;
  if (candidate) {
    verdict = checkRefinedPrototype(effective, candidate);
    if (verdict.ok) return stamp(candidate, "refined", verdict, []);
  }
  const rejected = verdict && !verdict.ok
    ? [`The refined document was NOT stored: it broke the assembled structure — ${verdict.violations.join("; ")}. The assembled build stands; ask again in presentation terms, or change the ontology if the structure itself is wrong.`]
    : [];
  if (css) {
    const restyled = withStylesheet(effective.html, css);
    const check = checkRefinedPrototype(effective, restyled);
    if (check.ok) return stamp(restyled, "restyled", check, rejected);
    return stamp(effective.html, "assembled", check, [
      ...rejected,
      `The replacement stylesheet was NOT applied: ${check.violations.join("; ")}.`,
    ]);
  }
  return stamp(effective.html, "assembled", verdict, rejected.length ? rejected : (candidate || widgets
    ? []
    : ["The model returned no refinement this run, so the assembled build stands unchanged."]));
}

/**
 * THE MODEL'S SCREEN SPEC, DRAWN BY THE ASSEMBLER.
 *
 * The model contributes the judgement — which screen deserves a funnel, which
 * number leads a list — and the deterministic renderer produces the markup, so
 * a widget cannot float over a table, cannot name a record type the ontology
 * does not hold, and cannot carry a heading that disagrees with its own rows.
 *
 * Everything refused is REPORTED: a reference the schema does not allow, a
 * filter value no record holds, a spec that draws nothing at all. That is the
 * whole difference from the path this replaces, which dropped three entities
 * and reported `gaps: []`.
 *
 * The returned baseline is the one every later check measures against — a
 * document handed back without the bands has dropped them, and that is a
 * structural loss like any other.
 */
function applyScreenSpec(
  spec: unknown,
  baseline: PrototypeBaseline,
): { baseline: PrototypeBaseline; notes: string[]; widgets: number; spec: unknown } {
  // NO NEW SPEC MEANS THE CARRIED ONE STANDS. The baseline was already
  // assembled with whatever a previous round accepted, so a round in which the
  // model says nothing about the screens leaves them exactly as they were.
  const carried = baseline.screenSpec ?? null;
  if (spec == null) {
    return {
      baseline,
      // What the carried spec still draws, and what this ontology can no longer
      // honour of it — stated every run, not only the run that authored it.
      notes: baseline.specViolations ?? [],
      widgets: baseline.specAccepted ?? 0,
      spec: carried,
    };
  }
  const applied = typeof baseline.applySpec === "function" ? baseline.applySpec(spec) : null;
  if (!applied) {
    return { baseline, widgets: 0, spec: carried, notes: ["The screen spec was not drawn: this build has no assembly to draw it into."] };
  }
  const notes = [...applied.violations];
  if (!applied.accepted) {
    notes.push("The screen spec added nothing to the build: no widget in it resolved against this ontology.");
    return { baseline, notes, widgets: 0, spec: carried };
  }
  // The skin the operator has already approved rides on the re-assembled
  // skeleton, exactly as it does for the baseline itself.
  const html = withStylesheet(applied.html, baseline.stylesheet);
  // BELT AND BRACES. The widgets are additive by construction, and this is what
  // says so rather than assuming it: a spec that somehow cost the build a region,
  // a screen or a seeded value is refused like any other structure loss.
  // The bands are the ONE thing a new spec is entitled to change — round two may
  // put the funnel on a different screen — so they come out of the comparison
  // here. Everything else the assembly derived is still held to.
  const check = checkRefinedPrototype(
    { ...baseline, regionIds: baseline.regionIds.filter((r) => !r.startsWith(WIDGET_REGION_PREFIX)) },
    html,
  );
  if (!check.ok) {
    notes.push(`The screen spec was NOT applied: drawing it would have changed the assembled structure — ${check.violations.join("; ")}.`);
    return { baseline, notes, widgets: 0, spec: carried };
  }
  return {
    baseline: { ...baseline, html, regionIds: [...new Set(regionIdsIn(html))].sort() },
    notes,
    widgets: applied.accepted,
    spec,
  };
}
