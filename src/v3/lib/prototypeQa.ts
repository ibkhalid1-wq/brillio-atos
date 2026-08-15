/**
 * A RENDER-BASED QA GATE FOR A GENERATED PROTOTYPE.
 *
 * The free-form (model-written) prototype path ships defects that no schema
 * check can see, because they are properties of the RENDERED DOCUMENT rather
 * than of the JSON around it. On a reviewed CRM build, all four of these were
 * true at once:
 *
 *   1. stat cards positioned out of flow over the tables, hiding columns on
 *      every screen;
 *   2. the page script threw on load;
 *   3. three ontology entities appeared nowhere in the app while `gaps` came
 *      back `[]` — the miss was silent, which is the one thing it may never be;
 *   4. a row badged "Qualified (BANT)" sat inside a table headed
 *      "Leads (Unqualified)" — the header and its own rows contradicting.
 *
 * So this module reads a LOADED DOCUMENT (plus the console output of loading
 * it) and reports each of the four as a finding. It takes the document and a
 * `styleOf` accessor rather than reaching for a global `window`, so the same
 * code runs against a test-time DOM, against the studio's preview frame, or
 * against any other host that can hand it a parsed document.
 *
 * WHAT IS PROVEN AND WHAT IS NOT — read this before trusting a pass.
 *
 * The DOM available here resolves the CSS CASCADE but performs NO LAYOUT:
 * `getComputedStyle` returns the winning declarations, `getBoundingClientRect`
 * returns zeros. Exact pixel boxes therefore exist only for elements whose
 * geometry is DECLARED. Rather than pretend otherwise, the overlap check
 * asserts the property that does not need a layout engine:
 *
 *   An out-of-flow element (`position:absolute`) reserves NO space. Anything
 *   in normal flow inside the same containing block is laid out as if it were
 *   not there, and it paints on top. If the containing block also holds an
 *   in-flow `<table>` and reserves no room for the card (padding on the side
 *   the card is anchored to), the card is painted across the band that table
 *   flows through. That is decidable from declarations alone, and it is the
 *   shape of the defect.
 *
 * The bias on the undecidable cases is deliberate: an out-of-flow card over a
 * table's flow whose box cannot be resolved is reported as an ERROR, not
 * waved through — a generator that cannot be shown to be safe should be told
 * to lay the card out in flow. Cases that are genuinely a different intent
 * (viewport-anchored `position:fixed` chrome, elements hidden at load such as
 * modals and toasts, and small chrome like a close button) are reported as
 * WARNINGS: visible in the report, not a failure. Nothing is dropped silently.
 */

export type QaCheck = "layout-overlap" | "console-errors" | "entity-coverage" | "header-agreement";
export type QaSeverity = "error" | "warning";

export interface QaFinding {
  check: QaCheck;
  severity: QaSeverity;
  /** One sentence, written to be quoted straight back to whoever built the page. */
  message: string;
  /** Where in the document — a screen id, a heading, a row index. */
  where?: string;
}

export interface PrototypeQaInput {
  doc: Document;
  /** The host's computed-style accessor (`(el) => window.getComputedStyle(el)`). */
  styleOf: (el: Element) => CSSStyleDeclaration;
  /** Errors the host captured while loading the document. */
  consoleErrors?: readonly string[];
  /** Ontology entity names the build was supposed to cover. */
  entities?: readonly string[];
  /** What the builder DECLARED it could not do — an entity named here is not a miss. */
  gaps?: readonly string[];
}

export interface PrototypeQaReport {
  passed: boolean;
  findings: QaFinding[];
  errors: QaFinding[];
  warnings: QaFinding[];
  byCheck: Record<QaCheck, QaFinding[]>;
}

// ── small shared helpers ──────────────────────────────────────────────────────

const TEXTLESS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);

/**
 * The text a reader would see, with element boundaries kept apart.
 *
 * `textContent` concatenates across boundaries — a card head of "Opportunity"
 * plus a count badge of "12" reads back as "Opportunity12", which then fails
 * every word-level comparison this module makes.
 */
export function visibleText(node: Node): string {
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) { parts.push(String(n.nodeValue ?? "")); return; }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    if (TEXTLESS.has(el.tagName)) return;
    for (const c of Array.from(el.childNodes)) walk(c);
  };
  walk(node);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Lowercased, punctuation-flattened — the form every comparison here uses. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => norm(s).split(" ").filter(Boolean);

/** A length in CSS pixels, or null when the declaration cannot be resolved
 *  without a layout engine (`auto`, a percentage, `calc(...)`). */
export function pxOf(value: string | null | undefined): number | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const m = /^(-?\d*\.?\d+)px$/.exec(v);
  if (m) return Number(m[1]);
  if (/^-?\d*\.?\d+$/.test(v)) return Number(v);
  return null;
}

/** A locator a person can find: the nearest identified ancestor, then the heading. */
function locate(el: Element): string {
  for (let p: Element | null = el; p; p = p.parentElement) {
    const screen = p.getAttribute?.("data-screen");
    if (screen) return `screen "${screen}"`;
    const id = p.getAttribute?.("id");
    if (id) return `#${id}`;
    const fabric = p.getAttribute?.("data-fabric-id");
    if (fabric) return `region "${fabric}"`;
  }
  return el.tagName.toLowerCase();
}

// ── CHECK 1 · out-of-flow cards painted over a table's flow ───────────────────

/**
 * Only elements a stylesheet or an inline style could have taken out of flow
 * are examined — `getComputedStyle` on every node of a 480 KB build is minutes
 * of work for an answer that is `static` almost everywhere.
 *
 * This is a CANDIDATE FILTER, not the decision: every candidate's position and
 * geometry are then read from the cascade, so a rule that is overridden later,
 * or one that never matches, changes nothing. It cannot miss, either — a
 * computed `position` other than `static` has to come from a `position`
 * declaration somewhere, and a negative margin from a `margin` declaration.
 */
function displacementCandidates(doc: Document): Element[] {
  const selectors = new Set<string>();
  const collect = (rules: CSSRuleList | undefined) => {
    for (const rule of Array.from(rules ?? [])) {
      const style = (rule as CSSStyleRule).style;
      const selector = (rule as CSSStyleRule).selectorText;
      if (selector && style) {
        const declaresPosition = style.getPropertyValue("position").trim() !== "";
        const negativeMargin = /(^|-)margin/.test(style.cssText) && /-\d/.test(style.cssText);
        if (declaresPosition || negativeMargin) selectors.add(selector);
      }
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested) collect(nested);
    }
  };
  for (const sheet of Array.from(doc.styleSheets ?? [])) {
    try { collect((sheet as CSSStyleSheet).cssRules); } catch { /* cross-origin sheet — nothing to read */ }
  }
  const out = new Set<Element>();
  for (const selector of selectors) {
    let matched: NodeListOf<Element>;
    try { matched = doc.querySelectorAll(selector); } catch { continue; } // a selector this DOM cannot parse
    for (const el of Array.from(matched)) out.add(el);
  }
  for (const el of Array.from(doc.querySelectorAll("[style]"))) {
    if (/position|margin/i.test(el.getAttribute("style") ?? "")) out.add(el);
  }
  return [...out];
}

const outOfFlow = (position: string) => position === "absolute" || position === "fixed";

/** The box an absolutely positioned element resolves against. */
function containingBlockOf(el: Element, styleOf: (e: Element) => CSSStyleDeclaration): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const cs = styleOf(p);
    if (cs.position && cs.position !== "static") return p;
    if (cs.transform && cs.transform !== "none") return p;
  }
  return el.ownerDocument?.documentElement ?? null;
}

/** Hidden AT LOAD — a modal or a toast, which is meant to cover content when
 *  it is summoned. A screen that is merely `hidden` for in-page routing is not
 *  hidden in this sense: it is another page of the same app, and its layout
 *  has to hold, so only the element itself is consulted, never an ancestor. */
function hiddenAtLoad(el: Element, styleOf: (e: Element) => CSSStyleDeclaration): boolean {
  const cs = styleOf(el);
  if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return true;
  return el.getAttribute("aria-hidden") === "true";
}

/** In flow, all the way up to the containing block. */
function inFlowWithin(el: Element, root: Element, styleOf: (e: Element) => CSSStyleDeclaration): boolean {
  for (let p: Element | null = el; p && p !== root; p = p.parentElement) {
    if (outOfFlow(styleOf(p).position)) return false;
  }
  return true;
}

function checkOverlap(input: PrototypeQaInput): QaFinding[] {
  const { doc, styleOf } = input;
  const findings: QaFinding[] = [];
  for (const el of displacementCandidates(doc)) {
    const cs = styleOf(el);
    const position = cs.position;

    // ── the in-flow case: a negative margin pulls an element back OVER its
    // neighbour, and that displacement is exact — no layout engine needed.
    if (!outOfFlow(position)) {
      const before = pxOf(cs.marginTop);
      const after = pxOf(cs.marginBottom);
      const neighbour = (n: Element | null) => n && (n.tagName === "TABLE" || n.querySelector("table"));
      if (before != null && before <= -8 && neighbour(el.previousElementSibling)) {
        findings.push({
          check: "layout-overlap", severity: "error", where: locate(el),
          message: `A ${el.tagName.toLowerCase()} element is pulled ${Math.abs(before)}px up by a negative margin-top, over the table immediately above it — it covers the table's last ${Math.abs(before)}px.`,
        });
      }
      if (after != null && after <= -8 && neighbour(el.nextElementSibling)) {
        findings.push({
          check: "layout-overlap", severity: "error", where: locate(el),
          message: `A ${el.tagName.toLowerCase()} element is pulled ${Math.abs(after)}px down by a negative margin-bottom, over the table immediately below it.`,
        });
      }
      continue;
    }

    // ── the out-of-flow case
    const container = containingBlockOf(el, styleOf);
    if (!container) continue;
    const tables = Array.from(container.querySelectorAll("table"))
      .filter((t) => !el.contains(t) && inFlowWithin(t, container, styleOf));
    if (!tables.length) continue;  // nothing in flow here for the card to cover

    const detail = `${tables.length} table${tables.length === 1 ? "" : "s"} flow inside it`;
    if (hiddenAtLoad(el, styleOf)) {
      findings.push({
        check: "layout-overlap", severity: "warning", where: locate(el),
        message: `An out-of-flow element is hidden at load above a container where ${detail} — an overlay of this kind cannot be checked from its declarations; confirm it is a summoned overlay and not a card that will paint over the table.`,
      });
      continue;
    }
    if (position === "fixed") {
      findings.push({
        check: "layout-overlap", severity: "warning", where: locate(el),
        message: `A position:fixed element is anchored to the viewport above a container where ${detail} — viewport chrome is not checked here; confirm it does not sit over the table.`,
      });
      continue;
    }

    const width = pxOf(cs.width);
    const height = pxOf(cs.height);
    const top = pxOf(cs.top);
    const bottom = pxOf(cs.bottom);
    const left = pxOf(cs.left);
    const right = pxOf(cs.right);
    const containerStyle = styleOf(container);
    const padTop = pxOf(containerStyle.paddingTop) ?? 0;
    const padBottom = pxOf(containerStyle.paddingBottom) ?? 0;
    const padLeft = pxOf(containerStyle.paddingLeft) ?? 0;
    const padRight = pxOf(containerStyle.paddingRight) ?? 0;

    // Space RESERVED for the card is the one thing that makes this safe: the
    // container's own padding on the side the card is anchored to holds the
    // card clear of the band its in-flow content occupies.
    const reserved =
      (top != null && height != null && top + height <= padTop)
      || (bottom != null && height != null && bottom + height <= padBottom)
      || (left != null && width != null && left + width <= padLeft)
      || (right != null && width != null && right + width <= padRight);
    if (reserved) continue;

    // Chrome too small to hide a column of a table — a close button, a corner
    // badge. Reported, never failed on.
    if (width != null && height != null && (width < 96 || height < 32)) {
      findings.push({
        check: "layout-overlap", severity: "warning", where: locate(el),
        message: `A small out-of-flow element (${width}×${height}px) sits over a container where ${detail}, with no space reserved for it — too small to hide a column, but it does paint over the table's flow.`,
      });
      continue;
    }

    const box = width != null && height != null
      ? `its declared box is ${width}×${height}px`
      : `its box cannot be resolved from its declarations (width ${cs.width || "auto"}, height ${cs.height || "auto"})`;
    findings.push({
      check: "layout-overlap", severity: "error", where: locate(el),
      message: `An out-of-flow element (position:absolute) is painted over the flow of a container where ${detail}, and the container reserves no space for it (padding ${padTop}/${padRight}/${padBottom}/${padLeft}px) — ${box}. A card that must not cover the table has to be laid out in flow, or the container has to reserve room for it.`,
    });
  }
  return findings;
}

// ── CHECK 2 · the page threw while loading ───────────────────────────────────

function checkConsole(input: PrototypeQaInput): QaFinding[] {
  return (input.consoleErrors ?? []).map((message) => ({
    check: "console-errors" as const, severity: "error" as const,
    message: `The prototype logged an error while loading: ${message}`,
  }));
}

// ── CHECK 3 · every ontology entity present, or declared missing ─────────────

/** The forms a rendered app is entitled to use for one entity name. */
function entityForms(name: string): string[] {
  const base = norm(name);
  if (!base) return [];
  const head = base.replace(/\s+\S+$/, "");
  const tail = base.slice(head.length).trim();
  const plural = (w: string) => (/(s|x|z|ch|sh)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);
  const forms = new Set([base, plural(base)]);
  // "Opportunity Line Item" also renders as "Opportunity Line Items"; a
  // multi-word entity pluralises on its last word, not on the phrase.
  if (tail) forms.add(`${head} ${plural(tail)}`);
  return [...forms];
}

const mentions = (haystack: string, name: string) =>
  entityForms(name).some((form) => new RegExp(`(^| )${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(haystack));

function checkEntityCoverage(input: PrototypeQaInput): QaFinding[] {
  const entities = input.entities ?? [];
  if (!entities.length) return [];
  const body = input.doc.body ?? input.doc.documentElement;
  // What a person can read, plus what the app navigates BY — an entity present
  // only as a nav target with an abbreviated label is still present.
  const rendered = ` ${norm(visibleText(body))} `;
  const attributes = ` ${norm(Array.from(body.querySelectorAll("[data-screen],[data-nav],[data-fabric-id],[aria-label],[title]"))
    .map((el) => ["data-screen", "data-nav", "data-fabric-id", "aria-label", "title"].map((a) => el.getAttribute(a) ?? "").join(" "))
    .join(" "))} `;
  const declared = ` ${norm((input.gaps ?? []).join(" | "))} `;
  const findings: QaFinding[] = [];
  for (const entity of entities) {
    if (!String(entity ?? "").trim()) continue;
    if (mentions(rendered, entity) || mentions(attributes, entity)) continue;
    if (mentions(declared, entity)) {
      findings.push({
        check: "entity-coverage", severity: "warning",
        message: `Ontology entity "${entity}" does not appear in the build, but the build declares it in gaps — a miss that stays visible.`,
      });
      continue;
    }
    findings.push({
      check: "entity-coverage", severity: "error",
      message: `Ontology entity "${entity}" appears nowhere in the rendered app and nothing in gaps accounts for it — it was dropped silently. Either render it or name it in gaps.`,
    });
  }
  return findings;
}

// ── CHECK 4 · a section header agrees with its own rows ──────────────────────

interface Section { table: Element; root: Element; heading: string; }

/**
 * The heading a table sits under, found STRUCTURALLY — the nearest text-bearing
 * element that precedes the table, walking outward. Nothing here keys on a
 * class name: a guard pinned to `.m-card-t` passes on one generator and sees
 * nothing at all on the next one, which is exactly the free-form path this
 * gate exists to police.
 */
function sectionsOf(doc: Document): Section[] {
  const sections: Section[] = [];
  for (const table of Array.from(doc.querySelectorAll("table"))) {
    const caption = table.querySelector("caption");
    if (caption && visibleText(caption)) {
      sections.push({ table, root: table.parentElement ?? table, heading: visibleText(caption) });
      continue;
    }
    let node: Element = table;
    for (let hop = 0; hop < 4 && node.parentElement; hop++) {
      const parent: Element = node.parentElement;
      const kids = Array.from(parent.children);
      const before = kids.slice(0, kids.indexOf(node)).map(visibleText).filter(Boolean);
      const heading = before[before.length - 1] ?? "";
      // A wall of prose above a table is not a heading; this table has none,
      // and a check with no header to compare against makes no claim.
      if (heading) {
        if (heading.length <= 160) sections.push({ table, root: parent, heading });
        break;
      }
      node = parent;
    }
  }
  return sections;
}

const NEGATORS = ["un", "non", "in", "im", "ir", "il", "dis", "not"];
/**
 * "unqualified" is the negation of "qualified", and "unpaid" of "paid".
 *
 * The base has to be long enough that the prefix is a real negation rather
 * than the first letters of an unrelated word: "input" is not the negation of
 * "put", "under" not of "der". Four characters is where that line sits — it
 * keeps `paid`, `sent`, `read` and `open`, which are the short states a CRM
 * table actually carries, and drops the three-letter accidents. Both sides of
 * this constant are pinned by the suite; moving it either way goes red.
 */
const MIN_NEGATABLE = 4;
const negates = (a: string, b: string) => b.length >= MIN_NEGATABLE && NEGATORS.some((p) => a === p + b || a === `${p}-${b}`);
const contradicts = (a: string, b: string) => negates(a, b) || negates(b, a);

/** A truncated table says so — "View all 12", "1–24 of 95", "Showing 5". */
const TRUNCATION = /\b(view all|show all|see all|showing|of \d|more\b|next\b|page \d)/i;

function checkHeaderAgreement(input: PrototypeQaInput): QaFinding[] {
  const findings: QaFinding[] = [];
  for (const { table, root, heading } of sectionsOf(input.doc)) {
    const headWords = new Set(words(heading));
    const rows = Array.from(table.querySelectorAll("tr")).filter((tr) => tr.querySelector("td"));

    // (a) the header states a value its own rows deny
    rows.forEach((tr, i) => {
      for (const cell of Array.from(tr.querySelectorAll("td"))) {
        const text = visibleText(cell);
        for (const value of words(text)) {
          for (const h of headWords) {
            if (!contradicts(h, value)) continue;
            findings.push({
              check: "header-agreement", severity: "error", where: `${locate(table)} › "${heading}" › row ${i + 1}`,
              message: `The section headed "${heading}" contains a row reading "${text}" — "${value}" contradicts the header's "${h}". A header that states a filter and rows that deny it cannot both be true.`,
            });
            return;
          }
        }
      }
    });

    // (b) the header states a count its own rows deny — unless the section says
    // it is showing a page of a longer list.
    const truncated = TRUNCATION.test(visibleText(root));
    if (truncated) continue;
    const stated = statedCounts(heading);
    for (const n of stated) {
      if (n === rows.length) continue;
      findings.push({
        check: "header-agreement", severity: "error", where: `${locate(table)} › "${heading}"`,
        message: `The section headed "${heading}" states ${n}, and its table renders ${rows.length} row${rows.length === 1 ? "" : "s"} with nothing saying the list is truncated.`,
      });
    }
  }
  return findings;
}

/**
 * The numbers in a heading that are CLAIMS ABOUT HOW MANY — a bare number
 * standing as its own token (the count badge every card carries), or a number
 * immediately before a noun ("24 records", "3 leads"). A number inside a word,
 * a year, or a currency figure is not one of these.
 */
function statedCounts(heading: string): number[] {
  const tokens = heading.split(/[^A-Za-z0-9%$.,]+/).filter(Boolean);
  const out: number[] = [];
  tokens.forEach((token, i) => {
    if (!/^\d{1,4}$/.test(token)) return;
    const n = Number(token);
    const next = (tokens[i + 1] ?? "").toLowerCase().replace(/[^a-z]/g, "");
    // "24 records", "3 leads" — a number quantifying a plural noun.
    if (next) { if (/s$/.test(next)) out.push(n); return; }
    // A number standing alone at the end of a heading is the count badge every
    // card carries. Capped, because "Pipeline 2026" is a year, not a count.
    if (n <= 999) out.push(n);
  });
  return out;
}

// ── the gate ─────────────────────────────────────────────────────────────────

export function auditPrototype(input: PrototypeQaInput): PrototypeQaReport {
  const findings = [
    ...checkOverlap(input),
    ...checkConsole(input),
    ...checkEntityCoverage(input),
    ...checkHeaderAgreement(input),
  ];
  const byCheck: Record<QaCheck, QaFinding[]> = {
    "layout-overlap": [], "console-errors": [], "entity-coverage": [], "header-agreement": [],
  };
  for (const f of findings) byCheck[f.check].push(f);
  const errors = findings.filter((f) => f.severity === "error");
  return { passed: errors.length === 0, findings, errors, warnings: findings.filter((f) => f.severity === "warning"), byCheck };
}

/**
 * The failures, written to be handed BACK to whoever produced the page — the
 * retry prompt on the model path, or the engineer on the assembled one. Each
 * line names the defect and where it is, because "QA failed" teaches nothing.
 */
export function qaFeedback(report: PrototypeQaReport): string {
  if (report.passed) return "";
  const lines = report.errors.map((f) => `- [${f.check}]${f.where ? ` ${f.where}:` : ""} ${f.message}`);
  const warned = report.warnings.map((f) => `- (warning) [${f.check}]${f.where ? ` ${f.where}:` : ""} ${f.message}`);
  return [
    `The prototype failed ${new Set(report.errors.map((f) => f.check)).size} of the 4 render checks. Fix every line below and return the whole document again.`,
    ...lines,
    ...(warned.length ? ["", "Also reported, not blocking:", ...warned] : []),
  ].join("\n");
}
