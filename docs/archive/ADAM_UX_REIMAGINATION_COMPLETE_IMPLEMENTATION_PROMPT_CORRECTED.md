# ADAM — UX Reimagination: Complete Implementation Prompt (Repo-Grounded Corrected)

You are a principal product engineer building a completely reimagined frontend for ADAM in a parallel implementation surface. The existing `src/App.jsx` and backend logic remain intact until the new experience is ready to preview.

This prompt is corrected against the **actual repository state** in:

`/Users/Ibrahim.Khalid/Documents/Claude/Projects/Twenty crm test/brillio-atlas-codex`

Do not assume packages, UI primitives, or file structures that are not present.

---

## Verified Repository Facts

These facts are grounded in the current repo and must guide the implementation:

1. The active app currently mounts from:
   - `src/main.jsx` → `import('./App.jsx')`

2. A parallel shell already exists under `src/new/`:
   - `src/new/AppShell.tsx`
   - `src/new/styles.css`
   - `src/new/tokens.ts`
   - `src/new/types.ts`
   - `src/new/components/shell/*`
   - `src/new/components/ui/*`
   - `src/new/pages/*`
   - `src/new/lib/programData.ts`
   - `src/new/lib/usePrograms.ts`

3. The repo currently has these relevant runtime dependencies:
   - `react`
   - `react-dom`
   - `@supabase/supabase-js`
   - `@xyflow/react`
   - `jszip`
   - `mammoth`
   - `pdfjs-dist`

4. The repo currently does **not** include these dependencies:
   - `tailwindcss`
   - `lucide-react`
   - shadcn/ui / `@radix-ui/*`
   - Tiptap packages

5. Vite alias `@/` already resolves to `src/` in:
   - `vite.config.js`

6. Existing data hooks already exist and should be reused:
   - `src/hooks/useAgentRun.ts`
   - `src/hooks/useCopilotThread.ts`
   - `src/hooks/useAgentSchedules.ts`

7. Supabase client already exists at:
   - `src/integrations/supabase/client.ts`

8. The current workspace snapshot does **not** include a `.git` directory. If branch creation is required, perform it in the original clone that still has git metadata.

---

## Setup

If working in the original git clone that includes `.git`, create a parallel branch:

```bash
cd "/Users/Ibrahim.Khalid/Documents/Claude/Projects/Twenty crm test/brillio-atlas-codex"
git checkout -b ux/reimagine-agentic
```

If `.git` is unavailable in the working snapshot, skip branch creation and continue with file-based implementation only.

---

## Required Dependency Installation

Because the requested UX stack is **not fully installed**, install the missing packages first.

### Required runtime dependencies

```bash
npm install lucide-react \
  @tiptap/react \
  @tiptap/pm \
  @tiptap/starter-kit \
  @tiptap/extension-text-align \
  @tiptap/extension-font-family \
  @tiptap/extension-text-style \
  @tiptap/extension-color \
  @tiptap/extension-underline
```

### Optional UI-system dependency path

The repo does **not** currently contain Tailwind or shadcn/ui. Therefore:

- Do **not** assume shadcn primitives already exist.
- Do **not** assume Tailwind is configured.
- Prefer building the reimagined shell using:
  - React
  - TypeScript
  - `src/new/styles.css`
  - repo-local reusable UI components
  - `@xyflow/react`
  - Tiptap
  - Supabase hooks / existing data layer

If you choose to move to Tailwind/shadcn anyway, treat that as a separate setup task and install/configure those tools explicitly before implementing the UI. Do not write code that assumes they already work.

---

## Core Implementation Rule

This is a **parallel reimagination**, not a rewrite of the production path.

### Until final preview:

- Keep `src/App.jsx` untouched
- Keep existing backend logic untouched
- Replace and extend files inside `src/new/`
- Reuse existing hooks and Supabase integration

### Final preview swap only after the shell is complete:

Update `src/main.jsx` from:

```jsx
import('./App.jsx')
```

to:

```jsx
import('./new/AppShell.tsx')
```

Do this only when the new shell is ready to run end-to-end.

---

## Design Intent

Redesign ADAM so it feels like a premium executive transformation operating system for:

- CIOs
- Chief AI Officers
- CTOs
- Chief Digital Officers
- Transformation Leaders
- Enterprise Architects
- Forward Deployed Engineers

The platform should feel closer to:

- OpenAI
- Palantir Foundry
- Linear
- Notion AI
- McKinsey Transformation Office

It should **not** feel like:

- PMO software
- Jira
- Confluence
- methodology training software
- dashboard clutter

### Core product principle

**Hide methodology. Surface outcomes.**

Users should feel:

- what is happening
- why it matters
- what value is being created
- what is at risk
- what should happen next

---

## Realistic Architecture For This Repo

Because a parallel shell already exists in `src/new/`, do **not** create a second parallel architecture. Instead:

### Replace or evolve the current `src/new` implementation

Update and standardize the existing surface around:

- `src/new/AppShell.tsx`
- `src/new/components/shell/*`
- `src/new/components/ui/*`
- `src/new/pages/*`
- `src/new/styles.css`
- `src/new/tokens.ts`
- `src/new/types.ts`

You may rename files **inside `src/new/`** if the new structure requires it, but avoid duplicating overlapping shells unless necessary.

If you do rename a file, update all imports so `src/new` remains internally coherent.

---

## Design Tokens

Use the existing token direction already present in `src/new/tokens.ts`, but you may normalize the exported API if helpful.

Preferred token shape:

```typescript
export const T = {
  cobalt: "#0047CC",
  cobaltHover: "#1A6EFF",
  cobaltPressed: "#003BA3",
  cobaltSoft: "rgba(0,71,204,0.10)",

  bg: "#0D0F14",
  surface: "#13161E",
  surfaceRaised: "#1C2030",
  surfaceBorder: "rgba(255,255,255,0.07)",

  textPrimary: "#F0F2F7",
  textSecondary: "#8B93A7",
  textMuted: "#555E72",

  green: "#16A34A",
  greenSoft: "rgba(22,163,74,0.12)",
  amber: "#D97706",
  amberSoft: "rgba(217,119,6,0.12)",
  red: "#DC2626",
  redSoft: "rgba(220,38,38,0.12)",

  fontSans: "'Inter', system-ui, sans-serif",
  fontMono: "'JetBrains Mono', monospace",
} as const;
```

You may either:

- replace the current `brand` export with `T`, or
- preserve `brand` and alias it consistently

But do not leave multiple conflicting token systems in `src/new`.

---

## Navigation Model

### Top-level modes

```text
COMMAND CENTER  — Executive glance: status, value, blockers, next step
WORK            — Active transformation workspaces (outcome-grouped)
TWIN            — Transformation Twin canvas
DECISIONS       — Queued human actions
INTELLIGENCE    — TITAN: predictions, scenarios, benchmarks
DELIVERY        — ADM lifecycle, RAID, milestones, adoption
```

### Work sub-navigation

```text
DEFINE          Strategy · Mobilise
DISCOVER        Discover · Intel analysis
DESIGN          Capability Design · Agent Architecture
DELIVER         Build · Operate
GOVERN & SCALE  Govern · Optimize · Value Realize
```

These replace the flat methodology-heavy navigation model.

---

## Shell Layout

Use the existing `src/new/AppShell.tsx` as the root composition point.

### Layout target

```text
┌─────────────────────────────────────────────────────────────────┐
│  TOP BAR (48px)                                                 │
│  [ADAM™] [Program ▾]  ─────────────────────  [⌘K] [🔔] [●] [◉]│
├──────┬──────────────────────────────────────────┬──────────────┤
│      │                                          │              │
│ SIDE │   MAIN WORKSPACE                        │  COPILOT     │
│ BAR  │                                          │  PANEL       │
│      │                                          │              │
│ 64px │                                          │  320px       │
│ icon │                                          │  collapsible │
│ rail │                                          │  → 28px rail │
└──────┴──────────────────────────────────────────┴──────────────┘
```

### Important repo-grounded note

The earlier `src/new` implementation used:

- a top `CommandBar`
- a left `Sidebar`
- a right `AgentActivityRail`
- a bottom `AdvisorBar`

This redesign may **replace that structure**, but it should do so by refactoring the current `src/new` shell rather than creating a second competing shell.

In particular:

- the Copilot should move into the **right-side panel**
- the bottom advisor bar should be removed or absorbed into the right panel
- the right panel should preserve the current “always present / collapsible” product behaviour

---

## Component System

Build a reusable, self-contained component system under `src/new/components`.

Required concepts:

- `TopBar`
- `Sidebar`
- `CopilotPanel`
- `Card`
- `Pill`
- `ClickableMetric`
- `AgentCard`
- `ArtifactCard`
- `ReadinessSignal`
- `DocumentEditor`
- `ActionQueue`
- `EmptyState`

### Important implementation constraint

Because shadcn/ui is not installed, implement these as repo-local components using:

- React
- TypeScript
- CSS classes in `src/new/styles.css`
- Tiptap for document editing
- inline SVG or installed icon library (`lucide-react`) after installation

Do not import nonexistent shadcn primitives unless you first install and wire them.

---

## Page Targets

Implement these pages as the primary surfaces in the reimagined shell:

1. `CommandCenterView`
2. `WorkView`
3. `TwinView`
4. `DecisionsView`
5. `IntelligenceView`
6. `DeliveryView`

### Command Center

Must answer within 5 seconds:

- What are we doing?
- Where are we?
- What is blocking us?
- What should happen next?
- How much budget is consumed?

### Work

Must be artifact-first, agent-guided, outcome-oriented.

### Twin

Must remain the visual center of the platform and reuse `@xyflow/react`.

### Decisions

Must consolidate all human-required actions. Agents should work quietly in the background; users should primarily see what needs their input.

### Intelligence

Must feel like a decision tool, not a dashboard.

### Delivery

Must unify learning cycles, RAID, milestones, and adoption.

---

## Document Editing

All artifacts in the reimagined UI should open in a rich editor using Tiptap.

No plain textareas for document content.

Document editing should support:

- bold
- italic
- underline
- strikethrough
- H1 / H2 / H3
- paragraph
- alignment
- horizontal rule
- link
- undo / redo

The editor should open as a full-panel modal or sheet, not a route transition.

---

## Data Integration Constraints

Use only the existing repo integrations:

- `@/hooks/useAgentRun`
- `@/hooks/useCopilotThread`
- `@/hooks/useAgentSchedules`
- `@/integrations/supabase/client`

Use `@xyflow/react` for the Twin.

Preserve the existing backend contracts and data flow.

Do not create a parallel fake data architecture unless a page explicitly needs local placeholder shaping for loading / empty states.

---

## Interaction Standards

Implement:

- keyboard navigation in decision lists, artifacts, RAID, and overlays
- Escape to close all modal surfaces
- visible focus states
- optimistic UI for approvals
- global search / command palette
- notification center
- persona persistence in `localStorage`
- last visited workspace restoration per program
- export entry points per major view

---

## Deliverables

Deliver the reimagined frontend as a coherent `src/new/` surface.

### Required output files

At minimum, the completed implementation should provide or update:

1. `src/new/tokens.ts`
2. `src/new/types.ts`
3. `src/new/AppShell.tsx`
4. `src/new/components/shell/TopBar.tsx`
5. `src/new/components/shell/Sidebar.tsx`
6. `src/new/components/shell/CopilotPanel.tsx`
7. `src/new/components/ui/Card.tsx`
8. `src/new/components/ui/Pill.tsx`
9. `src/new/components/ui/ClickableMetric.tsx`
10. `src/new/components/ui/AgentCard.tsx`
11. `src/new/components/ui/ArtifactCard.tsx`
12. `src/new/components/ui/ReadinessSignal.tsx`
13. `src/new/components/ui/DocumentEditor.tsx`
14. `src/new/components/ui/ActionQueue.tsx`
15. `src/new/components/ui/EmptyState.tsx`
16. `src/new/pages/CommandCenterView.tsx`
17. `src/new/pages/WorkView.tsx`
18. `src/new/pages/TwinView.tsx`
19. `src/new/pages/DecisionsView.tsx`
20. `src/new/pages/IntelligenceView.tsx`
21. `src/new/pages/DeliveryView.tsx`
22. `src/new/styles.css`

If a current `src/new` file is superseded, replace it cleanly rather than leaving duplicate concepts in place.

---

## Final Swap Rule

Do **not** change the live app mount path during implementation.

Only after the new shell is complete and runnable:

1. update `src/main.jsx` to import `./new/AppShell.tsx`
2. verify build
3. preview the new shell

Until then, the legacy app should remain the active UI.

---

## Constraints

- All implementation work stays in `src/new/` until final preview swap
- Do not touch `src/App.jsx` or backend logic
- Do not assume Tailwind, shadcn, or Radix are already available
- Install missing dependencies explicitly before using them
- TypeScript strict
- No `any`
- Prefer repo-local UI primitives over fictional design-system imports
- Every empty state must guide the user forward
- Every major metric must be actionable
- Every artifact must open in a rich editor
- Every user-required interaction must surface through a deliberate action queue or workspace action surface

---

## Quality Bar

The result should feel like an executive-grade transformation operating system.

If the experience feels like:

- forms
- methodology administration
- dashboard clutter
- enterprise sprawl

then it is not done.

The experience is complete only when a CIO, Chief AI Officer, CTO, or transformation sponsor could open it and immediately understand:

- what is happening
- why it matters
- what is creating value
- what is at risk
- what should happen next

