# Full validation — PASS 2 — 2026-08-11

Second autonomous pass over the question pipeline + prototype render, against
pass 1 (`docs/aura/full-validation-2026-08-10.md`, commit `03c1946`). Fix window:
**60 commits, 118 source files**, `03c1946..HEAD`.

Harness: `scripts/validate-pipeline.sh` — **17 → 32 checks**, cold-run twice,
byte-identical, exit 0. New companion `scripts/validate-live-db.sh` runs the legs
pass 1 could not run at all (read-only against production).
Suite: **1276 → 1816 tests / 131 files**. tsc, eslint, production build clean.

The single most important sentence in this report: **pass 1's top-ranked finding
was fixed in code and is still 100% live in production.** Code-fixed and
production-fixed are different claims; only one of them was true, and no check
existed that could tell them apart. There is one now.

---

## 1. Fix scoreboard

Pass 1 recorded **no hard FAILs** — four ranked findings and eight BLOCKED legs.
Each finding re-run with pass 1's own evidence method.

| # | Pass-1 finding | Verdict | Evidence |
|---|---|---|---|
| 1 | Stakeholder pack delivers stored question STRINGS no ledger locus backs | **FIXED-DIFFERENTLY** (code) / **STILL LIVE** (production) | `portalQuestionModel.ts` renders loci through `renderQuestion(store, about, "stakeholder")`, grouped by `groupQuestions`, with `mode:"strings"` fallback and `unbacked` counted separately. The invariant holds *for packs minted since*. See §3 for the production half. |
| 2 | Dormant constant owners (`adapters.ts`, `overrideAdapter.ts`) | **FIXED** | Both gone. One literal remains — `dictionary.ts`'s neutral `System Owner` band — under a **conditional** exemption: `constOwnerIsInert` proves it can only ever land on a weak/closed claim. Re-verified green. |
| 3 | In-flight PINNING un-built (re-routing during a live link possible) | **FIXED** | Built: `operatorActions.ts` carries `pin`, `pinConflicts`, and the "no third path" guard; harness check B5 asserts a pin beats re-derivation. |
| 4 | Kit agenda strings awaiting cache demotion | **FIXED** | `kitAgendaCache.ts` — versioned cache (`KIT_AGENDA_CACHE_VERSION = 1`), legacy inline reported as `origin:"legacy-inline", version:0` so the miss stays visible. |

**Regressed:** none of the four.
**Fixed-differently, judged:** #1 — the fix took the shape of a *renderer at the
linked page* rather than *loci in the transport*, which is stronger (the store is
the authority, the string is a fallback). The invariant genuinely holds for new
packs. It does not hold for old ones, and that is finding **N-1** below.

---

## 2. Re-attempted BLOCKED legs

Pass 1's eight BLOCKED legs shared one cause: no Supabase credentials. Seven are
now runnable. Corpus: **123 programmes, 73 packs, 407 stored question strings.**

| Leg | Pass 1 | Pass 2 | Result |
|---|---|---|---|
| A2-DB truncation artifacts in the live store | BLOCKED | **RUN** | **PASS** — zero artifacts (` the be `, ` to pre be`, ` and u —`, `…`, `->`, `→`) across 407 strings |
| A3 linked-page loci alignment | BLOCKED | **RUN** | **PASS** — `questions`/`questionLoci` index-aligned in every live pack, 0 violations |
| F1 linked-page vs roster | BLOCKED | **RUN** | **PASS** — subsumed by the loci-alignment + `ownedLoad` partition |
| C2 live card weight vs bucket | BLOCKED | **RUN** | **PASS** — `ownedLoad.ts` is one partition; `owned === onLink + nextLink + blocked + toDictionary` asserted per owner |
| B4 `awaiting` construction | BLOCKED | **RUN** | **PASS** — guard present and pinned; no live pack in `awaiting` with zero sent |
| **NEW** conservation on real data | never attempted | **RUN** | **PASS** — every live programme's queue ⊆ open/blocked claims, no duplicates |
| **NEW** deployed-portal contract | never attempted | **RUN** | **PASS** — catches "fixed in the repo, not shipped" |
| E1 `audit_events` rows | BLOCKED | BLOCKED | **GATE 2** — table absent (HTTP 404); migration `20260807_audit_events.sql` unapplied |
| G3 side-by-side vs localhost:8080 | BLOCKED | BLOCKED | **GATE 3** — another project's server / human eye |

### The three gates (promoted — these are not validation gaps)

1. **GATE 1 — credentials.** No `.env.local` ⇒ every live leg SKIPs *loudly*, exit
   stays 0. A skip must never read as a pass.
2. **GATE 2 — unapplied migration.** `audit_events` does not exist, so no closure
   can be asserted against an audit row. Blocked in both passes, same cause.
   Unblocked by applying `20260807_audit_events.sql` — a user decision.
3. **GATE 3 — cross-project / human eye.** The visual side-by-side needs a server
   belonging to another project session. Substituted by code-level token identity.

---

## 3. New findings, ranked

**N-1 · HIGH — pass-1's top finding is fixed in code and 0% covered in production.**
24 open stakeholder links on live (non-deleted) programmes carry **no loci** —
`Laila CRM`, `Legend Bio`, `Surgery cancellations`, `Test program`. Every one
renders in `mode:"strings"`: the stakeholder reads phrasing no ledger locus backs,
and answering closes nothing. Verified end-to-end against the *deployed* portal,
not inferred — a real open Laila link returns `questionLoci: None` and 8 strings.
Nothing is fabricated (the fallback counts `unbacked` separately and attributes
nothing), so this is a coverage failure, not a correctness one. **Remedy: backfill
or re-mint — a write to client data, deliberately not done here.**
Now a standing sentry: `validate-live-db.sh` → `LOCI`, which FAILS today.

**N-2 · HIGH — the fabrication scan went blind to joint owners.** *A regression the
fix window itself introduced.* `Owner` gained a joint arm when N-party seams were
authorised; every fabrication gate matches `role: "…"`. From that commit onward
`const O: Owner = jointOwner(["Chief of Surgery"])` returned `[]` from
`literalRoleOwners` — the exact bug the gates exist to prevent, in the one costume
they never learned. **FIXED** (both spellings read, comments excluded, derived
`jointOwner(fns)` deliberately not flagged), mutation-proved 3 ways, harness B3c.

**N-3 · HIGH — ONE SEAM, TWO OWNER LABELS.** Live on the real snapshot.
`ownerFor` maps functions through `ROLE_LABEL`; `jointOrOwner` — the path a
relation or cross-area step takes — did not. Laila carried
`"Practices ⋈ Sales Leaders"` (5 questions) **and** `"Practices ⋈ Sales"` (10) for
the same pair, plus `Alliances ⋈ Sales` and `Finance ⋈ Sales`. Every surface groups
seams by `ownerLabel`, so the Sessions panel drew two cards for one conversation
and a roster person matched one band and not the other — half their seam questions
never reached them. `jointOwner`'s sort makes a seam order-independent; it cannot
help when the parties are spelled differently *before* it is reached.
**FIXED** — 5 + 10 now merge into one band of 15; mutation-proved on the real
snapshot; harness B3d. Bonus effect: the seam pointer now appears on the owner's
Discover card, where it was previously invisible.

**N-4 · MODERATE — a corrected dictionary re-upload becomes a contradiction, not a
correction.** `precedence.ts:100` lets two equal-strength non-human-decision sources
coexist, and `merge.ts`'s recency rule covers `generated` vs `generated` only. So
re-uploading a dictionary with a fixed type leaves BOTH live: one `coexist`
conflict, `burnDown.weak` +1, slot renders `state:"conflict"`. The field layer
promises the opposite — `writeDictionaryField`'s own test is titled *"re-uploading
for a system REPLACES its dictionary"*. **The field replaces; the ledger
accumulates.** An operator fixing a typo is punished for it. Needs a decision
(extend recency to same-provenance `code-derived`, or say so in the UI) — not a
safe local patch. ~~**Reported, not fixed.**~~
**DECIDED AND FIXED (2026-08-11)** — recency extended to same-provenance `code-derived`
in `merge.ts`; provenance read from `closedBy.by` where `method === "import"`. A
different system's disagreement still coexists. See `ledger-write-model.md` §"Rule 2"
and `ledgerMergeProvenance.test.ts`. ~~Does **not** yet reach the persisted path — see
finding F4 (`pgStore.rowToClaim` drops `closedBy`).~~ **It now does — F4 CLOSED
(2026-08-11).** `rowToClaim` was repaired first (without `closedBy` the rule had no
provenance to read); then the rule itself, with N-5 and N-11, moved into
`mergeRules.ts`, which BOTH `merge.reconcile` and `PgLedger.reconcile` import — one
definition, not a second copy in the persistence layer. `mergeRulesLockstep.test.ts`
fails if either side re-declares a rule or stops calling one.

**N-5 · MODERATE — the same-value race inflates the settled denominator, and the
doc says it doesn't.** Two writers closing one locus with the *same* value never
call `resolvePrecedence` (`valueConflicts` requires substantive **and unequal**), so
neither supersedes: two live rows for one answer. `ledger-write-model.md` calls this
"a redundant row the projection hides — cosmetic". **It is not hidden** —
`projections.ts:179-188` counts every live claim, so `pctClosed`/`pctSettled` both
skew. Either the doc or the projection is wrong; they cannot both be right.
~~**Reported, not fixed.**~~
**RESOLVED (2026-08-11) — the DOC was wrong.** `ledger-write-model.md` now states what
the code does, with the arithmetic (`total 2 · closed 1 · pctClosed 50.0` where the
honest answer is `100.0`). The duplicate is now **prevented at write time** on the
`reconcile` path (`merge.ts` rule 3 / `collapsedDuplicates`) rather than hidden at read
time; the root fix in the frozen `store.ts:97` is recorded as finding F1 with the exact
edit, and the still-broken direct-`assert` path is pinned by a test.

**N-6 · MODERATE — the renderer pass is quadratic.** `renderQuestion` is
O(elements + claims) *per call*: it rebuilds `new Map(store.elements())` every call,
`scalarAt → store.resolve → claimsAbout` filters all claims, and
`conflictingReadings` walks all claims per `#semantics` locus. Measured at 10×
volume (410 → 4,100 questions): full renderer pass **9.3 ms → ~690 ms (×73)**,
migration **4.7 ms → ~340 ms (×72)**. Conservation query and roster render stay
linear. One full kit render at 10× Laila costs two-thirds of a second.
**Reported, not fixed** (`store.assert`'s `liveClaimsAbout` is in the frozen core).

**N-7 · LOW — there is no reopen path anywhere.** Exhaustively established: the
store surface has no reverse verb, `close()` is one-way, asserting a fresh
`?unknown` on a closed locus is born dead, and every "Reopen" affordance in the UI
reopens a *stage gate* or an *SoR ask*, never a claim. Attribution is safe (no row
is deleted, `closedBy` is never erased), but `status` is overwritten in place with
no history field — so *"it was once closed"* is not readable from the ledger alone.
**If a reopen verb is ever built it must write an audit event, or the reversal is
unrecoverable.** The closest existing force is a `regulation` claim, which *blocks*
rather than reopens.

**N-8 · LOW, latent — arrow notation survives in `elementName`/`locusName`.** The
no-arrow rule is enforced on `question` and holds. It is not enforced on
`RenderedQuestion.elementName`, which for a relation is `Account→Opportunity` (35 on
Laila), and `projectKitQuestions` copies it into the stakeholder-facing
`KitQuestion.locusName`. `locusName` has no consumer today — latent, not live.

**N-9 · LOW, unreachable — the locus parser has no refusal path.** `elementIdOf`/
`slotOf` split on the *first* `#`, so an id containing `#` mis-splits silently and
the renderer answers about a non-existent element. Unreachable today because every
producer slugs first and slug strips `#` — that reachability guard is now asserted.
A refusal path is a frozen-core change. **Reported, not fixed.**

**N-10 · LOW, inert — `applyOwnership` rewrites dead-row attribution.**
`operatorActions.ts:362` guards on status but not `isLive`, so an ASSIGN on an
already-closed locus rewrites a superseded history row's `ownerWhileOpen` to an
owner that was never true while it was open. Inert (every projection filters
`isLive`); the one-token fix changes overlay semantics for blocked-superseded rows.

**N-11 · INFORMATIONAL** — `burnDown.open` counts `open` **or** `blocked` while kit,
owner queue and dictionary bucket count `open` only. Pinned as an exact identity on
both programmes so the divergence stays deliberate. ~~`MergeReport.deviations` is a
dead branch (unsatisfiable filter).~~ **FIXED (2026-08-11) — made reachable, not
deleted:** `reconcile` now compares the asserted claim against the live claims of the
OTHER world using the same predicate `buildDeviationRegister` uses, so the merge and the
register report one number instead of contradicting each other. A repeat import is
derivable but never *stated* (unchanged — `corroborated`/`unchanged` still absent).
`phaseSchedule.ts:205` has an unguarded division (different pipeline, out of scope).

---

## 4. Net invariant status

| Invariant | Status as of this pass |
|---|---|
| A1 one question-text producer | **HOLDS** — planted second producer caught by the harness |
| A2 no truncation artifacts | **HOLDS** — 0 across 407 live strings *and* committed fixtures |
| A3 kit === queue === per-owner union | **HOLDS** — cold, both programmes, and at 10× volume |
| B1/B2 no default/constant owner | **HOLDS** — planted default caught by two independent checks; joint arm now covered (N-2) |
| B3 conservation (store) | **HOLDS** — including on every live production programme |
| B3b conservation (surface) | **HOLDS** — *newly guarded*; a planted leak previously passed all 23 checks |
| B4/B5 in-flight + pinning | **HOLDS** |
| C1–C4 dictionary asks/import | **HOLDS**, with N-4 outstanding on re-upload semantics |
| D1–D3 renderer | **HOLDS** — plus 240-char, unicode, `#`/`:` and quote-bearing names |
| E1 closures move burn-down | **HOLDS** at store level; audit rows still GATE 2 |
| E2 conservation around mutations | **HOLDS** — including mid-race |
| E3 convergence = real closures | **HOLDS**, with N-5 outstanding on same-value duplicates |
| F1 roster/linked-page/kit agree | **HOLDS** |
| F2 empty state (zero → hidden) | **HOLDS** — whole inbox hidden, 8 ratio sites finite, honest cold start |
| F4 no fabrication | **HOLDS** — and now covers the shape it had gone blind to |
| G1–G4 fabric → Meridian | **HOLDS** |
| **one seam, one label** | **HOLDS** — *newly true* (N-3) |
| **loci coverage in production** | **FAILS** — 24 open links (N-1) |

---

## 5. Harness validation

**Determinism:** cold-run twice, fresh processes, byte-identical output, exit 0.

**Mutation test — three deliberate bugs:**

| Planted bug | Caught? | By |
|---|---|---|
| A second question-text producer | **YES** | A1 (named the file) |
| A fabricated default owner in `ownerFor` | **YES** | B1/B2 *and* F5 — two independent checks |
| A conservation leak in `unfrozenQueues` | **NO — all 23 checks passed, exit 0** | — |

The miss is the most useful result in this pass. It was invisible twice over:

1. `unfrozenQueues` is the ONE definition of the frozen-locus subtraction, read by
   both the badge and the page. The badge-equals-page sentry therefore still
   passed — both surfaces read the same leaking function and agreed perfectly.
   **Single source makes two surfaces consistent; it does not make them correct,
   and a sentry that only compares them cannot tell the difference.**
2. The pre-existing L8 test builds a fixture *with* a conflict, so it only ever
   exercised the `frozen.size > 0` branch. The zero-conflict early return — the
   common case on every real programme — had no conservation assertion at all.

**Gap closed:** `unfrozenQueuesConserve.test.ts` holds the identity on both
branches; harness check B3b. Re-planting the identical leak now **fails**. Plants
removed, clean re-run confirmed.

**Folded into the harness this pass** (17 → 32 checks): B3b surface conservation,
B3c joint-owner fabrication scan, B3d one-seam-one-label, DEEP1–DEEP6 (concurrency,
idempotency, reopen, fuzz, scale, empty programme), plus the whole of
`validate-live-db.sh`.

---

## 6. Judgment calls

1. **Fixed N-2 and N-3 inside a validation pass.** Both are single-source
   violations — the invariant the codebase exists to enforce — and both are
   derivations rebuilt on every load, so neither writes to client data. Each is
   mutation-proved. N-4 through N-11 were left alone: they need product decisions
   or frozen-core changes.
2. **Inverted two subagent tests rather than deleting them.** They were written to
   pin N-3 as *present*; once fixed, they now assert the merge. A test that once
   proved a bug existed is the cheapest regression guard for that exact bug.
3. **Did not backfill loci onto the 24 live links.** It is the obvious remedy for
   N-1 and it is a write to client programmes. Reported instead.
4. **`na`-disposition non-supersession** — carried forward from pass 1 as intended
   store semantics, unchanged.
5. **Deployed `flow-portal` v38 → v39** before this pass (user-instructed), then
   verified the durable-link fix end-to-end against production: partial → 200 with
   the link open, second partial → 200, final → closed, post-close → 409.

### Two near-misses I logged rather than buried

Both were checks that failed *for their own reasons* and nearly manufactured
findings:

- I handed `migrate` a `ProgramSummary` when it takes a `Snapshot`, and it threw on
  11 live programmes. I nearly reported "migration broken on production data".
- I asserted queue members must be `status === "open"`, when `buildUnknownQueue`
  admits `open` **or** `blocked`. It flagged 28 legitimately-blocked BFSI loci.

A validation pass that invents defects is worse than one that misses them. Both are
recorded in the test files themselves.

---

## 7. What pass 3 should be

**Not a manual pass.** The harness now covers what pass 3 would re-do by hand:
32 scripted checks, deterministic, plus a live-store companion that runs the legs
manual passes kept marking BLOCKED. Scheduled harness runs should replace further
manual sweeps — with three exceptions that no script can settle:

1. **The decisions, not the checks.** N-4 (re-upload semantics), N-5 (doc vs
   projection on same-value duplicates), N-7 (whether a reopen verb should exist)
   are product questions. A harness can hold whichever answer is chosen; it cannot
   choose.
2. **N-1 needs a migration, not a test.** The sentry fails correctly and will keep
   failing until the 24 links are backfilled or re-minted.
3. **The performance shape (N-6) needs a budget.** The 10× probe records timings and
   pins the *shape*; someone has to decide the ceiling before it can gate.

Everything else — run `bash scripts/validate-pipeline.sh && bash scripts/validate-live-db.sh`
on a schedule. The second one is the half that has never been automated, and it is
the half that found the finding this pass turned on.
