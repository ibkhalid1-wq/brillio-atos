# Aura — Ledger critique (hostile review)

I designed none of this structure, which makes me the fresh reader it needs. Below is the strongest
case that it is **wrong**. For each: **amend** the spec (and say what changed) or state precisely **why
the attack fails**. Two amendments came out of this (A7, A8) plus one consumer commitment.

## C1 · The reification read-tax — "what is Opportunity?" now costs 30 claims

**Attack.** Every attribute and relation became an element with its own slot-claims. Opportunity alone
is ~30 claims across worlds and sources (instantiation §Verdict). A 33-entity / 178-attribute / 35-
relation ontology is **thousands of claims**. Answering the simplest question — "what is Opportunity?"
— now means assembling ~30 rows and reconciling their precedence. The old blob answered it in one read.

**Resolution — partly conceded, amended.** The read-tax is real **on the store**, but the reader must
never pay it: Tier 4 projections collapse claims back to a readable element-with-status view, and
precedence is resolved *inside* the projection, once. The mitigation is a rule, not a hope →
**A7: projections are the only UI read path; raw-claim access is admin/debug only.** No component reads
claims directly (Phase 2.4 enforces this by adapting each reader to a projection). Conceded honestly:
the store is heavier and the migration is a large object; the bet is that the projection hides it and
the *honesty* (per-slot certainty) is worth the storage. If a projection ever has to show raw claims to
be useful, that is a projection bug, not a licence to leak the tax to the reader.

## C2 · The ~450-item day-one queue makes the tool feel broken (**strongest point**)

**Attack.** "Generation must emit unknowns rather than omit slots" (C6 is its sibling) *manufactures* a
huge queue. Migrating Laila will surface hundreds of open unknowns on day one. **Nobody triages 450
questions.** The old artifact looked *complete* (it omitted the unknowns); the ledger looks *broken* (it
shows them all). Surfacing incompleteness at that volume is not obviously better than hiding it — it can
read as "this tool doesn't know anything," which is worse for adoption than a confident wrong answer.

**Resolution — the attack half-lands, and forces the queue's design.** The volume is real and must not
be denied (2.2 measures it and replaces the ~450 *estimate* with the true number). But 450 *claims* is
not 450 *questions to a human*: the depth filter splits them. **Architect-gating** unknowns are the only
must-answer set; the rest are **disposition-eligible** (an owner accepts a default in bulk, one action
for many). So the amendment is to the queue projection (2.3): **the default view is blocking-only, with
the total as a secondary figure, and disposition-eligible unknowns are bulk-actionable, not per-item.**
The honest incompleteness stays visible but becomes *a short actionable list plus a bulk pile*, not a
wall of 450. **Why the attack ultimately fails:** the old "looks complete" was the exact defect this
structure exists to kill — a generated guess rendered as settled fact. An honest unknown you can route
beats a false certainty you can't audit. The fix for "450 is demoralising" is *ranking and bulk
disposition*, not *going back to hiding them*.

## C3 · Precedence "escalate" is a punt — the hard cells aren't decided

**Attack.** The lattice claims to resolve every pairing, but the two hardest — two conflicting attributed
assertions, and regulation-vs-assertion — resolve to **escalate**, i.e. "a human decides." So the
structure does not actually resolve the hard conflicts; it routes them and takes credit for
completeness.

**Attack fails — escalate is the correct answer, not a punt.** The alternative is auto-picking between
two attributed human assertions, which *is* the silent-overwrite defect the whole build exists to
prevent (asserted outranks generated; no regeneration overwrites an attributed closure — a fortiori no
*algorithm* silently picks a winner between two humans). A structure that pretended to decide
two-humans-disagree locally would be lying. **But the attack exposes a real hole:** an escalation to
*nobody* is a black hole. → **A8: escalate always resolves to a reachable authority.** `slot-owner` on an
unowned slot falls through to the engagement's domain authority; `legal-compliance` is always reachable.
An escalation never routes into the void — the code returns a concrete `escalateTo`, and the ledger maps
`slot-owner` → owner-while-open → (if unowned) domain authority.

## C4 · Over-modelled tiers — does Tier 2 (durability) earn its place?

**Attack.** Tier 2 tags every claim `domain | configuration`. If nothing *consumes* the tag, it is
decoration — a field everyone must fill and no one reads. Tier 3 (shapes) risks the same: are
lifecycle/decision/obligation/portfolio real, or four plain slots wearing a tier?

**Resolution — Tier 3 survives; Tier 2 is put on notice with a committed consumer.** Tier 3 earns it:
shapes are *how F-A..F-G stop being seven schema patches and become one declared structure* (the
generation contract, 3.2) — without shapes, every finding is a bespoke field. Tier 2 is the weaker tier,
and the attack is fair, so it gets a **committed consumer or it is flagged**: the import adapters (3.1)
set durability at the source (Salesforce Metadata → `configuration`; a regulation/standard → `domain`),
and the deviation register (2.5) and projections surface it (a `configuration` deviation is expected
when a system changes; a `domain` deviation is a business change and ranks higher). **If Phase 3 ships
without a durability consumer, Tier 2 is decoration and must be reported as such** — I am not allowed to
leave it unjustified.

## C5 · The as-is/to-be split doubles every slot

**Attack.** Every slot can carry an as-is claim *and* a to-be claim → the ledger is 2× the slots. For a
greenfield engagement with no legacy system, the as-is world is pure overhead.

**Attack fails — worlds are sparse.** A slot has claims only for worlds someone made a claim about.
Greenfield = to-be claims only; **zero** as-is overhead. as-is is populated **only by imports**
(Salesforce Metadata, FHIR) and explicit as-is assertions. So the ledger is *1× + imports*, not 2×. The
migration numbers will show this directly (2.2): the as-is count should be small — only the facts an
import or a correction actually stated — and Laila (a reverse-engineered prototype) is the *worst* case
for as-is density, not the typical one.

## C6 · "Emit unknowns not omissions" is what explodes the queue

**Attack.** The rule that generation emit every schema-relevant slot as `?unknown` is the direct cause of
C2. Remove the rule and the queue shrinks.

**Attack fails — and removing the rule reintroduces the original defect.** Omitting a slot is what made
a generated guess look like settled fact (the old artifact). The unknown is not noise; it is the true
state ("nobody has said what Opportunity's stages are"). Suppressing it doesn't make the answer known —
it makes the *absence* invisible, which is the drift this structure kills. The queue size is managed by
C2's ranking, not by lying about completeness.

## C7 · No name joins, but the source is all names — migration is a pile of unresolved-refs

**Attack.** The Laila blob references entities and roles **by name** (atlas steps list entity-name
strings; workflows name actors). "Reference by id, no name joins" means every one of those must resolve
at migration — and the ones that don't match (removed `User`, the 9 missing entities) become
unresolved-refs. Day one produces a heap of broken references.

**Attack fails — the heap is the point, made first-class.** Those references were *always* broken; the
old structure hid the breakage behind a string that rendered fine. The ledger's unresolved-refs are the
F-C coherence gaps surfaced as objects you can route (the removed `User`, the 9 missing entities, the
"Engagement" alias collision). The migration's unresolved-ref **count is a headline measurement** (2.2 /
2.5), not an embarrassment. A name that happened to match would be worse — a silent join papering over a
real gap.

## C8 · The central promise can't be fully exercised here (the honest limit)

**Attack.** The ledger's whole value — surviving regeneration without overwriting attributed closures —
only matters against a real **persistence + generation** loop, both **gated** (no DB, no edge). So Phase 2
builds a structure whose defining guarantee is untestable in this environment.

**Resolution — the guarantee is exercised client-side; only the loop is gated.** *Asserted-outranks-
generated* is a property of the **store's `resolve`/`assert`**, not of persistence: a unit test asserts
that a `generated` claim cannot supersede an `asserted` closure on the same locus (it coexists or is
refused, never overwrites). That test runs here and pins the core promise. What is genuinely gated is the
*end-to-end* loop (a real regeneration writing to a real store) — stated in the gated list, not stubbed
into a false green. This is the strongest honest limit and it is labelled as one.

---

## Amendments this critique produced

- **A7** — projections are the only UI read path; raw-claim access is admin/debug only (pays down the C1
  reification read-tax at the reader).
- **A8** — `escalate` always resolves to a reachable named authority; `slot-owner` on an unowned slot
  falls through to the engagement domain authority (closes the C3 black-hole).
- **Consumer commitment (C4)** — Tier 2 durability must have a consumer by end of Phase 3 (import
  adapters set it; deviation register + projections read it) or be reported as decoration.

None of these moves a tier. The tiers held under hostile review; the queue's *presentation* and two
*edge behaviours* changed, which is exactly the level Phase 1 was meant to settle.
