# ADAM — UX Reimagination: Parallel Implementation Prompt

You are a principal product engineer and design systems architect. You are
building a completely reimagined frontend for ADAM in a parallel git branch,
leaving the existing App.jsx and all backend logic untouched.

This is not a refresh. This is a ground-up reimagination of the user
experience — built alongside the existing app, swapped in when ready.

---

## Setup: Parallel Branch

```bash
cd "/Users/Ibrahim.Khalid/Documents/Claude/Projects/Twenty crm test/brillio-atlas-codex"
git checkout -b ux/reimagine-agentic
```

All new files go in `src/new/`. The existing `src/App.jsx` is not touched.
To preview the new UI, update `src/main.jsx` to import from
`src/new/AppShell.tsx` instead of `src/App.jsx` — but only after the
shell is complete.

---

## Tech Stack (existing, do not add new dependencies)

- React 18 + TypeScript
- Tailwind CSS (already configured)
- shadcn/ui (already installed — Button, Dialog, Popover, Command, etc.)
- @xyflow/react (already installed — for Transformation Twin)
- Supabase client at `@/integrations/supabase/client`
- Existing hooks: `useAgentRun`, `useCopilotThread`, `useAgentSchedules`
- Path alias `@/` → `src/`

---

## Design System: Brillio Brand

Use these exact tokens throughout. No other colours.

```typescript
// src/new/tokens.ts
export const brand = {
  // Brillio Primary
  cobalt:      "#0047CC",   // primary action, active states
  cobaltLight: "#1A6EFF",   // hover
  cobaltDim:   "#003BA3",   // pressed

  // Brillio Secondary
  ink:         "#0D0F14",   // primary surface (dark mode)
  inkMid:      "#1A1D26",   // secondary surface
  inkSub:      "#252836",   // tertiary surface
  inkBorder:   "rgba(255,255,255,0.07)", // 1px borders on dark

  // Neutrals
  slate100:    "#F8F9FC",
  slate200:    "#EFF1F7",
  slate400:    "#9BA3B8",
  slate600:    "#616B80",
  slate800:    "#2E3347",

  // Semantic
  green:       "#16A34A",
  greenSoft:   "rgba(22,163,74,0.12)",
  amber:       "#D97706",
  amberSoft:   "rgba(217,119,6,0.12)",
  red:         "#DC2626",
  redSoft:     "rgba(220,38,38,0.12)",
  agentBlue:   "#2563EB",
  agentBlueSoft: "rgba(37,99,235,0.12)",

  // Typography
  fontSans:    "'Inter', system-ui, -apple-system, sans-serif",
  fontMono:    "'JetBrains Mono', 'Fira Code', monospace",
} as const;
```

**Typography rules:**
- Two weights only: 400 (body) and 600 (emphasis)
- Sentence case only — no ALL CAPS labels
- Scale: 11px (micro) · 13px (body) · 15px (title) · 20px (heading) ·
  32px (hero)
- Line height: 1.6 body, 1.2 headings

**Motion rules:**
- 150ms ease-out for panels and drawers
- 200ms for page transitions
- Agent pulse: `box-shadow` 0 → glow → 0, 2s infinite, ease-in-out
- No decorative animation

---

## Information Architecture

Replace the 15-stage methodology sidebar with 6 goal-oriented modes:

```
HOME          — Operating center: what's happening, what matters, what's next
TWIN          — Transformation Twin canvas (the centerpiece)
WORK          — Active phase workspaces (outcome-oriented, not stage-named)
DECISIONS     — Human-agent handoff queue
INTELLIGENCE  — TITAN engine: predictions, scenarios, benchmarks
SETTINGS      — Program config, schedules, team, integrations
```

Methodology stages (Strategy → ValueRealize) become a progress thread
inside WORK — not primary navigation.

Outcome-oriented stage names (replace methodology labels):
```
Strategy    → "Define the Bet"
Mobilise    → "Align the Team"
Discover    → "Find the Value"
Design      → "Design the Capability"
Agent Arch  → "Build the Agents"
Build       → "Launch the MVP"
Operate     → "Operationalise"
Govern      → "Govern the Risk"
Optimize    → "Scale the Value"
```

---

## Shell Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  COMMAND BAR (48px fixed top)                                    │
│  [≡ ADAM] [Program Switcher ▾] ── ── ── ──  [⌘K] [●] [🔔] [◉] │
├────┬─────────────────────────────────────────────┬───────────────┤
│    │                                             │               │
│ S  │   MAIN WORKSPACE                           │  AGENT        │
│ I  │                                             │  ACTIVITY     │
│ D  │                                             │  RAIL         │
│ E  │                                             │  (240px)      │
│ B  │                                             │               │
│ A  │                                             │  Collapsible  │
│ R  │                                             │  → 40px rail  │
│    │                                             │               │
│(60)│                                             │               │
├────┴─────────────────────────────────────────────┴───────────────┤
│  ADVISOR BAR (52px fixed bottom) — persistent Copilot           │
└──────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
src/new/
  tokens.ts                  — design tokens
  AppShell.tsx               — root layout
  components/
    shell/
      CommandBar.tsx         — top bar + ⌘K + program switcher
      Sidebar.tsx            — 60px icon rail → 220px expanded
      AgentActivityRail.tsx  — right panel, collapsible
      AdvisorBar.tsx         — bottom copilot bar
    ui/
      AgentPulse.tsx         — animated agent status dot
      AgentCard.tsx          — per-agent status card
      ArtifactCard.tsx       — living artifact object
      ReadinessSignal.tsx    — can we proceed / blockers / risks
      DecisionItem.tsx       — single decision queue item
      NarrativeBlock.tsx     — AI-generated program narrative
      ValueMeter.tsx         — delivered vs projected value
      EmptyState.tsx         — guided empty state component
  pages/
    HomeView.tsx             — operating center
    TwinView.tsx             — transformation twin canvas
    WorkView.tsx             — contextual workspace shell
    DecisionsView.tsx        — decision queue (Superhuman-style)
    IntelligenceView.tsx     — TITAN engine surface
```

---

## Component Specifications

### AppShell.tsx

```typescript
// src/new/AppShell.tsx
// Root layout. Composes all shell components.
// Props: none — reads program state from existing hooks
//
// Layout:
// - CommandBar fixed top (z-50)
// - Sidebar fixed left (60px collapsed, 220px expanded, toggleable)
// - AgentActivityRail fixed right (240px, collapsible to 40px)
// - AdvisorBar fixed bottom (52px)
// - Main content: padding that accounts for all fixed elements
// - Active view rendered in main content area based on nav state
//
// State:
// - activeView: "home" | "twin" | "work" | "decisions" | "intelligence" | "settings"
// - sidebarExpanded: boolean (default false, expand on hover or pin)
// - railCollapsed: boolean (default false)
// - commandBarOpen: boolean
```

### CommandBar.tsx

```typescript
// src/new/components/shell/CommandBar.tsx
// 48px fixed top bar.
//
// Left: ADAM wordmark (Brillio cobalt) + program switcher dropdown
//   - Program switcher shows: program name, industry badge, health dot
//   - Dropdown lists all programs with status
//
// Center: nothing (breathing room)
//
// Right:
//   - ⌘K search trigger (keyboard shortcut activates Command palette)
//   - Sync status dot (green=synced, amber=syncing, red=error)
//   - Notification bell with unread count badge
//   - Avatar/persona switcher (Executive/Lead/Architect/FDE/Engineer)
//     — switching persona adapts sidebar labels and home view emphasis
//
// Command palette (shadcn/ui Command component):
//   - Search across: programs, workspaces, artifacts, decisions, agents
//   - Quick actions: "New program", "Run agent", "Open Twin"
//   - Recent items
//   - Keyboard navigable
```

### Sidebar.tsx

```typescript
// src/new/components/shell/Sidebar.tsx
// 60px icon rail. Expands to 220px on hover or when pinned.
// Background: brand.ink (#0D0F14)
// Transition: width 150ms ease-out
//
// Top section — primary nav (icons + labels on expand):
//   Home       — grid-2x2 icon
//   Twin       — git-fork icon (represents graph)
//   Work       — layers icon
//   Decisions  — inbox icon + unread badge
//   Intelligence — sparkles icon
//
// Bottom section:
//   Settings   — settings icon
//   Collapse pin — chevron icon
//
// Active state:
//   - Cobalt left accent bar (3px)
//   - Icon background: brand.agentBlueSoft
//   - Label color: white
//
// Inactive state:
//   - Icon color: brand.slate400
//   - No background
//
// In expanded mode, below each nav item show a 1-line status hint:
//   Work  → "3 phases active · 2 agents running"
//   Decisions → "4 decisions need review"
```

### AgentActivityRail.tsx

```typescript
// src/new/components/shell/AgentActivityRail.tsx
// 240px right panel. Collapses to 40px rail showing only agent dots.
// Background: brand.inkMid
// Border-left: 1px brand.inkBorder
//
// Header: "Agent Activity" + collapse toggle
//
// When expanded — scrollable list of AgentCard components:
//   One card per phase that has an active or recent run.
//   Ordered by: running > paused > recently completed.
//
// When collapsed — 40px rail with:
//   - Stacked AgentPulse dots (one per active agent)
//   - Click any dot to expand rail and scroll to that agent
//
// Realtime: subscribes to adam_agent_runs via useAgentRun()
// Updates live without polling.
//
// At bottom of rail:
//   - "View all traces" link → AgentObservabilityView
//   - "Manage schedules" link → schedule manager
```

### AdvisorBar.tsx

```typescript
// src/new/components/shell/AdvisorBar.tsx
// 52px fixed bottom. The persistent Copilot interface.
// Background: brand.ink with top border brand.inkBorder
//
// This is not a chat sidebar. It is always visible.
//
// Left: Copilot identity badge (adapts per workspace):
//   Home        → "Transformation Advisor"
//   Twin        → "Architect"
//   Work/Build  → "FDE Lead"
//   Decisions   → "PMO Lead"
//   Intelligence → "Intelligence Analyst"
//   — Small avatar icon + role name
//
// Center: Proactive nudge (latest from evaluateProactiveNudges()):
//   Shows one nudge at a time: type icon + message (1 line truncated)
//   Click to expand into a full panel above the bar
//   Dismiss button (×) to clear
//   If no nudge: shows "Ask ADAM anything..." placeholder
//
// Right: Input field (expands on focus to full-width overlay above bar)
//   On submit: calls useCopilotThread() sendMessage()
//   Response streams back into expanded panel
//   Panel dismisses on click-away or Escape
//
// The expanded Copilot panel (above bar, slides up 350ms):
//   - Thread messages (latest 8, scrollable)
//   - Streaming response with cursor
//   - Quick action chips: "Generate artifact", "Queue decision",
//     "Explain this", "What's next?"
//   - "Open full thread" link
```

### AgentCard.tsx

```typescript
// src/new/components/ui/AgentCard.tsx
// Shows real-time status of a single phase agent.
//
// Props:
interface AgentCardProps {
  agentId: string;
  phaseId: string;
  displayName: string;       // "Define the Bet" not "strategy"
  status: "idle" | "running" | "paused" | "complete" | "failed";
  currentTask?: string;      // "Drafting transformation thesis..."
  confidence?: number;       // 0–1
  lastArtifact?: string;     // title of last artifact produced
  pendingDecision?: string;  // what the agent is waiting on
  pauseReason?: string;
  onResume?: () => void;
  onViewTrace?: () => void;
}
//
// Visual:
// - Status dot (AgentPulse) top-right
// - Phase display name (13px, weight 600)
// - Current task or last action (11px, slate400)
// - Confidence bar (4px, cobalt fill) if running/complete
// - "Paused: {pauseReason}" amber banner if paused
// - [Resume] button if paused
// - [View trace] ghost button always visible
// - Card background: brand.inkSub
// - Border: brand.inkBorder
// - Hover: border-color cobalt at 30% opacity
```

### ArtifactCard.tsx

```typescript
// src/new/components/ui/ArtifactCard.tsx
// A living artifact object — not a document.
//
// Props:
interface ArtifactCardProps {
  id: string;
  title: string;
  phaseId: string;
  status: "draft" | "approved" | "archived";
  agentConfidence?: number;
  agentGenerated: boolean;
  lastEditedBy: "agent" | "human";
  lastEditedAt: string;
  contentSummary: string;    // 1-2 sentence summary
  versionNumber: number;
  onApprove?: () => void;
  onReject?: () => void;
  onEdit?: () => void;
  onViewHistory?: () => void;
}
//
// Visual:
// - Status pill (top-right): Draft (amber) / Approved (green) / Archived (slate)
// - Confidence ring (if agent-generated): circular progress, cobalt
// - Title (15px weight 600)
// - "Agent generated · v{n}" or "Human edited · v{n}" (11px slate400)
// - Content summary (13px, 3 lines max, truncated)
// - Version timeline (bottom): dots for each version, active highlighted
// - Action row: [Approve] [Request changes] [Edit] [History]
// - If draft + agent-generated: [Approve] is primary CTA
// - Card has left accent border: cobalt (draft), green (approved),
//   slate (archived)
```

### ReadinessSignal.tsx

```typescript
// src/new/components/ui/ReadinessSignal.tsx
// Replaces readiness dashboards. Answers 3 questions only.
//
// Props:
interface ReadinessSignalProps {
  canProceed: boolean;
  readinessScore: number;    // 0–100
  blockers: { label: string; severity: "critical" | "high" | "medium";
              action?: string; actionView?: string }[];
  topRisks: { label: string; severity: "high" | "medium" | "low" }[];
  phase: string;
}
//
// Layout (vertical, 3 sections):
//
// 1. CAN WE PROCEED?
//    Large green "✓ Ready to advance" or red "✗ Not ready"
//    + one-line reason
//
// 2. WHAT IS BLOCKING US?
//    List of blockers — each clickable with resolution path
//    Empty state: "No blockers" (green)
//
// 3. WHAT RISK EXISTS?
//    Top 3 risks, each with severity dot
//    Empty state: "No critical risks"
//
// No progress bars. No percentages. No methodology labels.
// Answers questions, not reports metrics.
```

### NarrativeBlock.tsx

```typescript
// src/new/components/ui/NarrativeBlock.tsx
// AI-generated transformation narrative. The heartbeat of the Home view.
//
// Props:
interface NarrativeBlockProps {
  programName: string;
  narrative: string;         // 2-3 sentence AI-generated summary
  generatedAt: string;
  isStale: boolean;          // true if > 24hrs old
  onRefresh: () => void;
}
//
// Visual:
// - Large, generous typography (20px, weight 400, 1.7 line-height)
// - Subtle cobalt left border (3px)
// - Soft ink background
// - "Updated {timeAgo}" + refresh icon (if stale, shows amber)
// - Clicking refresh triggers a Copilot call to regenerate
// - Skeleton loading state while generating (shimmer animation)
```

### EmptyState.tsx

```typescript
// src/new/components/ui/EmptyState.tsx
// Every empty state guides, explains, and offers to generate.
//
// Props:
interface EmptyStateProps {
  context: string;           // "No artifacts in this phase"
  explanation: string;       // Why this exists / what it's for
  recommendation: string;    // What to do next
  generateLabel?: string;    // "Generate with ADAM" CTA label
  onGenerate?: () => void;
  learnMoreLabel?: string;
  onLearnMore?: () => void;
}
//
// Visual:
// - Centered, max-width 400px
// - Icon (context-appropriate, from lucide-react)
// - Context heading (15px weight 600)
// - Explanation (13px slate400, 2 lines max)
// - Recommendation (13px white)
// - [Generate with ADAM] primary button (cobalt)
// - [Learn more] ghost link
// No illustrations. No empty table rows. No "No data found."
```

---

## Page Specifications

### HomeView.tsx — The Operating Center

```typescript
// src/new/pages/HomeView.tsx
//
// Not a dashboard. An operating center.
// Single scrollable column, max-width 900px, centered.
//
// SECTION 1: Transformation Narrative
//   <NarrativeBlock /> — the program's current story in 2-3 sentences
//   Generated by Copilot on load if stale
//
// SECTION 2: Three-Column Summary (48px gap)
//   Col 1: VALUE
//     - Delivered: bold number + currency
//     - vs Projected: percentage of target
//     - Trend: arrow up/down with delta
//   Col 2: READINESS
//     - Overall score (large number)
//     - "Ready / At risk / Blocked" pill
//     - Link → full ReadinessSignal
//   Col 3: AGENTS
//     - "{n} running · {n} paused · {n} complete today"
//     - Mini list of active agents (top 3)
//     - Link → AgentActivityRail
//
// SECTION 3: Decision Spotlight
//   The single most critical unresolved decision.
//   Full <DecisionItem /> card with approve/reject inline.
//   "View all {n} decisions →" link below.
//   If no decisions: green "All decisions resolved" state.
//
// SECTION 4: Twin Preview
//   150px tall mini Transformation Twin graph (non-interactive)
//   "Explore in Twin →" CTA that navigates to TwinView
//   Shows live agent activity on nodes
//
// SECTION 5: Recommended Next Action
//   One ADAM recommendation — cobalt card, full width
//   Icon + action title + one-line explanation
//   [Take action] button → navigates to relevant workspace
//   Powered by evaluateProactiveNudges() highest-priority item
//
// Empty states:
//   New program → NarrativeBlock shows onboarding narrative
//   No decisions → green resolved state (not hidden section)
//   No agents → "Start your first agent" CTA
```

### TwinView.tsx — The Canvas

```typescript
// src/new/pages/TwinView.tsx
// Full-screen canvas. The centerpiece of ADAM.
// Uses @xyflow/react
//
// Node types:
//   strategy, outcome, capability, agent, decision, role,
//   data, risk, value, governance, skill, learning
//
// Each node:
//   - 200px × 80px minimum
//   - Title + type badge
//   - Status ring (agent-colored if an agent is active on this node)
//   - Agent pulse animation if agent is running against this phase
//   - Click → slides in a 320px right panel with:
//     · Node details
//     · Related artifacts (ArtifactCard components)
//     · Active agent status (AgentCard)
//     · "Open workspace" button → navigates to WorkView for that phase
//
// Toolbar (floating top-left):
//   [Fit view] [Zoom in] [Zoom out] [Minimap toggle]
//   [Filter: show/hide node types]
//
// Agent activity overlay:
//   Nodes with running agents pulse cobalt
//   Nodes with complete agents show green ring
//   Nodes with blocked agents show amber ring
//   Edges light up when agents pass handoffs between phases
//
// The Twin IS navigation — clicking a node takes you to that workspace.
//
// Minimap (bottom-right, toggleable):
//   Compact view of full graph
//   Color-coded by node type
//
// Empty state (new program):
//   <EmptyState context="No Twin data yet"
//     recommendation="Run the Strategy agent to populate your Twin"
//     generateLabel="Start Strategy Agent" />
```

### WorkView.tsx — Contextual Workspace

```typescript
// src/new/pages/WorkView.tsx
// One workspace per ATOS phase. Outcome-oriented.
//
// Props: phaseId — determines which workspace to render
//
// HEADER (not a top bar — inline in content):
//   - Outcome-oriented phase name (e.g. "Find the Value" not "Discover")
//   - Current objective: one sentence from agent's last handoff summary
//   - ReadinessSignal compact variant (inline: can proceed / blockers)
//   - Active agent status badge
//
// TWO-COLUMN LAYOUT (60/40 split):
//
// LEFT — Artifacts (60%):
//   - Section header: "Artifacts"
//   - List of ArtifactCard components for this phase
//   - [Generate artifact] button → triggers agent run for this artifact type
//   - Empty state if no artifacts
//
// RIGHT — Agent + Guidance (40%):
//   - AgentCard for this phase's agent
//   - Recommended next action (from agent's last handoff)
//   - Open questions (from agent's handoff.openQuestions)
//   - Copilot quick actions for this workspace
//
// BOTTOM (full width):
//   - Phase progress thread:
//     Visual timeline of all 13 phases, current highlighted
//     Previous phases show completion status
//     Future phases show "locked" or "available" state
//     No methodology names — outcome names only
//
// The workspace never shows methodology documentation.
// It shows: what we produced, what agents are doing, what to do next.
```

### DecisionsView.tsx — The Inbox

```typescript
// src/new/pages/DecisionsView.tsx
// Premium decision queue. Inspired by Superhuman.
//
// TWO-PANEL LAYOUT:
//
// LEFT PANEL (320px fixed, brand.inkMid background):
//   - Header: "Decisions" + unread count badge
//   - Filter pills: [All] [Critical] [High] [Mine] [Agent]
//   - Persona filter: [Executive] [Lead] [Architect] [FDE]
//   - Scrollable list of DecisionItem components
//     · Priority dot (red/amber/cobalt/slate)
//     · Title (1 line, truncated)
//     · Phase badge + time ago
//     · "Paused agent" or "Escalated" label
//   - Selected item: white card with cobalt left border
//
// RIGHT PANEL (flex, white/ink background):
//   - Decision title (20px weight 600)
//   - Context: which agent queued this + why
//   - Agent recommendation (highlighted cobalt card)
//   - Agent confidence bar
//   - Supporting artifacts (linked, not embedded)
//   - Decision options (from decision.options):
//     Large radio-card buttons, one per option
//   - Human note field (optional, textarea)
//   - [Resolve] primary button (cobalt)
//   - [Delegate] [Dismiss] ghost buttons
//   - Decision history timeline below fold
//
// On resolve: calls useAgentRun().resumeRun() if awaiting_decision_id set
// Shows success state briefly then moves to next decision
//
// Keyboard shortcuts:
//   j/k — next/previous decision
//   a   — approve first option
//   r   — reject
//   n   — add note
//   Enter — resolve
//
// Empty state:
//   <EmptyState context="All decisions resolved"
//     explanation="ADAM will surface new decisions as agents work"
//     recommendation="Check back after running the next phase agent" />
```

### IntelligenceView.tsx — TITAN Engine

```typescript
// src/new/pages/IntelligenceView.tsx
// TITAN intelligence surface. Not a dashboard — a thinking tool.
//
// NAVIGATION (horizontal tabs, not sidebar):
//   [Outcome Prediction] [Scenario Modeling] [Workforce Intelligence]
//   [Benchmarks] [Transformation DNA] [Decision Intelligence]
//
// Each tab is a focused surface:
//
// OUTCOME PREDICTION:
//   - Probability distribution chart (SVG, cobalt fill)
//   - "P90 outcome: {value} by {date}"
//   - Top 3 confidence drivers
//   - Top 3 risk factors
//   - [Re-run prediction] button
//
// SCENARIO MODELING:
//   - 3-column scenario comparison (Base / Optimistic / Conservative)
//   - Key variable sliders (timeline, budget, scope)
//   - "What if" input → Copilot generates scenario analysis
//
// WORKFORCE INTELLIGENCE:
//   - Role impact matrix (grid: role × phase)
//   - Automation likelihood scores
//   - Reskilling recommendations
//
// All surfaces use:
//   - Minimal chrome — data is the design
//   - No decorative illustrations
//   - Cobalt accent for positive/proceeding signals
//   - Amber/red for risks only
```

---

## Persona Adaptation

The `CommandBar` persona switcher adapts the experience:

```typescript
// src/new/types.ts
export type Persona = "executive" | "lead" | "architect" | "fde" | "engineer";

// Persona affects:
// - Sidebar labels and emphasis
// - Home view section order and depth
// - DecisionsView filter defaults
// - AdvisorBar Copilot identity
// - WorkView artifact visibility (executives see summaries, architects see full)
```

Store active persona in localStorage. Persist across sessions.

---

## Responsive Breakpoints

```
< 768px  (mobile)  — not supported, show "open on desktop" message
768–1024px (tablet) — sidebar collapses to rail only, agent rail hidden
1024–1280px (laptop) — default layout, agent rail auto-collapses
> 1280px (desktop) — full layout, all panels visible
```

---

## Deliverables

Produce complete, production-ready TypeScript files:

**Design System**
1. `src/new/tokens.ts`

**Shell**
2. `src/new/AppShell.tsx`
3. `src/new/components/shell/CommandBar.tsx`
4. `src/new/components/shell/Sidebar.tsx`
5. `src/new/components/shell/AgentActivityRail.tsx`
6. `src/new/components/shell/AdvisorBar.tsx`

**UI Components**
7. `src/new/components/ui/AgentPulse.tsx`
8. `src/new/components/ui/AgentCard.tsx`
9. `src/new/components/ui/ArtifactCard.tsx`
10. `src/new/components/ui/ReadinessSignal.tsx`
11. `src/new/components/ui/DecisionItem.tsx`
12. `src/new/components/ui/NarrativeBlock.tsx`
13. `src/new/components/ui/ValueMeter.tsx`
14. `src/new/components/ui/EmptyState.tsx`

**Pages**
15. `src/new/pages/HomeView.tsx`
16. `src/new/pages/TwinView.tsx`
17. `src/new/pages/WorkView.tsx`
18. `src/new/pages/DecisionsView.tsx`
19. `src/new/pages/IntelligenceView.tsx`

**Types**
20. `src/new/types.ts`

---

## Constraints

- All files in `src/new/` — zero changes to existing `src/` files
- Tailwind CSS only — no inline styles, no CSS modules
- Use shadcn/ui primitives: Button, Dialog, Popover, Command, Tabs,
  Badge, Tooltip, Sheet, ScrollArea — already installed
- Use lucide-react for all icons — already installed
- TypeScript strict — no `any`
- All components must be self-contained and importable standalone
- Dark mode via `class="dark"` on `<html>` — default dark
- No hardcoded data — all components accept props and render empty
  states correctly when props are absent or empty arrays
- Hook into existing data layer only through these imports:
  - `@/hooks/useAgentRun`
  - `@/hooks/useCopilotThread`
  - `@/hooks/useAgentSchedules`
  - `@/integrations/supabase/client`
- Use `useAgentRun(programId).activeRuns` for real-time agent status
- Use `useCopilotThread(programId, workspaceId)` for Copilot in AdvisorBar
- Brand tokens from `@/new/tokens` — not hardcoded hex values
- Every component handles: loading state, empty state, error state
- Keyboard accessible — all interactive elements have visible focus rings
  (cobalt outline, 2px offset)
- Every empty state uses `<EmptyState />` — no ad-hoc empty UI

## Evaluation Criterion

If a senior product designer from Linear, Vercel, and Palantir reviewed
this in a PR — would they be proud of it?

If anything feels like traditional enterprise software: simplify it.
If anything feels over-engineered for the first render: remove it.
If anything could belong in a 2015 dashboard: delete it.

Design the experience that makes ADAM feel like the most sophisticated
AI-native enterprise product available today.
