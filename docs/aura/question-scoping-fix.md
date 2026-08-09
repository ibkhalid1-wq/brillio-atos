# Aura — Scope questions by owned loci, route seams to sessions

The Alliances leader showed four questions that belong to Sales, identical to the Sales-Ops
leader's list — the turf-overcount bug made visible at the question level. Root cause: a
person's question list was derived from **area membership**, so everyone tagged "Sales"
inherited the generic Sales questions. This is the same single-definition fix the
count-reconciliation prompt applies to the numbers ([`surface-fixes.md`](surface-fixes.md)),
proven here at the content level. Surface + read-model work; verified live on `Laila CRM`.

## The derivation change — from area-membership to owned-solo loci

One definition, computed once in `useProgramLedger` and read by every surface:

- **`soloByOwner`** — open solo-answerable unknowns grouped by the ledger **owner-label**
  that owns them (role owners only; `status === "open"`; `blocking` + `answerable` routing).
- **`sessionQueue`** — seam (jointly-owned) questions grouped by function pair. A jointly
  owned locus is a **session** question, excluded from every individual list by construction
  (joint owners are never in `soloByOwner`).

A roster person maps to the loci they own via their **primary function** — `functionOf(role)`
(the ledger's own mapping, exported from `migrate.ts`), falling back to their primary area —
**not** the union of every coverage area they're tagged with. Unioning coverage was the
residual bug: nearly everyone "covers Sales", so union-of-areas still inherited Sales loci.
Primary-function ownership is a partition: each locus's role-owner is unique, so the same
locus can't land under two different functions.

The Discover roster's async list and its "N open on loci they own" count now both read this
owned set; seam questions render as a pointer to the session queue, never as solo items.

## The Alliances acceptance test (live, `Laila CRM`)

**Before:** Leader – Alliances showed ~55 "on their turf", sharing four Sales-handoff
questions with Leader – Sales-Ops (area-inherited).

**After** — Leader – Alliances shows **3 owned questions, all Alliances loci**:
1. `alliance.partner_type#valueSet` — "What values can partner_type take?"
2. `alliance.alliance_tier#valueSet` — "What values can alliance_tier take?"
3. `wf:alliance-management-co-sell#phase` — "Which phase does alliance Management & Co-Sell belong to?"

- The four Sales-handoff questions are **gone** from the Alliances solo list. ✅
- The seam questions appear as **"＋ seam questions (Alliances ⋈ Sales) are in the session
  queue — a joint session, not solo."** ✅ and in the inbox Sessions panel under `Alliances ⋈ Sales`. ✅
- The near-duplication between Sales-Ops and Alliances **collapsed** — they share no
  questions now (different functions, different bands). ✅

## Per-person turf, before → after (live)

| person (function) | before (area-overlap) | after (owned-solo) |
|---|---|---|
| Leader – Sales Operations (Sales Ops) | 274 | **248** |
| Sales – Markets (Sales) | 309 | **15** |
| Leader – Marketing (Marketing) | — | **15** |
| Leader – Delivery (Delivery) | — | **14** |
| Leader – Legal (Legal) | — | **6** |
| Leader – Alliances (Alliances) | 55 | **3** |
| Alliances | 23 | **3** |
| Leader – Finance (Finance) | — | **3** |

The old per-person numbers summed far past the 355 global open (each shared, overlapping
band counted under many people). The new numbers no longer overlap **across functions** —
each locus's owning function is unique. The remaining reason a naive sum still exceeds 355 is
**same-function sharing**: two people in the same role (e.g. Leader – Sales Operations and
Sales Operations, both 248) both see that role's owned questions, because the ledger owns each
locus by **role, not person**. That is honest and reported; it is not a cross-function
double-count.

## Where the fix revealed turf still computed by area (reported)

The first cut mapped a person to **all** their coverage areas → owners, which still inherited
Sales loci onto Alliances (55, not 3). Corrected to **primary function only**. Reported so
the distinction is on record: coverage areas describe who a voice can speak to; **ownership**
is one function per locus, and only ownership drives the solo list.

## Findings (reported, not made)

- **Additive (made):** `migrate.ts` exports `functionOf` / `ownerRoleLabelForArea` (pure, no
  behaviour change) so the surface uses the ledger's own function mapping — no drifting copy.
- **Same-function sharing** (above) is inherent to role-ownership; per-person disjoint lists
  would need per-person locus assignment, which is the operator's assign action, not a
  derivation change.

## Verification
`tsc` + eslint clean; 11 `ledgerProjections` tests green; verified live on `Laila CRM` —
Alliances shows 3 Alliances-only owned questions with the Sales-handoff bleed gone, seams in
the session queue, per-person turf dropped to owned-solo loads. Screenshots in the session.
