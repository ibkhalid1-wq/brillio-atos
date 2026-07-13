# T4 — Grounding & Traceability (the headline metric)

**Executed against:** the live **Laila – CRM** blob (627 KB evidence corpus assembled from `phaseInputs` transcripts + documents). Method: extracted **16 discrete claims** from the *generated* artifacts (4 charter objectives, 3 success criteria, 3 key risks, business objective, 3 ontology entity definitions, 2 ontology relations) and lexically traced each back to the evidence corpus (key-term presence, ≥50% of a claim's salient terms must appear in evidence to count as traceable).

## Result

| Metric | Value |
|---|---|
| Claims traced | 16 |
| **Traceable to evidence** | **94% (15/16)** |
| Untraceable | 1 — `charter.risk[2]` |
| Ontology ambiguities **declared** (not fabricated) | 4 |
| Charter gaps **declared** | 1 |
| Ontology gaps declared | 0 |

## The one miss — not a fabrication

The single untraceable claim is **`charter.risk[2]`: "Uncertainty in achieving target AI run-costs per user."** This is a *forward-looking risk projection*, not an assertion of fact about the evidence — lexical tracing does not apply to it the way it applies to an objective or an entity definition. A risk names something the evidence does **not** yet contain, by definition. So this is a **method boundary, not an S1 fabrication**: the system did not invent a fact and attribute it to a stakeholder; it flagged a projected concern. Confidence: **inferred** (the 15/16 lexical passes are **verified**; the classification of the miss as "not a fabrication" is a judgement).

## Honesty behaviour (does it admit insufficiency vs. confabulate?)

The generated ontology carries **4 declared ambiguities** and the charter **1 declared gap** — the system **records what it does not know** rather than smoothing over it. Combined with the T5-Ω finding that **100% of entities carry an evidence pointer**, this is the healthiest property in the product: artifacts are **falsifiable** and the trace is **runnable on demand**.

## Verdict

**PASS.** 94% direct-lexical traceability with the only miss being a forward-looking risk (expected), plus explicit declaration of ambiguities/gaps rather than confabulation. This corroborates the Run-0 Q3 spot-check (5/5) at wider sample. The grounding guarantee — **evidence provenance** — is real and load-bearing, consistent with the T5-Ω conclusion. No new finding raised.

*Caveat retained: lexical term-overlap is a proxy for grounding, not proof that each claim's specific assertion is entailed by evidence. A stronger pass would require span-level entailment (the LLM-replay layer, still to be built) — but that raises the bar above what any comparable tool demonstrates today.*
