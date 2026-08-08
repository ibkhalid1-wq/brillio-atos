# Ontology gap census — classification, and a correction to my own earlier number

Read-only across all 120 programs (57 with an ontology, ~18 with an atlas that has steps).

## 0 · Correction: the residue barely recurs (I got this wrong first time)

My previous report said **17 unresolved-reference names recur across ≥2 engagements (~35%)** and
concluded the build plan was "too pessimistic." **That number was wrong** — it counted per-*step
occurrence* (a name appearing in five steps of one engagement scored ×5), not per-*engagement*.
Counting distinct engagements:

- **49 distinct** unresolved-reference names.
- **Exactly 1** — `Document` — recurs across **2** engagements. **The other 48 appear in one
  engagement each.**

So the residue is **almost entirely per-engagement**, which *supports* the build plan's original
assumption, not the reduction I claimed. Correcting this before building anything on it (item 3).

## 1 · Classification of the 49 (the namespace question)

The hypothesis to check: names like `SAP`/`Document` might be **namespace errors** — the concept
exists in the engagement (systems inventory, personas, events) but is referenced from an entity slot
that can't resolve it. Checked each residue name against the systems inventory, step `system` values,
personas (kit roster + step actors), events, entity attributes, and the engagement's other text:

| Class | Count | Meaning |
|---|---|---|
| **System-slot error** | **0** | none resolve to the systems inventory or any step `system` |
| **Persona-slot error** | **1** | `Talent` (a role in *Laila — CRM Replacement Pilot*) |
| **Event-slot error** | **0** | — |
| **Mentioned in the atlas text, unmodelled** | **32** | the concept is discussed (step actions / workflow names) but not held as an entity — a genuine domain gap, demonstrably in scope |
| **Referenced only in the entity slot** | **17** | appears nowhere else — purest gaps (`OnboardingRequest`, `ComplianceCheck`, `RiskScore`, `RetentionOffer`, …) plus a few generic nouns (`User`, `Persona`, `Task`) and a few odd generator composites (`Account Competitor View`, `Reference Catalog Entry`) |

**The namespace-error hypothesis is refuted.** `SAP` is not a system-in-the-wrong-slot — it is
absent from Archroma's systems inventory *too*. Only 1 of 49 (Talent→persona) is a true
slot-misplacement. The residue is **genuine domain gaps** (32 mentioned-but-unmodelled + 17
referenced-only), not misfiled concepts. Adding a baseline vocabulary to "fix SAP" would have modelled
around a bug that isn't there.

**But a related bug IS there (item 6b):** of 341 atlas steps, 94 carry a `system` value and only
**39 (41%) resolve to the systems inventory**. The systems namespace is 59% incoherent — which is
*why* a system-slot misplacement can't be detected by matching the inventory: the inventory itself is
sparse/inconsistent. That is an atlas-generation defect in its own right (belongs with F-C's family).

## 2 · What a universal baseline vocabulary would actually close

A candidate universal baseline (Document, User, Task, Note, Report, Organization, Person,
Notification, AuditEvent, Role, Team, Address) retroactively binds, by loose token match, **14 of 49
residue names (29%)** — but that is **inflated**: it over-binds domain composites that merely share a
token (`Account Competitor View`/`Account Plan` → Organization, `Police Report` → Report, `Deal Team`
→ Team). Those are engagement-specific concepts, not the generic noun.

**Cleanly universal bindings: ~6 of 49 (~12%)** — `document`, `user`, `task`, `persona`→Role,
`reporting`→Report, `company`→Organization. Each appears in ~1 engagement, so the per-engagement
reduction is at most a name or two.

**Verdict:** a baseline vocabulary is worth having as a floor (it costs nothing to ship and pre-empts
the generic-noun slice), but it is **not** the lever the recurrence framing implied — it closes
~12% of *distinct* residue and, because the residue barely recurs, a negligible share of any single
engagement's gaps. The 32 mentioned-but-unmodelled and the domain composites are **per-engagement
domain work**; the per-vertical terms (`FNOL`, `Physician`, `Candidate`, `Reserve`, `Payment`) are
**Listen work** and must not go in a universal baseline.

## 3 · Revised build-plan position (the plan doc lives outside this repo — flagged for its owner)

The plan priced ontology completeness assuming residue is irreducibly per-engagement and staffed a
dedicated ontology curator (~1.5–2 skilled people per concurrent engagement). **The corrected census
largely upholds that** — residue recurrence is ~2% (1 name), not ~35%. The only justified reduction:

- Ship the small **universal baseline** (item 2) so the generic-noun slice (~6 concepts) never
  becomes a per-engagement gap. Saves curator time on trivia, not on domain modelling.
- Everything else — the 32 mentioned-but-unmodelled, the domain composites, the per-vertical terms —
  **remains per-engagement**; the curator role does **not** disappear.

**Revised estimate:** the curator role stands; the baseline trims the *generic* fraction of its work
(a small, one-time platform change), not the domain fraction (the bulk). Do not re-price the role
downward on a recurrence that the corrected data does not support. This rests on: 49 distinct residue
names, 1 recurring, ~6 cleanly-universal, measured across 57 ontologies.
