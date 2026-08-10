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

---

# FINAL GATE II — the INBOX badge + the Sessions collapse (2026-08-10, later)

Scope: the two tasks that landed after the gate above — `fd1cec7` (INBOX badge
counts the whole Inbox page) and `e579ea8` (Sessions collapses to one line). Run
hostile: assume both broke something, and re-check the three invariants by
**reading the shipped source**, not by trusting the commit messages.

## Verdicts

| Task | Verdict | Evidence |
| --- | --- | --- |
| `fd1cec7` INBOX badge counts the whole Inbox page | **DONE, with one defect found and fixed here** | badge and page both read `flowInbox`; but the page's *emptiness check* was a second spelling of the badge predicate — fixed below |
| `e579ea8` Sessions collapses to one line | **DONE, clean** | `ledger.sessionQueue` is the only array read (`OperatorInbox.tsx:86-88`); `seams` = its length, `questions` = Σ of the per-pair `abouts` the expanded rows print. No second copy of either number. |

Nothing was reverted. The frozen core is untouched by both commits
(`git diff --stat 83451d5..HEAD -- store.ts types.ts precedence.ts projections.ts`
is empty), `renderQuestion.ts` is untouched, and both commits changed 8 files total.

## Numbers at this gate

Before this gate's own edits (the branch as the two agents left it):

- `npx tsc --noEmit` → **exit 0, 0 errors**
- `npm run lint` (eslint src, `--max-warnings 0`) → **exit 0, 0 problems**
- `npx vitest run` → **101 files, 1434 tests, all passed**
- `bash scripts/validate-pipeline.sh` → **exit 0, 18 checks, 18 PASS / 0 FAIL**

After this gate's edits:

- `npx tsc --noEmit` → **exit 0**
- `npm run lint` → **exit 0**
- `npx vitest run` → **102 files, 1446 tests, all passed** (+12: the new gate test)
- `bash scripts/validate-pipeline.sh` → **exit 0, 19 checks, 19 PASS / 0 FAIL** (+`F5`)

## What this gate CHANGED

**(c) — FIXED. The badge and the Inbox's empty state were two expressions.**
The badge read `inboxWaitingCount(program, ledger)`. FlowToday asked the same
question a different way: `items.total === 0` and then, nested inside it, a second
read of the ledger half. Arithmetically identical *today*; structurally a copy. A
third term added to the badge would have been invisible to the quiet block, which
would then print "Nothing needs you right now" over a populated page — precisely
the bug `fd1cec7` had just fixed, one layer down. Now `flowInbox.ts` exports
`inboxWaitingCountFrom(items, ledger)`, `inboxWaitingCount` delegates to it, and
FlowToday holds `waiting = inboxWaitingCountFrom(items, ledger)` and gates the
quiet block on it. `FlowShell.tsx` no longer imports the ledger-half counter at
all, so it *cannot* re-add the terms. Behaviour is unchanged (both terms are
non-negative, so `a === 0 && b === 0` ⟺ `a + b === 0`).

**(b) — FIXED (this supersedes F-2 above).** `src/v3/lib/ledger/adapters.ts:19`
stamped one constant CRM sales-operations role on **every** claim from **both**
import adapters, so `fhirToClaims` attributed clinical attributes of a FHIR
`StructureDefinition` to a CRM sales function. It is `{ kind: "unowned" }` now —
every claim these adapters mint is born `closed` (or `weak`, for a non-required
binding) by an import, so nothing is ever "owned while open" and there is no owner
to know. `curation.ts:181` already used exactly this shape for the same reason.
The earlier gate declined this fix as "no live benefit"; the reason it is safe is
the same reason it was low-priority — `salesforceToClaims` / `fhirToClaims` have
**zero non-test callers**, so there is no live behaviour to change. Both adapter
tests still pass unmodified (they never asserted the owner).

**(a) — no change needed.** Question text still has one producer for the ledger
path. `TheLine`, `OperatorInbox`, `DesignLoopZones` and `kitProjection` all import
`renderQuestion`; none of them assigns a question string of its own;
`kitAgendaCache.ts` keeps the stored agenda strings honestly labelled as a cache.

**New sentry `F5`.** `scripts/validate-pipeline.sh` now runs
`src/v3/__tests__/finalGateInvariants.test.ts` (12 tests) which checks all three
invariants **against the shipped source read off disk**:
- badge ⟺ page: `inboxWaitingCountFrom(items, ledger) === inboxWaitingCount(...)`
  over 4 programme×ledger combinations; the empty state true in exactly one of
  them; and source sentries that FlowShell gates on `waiting` and contains no
  second read of the ledger half.
- owners: a FHIR import stamps no role on any claim; a Salesforce import likewise;
  no imported claim is `open`; and a **scan of 12 ledger modules for
  `role: "<literal>"`** with an allowlist of exactly one (see below). This is the
  answer to F-3: rather than broaden the `F4` grep to a second fixed string, the
  check now enumerates literals, so a *new* constant owner spelled any way fails.
- producers: the four question surfaces import the renderer and assign no question
  literal of their own.

## Outstanding — recorded, not fixed, with the blocker for each

1. **`dictionary.ts:24` keeps a constant owner: `System Owner`.** Allowlisted in
   the F5 scan. Blocker: unlike the adapters' case it is a deliberate, documented,
   domain-neutral provenance band ("this came from a system, not a person"), it is
   the only such literal, and its claims are all `weak` — so it cannot route work
   either. Changing it is a naming decision, not a defect fix.
2. **`migrate.ts:206,207,211` call `ownerFor("sales")` on the override-log path**
   (removed / edited entities). Inert: F5 pins that every one of those lines mints
   `status: "weak"`, and `buildUnknownQueue` admits only `open`/`blocked`. Blocker:
   the edge mirrors it (`supabase/functions/_shared/overrideAdapter.ts:13`,
   `OP_OWNER = "Sales Leaders" // matches migrate's ownerFor("sales")`), so this is
   a client+edge lockstep change and the edge cannot be deployed or verified from
   this sandbox.
3. **The Copilot sidebar counts a rival "actions awaiting review".**
   `AppShellV3.tsx:1541` sums 3 of the 7 record-half terms (decisions + portal +
   exceptions) and renders it as "N actions awaiting review"
   (`CoPilotSidebar.tsx:417`). Pre-existing; it is a different surface with a
   different label, but it is a second count of an overlapping population and it
   will disagree with the rail badge. Blocker: none technical — it is out of this
   gate's scope and needs a product decision about what the copilot chip means.
4. **The "Across the portfolio" chips still count other programmes with 2 terms**
   (`FlowShell.tsx:1133, 1827-1828, 2769, 3028`: decisions + portal). Carried over
   unchanged from `fd1cec7`'s own UNVERIFIED note. Blocker: other programmes'
   ledgers are not hydrated in the browser and a hook cannot loop over them.
5. **The Inbox header prints SEAMS under a "· questions" unit.**
   `operatorQueueCounts.sessions` is `sessionQueue.length` (seams), and the header
   stats row suffixes every stat with "questions". Pre-existing (present at
   `83451d5`), but `e579ea8` made it visible by printing "11 seams, 49 questions"
   on the section line right below it. Not fixed: the suffix is shared by five
   stats, so making it honest is a copy change across the row, not a one-liner.
6. **The badge counts 11 session rows while the collapsed section shows 1 line.**
   Judged CORRECT and left alone: the rows still exist behind a disclosure, and
   disclosure state is transient UI, not a change to what is on the page.
7. **F-1 above still stands** — `flowStakeholders.ts` holds ~40 hardcoded
   role-keyed agenda prompts, and `flowMeetings.ts:437-443` holds 5 more
   (`GAP_REPHRASE`). Both are artifact-gap / meeting-agenda text, not ledger-locus
   question text; invariant 3 holds for the ledger path, not absolutely.

## Standing blockers unchanged

No DB access, no edge deploy, no browser click-through at this gate — every number
above comes from the toolchain or from the committed Laila snapshot. The two
untracked files (`docs/aura/followup-workflow.js`, `docs/aura/next-session-brief.md`)
are left untracked, as every prior agent left them.
