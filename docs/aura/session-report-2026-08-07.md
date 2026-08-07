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

*(Continued-queue results are appended below as they complete.)*
