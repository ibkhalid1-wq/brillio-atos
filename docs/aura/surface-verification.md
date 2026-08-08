# Aura — Surface verification

Verifies the multi-session surface work (operator inbox, reassignment, joint-meeting/
seam-preview specs, stakeholder pages, Discover-as-dashboard, inline ageing, legibility
+ button-honesty) reads the ledger truthfully and leaks no honesty boundary. Read-mostly,
tested with real actions against migrated Laila. **A failing check is reported, not
papered over.**

**Headline verdict:** no honesty boundary leaks. The heard-count boundary holds
structurally against every operator action (tested, 13/13). Two suite failures exist —
one pre-existing (persistence layer), one surface-maintenance debt — **neither leaks a
boundary**. Details below.

---

## Part 1 — builds and reads real data

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | **clean** (exit 0) |
| `npm run lint` (`eslint --max-warnings 0`) | **clean after fix** — was 2 errors (unused `no-console` disables in `ledgerMigrate.test.ts:23`, `ledgerProjections.test.ts:29`, both from commit `46d0fcd`, pre-dating the surface work). Removed the stale directives (a broken-test-lint fix, the one class the task sanctions). |
| `npm run test` (`vitest run`) | **1212 passed / 2 failed** of 1214 (84 files, 2 failed) |

**The 2 test failures (both characterized, neither leaks a boundary):**

1. **`auditVocabulary` — "the client sets `aura.intent` nowhere"** → flags
   `src/v3/lib/ledger/pgStore.ts`. **PRE-EXISTING**: the test does a plain `src/` string
   scan for `aura.intent`; `pgStore.ts` (the `PgLedger` persistence class) has set it since
   the persistence session — **verified still failing at `77b08a8`, before any surface
   work.** No runtime leak: `aura.intent` lives only in `PgLedger`'s async pg methods
   (need a `PoolClient`); the client imports only the pure `buildReadModel`, so the browser
   never sets an audit intent. *Finding (hygiene, not mine): the surface work's overlay
   imports `buildReadModel` from `pgStore.ts`, co-locating it with `PgLedger`, so the
   audit-write code is now in the client bundle even though never executed — recommend
   extracting `buildReadModel` to a pg-free module. This did NOT cause the test failure
   (plain scan, pre-existing), but is the clean fix for the guard.*

2. **`claimsRegister` — "no self-claim in a surface the register does not account for"** →
   `DesignLoopZones.tsx` has **1 claim line not in the register**. **From the surface work**
   (`DesignLoopZones.tsx` is new — did not exist at `77b08a8`). Maintenance debt: the guard's
   own prescribed fix is `npm run claims:regen` (registers the claim in
   `docs/aura/claims-register.md`). Not run here (read-mostly). *Process finding: the surface
   commits were pushed with the full suite red — targeted `ledgerProjections` tests were run
   per commit, not `npm run test`.*

**Render check (hard reload, migrated Laila):** Work / Discover / Record all render (8 / 6 /
9 band-zone-inbox elements). After a clean reload the only console error is a pre-existing
`AURA agent runs load error` (a Supabase agent-run telemetry fetch, unrelated to the ledger
surfaces). The stale `[hmr] Failed to reload …` errors seen mid-session were transient
dev-server hot-reload artifacts — gone on a clean load.

**Every number → its source (all traceable or provisional-marked):**

| Surface · figure | Source (projection/query) |
|---|---|
| Work header · Heard `0` | `buildHeardRegister(store).total` — `◇ provisional` per-area |
| Work header · Convergence `56.5%` | `buildKitView(store).burnDown.pctClosed` — `◇ provisional` per-area |
| Work header · unowned `N` / seams `11` | `buildKitView` unowned/seam bands (open counts) |
| Discover goal · `355 open · 0 answered · N unowned · 11 seams` | `kit.burnDown.open` / `heard.total` / `queue.counts.unowned` / `seamBands.length` |
| Discover · "21 on the roster" | roster length (a count, **not** progress) |
| Inbox · "N need an owner · M need a session" | `queue.unowned` grouped by element / `seamBands − marked` |
| Inbox · assign group "N open" | `queue.unowned` per element |
| Design Loop · convergence / heard | `kit.burnDown` / `heard` (shared primitives) |
| Design Loop · deviation register | `buildDeviationRegister(store)` |
| Discover dashboard · ready "N on their turf" | `queue.byOwner` open counts, word-matched to the person (proxy — §4 finding) |
| Discover dashboard · in-flight ageing | `Date.now() − assignAction.at` — labelled **operator-tracked** |
| Record · "26 evidence entries" / "0 attributed closures" | evidence count / `heard.total` (distinct, labelled) |

No un-sourced number found.

## Part 2 — honesty boundaries (tested, not eyeballed)

### 1 · Heard-count ticks ONLY on a genuine stakeholder answer — **HELD** (13/13)

Drove every operator action through the real code path (`foldOwnership` → `applyOwnership` →
`buildReadModel` → `buildHeardRegister`) over migrated Laila. Baseline `heard = 26` (snapshot
has the operator overrides; the live program has 0 — both honest). **Every non-answer action
kept heard at baseline:**

| Action | heard | other ledger effect |
|---|---|---|
| assign | **26** | unowned 5→4 (item left unowned) |
| reassign | **26** | owner changed, open unchanged |
| unassign / release | **26** | back to unowned (5) |
| decide-fate out-of-scope | **26** | open 406→405 (status → `n/a`) |
| decide-fate escalate | **26** | blocked 11→12 (status → `blocked`) |
| schedule (mark session) | **26** | nothing (not in store) |
| redirect | **26** | nothing (not in store) |
| **operator-capture (answer)** | **26** | **`=== baseline` exactly — injects nothing** |

Structural guarantee: captures/schedules/redirects are never put into the store the heard
projection reads; assign changes only `ownerWhileOpen`; decide-fate changes status to
`n/a`/`blocked` (neither is `closed`/`weak`). A genuine stakeholder answer is the only thing
that would tick it — and that path is gated (0 asserted in-browser). **The "21 of 21 heard"
fiction cannot leak.** Live-surface cross-check: heard stayed `0` on the Work header, Discover
goal, and Record strip through an assign + a capture.

### 2 · No control overclaims — **HELD**

| Button | Says | Does | Match |
|---|---|---|---|
| seam schedule | **"mark for joint session"** → state "**marked · N grouped · no date yet**" | records intent (scheduling gated) | ✓ (was "book joint session"/"session booked" — corrected) |
| assign | "→ assign" → item shows new owner | writes owner | ✓ |
| reassign / unassign | "reassign" / "unassign" | changes/clears owner | ✓ |
| decide-fate | "out-of-scope" / "escalate" | status → n/a / blocked, trace in "Decided" | ✓ |
| capture | "record answer" → "answer captured via team" + provisional | operator-entered, not heard | ✓ |
| redirect | "record redirect" → "confirm → reassign to X" | referral, then assign on confirm | ✓ |
| Design Loop | "↻ rebuild from claims" | re-runs the generator | ✓ |
Live sweep: `book joint session` absent; `mark for joint session` + `no date yet` present.
No `booked/sent/done/confirmed` survives that overclaims.

### 3 · Loci render as plain-language questions — **HELD** (one cosmetic note)

Live: inbox rows render `.v3ib-qtext` ("What values can status take?", "Which phase does
staffing and resource allocation belong to?"); **no raw `attr:`/`step:`/`el:` string appears
as a primary label** (`rawIdAsLabel: false`); the id is on `title` (hover). *Cosmetic note:
the deviation-register detail rows (Design Loop joint zone, and the demo `LedgerLensPanel`)
render the locus `about` as a `<code>` reference — a secondary detail element, not a primary
label; acceptable, but the only place an id is visible.*

### 4 · One denominator per surface — **HELD**

Discover leads with one story: `355 open · 0 answered · N unowned · 11 seams` (the burn-down),
the inbox as the subset beneath, the roster demoted to "21 on the roster." The contradicting
"21 of 21 linked/responded" is **removed**. Record distinguishes "26 evidence entries" from
"0 attributed closures" explicitly (two layers, clearly labelled — not a contradiction).

### 5 · Unowned / seam / conflict visually distinct — **HELD**

Unowned = neutral bounded orphan with a denominator (border `rgb(16,24,40)`, no red wash);
seam = purple `⋈` to-do (`.v3ib-seam`, joint hue); conflict = amber frozen (`.v3ib-row.is-frozen`,
🔒). Three different treatments; none shares the others' styling. (Conflicts are honestly
empty — 0 contested loci in Laila — shown as "precedence resolved everything cleanly", not
hidden.)

### 6 · Provisional / gated states honest — **HELD**

Every gated action shows its operator-capture interim with `ProvisionalMark` (Respond,
Validation sign-off, Intent-asserted, Prototype refinement, conflict adjudication). In-flight
ageing states "**operator-tracked**" (never implies system tracking). No working-looking
button on a gated path.

## Part 3 — states driven, transitions real

| State | Built & behaves? | Evidence |
|---|---|---|
| **Assign** | ✅ built | unowned 5→4, owner recorded, heard 26 (harness); live: ready→in-flight |
| **Reassign** | ✅ built | owner changes, open unchanged, no closure (harness) |
| **Unassign / release** | ✅ built | returns to unowned (harness) |
| **Decide-fate** | ✅ built | out-of-scope→n/a (open−1), escalate→blocked (+1), trace shown |
| **Schedule / seam** | ✅ built | groups its questions; "marked · no date yet"; no "booked" |
| **Discover states** | ✅ built | ready / in-flight / blocked / done from claim state; dominant shown; live 21 ready → 1 in-flight on assign |
| **Inline ageing** | ✅ built | "awaiting · today · operator-tracked", grows, warm≥9d/hot≥21d, per-stakeholder oldest rollup |
| **Seam preview re-classify** (re-own/release/confirm) | ◇ **interim/spec only** | not built as a seam-preview surface; re-own≈reassign, release≈unassign exist, but no preview flow — gated (joint-meeting-model.md) |
| **Joint-meeting outcomes** (agree/disagree/defer) | ◇ **spec only** | mapped to closed/conflict/open in the spec; not built (write-path gated) |
| **Stakeholder-page staging / auto-transition** | ◇ **spec only** | gated; the operator-capture interim + Design Loop deviation register stand in |

Gated behaviors correctly show their honest interim; none is a dead button.

## Part 4 — definition collisions

- **"unowned" (F-1):** **consistent ACROSS surfaces** — Work header, Discover goal, and the
  inbox all read the same in-browser **open-unknowns** count from one store (`buildKitView`/
  `buildUnknownQueue`). The shared-primitive approach held: no surface shows a different
  number than another for "unowned." It still **diverges from the persisted ledger's unowned
  *loci* (~30)** — a different *population* (elements with unowned ownership vs open unowned
  questions). The surfaces state the open-unknowns definition; if the two must be one number,
  a new "unowned loci" projection is required — **reported, not made.**
- **heard:** one number everywhere (`buildHeardRegister`) — 0 live / 26 snapshot, consistent
  across Work header, Discover, Record. The old three-different-"heard"-numbers drift is gone.
- **converged:** the burn-down `%` is the one convergence read; the loop band's demo-verdict
  "N of M converged" chip (from `lineModel`) remains a *distinct* signal, flagged in the
  vocabulary list — not a second number for the same thing.

No term shows two different numbers across surfaces.

## Part 5 — frozen core untouched

- **No surface write bypasses reconcile or the audit path.** Every operator action writes
  ONLY the fingerprint-safe `_operatorActions` blob field via the existing `onSaveInputs`
  (the same vetted save path artifact edits use); the ownership/status overlay is **read-model
  only** (`buildReadModel` over migrated arrays). No surface writes a claim, element, or audit
  row. `store.ts`, precedence, `migrate.ts`, `projections.ts` data logic, and the `aura_audit`
  trigger are unmodified by the surface work (diff confined to components, css, `operatorActions.ts`,
  `phrasing.ts`, `useProgramLedger.ts`, docs).
- **Ledger unit tests green** (the ledger/migrate/projection suites pass; the 2 failures are
  the guard tests in Part 1, not core-logic tests).
- **Finding (hygiene, §Part 1.1):** `buildReadModel` imported from `pgStore.ts` pulls
  `PgLedger`'s `aura.intent` code into the client bundle (never executed client-side, pg-gated).
  Extract `buildReadModel` to a pg-free module to satisfy the `auditVocabulary` guard.

## Verdict

**Built-and-honest (reads the ledger truthfully, boundary held):** Design Loop three-zone
surface, Work honesty header, Discover goal + operator inbox + engagement dashboard, Record
attribution strip, the operator verbs (assign / reassign / unassign / decide-fate / schedule /
redirect / operator-capture), inline ageing, plain-language questions, button honesty, the
three distinct treatments, and the heard-count boundary.

**Interim-only / gated (correctly, no dead buttons):** stakeholder-link direct actions,
request-meeting, seam-preview re-classification, joint-meeting outcomes, per-locus
auto-transition, stakeholder-page staging — all specified, gated on the write path, shown via
the operator-capture interim.

**Defects, ranked by whether they leak an honesty boundary:**
1. **Boundary leaks: NONE.** The heard-count boundary holds structurally (tested); no
   non-answer action moves it.
2. **Real, non-leaking:** (a) `claimsRegister` red — `DesignLoopZones` claim unregistered
   (maintenance; fix `npm run claims:regen`); (b) `auditVocabulary` red — pre-existing,
   `pgStore` client-bundling (hygiene; extract `buildReadModel`); (c) surface commits landed
   with the full suite red (run `npm run test`, not targeted tests, before commit).
3. **Cosmetic:** deviation-register detail rows show the locus id as a `<code>` reference (a
   detail element, not a primary label).

## Update — the two findings resolved (suite now green)

Follow-up (authorized): **`npm run typecheck` + `npm run lint --max-warnings 0` + the full
`npm run test` are all green — 1214/1214 tests, 84/84 files.**

- **`auditVocabulary` (client `aura.intent`):** extracted `buildReadModel` to a new pg-free
  module `src/v3/lib/ledger/readModel.ts`, so the client (`useProgramLedger`) no longer imports
  `pgStore.ts` at all — real bundle hygiene, the audit-write layer (`PgLedger`) is server-only.
  The guard was then made **precise**: it excludes `pgStore.ts` (server-side, pg-gated, not
  client-reachable) with a comment; it still catches any *new* client `aura.intent`. (A first
  pass tripped the guard on `readModel.ts`'s own doc comment mentioning the string — reworded.)
- **`claimsRegister` (DesignLoopZones):** the flagged line matched the grounding vocabulary via
  the word **"re-grounded"** in a tooltip. The honest fix is *not* to register a grounding claim
  (Aura computes no lineage/grounding — the register itself says so) but to drop the incidental
  loaded word: "a decision is **re-derived from the claims**, not a blob refreshed." No new
  grounding claim; the guard passes clean.

Both fixes are transparent, don't weaken a guard, and don't touch the frozen core (readModel is
a pure move; the guard exclusion is scoped + commented). The surfaces render unchanged.

## Housekeeping

Laila's stored **ledger** (claims / elements / audit / ontology / atlas) is
byte-identical — no surface ever writes it. The Laila program's `_operatorActions` blob field
holds a few additive, reversible demo entries from this verification (assign / capture /
schedule); the app's Supabase is remote, so a safe clear is an app action (unassign/reassign
in the inbox), offered rather than forced via a raw remote write.
