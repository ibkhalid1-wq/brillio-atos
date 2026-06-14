# Brillio ATLAS™

### AI-Native Transformation. Delivered.

Powered by **ATOS™** — Agentic Transformation Operating System

---

## Quick Start

```bash
# Install dependencies
npm install

# Run development server (opens at http://localhost:3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Deploy to Vercel (recommended)

```bash
# One-command deploy (creates shareable URL)
npx vercel

# Or deploy production build
npm run build
npx vercel --prod
```

## Deploy to Netlify (drag and drop)

```bash
npm run build
# Drag the dist/ folder to netlify.com/drop
```

---

## Project Structure

```
src/
└── App.jsx    — Complete application (single file, 3,549 lines)
```

All code is in a single `src/App.jsx` for maximum portability.

---

## What's Inside

### 15 Workspaces
| Workspace | Description |
|-----------|-------------|
| Command Center | ATOS lifecycle health, KPIs, risks, decisions |
| Portfolio | Multi-program management |
| Discover | Idea → Opportunity → Business Case → Outcomes |
| Design | Capability Studio — Human + Agent capabilities |
| Agent Architecture™ | Agent blueprints, autonomy, tools, escalation |
| Build | Engineering packages for 10 build targets |
| Operate | Per-industry governance and compliance |
| Optimize | Value Realization Office |
| Transformation Twin™ | Digital twin + scenario modeling |
| Forward Deployment™ | FDE pipeline — idea to production |
| Delivery™ | ADM learning cycles, RAID, status reporting |
| Adoption™ | Change management and user adoption tracking |
| TITAN™ Intel Engine | 6 AI intelligence modules |
| Industry Accelerators™ | Pre-built patterns for 6 industries |

### 3 Sample Programs
- **Agentic Commercial Insights** — Life Sciences (Global Life Sciences Corp)
- **Agentic Risk & Fraud Platform** — Financial Services (Meridian Financial Group)
- **Patient Services Transformation** — Healthcare (NovaCare Health System)

### ATOS 13-Stage Lifecycle
Idea → Opportunity → Business Case → Outcomes → Capabilities → Agents →
Architecture → FDE Prototype → Build → Delivery → Governance → Adoption →
Value Realization

### Brillio Copilot™
Context-aware AI assistant using Claude API. Collapses to a 44px rail.
Each workspace has custom system prompts, role identity, and quick actions.

### TITAN™ Intelligence Framework
- Outcome Prediction Engine™
- Decision Intelligence™
- Workforce Intelligence™
- Transformation DNA™
- Benchmarking Engine™
- Scenario Modeling™

---

## Environment

No `.env` file required. The Anthropic API key is injected by the Claude.ai
proxy when running in the artifact environment.

For standalone deployment, add your own API key:

```js
// In src/App.jsx, update callClaude():
headers: {
  "Content-Type": "application/json",
  "x-api-key": "YOUR_ANTHROPIC_API_KEY",        // add this
  "anthropic-version": "2023-06-01",             // add this
  "anthropic-dangerous-direct-browser-access": "true"  // add this
},
```

---

## Tech Stack

- React 18
- Vite 4
- Anthropic Claude API (claude-sonnet-4-20250514)
- Pure inline styles (no CSS framework)
- Zero UI library dependencies

---

## License

Brillio Internal — Confidential
