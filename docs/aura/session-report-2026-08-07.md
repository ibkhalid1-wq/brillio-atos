# Aura — autonomous session report (2026-08-07)

Branch `reimagined-ui`, repo `~/ATOS/brillio-atos`. All work client-side or docs; nothing touched
the database, Deno, the edge, or the Step 1 gate. Read-only against engagement data throughout.

## Per-item: what I did, verified, and couldn't

| # | Item | Did | Verified | Couldn't |
|---|---|---|---|---|
| 1 | Listen gap list | Saved unabridged `docs/laila/listen-gap-list.md` with the OVERRIDE-CORRECTED = *touched, not confirmed* caveat prominent | Read-back | — |
| 2 | Artifact-schema findings | `docs/aura/artifact-schema-findings.md` F-A/F-B/F-C with schema + 3-layer cost | Read-back | — |
| 3 | Multi-area swimlane | `AtlasSeamView.tsx` renders any set of the 10 areas as one swimlane: crossings as connectors, coherence-gap marks, interactive findings; degrades to filter-by-workflow at 10 | Preview (1/3/10 areas), typecheck+lint, 1123 tests | Edit-mode not visually verifiable (atlas locked in the station view) |
| 4 | Refine swimlane | Compact tiles + hover/click-pinned detail popover; calmer palette (indigo+neutral, per-area hue → dot only); sleek area chips; workflow picker on top; removed redundant chrome; inline CRUD (steps + workflow fields + add/delete) | Preview read/pin, typecheck+lint+tests | Same lock caveat |
| 5 | Prototype design system | Extracted the reference app's language → **Meridian** (`prototypeDesignSystem.ts` + `docs/aura/prototype-design-system.md` + generated demo); every export now ships `meridian.css` + `design-tokens.json` | Rendered demo beside source app in preview; 4 DS tests | Generator emitting `.m-*` markup is gated (F-E) |
| 6 | Fabric | `docs/aura/fabric.md` — deterministic derivation, ontology-`source` refs, region identity, incremental delta, refinement preservation, measured tokens | Grounded on live artifact sizes | Implementation is a follow-on slice (spec only, as scoped) |
| 7 | Seed data | `docs/aura/seed-data.md` — ontology-derived, referentially consistent, synthetic+marked, incremental; concrete assumed-cardinalities/optionality list | Grounded on live ontology | Implementation is a follow-on slice |
| 8 | flowAreas comment gap | Extended `flowAreasLockstep.test.ts` to enforce `inferArea`/`labelTokens`/`labelsOverlap` byte-identity; narrowed the edge comment; I6 updated | Test runs green (5 tests) | — |
| 9 | The 200 cap | `FLOW_ATTESTATION_CAP` in `blobGuard.ts`; 23 `.slice(-200)` sites across 12 files switched | typecheck+lint+tests | — |
| 10 | AGENT_ID_ALIASES | **Finding, not fixed** — the client and edge maps share zero keys; a lockstep test would be wrong. Recorded as I7 | — | (correctly not implemented) |
| Semantic layer | Bridge vocabulary | `docs/aura/semantic-roles.md` — roles, ontology derivation, role→component map | Grounded on live ontology | — |

Screenshots captured live in the preview during verification (not embeddable in this markdown; the
states were confirmed on screen): swimlane at one area, three areas, and all ten; the Meridian demo
page (`localhost:5173/prototype-design-system.html`) beside the source app (`localhost:8080`). A
*populated* prototype view was not captured — seed generation is spec-only this session, so no
populated prototype was produced to screenshot; that is the honest gap against the screenshot ask.

## Design decisions made under "decide, don't ask"

- **Swimlane layout.** Rows = areas, per-workflow blocks stacked; step tiles placed by grid column,
  crossings drawn as elbow/flat SVG connectors. *Rejected:* one giant all-workflows grid (illegible
  at 46 steps). *Degrade at 10:* filter-to-one-workflow + the area chip multiselect, rather than
  shrinking tiles to nothing.
- **Tile content.** Compact face = number + one-line action + gap flag; everything else (actor,
  system, entities, evidence) on a hover/click-pinned popover. *Reasoning:* the reviewer's terse
  "move details into a hover" — a tile that carries five fields is a form, not a diagram node.
- **Palette.** Neutralised toward the Flow page: tiles/lanes/bands/path-chips neutral + single
  indigo accent; per-area hue survives only as a small dot. *Reasoning:* ten saturated area hues
  read as noise; identity needs a cue, not a fill.
- **Selection model.** `null = all` (tracks the data), empty Set = cleared — so All and Clear both
  act. *Fixed a real bug:* the prior "empty reads as all" made Clear a no-op.
- **Meridian name + scope.** Neutral, engagement-free; appearance-only (no ontology, no content);
  `.m-` class prefix; system-first fonts because a sandboxed export can't fetch a webfont. *Rejected:*
  reproducing the source's Outfit webfont (doesn't survive a self-contained export) and its
  engagement-specific forecast/family palettes (not neutral). *Resolved 8 source inconsistencies* by
  decision, not averaging (one green, one amber, sm/md/lg/pill radii, 4px spacing, one `.m-btn`).
- **Fabric shape + region identity.** Typed nodes with an ontology `source` ref + input `hash`;
  region id = `source-id + role` (`region:opportunity:quotes`), never positional — the same
  stable-id discipline this codebase has been bitten by (DrillAnchor/MovementStakeholder indices).
  *Refinement preservation:* detect + preserve + escalate a 3-way conflict; **auto-merge explicitly
  out of scope** (a free-form hand edit has no structured diff) — the honest partial answer.
- **Seed data volume/realism.** 24 root rows (paginate past 20); 0–5 fan-out *including both
  extremes* (a 0-child parent for the empty state, a max-child parent to paginate); planted edge
  cases (long name, null optional, boundary value, an orphan on an unresolved optionality) — because
  seed data is a *validation instrument*, designed to provoke correction, not decoration.
- **Semantic role vocabulary.** A closed set across identity/value/state/relationship/action.
  *Left out:* free-form roles — the map to Meridian must be total. *Key call:* value roles are a
  name **heuristic** (emitted with confidence), because the ontology has no attribute types to read —
  not pretended deterministic.
- **Inline editing.** Made the seam a complete inline editor (step CRUD + workflow-field panel +
  add/delete), gated on the studio being unlocked. *Deferred:* ripping out the separate
  WorkflowStudio editor + registers — a 700-line interconnected component; a half-removal risked
  regressions in parent gap-scoping (`onFocus`) and losing the atlas-wide registers with no inline
  home. Recorded as follow-on rather than done badly.

## Measurements (numbers, not impressions)

- **Atlas shape:** 14 workflows, 46 steps, 10 areas. **Ontology:** 33 entities, 35 relations, 178
  attributes.
- **Token comparison (fabric):** prototype HTML = **28,623 bytes ≈ 7,150 output tokens**,
  re-emitted whole every regeneration, on top of ontology (168 KB) + atlas (178 KB) input. A
  representative incremental change (one entity, ~3–4 of ~35 regions) ≈ **~800–1,000 output tokens**
  and structure → **0 tokens** if rendered deterministically. **~7–9× fewer output tokens**, larger
  input reduction. *Caveat:* the full-regen byte count is measured exactly; the incremental figure is
  modelled from region count, not measured against a real incremental run (no fabric implementation
  yet).
- **Semantic roles (derivable vs decided):** structural/relationship roles **35/35 = 100%**
  deterministic from cardinality. Value roles **0/178 type-derived** (name-heuristic only, ~70%
  confident). Entity title conventions ~20/33 from `standardAlignment`.
- **Seed-data assumptions forced:** **35 optionalities** (absent on every relation), **33 fan-outs**
  (all `1:N` unstated), **34 generic "produces" verbs**, **~7 orphan entities** seeded in isolation.
- **200-cap:** 23 literal sites → one constant.

## Findings discovered but not fixed (consolidated)

1. **Atlas quality (Laila): 13 declared hand-offs have no crossing in the steps, and 1 crossing has
   no declared hand-off.** The atlas encodes most seams in the `handoffs` field, not as step-actor
   changes — so the swimlane surfaces 5 step-crossings but 13 declared hand-offs the steps never
   realise. This is the "hand-offs missing where a crossing plainly exists" case, and it is an
   **atlas-generation quality defect**, not a UI problem. Belongs in `artifact-schema-findings.md` if
   it recurs across engagements (queue item C tests that).
2. **9 atlas steps reference entities the ontology doesn't hold** (F-C's live count); **~7 ontology
   entities no workflow touches** (Signal, Signal Action, Interaction, Document, …) — orphans.
3. **34 of 35 relations use the generic verb "produces"** — a structural placeholder, not a real
   business relationship. Coarse ontology output.
4. **The "External" area** in the swimlane is *not* a bug — one customer-facing step in *Delivery
   Execution & Validation* correctly classified outside the org's ten areas.
5. **F-D (new):** the ontology schema discards attribute types (all 178 untyped) and relation
   optionality (absent on all 35); `standardAlignment` is entity-level not per-attribute — the root
   cause that keeps value-role derivation at 0%.

## Gated backlog (one list — behind the DB/edge/Step-1)

- **F-A · step automation disposition** — generator + output contract. Reader default is client-side.
- **F-B · step decision-point structure** — generator; optional field, readers tolerate absence.
- **F-C · cross-artifact coherence** — **client-side, ships now** (already surfaced by the swimlane).
- **F-D · ontology attribute `type` + relation `optionality`** — one gated schema + generator-prompt
  change; **+ ~35 one-line Listen questions** for optionality (types the generator proposes).
- **F-E · generator emits Meridian `.m-*` markup** — prototype-build prompt. Client export ships
  `meridian.css` now.
- **Fabric · region-tagged (`data-fabric-id`) generation** — generator prompt (or a client
  deterministic render, which removes the edge dependency for structure — recommended).
- **Seed data · realistic content** (names, descriptions, status vocabularies) — model/edge; the
  deterministic skeleton is client-buildable.

## What I got wrong (reviewing my own session)

- **F-D collision.** I first numbered the design-system gated item **F-D**; the reviewer wanted F-D
  for the ontology-schema finding. Renamed the generator item to **F-E** and updated its five
  cross-references — but only after the fact. I should have left letter gaps for the ontology-class
  findings from the start.
- **"213 in Listen" conflation.** My first `semantic-roles.md` framing lumped 178 attribute types +
  35 optionalities as one stakeholder-time cost. That is wrong: types are a schema/generator fix
  (stakeholders answer type questions badly anyway), only the 35 optionalities are a real Listen ask.
  Corrected in both docs.
- **Inline-edit verification gap.** The seam's inline CRUD is gated on an unlocked studio; the atlas
  opens locked in the station view I could reach, so I verified read/hover/pin + typecheck/lint/tests
  but **could not screenshot the edit affordances live**. Stated, not hidden.
- **Incremental token figure is modelled, not measured** (see above).
- **Deferred the WorkflowStudio consolidation** rather than doing it badly — correct call, but it
  means the "remove the separate form" ask is only partially met (inline editing added; the separate
  form still exists).

---

# Continued queue — measurement results

Read across **all 120 programs** via the app's authenticated session (owner-scoped, read-only).
**57** carry a domain ontology; ~18 also carry an atlas with steps (the rest are empty test blobs).

## A · Cross-engagement ontology gap census

> **CORRECTED — see `ontology-gap-census.md`.** My first pass here said "17 recur (35%)" and called
> the build plan too pessimistic. **That was a miscount** — it counted per-*step occurrence*, not
> per-*engagement*. Corrected below.

- **49 distinct** unresolved-reference names. Counting **distinct engagements**: **exactly 1
  (`Document`) recurs across 2 engagements; the other 48 appear in one engagement each.** The residue
  is **almost entirely per-engagement**, which *upholds* the build plan's assumption.
- **Classification (namespace question):** 0 are systems-slot errors, 1 is a persona-slot error
  (`Talent`); 32 are mentioned-in-the-atlas-text-but-unmodelled genuine domain gaps, 17 are
  referenced-only-in-the-entity-slot. The namespace-error hypothesis (SAP is a system in the wrong
  slot) is **refuted** — SAP is absent from the systems inventory too. A related defect: only
  **41%** of step `system` values resolve to the systems inventory (39/94).
- **A universal baseline vocabulary** binds ~6 of 49 residue names cleanly (~12%); the residue's
  near-zero recurrence means it saves the curator trivia, not domain work. Built + tested client-side
  (`baselineVocabulary.ts`); generator consumption is gated (F-D related).

## B · Does the semantic derivation generalise? — **yes, universally**

Across **all 57 ontologies**: **`typedPct = 0` on every one** (attributes untyped everywhere), and
**`optionality present = 0` on every one** (absent everywhere). Structural roles derive at 100%
(cardinality is present everywhere). **No engagement carries attribute types or optionality** — so
nothing "suppressed it here"; F-D is a **systemic generator/schema gap, not Laila-specific**. That
also means the value-role-at-0% number is not an artefact of one ontology; it is the platform state.

## C · Atlas quality audit across engagements (rates)

Over engagements that have an atlas with steps:

- **Steps referencing entities the ontology doesn't hold** — high and widespread: Laila 0.24,
  Legend-commerce 0.24, Archroma 0.43, ClaimPilot 0.52, Healthcare 0.57, Laila-CRM 0.70,
  Telecom 1.33, **BFSI 1.57** (>1 = multiple missing refs per step). A minority are clean (0).
- **Ontology entities no workflow touches (orphans)** — consistently high: Archroma 0.19,
  Laila-CRM 0.20, Laila 0.24, ClaimPilot 0.40, Legend-commerce 0.44, Healthcare 0.78.
- **Cross-area workflow with no hand-off** — my proxy (≥2 distinct actors + empty `handoffs`) found
  **0 across all engagements**: multi-actor workflows *do* carry a `handoffs` field. The real Laila
  defect is the **inverse** (hand-offs declared with no step-crossing — 13 in Laila), which this
  proxy does not measure; flagged as a measurement limitation, not a clean result.
- **Verdict:** the first two are **artifact-generation defects that hold across engagements**, not
  Laila findings — they are F-C generalised and belong in `artifact-schema-findings.md` as rates.

## D · DrillAnchor blast radius — **1**

Of 120 programs, exactly **one** child carries a persisted drill anchor, and it **already
mispoints**: `refId: wf-0` was written against *"Quote Creation and Approval"* but the parent's
`workflows[0]` now resolves to *"Quote-to-Cash Workflow"* (parent regenerated/reordered since). So
the index-`refId` bug is **real and demonstrated**, but the current blast radius is **1 anchor** →
a **scheduled step-4 fix, not urgent**. (Measured, not fixed, as instructed.)

## E · Accessibility & performance on the new surfaces

- **Contrast (Meridian tokens, WCAG):** 13 of 14 key pairs pass AA. The one failure — `warn`
  `#b26a12` on white = **4.23** (fails AA-normal 4.5) — was **fixed** to `#9c5c0e` = **5.32**
  (module + regenerated demo + doc). Full pass set: ink/surface 16.4, inkSoft 10.0, muted 6.3,
  white-on-brand 16.4, positive 5.4, danger 5.7, sidebar text 5.3–14.7.
- **Keyboard / focus / colour-only:** swimlane tiles are `tabIndex=0` with `focus-visible` outlines;
  findings, area chips, workflow picker, and inline editors are native buttons/inputs (DOM focus
  order = read order); no signal is colour-only — coherence gap = ⚠ glyph + red, undeclared crossing
  = dashed line + amber + ◇, status pills carry text, area identity = dot **and** lane label.
- **Performance:** the swimlane at all ten areas (46 tiles + elbow connectors) and Laila's atlas (the
  largest, 46 steps) render without observable lag in the preview. No profiling instrument was run —
  stated rather than claimed as measured.

## Findings to promote (out of the report)

- **`artifact-schema-findings.md`:** F-D confirmed **universal** (B — 0% typed, 0% optionality on all
  57 ontologies). C's two rates (steps→missing-entities, orphan entities) generalise F-C from a Laila
  instance to a **cross-engagement generation defect**. A's recurrence (infra entities the generator
  omits) is a **generator-scoping** ask, not per-engagement curation.
- **Not urgent (scheduled):** D — DrillAnchor index refId (blast radius 1).

## F · Item 11 — duplicate-definition sweep

Swept the remaining Tier-1 findings. S1 (flowAreas) and S2 (200-cap) were closed earlier this
session; S3 (AGENT_ID_ALIASES) is the I7 finding (not a duplicate — divergent maps). The remaining
unmanaged client↔edge contract, **S4**, is now managed: the **20,000-char portal answer cap** was a
shared numeric contract with no guard (a client `maxLength` above the edge `MAX_ANSWER_CHARS`
silently truncates a stakeholder's answer on submit). Extracted `MAX_ANSWER_CHARS` in `blobGuard.ts`,
bound the two `FlowRespond` answer fields to it, and added `answerCapLockstep.test.ts` pinning it to
the edge `flow-portal` literal (text-parse, the edgeLockstep idiom). The `1200` copilot-token cap
stays edge-internal (the client `1200` is a different concept — not the same contract).

## G · Step 1b static test — **deferred (not started)**

Lowest-priority "if time remains" item, and Step-1-adjacent (action_type / affected_kind are the
intent/audit payload). Deferred rather than rushed near sensitive territory. It is a clean bounded
follow-on: author a source-reading static test asserting every emitted `action_type` ∈ its documented
closed set, every `affected_kind` ∈ its closed set, and no client call site passes `actor` — test
only, no intent wiring, no payload change.
