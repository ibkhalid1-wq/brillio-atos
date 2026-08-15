/**
 * LOAD A GENERATED PROTOTYPE THE WAY A BROWSER WOULD, and hand the result to
 * the render-QA gate (`src/v3/lib/prototypeQa.ts`).
 *
 * The point of the gate is that its input is a PARSED, SCRIPTED DOCUMENT, not
 * the HTML source: the two false readings that produced this work were both
 * regexes over source — one matched words in prose and reported a feature
 * present, another looked for `class="` in markup written with single quotes
 * and reported it absent. So the document is built here, the page's own
 * `<script>` runs, and every assertion downstream reads the cascade and the
 * tree.
 *
 * WHAT THIS ENVIRONMENT DOES AND DOES NOT DO. jsdom resolves the CSS cascade
 * (`getComputedStyle` returns the winning declarations) but performs no
 * layout, so `getBoundingClientRect()` is all zeros here — see the module
 * comment on the gate for what the overlap check proves without one.
 *
 * jsdom also reports its OWN unimplemented surfaces (`window.scrollTo`,
 * `HTMLCanvasElement`) through the same channel a page error arrives on. Those
 * are facts about this environment, not defects in the page, so they are split
 * out into `notImplemented` — kept, never merged into the page's errors, so
 * neither a real error is lost nor a fake one invented.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import type { PrototypeQaInput } from "@/v3/lib/prototypeQa";

export interface LoadedPrototype extends PrototypeQaInput {
  /** Errors the PAGE produced: uncaught exceptions, console.error calls. */
  consoleErrors: string[];
  /** Surfaces jsdom does not implement — this environment's limits, reported
   *  rather than silently swallowed. */
  notImplemented: string[];
  window: Window & typeof globalThis;
}

const NOT_IMPLEMENTED = /^not implemented/i;

export function loadPrototype(
  html: string,
  context: { entities?: readonly string[]; gaps?: readonly string[] } = {},
): LoadedPrototype {
  const consoleErrors: string[] = [];
  const notImplemented: string[] = [];
  /** Classified on the RAW message — jsdom prefixes nothing, so a decision
   *  made on a message this loader has already decorated would read its own
   *  formatting rather than what happened. */
  const record = (raw: string, formatted = raw) =>
    (NOT_IMPLEMENTED.test(raw) ? notImplemented : consoleErrors).push(formatted);

  const virtualConsole = new VirtualConsole();
  // An uncaught exception in the page's own script arrives as `jsdomError`.
  virtualConsole.on("jsdomError", (...args: unknown[]) => {
    const e = args[0] as { name?: string; message?: string; detail?: { message?: string } } | undefined;
    const raw = e?.detail?.message ?? e?.message ?? String(e);
    record(raw, `${e?.name ?? "Error"}: ${raw}`);
  });
  // …and an explicit console.error as `error`.
  virtualConsole.on("error", (...args: unknown[]) => record(args.map((a) => String(a)).join(" ")));

  const dom = new JSDOM(html, {
    url: "https://prototype.test/",
    runScripts: "dangerously",   // the page's script is the thing under test
    pretendToBeVisual: true,     // requestAnimationFrame, for pages that use it
    virtualConsole,
  });
  const { window } = dom;
  return {
    doc: window.document,
    styleOf: (el: Element) => window.getComputedStyle(el),
    consoleErrors,
    notImplemented,
    entities: context.entities,
    gaps: context.gaps,
    window,
  };
}
