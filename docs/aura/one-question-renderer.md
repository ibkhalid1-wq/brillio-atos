# Questions are locus+kind projections — one shared renderer

A question is NOT stored text. It is `(locus, kind, owner, status)` in the ledger, and
`src/v3/lib/ledger/renderQuestion.ts` is the ONLY place question text comes from.

## The renderer

`renderQuestion(store, about, audience)` — deterministic templates, no model key:

- **Full data at render time.** A step's complete action text comes from its `#action`
  claim — the element name (a 60-char migration cut) is never shown. This kills the
  truncation-artifact class at the root: the old path cut twice (`action.slice(0,60)`
  at migrate, `wordSafe(52)` at phrasing) IN the string.
- **No truncation in the string, ever.** Ellipsis is a display-layer concern.
- **Steps are quoted verbatim:** `One step in your process is: "<full action>."
  Should this be automated, assisted, or stay manual?` — quoting sidesteps every
  conjugation bug.
- **Relations render plain language** (`Can one Case have many Anesthesia Record, or
  just one?`) — never arrow notation. **Original casing** from source, never patched.
- **Audience:** `stakeholder` = second person ("your process"); `operator` = same
  deterministic text in third person (ids/type tags are projection metadata).
- **Kind-specific affordances** carried on the projection: AUTOMATE? = three chips +
  optional why (a chip answer is a one-tap attributed assertion); PHASE = phase-picker;
  ACTOR ROLE = role-picker + free text; MEANING/DECISION = free text + optional why.
- **Plain labels:** "Automate this?" · "Which phase" · "Who does this" · "What decides"
  · "What this means" · "Which values"…
- `groupQuestions` — stakeholder grouping: one card per element (a step card), its
  unknowns as sub-questions; the unit stays QUESTIONS, the header shows the count.
- LLM-polished phrasing is a later, GATED layer on top — may rephrase, never change
  locus or kind, falls back to the template.

## Producer-zero

`phrasing.ts` is reduced to `readableName` (a name helper — no templates). All four
former call sites (TheLine roster/owned lists, OperatorInbox, DesignLoopZones drill,
kitProjection) now import the one renderer. Grep for question-text producers outside
`renderQuestion.ts`: **zero**.

## Verification (tests: `renderQuestion.test.ts`, 10 cases; suite 1265 green)

- **Three surfaces, one set** (Laila + surgery): kit projection === operator queue ===
  drill; counts equal; every question id resolves to an open ledger locus.
- **Truncation artifacts:** every open locus rendered, both audiences, both programs —
  zero occurrences of `" the be "`, `" to pre be"`, `" and u —"`, `…`, `...`, `→`.
- **Full-action recovery:** a 130-char step action renders whole and verbatim inside
  the quote although its element name is the 60-char cut.
- **Casing:** "Anesthesia Record" (FHIR-derived) survives with source casing; the old
  renderer's lowercase-first-letter behavior is gone.
- **End to end:** chip answer → `asserted · closed · verbatim` claim → locus leaves the
  open set → burn-down `closed+1 / open−1` → `projectKitQuestions` regenerates without
  it. One question set, end to end.

Live Laila samples (stakeholder audience): `What values can Account.category take?` ·
`Which phase of your process does "Opportunity Signal Generation" belong to?` ·
`One step in your process is: "Capture inbound lead from web form, event scan, partner
referral, or campaign engagement; tag source." Should this be automated, assisted, or
stay manual?`

## Gated / findings

- **Stakeholder linked page — CLOSED client-side** (2026-08-10; full account in
  `stakeholder-linked-page-loci.md`). The pack carries LOCI additively
  (`questionLoci`, index-aligned with `questions`); the linked page rebuilds a
  read-only store from the `liveArtifacts` the edge already ships and renders every
  locus through `renderQuestion(…, "stakeholder")` with its affordance, grouped per
  element by `groupQuestions`. Legacy string-only packs render exactly as before, and
  a locus the page's store can't resolve keeps its stored ask. Test:
  `portalLociQuestions.test.ts` — page text === operator text === kit projection, for
  the same locus, on Laila + surgery. **Gated on ONE edge deploy**: `flow-portal` must
  forward `questionLoci` (source change made, NOT deployed) — until then a served pack
  carries no loci and the page degrades to the strings it always rendered.
- **Stored kit agenda strings** (discoveryKit artifact) = the "cache-with-version"
  demotion is a generator/schema decision (edge).
- **Roster chip live check** (Head of Sales 9 / Head of GTM 15) needs the live DB
  roster; the counts-equal invariant is proven structurally on both migrated ledgers.
- Chip answers as REAL stakeholder writes remain gated on the stakeholder write path;
  proven at the store level here.
