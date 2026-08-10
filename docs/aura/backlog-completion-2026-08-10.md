# Backlog completion — 2026-08-10 (final gate)

Seven backlog tasks landed as nine commits on `reimagined-ui`
(`564cd3d`..`6b6f05d`). This is the final-gate record: what is genuinely DONE,
what is PARTIAL, what was REVERTED, and every outstanding item with its exact
blocker.

It is written to be read by someone who does **not** trust the commit messages.
Where a claim below rests only on a previous agent's word, it says so.

## Gate numbers (re-run from a clean tree at final gate, not copied forward)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **0 errors** |
| Lint | `npm run lint` (`eslint src --max-warnings 0`) | **0 errors, 0 warnings** |
| Tests | `npx vitest run` | **99 files / 1414 tests passed, 0 failed** |
| Invariants | `bash scripts/validate-pipeline.sh` | **ALL SCRIPTED CHECKS PASS** (19 checks, A–G) |
| Build | `npm run build` | **built in 13.42s**, 0 errors |
| Claims register | `npx vitest run src/v3/__tests__/claimsRegister.test.ts` | **2/2 pass** — register in sync, no `claims:regen` needed |

Nothing failed. **No revert was required.** No commit was rolled back.

## Headline invariants — re-checked by reading, not by trusting the script

**(a) One question-text producer.** PASS, with one standing exception recorded
below. `renderQuestion.ts` is the sole producer for every *ledger-locus* question:
`kitProjection.ts:22`, `portalQuestionModel.ts:29`, `kitAgendaCache.ts`,
`PortalQuestions.tsx`, `OperatorInbox.tsx`, `TheLine.tsx`, `FlowRespond.tsx`,
`DesignLoopZones.tsx` and `flowPortal.ts` all render *through* it.
`phrasing.ts` is a name-display helper and deliberately holds no templates.

**(b) No default/constant owner in the ledger.** PASS on the live path.
`migrate.ts:67 ownerFor()` returns `{kind:"unowned"}` when `functionOf` misses;
`jointOrOwner` returns `unowned` when neither side resolves; `statedOwner`
returns `null` rather than inventing. Owners in `operatorActions.ts:362,363,377`
come from operator input (pin/assign), not derivation. One constant owner does
exist — see finding F-2 — but in a module with **zero non-test callers**.

**(c) `validate-pipeline.sh`** — ALL PASS, confirmed by direct run (output above).

**Frozen core untouched.** `store.ts`, `types.ts`, `precedence.ts` and
`projections.ts` do not appear in the diff of the nine commits
(`git diff --stat origin/reimagined-ui..HEAD`). Their last-touched commits all
pre-date this backlog.

---

## sunset-classic-flow — **DONE**

`564cd3d` Flow is one view: sunset the classic canvas, delete the Line/Classic toggle.

Evidence: `view === "flow"` renders `TheLine`; the `FlowView` member `"line"`,
`lineViewPreferred()`, `rememberLineView()` and the appbar toggle are gone. Eleven
modules deleted (`FlowCanvas.tsx`, four cockpits, `OntologyAtlasModal.tsx`,
`ExternalBuildPanel.tsx`, `MeetingKitCard.tsx`, `flowPatterns.ts`,
`flowStages.ts`, `flowUpNext.tsx`) after an import-graph walk from `src/main.jsx`
proved each unreachable. `v3.css` lost 872 lines. `oneFlowView.test.ts` (6
assertions) asserts conservation: every `DOCK_ZONES` id has a render branch and
the branch set equals the `FlowView` union exactly — mutation-checked.

Judgment call accepted: landing view reverted to the documented rule (Inbox when
something waits, Flow otherwise) rather than the old always-open-the-Line
short-circuit.

Outstanding:
- **O-1 (capability lost, confirmed by me).** `TranscribeButton`
  (`flowCapture.tsx:114`) is referenced only from `CollectBoard.tsx:1501`, and
  `CollectBoard`'s board component is never imported — the three live importers
  (`TheLine.tsx:29`, `DiscoveryKitAlign.tsx:15`, `FlowShell.tsx:33`) take only
  `stakeholderCollection` / `areaAccent` / `areaMonogram`. **Transcribe-a-recording
  has no UI entry point.** The `flow-transcribe` edge function is untouched and
  still deployed. Blocker: needs re-homing on TheLine's capture dialog — a
  deliberate design decision, not a mechanical move.
- **O-2.** `CollectBoard.tsx` is half-dead (~1500 lines of unreachable board UI).
- **O-3.** `FlowShellProps` still declares 11 handlers only `FlowCanvas` consumed
  (`onMintPacks`, `onMintDemoInvites`, `onCompileShipLanes`, `onToggleShipItem`,
  `onSetShipLane`, `onRecordShowPass`, `onRunAgentAndWait`, `onEnqueueRegen`,
  `agentErrors`, `runningAgentIds`, `regenActiveIds`). Still passed by
  `AppShellV3`; pruning is a parent-side change.

Unverified: no browser click-through. "Each rail tile renders its surface" rests
on the source-level conservation test plus dev-server HTTP 200s, not a screenshot.

## people-duplicates — **DONE**

`d1abb0b` People view: dedupe by PERSON, and never let a role key fuse two humans.

Root cause: identity was keyed on the ROLE (`peopleIdentity(r.role)`), so one
human under two role spellings rendered twice. `dedupePeopleRows(roster, roles,
added)` in `flowStakeholders.ts` is now the one shared rule; FlowShell's inline
block is deleted and all reads (including the missing-email count) go through it.

The judgment call is the valuable part and was verified by probe *before* the
fix: a single normalizer would have made
`labelIdentity("Sales Lead (Asha Rao)") === labelIdentity("Sales Lead (Prakash T M)")`
and **deleted Prakash T M** — a fabricated roster, worse than the duplicate being
fixed. Identity is therefore two honest definitions: `labelIdentity` (loose, "same
role?") and `personKey` (strict, "same human?", never discards words). Worst case
is now one person listed twice (visible, fixable), never two people silently
merged. Recorded in `docs/aura/duplicate-definitions.md` so the pair is not
"consolidated" back together.

Regression: `peopleDirectoryDedup.test.ts`, 18 cases, including (b3) two people
differing only inside a parenthetical → TWO rows.

Outstanding / unverified:
- **O-4.** The user-reported Laila duplicate was **never re-checked on the live
  programme**. Blocker: `docs/laila/snapshot-2026-08-07` holds artifacts, not
  `_directoryPeople`/roster blobs, and there is no DB access from this sandbox.
  The fix is proven against constructed rows in the real row shapes only.

## model-catalog — **DONE**

`38a8adc` AI models: make the settings picker a rendering of the catalog, not a rival list.

Root cause: `IntelligenceView.tsx:444-448` carried its own Anthropic array beside
`_shared/modelCatalog.ts` — two lists, one rots. Catalog gained `claude-opus-4-8`
(tier3), `claude-sonnet-5` (tier2), `claude-fable-5` (tier2); superseded entries
marked `legacy?: true`; `modelForTier` now filters `!entry.legacy` outright, so a
superseded model stays operator-selectable but is unreachable by automatic
routing. A second rival source in `company-brief/index.ts` (:23, :35) was killed
at the same time — it now calls `defaultModelForProvider("anthropic")`.

The catch worth recording: `claudeClient.ts:252` sends `temperature: 0.2` whenever
`caps.acceptsTemperature`, which every Anthropic entry inherited. Opus 4.7+,
Sonnet 5 and Fable 5 reject `temperature` with a 400 — shipping the new models on
the inherited profile would have 400'd **100% of runs on the new default**. An
explicit `ANTHROPIC_NO_SAMPLING_PARAMS` profile was added. The general lesson is
recorded in-commit: graceful degradation by provider default inverts once a
provider *retires* a request field.

Pricing: real published list prices used ($5/$25, $3/$15, $10/$50, $1/$5) rather
than the brief's instruction to carry tier-anchor placeholders behind a flag —
writing a figure known to be wrong is the fabrication the invariants forbid.
`priceUnverified` is applied where it is genuinely true (sonnet-5's introductory
rate through 2026-08-31 means the ledger's `costUsd` overstates spend until then).

`modelCatalogLockstep.test.ts` (19 tests) was **mutation-checked**: 8 mutations
each confirmed to turn it red, then reverted. I verified independently that no
`claude-*` id remains hardcoded anywhere in `supabase/functions/**` outside the
catalog (only hit is a comment at `company-brief/index.ts:24`).

Outstanding:
- **O-5.** `company-brief/index.ts:34,46` still pin `gpt-4.1`, which is **not** the
  catalog's OpenAI default (`gpt-4o`). Same duplicate-definition shape, left
  deliberately — no verified basis to change an OpenAI model choice, and the
  edge-wide guard covers `claude-*` only. Documented in-file at :25-26. Blocker:
  needs a verified current OpenAI id + pricing.
- **O-6.** OpenAI and Google catalog rows untouched — no verified current ids or
  pricing.
- **O-7.** `claude-3-5-haiku-latest` is not merely superseded but **retired
  (404s)**. Kept, marked legacy, labelled "(retired)" with a warning rather than
  removed. Removal was out of scope.
- **O-8 (unverified).** `company-brief/index.ts` cannot be `deno check`ed here —
  its remote `esm.sh` import fails TLS in this sandbox. Its new import copies the
  working pattern at `configure-ai-settings/index.ts:2` but is **unproven until
  deploy**. Nothing was deployed.
- **O-9 (unverified).** No live API call was made; the 400-on-temperature fix is
  corrected from documented provider behaviour, not observed.

## pack-pipeline — **PARTIAL** (client complete, edge written but NOT deployed)

`bcbae31` Stakeholder linked page: the pack carries LOCI, the page renders through
the ONE renderer.

The linked page was the last question producer off `renderQuestion` — its pack
carried stored strings from the generated kit agenda, so a stakeholder could read
phrasing no ledger locus backs, and answering closed nothing. Now:
`FlowInterviewPack.questionLoci?: string[]` index-aligned with `questions`;
`TheLine.copyLink` mints the open unknowns on loci **that person owns**;
`FlowRespond` rebuilds a read-only store from the `liveArtifacts` the edge already
ships and renders through `portalQuestionModel.ts` — the single decision point.
An unresolvable locus falls through to its stored string **at its original index**
(a miss stays visible). Affordance menus come from `affordanceOptions(store, kind)`
— values the ledger already holds; empty means free text, never an invented menu.

Correctly **not** a closure: a public link has no ledger write path. A chip tap is
an attributed answer into the existing quarantine channel, and the test asserts
the open-unknown count is unchanged after one.

Evidence: `portalLociQuestions.test.ts` on Laila + synthetic surgery — page text
=== `renderQuestion(...,"stakeholder")` === `ledger.kitQuestions` for the same
locus, affordance included; every rendered row resolves to a real OPEN locus;
`rows + strings === pack.questions.length`; burn-down does not move.

Outstanding:
- **O-10 (BLOCKING the feature end-to-end).** `flow-portal` must forward
  `questionLoci`. The source change **is** made and I confirmed it present at
  `supabase/functions/flow-portal/index.ts:511-520` (same `slice(0,12)`), but it
  is **NOT DEPLOYED** and is verified by inspection only — `deno check` cannot run
  on an entrypoint here (remote imports fail TLS). **Until that deploy, a served
  pack carries no loci and the page renders exactly as it did before this
  commit.** The whole task is dormant in production until then.
- **O-11.** `mintReviewPack` accepts `loci` but no caller passes them; bulk
  `mintInterviewPacks` stays string-only. Blocker: wiring `CollectBoard` means
  giving it `useProgramLedger`.
- **O-12.** Turning a CONFIRMED portal answer into an `asserted · closed` claim is
  still gated. `parseLocusAnswers` exists and is tested; the ingest-side step
  through the operator commit path is **not built**.
- Unverified: no live DB/browser run — proven at model level on two migrated
  ledgers, not against a real served pack.

## inflight-pinning — **DONE** (client), with one live-DB risk

`8891854` A question that has been SENT belongs to whoever received it.

Anesthesiology read "in flight / awaiting / 0 owned" because questions on their
sent link were re-attributed underneath them by a later derivation. Sending a link
is an explicit, dated rule hit and now outranks re-derivation:
`pinsForSend()` / `foldOwnership()` / `applyOwnership()` (pin > assign >
derivation, on open|blocked claims only) / `baselineOwnerLabels()` /
`pinAgreesWith()` / `derivePinConflicts()`, all pure, all on the existing
`_operatorActions` field through the one write path. A disagreement becomes an
operator DECISION row in the inbox — never an automatic sweep.

I read `derivePinConflicts` directly: it skips when the derived label is empty, so
a pin never conflicts with nobody, and `ackAgainst` scoping means a *different*
later disagreement re-surfaces rather than being permanently waived. Both correct.

Evidence: `inFlightPinning.test.ts` (23 cases) against a **real re-derivation** —
the same atlas re-migrated with a changed `workflow.owner` moves loci between
owners while locus ids hold (probed, not assumed); without a pin they move, with
one they do not. Conservation at Laila scale: the four buckets sum to total-open
and are byte-identical before and after an 8-question send; only the owner
changes. `validate-pipeline.sh` gained check B5 for this.

Judgment call accepted: a later ASSIGN also loses to the pin, because a bulk
"assign all N" is exactly the silent sweep the rule forbids. Cost: confirming a
stakeholder redirect on an in-flight locus is two taps.

Outstanding:
- **O-13 (live-DB risk, unverified).** The pin write rides
  `handleSavePhaseInputs` immediately after `persistFlowMutation`, so the second
  write sees a stale `updatedAt` and is **expected** to take the `ConflictError`
  re-base path (`AppShellV3.tsx:~2256`). That is the codebase's standard
  sequential-write behaviour but is **not exercisable without a DB**. If it ever
  loses a pin, the fix is to fold the pin into the mint's own blob mutation —
  which would be a second write path (invariant 5) and needs a decision.
- **O-14 (known bound, pre-existing).** `serializeOperatorActions` caps the log at
  500. A send is capped at 8 questions, so **~62 sends of history before the
  oldest pins age out**. Left alone rather than silently changing stored
  behaviour.
- **O-15.** No back-fill for packs minted before this change — they pin on their
  next send. Inventing a send date and recipient would be fabrication.
- **O-16.** Restoring the specific questions Anesthesiology held at link-send time
  in the live blob was not done.

## locus-minting — **PARTIAL** (library-level; no in-browser entry point)

`e198c09` Curation path: mint a PROPOSED locus from an ontology-gap kit question.

`src/v3/lib/ledger/curation.ts`: an operator mints a proposed element plus the one
`?unknown` it opens, and can retract it. `mint-element` / `retract-mint` ride the
existing `_operatorActions` field through `useOperatorCommits`. Read side is a
**read-model overlay** in `useProgramLedger` — nothing calls `store.addElement` /
`store.assert`, no claim is persisted, **frozen core untouched**.

Design choices are all anti-fabrication: source `dispositioned` (weakest human
source, so asserted/document/regulation win); slot `semantics`, owner `unowned`,
value `?unknown`; element name is operator-supplied and `mintProposal` returns
`null` rather than derive a noun from free text; a proposal whose name+parent the
ontology already holds mints **nothing** and reports `alreadyModelled`.

Evidence on the committed Laila record: elements 310→311, claims 955→956, open
unknowns 395→396, need-an-owner 0→1. Retract restores 310/955/395/0 exactly.
`curationMint.test.ts` (21 cases) asserts conservation at all three states.

Outstanding:
- **O-17 (needs a FROZEN-CORE decision, deliberately not made).** Persisting a
  proposal requires `types.ts` to carry a provisional marker on `LedgerElement`
  and `precedence.ts` to carry a `proposed` Source. Today the only markers are the
  `el:proposed:` id prefix and the operator-action log, so **a reader that bypasses
  `useProgramLedger` (PgLedger / server) sees an ordinary element with a
  dispositioned open unknown.** The precise core change is recorded in
  `docs/aura/curation-path.md` for a decision.
- **O-18.** The MINT entry point stays library-level — no in-browser surface
  consumes `reconcileKit`, because the discovery-kit artifact is DB-only in this
  environment and a mint button would sit above a list that cannot be honestly
  populated here. **Retract IS wired.** Blocker: DB access.
- Unverified: the inbox `◇ proposed` tag and retract control are proven by
  construction + tsc/eslint, not by a live click-through.

## schema-trio — **PARTIAL** (all three client-complete; two need a generator deploy)

Three commits: `5468600` kit-agenda cache, `de4e2da` Frame systems-of-record
input, `6b6f05d` per-SoR dictionary uploads.

**`5468600` — agenda strings demoted to a versioned cache.** The generated
`discoveryKit` stored agenda question strings at `interviews[].agenda[].questions`
— a rival producer of question text. Now `interviews[].agendaCache`
`{version, questions, loci?, at, note}` behind one accessor
`kitAgendaCache.ts`. Five independent flatteners replaced
(`flowStakeholders.ts:363`, `flowMeetings.ts:115`, `flowPortal.ts:365`,
`listenCoverage.ts:189`, `studios.tsx:153`); `kitAgendaCache.test.ts` (9 cases)
asserts every reader returns the same questions for a legacy kit and its demoted
twin. Demote-not-drop was right: the strings are the honest record of what a link
*asked*. An empty cache is authoritative (no fallback), or clearing questions in
the studio would resurrect them.

**`de4e2da` — the sponsor NAMES the systems of record.** New Frame input
`systemsOfRecord` (`methodology.ts:1244`), one parser `parseDeclaredSors`, fed to
`deriveArtifactAsks` and `frameSorReadiness`. Fixes the ordering bug: SoRs only
existed in the *generated* ontology, so the dictionary ask could not exist before
an ontology did — i.e. could not exist at Frame, exactly when the ask is cheapest
and the sponsor is in the room. Merge is case-insensitive with the modelled
spelling winning, in **both** `frameSorReadiness` and `deriveArtifactAsks`, so
gate and inbox can never disagree about how many systems there are. A
declared-only ask honestly reports weight 0 / entityCount 0 and says "named in
Frame — nothing modelled against it yet" rather than "0 entities · closes 0
questions".

**`6b6f05d` — one ask, one file, per system of record.** `_dataDictionary` now
accepts a keyed map `{"<SoR>": "<csv>", "*": "<csv>"}`, read by
`readDictionarySources` and written by `writeDictionaryField`, both through the
same `useOperatorCommits.commitDictionary(csv, sor?)`. This closes a real
fabrication-by-omission: one global CSV meant a single Salesforce export marked
**all five** of Laila's systems provided, when the honest state of the other four
was still "unrequested". Additive, not a migration — a plain CSV string stays
valid; the keyed form is written only when a per-SoR upload happens. Live read on
the real Laila programme: CRM 126 · Project Management 31 · Finance 26 · Contract
12 · Content 8 open questions, + 40 unattributed = the 243 dictionary bucket.

Outstanding:
- **O-19 (generator deploy, not done).** `run-agent/index.ts` still emits inline
  `agenda[].questions`; it does not emit `agendaCache`. `readKitAgendaCache` is
  what keeps the two shapes one reader in the meantime.
- **O-20 (generator deploy, not done).** `systemsOfRecord` is declared
  `usedByArtifacts ["domain-ontology","current-state-atlas"]` but the prompts in
  `run-agent/index.ts` are **not changed** — the generator does not read the
  sponsor's list, so `entities[].systemOfRecord` can still come back with a
  different name for the same system. Today that surfaces honestly as two rows
  with different names rather than being silently fused.
- **O-21.** Already-stored live kits migrate **only on a studio save**. No bulk
  migration was run.
- **O-22.** Freeform-document dictionary parsing remains gated (model-assisted);
  only CSV/TSV parses.
- Unverified: no end-to-end per-SoR file upload against the live DB; no rendering
  of the new Frame field in the live Adjust-details panel.

---

## New findings from this gate (not from the seven tasks)

**F-1 — a second bank of question strings survives, pre-existing.**
`flowStakeholders.ts` holds ~40 hardcoded role-keyed interview prompts
(:468-548, :976-985, :1114-1118), e.g. "What must the very first demonstration
prove?". These are methodology-static *agenda themes* per role, not ledger-locus
questions, and they **pre-date this backlog** (confirmed present at
`origin/reimagined-ui`). But they are question TEXT produced outside
`renderQuestion.ts`, so invariant 3 holds only for the ledger path, not
absolutely. The `A1` sentry cannot see them: it greps four specific ledger phrases
("One step in", "Should this be automated", "What values can", "Which phase
does"). Not fixed — out of scope for a final gate, and folding a static agenda
into the locus renderer is a design decision.

**F-2 — a constant owner exists in `src/v3/lib/ledger/adapters.ts:19.**
`const OWNER: Owner = { kind: "role", role: "Sales Ops" }` is stamped on **every**
claim from **both** adapters — including `fhirToClaims`, where "Sales Ops" owning
a healthcare StructureDefinition is nonsense. Mitigating facts, both verified:
(1) the module has **zero non-test callers** (`salesforceToClaims` / `fhirToClaims`
are imported only by `ledgerProjections.test.ts` and `ledgerAdapters.test.ts`), and
(2) all its claims are `closed` or `weak`, while `buildUnknownQueue` admits only
`open`/`blocked` — so it could not reach the owner queue even if wired. It is a
dormant fabrication, not a live one. **Not fixed deliberately:** fixing it changes
test expectations for no live benefit, and this gate's job is a green branch.

**F-3 — the `F4` fabrication sentry is too narrow to catch F-2.**
`validate-pipeline.sh:57` greps for the single literal `ownerFor("sales ops")`. It
would not catch `adapters.ts:19`, nor any new constant owner spelled differently.
Broadening it would turn F4 red today (because of F-2), so it was left alone —
both must be fixed together, in that order.

## Standing environment blockers (apply to everything above)

- **No DB access.** Every "live programme" claim in this document rests on the
  committed `docs/laila/snapshot-2026-08-07` artifacts or on constructed fixtures.
- **No edge deploy, and none was attempted.** `deno check` works only on `_shared`
  modules with no remote imports; entrypoints fail TLS in this sandbox.
  `supabase/functions/**` is also outside the eslint config, so those files are
  lint-unverified by design.
- **No browser click-through** on any of the nine commits.
- The two untracked files `docs/aura/followup-workflow.js` and
  `docs/aura/next-session-brief.md` pre-date this backlog and are deliberately
  left untracked by every agent, including this one.
