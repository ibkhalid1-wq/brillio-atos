# Aura — The write model (resolved on paper, before persistence)

The cold review returned "not safe to build persistence on" for one structural reason: the write model
is undefined — `migrate()` rebuilds the ledger from the blob every time and never reads an existing
ledger, so a regeneration silently discards every ledger-side closure. This session resolves it as a
**specification, tested against the real code**, and ends with a recommendation. It writes no
persistence and nothing that round-trips. The choice is Ibrahim's.

**Headline:** the two options share one merge algorithm and one persistence contract; they differ only
in *where the incoming claims come from* and *whether migration re-runs*. The dangerous path is neither
A nor B — it is the current implicit "re-migrate with no merge," which loses closures. Adopt the merge;
then A-vs-B is a sequencing call. One case neither handles cleanly: a **rename** strands an attributed
closure, and reattaching it needs the (unbuilt) binder.

---

## The two options

**Option A — migration is a one-time bootstrap.** The blob is imported once. Thereafter every change —
including regeneration output — flows through the store as claims and is `reconcile`d by precedence, so
the no-overwrite promise applies. Migration never runs twice on a live ledger. *Requires the
claims-emitting generator (gated) to produce the incoming claims with stable ids.*

**Option B — migration is repeatable.** It re-runs on the new blob whenever artifacts regenerate, and is
therefore obligated to **read the existing ledger and merge** — preserve every attributed closure, apply
new generated claims by precedence, never overwrite. *Buildable now (migrate() exists); no dependency on
the gated generator.*

They are not as different as they look: **both feed a batch of incoming claims through the same merge**
(`reconcile`). A's batch comes from the generator; B's batch comes from re-running `migrate()`. The
persistence contract below is identical for both.

## The merge algorithm (specified and tested — `merge.ts`, `ledgerMerge.test.ts`)

Regeneration output is always `generated` (the generation contract's source ceiling). So the decision
table that actually runs is **incoming `generated` vs one existing claim on the same locus** — driven by
precedence, with **one rule precedence does not have:** two `generated` claims do not "coexist" (that
would accumulate a stale generation on every regeneration) — the **incoming (newer) generated supersedes
the existing generated.**

| Existing claim on the locus | Outcome | Why |
|---|---|---|
| any source, **different world** (as-is) | **coexist-deviation** | cross-world is the deviation register's job; regeneration (to-be) never touches as-is |
| `?unknown` (open) | **fill-unknown** | the incoming value answers the open slot |
| `asserted` / `dispositioned` / `document` / `regulation` / `precedent` / `external-standard` / `code-derived` (to-be) | **preserve-existing** | every non-generated source outranks `generated` for a shared world — the closure/evidence stands, incoming dropped (no overwrite) |
| `generated`, **same value** | **corroborate** | identical claim; one row kept |
| `generated`, **different value** | **supersede-existing** | **recency** — the new generation replaces the stale one (the rule beyond precedence) |

Every row is unit-tested (`mergeDecision`). The "preserve-existing" row is the no-overwrite guarantee,
inherited from `resolvePrecedence` and proven by the store; the "supersede-existing" row is the added
recency rule, without which regeneration accumulates garbage.

**The case that breaks naive merges — a closure whose underlying generated claim disappears.** A
stakeholder asserts something about `Opportunity`; regeneration then drops `Opportunity` upstream, so the
incoming batch has no claim on that locus. The merge **preserves the attributed closure and flags it as
an orphan** (`orphanedClosures`) — it is never silently deleted. It cannot be auto-resolved: either the
removal is right (retire the assertion) or the assertion is right (the removal is wrong). This is a
**surfaced conflict requiring a human**, and it is the honest outcome for both options.

## The regeneration case, run against real code (numbers)

Migrated Laila, closed the stage set through the store as a firm assertion (`by: vp-sales`), then
regenerated (re-migrated the blob):

```
attributed closures made through the ledger, before regen:   1 (the vp-sales assertion)
  ... after the CURRENT migrate() re-runs fresh:             0   ← LOST (silent overwrite)
  ... after reconcile() merges the regeneration in:          1   ← PRESERVED
reconcile report: preservedClosures=1, filledUnknowns=394, supersededGenerated=0, orphans flagged=1
```

The 26 operator corrections survive a naive re-migrate only because they are re-derived from the
override log in the blob each run; **anything a stakeholder closes *through the ledger* after migration —
the entire point of the ledger — is lost by the current re-migrate, and preserved by `reconcile`.** For
a live engagement that is every stakeholder assertion, not one. Both A (store-merge) and B
(read-existing-merge) call the same `reconcile` and preserve it; only the current no-merge path loses it.

## The two corollaries the review raised — resolved per option

Both corollaries resolve **identically for A and B**, because both share the store and the merge.

**1 · The store is not append-only — a write is a read-modify-write across the locus.** `assert` mutates
prior claims (`supersededBy`, and `status = "blocked"` on a bound loser). So a claim **cannot be a
persist-once immutable row.** Two shapes are possible; the shipped store is the first:

- **Mutable rows (matches the shipped code).** A `claims` row with mutable `status` / `supersededBy`. A
  write = *read the live claims on this `about`, run precedence, update the losers, insert the new row* —
  atomic across the locus. **Concurrency control required:** serialize writers per locus — a transaction
  holding a lock keyed by the locus (e.g. `SELECT … WHERE about = $1 FOR UPDATE`, or a Postgres advisory
  lock on `hashtext(about)`). Lock scope is **one `about`**, not the table — different loci never
  conflict, so contention is low. The store interface does not express this today; persistence must add it.
- **Append-only events (matches the audit philosophy, heavier reads).** Never mutate; a supersession is a
  new event; the live set is *folded* from events per locus at read. This makes the ledger append-only
  like the audit table, but pays the fold cost on every read — compounding the O(n²) projection finding.

Either is viable; **the mutable-rows shape is the least surprise given the shipped store, and its
concurrency requirement is a per-locus lock.** This is a persistence-binding decision, the same for A and B.

**2 · `contentId` hashes the source, so an "upgrade" is a new row, not an update.** A generated value a
stakeholder later confirms becomes an `asserted` claim with the same `about`/`world`/`value` but a
**different id** (source is in the hash). This is handled as *two rows, precedence decides* — correct,
and what the store already does (the asserted row wins; the generated is superseded). **What breaks:**
any external reference that holds a **claim id** across a source change goes stale. Therefore a
persistence layer must make durable foreign keys reference **element ids or `(about, world)` tuples,
never claim ids.** (Internally, `contradicts`/`supersededBy` hold claim ids and are filtered by
`isLive`, so a stale link is harmless; the rule is only for *durable/external* references.) One wart to
note: an upgrade with the *same* value doesn't supersede the generated row (no value conflict), leaving a
redundant row the projection hides — cosmetic, not a correctness issue.

## Audit vs ledger — the system-of-record distinction (stated once)

They are, and must remain, **different stores answering different questions:**

- **The audit log (`audit_events`, Step 1)** is **append-only, trigger-enforced, immutable.** It is the
  system of record for **who changed what, when** — the mutation history. It is never projected into
  believed-state; it is the forensic trail.
- **The claims ledger** is **mutable (or event-folded) and precedence-resolved.** It is the system of
  record for **what is currently claimed and how certain it is** — believed state and its provenance-
  by-source. It is queried and projected.

A ledger write **produces** an audit event; the audit event **is not** the ledger. **Do not conflate
"the audit log is append-only" with "the ledger is append-only"** — the ledger needs mutable
supersession that the audit table forbids. If the ledger were forced append-only "to match audit," it
would either lose precedence resolution or duplicate the audit's job. One is the trail; the other is the
truth-as-currently-claimed.

## The owner-fabrication fix (specified, not built) — and the honest Laila numbers

`ownerFor` bottoms out in `return { role: "Sales Ops" }` and can emit neither `unowned` nor `joint`, so
every migrated ledger shows **0 unowned, 0 seam** — the kit's two loudest signals, suppressed. The fix:

- **Emit `unowned`** where the element's area maps to no known function (no `area`, or an area string
  matching no function) — replace the `return Sales Ops` default with `return { kind: "unowned" }`.
- **Emit `joint(A ⋈ B)`** where a locus is **genuinely shared**, by a stated rule:
  - a **relation** `A→B` whose endpoint entities have **different primary functions** → its claims
    (cardinality/optionality/semantics) are owned `fn(A) ⋈ fn(B)`;
  - a **workflow step or handoff** whose actor-area differs from the workflow's owning area → that
    crossing claim is `fn(area) ⋈ fn(actorArea)`.
  "Primary function" = the first function its area string maps to (Laila entities carry multi-area
  strings; the first match is the owner, the crossing is the seam).

**Honest Laila numbers** (independent recompute under the rule above, over entity/attribute/relation
loci — *not* the shipped code, which I did not change):

```
shipped (fabricated):   role 955 · unowned 0 · joint 0
under the fixed rule:   role ~871 · unowned ~24 · joint ~60   across 8 distinct seams
seams surfaced: Finance ⋈ Legal · Delivery ⋈ Finance · Delivery ⋈ Legal · Delivery ⋈ Sales ·
                Alliances ⋈ Sales · Finance ⋈ Marketing · Finance ⋈ Practices · Finance ⋈ Sales
```

The fabricated **"0"** becomes **~24 unowned and ~60 joint claims across 8 seams — Finance ⋈ Legal among
them**, the documented Contract→Revenue seam the cold review said should appear. (Lower bound: the
recompute excludes workflow-crossing seams, which would raise `joint` further.) **That number, not "0,"
is the true distance-from-readiness the kit should show.**

## Recommendation, with evidence

**Adopt the merge algorithm now; make migration read-existing-and-merge (Option B) as the interim; retire
it to a one-time bootstrap (Option A) when the claims-emitting generator lands.** Evidence:

- **The persistence contract is identical for both** (mutable rows + per-locus lock; durable FKs on
  element ids / `(about,world)`), so choosing B now does not foreclose A — no rework at the persistence
  layer when the generator arrives and migration retires to bootstrap.
- **B is buildable today** (`migrate()` + `reconcile` both exist and are tested); A depends on the gated
  generator. Shipping persistence should not wait on the edge.
- **A is the cleaner end state** — once generation emits claims directly, re-running a blob→ledger
  migration is a legacy concept; bootstrap-once is simpler and removes a whole class of re-migration
  churn (e.g. content-derived step ids shifting on text edits, which B must absorb every run).

So: **B until the generator; A after.** The one thing that must land before persistence regardless is
`reconcile` (the merge) replacing the current no-merge re-migrate — without it, B loses closures exactly
as the current code does.

## The single case neither option handles cleanly

**A rename strands an attributed closure.** Element ids are name/content-derived; renaming `Opportunity`
→ `Deal` changes its id, so a stakeholder's assertion sits on the *old* id while regeneration lands on
the *new* one. The merge preserves the old closure (never deletes it) and flags it orphaned — but it
**cannot move it to the renamed element**, because that requires a rename map (old-id → new-id) that only
the **binder** provides, and the binder is not built. So a rename produces a surfaced orphan that a human
must reattach, and the reattachment cannot be automated pre-binder. This is inherent to both options and
is the honest residue: the write model is safe (no silent loss), but **rename-reattachment is a gated
follow-on, not solved here.**

---

*Stop. Persistence waits on the A-vs-B sequencing call and on `reconcile` landing in place of the
no-merge re-migrate. Both are Ibrahim's to schedule; this session specified and tested the design, it
did not build persistence.*
