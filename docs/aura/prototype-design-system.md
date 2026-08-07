# Meridian — the prototype design system

> Provenance: distilled from an internal reference enterprise CRM; codified engagement-neutral.

Meridian is the default **appearance layer** for AURA-generated prototypes. It supplies colour,
type, spacing, radii, elevation, motion, and the component patterns that dress them — and nothing
else. It knows no ontology, no entity, no engagement. A generated prototype inherits it by linking
one stylesheet and using the `.m-*` classes; a per-engagement `theme` re-skins it by overriding
`:root` custom properties, never by touching markup.

**Separation of concerns (keep these apart):** the *fabric* supplies structure and ontology
references, *Meridian* supplies appearance, *seed data* supplies content. No design tokens in the
fabric; no ontology knowledge here; no content in either.

**The name.** "Meridian" is deliberately neutral — it outlives the app it came from, exactly as the
ATOS rename did. There is no client, product, or vendor name in any token, class prefix (`m-`), or
file name. This one header line is the only place provenance is recorded.

**Source of truth:** [`src/v3/lib/prototypeDesignSystem.ts`](../../src/v3/lib/prototypeDesignSystem.ts).
`meridianStylesheet(theme?)` returns the full sheet; `MERIDIAN_TOKENS` is the default theme;
`resolveTheme()` merges a partial governed theme over the defaults. The reference page
[`public/prototype-design-system.html`](../../public/prototype-design-system.html) is generated
*from* that module (`scripts/build-ds-demo.mjs`) and pinned to it by
`prototypeDesignSystem.test.ts`, so the doc, the code, and the demo cannot drift.

---

## 1 · Tokens

All colour literals live in **one** place — the `:root` block `meridianRootVars()` emits. Every
component rule reads a `--m-*` var, so a re-skin is a variable swap.

### Colour

| Token | Value | Role |
|---|---|---|
| `--m-brand` | `#211747` | primary / action / active |
| `--m-brand-soft` | `#eae8f2` | tinted brand wash (selected, ghost hover) |
| `--m-ink` | `#211747` | primary text |
| `--m-ink-soft` | `#443e5d` | secondary text |
| `--m-muted` | `#625d74` | tertiary text / labels |
| `--m-bg` | `#f4f3f7` | page background |
| `--m-surface` | `#ffffff` | card / input surface |
| `--m-surface-2` | `#faf9fc` | elevated / hover surface |
| `--m-line` | `#e6e3ee` | borders / dividers |
| `--m-positive` | `#177a2f` | success / good |
| `--m-warn` | `#9c5c0e` | attention / pending (AA on white 5.32:1) |
| `--m-danger` | `#b3402a` | error / risk / destructive |

Semantic colour (good/warn/risk) is separate from the brand accent and never doubles as it.

### Type

- **Display**: `--m-font-display` — `"Outfit", "Inter", system-ui, …`. Headings only.
- **Body / UI**: `--m-font` — `"Inter", "Outfit", system-ui, …`.
- **System-first by design.** A sandboxed, self-contained prototype cannot fetch a webfont, so the
  stacks fall back to `system-ui` cleanly; Inter/Outfit are honoured when present, never required.
  (Source app ships Outfit via a font host — a decision that does not survive into a self-contained
  export, so it was dropped, not reproduced.)
- **Scale** (role → size / weight / tracking): title 32/700/-.02em · card-title 15/700 ·
  body 14/400 · label 11/600/.10em uppercase · eyebrow 11/600/.14em uppercase · sub 11.5/500.

### Spacing · radii · elevation · motion

- **Spacing**: a clean 4px base — `--m-sp-1..8` = 4 · 8 · 12 · 16 · 20 · 24 · 32.
- **Radii**: `--m-r-sm` 8 · `--m-r-md` 12 · `--m-r-lg` 14 · `--m-r-pill` 999. Derived from
  `theme.radius` (default 12) so one number re-rounds the whole system.
- **Elevation**: `--m-shadow-sm` (cards) · `--m-shadow-md` (hover) · `--m-shadow-lg` (overlays);
  `--m-ring` is the 3px focus halo.
- **Motion**: `--m-ease` `cubic-bezier(.22,1,.36,1)`, `--m-dur` 140ms. All animation is disabled
  under `prefers-reduced-motion`.

---

## 2 · Component reference

Each pattern: anatomy · variants · states. Class names are the contract the generator emits against.

- **App shell** `.m-app` (grid: 244px sidebar + main) · `.m-side` (pinned dark indigo) ·
  `.m-main`. Collapses to stacked at ≤720px.
- **Sidebar nav** `.m-nav` › `.m-nav-sec` (tracked caps section label), `.m-nav-item`
  (+ `.m-nav-count` right-aligned). States: hover, `.is-active` (left accent + tint).
- **Page header** `.m-page-h` › `.m-eyebrow`, `.m-title`, `.m-sub`; `.m-crumbs` breadcrumb.
- **Buttons** `.m-btn` + variant `--primary` / `--secondary` / `--ghost` / `--danger`, size
  `--sm`. States: hover, `:active` (1px press), `[disabled]`.
- **Cards** `.m-card` › `.m-card-h` / `.m-card-t`; layout `.m-grid` (`--2`, `--3`).
- **Forms** `.m-field` › `.m-label` (+ `.m-req`), `.m-input` / `.m-select` / `.m-textarea`,
  `.m-help`, `.m-error`, `.m-checkbox`, `.m-form-actions`. States: focus (ring), `.is-error`.
- **Table** `.m-table-wrap` › `.m-table`; header `.m-th-sort` (+ `.is-asc` / `.is-desc`); rows
  with `.m-cell-main` / `.m-cell-sub`, `.is-flagged` (severity stripe), `.m-row-actions`;
  `.m-pagination`.
- **Tabs / segmented** `.m-tabs` › `.m-tab` (+ `.is-active`, `.m-tab-count`).
- **Badges & status** `.m-badge` (neutral) · `.m-pill--good/warn/risk` · `.m-dot--good/warn/risk`
  · `.m-chip` (interactive).
- **Feedback states** `.m-empty` (+ `.m-empty-t`) · `.m-skeleton` (shimmer) · `.m-banner--error`
  · `.m-toast`.
- **Detail** `.m-dl` (definition grid).

---

## 3 · Inconsistencies in the source, and how they were resolved

The source is coherent but hand-authored, so it does the same thing several ways. Averaging would
lose intent; each was a decision:

1. **Two greens** (`#177a2f` text vs `#2cc84d` bright). *Kept one* — `#177a2f` for all semantic
   "good" (it holds AA on tinted badges; the bright green was decorative).
2. **Ad-hoc amber** (`--l-amber #b26a12` defined, but `#d08a2e` used inline in bars). *Kept the
   token*, dropped the inline variant.
3. **Radii spread** (0/7/8/9/10/12/14/999, per-context). *Collapsed to sm/md/lg/pill* off one base.
4. **Spacing** (2–40px ad-hoc). *Standardised to a 4px scale.*
5. **Buttons re-invented per context** (`.l-send`, `.l-step-advance`, `.l-link`, …, no base). *One
   `.m-btn` with variants* — the single biggest coherence win.
6. **Font "families"** all mapped to the same stack (no real serif/sans split). *Kept two stacks*
   but made them honestly system-first (see Type).
7. **Five irregular breakpoints** (640/720/760/860). *One meaningful breakpoint* (720) for the
   shell; components are fluid.
8. **Fixed engagement palettes** (forecast/family colours). *Dropped* — engagement-specific, and
   Meridian must be neutral.

---

## 4 · Wiring it in

**How prototypes get styling today.** The Prototype Build is one self-contained HTML document the
edge generator authors; `experienceDesign.theme` carries governed tokens but has **no default**
(`?? {}`), so appearance is whatever the model improvises per run — inconsistent across engagements.

**Client-side (built here).** `resolveTheme()` makes Meridian the floor: an absent or sparse
`experienceDesign.theme` now resolves to a complete Meridian token set, and `meridianStylesheet()`
is available to seed a prototype's base CSS. This is buildable and tested now.

**Edge (gated — specified, not made).** For a *generated* prototype to inherit Meridian
automatically, the generator prompt in `supabase/functions/run-agent/index.ts` must emit markup
against the `.m-*` classes and link/inline `meridianStylesheet()` as the base sheet (screen-specific
CSS layered on top). That is a generator-prompt change with no local executable verification (no
Deno here) and needs its own gated pass — recorded in
[`artifact-schema-findings.md`](./artifact-schema-findings.md) as **F-E**.

---

## 5 · Verification

Rendered `public/prototype-design-system.html` (nav + page header + tabs + detail card + form +
sortable table with status pills + pagination + toast) in the preview and compared against the
source app. They read as the same product family: shared deep-indigo shell, nav counts + active
accent, semantic pills, card rhythm, dense professional type. The one intentional divergence is the
system-font fallback (self-contained prototypes can't fetch the source's webfont) — a delivery
constraint, not a visual mismatch.
