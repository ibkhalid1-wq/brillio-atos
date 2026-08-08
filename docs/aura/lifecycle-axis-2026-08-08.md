# Aura — The lifecycle axis (2026-08-08)

Branch `reimagined-ui`. The atlas had one dimension (workflows grouped by area); the vertical ordering
*read* as a lifecycle but was array position. This session added the second dimension — the cross-entity
lifecycle latent in the ontology's relations — and established which half of it is buildable now and
which is a stakeholder answer with nowhere to land.

## The split this session established

| | Buildable now (no field, no model) | Needs a stakeholder answer / a gated field |
|---|---|---|
| **Cross-entity journey** (Lead→Opportunity→Contract→…) | ✅ derived from the `produces` relation graph — `journeyGraph.ts`, 10 tests | — |
| **Which journey is primary** | reported as candidates, not picked | an engagement-level choice (Listen) |
| **Within-entity lifecycle** (Opportunity's stages) | ✗ — the stage set is never inferable | **F-F** field + the highest-value Listen ask |
| **Workflow → phase** | ✅ derived (entity-based), marked derived | **F-G** field (gated) to make it correctable |

That is the headline: the journey *between* entities is derivable from what the ontology already holds;
the lifecycle *within* an entity is not, and no field holds it yet. One is code, the other is F-F + Listen.

## 1 · Candidate journeys (deterministic, no model call)

`deriveJourneys(ontology)` traverses the `produces` subgraph. Measured two ways, both honest:

- **Committed snapshot** (`docs/laila/snapshot-2026-08-07`): 33 entities, **34 of 35 relations are
  `produces`** (1 `is part of`); roots `{Campaign, Partner}`; **5 orphans** (Contact, Signal, Signal
  Action, Interaction, Document); **57 maximal chains**; phase bands 0–4.
- **Live Laila ontology** (read in-app during preview verification): **31 of 40 `produces`**, **4
  orphans** (Contact, Document, Partner, Signal Action). The ontology has evolved past the snapshot;
  the deriver adapts and stays deterministic (tests pin the snapshot).

**Leading candidates** (longest, highest trunk-weight): `Campaign → Lead → Opportunity → Contract →
Billing Schedule` · `Campaign → Lead → Opportunity → Engagement → Revenue Recognition` · `Partner →
Account → Opportunity → …`. **Aura reports them; it does not pick one** — the customer, quote, and
engagement lifecycles overlap and which is the primary axis is an engagement choice.

**What the generic `produces` verb let me infer — and what it didn't.**
- *Inferred:* direction (a DAG — no cycles on Laila), depth/order (topological longest-path → the phase
  bands), the trunk (participation DP → Opportunity is the busiest node), roots, sinks, orphans, forks.
- *Not inferred:* **progression vs composition.** `Opportunity --produces--> Contract` (lifecycle
  advance) and `Opportunity --produces--> Quote` (has-many sub-record) are *identical* in the schema —
  same verb, same `1:N` cardinality. That is why Opportunity has **out-degree 13** and the graph has 57
  maximal paths: the fan-out is the finding. The verb is uniformly traversable and semantically thin, so
  a single lifecycle cannot be *selected* from it without either a richer verb or a stakeholder. Cardinality
  doesn't separate them either (all 1:N). This under-determination is the honest result, and it is
  engagement-invariant reasoning: any ontology with a generic verb + fan-out has the same property.
- *Cycles/branches/orphans:* Laila is acyclic; every fork is reported; 4–5 entities sit on no chain.

## 2 · The two-dimensional atlas grid

`AtlasLifecycleGrid.tsx` — **area across, lifecycle phase down** (phase = topological depth band from
item 1). A workflow lands where its derived phase meets its owning area; phase is derived from the
entities its steps touch and **marked derived** (`°entity` glyph + dotted underline), never asserted,
and no phase field is written to the artifact. Coherence markers land in cells (missing-entity `⚠`,
undeclared crossing `⤫`, unseen handoff `◇`) plus cross-area `→Area` badges.

**The seam is now a coordinate.** Verified live on Laila: `Contract Review and Compliance` sits at
**Legal :: phase 3** (via Contract) and `Invoicing and Revenue Recognition` at **Finance :: phase 4**
(via Invoice). The Contract→Revenue progression across the Legal/Finance functional boundary is two
pointable adjacent cells on a diagonal — not something a coverage matrix infers, which structurally
cannot see it. Screenshotted (full grid + the highlighted Legal/Finance seam).

## 3 · Schema findings F-F and F-G (recorded, not implemented)

In `artifact-schema-findings.md`:
- **F-F — attributes have no value set.** 33 of 178 attributes are enum-shaped (`stage`, `status`,
  `severity`, `healthRag`, …) and none can record its members. Stronger than F-D: a *type* is inferable,
  a *stage set* never is — only a stakeholder knows Prospecting→Qualification→Proposal→Closed-Won. The
  prototype already rendered `Opportunity.stage` as a record *title* for lack of a value set (F-F, visible).
- **F-G — workflows have no phase field.** The vertical axis must be derived because the artifact can't
  hold it. Proposed a one-line optional `phase` field (gated write); until then the grid's derivation is
  the honest interim.

Both sit in the same gated pass as F-A/F-B/F-D; the Priority table and closing were updated.

## 4 · Listen questions (added to `docs/laila/listen-gap-list.md` §11)

Per journey entity, grouped by the owning session (Marketing→Lead, Sales→Opportunity, Legal×Finance→
Contract/Invoice, Delivery×TA→Engagement, …): **stages in order · what moves a record between them ·
what can go backwards · what is terminal.** Stated prominently that **these answers have nowhere to land
until F-F** — captured verbatim, attributed, held outside Aura, ingested when the field exists. An answer
with no destination is still worth having; an answer assumed stored when it isn't is not.

## 5 · Does it generalise? — fleet-gated, stopped

- **Fleet generalization needs a DB read.** Only Laila's ontology is local (`docs/laila/snapshot-*`).
  Running the derivation across other engagements — and answering *which entities appear on a journey in
  most engagements* (the baseline-vocabulary question from a new direction) — requires reading their
  blobs. That is a database read → **stop condition; not done this session.** When run, it is a pure
  read: `deriveJourneys(readArtifactDoc(program,"domainOntology"))` per engagement, then intersect the
  on-chain entity sets.
- **What generalises without the fleet (engagement-invariant reasoning):** the derivation *as candidate
  enumeration* generalises to any ontology; the derivation *as single-journey selection* does not,
  wherever a generic verb + fan-out exists (measured on Laila: 57 candidates). So the honest general
  claim is "journeys are derivable as candidates everywhere; the primary axis is never derivable from a
  thin verb" — which is exactly why item 1's contract is *report, don't pick*.
- **Baseline-vocab candidate, reasoned not measured:** the entities most likely to recur on a journey
  fleet-wide are the high-participation trunk nodes (Account/Opportunity/Contract/Engagement on Laila) —
  the same handful the existing `baselineVocabulary.ts` concepts point at. Confirming the recurrence
  rate is the gated fleet read above.

## Verification & tests
- 1166 tests pass across 78 files (10 new in `journeyGraph.test.ts`; determinism + structural findings +
  phase bands + workflow placement, all against the committed snapshot). New TS lints clean at
  `--max-warnings 0`; `tsc --noEmit` clean.
- Grid verified live in the preview on Laila (studio → "Lifecycle × area" card); full grid and the
  Legal/Finance seam cell screenshotted.

## Decisions made under "decide, don't ask"
- **Phase = topological depth band, not a single chosen journey.** A linear extension of the DAG gives
  every entity a phase without picking a primary journey — so the grid needs no stakeholder choice to
  exist, and the "which journey" question stays open where it belongs (Listen). Depth (longest path from
  a root) banded the 33 entities into 5 readable phases that match the eye's reading.
- **Workflow phase = most-referenced on-chain entity** (tie-break: deeper phase, then name). Matches the
  prompt's "references Opportunity → sits at the Opportunity phase"; deterministic; marked derived.
- **Column = the workflow's owning `area`; the seam shown as a `→Area` badge**, not by placing one
  workflow in multiple columns. Keeps each workflow one addressable cell while still making the crossing
  visible — the seam becomes a coordinate without duplicating the workflow.
- **`is part of` excluded from the forward axis.** It is membership (N:1), not progression; folding it in
  would invert Contact→Account into the lifecycle. Reported in the verb split, not traversed.
- **Rename/journey ambiguity surfaced, never resolved by guessing.** Forks are reported; the primary
  journey is not chosen; heuristic disambiguation of progression-vs-composition was refused on principle.
- **Grid added as a collapsible card next to the seam view** (default collapsed), not as a replacement —
  additive, previewable, and it reuses the seam view's area-resolution + coherence logic (kept local to
  avoid coupling; noted in the file).
