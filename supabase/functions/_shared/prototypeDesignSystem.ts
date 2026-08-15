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

/** Merge a partial (governed) theme over the defaults — absent/blank keys keep
 * the Meridian default, so a sparse `experienceDesign.theme` still yields a
 * complete, coherent token set. */
export function resolveTheme(theme?: Partial<PrototypeTheme> | null): PrototypeTheme {
  const t = theme || {};
  const pick = <K extends keyof PrototypeTheme>(k: K): PrototypeTheme[K] => {
    const v = t[k];
    return (v === undefined || v === null || v === "" ? MERIDIAN_TOKENS[k] : v) as PrototypeTheme[K];
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
  return `:root{
  --m-brand:${t.brand};--m-brand-soft:${t.brandSoft};--m-accent:${t.accent};
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

/* App shell: fixed sidebar + scrolling main */
.m-app{display:grid;grid-template-columns:244px 1fr;min-height:100vh}
.m-side{background:var(--m-brand);color:#f3f1fa;display:flex;flex-direction:column;gap:var(--m-sp-2);padding:var(--m-sp-5) var(--m-sp-3);position:sticky;top:0;height:100vh;overflow-y:auto}
.m-brand{display:flex;align-items:center;gap:9px;font-family:var(--m-font-display);font-weight:700;font-size:15px;padding:0 var(--m-sp-2) var(--m-sp-3)}
.m-brand-dot{width:9px;height:9px;border-radius:var(--m-r-pill);background:#b3a6f7;flex:none;box-shadow:0 0 0 3px rgba(255,255,255,.12)}
.m-nav{display:flex;flex-direction:column;gap:2px;margin-top:var(--m-sp-2)}
.m-nav-sec{font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#948dbb;padding:var(--m-sp-3) var(--m-sp-2) var(--m-sp-1)}
.m-nav-item{display:flex;align-items:center;gap:10px;padding:8px var(--m-sp-2);border-radius:var(--m-r-sm);color:#cfc9e6;font-size:13px;font-weight:500;cursor:pointer;border-left:2px solid transparent;transition:background var(--m-dur) var(--m-ease),color var(--m-dur)}
.m-nav-item:hover{background:rgba(255,255,255,.06);color:#f3f1fa}
.m-nav-item.is-active{background:rgba(255,255,255,.09);color:#fff;border-left-color:#b3a6f7}
.m-nav-count{margin-left:auto;font-size:11px;font-weight:600;color:#948dbb}
/* Nested navigation: a child entity sits under its parent, and a branch collapses.
   A tree of 30+ entities that cannot be closed is as unusable as a flat list of
   30+ entities, so every branch is a native <details> — keyboard-operable and
   working with JavaScript off. The disclosure triangle toggles; the label
   navigates (its handler preventDefaults, so the two never fight). */
.m-nav-row{display:flex;align-items:center;gap:2px;list-style:none}
.m-nav-row::-webkit-details-marker{display:none}
.m-nav-row::before{content:"";flex:none;width:0;height:0;margin:0 3px 0 4px;border-left:4px solid transparent;border-top:4px solid transparent;border-bottom:4px solid transparent}
.m-nav-group>summary{cursor:pointer;border-radius:var(--m-r-sm)}
.m-nav-group>summary::before{border-left-color:#948dbb;transition:transform var(--m-dur) var(--m-ease)}
.m-nav-group[open]>summary::before{transform:rotate(90deg)}
.m-nav-group>summary:focus-visible{box-shadow:var(--m-ring)}
.m-nav-row>.m-nav-item{flex:1;min-width:0}
.m-nav-sub{margin-left:11px;padding-left:5px;border-left:1px solid rgba(255,255,255,.14)}
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
.m-btn--primary{background:var(--m-brand);color:#fff}
.m-btn--primary:hover{background:#2d2159;box-shadow:var(--m-shadow-sm)}
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
/* Parent reference (N:1 / 1:1) — a link to the one record this belongs to.
   Rendered from the fabric's nav nodes, which had no rendering at all. */
.m-linkcards{display:flex;flex-wrap:wrap;gap:10px}
.m-linkcard{display:inline-flex;align-items:baseline;gap:10px;font:inherit;text-align:left;cursor:pointer;
  background:var(--m-surface-2);border:1px solid var(--m-line);border-radius:var(--m-r-md);padding:10px 14px}
.m-linkcard:hover{border-color:color-mix(in srgb,var(--m-brand) 40%,transparent);background:var(--m-brand-soft)}
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

/* Detail definition list */
.m-dl{display:grid;grid-template-columns:auto 1fr;gap:10px 18px;font-size:13.5px}
.m-dl dt{color:var(--m-muted);font-weight:600}
.m-dl dd{margin:0;color:var(--m-ink)}
@media (max-width:720px){.m-app{grid-template-columns:1fr}.m-side{position:static;height:auto;flex-direction:row;flex-wrap:wrap}.m-main{padding:var(--m-sp-4)}}
`;
}
