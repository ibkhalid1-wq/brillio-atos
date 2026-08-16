/**
 * Meridian — the default design system for AURA-generated prototypes.
 *
 * Provenance: distilled from an internal reference enterprise CRM; codified here
 * engagement-neutral (no client, no product, no vendor name in any token or class).
 *
 * ONE definition. It supplies APPEARANCE only — colour, type, spacing, radii,
 * elevation, motion, and the component patterns that dress them. It knows nothing
 * about any ontology, entity, or engagement: the fabric supplies structure and the
 * seed data supplies content, and the three stay apart. A generated prototype that
 * links `meridianStylesheet()` and uses the `.m-*` classes inherits this look with
 * no per-engagement styling work; a governed `theme` (see `PrototypeTheme`) can
 * re-skin it by overriding `:root` custom properties without touching markup.
 *
 * Lives in `_shared` because BOTH runtimes render it: the operator's studio (Vite,
 * via the `@shared` alias) and flow-portal (Deno, by relative path). One copy — the
 * stakeholder's prototype and the operator's are the same bytes by construction.
 * That closes the gap recorded in docs/aura/artifact-schema-findings.md, where the
 * edge emitting `.m-*` markup was the outstanding piece.
 */

/** The governed, overridable token surface. Matches the shape the Experience
 * Design studio already edits (`experienceDesign.theme`), so a per-engagement
 * theme is a partial override of these. */
export interface PrototypeTheme {
  brand: string;        // primary / action colour
  brandSoft: string;    // tinted brand wash (selected rows, soft fills)
  accent: string;       // secondary emphasis (defaults to brand)
  ink: string;          // primary text
  inkSoft: string;      // secondary text
  muted: string;        // tertiary text / labels
  bg: string;           // page background
  surface: string;      // card / input surface
  surface2: string;     // elevated / hover surface
  line: string;         // borders / dividers
  positive: string;     // success / good
  warn: string;         // attention / pending
  danger: string;       // error / risk / destructive
  radius: number;       // base corner radius (px)
  fontSans: string;     // body + UI font stack
  fontDisplay: string;  // display / heading font stack
}

/**
 * The default token values. Neutral, professional, enterprise — a deep-indigo
 * house brand with green/amber/red semantics. Font stacks are system-first so a
 * sandboxed, self-contained prototype renders correctly with no webfont fetch
 * (Inter/Outfit are honoured when present, never required).
 */
export const MERIDIAN_TOKENS: PrototypeTheme = {
  brand: "#211747",
  brandSoft: "#eae8f2",
  accent: "#211747",
  ink: "#211747",
  inkSoft: "#443e5d",
  muted: "#625d74",
  bg: "#f4f3f7",
  surface: "#ffffff",
  surface2: "#faf9fc",
  line: "#e6e3ee",
  positive: "#177a2f",
  warn: "#9c5c0e", // AA on white (5.32:1); source #b26a12 failed AA-normal at 4.23
  danger: "#b3402a",
  radius: 12,
  fontSans: '"Inter", "Outfit", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontDisplay: '"Outfit", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

/**
 * ── A CLIENT'S PALETTE IS AN INPUT, AND AN INPUT IS UNTRUSTED ────────────────
 *
 * The palette arrives on the programme (`experienceDesign.theme`) — written by
 * a generator or typed by an operator — and is interpolated straight into a
 * `:root{…}` block inside the document's one `<style>` element. A value holding
 * `}` closes that block early and everything after it is markup the browser
 * reads as CSS; a value holding `</style>` ends the element. So each token is
 * checked against the SHAPE ITS SLOT ACCEPTS, and a value that does not fit its
 * slot keeps the Meridian default rather than being escaped into something
 * plausible: a half-honoured brand colour is a worse answer than the house one.
 *
 * Colours are hex or rgb()/rgba() because the chrome below is DERIVED from the
 * brand's luminance — a colour the assembler cannot read is a colour it cannot
 * pair text against, and it would ship an unreadable sidebar instead of saying
 * so.
 */
const COLOR_HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_RGB = /^rgba?\(\s*\d{1,3}(?:\.\d+)?\s*[, ]\s*\d{1,3}(?:\.\d+)?\s*[, ]\s*\d{1,3}(?:\.\d+)?\s*(?:[,/]\s*(?:\d*\.?\d+%?)\s*)?\)$/i;
/** A font stack: family names, quotes, commas, the generic keywords. Nothing
 *  that can carry a declaration, a comment or a tag. */
const FONT_STACK = /^[A-Za-z0-9 ,'"()._-]+$/;

/**
 * ── WHICH STATES CARRY A VERDICT ─────────────────────────────────────────────
 *
 * A status column used to render one grey badge for every value, and a health
 * column rendered EVERY value amber — so a record reading "Healthy" was drawn
 * as a warning and a "Closed Lost" deal looked exactly like a "Closed Won" one.
 * The benchmark's whole at-a-glance quality is this: a table you can read
 * without reading it.
 *
 * The rule that keeps it honest is what this table LEAVES OUT. A tone is only
 * assigned where the word itself states the verdict — "at risk", "overdue",
 * "won", "paid". Bare magnitudes are deliberately absent: "High" is good on an
 * influence column and bad on a risk column, and a design system that guesses
 * which would be colouring in its own assumption. Anything unmatched keeps the
 * neutral badge, which is the correct answer for a stage like "Prospecting".
 *
 * Ordered: the risk vocabulary is tested first, so "Closed Lost" cannot be
 * caught by the "closed" in a positive phrase.
 */
export type ValueTone = "good" | "warn" | "risk";
const TONE_RULES: Array<[ValueTone, RegExp]> = [
  ["risk", /\b(at[- ]?risk|off[- ]?track|closed[- ]?lost|lost|overdue|delinquent|cancel(l)?ed|rejected|declined|disqualified|failed|failing|blocked|expired|breach(ed)?|critical|escalated|churn(ed)?|void|stalled|unpaid|suspended)\b/i],
  ["good", /\b(healthy|on[- ]?track|active|live|closed[- ]?won|won|approved|signed|executed|complete(d)?|fulfilled|delivered|paid|settled|resolved|converted|accepted|qualified|commit(ted)?|current|ready|published|onboarded|success(ful)?)\b/i],
  ["warn", /\b(watch|pending|awaiting|on[- ]?hold|paused|in[- ]?review|under[- ]?review|monitoring|needs[- ]?attention|due[- ]?soon|escalating|at[- ]?capacity|degraded)\b/i],
];

/**
 * A QUALIFIER THAT WITHHOLDS THE VERDICT. "Partially Paid" contains "paid" and
 * read as settled — the same green as "Paid", on an invoice that is not
 * settled, which is the sort of detail a finance stakeholder spots in the first
 * ten seconds. A part-way state is attention, never completion. Observed on the
 * live build's Invoice column.
 */
const PARTIAL = /\b(partial(ly)?|partly|pending|awaiting|in[- ]?progress|provisional|conditional)\b/i;

/** The verdict a value states, or null when it states none. Pure and
 *  case-insensitive; the same value always tones the same way. */
export function valueTone(value: unknown): ValueTone | null {
  const v = String(value ?? "").trim();
  if (!v || v.length > 40) return null;
  for (const [tone, re] of TONE_RULES) {
    if (!re.test(v)) continue;
    // A qualifier only ever withholds a POSITIVE verdict: "partially paid" is
    // attention, while "partially cancelled" is still bad news.
    return tone === "good" && PARTIAL.test(v) ? "warn" : tone;
  }
  return null;
}

export function isColorToken(value: unknown): boolean {
  const v = String(value ?? "").trim();
  return COLOR_HEX.test(v) || COLOR_RGB.test(v);
}

/** A colour's three channels, 0–255 — or null when it is not one this module
 *  can read (which is the same as "cannot be paired", see above). */
function channelsOf(value: string): [number, number, number] | null {
  const v = value.trim();
  if (COLOR_HEX.test(v)) {
    const h = v.slice(1);
    const full = h.length <= 4 ? h.slice(0, 3).split("").map((c) => c + c).join("") : h.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  if (COLOR_RGB.test(v)) {
    const nums = v.replace(/^rgba?\(|\)$/gi, "").split(/[, /]+/).filter(Boolean).slice(0, 3).map(Number);
    return nums.length === 3 && nums.every((n) => Number.isFinite(n)) ? [nums[0], nums[1], nums[2]] as [number, number, number] : null;
  }
  return null;
}

/** WCAG relative luminance. Null for a colour this module cannot read. */
export function relativeLuminance(color: string): number | null {
  const ch = channelsOf(color);
  if (!ch) return null;
  const lin = ch.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two colours (1–21). Null if either is unreadable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a); const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `a` moved `t` of the way towards `b`, as hex. Pure integer arithmetic — the
 *  same palette always produces the same chrome, byte for byte. */
function mix(a: string, b: string, t: number): string {
  const ca = channelsOf(a); const cb = channelsOf(b);
  if (!ca || !cb) return a;
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${ca.map((c, i) => hex(c + (cb[i] - c) * t)).join("")}`;
}

/**
 * THE CHROME THE BRAND HAS TO CARRY.
 *
 * The sidebar is painted in the brand colour and its type used to be five fixed
 * tints of lilac chosen for ONE brand — the house indigo. Accepting a client's
 * palette while keeping those makes the re-skin a trap: a client whose brand is
 * yellow gets pale lilac navigation on it and the demo that was meant to land
 * as their product lands as unreadable.
 *
 * So what sits ON the brand is derived from the brand: whichever of white and
 * the palette's own ink contrasts more with it, then two steps back towards the
 * brand for secondary and tertiary type, and a mark that reads at UI-component
 * contrast. `--m-brand-strong` (the primary button's hover) leans the brand
 * TOWARDS its own text colour, so it lightens on a dark brand and darkens on a
 * light one without either case being special.
 */
export interface BrandChrome { onBrand: string; onBrandDim: string; onBrandMute: string; brandMark: string; brandStrong: string }
export function brandChrome(brand: string, ink: string): BrandChrome {
  const white = "#ffffff";
  const toWhite = contrastRatio(brand, white) ?? 0;
  const toInk = contrastRatio(brand, ink) ?? 0;
  const onBrand = toWhite >= toInk ? white : ink;
  return {
    onBrand,
    onBrandDim: mix(onBrand, brand, 0.14),
    onBrandMute: mix(onBrand, brand, 0.34),
    brandMark: mix(onBrand, brand, 0.24),
    brandStrong: mix(brand, onBrand, 0.12),
  };
}

/** Whether a value FITS ITS SLOT — the same shape check `resolveTheme` applies,
 * exported so a caller holding an untrusted partial (a model's `styleTokens`,
 * an operator's paste) can accept per-key instead of all-or-nothing. */
export function fitsThemeSlot(k: keyof PrototypeTheme, v: unknown): boolean {
  if (k === "radius") return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 64;
  if (k === "fontSans" || k === "fontDisplay") return typeof v === "string" && FONT_STACK.test(v);
  return isColorToken(v);
}

/** The slot-checked subset of an untrusted token map: every key that names a
 * theme token AND carries a value its slot accepts, nothing else. `rejected`
 * names what was refused so the caller can say so instead of half-honouring. */
export function themePatchOf(raw: unknown): { patch: Partial<PrototypeTheme>; rejected: string[] } {
  const patch: Partial<PrototypeTheme> = {};
  const rejected: string[] = [];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!(k in MERIDIAN_TOKENS)) { rejected.push(k); continue; }
      const key = k as keyof PrototypeTheme;
      if (fitsThemeSlot(key, v)) (patch as Record<string, unknown>)[key] = v;
      else rejected.push(k);
    }
  }
  return { patch, rejected };
}

/** Merge a partial (governed) theme over the defaults — absent/blank keys, and
 * any value that does not fit its slot, keep the Meridian default, so a sparse
 * (or hostile) `experienceDesign.theme` still yields a complete, coherent and
 * safely-interpolatable token set. */
export function resolveTheme(theme?: Partial<PrototypeTheme> | null): PrototypeTheme {
  const t = theme || {};
  const fits = fitsThemeSlot;
  const pick = <K extends keyof PrototypeTheme>(k: K): PrototypeTheme[K] => {
    const v = t[k];
    if (v === undefined || v === null || v === "") return MERIDIAN_TOKENS[k];
    return (fits(k, v) ? v : MERIDIAN_TOKENS[k]) as PrototypeTheme[K];
  };
  return {
    brand: pick("brand"), brandSoft: pick("brandSoft"), accent: pick("accent"),
    ink: pick("ink"), inkSoft: pick("inkSoft"), muted: pick("muted"),
    bg: pick("bg"), surface: pick("surface"), surface2: pick("surface2"), line: pick("line"),
    positive: pick("positive"), warn: pick("warn"), danger: pick("danger"),
    radius: pick("radius"), fontSans: pick("fontSans"), fontDisplay: pick("fontDisplay"),
  };
}

/** The `:root` custom-property block for a theme. This is the ONLY place colour
 * literals enter the CSS — every component rule reads a `--m-*` var, so a re-skin
 * is a variable swap. */
export function meridianRootVars(theme?: Partial<PrototypeTheme> | null): string {
  const t = resolveTheme(theme);
  const r = t.radius;
  const c = brandChrome(t.brand, t.ink);
  return `:root{
  --m-brand:${t.brand};--m-brand-soft:${t.brandSoft};--m-accent:${t.accent};
  --m-brand-strong:${c.brandStrong};--m-brand-mark:${c.brandMark};
  --m-on-brand:${c.onBrand};--m-on-brand-dim:${c.onBrandDim};--m-on-brand-mute:${c.onBrandMute};
  --m-ink:${t.ink};--m-ink-soft:${t.inkSoft};--m-muted:${t.muted};
  --m-bg:${t.bg};--m-surface:${t.surface};--m-surface-2:${t.surface2};--m-line:${t.line};
  --m-positive:${t.positive};--m-warn:${t.warn};--m-danger:${t.danger};
  --m-r-lg:${r + 2}px;--m-r-md:${r}px;--m-r-sm:${Math.max(4, r - 4)}px;--m-r-pill:999px;
  --m-font:${t.fontSans};--m-font-display:${t.fontDisplay};
  --m-sp-1:4px;--m-sp-2:8px;--m-sp-3:12px;--m-sp-4:16px;--m-sp-5:20px;--m-sp-6:24px;--m-sp-8:32px;
  --m-shadow-sm:0 1px 2px rgba(32,29,49,.04),0 3px 10px -6px rgba(32,29,49,.10);
  --m-shadow-md:0 4px 14px -6px rgba(32,29,49,.12),0 14px 36px -18px rgba(32,29,49,.18);
  --m-shadow-lg:0 24px 60px -24px rgba(24,20,40,.32);
  --m-ring:0 0 0 3px color-mix(in srgb,var(--m-brand) 22%,transparent);
  --m-ease:cubic-bezier(.22,1,.36,1);--m-dur:140ms;
}`;
}

/**
 * The component stylesheet — tokens + reset + every pattern in the reference
 * (docs/aura/prototype-design-system.md). Pure appearance; no content, no
 * ontology. Pass a theme to bake per-engagement overrides into `:root`.
 */
export function meridianStylesheet(theme?: Partial<PrototypeTheme> | null): string {
  return `${meridianRootVars(theme)}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--m-bg);color:var(--m-ink);font-family:var(--m-font);font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{font-family:var(--m-font-display);margin:0;letter-spacing:-.02em;line-height:1.1}
a{color:var(--m-brand);text-decoration:none}
:focus-visible{outline:none;box-shadow:var(--m-ring)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}

/* App shell. Everything painted ON the brand reads a brand-derived token. */
.m-app{display:grid;grid-template-columns:244px 1fr;min-height:100vh}
.m-side{background:var(--m-brand);color:var(--m-on-brand-dim);display:flex;flex-direction:column;gap:var(--m-sp-2);padding:var(--m-sp-5) var(--m-sp-3);position:sticky;top:0;height:100vh;overflow-y:auto}
.m-brand{display:flex;align-items:center;gap:9px;font-family:var(--m-font-display);font-weight:700;font-size:15px;padding:0 var(--m-sp-2) var(--m-sp-3);color:var(--m-on-brand)}
.m-brand-dot{width:9px;height:9px;border-radius:var(--m-r-pill);background:var(--m-brand-mark);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--m-on-brand) 14%,transparent)}
.m-nav{display:flex;flex-direction:column;gap:2px;margin-top:var(--m-sp-2)}
.m-nav-sec{font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--m-on-brand-mute);padding:var(--m-sp-3) var(--m-sp-2) var(--m-sp-1)}
.m-nav-item{display:flex;align-items:center;gap:10px;padding:8px var(--m-sp-2);border-radius:var(--m-r-sm);color:var(--m-on-brand-dim);font-size:13px;font-weight:500;cursor:pointer;border-left:2px solid transparent;transition:background var(--m-dur) var(--m-ease),color var(--m-dur)}
.m-nav-item:hover{background:color-mix(in srgb,var(--m-on-brand) 7%,transparent);color:var(--m-on-brand)}
.m-nav-item.is-active{background:color-mix(in srgb,var(--m-on-brand) 11%,transparent);color:var(--m-on-brand);border-left-color:var(--m-brand-mark)}
.m-nav-count{margin-left:auto;font-size:11px;font-weight:600;color:var(--m-on-brand-mute)}
/* Nested navigation: a child entity sits under its parent, and a branch collapses.
   A tree of 30+ entities that cannot be closed is as unusable as a flat list of
   30+ entities, so every branch is a native <details> — keyboard-operable and
   working with JavaScript off. The disclosure triangle toggles; the label
   navigates (its handler preventDefaults, so the two never fight). */
.m-nav-row{display:flex;align-items:center;gap:2px;list-style:none}
.m-nav-row::-webkit-details-marker{display:none}
.m-nav-row::before{content:"";flex:none;width:0;height:0;margin:0 3px 0 4px;border-left:4px solid transparent;border-top:4px solid transparent;border-bottom:4px solid transparent}
.m-nav-group>summary{cursor:pointer;border-radius:var(--m-r-sm)}
.m-nav-group>summary::before{border-left-color:var(--m-on-brand-mute);transition:transform var(--m-dur) var(--m-ease)}
.m-nav-group[open]>summary::before{transform:rotate(90deg)}
.m-nav-group>summary:focus-visible{box-shadow:var(--m-ring)}
.m-nav-row>.m-nav-item{flex:1;min-width:0}
.m-nav-sub{margin-left:11px;padding-left:5px;border-left:1px solid color-mix(in srgb,var(--m-on-brand) 16%,transparent)}
.m-main{min-width:0;padding:var(--m-sp-6) var(--m-sp-8)}

/* Page header */
.m-page-h{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--m-sp-4);margin-bottom:var(--m-sp-6)}
.m-eyebrow{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--m-muted)}
.m-title{font-size:32px;font-weight:700;margin-top:6px}
.m-sub{color:var(--m-ink-soft);margin-top:7px;max-width:62ch}
.m-crumbs{display:flex;gap:7px;align-items:center;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--m-muted);margin-bottom:var(--m-sp-3)}
.m-crumbs a{color:var(--m-muted)}.m-crumbs a:hover{color:var(--m-brand)}

/* Buttons */
.m-btn{display:inline-flex;align-items:center;gap:7px;font:inherit;font-size:13px;font-weight:600;padding:8px 14px;border-radius:var(--m-r-sm);border:1px solid transparent;cursor:pointer;transition:background var(--m-dur) var(--m-ease),box-shadow var(--m-dur),transform 60ms}
.m-btn:active{transform:translateY(.5px)}
.m-btn--primary{background:var(--m-brand);color:var(--m-on-brand)}
.m-btn--primary:hover{background:var(--m-brand-strong);box-shadow:var(--m-shadow-sm)}
.m-btn--secondary{background:var(--m-surface);color:var(--m-ink);border-color:var(--m-line)}
.m-btn--secondary:hover{border-color:color-mix(in srgb,var(--m-brand) 45%,var(--m-line));box-shadow:var(--m-shadow-sm)}
.m-btn--ghost{background:transparent;color:var(--m-brand)}
.m-btn--ghost:hover{background:var(--m-brand-soft)}
.m-btn--danger{background:transparent;color:var(--m-danger);border-color:color-mix(in srgb,var(--m-danger) 35%,var(--m-line))}
.m-btn--danger:hover{background:color-mix(in srgb,var(--m-danger) 8%,transparent)}
.m-btn--sm{padding:5px 10px;font-size:12px}
.m-btn[disabled]{opacity:.45;cursor:default;pointer-events:none}

/* Cards & panels */
.m-card{background:var(--m-surface);border:1px solid var(--m-line);border-radius:var(--m-r-lg);box-shadow:var(--m-shadow-sm);padding:var(--m-sp-5)}
.m-card-h{display:flex;align-items:center;justify-content:space-between;gap:var(--m-sp-3);margin-bottom:var(--m-sp-4)}
.m-card-t{font-size:15px;font-weight:700}
.m-grid{display:grid;gap:var(--m-sp-4)}
@media (min-width:900px){.m-grid--2{grid-template-columns:1fr 1fr}.m-grid--3{grid-template-columns:repeat(3,1fr)}}

/* Forms */
.m-field{display:flex;flex-direction:column;gap:6px;margin-bottom:var(--m-sp-4)}
.m-label{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--m-muted)}
.m-label .m-req{color:var(--m-danger);margin-left:3px}
.m-input,.m-select,.m-textarea{font:inherit;font-size:14px;color:var(--m-ink);background:var(--m-surface);border:1px solid var(--m-line);border-radius:var(--m-r-sm);padding:9px 11px;width:100%;transition:border-color var(--m-dur),box-shadow var(--m-dur)}
.m-textarea{min-height:88px;resize:vertical}
.m-input:focus,.m-select:focus,.m-textarea:focus{outline:none;border-color:var(--m-brand);box-shadow:var(--m-ring)}
.m-input.is-error,.m-select.is-error{border-color:var(--m-danger);box-shadow:0 0 0 3px color-mix(in srgb,var(--m-danger) 18%,transparent)}
.m-help{font-size:12px;color:var(--m-muted)}
.m-error{font-size:12px;color:var(--m-danger);font-weight:500}
.m-checkbox{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--m-ink-soft);cursor:pointer}
.m-checkbox input{width:16px;height:16px;accent-color:var(--m-brand)}
.m-form-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:var(--m-sp-2)}

/* Table */
.m-table-wrap{border:1px solid var(--m-line);border-radius:var(--m-r-lg);overflow:hidden;background:var(--m-surface)}
.m-table{width:100%;border-collapse:collapse;font-size:13px}
.m-table thead th{text-align:left;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--m-muted);background:var(--m-surface-2);padding:10px 14px;border-bottom:1px solid var(--m-line)}
.m-th-sort{cursor:pointer;user-select:none}.m-th-sort::after{content:"↕";margin-left:6px;opacity:.4;font-size:10px}
.m-th-sort.is-asc::after{content:"↑";opacity:1}.m-th-sort.is-desc::after{content:"↓";opacity:1}
.m-table tbody td{padding:12px 14px;border-top:1px solid var(--m-line-soft,var(--m-line));vertical-align:middle}
.m-table tbody tr{transition:background var(--m-dur)}
.m-table tbody tr:hover{background:var(--m-surface-2)}
.m-table tbody tr.is-flagged{background:color-mix(in srgb,var(--m-danger) 5%,transparent);box-shadow:inset 3px 0 0 var(--m-danger)}
.m-cell-main{font-weight:600;color:var(--m-ink)}
.m-cell-sub{font-size:11.5px;color:var(--m-muted);margin-top:2px}
.m-row-actions{display:flex;gap:6px;justify-content:flex-end}
.m-pagination{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-top:1px solid var(--m-line);font-size:12.5px;color:var(--m-muted)}
.m-pagination .m-btn{padding:4px 10px}

/* The list screen's own toolbar: a filter that filters, and a view switch that
   is only ever rendered where there is something to switch to. */
.m-search{width:230px;flex:none}
.m-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
/* A detail page's actions: the designed verbs first, then Edit/Delete. Wraps
   rather than crowding the title on a narrow viewport. */
.m-page-acts{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end}

/* BOARD VIEW — a lane per value of the entity's status attribute. Offered only
   where the ontology declares one, so no screen carries a switch to nothing. */
.m-board{display:flex;gap:14px;align-items:flex-start;overflow-x:auto;padding-bottom:6px}
.m-board-col{flex:0 0 248px;background:var(--m-surface-2);border:1px solid var(--m-line);border-radius:var(--m-r-lg);padding:12px}
.m-board-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--m-muted)}
.m-board-card{display:block;width:100%;text-align:left;font:inherit;cursor:pointer;background:var(--m-surface);border:1px solid var(--m-line);border-radius:var(--m-r-md);padding:10px 12px;margin-bottom:8px}
.m-board-card:hover{border-color:color-mix(in srgb,var(--m-brand) 40%,transparent);box-shadow:var(--m-shadow-sm)}
.m-board-more{font-size:12px;color:var(--m-muted);padding:2px}

/* Tabs / segmented */
.m-tabs{display:flex;gap:3px;padding:4px;background:var(--m-surface-2);border:1px solid var(--m-line);border-radius:var(--m-r-md);width:max-content}
.m-tab{font:inherit;font-size:13px;font-weight:600;color:var(--m-muted);background:none;border:none;padding:7px 13px;border-radius:var(--m-r-sm);cursor:pointer;transition:background var(--m-dur),color var(--m-dur)}
.m-tab:hover{color:var(--m-ink-soft)}
.m-tab.is-active{color:var(--m-brand);background:var(--m-surface);box-shadow:var(--m-shadow-sm)}
.m-tab-count{font-size:10.5px;color:var(--m-muted);margin-left:5px}

/* Badges, chips, status pills */
.m-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 9px;border-radius:var(--m-r-pill);border:1px solid var(--m-line);color:var(--m-ink-soft);background:var(--m-surface-2)}
.m-pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 10px;border-radius:var(--m-r-pill);border:1px solid}
.m-pill--good{color:var(--m-positive);border-color:color-mix(in srgb,var(--m-positive) 35%,transparent);background:color-mix(in srgb,var(--m-positive) 9%,transparent)}
.m-pill--warn{color:var(--m-warn);border-color:color-mix(in srgb,var(--m-warn) 38%,transparent);background:color-mix(in srgb,var(--m-warn) 10%,transparent)}
.m-pill--risk{color:var(--m-danger);border-color:color-mix(in srgb,var(--m-danger) 38%,transparent);background:color-mix(in srgb,var(--m-danger) 9%,transparent)}
.m-dot{width:8px;height:8px;border-radius:var(--m-r-pill);display:inline-block}
.m-dot--good{background:var(--m-positive)}.m-dot--warn{background:var(--m-warn)}.m-dot--risk{background:var(--m-danger)}
.m-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--m-brand);background:var(--m-brand-soft);border:1px solid transparent;border-radius:var(--m-r-pill);padding:4px 11px;cursor:pointer}
.m-chip:hover{border-color:color-mix(in srgb,var(--m-brand) 30%,transparent)}
/* A many-to-many is a SET, so its members wrap as tags rather than filling a
   table of owned rows. */
.m-chips{display:flex;flex-wrap:wrap;gap:8px;padding:2px 0}
/* A relation whose cardinality nobody has confirmed. Quiet on purpose — it is a
   caveat on a working section, not an error, and a demo full of alarm colours
   teaches the viewer to stop reading them. */
.m-prov{margin-right:auto;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  color:var(--m-warn);background:color-mix(in srgb,var(--m-warn) 12%,transparent);
  border:1px solid color-mix(in srgb,var(--m-warn) 32%,transparent);border-radius:var(--m-r-pill);padding:2px 8px}
/* Parent reference (N:1 / 1:1) — a link to the one record this belongs to.
   Rendered from the fabric's nav nodes, which had no rendering at all. */
.m-linkcards{display:flex;flex-wrap:wrap;gap:10px}
.m-linkcard{display:inline-flex;align-items:baseline;gap:10px;font:inherit;text-align:left;cursor:pointer;
  background:var(--m-surface-2);border:1px solid var(--m-line);border-radius:var(--m-r-md);padding:10px 14px}
.m-linkcard:hover{border-color:color-mix(in srgb,var(--m-brand) 40%,transparent);background:var(--m-brand-soft)}
/* The parent is real but has no screen in this build, so the card states the
   relation without pretending to navigate. It must not LOOK clickable: a
   control that does nothing is worse than a plain fact. */
.m-linkcard.is-flat{cursor:default;background:transparent}
/* A breadcrumb whose type has no list to return to (a reachable-only entity is
   drillable but not browsable). It states the type without offering a journey
   the build cannot make. */
.m-crumb-flat{color:var(--m-muted)}
.m-linkcard.is-flat:hover{border-color:var(--m-line);background:transparent}
.m-linkcard-k{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--m-muted)}
.m-linkcard-v{font-size:13px;font-weight:600;color:var(--m-ink)}
.m-linkcard-go{color:var(--m-brand);font-weight:700}
/* Footer of a collection card — "View all N →" when the inline slice is short. */
.m-card-f{display:flex;justify-content:flex-end;padding-top:12px}
/* The TAIL of a detail page's related sections. A record with thirteen child
   collections is a wall, and the one relation that matters is lost in it — so
   the biggest few stand open and the rest sit behind one control. Collapsed,
   never dropped: the sections are still in the document. */
.m-more{margin-top:20px}
.m-more>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:8px;
  font-size:13px;font-weight:600;color:var(--m-brand);background:var(--m-surface-2);
  border:1px solid var(--m-line);border-radius:var(--m-r-pill);padding:7px 15px}
.m-more>summary::-webkit-details-marker{display:none}
.m-more>summary:hover{border-color:color-mix(in srgb,var(--m-brand) 40%,transparent);background:var(--m-brand-soft)}

/* Empty / loading / error / toast */
.m-empty{text-align:center;padding:48px var(--m-sp-4);color:var(--m-muted)}
.m-empty-t{font-family:var(--m-font-display);font-size:16px;font-weight:600;color:var(--m-ink-soft);margin-bottom:6px}
/* AN EMPTY STATE CARRIES ITS EVIDENCE. "No X yet" is the weakest screen state
   there is: it reads as a finding when it is actually a guess the generator
   declared and wrote down. The assumption behind the hole is printed with it,
   and the question that settles it, so the emptiest screen is the one that
   collects the most. */
.m-assumed{margin:10px auto 0;max-width:56ch;font-size:12.5px;line-height:1.55;color:var(--m-muted)}
.m-assumed-k{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--m-ink-soft);margin-right:6px}
.m-assumed-q{display:block;margin-top:5px;color:var(--m-ink-soft);font-style:italic}
.m-skeleton{background:linear-gradient(90deg,var(--m-surface-2) 25%,color-mix(in srgb,var(--m-line) 60%,var(--m-surface-2)) 37%,var(--m-surface-2) 63%);background-size:400% 100%;animation:m-shimmer 1.4s ease infinite;border-radius:var(--m-r-sm);height:14px}
@keyframes m-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}
.m-banner{display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:var(--m-r-md);font-size:13px}
.m-banner--error{color:var(--m-danger);background:color-mix(in srgb,var(--m-danger) 7%,transparent);border:1px solid color-mix(in srgb,var(--m-danger) 30%,transparent)}
.m-toast{position:fixed;right:20px;bottom:20px;background:var(--m-ink);color:#fff;padding:12px 16px;border-radius:var(--m-r-md);box-shadow:var(--m-shadow-lg);font-size:13px;font-weight:500}

/* THE WORKBENCH — a role's own screen; a step is a sentence, not a row. */
.m-lanes{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.m-steps{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:12px;font-size:13px}
.m-step{padding-left:2px}
.m-step-a{color:var(--m-ink)}
/* A name with nowhere to go: a tag, never a control. */
.m-chip--flat{cursor:default;background:var(--m-surface-2);color:var(--m-muted);border-color:var(--m-line)}
.m-chip--flat:hover{border-color:var(--m-line)}

/* AGENT ACTIVITY — the blueprint, on the record it acts on. */
.m-agents{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
.m-agent{border:1px solid var(--m-line);border-radius:var(--m-r-md);padding:12px 14px;background:var(--m-surface-2)}
.m-agent-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.m-agent-n{font-weight:700;font-size:14px}
.m-agent-p{margin-top:5px;font-size:13px;color:var(--m-ink-soft)}
.m-agent-gate{margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}

/* SUMMARY BANDS — the numbers a screen leads with, and what they are made of.
   EVERY RULE HERE IS IN NORMAL FLOW. A build that wrote its own markup put stat
   cards out of flow over the tables and hid a column on every screen; the cards
   are laid out like everything else on the page, so the space they occupy is
   space the table is not in. Nothing below declares position, float, or a
   negative margin, and nothing may. */
.m-widgets{display:flex;flex-direction:column;gap:var(--m-sp-4);margin-bottom:var(--m-sp-5)}
.m-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(184px,1fr));gap:var(--m-sp-3)}
.m-stat{background:var(--m-surface);border:1px solid var(--m-line);border-radius:var(--m-r-lg);box-shadow:var(--m-shadow-sm);padding:var(--m-sp-4)}
.m-stat-k{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--m-muted)}
.m-stat-v{font-size:26px;font-weight:700;margin-top:6px;font-variant-numeric:tabular-nums}
.m-stat-n{font-size:11.5px;color:var(--m-muted);margin-top:5px;line-height:1.45}
.m-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:var(--m-sp-4)}
.m-bars{display:flex;flex-direction:column;gap:9px;margin-top:12px}
.m-bar{display:grid;grid-template-columns:minmax(88px,30%) 1fr auto;align-items:center;gap:10px;font-size:12.5px}
.m-bar-k{font-weight:600;color:var(--m-ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.m-bar-track{background:var(--m-surface-2);border:1px solid var(--m-line);border-radius:var(--m-r-pill);height:10px;overflow:hidden}
.m-bar-fill{display:block;height:100%;background:var(--m-brand);border-radius:var(--m-r-pill)}
.m-bar-v{font-variant-numeric:tabular-nums;color:var(--m-muted);font-weight:600}
/* The label the list itself carries when a band sits above it — so the band is
   never read as the table's heading. */
.m-section-h{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--m-muted);margin-bottom:var(--m-sp-3)}

/* Detail definition list */
.m-dl{display:grid;grid-template-columns:auto 1fr;gap:10px 18px;font-size:13.5px}
.m-dl dt{color:var(--m-muted);font-weight:600}
.m-dl dd{margin:0;color:var(--m-ink)}
@media (max-width:720px){.m-app{grid-template-columns:1fr}.m-side{position:static;height:auto;flex-direction:row;flex-wrap:wrap}.m-main{padding:var(--m-sp-4)}}
`;
}
