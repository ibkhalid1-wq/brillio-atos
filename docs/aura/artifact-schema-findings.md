# Aura — Artifact-Schema Findings

Three defects in **Aura's artifact design**, surfaced while scoping Laila's Listen phase but
**not specific to Laila** — every engagement hits them. They are recorded here, not fixed:
each needs its own gated pass because the edge generator has **no executable verification in
this environment** (Deno, outside the client tsconfig, `deno` absent) and a schema change must
be validated against real generation.

Scope of a fix, in general, is three-layered and stated per finding:
1. **Generator** — the `current-state-atlas` / `domain-ontology` prompt + output contract in
   `supabase/functions/run-agent/index.ts` (gated: no local verification).
2. **Existing artifacts** — already-generated atlases/ontologies lack the new field; a
   regeneration or a one-time backfill is required, and until then readers must tolerate absence.
3. **Readers** — `WorkflowStudio.tsx` (the swimlane), the studios, exporters, and any
   Architect-phase consumer.

---

## F-A · The step schema has nowhere to record an automation disposition

**Defect.** A step is `{ actor, action, events, system, entities, evidence, duration }`. Architect
designs agents **against steps**, and there is **no field** for whether a step is
agent-executed, agent-assisted, or human-only — nor for the reason. Across Laila's atlas this is
absent on **all 46 steps**, and it is **blocking**: Architect cannot design a single agent
without it. This is not a Laila gap; the step contract itself has no slot for the one property
agent design most needs.

**Proposed schema addition** (per step):

```jsonc
// step.automation
{
  "disposition": "agent-executed" | "agent-assisted" | "human-only",
  "reason": "why — the human-judgment or risk that sets the boundary",
  "confidence": "asserted" | "assumed" | "generated"   // provenance of the disposition itself
}
```

- `disposition` is the closed three-value set already used in the methodology's automation
  vocabulary (keep it identical so it is one term, not a synonym).
- `reason` is mandatory for `human-only` and `agent-assisted` — the boundary is only useful with
  the judgment that draws it (this is also the seed the Design Loop needs).
- `confidence` lets a generated default be visibly ungrounded until a stakeholder confirms it —
  the same honesty the ontology's `confidence` already carries, so Architect never mistakes a
  guess for a decision.

**Cost.**
- *Generator:* add the field to the atlas output contract + a prompt instruction to emit a
  disposition with a reason (default `human-only` / `confidence: generated` when unknown, so the
  absence is loud, not silent). Gated pass.
- *Existing artifacts:* every current atlas is missing it. Cheapest path is a **reader default**
  (treat absent as `human-only` / `generated`) plus an in-studio editor so operators fill it
  during Listen — no forced regeneration. A full regeneration would re-derive dispositions the
  generator can only guess, which is worse than capturing them from the stakeholder.
- *Readers:* the swimlane renders a disposition affordance per step; the step inspector edits it;
  Architect reads it as the primary agent-design input. Small, client-verifiable.

---

## F-B · The step schema has no decision-point structure

**Defect.** No step can express *"a human judges X on the basis of Y, and here is what happens
each way."* Reverse-engineering recovers the happy-path `action`; it almost never recovers the
**judgment**. The judgment-heavy steps (qualification, deal shaping, revenue recognition,
escalation) are exactly where Architect's richest input lives, and there is **nowhere to put
it**. Across Laila, decision content is absent on every step.

**Proposed schema addition** (per step, optional — present only where a human judges):

```jsonc
// step.decision
{
  "question": "the judgement the human makes",
  "basis": ["what the decision rests on — signals, evidence, policy"],
  "branches": [
    { "outcome": "…", "leadsTo": "next step id / workflow / exit", "automatable": true|false }
  ],
  "owner": "the role that judges (not the actor who executes)"
}
```

- `branches` is what makes a decision designable — each outcome names where the flow goes and
  whether that branch could be automated. This is also the natural home for the **exception
  paths** that `failureModes` currently flattens into labels.
- `owner` separates *who judges* from *who acts*; they differ at exactly the seams that matter.
- Pairs with F-A: a step with a `decision` is by definition not `agent-executed` without a
  human-in-the-loop — the two fields cross-check.

**Cost.**
- *Generator:* extend the atlas contract; prompt the generator to emit `decision` only where the
  action implies a judgment (over-emitting decisions on CRUD steps is the failure mode to guard).
  Gated pass.
- *Existing artifacts:* optional field → absent is valid (a step with no judgment has none). No
  backfill needed; operators add decisions during Listen. Low.
- *Readers:* the swimlane marks decision steps distinctly and reveals branches on interaction;
  the inspector edits them; Architect designs the HITL points from them. Client-verifiable.

---

## F-C · Corrections to one artifact aren't checked against the other

**Defect.** An operator override **removed `Pricing Item` and `User` from the ontology** while
atlas steps still reference them (`Commercial Structuring` uses Pricing Item; `Sales-to-Delivery
Handoff` and `Staffing` use User). **Nothing detected the incoherence** — the correction to one
artifact silently broke the other. More broadly, the Laila atlas references **9 entities the
ontology does not hold**, none flagged. This is precisely what the spine's **UnresolvedReference**
and the Design Loop's **semantic-conflict detection** are meant to catch; today it is silent.

**Proposed addition** (a check, not a stored field — it derives from the two artifacts):

```jsonc
// A cross-artifact coherence pass, run after any ontology OR atlas edit/regeneration.
// Emits into the atlas's existing gaps channel (and/or a decisionQueue item) rather than
// a new store:
{
  "kind": "unresolved-reference",
  "from": { "artifact": "current-state-atlas", "workflow": "…", "step": 2, "actor": "Finance" },
  "reference": "Pricing Item",
  "to": "domain-ontology",
  "detail": "step references an entity the ontology does not define",
  "sinceOverride": "Entity removed: Pricing Item"   // when derivable from the override log
}
```

- Runs on the **client** (both artifacts are in the blob) — the cheapest, gate-free layer: it
  needs no generator and no migration. The removal-that-orphans case is detectable directly by
  cross-referencing the override log against current step references.
- Surfaces **in place** on the diagram (the highest-value gaps are worth seeing while looking at
  the step) and as a coherence item so it isn't only in a document.
- The inverse (ontology entities no workflow touches — 7 in Laila) is the same pass, other
  direction: "orphan entity — missing process or unnecessary?"

**Cost.**
- *Generator:* **none** — this is a client-side derivation over stored artifacts. No gated pass.
- *Existing artifacts:* none — it reads what exists.
- *Readers:* a coherence selector (`atlas steps ↔ ontology entities`, both directions) plus its
  surfacing in the swimlane and a gaps/decision channel. Fully client-verifiable. **This is the
  one of the three that can ship without the gate** — and the multi-area swimlane already renders
  its output (coherence-gap marks on steps).

---

## Priority

| Finding | Blocks Architect? | Needs the gate? | Cheapest first move |
|---|---|---|---|
| **F-A** automation boundary | **Yes, every workflow** | Generator does; reader-default + editor does not | Reader-default `human-only/generated` + step-inspector editor (client) |
| **F-B** decision points | Yes for judgment steps | Generator does; optional field means readers don't | Optional field + inspector editor (client) |
| **F-C** cross-artifact coherence | Yes (silent incoherence) | **No** — pure client derivation | Client coherence pass + in-diagram marks (already surfaced by the multi-area swimlane) |

F-A and F-B are one gated generator pass together (both extend the step contract). F-C is
independent and client-only; it should ship first, because it makes the other two's gaps visible
while they wait for the gate.
