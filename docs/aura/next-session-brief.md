# Next-session brief — Aura / brillio-atos

Every file:line below was verified against `d9113e1` on 2026-08-10 by opening the file,
not by copying a previous doc. Where an older doc disagrees, this one is right and the
disagreement is called out in **§2 Corrections** — read that section before trusting
anything in `backlog-completion-2026-08-10.md`.

---

## 1. THE PROMPT

> Continue the Aura work in `~/ATOS/brillio-atos`, branch `reimagined-ui`.
>
> **Orient first:**
> 1. `export PATH="$HOME/tools/node/bin:$HOME/.deno/bin:$PATH"` — node, deno (2.9.5) and
>    the supabase CLI are all OFF the default Bash PATH. Claiming a tool is absent
>    without checking is a mistake that has been made twice and cost real work.
> 2. Read this file, then `docs/aura/backlog-completion-2026-08-10.md` — but read §2
>    Corrections here FIRST; that doc carries four claims now known to be wrong.
> 3. `bash scripts/validate-pipeline.sh` (21 checks) and `npx vitest run`. That tells you
>    the true state without reading much code.
> 4. `git log --oneline -12` and `git status`.
>
> **Then work §4 in the order given.** The order is a dependency graph, not a priority
> list — three items turn the harness red if landed out of sequence, and each says so.
>
> **Non-negotiable invariants** (this codebase exists to enforce them):
> one definition per number, computed once, read by every surface; no fabricated
> owners/counts/prices/confidence — a miss stays visible; question text for a ledger
> locus comes ONLY from `src/v3/lib/ledger/renderQuestion.ts`; the frozen core
> (`src/v3/lib/ledger/{store,types,precedence,projections}.ts`) is not edited — a needed
> core change is a FINDING; conservation holds
> (`open === owner-queue + dictionary + role/joint-owned`).
>
> **Prefer delegating bounded work to Workflow subagents early.** Context exhaustion
> caused real errors in past sessions. When a subagent reports a fix, verify the claim
> by reading the file yourself — self-auditing agents have twice cleared defects that
> were live.
>
> Do not push without being asked. Do not deploy edge functions without being asked.

---

## 2. CORRECTIONS — earlier docs are wrong about these

**2.1 "No live path calls `store.contradict`, so the adjudicate double-count is
unreachable."** (`backlog-completion-2026-08-10.md:617`) — **The reasoning is unsound.**
`store.assert` auto-links contradictions internally: `store.ts:103` on `escalate`,
`store.ts:108` on same-world `coexist`. The double-count was reproduced this session with
**three ordinary asserts and zero `contradict()` calls** → `{"adjudicate":1,"total":2,
"distinctLoci":1}`. Reachability depends on **data**, not on the absence of a caller.
Commit `45cfa62`'s own message says this correctly; the later doc line contradicts it.

**The conclusion still holds, for a different reason.** The Laila snapshot was
re-measured this session: **955 claims, 951 distinct loci, 0 `contradicts` links, 0
conflict pairs.** Status histogram `{weak: 549, open: 395, blocked: 11}` — and those 11
are precedence `wins`/blocked, not escalations. So reachability today is zero *as a fact
about the data*, which a new programme can change at any time.

**2.2 "Fixing the double-count forks `assignQueue` from `unownedOpen`."** — Half wrong.
`useProgramLedger.ts:341` is `unownedOpen: assignQueue.length` — they are literally the
same number and cannot fork. The real constraint is different: conservation lives in
`inboxReconciliation.test.ts:23-24`, which computes its own
`openOwnerQuestions(buildUnknownQueue(migrate(snapshot)))` and does **not** read the hook.
**So the fix belongs at the SUM in `operatorQueue.ts`, never in `useProgramLedger.ts`.**
See W-1.

**2.3 "`el:proposed:*` from curation is L4's example."** — `el:proposed:*` is **dormant**:
`mintProposal` (`curation.ts:83`) has no production call site, so no live programme can
hold one. L4's actual live cause is **slug-based element ids** (`migrate.ts:110-111, 146,
158, 204`): a pack's `questionLoci` are frozen at mint (`flowPortal.ts:511-523`), then
regenerating the ontology/atlas renames an entity, the id changes, and the still-durable
link holds a locus the rebuilt portal store cannot resolve.

**2.4 Path and line drift.** `D3` is **not** in `supabase/functions/_shared/flowPortal.ts`
— no such file exists. It is the client file `src/v3/components/flow/flowPortal.ts`.
Other drift: L6's map is `TheLine.tsx:689-692` (not 683-686); L7's write is
`kitAgendaCache.ts:111` (not 110); `ROLE_TEMPLATES` is `flowStakeholders.ts:500-550` and
holds **33** prompts across 10 roles, not "~40 at :469-548" — **and none of them reach
TheLine**, which builds its cast from Listen at `TheLine.tsx:403-414`.

**2.5 The check count is 21.** Earlier docs say 17, then 18, then 19. Verified two ways
(reading every call site, and counting `^PASS ` lines): **21 emitted checks, all PASS.**

**2.6 "An unknown model inherits provider defaults and still runs (graceful degradation)
rather than being rejected by an allowlist."** (`modelCatalog.ts:69-70`) — **True as a
tolerance argument, false the moment a provider RETIRES a request field.** The premise
assumes an inherited default is a neutral guess. When a field is removed provider-side it
becomes affirmatively wrong, and the fallback stops being lenient and starts being the one
setting that breaks the model.

Concretely: `PROVIDER_DEFAULT_CAPABILITIES.anthropic` sets `acceptsTemperature: true`
(`modelCatalog.ts:72`), and `claudeClient.ts:252` attaches `temperature: 0.2` on exactly
that flag. Anthropic removed the sampling parameters in the 4.7-and-later generation —
`temperature` returns a **400** on Sonnet 5, Opus 4.8 and Fable 5. All three were added
this session inheriting that default, in the same change that made `claude-sonnet-5` the
configured default (`DEFAULT_BY_PROVIDER`), and `run-agent` imports `claudeClient`. Not
degradation: a guaranteed 400 on the primary path, on every call.

**Fixed in `38a8adc`** — the three entries carry an explicit `ANTHROPIC_NO_SAMPLING_PARAMS`
profile (`modelCatalog.ts:88, 106-108`); a data edit, still no branching on model name.
Two sentries in `modelCatalogLockstep.test.ts` hold it: the profile must be attached, and
`anthropicPayload` must keep gating on `caps.acceptsTemperature` (a decorative profile with
an unconditional assignment would re-break it). Mutation-tested by reintroducing the bug on
`claude-sonnet-5` alone — suite fails, restore passes.

**The premise at `:69-70` is unchanged and still load-bearing for every future entry.**
Prices in that table were checked against the published catalog and are correct; it was the
*capability* column that was fabricated. Check both when adding a model.

---

## 3. STATE AT HANDOFF (2026-08-10)

**HEAD `d9113e1` at the time this table was written; the session has since landed the
commits listed under §4. Re-measure rather than trusting the row below.** All measured
this session, not copied forward:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no output |
| `npm run lint` | exit 0, no findings |
| `npx vitest run` | **106 files, 1496 tests, 0 failures**, 14.90s |
| `bash scripts/validate-pipeline.sh` | **21 PASS / 0 FAIL** |
| `npm run build` | exit 0, ~12s |
| Parked tests (`.skip/.todo/.fails/.only/xit`) | **zero, repo-wide** |

Last 12 commits: `d9113e1 ed82514 cc87711 45cfa62 c37ff7e 0a023c9 e579ea8 fd1cec7
83451d5 6b6f05d de4e2da 5468600`.

**Deployment state is UNKNOWABLE from this repo.** There is no deploy manifest, no CI
deploy step (`.github/workflows/` has only `ci.yml`), and `config.toml` sets flags for
exactly one function. The last recorded deploy was **`run-agent` only**, carrying the SME
placeholder prompt and the 429 fix. **Every `flow-portal` and `run-agent` source change
since then is undeployed**, which is why three otherwise-finished features are inert.

---

## 4. WORK QUEUE — in dependency order

### W-1 · Adjudicate double-counts a locus — RESOLVED `4e1aa20`
**Fixed at the sum, in `unfrozenQueues`, read by BOTH the badge and the page** — filtering in
either one alone was the drift F7 exists to catch. A seam whose every question is frozen
stops being a seam. Both halves mutation-tested: reverting only the sum fails 3 tests,
reverting only the page fails the ORDERING TRAP test. Pinned as L8 in `operatorQueueTruth`.
The original entry follows, for the reasoning.

<details><summary>original entry</summary>

### W-1 · Adjudicate double-counts a locus — `operatorQueue.ts:90`
`const total = assign + sessionQuestions + adjudicate + pinned + inFlight + chase;` — the
terms are not disjoint. A locus carrying both a live contradiction and a live open/blocked
claim counts twice: the badge reads one higher than there is work, and the same question
draws in two Inbox sections.

**Fix at the sum, inside `operatorQueue.ts` only:** build
`const frozen = new Set(ledger.conflicts.map(c => c.about))`, then filter `assign` and use
a frozen-aware `sessionQuestionCount` (`operatorQueue.ts:49-50`). **Do not** filter
`assignQueue` in `useProgramLedger.ts:300` — that is the partition change §2.2 warns about.

> **ORDERING TRAP.** Fixing the count alone turns **F7 red**
> (`validate-pipeline.sh:83` → `inboxBadgeIsThePage.test.ts`), because the page still
> draws the frozen rows. `OperatorInbox.tsx:416-443` (assign section) and
> `OperatorInbox.tsx:91,115-121` (SessionsSection) must skip the same frozen abouts in
> the same edit.

Reachability today: **zero** (§2.1). This is latent, not absent — it went live the moment
the gate moved to `> 0`.

### W-2 · The Sessions term of `badge === page` is vacuous — RESOLVED `907fca6`
**The recorded fix was not enough and the entry said so.** Counting `li.v3ib-seam` rows is
the same quantity again, because each row prints its own `abouts.length`. Fixed with an
INDEPENDENT WITNESS: the joint-question total recomputed from the queue ITEMS, which never
touches an `abouts` array. Mutation-tested against a wrong SET (swapping the typing/joint
order in useProgramLedger's loop) — summary and rows still agree, so the old assertion stays
green and the new one fails. The original entry follows.

<details><summary>original entry</summary>

### W-2 · The Sessions term of `badge === page` is vacuous — `inboxBadgeIsThePage.test.ts:186`
Both sides are `sessionQuestionCount(sessionQueue)`, so the assertion is arithmetically
guaranteed; if that function counted the wrong set, badge and page would move together and
F7 would stay green while the operator saw a wrong number.

The recorded fix (count `#ib-sessions li.v3ib-seam` rows) is **necessary but not
sufficient** — those rows are seams, and each row's number is itself rendered from
`abouts.length` (`OperatorInbox.tsx:121`). Needs a source that does not route through
`abouts.length` at all. The test must also expand the disclosure first (the section
renders zero rows while collapsed, `OperatorInbox.tsx:117`).

**Land after W-1** — W-1 changes the expected number.

### W-3 · `flowLibs.test.ts` timeout headroom — RESOLVED (`flowLibs.test.ts:2505`)
**Now reproduced and fixed.** The earlier entry said "not reproduced this session (one full
run, passed) — thin headroom, not confirmed flake." One run was not enough to see it.

**Measured over 10 full-suite runs: 1 failure ("Test timed out in 5000ms"), 9 passes — and
0 failures in 8 standalone runs of the same file.** The failing test is
`artifact studio registry > covers every atos-flow required artifact with a resolvable
field key`. The failing run's `environment` time was **158.65 s** against **64–76 s** across
the nine that passed, so the trigger is contention, not a slow assertion — the test body is
pure map lookups over ~13 ids. Cause is as previously diagnosed: two dynamic imports pull a
16-import React studio barrel from *inside* the test body, charging the whole transform to
the test (~2380 ms cold against vitest's 5000 ms default).

**Fixed:** per-test `}, 20000);` at `flowLibs.test.ts:2505`, with the measurement recorded
in a comment above it. Global `testTimeout` deliberately untouched — raising it would mask
genuinely hung tests everywhere else. Verified by mutation: shrinking the argument to
`}, 1);` fails with "Test timed out in 1ms" and restoring it passes, which proves the
argument binds to this test rather than being inert.

> If this flakes again, the real fix is to hoist the two `await import(...)` calls to the
> module top so the transform is charged to collection instead of to the test. That is a
> bigger change to a 229-test file and was not worth it for a 10% flake.

### W-4 · The fabrication scan still launders owners — RESOLVED `f28ac23`
**Both predicates now parse instead of matching text.** `literalRoleOwners` resolves
bindings transitively (AST unioned with the old regex, since the AST cannot read the bare
fragments the tests use); `enclosingExport` walks the tree. Scan extended to
`supabase/functions/_shared`, verified by planting W-7's exact constant back.

> **The recorded interim for `enclosingExport` must NOT be taken.** Relaxing `^` to
> `^[ \t]*` makes every ordinary indented `const` inside an exported component close its
> own export, so live render sites resolve to null and the guard goes RED on correct code.
> Pinned as H8d.

> **The `codeOnly` wrap for invariant (b) turned out to be unnecessary.** Comments are
> trivia and never AST nodes, and the regex pass is fed `codeOnly` inside the predicate, so
> the call site is unchanged.

> **`_shared` needs `ownerShapeOnly`.** "role" is overloaded: `{ role: "user" }` and
> `{ role: "system" }` there are LLM chat-message roles, not owners. Scanning on the bare
> key reported four owners that do not exist. Keyed on the `kind: "role"` discriminant.

The original entry follows.

<details><summary>original entry</summary>

### W-4 · The fabrication scan still launders owners — `sourceGuards.ts:81`
The gap is **wider than recorded**. A constant role-owner escapes F5/F6 when it takes two
const hops, comes from another module, sits behind a member/index expression, is followed
by an `as` cast, or carries a trailing comment. So the exact `0a023c9` defect can recur
with the whole harness green.

Same root cause at `captureControlsReachable.test.ts:133`: `enclosingExport` is column-zero
**and** alternation-bound, so a render site moved into an indented host, or one declared
with `let`/`var`, is still attributed to the last exported declaration above it — the exact
`ed82514` defect the guard exists to catch.

**Fix:** swap both to the TypeScript compiler API (`ts.createSourceFile` — already a
dependency); resolve `role:` initializers through their bindings, and walk the parent chain
for the export check. **Cheap interim:** add `|let|var` and change `^` to `^[ \t]*`.

Also `finalGateInvariants.test.ts:223`: `codeOnly` is applied to invariant (c) but **not**
to the (b) owner scan — so a *comment* quoting `role: "Sales Ops"` (exactly how this
codebase documents its own fixes) turns F5 red for prose. One-line wrap.

### W-5 · The question-text cluster — L4/L7/L6 RESOLVED `25f1dbf`, **L5 OPEN (decision)**
L4, L7 and L6 are done, each pinned by a test proved to fail without it. The edge half of
L6 (`flow-portal` forwarding `scripted`) is invisible until that function is deployed —
same gate as O-10; source is complete.

**L5 REMAINS, and it is a decision, not a lookup. Recommendation: (a) migrate
`ambiguities[]` into the ledger — do NOT drop the branch.** Evidence:

1. **The data is already in migrate's hand.** `Snapshot.ontology` (`migrate.ts:95`) is the
   whole domain-ontology doc and `ambiguities` is a top-level key on it
   (`run-agent/index.ts:1363`). (a) needs no new plumbing — only that `migrate` opens
   `#semantics` on ENTITIES, where `:152` today opens it solely on `el:rel:*` with
   `relation === "produces"` (which hits `renderQuestion.ts:124`, never `:134`).
2. **The inline string is itself the violation.** `flowShellData.ts:1331` composes question
   text outside `renderQuestion.ts` — a second producer, which the one-renderer invariant
   forbids outright. Dropping the branch also deletes the only place a generator-detected
   terminology collision is ever raised, and `run-agent/index.ts:1351` asks the model to
   record those collisions precisely because the Blueprint's data contracts must resolve them.
3. **It is a gate with no human closure path.** `flowApprovals.ts:104` blocks movement
   approval while `movementOpenIssues(...).length > 0`, and an ambiguity only leaves that
   list when `entry.resolution` stops being "unresolved" (`flowShellData.ts:1324-1325`).
   Grepping `ambiguit` across `src/` returns only `flowShellData.ts` and a `docOrder`
   registry line — **no studio editor writes `resolution`**. So today the gate can only be
   released by the model rewriting the field on a regeneration. In the ledger it becomes
   closable the same three ways everything else is.

> **TWO COSTS TO PRICE IN FIRST.** `renderQuestion.ts:134` renders "What does ${name} mean,
> exactly?" and DROPS `conflictingMeanings` — the rival readings and who holds them, which
> the inline string carries today. Extend that one template to read the competing values
> from the ledger, or the migrated question is WEAKER than what it replaces. Do not keep
> the inline string alongside: that re-creates the second producer.
>
> And one new open claim per ambiguous term moves the burn-down denominator, so
> `inboxReconciliation.test.ts` and the E-series conservation checks need a DELIBERATE
> re-baseline. Note also that `migrate()` is `@deprecated` (`migrate.ts:98-102`) in favour
> of the Option A generator path, and per §6 the `ledgerGenerator.ts` mirror has no edge
> importer — so a change landed only in `migrate.ts` is invisible in production, the same
> trap the owner-derivation fix fell into.

<details><summary>original entry</summary>

### W-5 · The question-text cluster
Order matters: **L4 → L7 → L6 → L5.**

- **L4 — `portalQuestionModel.ts:96`.** Unresolvable loci fall back to a flat string list
  rendered beside grouped locus cards under one header count (`FlowRespond.tsx:703`,
  strings at `:744-746`). Answers typed into string rows are composed as bare `Q:/A:`
  blocks (`FlowRespond.tsx:429-438`) with no `[locus: …]` tag, **so ingest cannot
  attribute them and they close nothing.** Fix: stop folding `leftover.length` into
  `count` at `portalQuestionModel.ts:115`; carry it as a separate `unbacked` figure and
  give the string list its own heading. Cause is §2.3, not curation.
- **L7 — `kitAgendaCache.ts:111`.** `loci` is written conditionally (`:109`), `note`
  unconditionally (`:111`), so operator keystrokes from the kit studio
  (`studios.tsx:161-169`) land stamped "cache of rendered question text — the ledger's
  open unknowns are the source" with **no loci at all**. Fix: write the note only inside
  the `loci.length` branch. `readKitAgendaCache` never reads `note`, so nothing breaks.
- **L6 — `TheLine.tsx:689-692`.** A person with zero owned loci gets a link whose every
  question carries `about: ""`, forcing mode `strings` (`portalQuestionModel.ts:81`).
  Their page looks identical to a locus-backed one. Fix: pass a `scripted: true` flag
  through `mintFollowUpPack` and state it on the page. No ledger change needed.
- **L5 — `flowShellData.ts:1331`.** *"Two teams use "X" differently — which meaning should
  the record adopt?"* travels as a plain string all the way to the `about: ""` mint, so
  answering it closes nothing and the ambiguity stays open forever. Its counterpart at
  `renderQuestion.ts:134` **never fires today** — this is one live voice with a dormant
  twin, not two competing ones. Fix: either migrate `ambiguities[]` into the ledger as a
  real `#semantics` locus (**`migrate.ts` must open `#semantics` on entities first** —
  today `migrate.ts:152` opens it only on `el:rel:*` "produces" relations, which hits
  `renderQuestion.ts:124`, not `:134`), or drop the branch so the record stops asking a
  question nothing can close.

### W-6 · `D3` index desync — RESOLVED `dc437e9`
Fixed by an `alignedAsk` helper that zips question with locus, filters on the question, then
unzips — mirroring the edge, which already cuts both arms together. The additive contract
and the deliberate `questionLoci: undefined` safety at the kit-agenda refresh are both
preserved and tested.

> **RESIDUAL:** the edge has NO blank-question filter at all (`flow-portal/index.ts:509`
> maps and slices without `.filter(Boolean)`). The two sides now agree on ALIGNMENT but
> still differ on BLANK HANDLING. No user-visible failure today.

> **JUDGEMENT CALL:** a short loci array is padded with `""` rather than truncating the
> questions, so no question can inherit a neighbour's locus; a padded row degrades to its
> stored string. Truncating would silently drop asks.

The original entry follows.

<details><summary>original entry</summary>

### W-6 · `D3` index desync — `src/v3/components/flow/flowPortal.ts:125`
`questions` is `.filter(Boolean)`-ed, `questionLoci` is copied through unfiltered, so one
blank question makes every later locus point at the wrong question — violating the contract
stated at `:27-38` in the same file. **No user-visible failure today** (nothing pairs this
output with `portalQuestionModel`). Fix: filter both together as index-preserving pairs,
the way the edge already does (`flow-portal/index.ts:509+519`).

> Do this **before** wiring any client surface to that pairing. And do not break the
> deliberate safety at `flowPortal.ts:396`, where the kit-agenda refresh drops loci
> (`questionLoci: undefined`) so a re-mint can never leave stale loci pointing at new
> questions.

### W-7 · `D2` constant owner — RESOLVED `33bb6aa`
`overridesToBatch` and `buildOptionABatch` now take the owner as a REQUIRED parameter with
no default. Parity with `migrate`'s `ownerFor("sales")` holds BY CONSTRUCTION — the new
`scripts/ledger/overrideOwner.ts` derives it from the exported `ownerRoleLabelForArea`,
so the two paths are one mapping rather than two copies pinned by a comment.

> **THIS IS WHY W-4 MATTERED.** The constant survived because no guard had ever read
> `supabase/functions/_shared`. That blind spot is closed in `f28ac23`.

> **RESIDUAL:** the DB harnesses (`override-round`, `retire-migrate`, `optiona-multiround`)
> were type-checked but NOT executed — `DATABASE_URL` is unset and the local 5433 listener
> rejects an empty password. The in-process proof covers the owner-parity property their
> comment pinned, not their reconcile/precedence assertions.

The original entry follows.

<details><summary>original entry</summary>

### W-7 · `D2` constant owner — `overrideAdapter.ts:13`
`const OP_OWNER: Owner = { kind: "role", role: "Sales Leaders" }` stamped on every imported
override claim. Dormant (script-only, see §6). Fix: derive from the roster, or take it as a
parameter of `overridesToBatch` with no default. Note it is pinned by comment to
`migrate`'s `ownerFor("sales")` — changing one without the other breaks the parity the
`scripts/ledger/*.ts` comparison scripts assert.

### W-8 · The picker offers a retired model as selectable — RESOLVED `ef9766b`
Took option (b): `retired?: true` is now a field distinct from `legacy`, because the two
are different facts — a legacy model still WORKS and staying pinned to it is defensible; a
retired one 404s. Both retired ids STAY in the catalog so an already-pinned programme keeps
resolving its real price. Guarded in the lockstep test (must say "retired", must not carry
the "kept selectable" wording, never a default or auto-routing target), mutation-tested by
restoring the old label.

<details><summary>original entry</summary>

### W-8 · The picker offers a retired model as selectable — `IntelligenceView.tsx:463`
`claude-opus-4-1` passed its retirement date on **2026-08-05**; runs on it now 404. The
catalog marks it only `legacy: true` (`modelCatalog.ts:111`) and the picker tells the
operator *"Superseded by Opus 4.8. Kept selectable for programmes already pinned to it."*
— a promise the API will not keep. The neighbouring entry already models the honest
treatment: `claude-3-5-haiku-latest` is labelled *"(retired) — new runs on this id will
fail"* (`:464`). Same state, two different stories, one line apart.

**Not urgent:** `modelForTier` excludes `legacy`, so nothing auto-routes there — the
exposure is an operator manually selecting it and getting a 404 at run time.

Fix is a choice, not a lookup. Either (a) relabel `:463` to match `:464` — smallest edit,
but "retired" stays a labelling convention rather than an enforced field; or (b) add a
`retired?: true` flag distinct from `legacy`, so the catalog can state it once and both the
picker copy and any future guard read it. (b) is the shape the rest of this file uses.

> Do **not** delete the entry either way. It must stay in the catalog so an already-pinned
> programme still resolves its real price and renders honestly, instead of falling through
> to provider-default pricing — the same reason `legacy` entries are kept at all
> (`modelCatalog.ts:48-53`).

---

## 5. GATED ON AN EDGE DEPLOY — source is committed, effect is zero

**These are finished in the repo and invisible in production.** Do not re-implement them.

- **O-10 — `flow-portal/index.ts:519`** forwards `questionLoci`, index-aligned to the
  `slice(0,12)` at `:509`. Undeployed, so a stakeholder still gets the old payload with no
  `questionLoci`; `FlowRespond.tsx:219` short-circuits and they read frozen strings.
  **One deploy, no source change.**
- **O-19 — `run-agent/index.ts:1269`** still asks the model for inline free-text
  `agenda[].questions`. `grep -n "loci\|questionLoci\|renderQuestion"` over the whole
  11k-line file returns **zero hits**. Same defect in both synthesis fallbacks
  (`:11082`, `:11124`) — they must change together or the paths diverge in shape.
- **O-20 — `methodology.ts:1251`** declares `systemsOfRecord` feeds domain-ontology and
  current-state-atlas, but **neither prompt was changed**. Good news: the sponsor's names
  *do* reach the model anonymously via the grounding-facts loop
  (`run-agent/index.ts:2138-2144`), so **the fix is prompt-only** — no plumbing missing.
- **PACK — `flowPortal.ts:572`.** The loci pipeline is **half-wired**, which no earlier doc
  says: `mintFollowUpPack` **does** receive loci (`TheLine.tsx:693-698`), so follow-up
  links carry them today. `mintReviewPack` receives none — the prop type doesn't even
  declare the field (`FlowShell.tsx:121`, `CollectBoard.tsx:237,836`), and both call sites
  (`:461`, `:1072`) pass questions only. **So review links will never carry loci until
  this is threaded**, and threading it is only visible after O-10 deploys.

---

## 6. DORMANT — exists, runs nowhere

`_shared/ledgerGenerator.ts`, `_shared/optionA.ts`, `_shared/overrideAdapter.ts` have
**zero importers among the 16 function entrypoints** — re-verified; the apparent `optionA`
hit is the substring inside `isProgramLevelAdoptionAgent`. They are reached only by
hand-run `scripts/ledger/*.ts`.

**This matters for the surgery test (§7.1):** the owner-derivation fix is mirrored into
`ledgerGenerator.ts:86/172/187`, but **that mirror runs nowhere**, so regenerating surgery
through `run-agent` will not exercise it.

**Decide and record:** wire an edge entry point, or document as script-only tooling.
Leaving it ambiguous has already caused one wrong conclusion.

Also dormant: `dictionary.ts:24`'s `role: "System Owner"` — the one allowlisted constant.
Spent at exactly one site (`:107`, `status: "weak"`), and a weak claim never enters
`buildUnknownQueue`. **A user never sees the string.** Any future edit must keep all four
inertness conditions of `constOwnerIsInert` (`sourceGuards.ts:112-123`) true.

Also not built: the **LLM polish layer** on `renderQuestion` — the only trace is the
docblock promise at `renderQuestion.ts:20-22`. No module, no call site, no flag. Today
every surface gets the deterministic template, which is the safe state.

---

## 7. BLOCKED ON THE LIVE DB / A BROWSER

Nothing in the repo can settle these. Each names what would.

1. **Surgery: do the 61 "need an owner" questions drain?** The code half landed
   (`migrate.ts:163`, atlas-stated owner fallback). The only surgery data on disk is a
   2-entity synthetic fixture (`ownerRoutingRegression.test.ts:54`) — the real
   8-workflow blob exists nowhere. To close: regenerate the atlas on the live programme,
   read the stat, check conservation. **Remember §6** — the edge mirror won't run.
2. **Laila roster chips** (Head of Sales 9 / Head of GTM 15) vs the projection
   (`TheLine.tsx:439-483`). The roster/`_directoryPeople`/discoveryKit blobs are not in
   the repo. Watch `ownerRoleLabelForArea` — it maps both labels through the `FUNCTIONS`
   table (`migrate.ts:28-40`).
3. **The dictionary path end to end.** Every link exists (`OperatorInbox.tsx:400` →
   `parseDictionaryCsv` → preview → `commitDictionary` → `writeDictionaryField` →
   `readDictionarySources` → `frameSorReadiness`) but none has met a real export.
   **Blocker found this session:** `OperatorInbox.tsx:370` promises "CSV/XLSX dictionaries
   parse now", but only CSV/TSV parse and the file input accepts `.csv,.tsv,.txt`. **An
   operator exporting XLSX from Salesforce — the default — is told it works and then
   cannot select the file.** Fix that before attempting the test.
4. **`audit_events` for the three closure methods.** Blocked twice: even with a DB, the
   browser never publishes `aura.intent` — the only `set_config` calls are in
   `pgStore.ts:59,129,197`, and `PgLedger` has no importer outside tests/scripts. Step 1b
   (client publishes `action_type`) is code, and comes first.
5. **A real duplicated People pair.** The fix is live and shared (`flowStakeholders.ts:665`,
   sole caller `FlowShell.tsx:2236`). The danger is architecturally contained: identity is
   two functions — `labelIdentity` (`:601`, loose, for role slots) and `personKey`
   (`:622`, strict, "NEVER discards words", for humans). `peopleDirectoryDedup.test.ts:76`
   pins that two different people in one role stay two rows.
6. **The adjudicate caveat has no home** (`OperatorInbox.tsx:484`). `heard` is **0 by
   construction** on live Laila — the stakeholder write path is not wired in-browser
   (`useProgramLedger.ts:18-21`, enforced by `projections.ts:130-132`). So "0 conflicts"
   partly means "no one has answered yet", and the note saying so was removed with the
   zero-count panel. Give it a home on the always-visible burn-down readout rather than
   resurrecting a hidden panel. Original wording:
   `git show 87e22e4^:src/v3/components/flow/OperatorInbox.tsx`.
7. **Kits must be REGENERATED** for the SME placeholder. The rule exists only as generator
   prompt text (`run-agent/index.ts:1252,1258,1269`) plus a server synthesizer (`:11118`).
   Every client reader only *strips* the suffix — nothing rewrites the noun. **Do not add
   a client-side rewrite**: that would silently edit the stored record and create a second
   producer of stakeholder labels.

---

## 8. PRODUCT DECISIONS (not bugs — someone must choose)

- **Stakeholder-facing prototype is still model-authored.** Confirmed both halves:
  `flow-portal/index.ts:382,390` serves the stored `prototypeBuild.html`, while the
  deterministic ontology+atlas assembly is operator-only. Serving the assembly means
  porting `assemblePrototype` into an edge-importable shared module — it currently lives
  in the client bundle and Deno cannot import from `src/v3/lib`. Keeping the model path
  preserves the refine loop; retiring it kills it.
- **The `— TBC` suffix regex is hand-written in at least four places**
  (`flowStakeholders.ts:578` is the named export; `FlowShell.tsx:1137`; twice in the edge).
  One definition, four copies — the exact smell this codebase exists to prevent.

---

## 9. TOOLCHAIN (learned the hard way)

- node/npm: `$HOME/tools/node/bin`. deno 2.9.5: `$HOME/.deno/bin`. **Neither on PATH.**
- Supabase CLI: `npx --yes supabase@latest` (v2.113.0). Session cached, project
  `vudqrrqpipnkxzxslbim` (Brillio - ADAM) linked. Docker is not running → no
  `supabase start`.
- `deno check` works on shared modules with no remote imports; on function **entrypoints**
  it fails with `invalid peer certificate: UnknownIssuer` — sandbox TLS interception, not
  a deno fault. Entrypoints are verified only by the deploy bundler.
- The deploy upload manifest is the only truth about what a function actually bundles.
  **A grep is not** — one grep "proved" `run-agent` imports `ledgerGenerator.ts` by
  matching `isProgramLevelAdoptionAgent`.
- `npm run claims:regen -- --force` only for mechanics/comments, never for a new
  user-facing claim.
- `vitest.config.ts` sets `environment: "jsdom"` globally with no `testTimeout`; all 106
  files pay for jsdom (89.92s summed across workers). That contention is what feeds W-3.

## 10. KEY DOCS

`backlog-completion-2026-08-10.md` (**read §2 here first**) ·
`full-validation-2026-08-10.md` · `one-question-renderer.md` ·
`kit-question-projection.md` · `artifact-asks.md` · `owner-routing-fabrication-fix.md` ·
`need-an-owner-61.md` · `data-dictionary-import.md` · `action-type-vocabulary.md` ·
`prototype-design-system.md`
