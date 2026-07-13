# T5-Ω — Ontology Report Card

**Executed against:** the live **Laila – CRM** domain ontology (15 entities, 13 relations, 8 events, 9 standard mappings) + the `run-agent` / `flowDecisions` / `flowDrilldown` code paths + git history. Method: live blob interrogation + grep + the Q3 content-trace (627 KB corpus). Two dimensions could not be executed without a second seeded tenant (Client Y) and are marked **Not Executed**, not guessed.

**Headline:** the ontology is **real where it is load-bearing** (authority, provenance, falsifiability, extensibility, standards) and **over-claimed where it is decorative** (semantic layer = Absent; knowledge-graph traversal = Absent; write-time enforcement = Partial). The product's actual trust mechanism is **evidence provenance**, not graph reasoning.

| Dimension | Finding | Metric | Verdict | Evidence |
|---|---|---|---|---|
| **Authority** (T5a) | Not one global ontology — **generated per-programme from that engagement's evidence**, then reconciled to external standards. Authority = the stakeholder evidence, not a decree. Built incrementally. | 100% of entities carry an `evidence` pointer; 9/15 mapped to standard URIs | **Real** | entity keys `{name,aliases,evidence,attributes,definition,systemOfRecord}`; git `c7cfd38` + predecessors |
| **Formality** (T5b) | Classes + relations **with domain/range/cardinality** (N:1, 1:1) + events + declared ambiguities. A constrained schema with SKOS alignment — short of axioms/inference. | 13 relations, all with `from/to/relation/cardinality` | **Partial** | `domainOntology.relations[]`; no reasoner |
| **Coverage** (T5c) | Laila's CRM expressed fully incl. domain-specific entities (FRF, Bench, SOW, Delivery Excellence Audit). No free-text dumping ground; ambiguities are typed. | 15 entities, 4 declared ambiguities, 0 `notes`-escape | **Real** *(single-domain sample)* | live blob |
| **Standards alignment** (T5d) | Proposes + adopts SKOS mappings to schema.org/FIBO/GS1/FHIR via propose→confirm; URI-format validated on ingest. | 9 proposed / 13 adopted, all `startsWith("http")` | **Real** | `run-agent:9027` (URI validation) |
| **Mapping accuracy** (T5e) | `aliases` does entity resolution ("Forecast Resource Request (FRF)"). Cross-client synonym→canonical rate **cannot be measured** without Client Y. | — | **Not Executed** | needs 2nd seeded tenant |
| **Node/edge accuracy + provenance %** (T5f) | Every entity carries evidence; relations carry cardinality. Content-trace verified on a sample (Q3 = 5/5). A ≥50-node hand-verification exceeds this programme's size. | **100%** entities evidence-linked; 5/5 sampled traced | **Partial → Real** | Q3 corpus trace |
| **Semantic-layer bindingness** (T5g) | **No governed semantic layer.** Metrics/KPIs are free-form grid rows, not a registry defined once and enforced at query time. Changing a definition propagates nowhere. | 0 `semanticLayer`/`metricRegistry`/`governedMetric` modules | **Cosmetic / Absent** | `frameKpis` returns `Array<Record<string,string>>` (grid text) |
| **Write-time constraint enforcement** (T5h) | Hard enforcement only on mapping **URI format**. Declared cardinalities are **not enforced** — nothing rejects an agent claim that violates N:1/1:1. An LLM `cross-artifact-validator` flags incoherence but is user-initiated & advisory, and rejects nothing. | 1 hard check (URI); 0 cardinality checks | **Partial** | `run-agent:9027`; `run-agent:7806` (validator is soft, user-only) |
| **Extensibility cost** (T5i) | New concepts enter by **regenerating from new evidence** — no engineer, no deploy. Verified live: FRF/Bench/SOW appeared from the Workflow Design attachment via a client-triggered regen. | 0 code changes to add entities | **Real** | this session's ontology regen |
| **Falsifiability** (T5j) | Falsifiable and currently passing: every entity/edge must trace to an evidence item; "does X trace?" is runnable. An entity with no evidence pointer = falsified. | 100% currently pass | **Real** | provenance field + Q3 |
| **Architectural fit** (T5k) | **No graph DB, no multi-hop traversal anywhere.** `ontologyAlignment` is read for display, drill-down anchors, and deterministic URI injection — all key-lookup. The "KG" is a structured document + SKOS mappings. The *real* traceability guarantee comes from evidence provenance + attestation trail + snapshot replay — i.e. the lighter alternative the prompt describes already exists. | 0 traversal queries | **Under-built as a KG; justified as evidence-provenance** | grep: no `traverse/neighbors/multi-hop`; read sites are lookups |

## Adjudication (T5k steelman)

**Name the queries that genuinely require graph traversal:** none. The product issues no multi-hop relational query; drill-down "process" anchors use entity *names* as scope labels, and blueprint contracts inherit a *single* standard-URI per entity by direct lookup. **The KG-as-graph is architectural theater.**

**But the ontology is not:** the cardinality-declared schema + 100% evidence provenance + propose→confirm standard alignment is doing real work — it grounds every agent prompt, it entails standard URIs into contracts deterministically, and it makes artifact claims falsifiable (Q3 proved 5/5 trace). That is the *evidence-provenance* guarantee, and it is the healthiest thing in the codebase.

**Verdict: the grounding model is *justified as an evidence-grounded domain schema*, and *over-claimed as a knowledge graph + semantic layer*.**

**What I would build:** pick one of two honest paths — (a) **earn the "ontology" claim**: enforce the declared cardinalities at write time (reject agent claims that violate domain/range/N:1), turning the soft LLM validator into a hard constraint; or (b) **drop the KG/semantic-layer framing** and market it as what it verifiably is — an evidence-grounded, standards-aligned, fully-provenanced domain schema, which is already a stronger, more defensible claim than "knowledge graph" it can't back with a single traversal.

## Two dimensions not executed (need Phase 1 corpus)
- **T5e mapping-accuracy rate** — needs Client Y with deliberately overlapping vocabulary.
- **T5f ≥50-node hand-verification** — needs the scale corpus.

## ⚠ Correction (Run 7) — T5k was wrong: graph traversal DOES exist

The T5k row above ("No graph DB, no multi-hop traversal anywhere … the KG-as-graph is architectural theater") is **retracted**. That conclusion came from a grep for the literal tokens `traverse`/`neighbors`/`multi-hop`, which returned nothing — a **false negative**. The traversal exists under different names:

- **`graphInference.ts`** implements `bfs()` and runs it both forward (`impactedBy` — change blast-radius) and reverse (`dependenciesOf` — provenance) for genuine **multi-hop transitive closure** over typed dependency edges (`grounds`, `addresses`, `delivers`, `traces_to`).
- **`detectCoverageGaps`** issues single-hop typed-edge queries (requirements with no `addresses` edge, in-scope items no `delivers` edge, facts that ground nothing).
- **`programGraph.ts`** builds the typed instance graph; **`adamOrchestrator.ts:218,226`** calls `buildProgramGraphContext` + `buildCoverageDirectives` and injects the result into **live cross-phase agent context** (reached from `AppShellV3.tsx`).

**First correction (retracted below):** I initially concluded the "knowledge graph" claim was *substantially justified* because `bfs()`/`detectCoverageGaps` exist and `buildCrossPhaseContext` imports them. That was too generous — see the second correction.

**Second correction (T5k, verified against live data) — the accurate verdict:** the program graph + traversal are **stranded classic code**. `graphInference.ts` (bfs transitive closure, coverage-gap queries) and `programGraph.ts` are fully implemented and wired into `buildCrossPhaseContext` (folded into the edge prompt). **But** they are keyed to the retired classic `atos-standard` phase/field model. Verified live: `buildProgramGraph(normalizeProgram(Flow Pilot))` = **6 phase nodes, 0 facts, 0 artifacts, 0 edges**; `buildFactGraph` = **0 facts**. Root cause: Flow Pilot is `methodology: atos-flow` with `phaseInputs` under `frame`, while the derivation iterates the classic sequence (`strategy/mobilise/discover/…`) and reads `phaseInputs[classicPhase]` — a permanent miss. So for **atos-flow, the only shipping product**, the graph is phase-scaffold only and the traversal has nothing to traverse.

**Net (T5k):** the "knowledge graph / graph-grounded agent context" is **dormant for the shipping product** — neither theater (the code is real) nor live (it produces nothing under the flow methodology). **F-003 re-rated S2.** The genuine fix is to re-key the fact/graph derivation to `getPhaseSequence(program.methodology)`; that changes agent-context derivation and can't be honestly verified without the (unbuilt) LLM replay layer, so it is deferred, not slipped in. **Two lessons:** (1) absence of a keyword is not absence of a capability — but (2) presence of a capability in code is not presence of it *for the shipping product*. Only checking the live derivation caught the second.
