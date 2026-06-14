# ADAM — Brillio Atlas Codex · Codex Session Prompt

## What this project is

**ADAM** (AI Delivery & Assurance Manager) is a React SPA — a programme management operating system for Brillio. It uses AI agents to run governance, risk, milestone, budget, stakeholder, narrative, and gate-review workflows across delivery programmes. The UI is fully custom (no component library beyond internal primitives) with a dark/light dual-theme CSS token system.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript + Vite |
| Styling | Pure CSS custom properties (`--v3-*` tokens), no Tailwind |
| State | React `useState` / `useCallback` — no external store |
| Data | Supabase (Postgres + Auth + Realtime) via `@supabase/supabase-js` |
| Build | `npm run build` (Vite), `npm run dev` (localhost:5173) |
| Path alias | `@/` → `src/` |
| Node path | `/Users/Ibrahim.Khalid/tools/node/bin/` (non-standard) |

Build command: `PATH="/Users/Ibrahim.Khalid/tools/node/bin:$PATH" npm run build`

---

## Repository layout

```
src/
  integrations/supabase/
    client.ts          # createClient singleton — import { supabase, isSupabaseConfigured }
    types.ts           # DB row types — Tables<'name'>, TablesInsert<'name'>
  v3/
    AppShellV3.tsx     # Root shell — ALL navigation state lives here (~1800 lines)
    types.ts           # V3Surface, V3MoreView, V3ReportId, V3Mode, V3CommandMode
    v3.css             # All CSS (~6700+ lines): tokens, themes, layout, components
    components/
      CommandRail.tsx          # Left nav rail (4 primary destinations + tools)
      ProgramDetailRouter.tsx  # Routes V3MoreView → view component
      (30+ other components)
    surfaces/
      InsightFeedView.tsx      # Home — dashboard + phase pipeline strip
      PortfolioView.tsx        # Portfolio — programme list + delete
      ProgrammeHealthView.tsx  # Governance — gates + health
      DecideView.tsx           # Decisions
      ExecutiveView.tsx        # Brief — one-page summary
      StageView.tsx            # Phase detail sheet
      ProgramView.tsx          # Programme sub-view wrapper
      MoreView.tsx             # Tab bar for programme sub-views
      PipelineView.tsx         # (orphaned — no longer rendered, safe to delete)
    hooks/ lib/ utils.ts
  new/
    pages/             # Feature views: NarrativeView, RisksView, MilestoneView,
                       #   IntelligenceView, BudgetView, DeckView, etc.
    lib/               # Data hooks: usePrograms, useAgentTriggers, useMilestones,
                       #   usePatternLibrary, useAutonomy, useGateReview, etc.
    components/        # Shared components
    types.ts           # ProgramSummary, Milestone, AppView, etc.
  lib/
    adamSync.ts        # Supabase read/write helpers incl. deleteProgramFromSupabase
    programEvents.ts   # Event logging → adam_program_events
supabase/
  migrations/
    20260613_missing_tables.sql  # 7 new tables (run in Supabase SQL Editor)
```

---

## Navigation architecture

All navigation goes through `commitNavigation()` in `AppShellV3.tsx`. URL encodes the current state.

### Primary surfaces (`V3Surface`)

| Surface | Rail label | Rendered by | Notes |
|---|---|---|---|
| `insight-feed` | **Home** | `InsightFeedView` | Dashboard + inline phase strip |
| `pipeline` | (→ Home) | `InsightFeedView` | Same render block as insight-feed |
| `programme-health` | **Governance** | `ProgrammeHealthView` | |
| `executive` | **Brief** | `ExecutiveView` | |
| `portfolio` | **Portfolio** | `PortfolioView` | |
| `decide` | (sub of Governance) | `DecideView` | |
| `stage` | (phase detail) | `StageView` | |
| `program` | (programme sub-views) | `ProgramView` + `ProgramDetailRouter` | |

### Sub-views (`V3MoreView`)
Opened via `openMoreView(view)` → sets `surface: "program"`, rendered by `ProgramDetailRouter`:
`documents | narrative | plan | milestones | risks | budget | critical-path | change-impact | stakeholders | adoption | health | retro | scope-pcr | intelligence | twin | accelerators | schedules | benchmark | decision-audit`

### CommandRail — 4 nav items
```typescript
{ surface: "insight-feed",    label: "Home",       sublabel: "Dashboard, phases and daily brief" }
{ surface: "programme-health",label: "Governance",  sublabel: "Gates, decisions and health" }
{ surface: "executive",       label: "Brief",       sublabel: "One-page executive summary" }
{ surface: "portfolio",       label: "Portfolio",   sublabel: "All programmes" }
```
Active mapping: `insight-feed | pipeline | stage | program` → `"home"` rail item active.

### Tools in rail (below primary nav)
- **Search** (⌘K) → `CommandPalette`
- **ADAM Advisor** → AI copilot sidebar
- **AI Settings** → `openMoreView("intelligence")` + sets `initialTab = "Autonomy"`

---

## Theme system

`src/v3/v3.css` uses layered CSS custom properties:

```css
:root                           { /* dark theme (default) */ }
[data-theme="light"]            { /* light theme */ }
@media (prefers-color-scheme: light) { /* OS preference fallback */ }
[data-density="compact"]        { /* always-on compact spacing */ }
```

Key token groups: `--v3-surface*`, `--v3-text-*`, `--v3-border*`, `--v3-accent`, `--v3-red/amber/green`, `--v3-space-*`, `--v3-radius-*`, `--v3-font`

Density: `data-density="compact"` set on `<html>` at mount via `useEffect` — never toggled.

---

## Supabase

**Client:** `src/integrations/supabase/client.ts`
- Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- Exports: `supabase` (client | null), `isSupabaseConfigured` (boolean)
- All writes guard: `if (!isSupabaseConfigured || !supabase) return`

**Auth:** Email/password + magic link. Session persisted in browser. RLS: `owner_id = auth.uid()`.

**All tables in use:**
```
adam_programs              adam_agent_runs            adam_agent_schedules
adam_audit_log             adam_autonomy_log          adam_autonomy_settings
adam_copilot_threads       adam_pattern_library       adam_portfolio
adam_program_artifacts     adam_agent_events          adam_org_members
adam_organisations         adam_phase_agent_states    adam_circuit_breakers
adam_decision_audit        adam_document_attachments  adam_program_events
```

**Migration:** `supabase/migrations/20260613_missing_tables.sql` — creates the 7 tables that were missing from types.ts. Run in Supabase SQL Editor before going live.

---

## Key patterns

### Data flow
```
AppShellV3.tsx
  usePrograms()           → programs: ProgramSummary[], activeProgram
  useAgentTriggers()      → triggers.triggerNarrative(), .triggerRisk(), etc.
  commitNavigation({surface, moreView, activePhaseId, reportId})
  openMoreView(view)      → shortcut: surface="program" + moreView=view
  navigateSurface(s)      → shortcut: surface=s, moreView=null
```

### ProgramSummary (abridged)
```typescript
{
  id: string;
  name: string;
  phases: Array<{ id: string; displayName: string; pct: number; status: string }>;
  decisionQueue: Decision[];
  gateReviews: Record<string, { readinessScore: number; status: string } | null>;
  healthHeatmap: { overallRag: "green" | "amber" | "red" | null };
  narrative: string | null;
  risks: Risk[];
  milestones: Milestone[];
  rawData: Record<string, unknown>;
}
```

### Adding a new surface
1. Add to `V3Surface` in `src/v3/types.ts`
2. Add render block in `AppShellV3.tsx`
3. Optionally add to `PRIMARY_NAV` + `activeNavId()` in `CommandRail.tsx`
4. Add to `surfaceToPath()` / `parsePath()` for URL routing

### Adding a new MoreView
1. Add to `V3MoreView` in `src/v3/types.ts`
2. Add `case "new-view":` in `ProgramDetailRouter.tsx`
3. Create `src/new/pages/NewView.tsx`

### Toast
```typescript
import { pushV3Toast } from "@/v3/utils";
pushV3Toast("Message", { tone: "success" | "error" | "warning", duration: 3000 });
```

### CSS class conventions
- `.v3-section` — page section padding/wrapper
- `.v3-card`, `.v3-card-sm` — surface cards
- `.v3-button`, `.v3-button.ghost` — buttons
- `.v3-chip`, `.v3-chip.green/.amber/.red/.muted` — status pills
- `.adam-card`, `.adam-card-body`, `.adam-card-header` — inner card primitives
- `.v3-topbar` — top bar, `.v3-command-rail` — left nav

---

## Recently completed (June 2026)

### Premium UI/UX pass
- Full dual-theme contrast audit — fixed all hardcoded dark colours in light mode
- OS-preference `@media` block rewritten to match `[data-theme="light"]` exactly
- Compact density always-on (removed toggle)
- Breadcrumb system in topbar replacing back buttons
- Chip contrast: amber `#92400e`, red `#991b1b`, blue `#0369a1`

### Navigation redesign
- CommandRail rebuilt: 4 destination-first items, active state from `activeSurface` not stale enum
- Confidence score inline in brand kicker
- Overview + Delivery collapsed into single "Home" screen
- `InsightFeedView` embeds `PhaseStripCard` phase pipeline strip (ring-progress, clickable to phase sheet)

### AI Settings
- Rail "AI Settings" item → `openMoreView("intelligence")` with `initialTab = "Autonomy"`
- Fixed `IntelligenceView` to respond to `initialTab` prop changes via `useEffect`

### Delete programme
- PortfolioView: trash icon (hover-visible) → inline confirm → `deleteProgramFromSupabase` → refresh + toast
- If deleting active programme: resets to next available programme

### Supabase go-live
- Identified 7 missing tables; created migration with correct RLS policies

---

## Open gaps / next work candidates

- **Strategy stage showing 100%** on new projects — initial `pct` value being set incorrectly, likely in programme setup wizard or `normalizeProgram` in `src/new/lib/programData.ts`
- `PipelineView.tsx` is orphaned — no longer rendered, safe to delete
- `adam_agent_observations` in types.ts but never used — remove from schema
- RLS policies on 7 new tables should be verified in live Supabase dashboard
- `V3CommandMode` type is kept only for `CommandPalette` — can be simplified

---

## Dev environment

```bash
# Install
PATH="/Users/Ibrahim.Khalid/tools/node/bin:$PATH" npm install

# Dev
PATH="/Users/Ibrahim.Khalid/tools/node/bin:$PATH" npm run dev   # → localhost:5173

# Build (type-check included)
PATH="/Users/Ibrahim.Khalid/tools/node/bin:$PATH" npm run build

# Lint
PATH="/Users/Ibrahim.Khalid/tools/node/bin:$PATH" npm run lint
```

`.env` (never commit):
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_SUPABASE_PROJECT_ID=your-project-id
```

Project root: `/Users/Ibrahim.Khalid/Documents/Claude/Projects/Twenty crm test/brillio-atlas-codex`
