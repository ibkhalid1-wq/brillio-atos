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
import { assemblePrototype, parentEntitiesFor } from "./prototypeAssembly.ts";
import { generateSeed } from "./seedData.ts";

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
  /** The assembled document's stylesheet — what a restyle replaces. */
  stylesheet: string;
  regionCount: number;
}

/**
 * How much assembled HTML can be handed over and asked for back. The output
 * budget is the binding constraint (a build agent runs at 16k output tokens ≈
 * 60KB), and a document the model cannot finish comes back truncated, which
 * fails the post-condition and wastes the whole run. Below this the model gets
 * the document; above it, the stylesheet alone.
 */
export const DOCUMENT_REFINE_BUDGET = 40_000;

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

/**
 * The document's rendered TEXT, as the set of its text nodes plus one flattened
 * string. Content is compared through this rather than through the markup: a
 * refine is allowed to move a value into a different element, and is not allowed
 * to drop it. Script and style bodies are not content.
 */
export function documentText(html: string): { nodes: Set<string>; flat: string } {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const nodes = new Set<string>();
  const parts: string[] = [];
  for (const raw of stripped.split(/<[^>]*>/)) {
    const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
    if (!text) continue;
    nodes.add(text);
    parts.push(text);
  }
  return { nodes, flat: parts.join(" ") };
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
): PrototypeBaseline | null {
  if (!isRecord(ontology) || !isRecord(atlas)) return null;
  try {
    const parents = parentEntitiesFor(experienceDesign);
    const { html, fabric, regionCount } = assemblePrototype(ontology, atlas, parents);
    if (!regionCount) return null;
    const seed = generateSeed(ontology, fabric.version);
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
      stylesheet: stylesheetIn(html),
      regionCount,
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
  "DO change presentation INSIDE the regions and in the stylesheet: spacing, hierarchy, type, colour, density, elevation, the component vocabulary, the chrome. That is the whole of your contribution and it is a large one.",
  "If the direction asks for something presentation cannot deliver without moving structure, DO NOT move the structure — name it in gaps instead, so it reaches the people who can change the ontology or the design.",
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
  if (droppedSeedValues.length) violations.push(`${droppedSeedValues.length} seeded value${droppedSeedValues.length === 1 ? "" : "s"} no longer appear (${list(droppedSeedValues)})`);
  return {
    ok: violations.length === 0,
    droppedRegions, addedRegions, duplicatedRegions, droppedScreens, droppedSeedValues, violations,
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
  const stamp = (html: string, source: PrototypeResolution["source"], verdict: RefineVerdict | null, notes: string[]) => {
    const out: Record<string, unknown> = { ...doc, html, gaps: [...gaps, ...notes] };
    delete out.styleCss;
    out._prototypeStructure = {
      source,
      fabricVersion: baseline.fabricVersion,
      regionCount: baseline.regionCount,
      violations: verdict ? verdict.violations : [],
    };
    return { doc: out, source, verdict };
  };

  let verdict: RefineVerdict | null = null;
  if (candidate) {
    verdict = checkRefinedPrototype(baseline, candidate);
    if (verdict.ok) return stamp(candidate, "refined", verdict, []);
  }
  const rejected = verdict && !verdict.ok
    ? [`The refined document was NOT stored: it broke the assembled structure — ${verdict.violations.join("; ")}. The assembled build stands; ask again in presentation terms, or change the ontology if the structure itself is wrong.`]
    : [];
  if (css) {
    const restyled = withStylesheet(baseline.html, css);
    const check = checkRefinedPrototype(baseline, restyled);
    if (check.ok) return stamp(restyled, "restyled", check, rejected);
    return stamp(baseline.html, "assembled", check, [
      ...rejected,
      `The replacement stylesheet was NOT applied: ${check.violations.join("; ")}.`,
    ]);
  }
  return stamp(baseline.html, "assembled", verdict, rejected.length ? rejected : (candidate
    ? []
    : ["The model returned no refinement this run, so the assembled build stands unchanged."]));
}
