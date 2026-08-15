# Brillio ATOS™ — Flow

### AI-Native Transformation, run as a closed evidence loop.

Powered by **ATOS™** — Agentic Transformation Operating System.

---

> **New to this codebase? Read [HANDOFF.md](HANDOFF.md) first.** It is the single
> engineering orientation doc — architecture, data model, edge functions, secrets,
> testing, and the honest debt list all live there. This README is just the front door.

## What it is

ATOS Flow runs a consulting engagement as a closed evidence loop:

> **Frame → Listen → Prototype → Ship → Evolve (∞)**
>
> *Prototype is a **Design ⇄ Validate** loop — the delivery team shapes the prototype,
> clients sign off area by area, and change requests fold back in until every area
> converges (the Envision + Show movements, under the hood).*

Stakeholder conversations are captured as evidence; AI agents compile that evidence into
formal artifacts (charter, domain ontology, current-state atlas, architecture strategy,
agentic blueprint, demo scripts, ship & hardening plans…); gates hold until the record is
complete, current, and free of open questions; anything needing human judgment lands in
the Inbox as a proposal that must be confirmed before it touches the record. **The demo,
not the document, is the gate.**

## Quick start

```bash
npm install
npm run dev        # Vite dev server → http://localhost:5173
npm run validate   # the gate: typecheck + lint + build + test (all green)
```

`npm run validate` runs the full gate. If the combined build+test run is memory-hungry on
your machine, run them separately: `npm run build` then
`NODE_OPTIONS="--max-old-space-size=4096" npx vitest run`.

## Backend (required)

This is **not** a standalone front-end — it runs on Supabase (Postgres, Auth, Realtime,
and Edge Functions). Project ref: `vudqrrqpipnkxzxslbim`.

Client env (`.env`):

```
VITE_SUPABASE_URL=https://vudqrrqpipnkxzxslbim.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_… key — safe in the client>
```

Edge functions live in `supabase/functions/` (agents, the public token-gated portal,
transcription, document intelligence, access management…). Deploy one with:

```bash
npx supabase functions deploy <name> --project-ref vudqrrqpipnkxzxslbim
# add --no-verify-jwt ONLY for flow-portal (the public, token-gated face)
```

Provider keys (`ANTHROPIC_API_KEY`, optional `OPENAI_API_KEY` for Whisper transcription)
are set as Supabase function secrets, never shipped to the client. See HANDOFF.md → Secrets.

## Codebase shape

```
src/main.jsx                     entry → lazy-loads the Flow shell
src/v3/AppShellV3.tsx            shell: auth, programme state, realtime, persist chokepoint
src/v3/components/flow/          the phases (Prototype = the Envision⇄Show loop),
                                 evidence loop, artifact studios,
                                 derivations (flowShellData.ts), decisions, portal, briefs
src/new/ · src/lib/ · src/hooks/ programme state, agent runs, setup wizard (still load-bearing)
supabase/functions/              edge: run-agent, flow-portal, flow-transcribe, and more
```

~225 TypeScript/TSX source files. **One JSONB blob per programme** (`adam_programs.data`)
is the whole data model; nearly everything else is derived from it on render. The five
architectural rules that keep this honest are in HANDOFF.md → *Architecture in five rules*.

## Testing & CI

```bash
npx vitest run     # 927 tests / 53 files
```

Load-bearing suites: `flowLibs.test.ts` (gate verdicts pinned word-for-word),
`coherence.test.ts` (cross-surface invariants), `edgeLockstep.test.ts` (client/edge parity).
`.github/workflows/ci.yml` runs typecheck + lint + test on push. Gate messages are pinned —
if you reword one, the test fails on purpose; update both deliberately.

## Deploy

The front-end builds to a static bundle (`npm run build` → `dist/`) and deploys to any static
host (Vercel, Netlify, …), but it is inert without the Supabase backend above — the project,
the client env vars, and the deployed edge functions must all be in place. See HANDOFF.md for
the full operational picture (migrations, snapshot ring, board packs, clone).

## Further reading

- **[HANDOFF.md](HANDOFF.md)** — the engineering orientation doc (start here).
- **[DEMO.md](DEMO.md)** — walkthrough / demo script.
- **[CLAUDE.md](CLAUDE.md)** — working conventions for AI-assisted development in this repo.

## Tech stack

React 18 · TypeScript · Vite · Supabase (Postgres · Auth · Realtime · Edge Functions) ·
Anthropic Claude + OpenAI providers (server-side) · plain CSS (`src/v3/v3.css`), no UI framework.

## License

Brillio Internal — Confidential
