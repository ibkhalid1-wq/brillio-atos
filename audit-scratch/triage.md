# ATOS — Run 0: Triage

**Scope audited:** the live ATOS **Flow (v3)** methodology surface (`src/v3/**`, `supabase/functions/**`), tested against the running app and the live **Laila – CRM** programme (id `8d3f1a91…`, 627 KB evidence corpus). The broader "multi-agent platform" framing in the audit contract maps, in this codebase, to: programme = `adam_programs` row (one JSONB blob); phases = the six Flow movements; agents = `run-agent` edge function; grounding = `ontologyAlignment` + `domainOntology`.

**Method:** Q1/Q2/Q5 from source (grep, git, file:line). Q3/Q4 executed live against the Laila blob and the RLS policy. No inference where a test was runnable. No production data mutated.

---

## The five verdicts

| # | Question | Verdict | One piece of evidence |
|---|---|---|---|
| Q1 | Ontology real or costume? | **Partial → Real** (grounding + entailment; not write-time constraint) | `run-agent/index.ts:9035–9049` — adopted mappings deterministically inject `standardUri` into every blueprint data contract (entailment, no model in loop) |
| Q2 | Does context scope the app? | **Pass (structural + RLS)** — 0 unscoped predicate leaks | `usePrograms.ts:327–344` — list query has no WHERE; scoped by RLS `owner_id = auth.uid()`; all 18 other sites are `.eq("id", …)` single-row |
| Q3 | Artifact claim → evidence? | **5 of 5 traceable** | Charter objective/mandate/success-criterion + ontology entities FRF, Bench — all key terms present in the 627k-char evidence corpus; ontology entities carry an `evidence` field |
| Q4 | Gates enforced or advisory? | **Client-side only** | `gateReviews` is a field in the owner-writable blob; RLS is `for all using (owner_id = auth.uid())` (`20260610_adam_backend.sql:39–41`); no edge function mediates approval; the "approved = frozen" rule is a client check (`AppShellV3.tsx:1905`) |
| Q5 | Can it be tested? | **Partial** — deterministic core yes, LLM plane no | ~690 behavior-asserting unit tests / 51 files; **0** tests for `run-agent` (9k lines) or `flow-portal`; **no** LLM record/replay layer, no eval harness / prompt versioning |

### Detail per verdict

**Q1 — Real, as a grounding + entailment layer.** Not cosmetic: the `domain-ontology` agent grounds prompts in stakeholder nouns (`run-agent:1195–1210`); returned `standardAlignment` is URI-validated on the way in (`:9027`); adopted mappings then inject `standardUri` into blueprint contracts deterministically (`:9035–9049`); adoption merges additively and irreversibly with `adoptedAt` (`flowDecisions.ts:170–176`). Built incrementally over multiple commits (`c7cfd38` + predecessors), not one sitting. **The gap:** nothing yet *rejects an agent's factual assertion* against domain/range/cardinality — the ontology grounds and entails, but does not constrain at write time. That's the T5h question, deferred to Run 3.

**Q2 — Scoped, structurally.** The app holds one programme blob in memory at a time; every list (inbox, story, library, board) derives from that blob, so cross-programme context leak is structurally precluded, not predicate-patched. The single all-rows query relies on RLS; the public portal scopes by `.eq("id", programId)` with token-secret match + 30-day expiry (`flow-portal:70–74`). Single point of dependency: correct RLS config.

**Q3 — 5/5.** The product's reason to exist holds on the live record. Nuance: ontology entities carry structured `evidence` fields; the charter does **not** (`charterHasGrounding=false`) — traceability is *achievable by content* everywhere but *rendered as first-class provenance* only on the ontology.

**Q4 — Client-authored governance.** There is one actor (the owner) and one RLS policy governing the whole row uniformly; approval is a value the client writes into the blob. No separation of authorship and approval, no server-side immutability of an approved artifact. Bounded by the single-owner trust model today — but per the contract's own S1 definition ("a governance gate can be bypassed"), this is the thinnest ice. *(Not executed as a live mutation — proof is from RLS + absence of any server mediator; confidence: verified. Run 3/T6 should execute the direct-API self-approve on a throwaway programme to close it empirically.)*

**Q5 — Half-testable.** The deterministic client core is genuinely tested (real input→output assertions, e.g. `flowLibs.test.ts:40–48, 74–76`, additive-merge and pass-acceptance behavior). The agent/LLM control plane has no replay, no eval harness, no prompt versioning — so "deterministic orchestration" cannot be *measured*, and no one can safely change a prompt or model. Per the contract this is an **S2**.

---

## Go / No-Go

**CONDITIONAL GO.** The three existential instruments are healthy: the ontology does real work (Q1), context is scoped (Q2), and artifact claims trace to evidence (Q3 = 5/5). The core thesis — *evidence → grounded, traceable artifact* — is **real, not inherited fiction**. The audit's stop-conditions (Q1 cosmetic, or Q2/Q4 failing existentially) are **not** met: Q1 isn't cosmetic and Q2 passes.

The two genuine gaps are **known-shape additions, not rewrites**:
1. **Q4 — server-side gate enforcement + author≠approver separation** (governance is convention today).
2. **Q5 — an LLM record/replay + eval harness** (the agent plane is unmeasurable).

Proceeding to a 200-row register would document a fundamentally *sound* product; better spent proceeding to a **scoped audit that leads with the two gaps.**

## Scoped plan for Runs 1–7

- **Run 1 (static map):** include the Scoped/Unscoped table (expected: mostly structural-scoped), the orchestration state machine in `run-agent`, and the agent I/O contracts. **Cut** exhaustive route inventory — the app is one shell.
- **Run 2 (corpus):** Laila already serves as Client X. Add **Client Y** (overlapping names) and **Program Z** (empty) as real blobs. **Build the LLM replay layer** — this is the highest-value scratch deliverable; without it Run 3's determinism test is impossible.
- **Run 3 (deep):** lead with **T5h** (write-time constraint — force an ontologically invalid agent claim, is it caught?), **T6** (execute the gate defeat via direct API), and **T14** (confirm eval-harness absence). Then T4 grounding on the adversarial set.
- **Runs 4–6:** standard, but Run 6 redesign must answer Q4 (a real approval model) and Q5 (the eval harness that should have existed).
- **Run 7:** the codebase is already lint-clean at `--max-warnings 0` with 734 green tests — cleanup scope is small; the highest-value refactor named in the contract (centralize the scoping predicate) is largely moot here because scoping is structural.

### Could not test at triage depth (needs Run 2/3)
- Whether the ontology **rejects** invalid agent output (T5h) — needs a forced-invalid agent run.
- Empirical gate defeat (T6) — needs a throwaway programme to mutate.
- Determinism (T3) and tenant isolation at the retrieval layer (T7) — need the replay layer and a second seeded tenant.

**Stop. Decision required before Run 1.**
