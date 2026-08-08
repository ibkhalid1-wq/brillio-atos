# Laila · Listen Gap List — scoped by artifact, not by function

**Source:** Aura engagement "Laila CRM" (`3acf97de-fadd-48e1-99a7-15b80ef87cf7`), read-only. Ontology **32 entities / 40 relations**, atlas **14 workflows / 46 steps**, kit **20 personas / 10 areas**. Nothing modified.

> ## ⚠ Provenance caveat — read before using any row below
>
> **OVERRIDE-CORRECTED means *touched*, not *confirmed*.** The operator-override log records *that* an element was changed — "Entity edited: Account" — with **no diff and no reason**. So the 30 OVERRIDE-CORRECTED elements are **lightly grounded at best**: known to have been altered, not known to be right, and not traceable to who asked or why. Treat every one as still-open until a session re-attributes it. The whole point of re-ingestion once the governance substrate lands is to replace this "touched" signal with a real assertion carrying its source and rationale.
>
> **ASSERTED is deliberately 0.** No element in either artifact carries a captured, attributed stakeholder statement. Marking any element ASSERTED on this evidence would be the error the scoping was built to avoid.

## The honest headline

**Not one element in either artifact rests on a captured stakeholder assertion.** Every entity's `evidence` cites *"Laila Prototype – CRM Domain Ontology (dev demo extract)"* or the *"Brillio Agentic CRM (Workflow Design)"* design doc; every step cites the same. The only stakeholder fingerprints are **49 operator-overrides + 6 curation-log entries** that record *that* an element was changed — never *why*. Real named voices exist (Prakash T M, Brinditha Rai, Vimal Pandey in `systemsInventory`) but they are bound to **systems and pain**, not to entities or steps. So the artifacts are a **reverse-engineered prototype, lightly corrected, with the corrections' reasons lost.**

---

## 1 · Provenance distribution (ontology and atlas, separately)

**Ontology — 72 elements**

| Provenance | Entities (32) | Relations (40) | Total |
|---|---|---|---|
| ASSERTED | 0 | 0 | **0** |
| OVERRIDE-CORRECTED | 19 | 11 (9 added, 2 edited) | **30** |
| CODE-DERIVED | 13 | 29 | **42** |
| GENERATED-UNTOUCHED | 0 | 0 | **0** |

**Atlas — 14 workflows / 46 steps**

| Provenance | Workflows | Steps |
|---|---|---|
| ASSERTED | 0 | 0 |
| OVERRIDE-CORRECTED | 1 ("Opportunity Signal Generation") | ~4 |
| CODE-DERIVED | 13 | ~42 |
| GENERATED-UNTOUCHED | 0 | 0 |

**Caveat (also stated at top):** the OVERRIDE tier is coarse — the log says *"Entity edited: Account"* with no diff and no reason. OVERRIDE-CORRECTED means **known-*touched*, not known-*right-with-reason***. **0 ASSERTED** is deliberate: no per-element attribution to a named person was found.

**What this measures:** ~90%+ of the process model and 100% of the data model currently rest on nobody's authority. That is the size of Listen.

---

## 2 · Element classification with the depth filter

Aggressive disposition applied. **The bar is agent-design, so an entity no agent writes and no decision depends on does not need a session.**

**CLOSABLE BY DISPOSITION** (a named owner records an accepted assumption — no session):

| Element | Why dispositionable | Owner records it |
|---|---|---|
| Contact, Campaign, Campaign Member, Event | Reference/CRUD, clear SoR (CRM), no agent write, no decision | Sales Ops |
| Competitor | Read-context only | Sales Ops |
| Timesheet, Milestone | PM-system SoR, delivery-internal, no agent write in scope | Delivery Lead |
| Document | Generic attachment; SoR = CMS | Sales Ops |

**NEEDS A STAKEHOLDER** (fails the bar — agent writes it, a decision rests on it, its meaning is contested, or its cardinality/automation is a build-time guess):

- **Definition-contested:** Account (client vs partner — ambiguity flagged), Engagement (pre-sale vs post-sale — ambiguity flagged).
- **Agent-write boundary unknown:** Signal, Signal Action, Lead Score, Delivery Health, Forecast Snapshot — these are exactly what agents will write; "may an agent write this, or only propose?" is unanswered.
- **Highest reversal-cost:** Contract, SOW (supersession/amendment), Revenue Recognition, Revenue Projection, Billing Schedule, Invoice (entitlements → rev-rec).
- **Seam entities:** Staffing (opportunity→capacity), Escalation (delivery→sales loop).
- **Forecast model:** Practice Forecast Split, Practice Contribution, Opportunity Line Item, Quote, Proposal, Buying Committee.

---

## 3 · Relations & cardinality — where reverse-engineering fails

**Every one of the 40 relations carries a `cardinality` and *no* `optionality` field, and *no* evidence.** 37 of 40 are `produces` — a generic verb the generator reached for. The cardinality is a build-time pick in all 29 CODE-DERIVED relations. Highest-consequence (agents are designed against these):

| Relation | Encoded | The build-time guess to falsify |
|---|---|---|
| Account **produces** Opportunity | 1:N | Can one Opportunity span two Accounts (partner co-sell)? Optionality unknown. |
| Opportunity **produces** Contract | 1:N | One opp → many contracts, or 1:1? Amendment vs new contract lives here. |
| Contract **produces** SOW | 1:1 *(edited)* | Multi-SOW master agreements? The 1:1 is almost certainly wrong. |
| Opportunity **produces** Forecast Snapshot | N:M *(edited)* | Only N:M relation — deliberate or artifact? |
| Engagement **produces** Revenue Recognition | 1:N | The Legal/Finance seam; rev-rec cardinality is a finance rule, not a schema pick. |
| Partner **participates in** Opportunity | N:M *(added)* | The one added co-sell relation — is N:M right, and is it optional? |
| Lead **produces** Opportunity | 1:N | Lead→opp conversion; can a lead yield zero or many opps? |

**Systemic finding:** optionality is absent on all 40 relations. Architect needs "required vs optional" for every one; none is stated.

---

## 4 · Step-level findings (the gaps that only exist at step level)

- **AUTOMATION BOUNDARY — absent on all 46 steps. BLOCKING.** Step schema is `{actor, action, events, system, entities, evidence}` — there is **no automation-disposition field anywhere**. Architect cannot design a single agent without it. This alone blocks the phase for every workflow. *(Recorded as product finding F-A.)*
- **DECISION POINTS — absent.** No step carries a judgment/rule structure. Reverse-engineering recovered the happy-path action, never "a human judges X on the basis of Y." The judgment-heavy steps (qualification, deal shaping, rev-rec, escalation) have no decision content — the richest Architect input is entirely missing. *(Recorded as product finding F-B.)*
- **ACTOR ASSIGNMENT — systemic mismatch to the 56-role model.** Actors are **functions/teams** ("Marketing", "GTM - Practices", "Sales Operations"), not roles. They map to the discovery-kit personas cleanly, but **none maps to a specific role in the 56-role access model** — so a step's actor cannot be resolved to who may actually perform it. One actor, **"End Customer"** (Delivery Execution), is external — no internal witness.
- **ORDERING — linear by artifact convention.** Steps sit in arrays; no concurrency or optionality markers. Whether Commercial Structuring's Finance and Legal steps are sequential or concurrent is invisible.
- **EXCEPTION PATHS — present but thin.** `failureModes` exists (1–2 per workflow) and `handoffs` is populated — better than most reverse-engineering. But failure modes are labels, not "what happens / how often / who catches it."

---

## 5 · Cross-artifact coherence (findings neither artifact yields alone)

**Atlas steps referencing entities the ontology does not hold — 9 (highest-value gaps):**

| Missing entity | Workflow [actor] | What it signals |
|---|---|---|
| **Pricing Item** | Commercial Structuring [Finance] | Was **removed** from the ontology by an override, yet a step still uses it. A correction created an incoherence. |
| **User** | Sales-to-Delivery Handoff [TA]; Staffing [TA] | Also **removed** as an entity, still referenced. Who/what is the actor record? |
| Solution Archetype, Reference Catalog Entry | Solution Strategy & Deal Shaping [GTM-Practices] | Practices' solution catalog — an entire concept the ontology lacks. |
| Project Team Member | Sales-to-Delivery Handoff [Delivery] | The staffing/person-on-engagement concept — the opportunity→capacity seam made concrete. |
| Account Plan, Account Signal, Account Stakeholder Map, Account Competitor View | Account Expansion & Customer Success [Sales] | A whole account-planning sub-model absent from the ontology. |

**Ontology entities no workflow touches — 7 (missing process or unnecessary entity):** Campaign Member, Opportunity Line Item, Timesheet, Billing Schedule, **Signal, Signal Action, Document**. Note Signal / Signal Action were *override-added* yet no workflow uses them — added on someone's authority, but the process that produces/consumes them is missing. Which of the seven is "missing process" vs "delete it" needs a stakeholder.

**Steps whose actor has no counterpart in the kit — 1:** "End Customer" (external, expected). All internal actors have a persona.

---

## 6 · Seam analysis — unwitnessed seams named

**Structural fact:** all 20 kit personas are **single-area**. So *every* cross-area workflow is, by definition, **unwitnessed** — no person covers all its areas. The coverage matrix (people × area) is blind to this by construction. Ranked by reversal cost and disagreement likelihood:

| Seam (workflow) | Areas spanned | Witness | Note |
|---|---|---|---|
| **Commercial Structuring + Contract Review** | Legal ↔ Finance | **None** | The known one. Contract amendment → revenue recognition; supersession/entitlements = highest reversal-cost piece in the build. Confirmed unwitnessed. |
| **Sales-to-Delivery Handoff** | Sales → Delivery → TA | **None** | Opportunity → staffing capacity. Carries 3 missing entities (Project Team Member, User). |
| **Opportunity Signal Generation** | Marketing → Sales | **None** | Lead/MQL handoff. The one override-touched workflow. |
| Solution Strategy & Deal Shaping | Practices → Delivery/Finance/Legal | None | Solution catalog entities missing. |
| Invoicing & Revenue Recognition | Finance ↔ Delivery/Sales | None | Second half of the Legal-Finance seam. |
| Account Expansion | Sales ↔ Marketing/Alliances/Delivery | None | Account-planning sub-model missing. |

**Also unwitnessed at the relation level:** every cross-area relation (Opportunity→Contract, Engagement→Revenue Recognition, Engagement→Billing Schedule, Contract→SOW) crosses Sales/Legal/Finance/Delivery and no persona spans both ends. **Customer Success is `thin:true` in the coverage map** — covered only by borrowed Sales personas, no owner.

---

## 7 · The gap list, ranked

Rank: **1 = blocks Architect for the whole phase**; 2 = blocks a workflow/agent family; 3 = blocks one element; D = dispositionable.

| # | Element | Provenance | The actual question | Who closes it (kit role) | Mode | Breaks in Architect if open | Rank |
|---|---|---|---|---|---|---|---|
| G1 | **All 46 steps — automation boundary** | CODE | For each step: agent-executed, agent-assisted, or human-only — and why? | Sales Ops (owns model) + each function for its steps | Cross-cutting session | Cannot design any agent; seed of the whole Design Loop | **1** |
| G2 | Contract / SOW amendment + Rev Rec / Billing / Invoice | 13 O / 13 C | Does an amendment **supersede** the entitlement or amend in place, and who is SoR when Finance and Legal disagree? Does supersession match how Brillio recognises revenue? | Leader-Legal **+** Leader-Finance | **Seam session** | Highest reversal-cost model built on nobody's authority; wrong = rebuild | **1** |
| G3 | Account (client vs partner) | C, ambiguous | Is Account always the client, or also a partner? (Partner is-a Account was *added*.) | Executive Leadership / Sales Leaders | Session | Root entity; wrong cardinality cascades to every relation | **1** |
| G4 | Engagement (pre vs post-sale) | C, ambiguous | Is Engagement always post-sale delivery, or can it be pre-sale? | Leader-Delivery | Session | Splits or merges the delivery half of the model | **1** |
| G5 | Signal / Signal Action / Lead Score / Delivery Health / Forecast Snapshot — write boundary | O/C | What may an agent **write** vs only propose? What must never be automated, and why? | Sales Ops + Marketing + Delivery | Folds into G1 | The agent-authored entities; unbounded = ungoverned writes | **1** |
| G6 | Sales-to-Delivery → Staffing (opportunity→capacity) + Project Team Member, User (missing) | CODE + missing | When does staffing start relative to signature? Is capacity a CRM entity or a signal? Who owns the link? | Leader-Delivery + Leader-TA + HR | **Seam session** | The classically unowned seam; missing entities block the workflow | **2** |
| G7 | 9 missing entities (§5) | absent | For each: real concept to add, or step artifact? Pricing Item & User were *removed* but still referenced | Owner per workflow | Within function sessions | Atlas steps reference entities the schema can't hold | **2** |
| G8 | 29 CODE-DERIVED relation cardinalities + all 40 optionalities | CODE | Per relation: is the cardinality a rule, and is it required or optional? | Sales Ops (structure) + function for its relations | Within sessions | Agents designed against wrong cardinality | **2** |
| G9 | Lead → Opportunity (MQL handoff) | O | What is a qualified lead; who owns follow-up after handoff? | Leader-Marketing + Sales Leaders | Marketing session (seam-aware) | Top-of-funnel agent mis-scoped | **2** |
| G10 | 7 orphan entities (§5) | O/C | Missing process, or delete? (Signal/Signal Action added but unused) | Sales Ops / owning function | Disposition + spot-check | Dead entities in production schema, or missing workflows | **2** |
| G11 | Practice Forecast Split / Contribution, Opportunity Line Item, Quote, Proposal | O | Forecast roll-up and quote/proposal rules | Leader-Sales Operations + GTM Leaders-Practices | Sales Ops / Practices session | Forecast agents wrong | **3** |
| G12 | Escalation loop (Customer Success thin) | O | Who owns the delivery→sales escalation feedback loop? | Leader-Delivery / Sales Leaders | Fold into G6 | Unowned CS surface | **3** |
| G13 | Solution Archetype / Reference Catalog Entry | absent | Does Practices have a solution catalog entity? | GTM Leaders-Practices + Leader-Alliances | Practices session | Deal-shaping agent has no catalog | **3** |
| D1 | Contact, Campaign, Campaign Member, Event, Competitor, Timesheet, Milestone, Document | C | Accept SoR + no-agent-write assumption | Sales Ops / Delivery Lead | **Disposition** | — | D |

---

## 8 · The session plan (smallest set, sequenced)

Six sessions reach Architect. Two are **seam sessions** (two functions in the room — the only way to close a seam).

1. **Sales Ops / RevOps — the automation-boundary session** *(cross-cutting, run first)*. Closes **G1, G5, G8, G11, D1**. Owner: Leader-Sales Operations. This is the keystone: it sets agent-execute/assist/human for the whole atlas and the write-boundary for the agent-authored entities. *After: G1/G5/G8 closed for all workflows; Architect unblocked on automation for everything the other sessions then refine.*
2. **Legal × Finance — seam session**. Closes **G2**, part of **G7** (Pricing Item), **G8** (contract/rev-rec relations). Owners: Leader-Legal + Leader-Finance together. *The highest reversal-cost gap; must be a joint room or the seam stays unwitnessed.*
3. **Sales & Pipeline**. Closes **G3, G9** (Marketing co-present or via §9 handoff), **G11**, Account-Expansion missing entities in **G7**. Owner: Sales Leaders-Markets + Sales reps-Markets. *After: root ambiguities (Account) resolved; forecast + account-planning entities grounded.*
4. **Delivery × TA — seam session**. Closes **G4, G6, G12**, **G7** (Project Team Member, User). Owners: Leader-Delivery + Leader-TA + HR. *Closes the opportunity→capacity seam and the Engagement ambiguity.*
5. **Marketing & Demand**. Closes **G9** fully, Lead/Lead Score/Campaign write-boundary refinements. Owner: Leader-Marketing + Marketing. *(Fold into session 3 if the MQL handoff owner can co-attend — saves a session.)*
6. **Practices & Alliances**. Closes **G13**, Practice Contribution, alliance co-sell. Owners: GTM Leaders-Practices + Leader-Alliances.

**Remaining open after all six:** the 56-role **actor→role resolution** for each step — dispositionable by Sales Ops against the access model once automation dispositions exist, not a session; and the **Customer Success owner** question, which surfaces in session 4 and may reveal a genuinely unowned function (a finding, not a gap to fill).

---

## 9 · Questions per session (element-specific; behaviour, not schema)

**Session 1 — Sales Ops (automation boundary):**
- Walk the 14 workflows: for each step, "should software do this on its own, do it and ask you, or never touch it — and what goes wrong if it acts alone?"
- "Signal, Lead Score, Delivery Health, Forecast Snapshot — today a person creates these. Should an agent *write* them, or only propose and a human commits? Which of these must a human always own?"
- "Where do the pipeline numbers quietly diverge from reality today, and who reconciles them?"

**Session 2 — Legal × Finance (seam):**
- "When a signed contract's value changes mid-term, does a new version **supersede** the original, or is the original edited in place? Walk me through the last time it happened."
- "Who is the system of record when Legal and Finance disagree on what was contractually committed vs what can be recognised as revenue?"
- "Is an Invoice generated from the CRM, the finance system, or both?" *(ontology's own gap)* "Does one contract ever carry multiple SOWs?"

**Session 3 — Sales & Pipeline:**
- "Does *Account* ever mean a partner, or only the client?" "Can one Account have several active Opportunities at once?" "Can one Opportunity involve two Accounts (co-sell)?"
- "In account planning you track a plan, a stakeholder map, competitor view, signals — where do those live today, and are they one thing or four?"

**Session 4 — Delivery × TA (seam):**
- "Is an *Engagement* always post-sale, or do you use the word before a deal closes?"
- "When does staffing a deal start relative to signature? Who first says 'we don't have the people for this'?" "Is a person-on-an-engagement a record in the CRM, or does that live only in the staffing tool?"
- "What does the sales→delivery handoff always drop?"

**Session 5 — Marketing:** "What makes a lead *qualified* enough to hand to sales — and after you hand it over, who owns follow-up?" "How is campaign influence on pipeline validated today?"

**Session 6 — Practices & Alliances:** "When you shape a deal, do you pull from a catalog of solution patterns — is that a real system?" "How is alliance co-sell funding captured and who validates it?"

**Capture protocol (every session):** recorded with the kit's existing consent note ("recorded… solely for project analysis… let us know if you have concerns"); **verbatim** statements **attributed to the named person**, held **outside Aura** (recording + transcript in Brillio-governed storage, referenced by a capture-time id), so each correction re-ingests as an **assertion** once the governance substrate lands. Preserve the *reason*, not just the decision — that is exactly what the 49 existing overrides lost.

---

## 10 · What can be dispositioned without a session, and by whom

| Disposition | Owner | Recorded assumption |
|---|---|---|
| Contact, Campaign, Campaign Member, Event, Competitor, Document | **Sales Ops** | CRM/CMS system-of-record; read/reference; no agent write in scope |
| Timesheet, Milestone | **Delivery Lead** | PM-system SoR; delivery-internal; no agent write in scope |
| Step **actor → 56-role** resolution | **Sales Ops** | Map each function-actor to the specific access-model role(s), post-Session-1, against the access spec |
| 7 orphan entities — *provisional* keep/drop | **Sales Ops** | Flag Signal/Signal Action "keep, process TBD in Session 1"; propose Campaign Member/Opportunity Line Item as sub-records; **Document** confirm delete-or-keep |

**One thing I could not determine from what is stored, so I flag rather than guess:** whether any "Entity edited" override was a substantive stakeholder correction or a cosmetic operator tweak — the log records the touch, not the diff. Treat all 30 OVERRIDE-CORRECTED elements as *lightly* grounded, not confirmed, until a session re-attributes them.

---

## 11 · Lifecycle-stage questions — the enum members F-F cannot yet hold

The best-value questions in Listen. Every entity on the derived cross-entity journey (item 1 of the
lifecycle-axis session; the `produces` chain Lead → Opportunity → Contract → Engagement → Revenue
Recognition) carries an enum-shaped attribute — `stage`, `status`, `severity`, `healthRag` — whose
**meaning is its permitted values, in order**. **33 of 178 attributes are enum-shaped** and not one
records its members: the ontology has no value-set field (finding **F-F** in
`artifact-schema-findings.md`). Nobody hesitates on their own stages, sales can recite them, and the
answer is exact — so these are the cheapest, highest-certainty grounding in the whole build.

> **⚠ These answers have nowhere to land in the artifact yet.** F-F is gated (adding a `valueSet` field
> is a schema change this pass defers). So capture every answer **verbatim, attributed, held outside
> Aura** (same capture protocol as §9), and ingest it the moment F-F's field exists. **An answer
> captured with no destination is still worth having; an answer *assumed* to be stored when it isn't is
> not** — do not let a recited stage set read as "grounded" in Aura when Aura cannot hold it.

**Ask four things per entity** (identical template; the value is in the entity-specific answer):
1. **What are the stages, in order?** (the ordered enum members)
2. **What moves a record from one to the next?** (the transition trigger — event, approval, field)
3. **What can go backwards, and from where to where?** (reopen / regress / rework edges)
4. **What is terminal?** (states a record can enter but never leave — Closed Won, Closed Lost, Cancelled)

| Owning session (from §8) | Entity · enum attribute | Why it's the entity's spine |
|---|---|---|
| **Marketing & Demand** (S5) | **Lead** · `status` | Top-of-funnel qualification states; the MQL handoff (G9) is a *transition* answer |
| **Sales Leaders / Sales** (with S1) | **Opportunity** · `stage`, `type` | The canonical CRM pipeline (Prospecting → Qualification → Proposal → Closed Won/Lost). Rendered as a *title* in the prototype for lack of a value set — the F-F demonstration |
| **Sales Ops / Practices** (S1, G11) | **Quote** · `status`, **Proposal** · `status`, **Forecast Snapshot** · `projection_status` | Quote/proposal issue→accept→supersede; forecast draft→submitted→locked |
| **Legal × Finance — seam** (S2, G2) | **Contract** · `status`, `contractType`; **SOW**; **Invoice** · `status`; **Billing Schedule** · `billing_type` | The highest reversal-cost states: contract execution + amendment/supersession, and invoice raise→sent→paid→credited. *What can go backwards* here is the entitlement question |
| **Delivery × TA — seam** (S4) | **Engagement** · `status`, `healthRag`; **Milestone** · `status`; **Delivery Health** · `rag` | Delivery lifecycle + the RAG health enum (Green/Amber/Red is an *ordered* set with its own transition rules) |
| **Delivery / CS** (S4, G12) | **Escalation** · `severity`, `status` | Severity ladder + open→ack→resolved→closed; the delivery→sales escalation loop is a *backwards* edge |

**Note on `healthRag` / `rag` / `severity`.** These are enums too, but *status-of-health* enums, not
lifecycle-progression enums — their "order" is a severity scale (Green→Amber→Red), and question 2
("what moves it") is a *rule*, not an event. Capture them with the same four questions; the value set
still cannot be stored until F-F, and the ordering still matters to how the UI renders them (a RAG
control, not a free-text field — the same misrender F-F describes).

**Complementary to the cross-entity journey.** Item 1 derives the lifecycle *between* entities (the
`produces` graph); these stage sets are the lifecycle *within* an entity. Both are "the lifecycle
axis"; the atlas grid shows the first, and F-F's value sets would let a screen render the second. The
journey derivation needs no field (it reads relations); the stage sets need F-F. That difference — one
derivable, one only assertable — is exactly the split the lifecycle-axis session was meant to establish.

---

*Produced read-only against the "Laila CRM" engagement (`3acf97de`); no ontology, atlas, or kit content was modified. Held outside Aura, versioned, so it survives to re-ingestion once the governance substrate lands.*
