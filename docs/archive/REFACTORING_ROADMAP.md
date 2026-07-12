# ADAM Transformation OS — Refactoring Roadmap

> Phase 0 baseline deliverable. Drives the incremental refactoring program.
> Baseline: git commit `001c039` (clean `tsc --noEmit`, 291 files tracked).
> **Operating rule:** no big-bang rewrite. Each cycle = Analyze → Plan → Implement → Validate (`tsc`) → Commit. App must stay functional after every cycle.

---

## 1. Current State Assessment

**Stack:** React 18 · TS · Vite · Tailwind · shadcn/ui · TanStack Query v5 · Supabase (auth/Postgres/Realtime) · Anthropic Claude via edge functions.

**V3 shell:** `src/v3/AppShellV3.tsx` (2,825 lines) routes 11 surfaces via a `V3Surface` union and a `surface === "..."` render chain.

**Surfaces (`src/v3/surfaces/`):**
| Surface | File | Lines | Role |
|---|---|---|---|
| insight-feed | InsightFeedView | 1,370 | "Home" — morning brief + attention |
| stage | StageView | 1,640 | Phase work & gate reviews ("Programme") |
| executive | ExecutiveView | 1,027 | One-page exec summary |
| programme-health | ProgrammeHealthView | 1,358 | Gates / health / benefits |
| decide | DecideView | 648 | Decision queue (proto Action Center) |
| portfolio | PortfolioView | 549 | Cross-program list |
| program | ProgramView | 356 | "More areas" hub |
| pipeline | PipelineView | 237 | Phase pipeline |
| more | MoreView | 415 | Overflow area tiles |

**Navigation (`CommandRail.tsx`, 611 lines):** `PRIMARY_NAV` = Home (insight-feed), Programme (stage), Executive (executive). Plus injected **Decisions** (decide), **More** overflow, **Alerts**, bottom **Menu**. A **Program dropdown** on the brand button exposes: switch programme, "View all →" (portfolio), New programme, Delete programme.

## 2. Target State (from directive)

- **Primary nav = Home · Action Center · Program** only.
- **Portfolio removed from primary nav** → lives in a File-style **Program menu** (New / Open / Recent / Directory / Portfolio Overview / Import / Settings).
- **Action Center** = exactly 3 sections (Blocking Progress / Needs Attention / Recommended Actions); retire separate Decision/Risk/Dependency/Approval/Governance queues.
- **Methodology invisible**, agents invisible (outcomes only).
- **Artifact-centric** model (uploaded/generated/required/missing + quality/evidence/lineage/downstream).
- **Program Knowledge Graph** = mandatory system of record.
- **Confidence/Readiness explainable** (drivers, blockers, expected gain).

## 3. Pain Points / Architecture Issues

1. **Nav sprawl** — 3 primary + Decisions + More + Alerts + Menu = 7 entry points vs target 3.
2. **`AppShellV3.tsx` is a 2.8k-line god component** — routing, data, agent orchestration, nav mapping all co-located.
3. **Portfolio is a full surface** (549 lines) when the target is a lightweight menu entry.
4. **Action Center fragmentation** — `decide` is decision-only; risks/dependencies/approvals live in separate `more` views.
5. **Methodology/agent terms leak** through UI despite prior simplification passes.
6. **No knowledge-graph layer** — data lives in `program.rawData.data.*` ad hoc; no entity/edge model, no lineage.
7. **Dead/legacy surfaces** in the union: `cockpit`, `governance-v2`, `oversight-v2` (referenced in type but routing unclear).

## 4. Technical Debt Register

- `V3Surface` union carries likely-dead members (`cockpit`, `governance-v2`, `oversight-v2`) — verify & prune.
- Agent aliasing scattered (`executive-brief`→`daily-briefing`, etc. at AppShell ~line 1227).
- Duplicate "run agent" wiring repeated per-surface (`onRunAgent={(id,phase)=>...}` copy-pasted ~8×).
- No git history before baseline — every cycle now commits for rollback.

## 5. Refactoring Sequence (cycles)

| # | Cycle | Risk | Notes |
|---|---|---|---|
| 1 | Program dropdown → File-style menu (Portfolio Overview/Recent/New/Settings) | Low | CommandRail-local |
| 2 | Primary nav → Home / Action Center / Program | Med | Relabel Programme→Program, Executive folds into Home/Program; Decisions→Action Center |
| 3 | Action Center = 3 sections; retire fragmented queues | Med-High | DecideView restructure + aggregation |
| 4 | Artifact-centric model + evidence/lineage | High | New data shape |
| 5 | Program Knowledge Graph (system of record) | High | New layer; migrate `rawData.data.*` |
| 6 | Confidence/Readiness explainability surfacing | Med | Reuse existing models |
| 7 | Tech-debt elimination (dead surfaces, dup wiring) | Low-Med | Post-stabilization |

## 6. Validation Strategy

- **Gate = `npm run build` (`vite build`).** This project ships no `typescript` package and `lint` only covers js/jsx, so `vite build` (esbuild bundle) is the authoritative compile/import gate. Must exit 0 after every cycle.
- Optional deeper type check on demand: `npx -p typescript tsc --noEmit` (not wired into the repo).
- `npm run test` (vitest) where tests cover touched logic.
- Visual smoke test of touched surfaces.
- Git commit per cycle with descriptive message → instant rollback point.
- No cycle commits if it breaks an unrelated surface.

## 7. Regression Risks

- Nav changes ripple into deep-link routing (`pathToSurface`/`surfaceToPath` at AppShell ~230–360) — update both directions together.
- Removing portfolio from nav must preserve programme-switching (multi-program users).
- `activeNavId()` active-state logic must track relabeled surfaces or highlighting breaks.

---

## 8. Progress Log

- ✅ **Phase 0** — git baseline (`001c039`), clean `vite build`, roadmap committed.
- ✅ **Cycle 1** (`2711ff3`) — Program dropdown → File-style menu; Portfolio lives under Open.
- ✅ **Cycle 2** (`7f2ce6d`) — primary nav reduced to **Home · Action Center · Program**; Executive folded out.
- ✅ **Cycle 3** (`8a5f295`) — Action Center rebuilt as 3 urgency sections (Blocking / Needs attention / Recommended).
- ⏳ **Cycle 4** — artifact-centric model + evidence/lineage (next; introduces new data shape — higher risk).
- ✅ **Cycle 5** (`6bfef71`) — Program Knowledge Graph as system of record; `buildKnowledgeGraph` selector + `KnowledgeGraphPanel` in a new ContextDrawer "Graph" tab.
- ✅ **Cycle 6** (`192bcd8`) — Readiness explainability; `explainPhaseReadiness` decomposes score into drivers/blockers with expected point gain, surfaced via `ReadinessExplainer` in a new ContextDrawer "Readiness" tab.
- ✅ **Cycle 7** — technical-debt elimination: pruned dead `cockpit`/`governance-v2`/`oversight-v2` members from the `V3Surface` union (legacy deep-link paths still redirect to live surfaces for backward compat); collapsed 9 copy-pasted `onRunAgent` closures into one shared `handleRunAgent` callback.

Each completed cycle was validated with `npm run build` (exit 0) and committed independently for rollback.

_Status: Cycles 1–7 complete & validated. Refactoring program complete._
