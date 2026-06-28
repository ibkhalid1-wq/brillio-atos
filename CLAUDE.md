# Brillio ATOS — Claude Code Guide

## Project overview

ATOS is an agentic delivery-management application. A program is driven through the
**ATOS Standard methodology** — nine sequential phases, each with required artifacts,
mandatory exit criteria, readiness scoring, and a human-approved gate. AI agents draft
artifacts, surface risks/blockers, and recommend actions; the PM reviews and approves.

**Stack:** React 18 · TypeScript · Vite · Tailwind CSS · Supabase (auth + Postgres +
Realtime + Edge Functions) · Vitest.

## Development

```bash
npm install        # install dependencies
npm run dev        # vite dev server at http://localhost:5173
npm run build      # vite build (production); ignore the >1000 kB chunk warning
npm run lint       # eslint . --ext js,jsx  (does NOT cover .ts/.tsx — see note)
npm run test       # vitest run (jsdom; scans src/v3/__tests__/**/*.test.ts)
npm run test:ui    # vitest --ui
```

> Node lives at `~/tools/node/bin`. If a command reports `node: command not found`,
> prefix it with `export PATH="$HOME/tools/node/bin:$PATH"`. The shell cwd may reset
> between Bash calls, so use absolute paths or re-`cd` as needed.

> **Lint coverage gap:** `npm run lint` only lints `.js`/`.jsx`. Almost all source is
> `.ts`/`.tsx`, which ESLint does NOT check here. Rely on `npm run build` (tsc via Vite)
> and `npm run test` to catch type/logic errors.

## Shell ownership (read `src/SHELLS.md`)

Multiple shells exist on disk; **only V3 is live.**

- **Live shell:** `src/v3/AppShellV3.tsx`, mounted by `src/main.jsx`.
- **All shell-level UX / navigation / chrome / presentation work goes in `src/v3/*`.**
- Shared modules V3 renders: `src/new/pages/*`, `src/new/lib/*`, `src/new/components/*`,
  `src/hooks/*` — edit these for shared business logic / page content.
- **Legacy, do NOT touch for new work:** `src/flavor2/*`, `src/new/AppShell.tsx`.

## Methodology model

The nine phases in order (`ATOS_STANDARD` in `src/v3/lib/methodology.ts`):

`strategy → mobilise → discover → design → build → operate → govern → optimize → valuerealize`

Each phase has `requiredArtifacts` and `mandatoryExitCriteriaTemplates`.

- **Phase readiness** — `src/v3/lib/phaseReadiness.ts`: `computePhaseReadiness(program, phaseId, threshold?)`.
  `canApproveGate = score >= threshold && mandatoryExitsPassing && unvalidatedCriticalAssumptions.length === 0 && !dependencyCheckBlocking`.
  `getLockedPhaseIds(program)` is the frontier model (which phases are unlocked).
- **Phase blockers** — `src/v3/lib/phaseBlockers.ts`: `derivePhaseBlockers(program, phaseId)`
  aggregates readiness blockers, poor confidence signals, open RAID risks (critical/high,
  phase-scoped, non-closed), dependencies, overdue decisions, and validation findings.

## RAID model

`RAIDEntry` is defined in `src/new/types.ts` (`type: risk|blocker|assumption|dependency`,
`severity: critical|high|medium|low`, plus `phase`, `status`, `validatedAt?`, etc.).

- **Canonical store:** `data.raidLog.entries`. `deriveRAIDEntries` (`src/new/lib/programData.ts`)
  reads only `raidLog.entries` → exposes `program.raidEntries`. Do not write a parallel store.
- **Mutations** — `src/new/lib/useRaidLog.ts`: `addEntry` requires a `phase`;
  `validateAssumption` sets `validatedAt` + `status: "monitoring"`; `closeEntry` sets
  `status: "closed"` (does NOT stamp `validatedAt`).

## Data / program loading

`src/new/lib/usePrograms.ts`:

- **Local-only mode** when Supabase is not configured: programs load from localStorage keys
  `["brillio-adam-projects", "brillio-atlas-projects"]`, all roles `admin`, no auth.
  Writes go through `persistLocalProgram`. Active program key: `adam:new:active-program`.
- **Cloud mode** when configured (`.env.local` points at the ADAM project): fetches the
  RLS-scoped `adam_programs` table; migrates local → cloud on sign-in.

`src/integrations/supabase/client.ts`:
`isSupabaseConfigured = !!(VITE_SUPABASE_URL && VITE_SUPABASE_PUBLISHABLE_KEY)`.

## Edge functions (Deno)

`supabase/functions/*` (e.g. `run-agent`, `resume-agent`, `document-intelligence`,
`copilot-chat`) are Deno and can only be validated by deploying. There is no standalone
`deno`/`supabase` binary on PATH, but `supabase` is a devDependency:

```bash
npx --no-install supabase functions deploy <name> --project-ref vudqrrqpipnkxzxslbim
```

The CLI is authenticated and linked to project `vudqrrqpipnkxzxslbim` ("Brillio - ADAM").
Docker is not required (bundles via the management API; the "Docker is not running" warning
is non-fatal). **Deploys push to LIVE shared infra — confirm with the user before deploying.**

## Working discipline

- Operate as Chief Product/Experience Officer + Architect + Principal Engineer: surgical,
  autonomous, validated improvements focused on `src/v3/`. Token-optimization is a constraint.
- **Validate every change cycle:** `npm run build`, `npm run lint`, `npm run test`.
- **Each change is its own commit** with trailer
  `Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>`.
- **No git remote configured** — commits are local only. Do not push without the user adding one.
- Prefer one consolidated implementation over duplicate/parallel code paths; delete dead or
  superseded logic rather than leaving it — but verify no real functionality is lost first.
