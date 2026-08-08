# Aura — Claims-ledger spec (canonical)

> The settled structure. Re-read at each phase boundary; do not trust it to survive a long run from
> memory. The five tiers and the vocabulary below are **settled and not to be redesigned** — an
> amendment large enough to move a tier is a structure change and goes to Ibrahim, not into code.

## Why

Today the artifact is three separate generated documents (ontology, atlas, discovery kit) whose fields
all render as **equally certain fact**. A machine-derived guess and a stakeholder's stated rule look
the same on the page. The ledger replaces that: **one claims ledger with three projections**, where
every slot carries its own certainty, world, source, and owner — and an unknown is a first-class
object, not an omission.

## The five tiers (settled)

- **Tier 0 — identity kernel.** Elements with stable ids and typed relations. Ids are content/name
  based, never positional (four index-based ids have already broken on reorder — do not add a fifth).
  A relation references elements **by id**; an unresolvable reference is a first-class visible object,
  never a silent name match.
- **Tier 1 — claims.** Every slot on every element is a claim:
  `{ id, about: <elementId>.<slot>, value | ?unknown | n/a, world, layer, source, status,
     ownerWhileOpen, closedBy }`. **Generation must emit unknowns rather than omit slots.**
- **Tier 2 — durability layer.** Every claim tagged `domain` (a truth about the business that outlives
  any system) or `configuration` (how a particular system is set up today). Durability is orthogonal
  to world.
- **Tier 3 — shapes.** Schema modules declared per engagement in Frame — `lifecycle`, `decision`,
  `obligation`, `portfolio`. A shape adds slots to the elements it applies to; **added slots are born
  `?unknown`**. Shapes are how F-A..F-G stop being seven patches and become declared structure.
- **Tier 4 — projections.** Read models over the ledger: the **ontology view**, **atlas view**, and
  **discovery-kit view**, plus computed projections — **coverage**, **seams**, **burn-down**,
  **Architect-readiness**, and the **deviation register**.

## Vocabulary (settled — from the stress tests)

- **worlds:** `as-is | to-be`. *as-is never auto-promotes* — a fact about the current system does not
  become a target just because nothing contradicts it.
- **sources:** `regulation | external-standard | document | code-derived | precedent | asserted |
  dispositioned | generated`.
- **statuses:** `open | weak | closed | blocked | n/a`.
  - `open` — a live unknown awaiting an answer.
  - `weak` — closed, but on thin grounds (a touch with no verbatim/reason; a low-confidence default).
  - `closed` — closed on firm grounds (an attributed assertion, a document, an analysis).
  - `blocked` — cannot be closed here; held pending a named authority (e.g. bound by regulation, or
    awaiting a gated input).
  - `n/a` — the slot does not apply to this element.
- **closure methods:** `assertion | disposition | document | analysis | experiment | import`.
- **ownership:** a claim's `ownerWhileOpen` is who must answer it while it is open. **Joint ownership
  `A ⋈ B` is a first-class owner** (a seam that two functions own together), distinct from either A or
  B alone and distinct from unowned.

## Precedence (the one undefined piece — see `ledger-precedence.md`)

Two claims on the same locus (`about`) can conflict. Resolution is one of three outcomes: **wins**
(loser retained as history), **coexist** (a visible contradiction, both live — routable), or
**escalate** (routed to a named authority). The full lattice (source × world) and its encoding are in
`ledger-precedence.md`; the doc's table is generated from the same data `resolvePrecedence()` reads.

## Amendments from instantiation (`ledger-instantiation.md`, applied before Phase 2)

These refine the tiers; none moves a tier. They are settled for this build.

- **A1 — claim value is a tagged union.** `scalar | ref(elementId) | ref-list | unresolved-ref{name,
  why} | ?unknown | n/a`. A reference (FK-shaped attribute, system-of-record, actor→role) carries a
  `ref`, never a name string. An `unresolved-ref` is a first-class visible object.
- **A2 — aliases are claims; a name collision is a flagged contradiction.** An alias equal to another
  element's name **coexists** as a visible contradiction (routable), never a silent merge.
- **A3 — Tier 0 identity is world-agnostic; world lives only on Tier 1 claims.** Element *existence* is
  itself expressible as a claim (`about: <el>.exists`) when contested (e.g. a removed element still
  referenced).
- **A4 — a reference into an OPEN value set is `blocked`.** A claim that names a member of another
  claim's still-unknown value set cannot resolve until that set closes; it is surfaced, not accepted.
- **A5 — multi-value slots are first-class.** A claim value may be a list of refs/scalars; a 4-way
  handoff is four edge-claims, not one delimited string.
- **A6 — child-collection ids are content-derived, never the array index.** Steps and other children get
  ids from their content (a hash of their identifying fields); reorder must not repoint identities.
- **A7 — projections are the only UI read path** (`ledger-critique.md` C1). Components read a Tier-4
  projection, never raw claims; precedence resolves once, inside the projection. Raw-claim access is
  admin/debug only.
- **A8 — `escalate` always resolves to a reachable authority** (C3). `slot-owner` on an unowned slot
  falls through to the engagement domain authority; an escalation never routes to nobody.
- **Tier-2 consumer commitment** (C4): durability (`domain | configuration`) must have a consumer by end
  of Phase 3 (import adapters set it; deviation register + projections read it) or be reported as decoration.

## Constraints that carry over (measured, not optional)

- **No name joins.** Reference by id; an unresolvable reference is a first-class visible object.
- **No positional identity.** No index-based ids.
- **Asserted outranks generated.** No regeneration may overwrite an attributed closure.
- **Persona invention retired.** People are Operator-entered; the kit is derived (function is a person
  attribute; grouping is derived from it).
- **Input is the snapshot, not the live blob.** `docs/laila/snapshot-2026-08-07` is the migration
  input; the live engagement blob is never read or written by this work.
