# ATOS Cleanup Inventory & Phased Plan

> Goal: remove everything obsolete, redundant, or confusing while **preserving the
> four core screens and all methodology/data/artifact logic**. No UI redesign, no
> methodology change, no input-model change.

## Verified live shell (the ground truth)

Entry: `index.html` → `src/main.jsx` → **`src/v3/AppShellV3.tsx`** (the only mounted shell).

Primary navigation (`src/v3/components/CommandRail.tsx`) maps to the four core screens:

| Core screen | Live surface id | Route | Component (tracked) |
|---|---|---|---|
| **Today** | `insight-feed` | `/home` | `src/v3/surfaces/InsightFeedView.tsx` |
| **Activity** (“Action Center”) | `decide` | `/decide` | `src/v3/surfaces/DecideView.tsx` |
| **Program** | `stage` / `program` | `/program`, `/:phaseId` | `ProgramView.tsx` + `StageView.tsx` |
| **Executive Overview** | `executive` | `/executive` | `src/v3/surfaces/ExecutiveView.tsx` |

Extra **live (tracked, wired)** surfaces NOT part of the four core screens — consolidation candidates (Phase 2/3, higher risk because they touch the shell):
`PipelineView.tsx` (`/pipeline`), `PortfolioView.tsx` (`/portfolio`), `ProgrammeHealthView.tsx` (`/programme-health`), and `MoreView.tsx` (the “workspaces/More” hub with sub-views: intelligence, documents, etc.).

### Tracking-status legend
- **UNTRACKED** = not in git (`git ls-files` empty). Never committed, not in the build. Deletion is permanent (no git restore) but risk-free to the running app.
- **TRACKED-DEAD** = committed but unreachable from the live shell. Deletion is git-recoverable.
- **LIVE** = reachable from `AppShellV3.tsx`. Do not delete without a shell edit.

---

## INVENTORY

Each item: **name · path · current purpose · why obsolete · action · dependency risk · cleanup action · validation**.

### Group 1 — Legacy app shells & their trees (CONFIRMED dead)

1. **Pre-V3 app shell** · `src/App.jsx` · old root component/router · superseded by V3; **UNTRACKED**, zero importers (`grep @/App` = 0), not in build · **DELETE** · risk: low · delete file · validate: build+lint+test green, `/` still loads.
2. **Old view components** · `src/components/**` · ~50 old “…View” components + UI · only imported by `src/App.jsx` (dead); **UNTRACKED**, zero imports from `src/v3`/`src/new` (`grep @/components` from live = 0) · **DELETE** (whole dir) · risk: low · delete dir · validate: build green.
3. **Old pages** · `src/pages/**` (ValidationConsole, WalkthroughTest, SanityTest, AgentObservabilityView) · debug/test pages · only imported by `src/App.jsx`; **UNTRACKED** · **DELETE** · risk: low · delete dir · validate: build green.
4. **Legacy shell “flavor2”** · `src/flavor2/**` · alternate shell kept “for reference” (SHELLS.md) · not mounted, zero imports; **TRACKED-DEAD** · **DELETE** · risk: low · delete dir + update SHELLS.md · validate: build green.
5. **Legacy shell “new/AppShell”** · `src/new/AppShell.tsx` · pre-V3 shell · only referenced by a dead side-effect import `src/test/setup.ts:25` (`await import("../new/AppShell")`); **TRACKED-DEAD** · **DELETE** · risk: low · delete file **and** remove line 25 of `src/test/setup.ts` + update SHELLS.md · validate: `npm test` green.

### Group 2 — Untracked, never-wired V3 scaffolding (CONFIRMED dead)

An entire alternate V3 surface/component/lib layer was generated but never imported by `AppShellV3.tsx`. All **UNTRACKED**.

6. **Orphan surfaces** · `src/v3/surfaces/{TodayView,JourneyView,DecisionsView,ReportsView,OversightView,GovernanceView,PhaseCockpit}.tsx` · alternate dashboards · AppShellV3 lazy-loads only the 9 tracked surfaces; these are not among them · **DELETE** · risk: low (note: `TodayView.tsx` is NOT the live Today screen — that is `InsightFeedView`) · delete files · validate: build green.
7. **Orphan components** · `src/v3/components/{AgentMetricsPanel,ArtifactHistoryDrawer,ArtifactLedger,AutonomySettings,ContextHeader,DecisionCard,ExecCommandPanel,GateApprovalModal,GateTimeline,KnowledgeGraphPanel,PhaseFlowBar,PhaseInputArtifactMap,PhaseMethodologyChecklist,PhaseProgressionCard,PhaseSheet,SmokeTestButton}.tsx` and `src/v3/components/ui/{AutoSaveField,Button,ConfidenceBadge,ConfirmPopover,CopyButton,DelayedConfirmButton,NumberCountUp,RichTooltip}.tsx` · scaffolding widgets · **UNTRACKED**; must grep each for importers before delete (a few may be imported by other untracked scaffolding only) · **DELETE if unimported by live code** · risk: low–med · per-file grep, then delete · validate: build green.
8. **Orphan lib/hooks** · `src/v3/lib/{agentConfidence,dataExport,documentParser,regulatoryFrameworks,semanticColor,viewStateStore}.ts`, `src/v3/hooks/{useKeyboardShortcuts,useOptimisticUpdate}.ts`, `src/new/lib/useDocumentImport.ts`, `src/new/pages/{HomeView,WorkView}.tsx`, `src/new/components/shell/{AdvisorBar,AgentActivityRail,CommandBar}.tsx`, `src/hooks/useGateRiskMonitor.ts` · helpers for the scaffolding above · **UNTRACKED**, zero live importers (verify each) · **DELETE** · risk: low · per-file grep, delete · validate: build+test green.
9. **Stray scripts/assets** · `scripts/{deadcheck,exportcheck,generate-atos-workbook}.mjs`, `ATOS_Phases_and_Agents.xlsx`, `src/v3/__tests__/documentParser.test.ts` · dev one-offs · **UNTRACKED** · **DELETE** (keep only if you still want the workbook generator) · risk: low · delete · validate: `npm test` green (removing documentParser test alongside its dead module).

### Group 3 — Tested-but-unwired frontend modules (TRACKED; decision needed)

These are committed, pass tests, but have **no runtime importer** in the live shell. They were optimization/architecture infrastructure that was wired into the **edge** runtime instead (see `supabase/functions/_shared/modelCatalog.ts`).

10. **`src/v3/lib/modelRouting.ts`** · agent→model tier registry · superseded by edge-side `modelCatalog.resolveAgentTier`/`modelForTier`; only imported by `tokenObservability.ts` + its test; also references 5 **deleted** agent ids · **DELETE** (or keep purely for an admin cost UI) · risk: low · delete + its test · validate: test green.
11. **`src/v3/lib/tokenObservability.ts`** · cost ledger math · the live ledger now lives in the edge (`estimateCostUsd` + `response_received` observation); frontend copy unused except its test · **DELETE unless** an admin observability screen is planned (not one of the 4 core screens) · risk: low · delete + test · validate: test green.
12. **`src/v3/lib/{contextContracts,knowledgeGraph,graphTraversal}.ts`** + **`KnowledgeGraphPanel.tsx`** · context-scoping/knowledge-graph framework · never wired into the agent pipeline; mutually-referential dead cluster · **DELETE** · risk: low · delete cluster + tests · validate: test green.
13. **`src/v3/lib/{intelligenceReuse,artifactConvergence,artifactFreshness}.ts`** · dedup/convergence/freshness math · no runtime importer (tests only); overlaps live `artifactStaleness.ts` · **DELETE** · risk: low · delete + tests · validate: test green.

### Group 4 — Stale references to deleted agents (TRACKED; must fix)

The 5 agents deleted earlier (`artifact-staleness-check`, `phase-readiness-monitor`, `workstream-health-scorer`, `scope-creep-monitor`, `budget-anomaly-detector`) are still named in config/tests.

14. **`src/v3/lib/agentChangeSensitivity.ts`** (LIVE — imported by `src/new/lib/useAgentTriggers.ts`) · references `scope-creep-monitor` · **REFACTOR**: remove the dead entry · risk: med (live module — keep its real exports) · edit out the stale id + its test refs · validate: test green.
15. **`src/new/lib/useAgentTriggers.ts`** (LIVE) · stale `scope-creep-monitor` gate check · **REFACTOR**: drop the stale branch · risk: med · edit · validate: test + Activity screen still triggers agents.
16. **Test fixtures** · `modelRouting.test.ts`, `intelligenceReuse.test.ts`, `tokenObservability.test.ts` · assert on deleted agents · **DELETE with their modules** (Group 3) or update · risk: low · validate: test green.

### Group 5 — Backend (edge functions & tables)

17. **Edge functions** — all 10 callable functions are actively invoked; **keep**: `run-agent`, `configure-ai-settings`, `copilot-chat`, `document-intelligence`, `get-agent-trace`, `manage-program-access`, `meeting-notes-processor`, `restore-artifact`, `resume-agent`, `save-document`. **`schedule-agent`** has no frontend caller **by design** (invoked by pg_cron `adam-schedule-runner`) — **KEEP**, document the cron dependency.
18. **Unreferenced tables** · `adam_access_audit`, `adam_document_entity_audit` · created in migrations, referenced nowhere in `src/**` or `supabase/functions/**` · **VERIFY then DROP** (separate migration) · risk: med (RLS/trigger deps) — confirm no policy/trigger writes before dropping · validate: app runs, no Supabase errors.
19. **Terminology** · `adam_*` table prefix & `ADAM_AI_*` env vars vs “ATOS” branding · pervasive (25+ tables) · **DO NOT rename** (migration cost ≫ benefit); treat `adam_` as intentional internal namespace. Only fix user-facing copy if it leaks “ADAM”.

### Group 6 — `src/lib/*` legacy utilities (TRACKED; per-file verify)

Audit flagged these as imported only by the dead `src/App.jsx`: `adamAgentPrompts, adamAgents, adamAgentTriggers, adamArtifacts, adamPromptRegistry, adamSanitySeed, adamUtils, adamValidationSeed, BrandingContext, errors, programEvents, runAdamAgent, supabaseFunctionError, useCurrentOrg, useNetworkStatus`.
⚠️ **Not yet confirmed** — `src/hooks/useAdamAgentTriggers.ts` references `adamAgents`-family symbols, so some may have non-App.jsx consumers.
20. **`src/lib/*` legacy utils** · **REFACTOR/DELETE per file** after a grep confirming the *only* importer is `App.jsx` (being deleted) · risk: med · delete only the confirmed-orphan subset · validate: build+lint+test green.

---

## PHASED CLEANUP PLAN

**Phase 1 — Safe deletions** (no shell edits; pure removal of dead/unreachable code)
- Group 1 (legacy shells: App.jsx, components, pages, flavor2, new/AppShell + test/setup.ts line 25).
- Group 2 (untracked scaffolding surfaces/components/lib/hooks/scripts), per-file grep first.
- Group 3 (tested-but-unwired modules + their tests).
- Validate after each batch: `npm run build && npm run lint && npm run test`.

**Phase 2 — Navigation & route cleanup**
- Decide on extra live surfaces (Pipeline, Portfolio, ProgrammeHealth, MoreView hub). Per the rule “if it doesn’t support one of the 4 core screens, remove it unless there’s a dependency,” remove their nav entries/routes and the surfaces, OR consciously keep. Touches `AppShellV3.tsx`, `CommandRail.tsx`, route maps. Validate routes: `/`, `/decide`, `/program`, `/:phaseId`, `/executive` all load; removed routes 404-redirect cleanly.

**Phase 3 — Component consolidation**
- Remove components only used by surfaces deleted in Phase 2.
- Collapse any duplicate artifact/decision views into the core screens.

**Phase 4 — State / API cleanup**
- Remove hooks/state/services that supported only deleted flows (Group 6 confirmed subset).
- Verify no dead `supabase.functions.invoke` / `.from(<table>)` calls remain.

**Phase 5 — Prompt & terminology cleanup**
- Remove stale deleted-agent refs (Group 4). Update `ADAM_CODEX_*` docs and `SHELLS.md`. Fix prompts referencing removed screens/old terms.

**Phase 6 — Regression validation**
- Today loads (active plan + progress). Program walks all methodology phases (inputs/artifacts intact). Activity supports drill-in → input highlight → bottom toast that clears on typing. Executive Overview shows health + generates narrative/summary. No broken routes, no menu items to removed screens, no console errors, no failing Supabase calls, no methodology logic change. `npm run build && npm run lint && npm run test` all green.

---

## Risk controls
- One commit per coherent batch, with `Co-Authored-By` trailer; build+lint+test after each.
- **Untracked files are unrecoverable once deleted** — grep-verify “no live importer” per file before removing.
- Backend table drops happen last, in their own migration, after confirming no RLS/trigger dependency.
