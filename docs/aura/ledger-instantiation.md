# Aura — Ledger instantiation (the over-modelling test)

The complete ledger for **Opportunity** and the real **Opportunity Qualification** workflow, from
Laila's committed snapshot (`docs/laila/snapshot-2026-08-07`). Every slot, every claim, every unknown
with its owner, every world tag. Awkward fields are **findings** → each is amended into `ledger-spec.md`
and the Phase-2 types **before** building. This is pass-1b applied to the structure itself.

Notation: `about` = `<elementId>.<slot>` · `w` = world · `L` = layer (dom = domain / cfg = configuration)
· `src` = source · `st` = status · `owner` = owner-while-open · `by` = closed-by.

## Tier 0 — identity kernel (world-agnostic)

```
el:opportunity            kind=entity   name="Opportunity"   sysOfRecord=ref:sys:crm
el:wf:opp-qualification   kind=workflow name="Opportunity Qualification"
  steps: [ el:step:oppq#0, el:step:oppq#1, el:step:oppq#2, el:step:oppq#3 ]   (ids by content, not index — see A6)
el:attr:opportunity.stage       kind=attribute  of=ref:el:opportunity
el:attr:opportunity.type        kind=attribute  of=ref:el:opportunity
el:attr:opportunity.amount      kind=attribute  of=ref:el:opportunity
el:attr:opportunity.closeDate   kind=attribute  of=ref:el:opportunity
el:attr:opportunity.account     kind=attribute  of=ref:el:opportunity   (FK-shaped — see F1)
el:attr:opportunity.owner       kind=attribute  of=ref:el:opportunity   (FK-shaped, dangling — see F2)
el:attr:opportunity.key_decision_maker kind=attribute of=ref:el:opportunity (FK-shaped — see F1)
rel:account→opportunity   kind=relation  from=ref:el:account  to=ref:el:opportunity  verb="produces" card=1:N
rel:opportunity→contract  kind=relation  from=ref:el:opportunity to=ref:el:contract verb="produces" card=1:N
  … (13 more Opportunity-produces-X relations, all 1:N) …
lead→opportunity          kind=relation  from=ref:el:lead     to=ref:el:opportunity verb="produces" card=1:N
```

Element **existence** is world-agnostic here, but existence can itself be contested (the removed `User`
element, F2) — so existence is expressible as a claim `about: <el>.exists` (A3).

## Tier 1 — the claims (Opportunity)

| about | value | w | L | src | st | owner | by |
|---|---|---|---|---|---|---|---|
| opportunity.definition | "A potential deal or engagement tracked from signal detection through to close and delivery." | to-be | dom | generated | **weak** | Sales Leaders | — |
| opportunity.systemOfRecord | `ref:sys:crm` (vague — "CRM" not "Salesforce", F3) | as-is | cfg | code-derived | **weak** | Sales Ops | — |
| opportunity.aliases | `["Sales Opportunity","Deal", ⚠"Engagement"]` | to-be | dom | generated | **weak** | Sales Leaders | — |
| opportunity.area | `9 area-refs (Sales/Practices/Delivery/…/Alliances)` | to-be | cfg | generated | **weak** | Sales Ops | — |
| opportunity.exists | true | as-is | dom | code-derived | closed | — | import (sf) |
| **opportunity.stage** (exists) | true | as-is | dom | code-derived | closed | — | import (sf) |
| **opportunity.stage.valueSet** | **?unknown** (Prospecting/Qualification/Proposal/Closed-Won? — the members are never in the ontology, F-F) | as-is | dom | — | **open** | Sales Leaders | — |
| opportunity.stage.valueSet | **?unknown** (target stages — keep or restage?) | to-be | dom | — | **open** | Sales Leaders | — |
| opportunity.stage.dataType | **?unknown** (untyped string, F-D) | as-is | cfg | — | open | Sales Ops | — |
| opportunity.stage.terminal | **?unknown** (which states can't be left — Closed Won/Lost?) | as-is | dom | — | open | Sales Leaders | — |
| opportunity.type.valueSet | `["new business","renewal","expansion","re-compete"]` (encoded in the **atlas step**, not the ontology — F4) | to-be | dom | document | **weak** | Sales Leaders | — |
| opportunity.amount.dataType | **?unknown** (should be monetary) | as-is | cfg | — | open | Sales Ops | — |
| opportunity.closeDate.dataType | **?unknown** (should be date) | as-is | cfg | — | open | Sales Ops | — |
| opportunity.account (→) | `ref:el:account` (FK-shaped attribute duplicating rel:account→opportunity, F1) | as-is | dom | code-derived | weak | Sales Ops | — |
| opportunity.owner (→) | ⚠`unresolved-ref("User"/"owner" — the User element was removed, F2)` | as-is | cfg | code-derived | **blocked** | Sales Ops | — |
| opportunity.key_decision_maker (→) | `ref:el:contact?` (FK-shaped, ambiguous target: Contact or Buying Committee, F1) | to-be | dom | generated | weak | Sales Leaders | — |
| rel:account→opportunity.cardinality | `1:N` | as-is | dom | code-derived | closed | — | import (sf) |
| rel:account→opportunity.optionality | **?unknown** (does every Opportunity require an Account? F-D) | as-is | dom | — | open | Sales Leaders | — |
| rel:opportunity→contract.semantics | **?unknown** (lifecycle-advance vs has-many sub-record — the generic `produces`; the journey-axis finding) | to-be | dom | — | open | Sales Leaders | — |
| opportunity.account.isClientOrPartner | **?unknown** (G3 — is Account always the client, or also a partner?) | as-is | dom | — | **open** | Executive Leadership | — |

## Tier 1 — the claims (Opportunity Qualification workflow)

| about | value | w | L | src | st | owner | by |
|---|---|---|---|---|---|---|---|
| wf:opp-qualification.name | "Opportunity Qualification" | to-be | dom | generated | weak | Sales Leaders | — |
| wf:opp-qualification.area | `ref:area:sales` | to-be | cfg | code-derived | weak | Sales Ops | — |
| wf:opp-qualification.owner | "Sales reps - Markets" (a role string, not a resolved role-ref — the 56-role map, F5) | to-be | cfg | generated | **weak** | Sales Ops | — |
| wf:opp-qualification.trigger | "Lead converted to opportunity or new opportunity identified" | to-be | dom | generated | weak | Sales Leaders | — |
| wf:opp-qualification.phase | **?unknown** (no phase field — F-G; the grid *derives* "Qualification" but nothing asserts it) | to-be | dom | — | open | Sales Leaders | — |
| wf:opp-qualification.handoffs | `["Markets → Practices/Delivery/Finance/Legal"]` (a 4-way handoff string, not typed edges, F5) | to-be | dom | generated | weak | Sales Leaders | — |
| step:oppq#0.action | "Create opportunity record…; initial stage = Qualification" | to-be | dom | generated | weak | Sales Leaders | — |
| step:oppq#0.setsStageTo | ⚠`ref into opportunity.stage.valueSet member "Qualification"` — **blocked** (references a member of an unknown value set, F6) | to-be | dom | document | **blocked** | Sales Leaders | — |
| step:oppq#0.automationDisposition | **?unknown** (F-A — agent/assisted/human? G1, all 46 steps) | to-be | cfg | — | **open** | Sales Ops | — |
| step:oppq#0.actor→role | **?unknown** ("Sales reps - Markets" → which of 56 access roles, F5) | to-be | cfg | — | open | Sales Ops | — |
| step:oppq#3.decision | "approve stage advancement for Large/Mid deals" → a **decision shape** (F-B): condition/authority/outcomes all **?unknown** | to-be | dom | — | **open** | Sales Leaders | — |
| step:oppq#3.decision.authority | **?unknown** (who approves; "Sales Leaders - Markets" is the actor but the authority threshold is unstated) | to-be | cfg | — | open | Sales Ops | — |

Open questions carried from the gap list land as `open` claims with owners: **G1** (automation boundary,
every step) · **G3** (Account client-vs-partner) · **G9** (Lead→Opportunity MQL handoff — a
`rel:lead→opportunity.handoffRule` unknown, owner Marketing ⋈ Sales) · **G11** (forecast/quote/proposal
rules). **G9 is a joint-owner `Marketing ⋈ Sales` claim** — the first-class joint owner in action.

## Findings → amendments (applied to `ledger-spec.md` before Phase 2)

- **F1 · FK-shaped attributes.** `account`, `owner`, `key_decision_maker` are references, not scalars,
  and they *duplicate* relations already in Tier 0. A claim value that is a string here would invite a
  name join. → **A1: a claim `value` is a tagged union** — `scalar | ref(elementId) | ref-list |
  unresolved-ref{name, why} | ?unknown | n/a`. Reference attributes carry a `ref`, never a name.
- **F2 · Dangling reference (`owner` → removed `User`).** The `User` element was removed in an earlier
  pass but `opportunity.owner` still points at it. → **A1 + A3:** the value is an `unresolved-ref`
  (a first-class, visible object retaining the dangling name and *why* it's unresolved), and the claim's
  status is **blocked** until the target is declared or the reference is repointed. **Never a silent match.**
- **F3 · Vague configuration value.** `systemOfRecord: "CRM"` should reference a System element
  (`Salesforce`), not a category string. → A1 (ref), plus a `weak` status because "CRM" under-specifies.
- **F4 · A value set the old structure couldn't hold, encoded in another projection.** `opportunity.type`'s
  members (`new business / renewal / expansion / re-compete`) are spelled out in the **atlas step** but
  have nowhere in the ontology (F-F). In the ledger this is **one locus** (`opportunity.type.valueSet`)
  with a `document`-sourced, `to-be`, `weak` claim — the ledger *already* fixes what F-F described. No
  new amendment; it validates the structure.
- **F5 · Role/handoff strings, not typed refs.** `owner: "Sales reps - Markets"`, `handoffs:
  ["Markets → Practices/Delivery/Finance/Legal"]` are display strings encoding structure. → **A5:
  multi-value slots** — a claim value may be a *list* of refs; a 4-way handoff is four edge-claims, not
  one string. The 56-role resolution stays `?unknown` (owner Sales Ops), not a name-matched guess.
- **F6 · Reference into an open value set.** `step:oppq#0` sets stage to "Qualification" — a member of
  `opportunity.stage.valueSet`, which is itself `?unknown`. → **A4: a reference into an open value set is
  `blocked`** (it cannot resolve until the set closes), surfaced, not silently accepted.
- **F7 · Alias/element-name collision.** `opportunity.aliases` contains **"Engagement"**, which is *also
  a distinct element* (`el:engagement`, produced by Opportunity). An alias equal to another element's
  name is a name-join trap. → **A2: aliases are claims; an alias colliding with an element name is a
  flagged contradiction (coexist), never a silent merge.**
- **F8 · World of the identity kernel.** `opportunity.definition` reads as fact but the *element's
  existence* is as-is (it's in Salesforce) while the *definition text* is a to-be generated draft. → **A3:
  Tier 0 identity is world-agnostic; world lives only on Tier 1 claims; existence itself is expressible as
  a claim when contested.**
- **F9 · Index-based step ids.** Steps arrived as `steps[0..3]`. Using the index as id repeats the
  positional-identity defect. → **A6: step (and any child-collection) ids are content-derived** (a hash of
  actor+action), never the array index; reorder must not repalce identities.

**Amendment summary (all within the tiers — no tier moved):** A1 tagged-union value · A2 alias
contradiction · A3 world-agnostic kernel + existence-claim · A4 blocked-on-open-value-set · A5
multi-value slots · A6 content-derived child ids. These are folded into `ledger-spec.md` §"Amendments
from instantiation" and the Phase-2 types.

## Verdict on over-modelling

The tiers held — nothing here needed a *new* tier or a tier to move. But the instantiation is honest
about the cost: **Opportunity alone produced ~30 claims, ~11 of them open unknowns**, and the reification
(attributes and relations as elements with their own slot-claims) is real read-tax. That cost is the
critique's job to weigh (`ledger-critique.md`), and the projections' job to hide.
