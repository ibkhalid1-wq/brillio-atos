# Aura — Surface redesign to one ledger-honesty standard

Every Aura surface predated the claims ledger and showed the pre-ledger mental
model: blobs that "need refresh", counts asserting a completeness the ledger
doesn't have, and three surfaces showing three different numbers for the same
thing. This pass brings the operator surfaces onto one honesty standard, read
from the ledger, and **specs — honestly — what can only render truthfully once
the model key + binder + persistence gates open**. Nothing here fakes a number
the way the old surfaces did; where a figure can't be computed truthfully
in-browser it carries a `◇ provisional` mark, not a borrowed server number.

Read-only over existing read models. The frozen ledger core, store, precedence,
`projections.ts` data logic and the audit trigger were **not touched**; two
places that looked like they needed a projection change are reported in §7 as
findings, not made.

---

## 0 · The two datasets (why some numbers differ from the brief)

Every operator surface now reads the ledger through one path: an **in-browser,
read-only migration of the program's *committed* artifacts** (ontology + atlas +
operator overrides). That is the only ledger a browser can build — the persisted
server ledger (Option A / Postgres) is gated. So the honest question is always
"what does *this program's committed blob* yield", and it diverges from the
curated snapshot the brief quotes:

| Figure | **Live `Laila CRM`** (what the app reads now) | **Snapshot** `docs/laila/snapshot-2026-08-07` (the brief's "migrated Laila") | Persisted server ledger |
|---|---|---|---|
| live claims | 816 (461 closed/weak · 355 open) | 955 | ~1211 |
| **heard** (attributed closures) | **0** | **26** | 26 |
| burn-down | **56.5 %** | 57.5 % | — |
| unowned (open unknowns) | 6 | 5 | 30 loci* |
| seams (joint bands) | 11 incl. Finance ⋈ Legal | 10 incl. Finance ⋈ Legal | 11 |
| deviations | 0 | 4 | — |
| dispositioned (operator) | **0** | 26 | 26 |

Both columns are **real reads** (verified: snapshot via `migrate()` over the
projection tests; live via the running app). The live program's committed blob
carries **no `flowOperatorOverrides`** — so its ledger has zero operator
dispositions and therefore zero attributed closures. That is the honest read,
and the UI shows **0**, provisional, never the snapshot's 26. This is the whole
point: even "26 heard" is data-dependent, and the surface that used to show
"21 of 21 heard" for this exact program was pure roster theatre over a ledger
with *nothing* attributed.

\* "30 unowned" is a count of unowned element-ownership *loci* from the server
migration; the in-browser `buildKitView` reports unowned **open unknowns** (a
different denominator). See §7 finding F-1.

---

## 1 · The shared primitives — built once, used everywhere

The whole reason to do this as one pass is that the surfaces stop drifting. One
ledger read, one vocabulary, imported by every surface.

**`src/v3/lib/ledger/useProgramLedger.ts`** — the single in-browser read path.
Migrates the committed artifacts on the fly (read-only), memoized on the program,
and returns `{ store, stats, queue, kit, devs, heard, ontology, atlas, ownership,
unownedBands, seamBands }`. Lifted out of `LedgerLensPanel` (which did this inline)
so the kit, the Design Loop, the artifact views and the stats header read the
*identical* store and projections. Adds one surface-layer computation —
`ownership` by source class (operator = decision/dispositioned · stakeholder =
asserted · joint = both · draft = machine-proposed) — over the read model, without
touching `projections.ts`.

**`src/v3/components/flow/studio/ledgerPrimitives.tsx`** — extended with the
cross-surface vocabulary (existing `ClaimStatus`, `SourceTag`, `ContradictionBadge`,
`BandTag`, `DeviationMarker` retained):

| Primitive | What it renders | Rule it enforces |
|---|---|---|
| `HeardReadout` | the ONE heard figure = attributed closures | never a roster tally; per-area carries `provisional` |
| `ConvergenceReadout` | real claim closures (burn-down %) | not demo-verdict sign-off; per-area `provisional` |
| `OwnershipTag` | operator / stakeholder / joint / draft | source class, not an invented taxonomy |
| `UnownedSeamStrip` | unowned pinned first, seams as joint rows | a surface can't show tidy tabs + 0 unowned |
| `ProvisionalMark` | `◇ provisional` + the honest reason | the interim where a figure isn't computable yet |

Every signal carries a **glyph/shape + text**, never colour alone (● closed vs
◐ weak is a shape difference readable in greyscale); ownership tags carry an icon
+ word; provisional is `◇` + "provisional". Focus-visible outlines on every
control. CSS added to `v3.css` (`.v3lc-own`, `.v3lc-heard`, `.v3lc-conv`,
`.v3lc-uss`, `.v3lc-prov`) and `theLine.css` (`.v3dl-*`, `.v3ln-ledgerstrip`).

---

## 2 · Surface inventory

**Legend:** ✅ built (reads projections now) · ◐ partial (real strip added, deeper
overlay spec'd) · ◇ spec-only/gated (interim shown, full render awaits a gate).

| # | Surface | File | State | What it reads now |
|---|---|---|---|---|
| 1 | **Work — stats header** | `TheLine.tsx` | ✅ | heard 0, convergence 56.5 %, unowned 6 + 11 seams |
| 2 | **Work — Design Loop** | `DesignLoopZones.tsx` (new) | ✅ | 3 ownership zones, convergence header, deviation register |
| 3 | **Work — other bands** (Frame/Listen/Ship/Evolve) | `TheLine.tsx` `Station` | ◐ | "needs refresh" → "evidence moved" claim-state; deeper per-claim status spec'd |
| 4 | **Discover** (kit / people) | `TheLine.tsx` | ✅ | heard 0 + unowned/seam strip; roster relabelled "linked/responded" |
| 5 | **Record** | `TheLine.tsx` | ✅ | attributed closures vs operator touches strip |
| 6 | **Artifact view — ontology** | `OntologyStudio.tsx` | ◇ | Ledger Lens exists (Atlas); per-slot graph overlay spec'd (§5) |
| 7 | **Artifact view — atlas** | `WorkflowStudio.tsx` + `LedgerLensPanel` | ◐ | Ledger Lens (claim status, source, contradiction, deviation, bands) present |
| 8 | **Artifact view — prototype** | `PrototypeStudio.tsx` | ◇ | asserted-beats-generated shown in Loop zone 3; in-studio strip spec'd |
| 9 | **Cockpits** (Listen/Envision/Show/ProductOwner) | `*Cockpit.tsx` | ◇ | heard/converged still roster/verdict-based — spec'd (§5), vocab flagged (§6) |
| 10 | **Stakeholder link — Respond** | `FlowRespond.tsx` | ◇ | refusal/intent-capture already routes; "what came of your input" needs write path (§5) |
| 11 | **Stakeholder link — Approve** | `FlowApprove.tsx` | ◇ | per-artifact snapshot; sign-off → ledger assertion gated (§5) |
| 12 | **Stakeholder link — Brief** | `FlowBrief.tsx` | ◇ | "voices heard X/Y" is server-snapshot; a 4th heard number (§6) |

---

## 3 · The Design Loop — three ownership zones (the centerpiece)

**Before:** four artifact cards with "needs refresh ↻" buttons over a
"0 of 10 converged" corner counter — the pre-ledger "regenerate a stale blob"
model. **After (`DesignLoopZones.tsx`):** one model shown as three zones keyed to
the ledger's own source-class ownership, convergence promoted to the header.

- **Convergence header** — `ConvergenceReadout` (real closures, 56.5 %) +
  `HeardReadout` (0), replacing "N of M converged". Per-area convergence
  (demo-verdict sign-off) is marked `provisional`.
- **Zone 1 · Operator builds it** (`▧ operator`) — Architecture Strategy,
  Agentic Blueprint, Prototype. Each tile shows a **claim-state** in place of
  "needs refresh": *decided, on record* / *evidence moved underneath* (◐ weak) /
  *inputs ready — generate*. Rebuild is reframed "↻ rebuild from claims" (a
  decision re-grounded, not a blob refreshed). Each names the role a stakeholder
  **question routes to** (e.g. *questionable → routes to Architect*) — questioned,
  never edited.
- **Zone 2 · Stakeholders shape it** (`✍ stakeholder`) — Validation sign-off
  **promoted from the footer to the goal state**, showing `0 stakeholder sign-offs
  on record · provisional`; plus the **owned-question queue** (349 open unknowns
  owned by a role · 145 blocking · 204 answerable-without-a-meeting · 1 blocked).
- **Zone 3 · Joint** (`⋈ joint`) — Experience Design as a **split surface**:
  *Intent — asserted* │ **Deviation register** (0 for this program; 4 in snapshot)
  │ *Render — designed*. Below it, **Prototype refinement**: a stakeholder
  `✍ asserted` refinement wins over the operator `✧ generated` regeneration —
  "the ledger keeps the assertion, never the re-gen" (`0` refinements · provisional).

Verified in preview against live Laila (screenshots §8).

---

## 4 · Per surface — what changed, what it reads, what's provisional

**Work header (✅)** — was Round · "Converged N of M areas" · "Voices heard N of M"
· "Needs refresh N stations". Now: Round · **Heard** = `heard.total` attributed
closures (0, provisional per-area) · **Convergence** = burn-down (56.5 %,
provisional per-area) · **UNOWNED + seam strip** (6 open, 11 seams). Killed both
the completeness claims and the "needs refresh" tally.

**Discover (✅)** — the roster count "N of N heard" is relabelled **"N of N linked /
responded"** (it counts links-out/replies, a real but different thing). The
authoritative heard now sits in a ledger strip: `HeardReadout` (0 attributed,
provisional) + `UnownedSeamStrip`. Two things that were both called "heard" are
now named for what they are.

**Record (✅)** — "who said what, when" is qualified by a ledger strip:
`● 0 attributed closures · ▧ 0 operator touches (weak, no verbatim) · provisional`.
The evidence entries below stay real attribution (26 transcripts); the strip stops
the vocabulary from implying the *ledger* attributes per-area who-said-what when it
attributes 0 closures here.

**Other bands (◐)** — the global "needs refresh ↻" badge is reworded to name what
happened — **"evidence moved"** — with the regen action kept ("rebuild from
claims"). The legend now reads "the claims under it moved — rebuild to re-ground
it". A deeper per-artifact claim-status (mapping each generated document to the
ledger claims it rests on) is spec'd — those documents have no ledger element of
their own, so the honest per-item status is *presence + ownership + whether its
upstream claims are open*, which the Design Loop zones already do for the loop
artifacts; extending it to Frame/Ship/Evolve is mechanical follow-on.

---

## 5 · The gated list — what needs the model key / binder / write path

Each item shows the **honest interim** rendered meanwhile.

| Gated capability | Why it can't render truthfully now | Honest interim shown |
|---|---|---|
| **Per-area heard** | all attributed closures land in one owner band in-browser (26 → "Sales Leaders"; live → 0) | one figure + `provisional` "per-area heard needs the write path" |
| **Per-area convergence / sign-off** | demo-verdict sign-off is a stakeholder write, not a ledger closure | burn-down % + `provisional` on per-area |
| **Stakeholder-asserted anything** | `asserted` closures arrive through the store write path, not wired in-browser (0 asserted, 0 joint) | zones show `0 …· provisional`, never faked |
| **"What came of your input"** (Respond) | needs real per-stakeholder closures wired back | recap/what-changed diff kept; ledger read spec'd |
| **Sign-off → ledger assertion** (Approve) | approval verdict isn't yet an `asserted` claim | snapshot sign-off kept; ledger write spec'd |
| **Persisted figures (30 unowned / 11 seams / 1211 claims)** | server ledger (Option A / Postgres) not reachable from a browser | in-browser migrate figures, labelled read-only |
| **Per-slot claim overlay on the ontology graph / atlas swimlane** | needs a graph-node → ledger-element binding (the binder) | the Ledger Lens strip (claim status, source, contradiction, deviation, bands) |

None of these fakes a number; each shows what the read model actually holds and
marks the rest.

---

## 6 · Vocabulary-honesty list (for Ibrahim's naming call — not renamed here)

Labels that claim more than the data supports. Phase/movement names left alone.

| Label | Where | Claims | Reality |
|---|---|---|---|
| "N of N **heard**" (Work stats) | was `TheLine.tsx:737` | people heard | roster reach — **relabelled** "linked/responded"; ledger heard = attributed closures |
| "N of N **voices heard**" (Listen intake) | `lineModel.ts:316` | voices heard | roster reach — **relabelled** "on the roster reached" |
| "N of N **heard**" (ListenCockpit) | `ListenCockpit.tsx:66` | voices heard | 3rd heard number — flagged, cockpit not rebuilt this pass |
| "voices heard X/Y" (Brief) | `FlowBrief.tsx:84` | voices heard | 4th heard number — server-snapshot, flagged |
| "**needs refresh** ↻" | `TheLine.tsx` ×4 | blob is stale | claims moved — **reworded** "evidence moved" |
| "**Converged** N of M areas" | `TheLine.tsx` / `lineModel.ts:330` | claim convergence | demo-verdict sign-off — Design Loop now reads real closures; band chip flagged |
| "**Record** — who said what, when — by area" | `TheLine.tsx:727` | ledger attributes who/when per area | ledger attributes 0 closures here — **qualified** by the Record strip |
| "the board — **bands, stations, gates**" | `TheLine.tsx:719` | neutral scaffold | a band can be a covered area *or* an unowned seam — the header strip now surfaces unowned/seams |
| "signed off N/M" (ProductOwnerCockpit) | `ProductOwnerCockpit.tsx:58` | ledger sign-off | demo-verdict majority — flagged |

---

## 7 · Findings — things that suggested a projection/core change (reported, not made)

- **F-1 · No projection yields "unowned loci" (the 30).** `buildKitView` reports
  unowned **open unknowns** (5–6), not the count of elements whose ownership is
  `unowned` (the server's 30). The surface shows the real open-unknown figure; a
  faithful "30 unowned" would need a new projection over element ownership. Not
  added — reported.
- **F-2 · Per-area heard is not derivable in-browser.** Every attributed closure
  resolves into a single owner band (the migrate owner default), so a per-area
  split can't be computed without the stakeholder write path attributing closures
  per area. The heard-count is honest (attributed vs machine-import) but coarse;
  a per-area heard projection is a write-path follow-on, not a read-model fix.

Neither was changed. Both are honest limits of the current read models.

---

## 8 · Screenshots (verified in preview against live `Laila CRM`, port 5173)

Captured this session (in the transcript). Each is a real read of the live
program's committed artifacts:

1. **Work header** — `Round 1` · `Heard 0 attributed closures · provisional` ·
   `Convergence 56.5% · 461 closed/weak · 355 open · provisional` · red **UNOWNED
   6 open** strip + **11 SEAMS** incl. `⋈ Finance ⋈ Legal 2`.
2. **Design Loop** — 3 zones (Operator builds it · Stakeholders shape it · Joint),
   each tile showing `◐ weak evidence moved underneath` + `↻ rebuild from claims`
   + `questionable → routes to Architect`; Validation goal state `0 sign-offs ·
   provisional`; `349 open unknowns owned by a role`.
3. **Joint zone** — Intent-asserted │ Deviation register │ Render-designed, +
   Prototype refinement `✍ asserted` beats `✧ generated`.
4. **Discover** — `21 of 21 linked / responded` + ledger strip
   `ON THE LEDGER 0 attributed closures · provisional` + unowned/11-seams.
5. **Record** — `26 evidence entries` + `ATTRIBUTED ON THE LEDGER · 0 attributed
   closures · ▧ 0 operator touches (weak, no verbatim) · provisional`.

---

## 9 · Files

- **New:** `src/v3/lib/ledger/useProgramLedger.ts` (the one read path + ownership),
  `src/v3/components/flow/DesignLoopZones.tsx` (three ownership zones).
- **Extended:** `src/v3/components/flow/studio/ledgerPrimitives.tsx` (shared
  vocabulary), `src/v3/v3.css` + `src/v3/components/flow/theLine.css` (styles).
- **Wired:** `src/v3/components/flow/TheLine.tsx` (header, Design Loop, Discover,
  Record, "needs refresh"→"evidence moved"), `src/v3/lib/lineModel.ts` (Listen
  intake relabel + note).
- **Untouched (frozen):** `projections.ts` data logic, `store.ts`, precedence,
  `migrate.ts` core, the audit trigger.

**Verification:** `tsc --noEmit` clean · eslint clean · 11 `ledgerProjections`
tests pass · live preview against `Laila CRM`, no console errors.
