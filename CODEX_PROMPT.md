# Brillio ATOS™ — Codex Build Prompt

## Platform Identity

**Product Name:** Brillio ATOS™
**Engine:** ATOS™ — Agentic Transformation Operating System
**Tagline:** AI-Native Transformation. Delivered.

This is Brillio's flagship enterprise transformation platform. It helps organizations design,
build, govern, and scale Human + Agent capabilities across the full ATOS 13-stage lifecycle.

---

## Tech Stack

- **Framework:** React 18 with hooks (useState, useEffect, useRef, useCallback)
- **Build Tool:** Vite 4
- **Styling:** Pure inline styles with a design token system (no CSS files, no Tailwind, no CSS-in-JS)
- **AI:** Anthropic Claude API (claude-sonnet-4-20250514) via streaming fetch — API key injected by proxy
- **State:** Local React state only — no Redux, no Zustand, no Context API
- **Dependencies:** Only react + react-dom. Zero UI libraries.

---

## File Structure

```
brillio-atlas/
├── index.html          # HTML shell — sets meta, loads main.jsx
├── vite.config.js      # Vite config — React plugin, port 3000
├── package.json        # Dependencies: react, react-dom, vite, @vitejs/plugin-react
├── .eslintrc.cjs       # ESLint config
├── .gitignore
├── favicon.svg         # Brillio B logo gradient SVG
├── CODEX_PROMPT.md     # This file
├── README.md           # Setup and deployment guide
└── src/
    ├── main.jsx        # ReactDOM.createRoot entry point
    └── App.jsx         # ENTIRE application — 3,549 lines, single file
```

---

## Architecture Overview

### Single-file architecture (`src/App.jsx`)

All code lives in one file, organized into these sections:

```
1.  callClaude()           — Streaming Anthropic API function
2.  Design Tokens (T)      — Color palette, shadows, typography scale
3.  Shared Components      — Pill, StatusPill, ReadinessBar, ScoreRing, Tooltip,
                             InfoIcon, Card, KpiCard, SectionHead, InlineGuide,
                             ContextBadge, GhostButton, GenerateButton,
                             ArtifactOutput, EmptyState, StepIndicator
4.  ATOS Lifecycle         — 13-stage lifecycle definition (ATOS_LIFECYCLE)
5.  Data Store             — PROJECT_TEMPLATES (3 industries × full data model)
                             DEFAULT_PROJECTS (3 sample programs)
                             Accessor functions (getPROGRAM, getLIFECYCLE, etc.)
6.  Static Data            — INDUSTRY_ACC, BUILD_TARGETS, INTEL_FRAMEWORK (TITAN™)
7.  Portfolio + Modal      — PortfolioView, NewProjectModal, ProjectSwitcher
8.  Navigation             — NAV constant (15 items, 3 groups)
9.  Sidebar                — Expandable/collapsible dark rail (56px ↔ 220px)
10. TopBar                 — 13-stage ATOS lifecycle tracker
11. Copilot Panel          — Collapsible AI assistant (288px ↔ 44px rail)
12. Views (15 total):
    - HomeView             — ATOS Command Center
    - DiscoverView         — 3-step intake wizard
    - DesignView           — Capability Studio
    - AgentView            — Agent Architecture Studio
    - BuildView            — Engineering package generator
    - GoverView            — Per-industry governance controls
    - TwinView             — Transformation Digital Twin + scenario modeling
    - FDEView              — Forward Deployment Center
    - DeliveryView         — ADM lifecycle workspace
    - AdoptionView         — Change management + adoption tracking
    - OptimizeView         — Value Realization Office
    - IntelView            — TITAN™ Intelligence Engine (6 modules)
    - IndustryView         — Industry Accelerators (6 industries)
    - PortfolioView        — Program portfolio grid
13. VIEW_MAP               — Routes nav IDs to view components
14. App Shell              — BrillioATOS() — layout, state orchestration, modals
```

---

## Design System

### Color Tokens (T object)
```js
// Brand blues
T.blue900 = "#001A4D"   // darkest navy
T.blue600 = "#0047CC"   // primary brand blue
T.blue500 = "#0057FF"   // button/CTA blue
T.blue50  = "#EBF1FF"   // tinted background

// Semantic
T.green500 = "#10B981"  // success / on track
T.amber500 = "#F59E0B"  // warning / at risk
T.red500   = "#EF4444"  // danger / blocked

// Neutrals (gray-50 through gray-950)
T.gray950 = "#080C14"   // sidebar background
T.gray900 = "#0F172A"   // dark text
T.gray50  = "#F8FAFC"   // page background

// Accents
T.cyan500  = "#00B4D8"  // gradient accent
T.purple500= "#8B5CF6"  // intel/prediction
```

### Layout
- **Sidebar:** 56px collapsed / 220px expanded (CSS transition 0.22s)
- **TopBar:** 46px fixed height — ATOS lifecycle tracker
- **Canvas:** flex:1, overflowY:auto, background T.gray50
- **Copilot:** 288px expanded / 44px collapsed rail
- **Page padding:** 20px 24px (compact density)
- **Max content width:** 1200px centered

### Component patterns
- `Card` — white bg, gray-200 border, 12px radius, shadowSm, hover lift
- `KpiCard` — tinted bg + left accent stripe, color-coded by metric type
- `ArtifactOutput` — white document panel with gray-50 header bar
- `InlineGuide` — dismissable blue tip banner
- `GenerateButton` — full-width with AI badge, blue hover state
- `GhostButton` — primary (blue filled) or secondary (blue ghost)

---

## Data Model

### Project structure
```js
{
  id: "p1",
  name: "Agentic Commercial Insights",
  client: "Global Life Sciences Corp",
  industry: "Life Sciences",          // keys into PROJECT_TEMPLATES
  readiness: 74,                       // 0-100 program readiness
  budget: "$4.2M",
  budgetUsed: 62,                      // percentage consumed
  timeline: "18 months",
  timelineHealth: "yellow",            // green | yellow | red
  agentsDeployed: 12,
  valueDelivered: "$1.8M",
  projectedValue: "$12.4M",
  roi: "195%",
  payback: "14 mo",
  color: "#0047CC",                    // industry accent color
  sponsor: "Jane Mitchell, Chief AI Officer",
  created: "Jan 2025",
}
```

### PROJECT_TEMPLATES keys
- `"Life Sciences"` — 6 capabilities, 6 agents, 5 FDE opps, 5 adoption groups
- `"Financial Services"` — 4 capabilities, 4 agents, 3 FDE opps, 4 adoption groups
- `"Healthcare"` — 4 capabilities, 4 agents, 3 FDE opps, 4 adoption groups

### Each template contains
- `lifecycle` — 13-stage ATOS progress array
- `phases` — 5-phase summary (legacy, used in DeliveryView)
- `maturityLevel` / `targetMaturity` — ATOS maturity 1-5
- `capabilities` — array of capability objects
- `agents` — array of agent blueprint objects
- `risks` / `decisions` — array of risk and decision objects
- `fdeOpp` — FDE opportunity pipeline
- `adoption` — { overallRate, trainingComplete, championNetwork, byGroup[] }

---

## Key Behaviors

### AI streaming (callClaude)
```js
// All AI generation uses streaming SSE
// No API key in code — injected by Anthropic proxy
// Model: claude-sonnet-4-20250514
// max_tokens: 1200
// Every workspace has tailored system prompts referencing ATOS
```

### Multi-project state
```js
// Mutable global store (not React state — intentional for cross-component access)
let _projects = [...DEFAULT_PROJECTS]
let _activeProjectId = "p1"

// Accessor functions always read from active project
function getPROGRAM()      // active project metadata
function getLIFECYCLE()    // 13-stage progress
function getCAPABILITIES() // capability portfolio
function getAGENTS()       // agent registry
function getRISKS()        // risk register
function getDECISIONS()    // decision log
function getFDE_OPP()      // FDE pipeline
function getADOPTION()     // adoption data
function getMATURITY()     // { current, target }
function getATOSReadiness() // composite 13-stage score
```

### Project switching
```js
// projectVersion state forces all views to re-mount with new project data
const switchProject = (id) => {
  _activeProjectId = id
  setActiveProjectId(id)
  setProjectVersion(v => v + 1)  // re-mounts ActiveView
}
```

### Navigation routing
```js
// NAV array → VIEW_MAP → rendered component
// "portfolio" is special-cased (setShowPortfolio instead of setActive)
// Sidebar expanded/collapsed via navExpanded state in App Shell
// Copilot visible/collapsed via copilot state + internal collapsed state
```

---

## ATOS Lifecycle Stages

```
1.  Idea              → Initial concept and hypothesis
2.  Opportunity       → Market and business opportunity assessment
3.  Business Case     → Financial model and investment justification
4.  Outcomes          → Measurable business outcomes and KPIs
5.  Capabilities      → Human + Agent capability design
6.  Agents            → Agent architecture and blueprint
7.  Architecture      → Enterprise and technical architecture
8.  FDE Prototype     → Forward Deployed Engineering prototype
9.  Build             → Engineering delivery and implementation
10. Delivery          → ADM learning cycles and workplan
11. Governance        → AI risk, compliance, and controls
12. Adoption          → Change management and user adoption
13. Value Realization → Business value tracking and optimization
```

### ADM (Agentic Delivery Methodology) replaces Agile
```
Observe → Reason → Design → Simulate → Deploy → Learn → Evolve

Agile Term       → ADM Term
User Stories     → Outcome Hypotheses
Epics            → Capabilities
Features         → Agents
Sprints          → Learning Cycles
Story Points     → Agent Complexity Score
Velocity         → Outcome Realization Rate
Retrospective    → Agent Learning Review
```

---

## TITAN™ Intelligence Framework

**TITAN™ = Transformation Intelligence & Analytics Network**

4-layer architecture:
1. **Signal Layer** — Real-time program signals
2. **Pattern Layer** — Matches against Transformation DNA™
3. **Inference Layer** — Predictions and risk assessments
4. **Action Layer** — Prioritized next-best actions

6 intelligence modules:
- `OPE` — Outcome Prediction Engine™
- `DI`  — Decision Intelligence™
- `WI`  — Workforce Intelligence™
- `DNA` — Transformation DNA™
- `BME` — Benchmarking Engine™
- `SM`  — Scenario Modeling™

---

## Extension Points for Codex

### To add a new workspace:
1. Create `function NewView() { ... }` following existing view patterns
2. Add to `NAV` array with `group: "tools"` or `group: "journey"`
3. Add to `VIEW_MAP`
4. Add to `COPILOT_CONTEXT`
5. If project-specific data needed, add to `PROJECT_TEMPLATES` and create accessor

### To add a new industry template:
1. Add industry key to `PROJECT_TEMPLATES` with full data model
2. Add to `INDUSTRY_ACC` array
3. Add to `industryColor` maps in PortfolioView and ProjectSwitcher
4. Add compliance controls to `getControls()` in GoverView
5. Add to `NewProjectModal` industry selector

### To add backend persistence:
- Replace `let _projects` with API calls
- Replace `callClaude` with backend proxy
- Add auth token to fetch headers

### To add charts/visualizations:
- Recharts or D3 can be imported alongside React
- The `ReadinessBar` and `ScoreRing` components are pure SVG — extend these
- The TwinView LAYERS array is the right pattern for complex visualizations

---

## Known Intentional Decisions

- **Single file** — All code in App.jsx for portability and demo simplicity
- **No CSS files** — All styling inline for predictable rendering in any environment
- **Mutable global store** — `_projects` and `_activeProjectId` are module-level mutable
  variables, not React state, to allow cross-component access without prop drilling
- **No router** — Navigation is state-based (`active` string) for simplicity
- **Governance controls** derived dynamically — `getControls(industry)` in GoverView
  builds controls based on active project's industry rather than static data
- **GOV_CONTROLS constant removed** — governance is per-industry, not static
