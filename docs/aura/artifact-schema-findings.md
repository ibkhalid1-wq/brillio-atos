# Aura — Artifact-Schema Findings

Three defects in **Aura's artifact design**, surfaced while scoping Laila's Listen phase but
**not specific to Laila** — every engagement hits them. They are recorded here, not fixed:
each needs its own gated pass because the edge generator has **no executable verification in
this environment** (Deno, outside the client tsconfig, `deno` absent) and a schema change must
be validated against real generation.

Scope of a fix, in general, is three-layered and stated per finding:
1. **Generator** — the `current-state-atlas` / `domain-ontology` prompt + output contract in
   `supabase/functions/run-agent/index.ts` (gated: no local verification).
2. **Existing artifacts** — already-generated atlases/ontologies lack the new field; a
   regeneration or a one-time backfill is required, and until then readers must tolerate absence.
3. **Readers** — `WorkflowStudio.tsx` (the swimlane), the studios, exporters, and any
   Architect-phase consumer.

---

## F-A · The step schema has nowhere to record an automation disposition

**Defect.** A step is `{ actor, action, events, system, entities, evidence, duration }`. Architect
designs agents **against steps**, and there is **no field** for whether a step is
agent-executed, agent-assisted, or human-only — nor for the reason. Across Laila's atlas this is
absent on **all 46 steps**, and it is **blocking**: Architect cannot design a single agent
without it. This is not a Laila gap; the step contract itself has no slot for the one property
agent design most needs.

**Proposed schema addition** (per step):

```jsonc
// step.automation
{
  "disposition": "agent-executed" | "agent-assisted" | "human-only",
  "reason": "why — the human-judgment or risk that sets the boundary",
  "confidence": "asserted" | "assumed" | "generated"   // provenance of the disposition itself
}
```

- `disposition` is the closed three-value set already used in the methodology's automation
  vocabulary (keep it identical so it is one term, not a synonym).
- `reason` is mandatory for `human-only` and `agent-assisted` — the boundary is only useful with
  the judgment that draws it (this is also the seed the Design Loop needs).
- `confidence` lets a generated default be visibly ungrounded until a stakeholder confirms it —
  the same honesty the ontology's `confidence` already carries, so Architect never mistakes a
  guess for a decision.

**Cost.**
- *Generator:* add the field to the atlas output contract + a prompt instruction to emit a
  disposition with a reason (default `human-only` / `confidence: generated` when unknown, so the
  absence is loud, not silent). Gated pass.
- *Existing artifacts:* every current atlas is missing it. Cheapest path is a **reader default**
  (treat absent as `human-only` / `generated`) plus an in-studio editor so operators fill it
  during Listen — no forced regeneration. A full regeneration would re-derive dispositions the
  generator can only guess, which is worse than capturing them from the stakeholder.
- *Readers:* the swimlane renders a disposition affordance per step; the step inspector edits it;
  Architect reads it as the primary agent-design input. Small, client-verifiable.

---

## F-B · The step schema has no decision-point structure

**Defect.** No step can express *"a human judges X on the basis of Y, and here is what happens
each way."* Reverse-engineering recovers the happy-path `action`; it almost never recovers the
**judgment**. The judgment-heavy steps (qualification, deal shaping, revenue recognition,
escalation) are exactly where Architect's richest input lives, and there is **nowhere to put
it**. Across Laila, decision content is absent on every step.

**Proposed schema addition** (per step, optional — present only where a human judges):

```jsonc
// step.decision
{
  "question": "the judgement the human makes",
  "basis": ["what the decision rests on — signals, evidence, policy"],
  "branches": [
    { "outcome": "…", "leadsTo": "next step id / workflow / exit", "automatable": true|false }
  ],
  "owner": "the role that judges (not the actor who executes)"
}
```

- `branches` is what makes a decision designable — each outcome names where the flow goes and
  whether that branch could be automated. This is also the natural home for the **exception
  paths** that `failureModes` currently flattens into labels.
- `owner` separates *who judges* from *who acts*; they differ at exactly the seams that matter.
- Pairs with F-A: a step with a `decision` is by definition not `agent-executed` without a
  human-in-the-loop — the two fields cross-check.

**Cost.**
- *Generator:* extend the atlas contract; prompt the generator to emit `decision` only where the
  action implies a judgment (over-emitting decisions on CRUD steps is the failure mode to guard).
  Gated pass.
- *Existing artifacts:* optional field → absent is valid (a step with no judgment has none). No
  backfill needed; operators add decisions during Listen. Low.
- *Readers:* the swimlane marks decision steps distinctly and reveals branches on interaction;
  the inspector edits them; Architect designs the HITL points from them. Client-verifiable.

---

## F-C · Corrections to one artifact aren't checked against the other

**Defect.** An operator override **removed `Pricing Item` and `User` from the ontology** while
atlas steps still reference them (`Commercial Structuring` uses Pricing Item; `Sales-to-Delivery
Handoff` and `Staffing` use User). **Nothing detected the incoherence** — the correction to one
artifact silently broke the other. More broadly, the Laila atlas references **9 entities the
ontology does not hold**, none flagged. This is precisely what the spine's **UnresolvedReference**
and the Design Loop's **semantic-conflict detection** are meant to catch; today it is silent.

**Proposed addition** (a check, not a stored field — it derives from the two artifacts):

```jsonc
// A cross-artifact coherence pass, run after any ontology OR atlas edit/regeneration.
// Emits into the atlas's existing gaps channel (and/or a decisionQueue item) rather than
// a new store:
{
  "kind": "unresolved-reference",
  "from": { "artifact": "current-state-atlas", "workflow": "…", "step": 2, "actor": "Finance" },
  "reference": "Pricing Item",
  "to": "domain-ontology",
  "detail": "step references an entity the ontology does not define",
  "sinceOverride": "Entity removed: Pricing Item"   // when derivable from the override log
}
```

- Runs on the **client** (both artifacts are in the blob) — the cheapest, gate-free layer: it
  needs no generator and no migration. The removal-that-orphans case is detectable directly by
  cross-referencing the override log against current step references.
- Surfaces **in place** on the diagram (the highest-value gaps are worth seeing while looking at
  the step) and as a coherence item so it isn't only in a document.
- The inverse (ontology entities no workflow touches — 7 in Laila) is the same pass, other
  direction: "orphan entity — missing process or unnecessary?"

**Cost.**
- *Generator:* **none** — this is a client-side derivation over stored artifacts. No gated pass.
- *Existing artifacts:* none — it reads what exists.
- *Readers:* a coherence selector (`atlas steps ↔ ontology entities`, both directions) plus its
  surfacing in the swimlane and a gaps/decision channel. Fully client-verifiable. **This is the
  one of the three that can ship without the gate** — and the multi-area swimlane already renders
  its output (coherence-gap marks on steps).

---

## F-D · The ontology schema discards the signals that would make generation deterministic

**Defect.** The ontology records *less* than it knows, and the gaps fall exactly where prototype
generation needs determinism. Measured on Laila's live ontology (33 entities, 35 relations, 178
attributes):

- **Entity attributes have no type field** — all **178** are bare untyped strings (`"amount"`,
  `"closeDate"`, `"stage"`, `"annualRevenue"`). There is nowhere to record that `amount` is money.
- **Relations have no optionality field** — **absent on all 35**. Cardinality is present (`1:N` etc.)
  but not whether a child *requires* its parent.
- **`standardAlignment` is entity-level** (`Account → schema.org/Organization`, `skos:closeMatch`),
  **not per-attribute** — it aligns the entity, not `amount → FIBO MonetaryAmount`.

**Consequence** (see `semantic-roles.md`): structural semantic roles derive at **100%** from
cardinality; value roles at **0%**. Every value role is a name-heuristic or a model call — not
because the information is unknowable, but because the ontology *has nowhere to put it*. This is the
schema-shaped root cause under F-A/F-B (which add step fields) generalised to the ontology: the
artifact discards what it already knows.

**Proposed schema additions.**

```jsonc
// ontology.entity.attributes[] — today a string[]; make each an object:
{ "name": "amount", "type": "monetary" | "date" | "quantity" | "code" | "text" | "boolean",
  "typeConfidence": "asserted" | "generated",   // generator may propose; stakeholder confirms
  "standard": "https://spec.edmcouncil.org/fibo/…"   // optional per-attribute code, where known
}

// ontology.relations[] — add:
{ "optionality": { "childRequiresParent": true|false, "parentRequiresChild": true|false },
  "optionalityConfidence": "asserted" | "assumed" }
```

**Cost — and the remediation split (this is the point).** The 213 missing signals are *not* one
homogeneous "capture in Listen" cost. They split three ways:

- **~178 attribute types → a schema + generator-prompt fix. Gated, small. NOT a Listen ask.** They
  are untyped because there is no field, not because nobody was asked. The generator would emit
  `amount: monetary` today if there were somewhere to put it. Stakeholders answer this *badly*
  anyway — nobody says "that attribute is of type monetary"; they say "that's a dollar figure". So
  the generator proposes the type (high accuracy from the name) and it is confirmed in passing, not
  interviewed.
- **~35 optionalities → a genuine Listen ask.** Required-vs-optional is a business rule only a
  domain owner can state. **One question per relation**, distributed to the sessions that own those
  relations — not a bulk survey.
- **Per-attribute standard alignment → mixed.** A generator can *propose* the FIBO/FHIR code; only
  domain work *confirms* it.

So the honest cost is **one gated schema change + one generator-prompt change + one question per
relation** — not "213 things need stakeholder time." Generator/edge portions are gated (no Deno
verification here); the reader side (consuming `type`/`optionality` when present) is client-buildable
and composes with the `deriveRoles()` contract in `semantic-roles.md`.

---

### F-D related · Baseline vocabulary seeding *(client floor built; generator consumption gated)*

The unresolved-reference census (`ontology-gap-census.md`) refutes the "recurring residue" cost
model — of 49 distinct residue names, **1 recurs across engagements** and **0 are systems-slot
errors**. So the residue is per-engagement domain work, *except* a small generic-noun slice. A
precise **baseline vocabulary** (`src/v3/lib/baselineVocabulary.ts` — Document, User, Task, Note,
Report, Organization, Person, Notification, AuditEvent, Role, Team, Address, Tag, with definitions)
is built and tested client-side; it binds ~6 of 49 residue names cleanly (~12%) and deliberately does
**not** over-bind domain composites (exact/alias match only).

**Proposed generator change (gated — specify, do not make):** the `domain-ontology` prompt in
`supabase/functions/run-agent/index.ts` should be seeded with these baseline concepts as
"include if the domain uses them" candidates (not forced), so a generic `Document`/`User`/`Report`
referenced by a step resolves instead of becoming residue. **Cost:** prompt-only, no schema field;
gated (no Deno verification). **Do NOT** add per-vertical terms (FNOL, Physician, Candidate) — those
are real domain gaps for Listen, not a universal baseline.

---

## F-E · The prototype generator doesn't emit the house design system

**Defect.** Generated prototypes have no governed appearance. The Prototype Build is one
self-contained HTML document the edge generator authors, and `experienceDesign.theme` has **no
default** (`?? {}`) — so colour, type, and component styling are whatever the model improvises per
run, inconsistent across engagements and runs. A reusable design system now exists
(**Meridian** — `supabase/functions/_shared/prototypeDesignSystem.ts`, documented in
`docs/aura/prototype-design-system.md`), extracted from a coherent reference app and made
engagement-neutral, but the generator does not use it.

**Client-side (done, not gated).** `resolveTheme()` makes Meridian the token floor, and every
export now ships `meridian.css` (the appearance layer) plus a complete `design-tokens.json` — so a
coding agent handed the export can apply the house system. Verified by rendering
`public/prototype-design-system.html` in the preview against the source app.

**SUPERSEDED for the stakeholder-facing artefact (2026-08-10).** The route taken was not
"teach the generator to emit `.m-*`" but "stop serving the generator's HTML to stakeholders."
`flow-portal` now builds the linked prototype with `_shared/prototypePilot.ts` →
`assemblePrototype`, which emits Meridian markup by construction from the ontology + atlas — so
the client's prototype is `.m-*`-styled with zero prompt change and zero model tokens for
structure. The generator's own output survives as the operator-side refine loop only. The
proposal below stays on record because it is still the answer *if* the model path is ever
re-pointed at a stakeholder; it is no longer on the critical path. (Deploy-gated: true of the
code, not of production, until `flow-portal` is redeployed.)

**Proposed generator change (gated — specify, do not make):** the prototype-build prompt in
`supabase/functions/run-agent/index.ts` should instruct the model to (a) link/inline
`meridian.css` as the base sheet, (b) build screens from the `.m-*` component classes (shell, nav,
page header, card, form, table, tabs, pill/badge, empty/toast) rather than bespoke markup, and
(c) put only screen-specific layout in the prototype's own `styles.css`. The two-pass craft step
then refines *within* the system instead of reinventing it.

**Cost.**
- *Generator:* prompt + output-contract change; no schema field. **Gated** — no Deno/executable
  verification here, and prompt changes need a real generation to validate.
- *Existing artifacts:* none forced — the client wire-in already dresses exports; regeneration
  picks up the house markup once the prompt lands.
- *Readers:* none — the in-app preview renders whatever HTML the generator emits.

---

## F-F · Attributes have no value set, so lifecycle stages cannot be captured

**Defect.** An attribute like `Opportunity.stage` *is* an enum — its meaning is its permitted values,
in order: **Prospecting → Qualification → Proposal → Closed Won**. The schema has nowhere to record
that. Attributes are untyped strings (F-D) with **no `values` / `enum` / value-set field at all**, so
there is no place to say `stage` is an enum, let alone list its members or their order.

Measured on Laila's ontology (178 attributes): **33 are enum-shaped by name** — `stage`, `status`,
`type`, `tier`, `category`, `severity`, `healthRag`, `rag`, `projection_status`, … spanning 24 of 33
entities (`Opportunity.stage`, `Lead.status`, `Quote.status`, `Contract.status`, `Engagement.healthRag`,
`Escalation.severity`, `Delivery Health.rag`, and 26 more). Every one has a value set a stakeholder
carries in their head and the artifact cannot hold.

**Why this is stronger than F-D's typing case.** F-D argues attribute *types* are discarded — but a
type is usually *inferable* (the generator reads `amount` and proposes `monetary` with high accuracy;
the stakeholder confirms in passing). **A stage set is never inferable.** No amount of name-reading
tells you a CRM's opportunity stages are Prospecting/Qualification/Proposal/Closed-Won rather than
Discover/Scope/Negotiate/Won, or that "Closed Lost" is a terminal state that stage can reach but not
leave. Only the domain owner knows. So where F-D is *mostly a schema+generator fix with one Listen
ask*, F-F is *a schema fix whose value is realisable only through a stakeholder answer* — the enum
field is inert until Listen fills it. This makes stage sets the highest-value Listen question in the
build (see the lifecycle-axis Listen questions in `docs/laila/listen-gap-list.md`): exact, uncontested,
and recitable.

**The consequence is already demonstrated.** The assembled prototype (`prototypeAssembly.ts`, item H
of the 2026-08-07 session) rendered `Opportunity.stage` as the **record title** — because with no type
and no value set, the role deriver fell back to "first attribute = title." A `stage` that the UI
should draw as an ordered pipeline chip instead became the screen heading. Nothing said otherwise, so
the heuristic won. That misrender is F-F made visible on a populated screen.

**Proposed schema addition (record, do not implement — gated).**

```jsonc
// ontology.entity.attributes[] — extend the F-D attribute object:
{ "name": "stage", "type": "code",
  "valueSet": {
    "kind": "enum" | "open",                       // open = free vocabulary, no fixed members
    "values": ["Prospecting","Qualification","Proposal","Closed Won"],   // in lifecycle order
    "terminal": ["Closed Won","Closed Lost"],        // states a record can enter but not leave
    "confidence": "asserted"                         // enum members are ALWAYS a stakeholder assertion
  }
}
```

**Cost.** Schema field + reader (render an enum as a pipeline/chip, not a title): client-buildable, and
composes with `deriveRoles()` (a `status`/`stage` role with a value set becomes an ordered control).
The **members themselves are a Listen ask** — one question per enum-shaped attribute on a lifecycle
entity, distributed to the session that owns the entity. Generator/edge portions gated (no Deno here).
- *Readers:* `semanticRoles.ts` (would consume the value set once present), the prototype assembler
  (would render an enum control instead of guessing), `journeyGraph.ts` (a `stage` value set is the
  *within-entity* lifecycle, complementary to the cross-entity journey it derives from relations).

---

## F-G · Workflows have no phase assignment

**Defect.** A Current-State Atlas workflow has `area`, `name`, `owner`, `trigger`, `steps`, `handoffs`,
`failureModes` — but **no lifecycle-phase field**. The atlas's vertical ordering reads as a lifecycle
to a human (Signal Generation, then Qualification, then Forecasting) but to the system it is **array
position**: nothing declares a phase, and reordering the array silently reorders the "lifecycle."

The two-dimensional atlas grid (item 2, `AtlasLifecycleGrid.tsx`) therefore **derives** each workflow's
phase from the entities its steps touch — a workflow referencing `Opportunity` sits at the Opportunity
phase — and marks every placement `derived`. That works and is honest, but it is a derivation standing
in for a missing field: it re-computes on every render, cannot be corrected by a stakeholder, and
inherits the ambiguity of the `produces` graph (a workflow touching entities across three phases is
placed by a frequency heuristic, not by anyone's statement).

**Proposed schema addition (record, do not implement — gated).**

```jsonc
// atlas.workflows[] — add:
{ "phase": "Qualification",                 // the lifecycle stage this workflow advances
  "phaseConfidence": "asserted" | "derived" // derived = Aura's entity-based guess until confirmed
}
```

**Cost and what it buys.** One optional string field on the workflow object. Cheap to add, but it is
**a stored-artifact change → gated** (this session must not write a phase field into the atlas). Once
present: the grid stops guessing (reads `phase` when asserted, falls to the derivation only when
absent); the vertical axis becomes correctable by the operator/stakeholder rather than recomputed; and
phase gains provenance (`derived` vs `asserted`) exactly as F-D/F-F do for attributes. Until then the
derived axis is the honest interim — a view, not a fact.
- *Readers:* `AtlasLifecycleGrid.tsx` (would prefer an asserted `phase` over the derivation);
  `journeyGraph.placeWorkflows()` (its output becomes the *fallback*, not the only source).

---

## Absorbed by the claims ledger (2026-08-08)

> **F-A through F-G are no longer seven separate schema patches.** The claims-ledger structure
> (`ledger-spec.md`) absorbs them: each becomes a **slot in a Tier-3 shape**, born `?unknown`, rather
> than a bespoke field. See `ledger-generation-contract.md` for the mapping. What changed for each:

| Finding | Re-expressed as | Status |
|---|---|---|
| **F-A** automation boundary | `decision`/`lifecycle` shape → `step#automationDisposition` (born unknown) | absorbed; consumed by the unknown queue (blocking) |
| **F-B** decision points | `decision` shape → `step#decision{condition,authority,outcomes}` | absorbed; born unknown |
| **F-C** cross-artifact coherence | falls out of the ledger — an unresolvable step→entity ref is an `unresolved-ref` claim; a contradiction is a live pair | absorbed; **built** (deviation register + contradictions on migrated Laila) |
| **F-D** attribute types / optionality | base attribute `#dataType`, relation `#optionality` (generator proposes, born weak/unknown) | absorbed; migration emits these as open unknowns |
| **F-E** design system | out of the claims schema — an appearance concern | not a claim (unchanged; still the gated edge markup) |
| **F-F** attribute value set | `lifecycle` shape → `attr#valueSet{members,terminal}` (born unknown) | absorbed; **an import CLOSES it** (Salesforce picklist / FHIR binding, built) |
| **F-G** workflow phase | `lifecycle` shape → `workflow#phase` (born unknown; grid derives until asserted) | absorbed; migration emits `#phase` open |

**Gated remainder** (specified, not built): the **generator** emitting claims-with-unknowns and its
validation (`ledger-generation-contract.md`) — edge/Deno; the **shape declarations in Frame** as a
runtime step; **persistence** of the ledger (the store is storage-agnostic; a Supabase adapter is the
gated piece). The client side — store, projections, queue, deviation register, import transforms — is
built and tested.

## Priority

| Finding | Blocks Architect? | Needs the gate? | Cheapest first move |
|---|---|---|---|
| **F-A** automation boundary | **Yes, every workflow** | Generator does; reader-default + editor does not | Reader-default `human-only/generated` + step-inspector editor (client) |
| **F-B** decision points | Yes for judgment steps | Generator does; optional field means readers don't | Optional field + inspector editor (client) |
| **F-C** cross-artifact coherence | Yes (silent incoherence) | **No** — pure client derivation | Client coherence pass + in-diagram marks (already surfaced by the multi-area swimlane) |
| **F-D** ontology discards types/optionality | Indirectly (keeps generation generative) | Schema + generator do; readers don't | Attribute-`type` + relation-`optionality` fields; generator proposes types, Listen confirms optionality |
| **F-E** generator ignores the design system | No (appearance) | Generator does; client export does not | `meridian.css` in every export (done); the stakeholder's prototype is now the Meridian **assembly**, not the generator's HTML (done, deploy-gated); generator emits `.m-*` markup (gated, no longer on the critical path) |
| **F-F** attributes have no value set | Yes (stage sets unrenderable) | Schema does; **members are a Listen ask** | `valueSet` field + enum-as-pipeline reader (client); ordered members captured in Listen |
| **F-G** workflows have no phase | Yes (vertical axis has no field) | Schema does; grid derives now | Optional `phase` field (gated write); grid reads asserted, falls to the derivation |

F-A and F-B are one gated generator pass together (both extend the step contract). F-D is the same
class one level up (the ontology contract), and pairs naturally with them — one gated schema pass
adds step fields (F-A/B) and the attribute-`type` + relation-`optionality` fields (F-D) together;
optionality is the only part that needs a Listen question. F-C and the client side of F-E ship now,
gate-free. F-E's generator markup is the last gated piece.

**F-F and F-G are the lifecycle axis's two schema gaps, and they sit in this same gated pass.** F-F
(attribute value sets) is F-D's argument sharpened: a type is inferable, a stage set never is, so its
enum members are the highest-value Listen ask — the schema field is gated, the members are captured in
Listen once the field lands. F-G (workflow phase) is why the two-dimensional atlas grid must *derive*
its vertical axis: the artifact cannot hold a phase, so the grid computes one and marks it derived. The
field itself is a one-line stored-artifact change — gated, because writing a phase into the atlas is
exactly the schema change this pass defers. Neither is implemented here; both are recorded so the gated
pass takes them together with F-A/F-B/F-D.
