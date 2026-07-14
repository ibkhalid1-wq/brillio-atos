# Implementation prompt — Redesign data collection (Listen · Envision · Show)

> Paste this as the brief for the redesign. It is written to be executed against
> the existing ATOS Flow codebase (`~/ATOS/brillio-atos`), and it names the real
> modules to extend so the work stays grounded, not greenfield.

---

## 0. Intent

Turn stakeholder data collection from a **text form** into a **live, visual,
area-scoped workspace**. In every phase the stakeholder manipulates the actual
model of their world — their workflow and the domain ontology — and their input
reshapes the artifacts *as they work*. Collection, envisioning and demoing run
**in parallel per business area**, not as a global waterfall. The whole
operator-and-stakeholder surface must read as a modern, premium product.

Non-negotiable existing contracts to preserve:
- **Artifacts are derived, not authored.** Nothing the stakeholder or operator
  does hand-edits an artifact; every change arrives as **evidence** and lands
  through resynthesis (`EDITS_LOCKED`, shrink guard, contributor sign-off).
- **External input is quarantined**, then ingested — never written straight to
  the record (`flowPortalInbox` → `ingestPortalResponse`).
- Links are **no-login tokens** served by the `flow-portal` edge; responses
  return through the same quarantine.

---

## 1. Foundational concept: the AREA (track)

Introduce a first-class **area** (a.k.a. track) — a business domain such as
*Sales*, *Marketing*, *Patient Enrollment*. It is the unit of parallelism.

- Derive areas from the record: group Domain-Ontology entities and Atlas
  workflows by area. Since the ontology/atlas are currently flat, add an
  `area` field to each workflow and each entity in the generators
  (`run-agent` schemas for `currentStateAtlas` and `domainOntology`), and a
  deterministic fallback that infers the area from workflow name / actor when
  the model omits it. Persist an `areas[]` roster on the programme.
- Every piece of evidence, every review link, every artifact-regeneration job
  carries an `area`. This is what lets Marketing move to Envision while Sales is
  still in Listen.
- Add an **area filter** to the operator canvas and to the stakeholder review
  surfaces (chips: All · Sales · Marketing · …).

Files: `supabase/functions/run-agent/index.ts` (atlas/ontology schemas),
`flowShellData.ts` (area readers), `flowStakeholders.ts`, `FlowCanvas.tsx`.

---

## 2. LISTEN — edit the workflow, narrate changes, see them apply live

Replace the plain question form (for Listen review links) with a **workflow +
ontology canvas above the questions**.

**Top of the link — the visual model (their area only):**
- Render their workflow as an ordered, readable step list (reuse the wireframe
  vocabulary in `ExperienceDesignStudio` / the `flowReviews` projection). Show
  the ontology terms that the steps touch beside it.
- The stakeholder can **edit the workflow directly**:
  - **Add a step** (insert between steps; set actor, action, system, the
    entities it touches).
  - Reorder / edit / mark a step wrong.
  - **Narrate a change** — a free-text/dictated box ("actually, legal reviews
    it twice before it goes out") that is captured verbatim.
- **Live preview:** as they edit or narrate, show a **diff of the workflow and
  ontology** they are proposing — added steps highlighted, renamed terms shown
  old → new. This is a *proposal preview*, not a write: it composes into the
  evidence they submit. (Client-side derivation; nothing persists until submit
  → quarantine → ingest → resynthesis.)

**Below the model — the non-structural questions:**
- Questions that do **not** change the workflow or ontology (compliance
  requirements, risks, constraints, success measures) are listed underneath as
  the normal answer fields. Tag each script question `structural: false` so the
  surface knows to render it below the canvas rather than on it.

**Submit** composes: (a) the proposed workflow/ontology edits as a structured,
attributed evidence block, and (b) the below-the-line answers. Both ingest into
Listen evidence for their area.

Files: extend `FlowReviewSurface.tsx` (new "listen-workflow" review kind),
`flowReviews.ts` (projection + diff + compose), `FlowRespond.tsx`.

---

## 3. ENVISION — receive the model, narrate what to agentify, filter by area

Build on the shipped **agentify review** (`projectAgentifyReview`), upgrading it:

- Stakeholder receives the **visual ontology + workflows** (not just their own
  steps) and can **narrate which workflow components should be agentified** —
  per step *and* free-text ("the whole triage loop could be an agent").
- **Area filter** on the surface: chips to show only Sales / Marketing / … so a
  cross-area reviewer isn't forced through everything.
- Keep the three-way per-step disposition (Keep / Assist / Agentify) but add the
  narrated rationale and an area-level "what would you hand to an agent first?"
  prompt.

Files: `flowReviews.ts` (area-scoped agentify projection + filter metadata),
`FlowReviewSurface.tsx`.

---

## 4. SHOW — walk the demo, comment per phase and overall

Upgrade the demo link (already carries `design` + `script` via `designSlice` /
`scriptSlice`):

- Stakeholder sees the **demo flow narrated by the demo script** (the existing
  `DemoWalker`), now with a **comment box on each phase/step** and one for the
  **workflow as a whole**.
- Compose per-phase comments + overall verdict into the demo-verdict evidence.

Files: `FlowRespond.tsx` (DemoWalker per-step comment capture),
`flowPortal.ts` demo-verdict ingest (carry per-phase notes).

---

## 5. Auto-trigger regeneration on the IMPACTED portion

When a stakeholder response is ingested **or a meeting transcript is uploaded**,
automatically regenerate **only the artifacts impacted by that area**, not the
whole spine.

- On `ingestPortalResponse` / transcript upload, determine the response's
  `area` and which artifacts depend on it (Listen evidence → ontology + atlas
  for that area; Envision inputs → strategy/blueprint; Show → demo). Enqueue a
  **scoped regeneration** for exactly those.
- Reuse the staged spine runner but pass an `area` filter so regeneration
  touches only that area's slices. Show it in the status strip
  ("Marketing atlas regenerating — Sales unaffected").
- Respect the shrink guard, coverage receipts and sign-off supersession
  already in place.

Files: `AppShellV3.tsx` (`onIngestPortalItem`, transcript-upload path),
the spine runner, `run-agent` (area-scoped prompts).

---

## 6. Parallel work across phases, per area

The programme must let an area advance through phases independently:

- Track **per-area phase state**: an area is *Listen-satisfied* once its
  coverage + gate criteria for Listen pass, even while other areas are still
  collecting. A satisfied area **unlocks Envision and Show for that area**.
- The operator canvas shows a **per-area pipeline** (Marketing: Listen ✓ ·
  Envision ◐ · Show ○ / Sales: Listen ◐ …) instead of one global movement
  stepper. Minting Envision/Show links is enabled per satisfied area.
- Gates become **area-aware**: an area gate can pass while the movement as a
  whole is still open.

Files: a new `flowAreas.ts` (per-area phase state + satisfaction rules),
`FlowCanvas.tsx` / `FlowShell.tsx` (per-area pipeline UI), gate logic in
`flowShellData.ts` / `flowCrossValidation.ts`.

---

## 7. Operator experience

- **Area board**: a portfolio-style grid of areas × phases with live status,
  one click to mint the right review link for an area/phase.
- **Inbox** groups incoming responses by area and shows which regeneration each
  one triggered.
- Keep governed exceptions and per-stakeholder sign-off; make both area-aware.

---

## 8. UX quality bar (operator AND stakeholder)

- Premium, modern, restrained: a deliberate palette and type scale, real
  hierarchy, generous spacing, tasteful motion (reduced-motion respected).
- The stakeholder surfaces must feel like a product, not a form: the workflow
  canvas is the hero; editing is direct and obvious; the live diff is
  satisfying and legible; dictation is first-class.
- Everything responsive; wide content scrolls inside its own container; visible
  focus states; accessible labels on every control.
- Reuse the existing token system in `v3.css`; do not introduce a second theme.

---

## 9. Data-model & edge summary

- `currentStateAtlas.workflows[].area`, `domainOntology.entities[].area`
  (generator + deterministic fallback); programme `areas[]`.
- Review pack gains `area` and richer `review` kinds:
  `listen-workflow`, `agentify` (area-filtered), `show-demo` (per-phase).
- `flowPortalInbox` items carry `area`; ingest routes area-scoped regeneration.
- Script questions gain `structural: boolean` so Listen renders non-structural
  ones below the canvas.
- Per-area phase state persisted (e.g. `flowAreaState`), fingerprint-safe.

## 10. Constraints & acceptance

- No artifact is ever hand-edited; all changes are evidence → resynthesis.
- External input stays quarantined until ingest; nothing auto-writes the record
  except the scoped regeneration the ingest triggers.
- `npm run validate` green; edge deployed; regression tests for: area
  derivation, structural-vs-below question split, workflow-edit compose, scoped
  regeneration selection, per-area satisfaction unlocking Envision/Show.
- Live-verified on a real programme (area moves to Envision while another area
  is still in Listen; a transcript upload regenerates only its area's atlas).
