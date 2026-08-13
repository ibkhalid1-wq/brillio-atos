# ATOS Flow — Engineering Handoff

The single orientation document for anyone taking over this codebase — and there is
now exactly one. A second (`docs/aura/HANDOVER.md`, written 2026-08-13) was folded in
here and deleted, because two documents each claiming to be the handover means a new
engineer reads whichever they find first and never learns what is in the other.

Everything here was true at handoff; verify against the code where it matters, the
code wins.

## What this is

**ATOS Flow** runs a consulting engagement as a closed evidence loop:

> **Frame → Listen → Prototype → Ship → Evolve (∞)**

The six methodology *movements* are still frame · listen · envision · show · ship · evolve;
the UI collapses **Envision + Show** into one **Prototype** phase — a Design ⇄ Validate loop
(design the prototype, clients sign off per area, change requests fold back until convergence).

Stakeholder conversations are captured as evidence; AI agents compile evidence into
formal documents (charter, ontology, atlas, architecture, blueprint, demo scripts…);
gates hold until the record is complete, current, and free of open questions; anything
requiring human judgment lands in the Inbox as a proposal that must be confirmed before
it touches the record. The demo, not the document, is the gate.

## Run it

```bash
npm install
npm run dev        # vite, http://localhost:5173
npm run validate   # typecheck + lint + build + test — THE gate. Green at ff67fd1+.
```

`npm run validate` is the gate, and it is the whole gate: CI runs that one command,
so there is no second definition to drift from. If it is red, that is a regression,
not a known state. Node 20 or newer (`.nvmrc` pins what CI uses).

**You will need your own `.env.local`** — deliberately not in the repo. Copy
`.env.local.example` and fill it in. Without it the app runs and every read fails.

- **Supabase project**: `vudqrrqpipnkxzxslbim` (auth, Postgres, Realtime, Edge Functions).
- Client env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (a publishable `sb_…` key; safe in the client).
- Deploy an edge function: `npx supabase functions deploy <name>` (add `--no-verify-jwt`
  **only** for `flow-portal` — it is the public, token-gated face). `run-agent` is at
  **v221** deployed.
- **Edge functions are Deno; `npm test` does not see them.** `npm run check:edge`
  type-checks the two public-facing ones, and CI runs it after `validate`. It is
  deliberately NOT in `validate` — you should not need a second runtime to run the
  project's own gate. Behind a TLS-intercepting proxy, Deno needs
  `DENO_TLS_CA_STORE=system` or its remote imports fail with `UnknownIssuer`.

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
  TheLine.tsx                   THE Flow view (the rail's "Flow" tile): the board —
                                bands, stations, gates — plus Discover (people, durable
                                links, capture) and Record. Read-only projection of the
                                live record with three write paths, all shell handlers.
                                The classic canvas (FlowCanvas.tsx) and the chrome only
                                it mounted — the four cockpits, MeetingKitCard,
                                OntologyAtlasModal, ExternalBuildPanel, flowStages.ts,
                                flowUpNext.tsx, flowPatterns.ts — were DELETED 2026-08-10
                                when the Line/Classic toggle was retired. Recover from
                                git history if a capability needs re-homing.
  CollectBoard.tsx              still imported for `stakeholderCollection` (the per-person
                                collection state TheLine reads); its own board component
                                is no longer mounted anywhere.
  flowCapture.tsx               attach-a-file (extract → review → evidence) and
                                transcribe-a-recording. Only the attach half is still
                                mounted (Library evidence, studio copilot cards);
                                TranscribeButton lost its last mount with the canvas.
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
src/v3/lib/ledger/             THE claims ledger (see the next section)
  store.ts types.ts             FROZEN CORE — a needed change here is a finding
  precedence.ts projections.ts  FROZEN CORE
  useProgramLedger.ts           the projection every surface reads
  operatorActions.ts            the operator verbs, folded (last write wins)
  operatorQueue.ts              THE definition of the Inbox's counts (badge vs page)
src/v3/components/flow/
  OperatorInbox.tsx             the Inbox surface — every block carries a control
  useArtifactRegen.ts           regenerate dispatch + "is it back yet", shared by
                                the Work board and the Library
src/v3/lib/blobGuard.ts         zod advisory validation + BLOB_VERSION migrations
src/v3/lib/blobSnapshots.ts     IndexedDB snapshot ring (10/programme) at the write chokepoint
supabase/functions/
  run-agent/index.ts            ~9.6k lines: every agent contract + persist path (see Debt)
  flow-portal/index.ts          public: response links, demo verdicts, sponsor briefs (?brief=)
  flow-transcribe/index.ts      Whisper transcription; 501 when OPENAI_API_KEY unset
  _shared/claudeClient.ts       provider abstraction (Anthropic/OpenAI keys)
```

## The claims ledger, and the surfaces over it

Everything the operator works is claims about **loci** (`<elementId>#<slot>`), resolved
by a precedence lattice — `code-derived · weak` loses to any human answer.
`store.ts`, `types.ts`, `precedence.ts` and `projections.ts` under `src/v3/lib/ledger/`
are the **frozen core**: treat a needed change there as a finding to raise, not an edit
to make. Surfaces read PROJECTIONS (`useProgramLedger`), never the blob. Operator verbs
are appended as actions and applied as a read overlay; no surface writes the store.

Three surfaces, and the boundary between them is load-bearing:

| surface | what it is | what it may do |
|---|---|---|
| **Work** | the board — bands, stations, gates | operator progress |
| **Discover** | the people — links, capture, invites | READ + engage stakeholders. **No operator moves.** |
| **Inbox** | what needs an operator DECISION | ACT. Every block carries a control. |
| **Record** | who said what, when | read-only, including findings nobody acted on |

Four rules that look like bugs if you do not know them:

- **A question is asked of a PERSON or answered by a DICTIONARY, never both.** Typing
  questions (`dataType` / `valueSet` / `optionality`) route to the data dictionary and
  are absent from person cards — with two deliberate exceptions: a confident
  **lifecycle**'s stages, and any **jointly-owned** question (a seam), which goes to
  BOTH owners because a document cannot settle a disagreement between two functions.
- **Only a genuine stakeholder answer ticks the heard count.** Assign, reassign,
  release, operator-capture: none of them do.
- **A zero-count section is hidden**, and **a miss stays visible** — never silently
  drop a locus.
- **The badge counts what is WAITING ON THE OPERATOR, not what is drawn.** Seams and
  in-flight questions are drawn as readings and are deliberately not summed; the
  decided trace is history. `operatorQueue.ts` is the only place either sum is written
  (`total` = the badge, `rendered` = the page), and `inboxBadgeIsThePage.test.ts`
  holds them to the DOM.

## The design system

One token set, declared at the top of `src/v3/components/flow/theLine.css`: four type
sizes, three radii, one control height (26px), a 4px spacing scale, one motion
duration with a reduced-motion override. Three font weights, one leading, tracking
only on uppercase micro-labels. `--ib-*` names remain as aliases.

**Guards enforce it** (`inboxPlainEnglish.test.ts`): a rule reaching for its own size,
radius, half-pixel or extra weight fails the suite. The surface reached seven button
variants and six radii by drift, one component at a time.

## The loops (what must never break)

- **Evidence loop**: kit script → conversation captured (typed, dictated, or transcribed
  recording) → fingerprint moves → documents flagged stale → regenerate (spine or per-card)
  → gate recomputes.
- **Async loop**: minted links (`?flowRespond=`) → flow-portal quarantines into
  `flowPortalInbox` → operator ingests in the Inbox → becomes evidence. Nothing enters the
  record unreviewed. Review links (ontology / workflow / blueprint) **re-project live from
  the current record** each time they open — flow-portal ships the live artifacts and the
  recipient's role, the client rebuilds the review scoped to that recipient's own area
  (`FlowRespond.tsx` / `flowReviews.ts`). So regeneration never invalidates a link: the
  recipient always reviews today's artifacts, never a frozen snapshot.
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

- `npm test` — **2719 tests / 176 files**. The load-bearing suites:
  - `flowLibs.test.ts` — gate verdicts pinned word-for-word, decision resolution, briefs, locateQuote
  - `coherence.test.ts` — cross-surface invariants (every decision family has a preview, checklist groups)
  - `edgeLockstep.test.ts` — client/edge parity by parsing both sources (fingerprints,
    vocabulary steering, conflict routing, studio docOrder vs agent JSON contracts)
- `.github/workflows/ci.yml` runs **`npm run validate`** and nothing else, on purpose —
  see the comment in that file for the two ways a hand-spelled gate drifted from it.
- Gate messages are PINNED. If you reword one, the test fails — that is the point;
  update both deliberately.
- **Timeouts are hang detectors, not performance assertions** (`testTimeout: 30s`).
  The a11y suites mount the whole FlowShell per case; at vitest's 5s default they
  passed alone and timed out in the full run. If you meet an intermittent red,
  fix its cause — intermittent red is what teaches a team to shrug at a real one.

**Two guards that will stop you, and should:**

- **The claims register** (`docs/aura/claims-register.md`). Every place the product
  asserts something about itself is listed with what is actually true; add UI copy
  that makes a claim and the suite fails until the claim is accounted for. It exists
  because this product once said *"generated, traceable to evidence"* while nothing
  computed grounding and a lineage walk achieved zero hops. When it flags you, account
  for the claim or stop making it — do not reword around the detector.
- **The badge-equals-page guard** (`inboxBadgeIsThePage.test.ts`). If it fails, a count
  and a page have stopped agreeing and one of them is lying to an operator.

**The habit that found most of the bugs in this codebase:** nearly every defect fixed
in the last pass looked fine in the source and wrong on the page — a button disabled
until armed, a busy flag nothing cleared, an empty state below a `return null`, a
count that named the wrong population, a select still holding a pick it had spent.
Tests were green throughout. **Open the page**, measure the thing you are about to
assert on the running board, and put the number in the commit.

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
5. **`any` in app code: 111 occurrences**, almost all in three pre-v3 files —
   `src/lib/adamDecisionUtils.ts` (56), `src/lib/adamCopilot.ts` (27),
   `src/new/lib/parseDocumentToText.ts` (18). None in the v3 ledger. Worth typing if
   those files are touched; not worth a sweep on their own.
6. **Seven files exceed 1,500 lines** — `FlowShell.tsx` (3.5k), `AppShellV3.tsx` (3.1k),
   `TheLine.tsx`, `FlowRespond.tsx`, `methodology.ts`, `PhaseInputsPanel.tsx`,
   `OperatorInbox.tsx`. Cohesive rather than tangled, but the first place a new
   engineer gets lost.
7. **`QuestionList` and `DetailPane` are defined inside `OperatorInbox`**, so React
   remounts that subtree on every render — which is why the detail pane's keyboard
   focus lives on the BOARD rather than the row. Hoisting them to module scope fixes
   the cause; it needs ~12 props threaded. Introduced knowingly, recorded here.
8. **~65MB of demo video is tracked in git** (`video/public/*.mp4`, nine plates).
   `video-laila/` is gitignored; `video/` never was. Every clone pays for it. Fixing
   it properly means history rewriting or Git LFS — a decision with blast radius for
   anyone who has already cloned, so it is flagged, not done.
9. **Per-attribute evidence covers attributes only.** Atlas STEP questions still say
   "no source on record"; the evidence work did not reach the atlas side.
10. **`run-agent/index.ts` does not type-check: 273 errors** (`deno check
    supabase/functions/run-agent/index.ts`). Measured 2026-08-13, the first time any
    edge code was checked at all. Shape: 126 × TS2339 (property missing on type) and
    107 × TS18047 (possibly null) — the signature of untyped traversal over the JSON
    blob. Most is noise; the TS18047s are where a real crash would hide. Not in
    `check:edge` until they are cleared, so the gate stays honest rather than
    aspirational. The two public-facing functions ARE clean and gated.
11. **The stakeholder write path is built but NOT DEPLOYED.** End to end:
    `FlowRespond` sends `locusAnswers` → `flow-portal` validates each against the
    pack's own `questionLoci` and quarantines them → the operator's ingest promotes
    them into `listen._stakeholderAnswers` → `useProgramLedger` mints an
    `asserted · closed` claim attributed to the person. Locus closes, `heard` ticks,
    the in-flight row clears. Guarded in `stakeholderWritePath.test.ts` (the ledger)
    and `writePathTransport.test.ts` (the pipe + the security boundary).
    **Deployed and proven live on Laila New (2026-08-13):** a submission through a
    real link quarantined (badge 5→6), the operator ingested it, the transcript
    landed attributed, and Discover's owned count for that person went **28 → 27** —
    the burn-down moving on a stakeholder's answer for the first time.
12. **`supabase` is `null as any` when the env is unconfigured** — 50 call sites
    across 20 files, and an unguarded one throws `Cannot read properties of null`.
    A developer machine has a `.env.local` and can NEVER see it; a CI runner and a
    first clone always can. One was found and fixed (`TranscribeButton`) the first
    time CI ran the real gate. The rest are unaudited. If you add a call site,
    guard it — `isSupabaseConfigured` is the existing predicate.
13. **THE WRITE PATH HAS NO UNDO — found by using it.** An answer that lands wrong
    (a mis-sent link, the wrong person, a test submission) cannot be retracted
    through the product: `_stakeholderAnswers` is append-only, no surface removes an
    entry, and `decide-fate: reopen` clears an operator RULING, not a stakeholder
    closure. The only way back is a hand-edit of the blob. Every other operator verb
    here is reversible by design (`reopen`, `unassign`, `pin-resolve`); this one is
    not, and it is the one that can put words in a named person's mouth. **The next
    thing to build**, and the reason the live test below is still on the record.

## What is NOT wired (do not mistake these for bugs)

- **The stakeholder write path.** Stakeholders cannot answer through the system in the
  browser today. Anything an operator records on their behalf is marked
  operator-entered and never counts as heard; surfaces say "provisional" where it bites.
- **Session scheduling.** A seam can have a session proposed; no date is booked and
  nothing consumes the intent. The questions are NOT waiting on it — they go out on
  both owners' links.
- **Redirect.** The action and the referral row still render, but nothing creates one
  any more: reassigning does the same thing in one step.
- **`llmReplay`** is delivered and unwired.

## Operational notes

- **Pending, deliberately not applied**: `supabase/migrations/20260714_event_journal.sql`
  creates the append-only `adam_program_events` table; the client dual-write
  (`src/v3/lib/flowEvents.ts`) is wired but dormant until the migration is applied and
  the uncommitted-era `run-agent` change is deployed. Apply + deploy together.
- The **snapshot ring** (Control → Safety) restores any of the last 10 blob states, attested.
- The **board pack** (Pulse) prints to PDF and mints shareable sponsor briefs (90-day expiry).
- **Clone** ("New from this programme") carries industry/segment/client + ontology
  standard mappings only — evidence and documents stay with the source programme.
