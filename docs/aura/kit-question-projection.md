# Kit questions as a projection of ledger open unknowns

**Problem.** The discovery-kit questions didn't match the discovery-queue questions:
the queue derives from ledger open unknowns; the kit came from kit generation. Two
independently-generated lists → drift, and — the real cost — a stakeholder could answer
every kit question and the burn-down wouldn't move, because kit answers didn't map to
ledger loci. Nothing grounded.

## The fix — one source, projected two ways

`src/v3/lib/ledger/kitProjection.ts`:

- `projectKitQuestions(store)` → every open unknown (`buildUnknownQueue`), phrased for a
  human via `questionForLocus`, each carrying the **locus it closes** (`about`). This is
  the SAME source the operator queue reads (`soloByOwner` / `buildUnknownQueue`) — so the
  operator's Discover view and the stakeholder's kit are one list, two renderings:
  - Operator: loci-with-status (burn-down, assign queue), machine-precise.
  - Stakeholder: the same unknowns as plain-language questions, locus id on hover.

Exposed through the one read path (`useProgramLedger` → `ledger.kitQuestions`), so no
surface re-derives it. Plain-language phrasing on top, the precise locus underneath —
consistent with the descriptiveness fix (`makeNameOf` qualifies "Appointment.status").

Because there is only one list, the kit and the queue **cannot drift by construction**,
and answering a kit question closes a real locus, so the burn-down moves.

## The projection — real reads

| Program | Projected kit questions (= open unknowns) | Top slot types |
|---|---|---|
| **Laila** | **395** | dataType 178, automationDisposition 46, actorRole 46, optionality 35, semantics 34, valueSet 31, phase 14, decision 11 |
| **Surgery** (synthetic; live is DB-only) | **17** | dataType 4, valueSet 4, phase 2, automationDisposition 2, actorRole 2, decision 2, optionality 1 |

Examples (question → locus it closes):
- `"What type of value is account.category?"` → `el:attr:account.category#dataType`
- `"What values can case.status take?"` → `el:attr:case.status#valueSet`

Every projected question carries a real `#slot` locus — **no question that closes nothing.**

## The reconciliation — unmatched kit questions are findings, not noise

`reconcileKit(kitQuestions, store)` maps each separately-generated kit question to a
locus. Matched → the human phrasing of that locus. Unmatched → a **finding**, classified:

- **ontology-gap** — the question references no element the ontology holds. The kit caught
  something the model missed → mint an entity/attribute (curation path) or disposition
  with a reason.
- **stale** — the question references a modelled element but no open locus. Already
  closed/covered, or asks a detail the ontology never made a slot for.

`projectedOnly` reports loci the kit never asked (kit under-coverage), so the gap runs
both ways. The matcher is a heuristic (free text ↔ loci): it keys on the element name
plus a per-slot intent regex, and reports the reason per question rather than guessing
silently. Its limits are real — e.g. a bare attribute named `status` can match "Reward
status" to `lead.status`; such near-misses are visible in the matched list for an operator
to confirm, never hidden.

**Sample reconciliation (4 questions vs Laila):** matched 1 (`"What values can Reward
status take?"` → `el:attr:lead.status#valueSet`), stale 1 (`"Who owns Escalation?"` —
Escalation modelled, no open owner locus), ontology-gap 2 (invented nouns the ontology
never modelled), projectedOnly 394 (the kit sample covers a sliver of the 395 open
unknowns). **Exact live per-program splits need the discovery-kit artifact, which is
DB-only** in this environment; the operator runs `reconcileKit(<kit questions>, store)`
live to get them — the function and its classification are proven here.

## End-to-end proof (test: `src/v3/__tests__/kitProjection.test.ts`, 11 cases)

1. **Every projected question maps to a real open locus** (Laila + surgery).
2. **Kit === queue** — the projected `about` set equals the queue's open-unknown set
   (drift is impossible).
3. **Answer → close → burn-down drops by one:** a stakeholder answer asserts a closed
   claim on the locus; the `?unknown` is superseded; `projectKitQuestions` returns
   `count − 1` and that locus leaves BOTH the kit and the operator queue. Proven on both
   programs.
4. **Reconciliation** — nothing dropped (`matched + unmatched === kit total`); unmatched
   classified gap-vs-stale with an implication each.

tsc + eslint clean; 1241 tests green.

## Findings (reported, not silently done)

- **Stakeholder pack pipeline (surface wire, buildable next).** The operator queue already
  IS the projection, so operator-side there is no drift. The stakeholder's durable link
  pack (`flowInterviewPacks`, assembled in `flowStakeholders`/`flowPortal` from
  `kit.interviews[].agenda[].questions`) still reads the generated agenda. To close the
  loop for the stakeholder, the pack builder must source questions from
  `projectKitQuestions(store)` scoped to the recipient's owner-label instead of the
  agenda. This crosses into the pack pipeline (partly edge-generated), so it's flagged as
  the next wire, not silently reached into.
- **No locus-mint path for gap findings (core / curation, a finding not a tier change).**
  There is no `mintLocus` / `ProposedEntity` / curation path in the codebase — curation
  today is dismissals/deferrals (`_curationLog`, `_dismissedAsks`). Routing an
  ontology-gap kit question to mint a new locus needs a curation-path addition (a new
  element + `?unknown` claim via `store`), which the frozen core does not currently
  expose. This is the "whether unmatched kit questions warrant minting loci" question the
  brief anticipated — a curation-path change, reported here for a decision, not made.
