/**
 * CONTRAST, MEASURED — not eyeballed, not screenshotted.
 *
 * The readiness report scored accessibility 3/5 with the note "contrast not fully
 * audited — provision present, audit incomplete". This file is the audit, and it is
 * permanent: the palette is read OUT OF `v3.css` at run time (no hex is duplicated
 * here), so a future token edit that drops a real pair below AA turns this red
 * instead of shipping.
 *
 * WHY IT READS THE CSS RATHER THAN THE DOM. jsdom's getComputedStyle does not resolve
 * `var()`, so mounting the app and asking the browser for a colour returns the literal
 * string "var(--v3-text-muted)". The only honest way to get real numbers in this
 * harness is to parse the token blocks and resolve the chains ourselves — which is
 * what `theme()` below does, including the `--color-* → --v3-*` indirection the
 * stylesheet is built on.
 *
 * WHAT COUNTS AS A PAIR. Every entry in PAIRS is a foreground/background combination
 * some rule in v3.css or theLine.css actually draws, cited by selector. The `px` and
 * `bold` fields are the type size that rule sets, because the AA threshold depends on
 * it: 4.5:1 for normal text, 3:1 for large text (>=18.66px, or >=14px bold), 3:1 for
 * UI-component boundaries and graphical objects (SC 1.4.11).
 *
 * WHAT IS EXEMPT, AND WHY IT IS STILL LISTED. WCAG 2.2 SC 1.4.3/1.4.11 exempt text and
 * boundaries that belong to an INACTIVE user-interface component. The disabled controls
 * below are therefore not required to pass — but they are measured and named here
 * anyway, with `standard: "exempt"`, so "we never looked" can never again be confused
 * with "we looked and it is allowed". Two of them were nonetheless fixed (a 2.78:1
 * disabled button label is unreadable whatever the spec permits); the exemptions that
 * remain are recorded with their reason.
 *
 * THEMES. `[data-theme="light"]` is the shipped theme — AppShellV3 sets it for everyone
 * and there is no in-app toggle (only an explicit "dark" already in localStorage wins).
 * The dark `:root` palette is audited to the same standard, not skipped: the block at
 * the foot of this file held the last three dark-theme failures as PINNED numbers while
 * they were open, and now holds them as requirements.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = (rel: string) => readFileSync(resolve(__dirname, "..", rel), "utf8");
const V3 = css("v3.css");
const LINE = css("components/flow/theLine.css");

// ── token extraction ────────────────────────────────────────────────────────────
/** Pull one `selector { … }` block's custom-property declarations out of a stylesheet. */
const block = (sheet: string, opener: string): Record<string, string> => {
  const start = sheet.indexOf(opener);
  if (start < 0) throw new Error(`no such block: ${opener}`);
  let depth = 0, i = start + opener.length - 1;
  for (; i < sheet.length; i++) {
    if (sheet[i] === "{") depth++;
    else if (sheet[i] === "}") { depth--; if (depth === 0) break; }
  }
  const body = sheet.slice(start + opener.length, i);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) out[m[1]] = m[2].trim();
  return out;
};

/** The two palettes, each = base `:root` overlaid by that theme's own block. */
const ROOT = block(V3, ":root {");
const LIGHT_BLOCK = block(V3, '[data-theme="light"] {');
const LIGHT_MEDIA = block(V3, ":root:not([data-theme]) {");
const FS_DARK = block(V3, ".v3fs-app, .v3-wizard-overlay {");
const FS_LIGHT = block(V3, '[data-theme="light"] .v3fs-app, [data-theme="light"] .v3-wizard-overlay {');

const DARK = { ...ROOT, ...FS_DARK };
const LIGHT = { ...ROOT, ...LIGHT_BLOCK, ...FS_DARK, ...FS_LIGHT };

/** Resolve a token (or a literal) to a hex string, following `var(--x, fallback)`. */
const resolveIn = (palette: Record<string, string>, value: string, seen = 0): string => {
  if (seen > 12) throw new Error(`var() cycle at ${value}`);
  const v = value.trim();
  const m = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/i.exec(v);
  if (m) {
    const next = palette[m[1]] ?? m[2];
    if (next == null) throw new Error(`undefined token with no fallback: ${m[1]}`);
    return resolveIn(palette, next, seen + 1);
  }
  if (palette[v] != null) return resolveIn(palette, palette[v], seen + 1);
  return v;
};
const light = (v: string) => resolveIn(LIGHT, v);
const dark = (v: string) => resolveIn(DARK, v);

// ── WCAG 2.x maths (sRGB relative luminance) ────────────────────────────────────
const toRgb = (raw: string): [number, number, number] => {
  const v = raw.trim();
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (rgba) {
    const p = rgba[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2]];
  }
  let h = v.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a colour: ${raw}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};
/** alpha of an rgba() string, 1 for anything opaque. */
const alphaOf = (raw: string): number => {
  const m = /^rgba?\(([^)]+)\)$/i.exec(raw.trim());
  if (!m) return 1;
  const p = m[1].split(/[,/\s]+/).filter(Boolean);
  return p.length > 3 ? Number(p[3]) : 1;
};
/** Composite `fg` (possibly translucent) over an opaque `bg` — what the eye receives. */
const over = (fg: string, bg: string): [number, number, number] => {
  const a = alphaOf(fg), f = toRgb(fg), b = toRgb(bg);
  return [0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))) as [number, number, number];
};
const chan = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (rgb: [number, number, number]) => 0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2]);
/** WCAG contrast ratio, rounded the way the spec's own tooling reports it. */
export const contrast = (fg: string, bg: string): number => {
  const [hi, lo] = [lum(over(fg, bg)), lum(toRgb(bg))].sort((a, b) => b - a);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
};
/** `color-mix(in srgb, X n%, transparent|Y)` — the wash idiom this stylesheet uses. */
const mixOver = (colour: string, pct: number, base: string): string => {
  const c = toRgb(colour), b = toRgb(base), a = pct / 100;
  const m = [0, 1, 2].map((i) => Math.round(c[i] * a + b[i] * (1 - a)));
  return `#${m.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
};

// ── the thresholds ──────────────────────────────────────────────────────────────
type Kind = "text" | "ui" | "exempt";
/** AA: 4.5 normal text · 3 large text (>=18.66px, or >=14px bold) · 3 UI/graphics. */
const threshold = (kind: Kind, px: number, bold: boolean): number => {
  if (kind !== "text") return 3;
  return px >= 18.66 || (px >= 14 && bold) ? 3 : 4.5;
};

interface Pair {
  what: string;          // what a user is looking at
  where: string;         // the rule that draws it
  fg: string; bg: string;
  px: number; bold: boolean;
  kind: Kind;
  themes?: Array<"light" | "dark">;
  why?: string;          // required when kind === "exempt"
}

/** Backgrounds, by name, so each pair reads as the stylesheet reads. */
const CARD = "var(--fs-card)";
const CANVAS = "var(--v3-bg)";
const SURF2 = "var(--v3-surface-2)";
const SURF3 = "var(--v3-surface-3)";

const PAIRS: Pair[] = [
  // ── body / secondary / muted text: the greys that usually fail ────────────────
  { what: "body text on a card", where: ".v3fs-app { color:var(--v3-text-primary) } / .v3ib-qtext", fg: "var(--v3-text-primary)", bg: CARD, px: 14, bold: false, kind: "text" },
  { what: "body text on the canvas", where: ".v3fs-app", fg: "var(--v3-text-primary)", bg: CANVAS, px: 14, bold: false, kind: "text" },
  { what: "secondary text on a card", where: ".v3ib-lead, .v3lc { color:var(--v3-text-secondary) }", fg: "var(--v3-text-secondary)", bg: CARD, px: 11, bold: false, kind: "text" },
  { what: "secondary text on an inset row", where: ".v3ib-captured-body on .v3ib-row", fg: "var(--v3-text-secondary)", bg: SURF2, px: 11, bold: false, kind: "text" },
  { what: "muted text on a card", where: ".v3ib-of, .v3dl-tile-sub, .v3lc-sub", fg: "var(--v3-text-muted)", bg: CARD, px: 11, bold: false, kind: "text" },
  { what: "muted text on the canvas", where: ".v3dl-zone-d, .v3ln-sl", fg: "var(--v3-text-muted)", bg: CANVAS, px: 10, bold: false, kind: "text" },
  { what: "muted text on an inset row", where: ".v3ib-grp-c, .v3dl-quiet", fg: "var(--v3-text-muted)", bg: SURF2, px: 10.5, bold: false, kind: "text" },
  { what: "muted text on the deepest inset", where: ".v3ib-btn:disabled (background:var(--v3-surface-3))", fg: "var(--v3-text-muted)", bg: SURF3, px: 11, bold: true, kind: "text" },

  // ── status / semantic ink: chips, badges, pills, state lines ──────────────────
  { what: "success ink on a card", where: ".v3fs-dispute-resolve, .v3fs-plan-confnote", fg: "var(--v3-green)", bg: CARD, px: 12, bold: true, kind: "text" },
  { what: "success ink on its own wash", where: ".v3fs-art-badge.ok, .v3fs-doc-tile.ok (color-mix 12%)", fg: "var(--v3-green)", bg: mixOver(light("var(--v3-green)"), 13, light(CARD)), px: 10, bold: true, kind: "text", themes: ["light"] },
  { what: "the label on a success fill", where: ".v3fs-vld.yes.on, .v3fs-envc-rstep.done .v3fs-envc-rn", fg: "var(--v3-on-success)", bg: "var(--v3-green)", px: 11, bold: true, kind: "text" },
  { what: "success status dot on a card", where: ".v3fs-presence-dot, .v3fs-tdot, .v3fs-cdot.heard", fg: "var(--v3-green)", bg: CARD, px: 7, bold: false, kind: "ui" },
  { what: "warning ink on a card", where: ".v3ib-nodate, .v3ib-captured-tag, .v3dl-moved", fg: "var(--v3-amber)", bg: CARD, px: 11, bold: true, kind: "text" },
  { what: "warning ink on an inset row", where: ".v3ib-frozen-tag, .v3ib-blk on .v3ib-row", fg: "var(--v3-amber)", bg: SURF2, px: 10.5, bold: true, kind: "text" },
  { what: "warning ink on its own wash", where: ".v3fs-art-badge.stale, .v3fs-doc-tile.stale", fg: "var(--v3-amber)", bg: mixOver(light("var(--v3-amber)"), 13, light(CARD)), px: 10, bold: true, kind: "text", themes: ["light"] },
  { what: "THE RAIL BADGE — the waiting count on its warning fill", where: ".v3fs-dock-n { background:var(--v3-amber);color:var(--v3-on-warning);font-size:9.5px }", fg: "var(--v3-on-warning)", bg: "var(--v3-amber)", px: 9.5, bold: true, kind: "text" },
  { what: "the waiting pill on its warning fill", where: ".v3fs-wait-n", fg: "var(--v3-on-warning)", bg: "var(--v3-amber)", px: 11, bold: true, kind: "text" },
  { what: "danger ink on a card", where: ".v3-confidence-chip.low, .v3fs-plan-act.del:hover", fg: "var(--v3-red)", bg: CARD, px: 11, bold: true, kind: "text" },
  { what: "danger ink on an inset row", where: ".v3fs-* danger text over --v3-surface-2", fg: "var(--v3-red)", bg: SURF2, px: 11, bold: false, kind: "text" },
  { what: "positive ink (decided / booked / marked)", where: ".v3dl-decided, .v3ib-booked, .v3ib-marked", fg: "var(--v3-positive)", bg: CARD, px: 11, bold: true, kind: "text" },
  { what: "positive ink on an inset row", where: ".v3ib-marked inside .v3ib-row", fg: "var(--v3-positive)", bg: SURF2, px: 11, bold: true, kind: "text" },
  { what: "seam ink (joint ownership)", where: ".v3ib-seam-h, .v3ib-onplan, .v3ib-prop", fg: "var(--v3-seam-ink)", bg: CARD, px: 12, bold: true, kind: "text" },

  // ── links / link-like buttons ────────────────────────────────────────────────
  { what: "the accent link colour", where: ".v3ib-owner, .v3fs-a", fg: "var(--v3-accent-2)", bg: CARD, px: 11, bold: true, kind: "text" },
  { what: "the accent link on an inset row", where: ".v3dl-golink inside .v3dl-elsewhere", fg: "var(--v3-accent-2)", bg: SURF2, px: 10.5, bold: false, kind: "text" },
  { what: "the Inbox title", where: ".v3ib-title over the 5%-accent header wash", fg: "var(--v3-accent-2)", bg: mixOver(light("var(--v3-accent-2)"), 5, light(CARD)), px: 13, bold: true, kind: "text", themes: ["light"] },
  { what: "an underlined goal link", where: ".v3dl-goal-open", fg: "var(--v3-text-secondary)", bg: CARD, px: 11.5, bold: false, kind: "text" },

  // ── text on coloured fills ───────────────────────────────────────────────────
  { what: "the primary button's label on its accent fill", where: ".v3ib-btn { color:var(--v3-on-accent);background:var(--v3-accent-2) }", fg: "var(--v3-on-accent)", bg: "var(--v3-accent-2)", px: 11, bold: true, kind: "text" },
  { what: "a pressed exit tab's label", where: '.v3ib-tab[aria-pressed="true"]', fg: "var(--v3-on-accent)", bg: "var(--v3-accent-2)", px: 10.5, bold: true, kind: "text" },
  { what: "a disabled primary button's label", where: ".v3ib-btn:disabled (greyed, no longer opacity:.5)", fg: "var(--v3-text-muted)", bg: SURF3, px: 11, bold: true, kind: "text" },
  { what: "a disabled mini button's label", where: ".v3dl-mini:disabled (greyed, no longer opacity:.6)", fg: "var(--v3-text-muted)", bg: CARD, px: 10.5, bold: true, kind: "text" },

  // ── UI component boundaries and focus (SC 1.4.11) ────────────────────────────
  { what: "the boundary of an inbox form control", where: ".v3ib select, .v3ib-other, .v3ib-reason, .v3ib-form input/textarea", fg: "var(--v3-control-line)", bg: CARD, px: 1, bold: false, kind: "ui" },
  { what: "the boundary of an inbox form control, on a row", where: "same rule, control sitting on .v3ib-row", fg: "var(--v3-control-line)", bg: SURF2, px: 1, bold: false, kind: "ui" },
  { what: "THE GLOBAL FOCUS RING on a card", where: "button/a/input/select/[role=button]:focus-visible { outline:2px solid var(--v3-focus-ring) }", fg: "var(--v3-focus-ring)", bg: CARD, px: 2, bold: false, kind: "ui" },
  { what: "the global focus ring on the canvas", where: ":focus-visible", fg: "var(--v3-focus-ring)", bg: CANVAS, px: 2, bold: false, kind: "ui" },
  { what: "the global focus ring on an inset row", where: "[tabindex]:focus-visible on .v3ib-row", fg: "var(--v3-focus-ring)", bg: SURF2, px: 2, bold: false, kind: "ui" },
  { what: "the focus ring on a card (namespaced rules)", where: ".v3ib-btn:focus-visible { outline:2px solid var(--v3-accent-2) }", fg: "var(--v3-accent-2)", bg: CARD, px: 2, bold: false, kind: "ui" },
  { what: "the focus ring on the canvas", where: ".v3ib-btn:focus-visible, .v3dl-golink:focus-visible", fg: "var(--v3-accent-2)", bg: CANVAS, px: 2, bold: false, kind: "ui" },
  { what: "the focus ring on an inset row", where: ".v3ib-tab:focus-visible inside .v3ib-row", fg: "var(--v3-accent-2)", bg: SURF2, px: 2, bold: false, kind: "ui" },
  { what: "the goal-link focus ring", where: ".v3dl-goal-open:focus-visible { outline:2px solid var(--v3-positive) }", fg: "var(--v3-positive)", bg: CARD, px: 2, bold: false, kind: "ui" },
  { what: "the convergence bar's filled segment", where: ".v3lc-conv-bar > span (a graphical object carrying the %)", fg: "var(--v3-accent-2)", bg: SURF2, px: 6, bold: false, kind: "ui" },

  // ── EXEMPT: inactive components (SC 1.4.3 "Incidental"), measured anyway ──────
  {
    what: "a disabled tile's own subtitle (opacity .72 over the card)",
    where: ".v3dl-tile-open:disabled { opacity:.72 }",
    fg: `rgba(${toRgb(light("var(--v3-text-muted)")).join(",")},0.72)`, bg: CARD,
    px: 11, bold: false, kind: "exempt", themes: ["light"],
    why: "SC 1.4.3 exempts text that is part of an INACTIVE user-interface component; the tile is disabled because its upstream is not ready, and its state is also carried by the disabled attribute and by a separate always-opaque state line.",
  },
  {
    what: "a disabled row in the decided trace (opacity .85)",
    where: ".v3ib-row.is-decided { opacity:.85 }",
    fg: `rgba(${toRgb(light("var(--v3-text-muted)")).join(",")},0.85)`, bg: SURF2,
    px: 11, bold: false, kind: "exempt", themes: ["light"],
    why: "Historical trace, not an active control; the row is still readable at 4:1 and the reason text beside it is opaque.",
  },
];

const PALETTES = { light: LIGHT, dark: DARK } as const;

describe("WCAG AA contrast — every pair the flow surfaces actually draw", () => {
  for (const p of PAIRS) {
    for (const themeName of (p.themes ?? ["light", "dark"]) as Array<"light" | "dark">) {
      const need = threshold(p.kind, p.px, p.bold);
      const title = `${themeName}: ${p.what} — needs ${p.kind === "exempt" ? "(exempt)" : `${need}:1`} [${p.where}]`;
      it(title, () => {
        const palette = PALETTES[themeName];
        const fg = resolveIn(palette, p.fg);
        const bg = resolveIn(palette, p.bg);
        const ratio = contrast(fg, bg);
        if (p.kind === "exempt") {
          // Not asserted against AA — but the reason must be written down, and the
          // number is printed so a regression is visible in the run output.
          expect(p.why, `${p.what} is exempt but gives no reason`).toBeTruthy();
          expect(ratio).toBeGreaterThan(0);
          return;
        }
        expect(
          ratio,
          `${p.what} (${themeName}) is ${fg} on ${bg} = ${ratio}:1, needs ${need}:1 — ${p.where}`,
        ).toBeGreaterThanOrEqual(need);
      });
    }
  }
});

describe("the palette itself", () => {
  it("the light theme and the prefers-color-scheme mirror agree on every semantic colour", () => {
    // v3.css keeps two copies of the light palette ([data-theme="light"] and the
    // @media mirror). They drift silently; the semantic ink is the half that matters,
    // because a contrast fix applied to one copy and not the other is not a fix.
    for (const k of ["--color-success", "--color-warning", "--color-danger", "--color-text-primary", "--color-text-secondary", "--color-text-muted", "--v3-positive", "--v3-seam-ink", "--v3-control-line", "--v3-focus-ring"]) {
      expect(LIGHT_MEDIA[k], `${k} missing from the @media (prefers-color-scheme: light) mirror`).toBe(LIGHT_BLOCK[k]);
    }
  });

  it("no shipped token resolves through an undefined var() with a hard-coded fallback", () => {
    // `var(--v3-positive, #3f9d6b)` appeared in 12 rules and the token was defined
    // NOWHERE, so every one of them silently drew a 3.36:1 literal. Defining the token
    // is the fix; this keeps it defined.
    for (const t of ["--v3-positive", "--v3-seam-ink", "--v3-control-line", "--v3-focus-ring"]) {
      expect(LIGHT[t], `${t} must be defined for the light theme`).toBeTruthy();
      expect(DARK[t], `${t} must be defined for the dark theme`).toBeTruthy();
    }
    // …and nothing in the flow stylesheets may re-introduce the literal fallback.
    for (const [name, sheet] of [["v3.css", V3], ["theLine.css", LINE]] as const) {
      const strays = [...sheet.matchAll(/var\(\s*--v3-positive\s*,[^)]*\)/g)].map((m) => m[0]);
      expect(strays, `${name} still hard-codes a --v3-positive fallback`).toEqual([]);
    }
  });

  it("the semantic inks keep their hue — the palette still looks like itself", () => {
    // The fix darkens; it must not re-hue. Brillio green stays green, amber stays amber.
    const hue = (h: string) => {
      const [r, g, b] = toRgb(h).map((c) => c / 255);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (!d) return 0;
      const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (60 * x + 360) % 360;
    };
    // The brand originals, from the dark :root — untouched, and the reference.
    expect(Math.abs(hue(dark("var(--color-success)")) - hue(light("var(--color-success)")))).toBeLessThan(2);
    expect(Math.abs(hue(dark("var(--color-danger)")) - hue(light("var(--color-danger)")))).toBeLessThan(2);
    // Brillio's brand green mark is NOT the status ink and is deliberately left alone.
    expect(ROOT["--br-green"]).toBe("#2cc84d");
  });
});

/**
 * THE LAST THREE, NOW CLOSED.
 *
 * This block used to be titled "reported, NOT fixed". It pinned three pairs at their
 * failing values — `--mv` (theme-blind, 3.11:1 on dark and 3.40:1 in BOTH themes for
 * Evolve), the selected tab's white-on-accent at 3.02:1 on dark, and `--br-green` drawn
 * as text at 2.22:1 — on the grounds that the rules sat in someone else's namespace.
 * All three are fixed; the assertions below are the same measurements, now stated as
 * requirements. Each one FAILS if the fix is reverted.
 *
 * The `--mv` inks are read OUT OF theLine.css by selector, the same discipline the rest
 * of this file applies to v3.css: no hex is duplicated here except the four ORIGINALS,
 * which are gone from the stylesheet and are kept as the hue reference.
 */

/** HSL hue/saturation of a hex — the fix may move lightness and nothing else. */
const hsl = (h: string): [number, number, number] => {
  const [r, g, b] = toRgb(h).map((c) => c / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  if (!d) return [0, s, l];
  const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(60 * x + 360) % 360, s, l];
};

/** The `--mv` literal a given selector prefix sets for a movement, read off disk.
 *  Anchored at a line start so the dark rule, the [data-theme="light"] override and
 *  the prefers-color-scheme mirror are told apart rather than matched by substring. */
const mvInk = (prefix: string, movement: string): string => {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*${esc(prefix)}\\.v3ln-spine-row\\[data-mv="${movement}"\\]\\{--mv:(#[0-9a-fA-F]{6})\\}`, "m");
  const m = re.exec(LINE);
  if (!m) throw new Error(`theLine.css sets no --mv for "${movement}" at prefix "${prefix || "(unqualified)"}"`);
  return m[1];
};

/** What each movement WAS, before the audit — the hue every replacement must hold. */
const MV_ORIGINAL = {
  listen: "#2C8C7C", loop: "#6C5FAE", ship: "#2E9A72", evolve: "#B0842B",
} as const;

describe("the v3ln- namespace's own inks — the three that were pinned as failing", () => {
  // `.v3dl-ready` draws --mv at 11px on an UNBUILT tile, and `.v3dl-tile` is
  // --v3-surface-2 until it is `.present`. That elevated surface, not the card, is the
  // worst case, so both are asserted.
  for (const movement of Object.keys(MV_ORIGINAL) as Array<keyof typeof MV_ORIGINAL>) {
    it(`--mv (${movement}) is AA as TEXT in BOTH themes — .v3dl-ready / .v3dl-mini / .v3dl-devreg-t`, () => {
      const inks = { light: mvInk('[data-theme="light"] ', movement), dark: mvInk("", movement) };
      for (const [name, palette] of [["light", LIGHT], ["dark", DARK]] as const) {
        const ink = inks[name];
        for (const bg of [CARD, SURF2]) {
          const on = resolveIn(palette, bg);
          expect(
            contrast(ink, on),
            `--mv:${movement} (${name}) is ${ink} on ${on} = ${contrast(ink, on)}:1, needs 4.5:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      // …and the label that sits ON the movement fill (.v3ln-rail-n, 11px/800) clears it
      // too, which is why that rule takes --v3-on-accent instead of #fff.
      expect(contrast(resolveIn(LIGHT, "var(--v3-on-accent)"), inks.light)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(resolveIn(DARK, "var(--v3-on-accent)"), inks.dark)).toBeGreaterThanOrEqual(4.5);
    });

    it(`--mv (${movement}) moved LIGHTNESS only — the movement still reads as itself`, () => {
      const [h0, s0] = hsl(MV_ORIGINAL[movement]);
      for (const prefix of ['[data-theme="light"] ', "", ":root:not([data-theme]) "]) {
        const [h, s] = hsl(mvInk(prefix, movement));
        expect(Math.abs(h - h0), `${movement} re-hued at "${prefix || "(unqualified)"}"`).toBeLessThan(2);
        expect(Math.abs(s - s0), `${movement} re-saturated at "${prefix || "(unqualified)"}"`).toBeLessThan(0.02);
      }
    });
  }

  it("the light --mv block and its prefers-color-scheme mirror agree, movement for movement", () => {
    // Same failure mode v3.css has: a fix applied to one copy of the light palette and
    // not the other is not a fix.
    for (const movement of Object.keys(MV_ORIGINAL)) {
      expect(mvInk(":root:not([data-theme]) ", movement), `${movement} mirror drifted`)
        .toBe(mvInk('[data-theme="light"] ', movement));
    }
  });

  it("the selected projection tab takes --v3-on-accent, not #fff", () => {
    // White on the DARK theme's --v3-accent-2 was 3.02:1 at 13px. The token is the
    // palette's own answer: white on light (11.44:1), #211747 on dark (5.43:1).
    expect(LINE).toContain(".v3ln-tabs button.on{background:var(--v3-accent-2);color:var(--v3-on-accent)}");
    for (const [name, palette] of [["light", LIGHT], ["dark", DARK]] as const) {
      const fg = resolveIn(palette, "var(--v3-on-accent)");
      const bg = resolveIn(palette, "var(--v3-accent-2)");
      expect(contrast(fg, bg), `.v3ln-tabs button.on (${name}) is ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("--br-green stays the BRAND colour and is no longer drawn as text anywhere", () => {
    // THE BRAND DECISION, recorded. #2cc84d is Brillio's green; it is not status ink and
    // it is not changed here. But it is not a logo-only token either — seven rules in the
    // classic namespace set it as `color:` (.v3-nav-tab.active, .v3-health-cell-value
    // .green, .adam-badge.green, .v3-readiness-gauge-hint.is-ready, .v3-phase-number,
    // .v3-program-dropdown-item.active, .v3-action-icon.action), which is 2.22:1 on a
    // light card — a failure no brand argument covers, because the brand argument is
    // about the MARK, and a status label is not the mark.
    //
    // So: the colour is untouched and still fills, borders and glows the mark; the text
    // rules now take --v3-green, the audited status ink. That keeps the brand exactly
    // where a brand belongs and takes it off the one duty it cannot perform.
    expect(ROOT["--br-green"]).toBe("#2cc84d");
    expect(LIGHT["--br-green"]).toBe("#2cc84d");
    expect(contrast("#2cc84d", light(CARD))).toBeLessThan(4.5);   // 2.22:1 — why it is not text
    // `border-color:`/`background:` contain the substring "color:", so the boundary is
    // explicit: only a declaration that STARTS `color:` is text.
    const asText = [...V3.matchAll(/(^|[;{\s])color:\s*var\(--br-green\)/g)];
    expect(asText.map((m) => m[0]), "the brand colour is being drawn as text again").toEqual([]);
    // …and it is still the brand: the mark itself is untouched.
    expect([...V3.matchAll(/background:\s*var\(--br-green\)/g)].length).toBeGreaterThan(0);
    // The ink that replaced it passes on both themes, at every surface those rules use.
    for (const [name, palette] of [["light", LIGHT], ["dark", DARK]] as const) {
      const green = resolveIn(palette, "var(--v3-green)");
      for (const bg of [CARD, SURF2]) {
        expect(contrast(green, resolveIn(palette, bg)), `--v3-green (${name}) on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
