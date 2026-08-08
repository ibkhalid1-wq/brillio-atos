# Aura — Claims-ledger implementation report (2026-08-08)

The artifact structure — three separate generated documents rendering every field as equally certain
fact — is replaced by **one claims ledger with projections**. This reports what was built, the measured
numbers that replace prior estimates, and what stays gated.

## Precedence lattice — and the cells that were hardest

`resolvePrecedence(a, b)` (pure, table-driven, `precedence.ts`) resolves any (source × world) × (source
× world) to **wins / coexist / escalate**. The doc's table (`ledger-precedence.md`) is generated from
the function and pinned by test. 15 tests: every cell for invariants (totality, order-consistency,
determinism), the six hard cases explicit, plus the doc-sync guard.

- **Hardest cell: regulation vs an attributed assertion (case 4).** The naive "regulation wins, overwrite"
  violates *asserted outranks generated / no regeneration overwrites an attributed closure* — regulation
  is not the human who asserted, and silently discarding an attributed claim is the exact defect this
  build kills. Resolved: regulation **binds** (the assertion can't be *closed* in violation) but does not
  overwrite — the assertion is held **blocked** and the conflict **escalates to Legal/Compliance**.
- **Second hardest: the world-dependence of `code-derived`.** A Salesforce export is near-ground-truth
  for **as-is** and near-worthless for **to-be**. So source strength is a **per-world rank vector**, not
  one global order — `code-derived` sits 3rd for as-is and 7th for to-be. This is why hard case 1
  (asserted correction beats the export) and the to-be case invert.
- The other principled call: two same-source **human-decision** claims (asserted/dispositioned/regulation)
  **escalate**; two evidence/machine claims **coexist**. Escalate is not a punt — auto-picking between two
  humans is the silent-overwrite defect.

## Instantiation findings → amendments

Writing the full ledger for **Opportunity** + the real **Opportunity Qualification** workflow
(`ledger-instantiation.md`, ~30 claims / ~11 unknowns) surfaced nine awkward fields → amendments,
applied before Phase 2:

- **A1** tagged-union value (FK-shaped `account`/`owner` are refs, not name strings); **A2** aliases are
  claims, and `"Engagement"` colliding with a distinct element is a flagged contradiction; **A3** Tier-0
  identity is world-agnostic, existence is a claim when contested; **A4** a reference into an *open* value
  set is `blocked` (the step that sets stage to "Qualification", a member of an unknown set); **A5**
  multi-value slots (a 4-way handoff is four edges, not one string); **A6** child ids are content-derived,
  never the array index. The critique added **A7** projections-only read path and **A8** escalate-always-
  reachable. **The tiers held — nothing needed a new tier or a tier to move.**

## The critique's strongest point

`ledger-critique.md` pressed eight attacks. The strongest that **landed**: **C2 — "emit unknowns not
omissions" manufactures a ~450-item day-one queue that makes the tool feel broken.** The old artifact
looked *complete* by omitting unknowns; the ledger looks *broken* by showing them. Resolution: the volume
is real (measured below, not denied), but 450 *claims* ≠ 450 *questions to a human* — the depth filter
splits them into **blocking** (Architect-gating, must-answer) vs **disposition-eligible** (bulk-accept),
and the queue's default view is **blocking-only with the total as a secondary figure**. The attack fails
where it says "go back to hiding them" — the old "looks complete" was the defect; the fix is *ranking and
bulk disposition*, not false certainty. (Amendments A7/A8 came out of C1/C3.)

## Measured migration numbers (replace every prior estimate)

Migrating the committed Laila snapshot (`migrate.ts`, deterministic, tested):

| Metric | Measured | Replaces estimate |
|---|---|---|
| elements | **310** | — |
| claims (all live) | **955** | — |
| **open unknowns** | **395** | ~450 |
| weak | **549** | — |
| operator corrections (weak, closed-without-verbatim) | **26** | "30 override-corrected" |
| unresolved references | **13** | — |
| blocked | **11** | — |
| by source | code-derived **401** · generated **528** · dispositioned **26** | — |
| by world | to-be **951** · **as-is 4** | — |

The as-is/to-be split (**4 vs 951**) directly confirms **critique C5**: worlds are sparse; as-is is
populated only by imports, and Laila (a reverse-engineered prototype) is the *worst* case for as-is
density, not the typical one. **These figures are corrected at source** in `listen-gap-list.md`,
`semantic-roles.md`, and the F-A..F-G "absorbed" table in `artifact-schema-findings.md`.

Queue routing (on the migrated ledger): **171 blocking · 224 answerable-without-a-meeting · 11 blocked ·
0 unowned**, owners ranked by how much they block (Sales Ops leads on total, Sales Leaders on blocking).
*(The live-app lens shows slightly different counts — 150 blocking etc. — because it migrates the live
artifacts, which have evolved past the snapshot; the snapshot figures above are the deterministic ones.)*

## What the deviation register caught on real data

Diffing as-is vs to-be per locus caught **all four removed entities** as **unbacked** deviations
(`entity-profile`, `interaction`, `pricing-item`, `user`), and correctly flagged **`user` and
`pricing-item` as still-referenced** — the known "an entity removed while steps still reference it" case,
surfaced as a first-class object, exactly as required. Import adapters exercise the register further: a
Salesforce picklist (as-is) and a FHIR binding (to-be) on one attribute are a coexisting cross-world
pair — the confirm-or-deviate question, grounded.

## Visual pass (screenshots)

Verified live on Laila's atlas (the "Ledger lens" card migrates the program's artifacts on the fly,
read-only). Each new primitive rendered in its states — **claim status** (● closed / ◐ weak / ○ open /
◮ blocked / — n/a / ⇄ conflict; weak-vs-closed is solid-vs-half, readable in greyscale), **source class**
(dashed = strong-default-awaiting-confirmation), **contradiction badge** (a routable pill, not an error),
**seam ⋈ / unowned bands**, **as-is→to-be deviation marker** (✓ deliberate / ▲ unbacked / still-
referenced). No colour-only signals; native buttons, focus-visible; no console errors. (Screenshot in the
session; the panel is at Workflow Studio → "Ledger lens".)

## Migration remainder (surfaces still on the old path)

The projections are built and tested, and the demonstration lens reads them. But the **editable
swimlane** (`AtlasSeamView`) and the **live kit/discovery surfaces** keep their existing blob data path:
adapting them to *read and write* the ledger needs **persistence** (an edit must round-trip to a stored
ledger), which is gated. Read-only they could be swapped; the write-back is the blocker. Listed here per
the rule — they are not on two parallel data paths for reads I built (the lens is the ledger read path),
but the live editors remain on the blob until persistence lands.

## Gated list (specified, blocked on edge / database / access)

- **Persistence** — the ledger store is storage-agnostic behind `LedgerStore`; a Supabase adapter is the
  gated piece (no DB here). Without it, no edit round-trips and the live editors stay on the blob.
- **The generator** emitting claims-with-unknowns + its validation (`ledger-generation-contract.md`) —
  edge/Deno, not runnable here.
- **Shape declarations in Frame** as a runtime step (the shapes are typed; declaring them per engagement
  is a gated UI+persistence step).
- **Live import retrieval** — Salesforce org credentials / a private FHIR IG endpoint; the *transforms*
  are built and tested against public-spec fixtures, the *fetch* is gated.
- **Tier-2 durability consumer** — committed in the critique (C4) and honoured: the import adapters set
  `configuration`/`domain` at the source, and the projections/deviation register read it. Not decoration.

## Decisions under "decide, don't ask"

- **Per-world source-strength vectors** rather than one global order — because `code-derived` is
  authoritative for as-is and near-worthless for to-be; a single order can't be right for both.
- **`escalate` is a first-class outcome, not a failure** — two attributed humans disagreeing is exactly
  what must not be auto-resolved; the honest answer routes to a named authority (A8: always reachable).
- **`about` separator is `#`, not `.`** — both element ids (`el:attr:opportunity.stage`) and slots
  (`touches.user`) contain dots; a dot separator mis-split them (a real bug caught by the projection test).
- **Operator overrides → `weak` closures attributed to the operator**, not `closed` — every override
  carries a *who* (the operator) but no *reason/verbatim*, so it is a touch, not a confirmation. The 26
  are marked closed-without-verbatim, distinct from a stakeholder assertion.
- **Removed entities split across worlds** (as-is exists=true / to-be exists=false) so the deviation
  register can see them — the alternative (a single "removed" flag) is invisible to a world diff.
- **The live UI swap is a demonstration lens + a remainder, not a rip-out** — swapping the editable
  swimlane needs ledger persistence for write-back (gated); building a read-only lens over on-the-fly
  migration proves the projection path without a two-write-path hazard or a false green.
- **`is part of` and appearance (F-E) stay out of the claims schema** — the former is membership not
  progression; the latter is not a claim.
