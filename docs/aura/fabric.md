# The Fabric — a deterministic layer between ontology/atlas and prototype

> Status: spec + the client-buildable core. The model-dependent and edge pieces are marked and gated.

## Why

Today the prototype is generated from the ontology and atlas **directly**, as one self-contained
HTML document a model authors in full. Any change — one entity renamed, one workflow corrected —
means regenerating the whole thing. That is:

- **Expensive.** The Laila prototype HTML is **28.6 KB (~7,150 output tokens)**, re-emitted whole
  every run, on top of feeding the ontology (168 KB) + atlas (178 KB) as context.
- **Non-deterministic.** Two runs from the same inputs differ — structure drifts, not just copy.
- **Refinement-destroying.** A stakeholder edit to a screen is overwritten on the next regeneration,
  which the Design Loop cannot tolerate.

The **fabric** is a structured intermediate derived from the ontology + atlas, from which the
prototype is produced. The more structure it carries, the less the model invents — and if it is
rich enough, the prototype's *structure* becomes a deterministic render and the model is needed only
for **copy**. That is the real prize, not the token saving alone.

## Shape

The fabric is a tree of typed **nodes**, each carrying a stable `id`, a `source` reference back to
the artifact it derives from, and a content-`hash` of its derivation inputs.

```jsonc
{
  "kind": "screen" | "region" | "field" | "action" | "nav",
  "id": "screen:opportunity",              // stable, derived from source — NEVER positional
  "source": { "entity": "Opportunity" },   // or { relation }, or { atlasStep: "wf3#2" }
  "role": "list" | "detail" | "form" | "table" | "nav" | "flow-step",
  "hash": "d41…",                          // hash of the inputs that produced this node
  "children": [ "region:opportunity:summary", "region:opportunity:quotes", … ],
  "refined": false                         // set true when a stakeholder edit is bound here
}
```

### Node types (deterministic mapping)

Derivation is a pure function `deriveFabric(ontology, atlas) → FabricNode[]`. What each source
produces:

| Source | Fabric nodes (deterministic) | Model needed for |
|---|---|---|
| **Entity** | one `screen:{E}` (detail) + `screen:{E}:list`; a `region:{E}:summary`; a `field:{E}:{attr}` per attribute; a `table` column set for the list | field **labels/help copy**, column choice priority |
| **Relation `A →[1:N] B`** | a nested `region:{A}:{B}` (child list) on A's detail; a `nav`/FK `field:{B}:{A}` on B's form | relationship **label** ("Quotes", not "produces Quote") |
| **Relation `A →[1:1] B`** | an inline `region:{A}:{B}` panel on A's detail | — |
| **Relation `A →[N:1] B`** | a parent-picker `field:{A}:{B}` on A's form; a back-nav on B | — |
| **Atlas workflow** | a `flow` = ordered `screen`/`action` sequence keyed to the workflow | the flow's **narrative copy** |
| **Atlas step** | an `action:{wf}#{i}` (button/transition) + which `screen` it lands on | button **label** |

Everything in the left column is deterministic and **buildable/testable now** (pure functions over
stored artifacts — no model, no DB, no Deno). Everything in the right column is a model call, and it
is **only copy** — never structure. Justification for each model call: labels and micro-copy are
genuinely a judgement (the ontology's `relation: "produces"` is not a UI label), and there are ~150
of them across 33 entities; the rest of the 28.6 KB is structure the fabric fixes.

## Region identity — the hard part

A regenerated region must **replace the right thing**, not append or displace a neighbour. Identity
is derived from the **ontology source id + role**, never a position:

- `screen:{entityName}` · `screen:{entityName}:list`
- `region:{entityName}:{roleOrChildEntity}` (e.g. `region:opportunity:quotes`)
- `field:{entityName}:{attributeKey}`
- `flow:{workflowId}` · `action:{workflowId}#{stepIndex}`

Rules that make this hold:
- **Names, not indices.** `Opportunity` renamed → the id changes, which is correct: it is a new
  identity, and the rename is carried as a `rename` delta (old id → new id) so the region moves
  rather than being dropped + re-added. This is the same stable-identity discipline the codebase has
  been bitten by before (index ids in DrillAnchor/MovementStakeholder); the fabric must not repeat it.
- **Collision guard.** Two attributes normalising to the same key, or two relations `A→B` with
  different verbs, get a `:2` suffix in derivation order and a logged warning — never a silent merge.
- **Attribute keys** are slugified attribute names, pinned in a per-entity `keyMap` stored on the
  fabric so a display-name change doesn't move the field.

Until the spine's binder lands, `source` references use the identifiers the artifacts already carry
(entity `name`, workflow index, atlas step index) — **no parallel id scheme invented**. When the
binder arrives, `source` swaps to its target ids without changing the fabric's own `id` scheme.

## Incremental update

1. **Ontology/atlas change → fabric delta.** Re-derive the fabric; diff by `id`+`hash` against the
   stored fabric. A node whose `hash` is unchanged is untouched; changed/added/removed nodes, plus
   `rename` pairs, are the **fabric delta**.
2. **Fabric delta → prototype regions.** Each prototype region is emitted tagged with the fabric
   `id` that produced it (`data-fabric-id`). A delta node resolves to the region(s) with that id —
   a direct lookup, no re-scan.
3. **Region identity on re-emit.** The renderer replaces the element carrying that `data-fabric-id`
   in place. A `rename` moves the binding; an add inserts at the deterministic sibling position; a
   remove deletes only that element.
4. **Untouched regions are byte-identical and not re-emitted.** They are copied from the previous
   prototype verbatim; only delta-touched regions are re-rendered (and, for copy, re-prompted).

## Stakeholder refinements must survive

A refinement (a stakeholder or operator edit to a rendered region) is stored as a **refinement
record** keyed by the region's fabric `id`, carrying the edited content and the `hash` of the fabric
node it was made against.

When a delta lands on a region:
- **Delta doesn't touch a refined region** → the refinement is preserved untouched (its `id` isn't
  in the delta).
- **Delta touches a refined region** → do **not** silently overwrite. Compare `hash`es: if the
  fabric inputs behind the refinement changed, raise a **3-way conflict** (base derivation, the
  refinement, the new derivation) into the Design Loop's decision queue for a human to resolve;
  keep the refinement live until resolved.

**Honest limit.** We can reliably *detect* that a refined region is affected and *surface* the
conflict; we cannot *auto-merge* an arbitrary hand edit with a new derivation, because a free-form
refinement has no structured diff against generated markup. So the guarantee is: **a refinement is
never silently destroyed** — it is either preserved or escalated. Auto-merge of overlapping edits is
explicitly out of scope; the partial answer (detect + preserve + escalate) is the honest one.

## Measured claim

Grounded on Laila's real artifacts (33 entities, 35 relations, atlas of 14 workflows / 46 steps,
prototype HTML **28,623 bytes ≈ 7,150 output tokens**):

| | Full regeneration (today) | Fabric incremental (one entity, e.g. `Quote`, changes) |
|---|---|---|
| **Output tokens** | ~7,150 (whole HTML re-emitted) | ~800–1,000 (the ~3–4 regions referencing Quote: its list, detail, the `Opportunity→Quote` nested region, its form fields — of ~35 regions) |
| **Structure via model** | all of it | **zero** — deterministic render; model only re-copies changed labels |
| **Input context** | ontology 168 KB + atlas 178 KB fed whole | the changed entity + its fabric neighbourhood (~a few KB) |
| **Determinism** | drifts run-to-run | structure is a pure function; identical inputs → identical bytes |
| **Refinements** | destroyed | preserved or escalated |

So the fabric is **~7–9× fewer output tokens** on a representative localized change *and* a much
larger input-context reduction — but the headline is that **structure moves to a 0-token
deterministic render**, leaving the model only copy. Honest caveat: the ratio scales with the
change's blast radius — a change to `Account` (root of many `produces` relations) touches far more
regions than a leaf like `Timesheet`; and the exact output figure depends on how much copy actually
changed. If a future measurement shows the fabric merely *shifts* cost (e.g. copy re-prompting
dominates), that is the finding — but the deterministic-structure path cannot cost more than the
model authoring the same structure, so the floor is a strict improvement.

## What's buildable now vs gated

- **Buildable now (client, deterministic, testable):** `deriveFabric(ontology, atlas)`, the region-id
  scheme, the fabric-diff/delta, and delta→region resolution. All pure functions over the stored
  artifacts. This spec fixes their contracts; the implementation is a follow-on slice (kept out of
  this doc's commit to avoid coupling a large module to a spec).
- **Model-dependent:** copy only (labels, help text, flow narrative) — a scoped, per-region prompt.
- **Gated (edge):** teaching the generator to emit region-tagged markup (`data-fabric-id`) against
  the fabric instead of a free-form document — the same gated change as **F-D** in
  `artifact-schema-findings.md`. Deterministic rendering can also run entirely client-side, which
  would remove the edge dependency for structure altogether; that is the recommended direction.
