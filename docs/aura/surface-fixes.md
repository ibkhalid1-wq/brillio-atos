# Aura — Surface fixes: count drift, auto-joint seams, atlas consolidation

Six fixes across the operator surfaces. Surface + read-model work over the existing
projections, against migrated Laila (`docs/laila/snapshot-2026-08-07`) and verified live
against the `Laila CRM` program in the preview. Frozen ledger core untouched; the one
additive change (an exported pure helper) and the gated pieces are called out as findings.

The headline is **count reconciliation** — one definition of each count, computed once,
read by every surface. It is done and verified. The companion root fix (question lists
derive from owned loci, not areas) is in [`question-scoping-fix.md`](question-scoping-fix.md).

---

## 1 · The count audit — every count, its source, before → after

### 1a · "unowned" — was **5 on the Discover goal, 6 on the Work-header strip**

| surface | reads | before | after |
|---|---|---|---|
| Work header (`UnownedSeamStrip`) | kit unowned band `.open` (ownership-counted) | **6** | 6 |
| Discover goal headline | `queue.counts.unowned` (routing-counted) | **5** | 6 |
| Operator inbox "Assign" | `queue.unowned` list | **5** | 6 |

**Root cause:** `buildUnknownQueue` routed a locus that was *both* blocked *and* unowned
under `"blocked"` (blocked took precedence over unowned), so it dropped out of the unowned
count — while the kit band counts unowned by **ownership** and kept it. One blocked-unowned
locus (`el:step:…#touches.user`, an unresolved-ref) was the whole 6-vs-5 gap.

**The one definition (coverage / population):** *unowned = open-unknowns (status `open`
**or** `blocked`) that nobody owns.* A locus nobody owns is unowned whether or not it is
also blocked, and the operator's next move is the same either way — assign an owner.

**Fix:** in `projections.ts` `buildUnknownQueue`, ownership is decided **before** the
blocked routing (unowned wins), and `QueueItem` now carries `status`. The hook exposes the
single number `ledger.unownedOpen = queue.counts.unowned`; `UnownedSeamStrip` takes it as a
prop and the Discover goal reads it. **All three surfaces now read 6.** The blocked-unowned
locus is shown in the Assign list with a `BLOCKED` tag (verified on screen) — it's ownerless
and assignable, it just can't be *answered* until unblocked. `queue.counts.blocked` dropped
11→10 accordingly (it now means *owned*-but-blocked, which is the more honest reading). The
sum invariant `blocking+answerable+blocked+unowned = total` still holds (166+224+10+6 = 406);
11 `ledgerProjections` tests green.

### 1b · "open on their turf" — was **305 / 300 / 331 against a global 355** (impossible sum)

**Root cause:** each person's turf number summed the item-count of every owner-band whose
label-words overlapped the person's area tokens (`onTurf += band.n`). Bands overlap across
people (nearly everyone is tagged "covering Sales"), so the same locus was counted under
many people and the per-person numbers overran any partition of the 355 open.

**The one definition (partition / load):** *turf = the open solo-answerable loci a person
OWNS* — by the ledger's own function mapping, one owning function per person, seams excluded.
This is the same fix as the question-scoping prompt; see that doc. Numbers after (live):

| person (function) | before (area-overlap) | after (owned) |
|---|---|---|
| Leader – Sales Operations (Sales Ops) | 274 | **248** |
| Sales – Markets (Sales) | 309 | **15** |
| Leader – Marketing (Marketing) | — | **15** |
| Leader – Delivery (Delivery) | — | **14** |
| Leader – Legal (Legal) | — | **6** |
| **Leader – Alliances (Alliances)** | **55** | **3** |
| Alliances | 23 | **3** |

The copy changed from *"N open on their turf — send a link"* (which implied one person must
answer all N) to *"N open on loci they own — send a link"* with a title spelling out it's
their owned solo load, not area coverage. Residual overlap is only **same-function** people
sharing their function's band (the ledger owns by role, not by person) — reported honestly,
no longer a cross-function impossible sum.

### 1c · Counts that already agreed (audited, no change)
`burnDown.open` (355), `heard.total` (0, attributed closures), `seamBands.length` (11),
`ownership.stakeholder` (0) — all single-sourced from the hook and consistent across the
Work header, the Design Loop, and the Discover goal.

---

## 2 · Auto-joint ownership at seam detection — **confirmed, already true**

`migrate.ts` `jointOrOwner(areaA, areaB)` returns `{ kind: "joint", a, b }` (endpoints
sorted) at the moment a relation or handoff crosses two functions — i.e. joint ownership is
**set at detection**, not on an operator click. So the old "mark for joint session" button
never *set* ownership; it only recorded a scheduling intent. Nothing to build here; the
surfaces now say it plainly ("already jointly owned (auto-set at detection)"). Verified live:
all 11 seams render as jointly owned with no operator action.

---

## 3 · The seam button → the gated date action

With ownership auto-set, the only pending thing on a seam is a **date**, which is gated
(no scheduling path). So:
- "mark for joint session" → **"propose a time"**.
- The no-op "marked" state is gone. A seam is **awaiting-a-date** (all of them, since dates
  are gated) or, once scheduling lands, **booked**. A `schedule` action now reads as "on the
  session plan · no date yet (gated)", framing the *date* as the open item — not a
  meaningless "marked" that confirmed a thing already true.
- Header count changed from "N need a session" to **"N awaiting a date"**.

Verified live: every seam shows "⏳ awaiting a date · propose a time".

---

## 4 · 0-adjudicate as a passed state

The 0-conflicts case was a generic empty line. It is now a **passed check** — quiet,
present, not alarm (green left-rule, ✓): *"0 conflicts — precedence resolved every contested
locus cleanly."* It keeps the `◇ provisional` tag and is honest that **0-now ≠ 0-forever**:
*"Conflicts surface once stakeholders assert competing answers; with 0 stakeholder assertions
so far, this also reads 'no one's answered yet.'"* (The "0 stakeholder assertions" is the real
`ledger.ownership.stakeholder` read, which is 0 in-browser by construction — the gated
write path.) Verified live.

---

## 5 · Collapse area tags (kept, not removed)

The Discover roster row's area tags are routing signal (which turf each person covers), so
they stay — but collapsed to the **primary 3 + "+N more"**, expandable, the same idiom the
seams strip uses. The active filter is always kept visible even if it sits past the cap.
Verified live ("Sales · Practices · Sales Ops · +5 more").

---

## 6 · Consolidate the atlas into one ledger-aware CRUD view — built (buildable-now slice)

`WorkflowStudio.tsx` is one surface — the swimlane diagram and the inline step inspector read
the same `doc.workflows` state and write through the same `onChange`, so view and edit cannot
diverge. This pass made it a **ledger surface** and hardened deletion:

**Built and verified live (on `Laila CRM`):**
- **Claim status per step.** The studio now reads the same claims ledger (`useProgramLedger`)
  and matches each doc step to its migrated element **by content** (workflow name + the
  step's action prefix — exactly the ledger's content-derived id). The inspector shows the
  step's slots: *"Ledger claims on this step — 4 weak · 2 open unknowns"*, and lists the
  `?unknown` slots (`actorRole`, `automationDisposition`) with their source. **The atlas is a
  ledger surface, not a detached form.** Screenshot in the session.
- **Content-derived identity ⇒ reorder preserves lineage.** Step id is
  `contentId("el:step", wid, actor, action)` (`migrate.ts:138`), so a **reorder** (which only
  changes position) never restrands a step's claims, and editing a *non-identity* slot
  (system / entities / duration) preserves them too — the match is by content, not index.
- **Deletion is mark-dropped, not hard-delete.** "Remove step" is now **"⊘ Mark dropped"** —
  a soft `dropped` flag; the step stays in the document (and the ledger, findable as an
  orphan), rendered struck-through, and is **restorable**. A claim-carrying element is never
  hard-deleted.
- **CRUD through the atlas write path.** Create / edit / reorder / mark-drop all write the
  `currentStateAtlas` artifact doc via `onChange` — the same artifact write path every atlas
  edit has always used (which the override log + server reconcile consume).

**Findings (a needed core change is a finding, not made):**
- **F-A (gated/core):** an atlas edit landing as an *attributed, audited* ledger **claim**
  through reconcile + the audit trigger is the persisted Option A / `PgLedger.reconcile` path
  (server-side) — which is exactly why `useProgramLedger` reads a **read-only `migrate()`**
  in-browser. Today an operator edit persists to the atlas doc and the read model re-derives;
  making it an attributed claim event needs the gated PgLedger path or an extension of
  `migrate()`'s override adapter to fine-grained step-slot claims. The inspector states this
  honestly: *"Answering a ?unknown lands as an attributed ledger closure through reconcile —
  the gated write path (operator edits here persist to the atlas doc today)."*
- **F-B (core):** editing the *identity* fields (actor / action) mints a new content-id — the
  one case content-derived identity can't cover. Preserving lineage across a label edit needs
  a **persisted stable step key honoured by the read path** (`migrate()`).
- **F-C (core):** a fully honest mark-drop would also write the *ledger* `exists=false` on the
  dropped step (like a removed entity); the soft doc flag keeps it findable now, the ledger
  `exists=false` is the reconcile piece.

---

## Findings (reported, not made)

- **F-A (core):** an operator atlas edit landing as an *attributed, audited* ledger claim
  needs the gated Option A `PgLedger.reconcile` + audit trigger, or an extension of
  `migrate()`'s override adapter to step-slot claims.
- **F-B (core):** preserving claim lineage across an actor/action *label* edit needs a
  persisted stable step key honoured by the read path (`migrate()`), since identity is
  content-derived from those fields.
- **F-C (additive, made):** `migrate.ts` now exports `functionOf` and `ownerRoleLabelForArea`
  — pure helpers, no behaviour change — so the surface routes a person to the loci they own
  using the **same** function mapping the ledger owns by (one source of truth, no drifting
  copy of the `FUNCTIONS` table).
- **Same-function sharing:** two people in one role both see that role's owned questions
  (the ledger owns by role, not person). Reported; not a cross-function overcount.

## Verification
`tsc` clean · eslint clean on all changed files · 11 `ledgerProjections` tests green ·
verified live on `Laila CRM`: unowned reconciles at **6** across goal/header/inbox; the
blocked-unowned locus shows with a `BLOCKED` tag; turf counts dropped to owned-solo loads
(Alliances 3, Sales-Ops 248); 11 seams auto-joint with "propose a time"; 0-adjudicate passed
state; area tags collapsed to "+N more". Screenshots in the session.
