# Seed data — populating the prototype from the ontology

> Status: spec + the client-buildable deterministic core. Realistic-content generation (model) and
> any edge change are marked and gated. Architect owns seed data.

## Why it's an instrument, not decoration

A stakeholder reviewing an **empty** prototype reviews the layout. A stakeholder reviewing a
**populated** one notices that an Opportunity has no Account, that a status value doesn't exist in
their process, that a list is sorted wrongly, that "Revenue Recognition" has no Engagement behind it.
Seed data is a **validation instrument** — designed to provoke correction — so it is generated to be
referentially consistent *and* to expose exactly the gaps the ontology still carries.

## Derive from the ontology, respecting relations

Generation is a pure function `seed(ontology, opts) → Record<entity, Row[]>`, run in **topological
order** over the relation graph so a child is only created after its parents exist:

1. **Order** entities by dependency (roots first: `Partner`, `Campaign`, and the relation-less
   entities; then their descendants). Cycles (none in Laila) break by treating the back-edge as
   optional.
2. **Roots** get N rows (see Volume).
3. **Children** of a `A →[1:N] B` relation each pick a real parent `A.id` — never a dangling FK.
   Fan-out per parent is drawn from the assumed range (below), deterministically.
4. **`1:1`** (`Lead → Lead Score`) creates exactly one child per parent. **`N:1`**
   (`Contact → Account`) sets a required parent FK on each child.
5. **Referential invariants**, asserted after generation (client-testable): no orphan child on a
   mandatory relation, no cardinality violation (a `1:1` child count ≠ its parent count fails), no
   duplicate primary key.

## Synthetic and marked

No real client names, no real employee names, no real deal values. Every generated record carries a
classification so the tripwire the build plan set for real data can never be crossed casually here:

```jsonc
{ "id": "opportunity-0007", "name": "Northwind — Platform renewal", …,
  "_synthetic": true, "_classification": "SYNTHETIC-SEED" }
```

Names come from a neutral synthetic pool (fictional companies/people/products); numbers from bounded
synthetic ranges. A lint asserts no record is missing `_synthetic`, and the ingestion layer refuses
any record without it.

## Volume and shape (decisions)

Enough to make lists paginate and edge cases visible; not so much it obscures the design.

- **Root entities: 24 rows.** Pagination in Meridian's table is 20 → 24 guarantees a second page
  (page 1 full, page 2 partial — both states reachable).
- **1:N children: 0–5 per parent**, deterministic, and deliberately *including the extremes*: at
  least one parent with **0** children (so the empty-state renders) and one with the **max** (so a
  nested list scrolls/paginates). Averaging to a flat "3 each" would hide both states.
- **Planted edge cases** (the instrument): one record with a **very long name** (layout stress), one
  with a **missing optional field** (null rendering), one at a **boundary value** (amount = 0, a date
  at quarter-end), and — because it provokes the highest-value correction — a small number of records
  that sit on an **unresolved ontology assumption** (e.g. a `Revenue Recognition` with no parent
  Engagement, if optionality is later declared mandatory, surfaces as a visible orphan for the
  stakeholder to catch).
- **Total** for Laila's 33 entities ≈ ~24 roots × few root types + fan-out ≈ **a few hundred rows** —
  large enough to feel real, small enough to stay legible and to fit a fixtures file.

## Reproducible and incremental

- **Seeded.** The PRNG is keyed by `hash(ontologyVersion + entityName)`, so the same ontology
  version yields byte-identical data. No `Math.random()` (also unavailable in this codebase's
  deterministic contexts).
- **Incremental (follows the fabric's rule).** An ontology change regenerates only the **affected
  entities'** rows (the entity changed + children whose FK domain changed); untouched entities keep
  their exact prior rows. A record a **stakeholder edited in the prototype** is marked (like a fabric
  refinement, keyed by record id) and is **preserved** across regeneration — a re-seed never destroys
  a hand-corrected row; if the change invalidates it (a referenced parent removed) it is **flagged**,
  not deleted.

## Ingestion — three concerns stay apart

The prototype consumes seed data as **content only**, through a data layer that is blind to
appearance and structure:

- **Fabric** supplies structure (which screens/regions exist) — `data-fabric-id`.
- **Meridian** supplies appearance (`.m-*` classes, tokens) — knows nothing of entities.
- **Seed data** supplies content — a `fixtures.json` keyed by entity, loaded by `app.js` and bound
  into the fabric's regions at render. No design tokens in fixtures; no entity knowledge in Meridian;
  no content in the fabric. The export already emits `fixtures.json` alongside `meridian.css` and
  `design-tokens.json`, keeping the three files — and the three concerns — separate.

## Assumed cardinalities & optionality — the Listen input

Generating consistent data forces build-time guesses into the open. Laila's ontology carries **35
relations**: cardinality is present on all (**33× `1:N`, 1× `1:1`, 1× `N:1`) but the *verb is the
generic "produces" on 34 of 35*, and **optionality is absent on all 35** — so **every** relation
needs at least an optionality assumption, and every `1:N` needs a fan-out assumption, before data can
be generated. Each assumption below is a direct question for the Listen sessions.

### A · Optionality — assumed on all 35 (none declared)

For every relation the generator must assume whether the child **requires** its parent (mandatory FK)
and whether the parent may have **zero** children. Default assumption applied: **child-optional,
parent-optional** (a parent may have none; a child need not have a parent) — the safest for
generation, the weakest for integrity. The ones where that default is likely **wrong** (and so are
the highest-value Listen questions):

| Relation | Assumed | Likely real (to confirm) |
|---|---|---|
| `Contact →[N:1] Account` | Contact optionally in an Account | Contact **must** belong to an Account? |
| `Lead →[1:1] Lead Score` | Lead may lack a Score | every Lead **has** a Score? |
| `Opportunity →[1:N] Opportunity Line Item` | Opp may have 0 items | an Opp **must** have ≥1 line item? |
| `Engagement →[1:N] Invoice` | Engagement may have 0 invoices | billing **requires** ≥1 invoice? |
| `Opportunity →[1:N] Quote` / `Proposal` / `Contract` | all optional | which are **mandatory** at which stage? |

### B · Fan-out — assumed on all 33 `1:N` relations

Cardinality says "many" but not *how many*. Assumed range **0–5 per parent** uniformly. The ones
where the real distribution matters for the demo to read true (Listen questions):

| Relation | Assumed fan-out | To confirm |
|---|---|---|
| `Account →[1:N] Opportunity` | 0–5 | realistic Opps per Account? |
| `Opportunity →[1:N] {Quote, Proposal, Contract, SOW, …}` (11 children) | 0–5 each | which of these 11 actually co-occur, and typical counts |
| `Engagement →[1:N] {Staffing, Timesheet, Milestone, Invoice, …}` (7 children) | 0–5 each | Timesheets especially are 100s, not 0–5 — a scale assumption to correct |
| `Campaign →[1:N] {Lead, Event, Campaign Member}` | 0–5 | member counts are typically large |

### C · Relation semantics — the generic verb

34 of 35 relations use the verb **"produces"**. That is a structural placeholder, not a real
business relationship (an Account does not "produce" an Escalation the way a Campaign "produces" a
Lead). The generator treats them all as parent→child FK, but the **labels and directionality are
assumptions** — surfaced to Listen as: *"is this a composition, a reference, or a lifecycle
transition?"* per relation.

### D · Orphan entities — no relations at all

Entities with **no** relation in the ontology (e.g. `Signal`, `Signal Action`, `Interaction`,
`Document`) are seeded in isolation, which assumes they are **standalone**. That is almost certainly
wrong (a `Signal Action` acts on *something*; a `Document` attaches to *someone*) — so each is a
Listen question: *"what does this connect to?"* This is the same set F-C flags as ontology-coverage
gaps; seed generation makes them concrete.

> The generator emits this exact table per run against the live ontology (every guessed cardinality,
> every absent optionality, every generic verb, every orphan), so it is always current and drops
> straight into the Listen agenda.

## Buildable now vs gated

- **Buildable now (client, deterministic, testable):** the topological generator, the referential
  invariants, the seeded PRNG, the synthetic marking, and the assumptions-list emission — all pure
  functions over the stored ontology. This spec fixes their contracts; implementation is a follow-on
  slice.
- **Model-dependent (gated):** *realistic* content — plausible company names, believable
  descriptions, sensible status vocabularies — genuinely needs a model call. Structure and
  referential consistency do not. Recorded alongside **F-D** in `artifact-schema-findings.md` as the
  content-generation gated item; the deterministic skeleton (ids, FKs, counts, synthetic
  placeholders) is buildable and testable without it.
