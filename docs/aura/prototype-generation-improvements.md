# Prototype generation — implementation brief

A self-contained prompt for the engineer or agent taking this work. Everything
needed to start is below: the architecture, the invariants, the evidence behind
each item, and the acceptance test that says it is done.

---

## 0. Mission

Aura assembles a working prototype from a client's **domain ontology** and
**current-state atlas**, with no human drawing screens. Two paths exist today:

- **Assembled** (`supabase/functions/_shared/prototypeAssembly.ts`) —
  deterministic. Ontology → graph → fabric → HTML. No model call. High
  structural fidelity, low interactivity.
- **Refined** (`prototype-build` agent in `supabase/functions/run-agent/index.ts`) —
  an LLM writes the HTML free-form from the ontology plus operator direction.
  Presentationally strong, structurally unreliable.

**The thesis of this brief:** the two paths have complementary failures. The
assembled path is *all structure, no story* — correct, complete, navigable, and
every screen demos its own emptiest case. The refined path is *all story, no
structure* — persuasive dashboards that contradict themselves, silently drop
entities, and cannot drill down. **The target is the assembled skeleton wearing
the refined skin.** Every item below moves toward that.

---

## 1. How to work

### The gate

```bash
npm run validate
```

Typecheck + lint + build + test, and the single definition of "green". CI runs
exactly this. Baseline at the time of writing: **186 files, 2804 tests passing**.
Never report an item complete on a partial run.

Node is not on the default PATH in this environment:

```bash
export PATH="$HOME/tools/node/bin:$PATH"
```

### Deploying the edge function

The assembler is shared code imported by the `run-agent` edge function, so any
change to `_shared/*` requires a deploy before it is observable on the board:

```bash
npx --no-install supabase functions deploy run-agent --project-ref vudqrrqpipnkxzxslbim
```

### Guard discipline

Every item below ships with a test. The rules that have been broken before, in
this exact area:

1. **Assert the property, not the address.** A guard pinned to a variable name,
   a line number, or a comment string passes while the behaviour rots. Pin what
   must be *true* of the output.
2. **Mutation-test every guard.** Revert the line the guard protects, confirm
   the test goes RED, restore. A guard never seen red is not known to work.
3. **Verify against the rendered DOM, not a regex over the source.** Two false
   readings happened during the review that produced this brief: a regex matched
   the words "stat row" in prose and reported a feature present; another looked
   for `class="` in HTML that uses single quotes and reported it absent. Load the
   build in a browser and query it.
4. **A miss stays visible.** Where the generator cannot honour something in the
   ontology, it must say so — in `gaps`, in `warnings`, or in `assumptions` —
   never render as if the question never arose.

### Invariants that must not break

- **Determinism.** `deriveFabric` and `generateSeed` take no clock and no RNG;
  the seed is driven by the fabric `version` hash. The same ontology must yield a
  byte-identical fabric and the same seed. `fabricVersion()` equality is the
  test.
- **Region identity is `sourceSlug + role`, never positional.** `data-fabric-id`
  is the contract that lets `diffFabric` (`src/v3/lib/fabricDelta.ts:34`) resolve
  a delta to the regions it touches. Do not key anything by array index.
- **Separation of the four concerns.** `fabric.ts` (structure) imports no design
  tokens; `prototypeDesignSystem.ts` (appearance) imports no ontology;
  `seedData.ts` (content) imports neither. `prototypeAssembly.ts` is the ONE
  place they meet. Keep it that way.
- **`_shared/*` stays generically named.** A guard in
  `src/v3/__tests__/pipelineValidation.test.ts` (G3) fails the build if any
  `_shared` source mentions a client name — including in a comment. Write
  "a reviewed CRM build", not the client's name.
- **The claims-ledger core is frozen.** `src/v3/lib/ledger/{store,types,precedence,projections}.ts`
  are out of scope. A change that appears to require one is a FINDING to raise,
  not an edit to make.
- **Read-only on real data.** Mutations against scratch copies only. Do not
  author design decisions (e.g. which entities get screens) on a live client
  programme — that is the operator's call.

### Already done — do not redo

Two items from the review are implemented and deployed:

- **Nav curation.** The operator's `parentEntities` choice now drives the
  sidebar, not just the screens. Guard: `src/v3/__tests__/prototypeNavCuration.test.ts`.
- **Showcase record.** Detail pages render the record with the most children
  rather than `rows[0]`, which the seeder deliberately makes the zero-child
  extreme. Guard: `src/v3/__tests__/prototypeShowcaseRecord.test.ts`.

---

## 2. Architecture orientation

Read these before starting. They are small and they are the whole system.

| File | Lines | What it owns |
|---|---|---|
| `_shared/ontologyGraph.ts` | ~298 | Relations → graph. Fan-in, spine, roots, `primaryParent`, `treeChildren`, edges vs junctions. |
| `_shared/semanticRoles.ts` | — | Attribute → `ValueRole`; cardinality → `RelationshipRole`. |
| `_shared/fabric.ts` | ~146 | Graph + roles → fabric nodes (`screen`/`region`/`field`/`nav`/`flow`), each with a stable id and hash. |
| `_shared/seedData.ts` | — | Ontology + fabric version → synthetic records, plus a declared `assumptions` list. |
| `_shared/prototypeDesignSystem.ts` | — | The Meridian stylesheet. Tokenised (`--brand`, `--accent`, …). |
| `_shared/prototypeAssembly.ts` | ~285 | The join. Screens, nav, HTML. |
| `src/v3/lib/fabricDelta.ts` | — | `diffFabric` — what changed between two fabrics. |
| `src/v3/components/flow/studio/ExperienceDesignStudio.tsx` | — | The operator's one authored input: `parentEntities`. |

### The cardinality contract — read this before Track A

`relationshipRolesFor` (`_shared/semanticRoles.ts:159`) already makes the
distinction the prototype fails to honour:

| Ontology cardinality | `RelationshipRole` | Fabric node created on the parent's detail |
|---|---|---|
| `1:N`, or unknown (default) | `collection` | `region:{parent}:{child}` |
| `N:M` / `M:N` / `*:*` | `multi-select` | `region:{parent}:{child}` (via `graph.junctions`) |
| `N:1` | `parent-ref` | `nav:{child}:{parent}` |
| `1:1` | `parent-ref` | `nav:{child}:{parent}` |

`deriveOntologyGraph` normalises direction first (`_shared/ontologyGraph.ts:151-163`):
an `N:1` written child-first is flipped so `parentToChild` is always read from
the parent's side. `N:M` pairs never become edges — they go to `graph.junctions`.

**The fabric is correct. The assembler ignores it.** Verified by grep against
`prototypeAssembly.ts`:

- occurrences of `kind === "nav"` → **0**
- occurrences of `.role` → **0**

Every child region is selected by id prefix and rendered identically.

---

## Track A — Ontology fidelity

The highest-value track. The prototype's whole claim is that it is derived from
the ontology; these are the places where it is not.

### A1 · Render child regions by ROLE, not by id prefix

**Problem.** `prototypeAssembly.ts:180` selects child regions with
`n.id.startsWith("region:" + s + ":")` and renders every one as a `<dl>` of up to
five `id` / display-name pairs. A `1:M` collection, an `N:M` multi-select, and
(where one exists) any other relation all look identical, and none looks like a
**list of the child entity**.

**Evidence.** On the reviewed CRM build, Account's detail showed
`Opportunity` as five lines reading `opportunity-0001 / Northwind Opportunity 1`
— an id-and-name pair list, not the child's own columns.

**Change.** Switch on `node.role`:

- **`collection` → a real list.** The child's own lead columns, chosen by the
  same rule `listScreen` uses (title attribute first, else `_display`), rendered
  as a compact `<table>`; a count badge; a "View all N →" control that navigates
  to the child's list screen. Cap at 3–5 rows inline.
- **`multi-select` → chips.** A wrapped row of `m-chip` tags, which is what a
  many-to-many looks like. (Content depends on **A3**; until then it renders the
  declared-empty state from A5/C3, not a silent blank.)
- **`parent-ref` → a link card.** See **A2**.

Reuse the column-selection logic rather than duplicating it — extract it from
`listScreen` into a shared `leadColumnsFor(name)` helper.

**Acceptance.** For every fabric node with `role: "collection"`, the element
carrying that `data-fabric-id` contains a `<table>` whose header row matches the
child entity's lead columns. For `role: "multi-select"`, it contains chips.

**Guard.** `prototypeRelationRoles.test.ts` — walk `fabric.nodes`, assert the
rendered contract per role. Mutation: revert to prefix-selection → RED.

**Size.** Half a day. **Depends on:** nothing. **Do this first.**

### A2 · Render the `nav` nodes — an N:1 must produce a link

**Problem.** `deriveFabric` creates `nav:{child}:{parent}` nodes with
`role: "parent-ref"` (`_shared/fabric.ts:124`). The assembler never reads
`kind === "nav"` (0 occurrences). An N:1 reference therefore produces **no link**
on the detail page; the only trace is a styled chip if a matching attribute
happens to exist.

**Change.** On each detail screen, render every `nav:` node as a compact link
card — eyebrow = parent entity, value = the parent record's display name,
navigating to the parent's detail screen. Wrap it in `region()` so it carries its
`data-fabric-id` like everything else.

**Acceptance.** Every `nav:` node in the fabric has a corresponding element in
the HTML that navigates to `detail-{parentSlug}`.

**Guard.** Extend `prototypeRelationRoles.test.ts`: `nav` node count ==
rendered parent-link count.

**Size.** 2 hours. **Depends on:** A1 (shares the role switch).

### A3 · Materialise junction membership in the seed

**Problem.** `generateSeed` writes FK values only for graph **edges**
(`_shared/seedData.ts:197`). For junctions it pushes an assumption reading
`"skipped (no junction generated)"` (`:125-126`) — honest, and still means every
`multi-select` region is permanently empty.

**Change.** Emit deterministic membership pairs for each `graph.junction`
(e.g. `records["_junction:{a}:{b}"]` of `{aId, bId}`), driven by the same
fabric-version-seeded RNG. Update the assumption text to describe what *was*
generated. Then the `multi-select` renderer from A1 has content.

**Acceptance.** For a fixture with an `N:M` relation, the parent's detail shows
chips naming real child records, and `fabricVersion` is unchanged (the fabric
does not move; only the seed gains rows).

**Guard.** Determinism: two `generateSeed` calls on the same ontology produce
identical junction rows. Plus a rendering assertion.

**Size.** Half a day. **Depends on:** A1.

### A4 · Make the join key relation-derived, not string-guessed

**Problem.** `prototypeAssembly.ts:186` finds a record's children with
`c[name.toLowerCase() + "Id"]`. This reconstructs a convention instead of reading
the relation. It breaks on multi-word entities, on any seeder change to FK
naming, and has no meaning at all for junctions.

**Change.** Carry the join key on the fabric region (preferred — it is the
structural intermediate), or resolve it from `graph.edges` for the pair. One
definition, used by both the seeder and the assembler.

**Acceptance.** A fixture with a multi-word entity name (e.g. `Alliance Partner`)
renders its children correctly.

**Guard.** The multi-word fixture case. Mutation: restore the string-built key →
RED.

**Size.** 3 hours. **Depends on:** A1, and pairs naturally with A3.

### A5 · A fabric→DOM fidelity guard

**Problem.** Nothing asserts that the rendered HTML honours the fabric. That is
how three separate drops (role ignored, navs unrendered, junctions empty) all
shipped unnoticed.

**Change.** One guard that walks every fabric node and asserts its rendering
contract by kind and role — `screen` → a `.m-screen`; `region` → an element with
that `data-fabric-id`; `field` → a labelled control on the form; `nav` → a link.
Where a node legitimately has no rendering, it must be listed in an explicit
allow-list with a reason, so a future silent drop fails the build.

**Acceptance.** The guard passes on the Laila snapshot fixture and on a small
synthetic fixture, and fails when any single renderer is disabled.

**Size.** Half a day. **Depends on:** A1, A2. **This is the item that keeps the
rest honest — do not skip it.**

### A6 · Cap child sections with a "+N more" expander

**Problem.** Opportunity's detail carries **13** child sections on the reviewed
build. Past roughly five, the page is a wall and the important relation is lost
in it.

**Change.** Order child sections by subtree size (already on the graph node),
render the top 5, collapse the rest behind "+8 more related". Never drop —
collapse.

**Acceptance.** No detail screen renders more than 5 expanded child sections;
the collapsed ones remain present in the DOM and in the fabric-fidelity guard
(A5).

**Size.** 2 hours. **Depends on:** A1.

### A7 · Let business primacy pick the tree root

**Problem.** The "All records" tree files each entity under its `primaryParent`
= shallowest parent (`_shared/ontologyGraph.ts:216-226`). On the reviewed CRM
that files **Account under Partner** — defensible graph-theoretically, backwards
to any CRM user. Fan-in already identifies Account as the centre; only the root
choice ignores it.

**Change.** When an entity's fan-in materially exceeds its structural parent's,
promote it to a root. Keep it a *rule*, not a hardcoded list — the spine is
already correctly generic (a three-entity ontology has a three-entity spine), and
must stay so.

**Acceptance.** On the snapshot fixture, Account is a root. On a fixture where
the hierarchy genuinely is deep, nothing is promoted spuriously.

**Guard.** Both fixture cases. This one deserves care: a rule that promotes
everything is as wrong as one that promotes nothing.

**Size.** Half a day. **Depends on:** nothing. Note this only affects the
uncurated path (a curated menu is flat).

---

## Track B — Interaction honesty

The assembled prototype implies state it does not have. **B1 is the multiplier:
it makes B2–B5 nearly free.** Consider doing B1 before Track A's tail.

### B1 · Ship the seed as data; render screens client-side

**Problem.** Every screen is pre-baked HTML — 99 screens, 481 KB on the
uncurated snapshot build — and every control implying state is inert.

**Change.** Embed `seed.records` as JSON plus a small (~200-line) renderer.
Keep `data-fabric-id` on rendered regions — the delta contract must survive.
Payload shrinks (data + templates ≪ 99 baked screens) and the following become
straightforward rather than special cases.

**Acceptance.** Byte-identical output for identical input (determinism holds);
`data-fabric-id` coverage unchanged; A5's guard still passes.

**Size.** 1–2 days. **Depends on:** ideally after A1–A5 so the renderer is
written once, against role-correct structure.

### B2 · Row-level Open, and hash routing

**Problem.** "Open" on row 12 shows row 1's detail — there is one static detail
per entity. The button promises navigation it does not have.

**Change.** With B1, render the clicked record. Add hash routing
(`#account/account-0002`) so a demo moment is linkable and Back works.

**Acceptance.** Opening row *n* shows row *n*; deep link restores that view.

**Size.** 3 hours after B1 (do not attempt before it).

### B3 · Honest controls

**Problem.** 165 dead buttons on the uncurated build: Filter, Prev, Next,
Delete, Save. Save does not even return to the list.

**Change.** With B1, make them work in-memory: Filter filters, Prev/Next page,
Save appends a visible row and returns to the list, Delete removes with undo.
Any control that still cannot work must be **removed**, not rendered inert.

**Acceptance.** Zero buttons in the output without a handler.

**Guard.** Count `<button>` elements lacking an `onclick`; assert 0.

**Size.** Half a day after B1.

### B4 · FK form fields as pickers

**Problem.** "New Partner" renders `Account` as a free-text input. The one place
the ontology's relations should constrain input, they do not.

**Change.** Any field whose role is `parent-ref` / `cross-ref` renders a
`<select>` populated with the parent entity's display names.

**Acceptance.** No relation-typed field renders as `<input type=text>`.

**Size.** 2 hours. **Depends on:** A4 (needs the relation-derived key).

### B5 · Status attributes → an optional board view

**Problem.** The refined path's dashboards are evidence of real demand for
pipeline-style views; it fabricated them. The roles already identify `status`
fields.

**Change.** Any entity with a `status` attribute offers a board/table toggle on
its list screen, grouped by status value. Fully derived, no model call.

**Acceptance.** Entities with a status render the toggle; entities without do
not (empty-state rule: no zero-value affordances).

**Size.** Half a day after B1.

---

## Track C — Content credibility

### C1 · A per-programme value vocabulary artifact

**Problem.** The seeder's category vocabulary is entity-blind. The reviewed build
renders `Region: Managed`, `Industry: Priority`, `Tier: Standard` — values
shuffled across fields because they come from one generic pool.

**Change.** One LLM call **per ontology change, not per build**, producing
`{ "Entity.attribute": ["plausible", "values"] }` as a stored, diffable artifact.
The deterministic seeder consumes it. Statuses become "Qualified / Proposal /
Closed-Won" where they belong; the build stays reproducible because the
vocabulary is an input, not a generation step.

**Acceptance.** With the artifact absent, output is exactly as today (graceful
fallback). With it present, values are field-appropriate and the build is still
byte-identical across runs.

**Size.** 1 day. **Depends on:** nothing.

### C2 · Lifecycle-coherent records

**Problem.** Dates and states are independently random: a record can close
before it was created, a Closed-Won opportunity can carry no value.

**Change.** In the seeder: `created < closed`; amounts consistent with stage;
owner names reused across a record's children.

**Acceptance.** A guard asserting no record violates its own lifecycle ordering.

**Size.** Half a day. **Depends on:** C1 helps but is not required.

### C3 · Empty states that teach

**Problem.** A legitimately empty child section reads "No X yet" — the weakest
possible screen state, and a wasted one.

**Change.** `generateSeed` already returns a declared `assumptions` list with
Listen questions attached (`_shared/seedData.ts:34,124`). Render it: *"No
Escalation yet — assumed 0–4 per Account; confirm in Listen."* This converts the
weakest state into evidence-gathering, which is the methodology's own pitch, and
satisfies "a miss stays visible".

**Acceptance.** Every empty region cites the assumption that produced it.

**Size.** 3 hours. **Depends on:** A1.

---

## Track D — The LLM path

### D1 · Refine restyles within regions; it never rewrites

**Problem.** Today `prototype-build` regenerates from scratch: no fabric, no
regions, no diffability, a fresh die-roll each time. A refine instruction asking
for detail-page breadcrumbs and related-entity tabs came back with the first half
applied and the second half correctly declined — *"no detail screens exist in the
current design"* — because the free-form path never built any.

**Change.** Assemble first. Hand the model the **assembled HTML** plus the
operator's direction, instructed to change presentation *inside* regions and
never to alter `data-fabric-id` structure, navigation, or seed values.

**Acceptance.** Fabric ids before == fabric ids after; seed values unchanged;
`docSectionDiff` produces a meaningful diff.

**Guard.** Assert id-set equality across a refine.

**Size.** 1 day. **This is the highest-leverage item in the brief** — it is what
makes "assembled skeleton, refined skin" real.

### D2 · The model emits a spec, not HTML

**Problem.** Free-form HTML is where the refined build's defects live: stat cards
floating over tables and hiding columns on every screen; a lead marked
"Qualified (BANT)" inside a table headed "Leads (Unqualified)"; three ontology
entities absent while `gaps` reported `[]`.

**Change.** The model emits a validated JSON **screen spec** (widgets, stats,
entity/attribute references, layout slots). A deterministic renderer produces the
HTML. The model contributes judgement — *this screen deserves a funnel chart* —
and the renderer guarantees no overlap, no dropped entity, no contradictory
label.

**Acceptance.** Spec validates against a schema derived from the ontology; an
invalid entity reference fails loudly rather than rendering.

**Size.** 2–3 days. **Depends on:** D1. The strategic item.

### D3 · A render-based QA gate

**Change.** Load the build headless and assert: no bounding-box overlap between
floating cards and tables; no console errors; every ontology entity either
present or declared in `gaps`; section headers agree with row contents. On
failure, retry once with the failures quoted back to the model.

**Acceptance.** The gate fails on the current refined build (all four checks have
a real offender in it) and passes after D1/D2.

**Size.** 1 day. **Depends on:** nothing — it can be built against today's output
and will immediately earn its keep.

---

## Track E — Operator control and polish

### E1 · Per-entity screen options in Experience Design

**Change.** Beside the existing parent-screen toggle: which columns lead the
list, which child collections appear on the detail, table vs board. Same pattern
as `parentEntities` — one authored input, everything else derived. Absent input
falls back to the derived default, exactly as `experienceParentEntities` does.

**Size.** 1 day. **Depends on:** A1, B5.

### E2 · Client brand tokens

**Change.** Meridian is already tokenised (`--brand`, `--accent`, …). Accept a
palette input on the programme and thread it through `meridianStylesheet()`.
Near-zero cost; every demo lands as *their* product.

**Size.** 2 hours.

### E3 · Persona workbenches derived from the atlas

**Change.** The atlas knows roles and their workflows. Derive one workbench per
major role — its entities, its statuses, its queue. Story screens with structural
truth underneath, which is what the refined path's 12 dashboards were reaching
for.

**Size.** 1–2 days. **Depends on:** B1.

### E4 · Surface the agentic blueprint in the prototype

**Change.** Blueprint and prototype are currently disconnected surfaces. Where an
agent touches an entity, show it: an agent-activity feed on the detail page; an
HITL approval queue as a screen for gated agents. `hitlPoints` — including
operator-attested decisions — is already structured data.

**Acceptance.** An agent named in the blueprint appears on the entity it acts on.

**Size.** 1–2 days. **Depends on:** B1. **The demo moment that sells *agentic*
CRM rather than CRM.**

---

## 3. Sequencing

**Milestone 1 — the prototype tells the ontology's truth.**
A1 → A2 → A5 → A4 → A3 → A6 → A7.
Ship A5 as soon as A1/A2 land; it protects everything after it.

**Milestone 2 — it behaves.**
B1 → B2, B3, B4, B5. Do not start B2–B5 before B1; each is cheap after it and
awkward before it.

**Milestone 3 — it is credible and it is repeatable.**
C1 → C2 → C3, and D1 in parallel (D1 depends on Milestone 1, not on Track B).

**Milestone 4 — judgement with guarantees.**
D3 (can start any time), then D2. Then Track E.

If only three items are ever done: **A1, A5, D1.**

---

## 4. Definition of done, per item

1. `npm run validate` green — full run, no partial reporting.
2. A guard that asserts the property, mutation-tested to RED and restored.
3. Verified in a browser against rendered DOM, not by grepping source.
4. `run-agent` deployed if `_shared/*` changed.
5. Any ontology fact the generator cannot honour is declared in `gaps` /
   `warnings` / `assumptions`, never silently absent.
6. Determinism preserved: same ontology → same `fabricVersion`, same seed.

## 5. Out of scope

- The frozen claims-ledger core (raise a finding instead).
- Authoring design decisions on live client programmes.
- `run-agent`'s existing 273 type errors and ~50 unguarded `supabase` call sites
  (tracked separately in `HANDOFF.md` §10 and §12).
