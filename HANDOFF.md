# ATOS Flow — Engineering Handoff

The single orientation document for anyone taking over this codebase. Everything here
was true at handoff; verify against the code where it matters, the code wins.

## What this is

**ATOS Flow** runs a consulting engagement as a closed evidence loop:

> **Frame → Listen → Envision → Show → Ship → Evolve (∞)**

Stakeholder conversations are captured as evidence; AI agents compile evidence into
formal documents (charter, ontology, atlas, architecture, blueprint, demo scripts…);
gates hold until the record is complete, current, and free of open questions; anything
requiring human judgment lands in the Inbox as a proposal that must be confirmed before
it touches the record. The demo, not the document, is the gate.

## Run it

```bash
npm install
npm run dev        # vite, http://localhost:5173
npm run validate   # typecheck + lint + build + test — the handoff gate, all green
```

- **Supabase project**: `vudqrrqpipnkxzxslbim` (auth, Postgres, Realtime, Edge Functions).
- Client env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (a publishable `sb_…` key; safe in the client).
- Deploy an edge function: `npx supabase functions deploy <name>` (add `--no-verify-jwt`
  **only** for `flow-portal` — it is the public, token-gated face).

## Architecture in five rules

1. **One blob per programme.** Everything lives in `adam_programs.data` (JSONB) —
   inputs, evidence, formal document mirrors, decisions, attestations, portal inbox,
   tracks, briefs. Two historical shapes exist (`{data: inner}` or inner at the root);
   always go through `getProgramState` / `wrapProgramState` (`src/new/lib/programState.ts`).
2. **Derive, don't store.** Gate states, coverage, staleness, the spine plan, the board
   pack — all recomputed from the blob on render (`src/v3/components/flow/flowShellData.ts`
   is the derivation heart). If you find yourself persisting a derived value, stop.
3. **Propose, then confirm.** Nothing system-initiated mutates the record directly.
   Agents, watchers, and the edge queue Tier-2 decisions (`flowDecisions` array);
   `resolveFlowDecision` applies a confirmed decision's payload. Every payload family
   has a preview in `describeDecisionChanges` — a coherence test pins this.
4. **Attest everything.** Every write appends to `flowAttestations` (capped 200).
   The trail is the audit story; the Control view renders it.
5. **Staleness is a fingerprint.** `movementInputsFingerprint` (djb2 over key-sorted
   inputs, `_`-keys excluded) is computed identically client-side and edge-side.
   `edgeLockstep.test.ts` parses BOTH sources and fails CI if they drift.

## The map

```
src/main.jsx                    entry → lazy-loads v3/AppShellV3
src/v3/AppShellV3.tsx           shell: auth, programme state, realtime, watcher effects,
                                every persist handler (persistFlowMutation is the chokepoint)
src/v3/components/flow/
  FlowShell.tsx                 dock (views: Inbox/Flow/Library/Pulse/Control/Portfolio),
                                hero, switcher, Today/Inbox surface, Library (facets,
                                person-grouped evidence, artifact ledger), Pulse, Control
  FlowCanvas.tsx                the six movements, each rendered as the loop's three
                                STAGES — Collect → Paper → Gate — under a header carrying
                                the gate gauge, the movement brief, and the ranked
                                "Up next" queue; [ ] cycles stages
  flowStages.ts                 the stage model: MovementTab, captions, lead stage
  flowUpNext.tsx                the Up-next queue: ranked frontier verbs, two-step
                                confirm items, spine regeneration with live progress
                                (module-level run store survives remounts)
  CollectBoard.tsx              the Collect stage's status board (Heard/Waiting/To reach),
                                one card per person: script, channels, feedback trail,
                                capture box, transcript speaker-mapping
  MeetingKitCard.tsx            the movement kit for roster-less movements: script,
                                channels, capture, contradiction resolve/file flags
  flowCapture.tsx               attach-a-file (extract → review → evidence) and
                                transcribe-a-recording, shared across all capture points
  flowShellData.ts              ALL derivations: gates, checklists, staleness, open issues,
                                spine plan, evidence ids/stamps/excerpts, roster
                                attestation proposals, locateQuote (span grounding)
  flowEvidenceRank.ts           quote salience: rank, dedupe, noise detection
  flowTranscriptMap.ts          meeting transcript → per-speaker attributed blocks
  flowDecisions.ts              decision queue + resolver families + previews + docSectionDiff
  flowMeetings.ts               interview kits: gap → askable question → script
  flowWatchers.ts               client watchers (unrostered voices, re-demo) → Tier-2 proposals
  flowPortal.ts                 async links: interview packs, demo invites, quarantined inbox
  flowBriefs.ts                 sponsor briefs: dated board-pack snapshots behind tokens
  flowTracks.ts                 tracks (from the Blueprint's adopted plan), passes, acceptance
  studio/                       artifact studios: DocumentView (typeset projection),
                                graph editors (ontology/workflow/blueprint/strategy/journeys),
                                FlowArtifactStudio (frame: grounding, what-changed, editing)
src/v3/lib/blobGuard.ts         zod advisory validation + BLOB_VERSION migrations
src/v3/lib/blobSnapshots.ts     IndexedDB snapshot ring (10/programme) at the write chokepoint
supabase/functions/
  run-agent/index.ts            ~9.6k lines: every agent contract + persist path (see Debt)
  flow-portal/index.ts          public: response links, demo verdicts, sponsor briefs (?brief=)
  flow-transcribe/index.ts      Whisper transcription; 501 when OPENAI_API_KEY unset
  _shared/claudeClient.ts       provider abstraction (Anthropic/OpenAI keys)
```

## The loops (what must never break)

- **Evidence loop**: kit script → conversation captured (typed, dictated, or transcribed
  recording) → fingerprint moves → documents flagged stale → regenerate (spine or per-card)
  → gate recomputes.
- **Async loop**: minted links (`?flowRespond=`) → flow-portal quarantines into
  `flowPortalInbox` → operator ingests in the Inbox → becomes evidence. Nothing enters the
  record unreviewed.
- **Conflict loop**: contradictions (edge-detected in Atlas runs, watcher-detected across
  evidence) are stripped from documents and queued as `contradictionEntries` decisions —
  routed to the sponsor, resolution recorded with what/who/when. CI pins this routing.
- **Ambiguity loop**: unresolved ontology ambiguities and document openQuestions hold the
  gate (`movementOpenIssues`) and flow into follow-up interview scripts. The gate cannot
  complete while the record still asks questions.
- **Track loop** (Show): each Blueprint track demonstrates to a named REAL stakeholder —
  demo link verdicts or in-room passes accumulate; Show's gate wants every track accepted.
- **Regeneration guard**: hand-edited documents (`editedAt` set) are never overwritten —
  regeneration proposes in the Inbox instead.
- **Attestation loop** (Listen): collection ≠ judgment. The People board counts collected
  evidence + responded links; the GATE counts roster rows the operator attested Heard/Waived
  (the coverage ledger). When evidence lands for un-attested voices, `attestHeardRoster`
  proposes the flip as a two-step confirm in the Up-next queue (word-prefix name matching —
  substrings can never attest anyone).

## Secrets (Supabase function env)

| Secret | Effect when set | When unset |
|---|---|---|
| `ANTHROPIC_API_KEY` / provider keys | agents run | runs fail with a clear error |
| `OPENAI_API_KEY` | recording transcription (Whisper) | flow-transcribe answers 501; the button hides itself |
| `SLACK_WEBHOOK_URL` | ping on queued decisions + portal responses | strict no-op |

## Testing & CI

- `npx vitest run` — 809 tests / 47 files. The load-bearing suites:
  - `flowLibs.test.ts` — gate verdicts pinned word-for-word, decision resolution, briefs, locateQuote
  - `coherence.test.ts` — cross-surface invariants (every decision family has a preview, checklist groups)
  - `edgeLockstep.test.ts` — client/edge parity by parsing both sources (fingerprints,
    vocabulary steering, conflict routing, studio docOrder vs agent JSON contracts)
- `.github/workflows/ci.yml` runs typecheck + lint + test on push.
- Gate messages are PINNED. If you reword one, the test fails — that is the point;
  update both deliberately.

## Known debt (honest list)

1. **`run-agent/index.ts` is a ~9.6k-line monolith** — all agent contracts, steering
   tables, persistence, and watchers in one file. It works and is lockstep-tested, but
   splitting it (contracts / persist / watchers) is the single biggest refactor waiting.
   Do it with `edgeLockstep.test.ts` green at every step.
2. **Classic-era modules under `src/new/`, `src/lib/`, `src/hooks/`** are still
   load-bearing (programme state, agent runs, copilot, setup wizard) but carry patterns
   from the pre-Flow app; several AppShell hooks are called for side-effects only.
   Consolidation candidates, not dead code — the reachability audit confirms all are imported.
3. **JWT-authenticated REST writes from outside the app** (used during operations work)
   bypass the IndexedDB snapshot ring — the ring only captures writes through
   `usePrograms.updateProgramData`. Prefer in-app flows; if you must patch directly,
   use compare-and-set on `updated_at` and append an attestation (see the trail for examples).
4. **Realtime auth token** expires ~hourly; the client refreshes via Supabase auth,
   but long-idle tabs may need a reload to resubscribe.

## Operational notes

- **Pending, deliberately not applied**: `supabase/migrations/20260714_event_journal.sql`
  creates the append-only `adam_program_events` table; the client dual-write
  (`src/v3/lib/flowEvents.ts`) is wired but dormant until the migration is applied and
  the uncommitted-era `run-agent` change is deployed. Apply + deploy together.
- The **snapshot ring** (Control → Safety) restores any of the last 10 blob states, attested.
- The **board pack** (Pulse) prints to PDF and mints shareable sponsor briefs (90-day expiry).
- **Clone** ("New from this programme") carries industry/segment/client + ontology
  standard mappings only — evidence and documents stay with the source programme.
