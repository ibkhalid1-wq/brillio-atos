# Full validation — question pipeline + prototype render — 2026-08-10

Autonomous, hostile-posture run. Harness: `scripts/validate-pipeline.sh` (committed;
re-runnable — every non-BLOCKED check below is automated there). Evidence = test file
or grep; both programs (Laila = real snapshot `docs/laila/snapshot-2026-08-07`;
surgery = the synthetic mirror — the LIVE surgery program is DB-only in this
environment, so live-DB legs are BLOCKED, not guessed). Full suite after all changes:
**1276/1276**, tsc + eslint clean. Cold re-run of the harness (fresh processes):
exit 0 — results stable, not session artifacts.

## Meridian wiring (the coupled fix, done first)

**Diagnosis stopped at break #1.** The live prototype was the model-authored
`prototypeBuild.html` (edge agent `run-agent:"prototype-build"` → `flow-portal` →
`PilotFrame`); the deterministic fabric→roles→Meridian→seed assembler
(`prototypeAssembly.ts`) was complete but had **zero callers** outside tests, and
Meridian only travelled in the export zip. Tokens (2) and the role→component map (3)
were healthy inside the library — the path never reached them.

**Wire:** `PrototypeStudio` now derives `assemblePrototype(ontology, atlas)` from the
committed artifacts and renders it as the **default** preview (`◇ Assembled (fabric)`);
the stored model build is the explicit `✦ Refined build` toggle. The no-build dead-end
is gone — ontology+atlas alone now yield a Meridian prototype. Zero model tokens for
structure (G1 asserts no model/network call in the path). Open/download buttons follow
the shown source.

## A. SINGLE SOURCE
- **A1 PASS** — producer grep: only `renderQuestion.ts` emits question text
  (`scripts/validate-pipeline.sh` A1; `phrasing.ts` reduced to `readableName`).
- **A2 PASS (local) / BLOCKED (DB)** — no truncation artifacts or stored rendered
  strings in committed blobs/fixtures; the DB-side `flowInterviewPacks.questions`
  strings still exist (known finding — the pack pipeline is the one surface not yet on
  the renderer; see one-question-renderer.md). DB grep needs the live store.
- **A3 PASS** — kit === queue === per-owner union on fresh stores, both programs
  (`pipelineValidation.test.ts [A3]`, `renderQuestion.test.ts`); unit = questions;
  every id resolves to an open locus. Linked-page leg BLOCKED (pack is DB-delivered).

## B. ROUTING
- **B1 PASS** — no default-owner branch anywhere (`ownerRoutingRegression`, 9 cases +
  grep for `ownerFor("sales ops")`/fallback params: zero). Owners = functionOf hit,
  atlas-stated owner/actor (data-grounded), or unowned.
- **B2 PASS** — most-specific wins (`/sales ?op/` before `/sales/`); no-match → unowned;
  never a constant (same suite).
- **B3 PASS** — partition both directions zero (`pipelineValidation [B3]` +
  `inboxReconciliation` conservation).
- **B4 PASS (guard) / BLOCKED (construction attempt)** — `awaiting` requires ≥1 sent
  question (TheLine guard, grep-asserted); constructing the state needs the live DB
  send path. Post-send re-routing pinning is the flagged un-built rule
  (owner-routing-fabrication-fix.md) — **still open, by design decision pending**.

## C. FRAME / DICTIONARY
- **C1 PASS** — exactly one ask per SoR (Laila 5, surgery EHR 1), states exclusive
  (`artifactAsks.test.ts`, 8 cases); reopen attaches to the SAME ask, never a second.
- **C2 PASS (structural) / BLOCKED (live)** — card weight ("closes N") and the bucket
  are the same derivation (conservation Σ weights + unattributed === dictionary
  bucket); live Discover card DOM needs a DB program.
- **C3 PASS** — fixture import closes as `code-derived · weak` (external-authoritative,
  never heard/attributed-human), burn-down moves, chase self-clears
  (`dictionaryImport.test.ts` + `artifactAsks` provided/reopened cases).
- **C4 PASS** — asserted beats code-derived (confirm-or-deviate preserved; no silent
  overwrite; ids content-stable) (`dictionaryImport.test.ts`).

## D. RENDERER
- **D1 PASS** — every open locus rendered, both audiences, both programs: zero
  truncation artifacts (`" the be "`, `" to pre be"`, `" and u —"`, `…`), zero arrow
  notation, full element names (130-char action verbatim), original casing
  (`renderQuestion.test.ts`, 10 cases).
- **D2 PASS with one honest caveat** — AUTOMATE? = three chips; ACTOR ROLE = picker +
  free text; unknown kind → visible free-text, never nothing
  (`pipelineValidation [D2]`). **Caveat: the PHASE picker affordance is a kind tag —
  the program's real phase LIST is a surface concern the linked page must supply when
  the pack wire lands; the affordance does not hardcode phases (nothing to hardcode
  yet).**
- **D3 PASS** — grouped sums equal ungrouped counts; FHIR-cased names survive.

## E. CLOSURE + CONSERVATION
- **E1 PASS (3 legs, store-level)** — chip assertion (`renderQuestion` E2E), dictionary
  import (C3), operator disposition (`pipelineValidation [E1]`): each −1 in question
  units, gone from kit on regeneration. `audit_events` rows BLOCKED (DB table; the
  in-browser read model has no audit table).
  **Judgment call (logged):** a bare `na` disposition does NOT supersede an open
  unknown — supersession needs a substantive value; decide-fate is the overlay for
  out-of-scope. Validated the valued-disposition path; the `na` behavior is recorded
  as intended store semantics, not patched.
- **E2 PASS** — conservation identity holds before and after every mutation test
  (dict + owner-queue + role/joint-owned === open), zero leaked ids.
- **E3 PASS** — convergence = verbatim closures only; Laila 0 real closures → 0%
  (`convergenceBurnDown.test.ts`); recomputation moves by exactly 1 per real closure.
- **E4 PASS (surfaces reviewed this session) / not exhaustively re-audited** — Discover
  numbers read the one ledger derivation or carry `ProvisionalMark`; no new unmarked
  number was introduced in this session's diffs. A full historical sweep of every
  legacy surface number was out of scope today — noted, not claimed.

## F. REGRESSION SENTRIES
- **F1 PASS (structural) / BLOCKED (live)** — roster chip and inline sentence read the
  same `ownedQuestionsFor` projection (one read, cannot diverge); linked-page leg
  needs the DB pack.
- **F2 PASS — definition updated by request (2026-08-10):** zero-count sections are
  HIDDEN (user override of the earlier three-way rule), and the harness asserts none
  resurrected. The check enforces the CURRENT rule, not the superseded one.
- **F3 PASS (projection) / BLOCKED (generated kit artifact)** — every projected kit
  question carries its ledger id; kit === owner-queue+dictionary by construction. The
  generated kit DOCUMENT (DB artifact) still holds agenda strings — the known
  demote-to-cache decision, unchanged.
- **F4 PASS** — fabrication grep zero: no constant owners in ledger paths (the two
  known constants sit in non-live-path adapters, flagged in owner-routing doc).

## G. FABRIC → MERIDIAN
- **G1 PASS** — `assemblePrototype` wired into `PrototypeStudio` (grep-asserted); no
  model/network call in the render path — the 0-token structure claim survives. The
  edge model path REMAINS as the "Refined build" layer — full retirement of the edge
  agent is a product decision, logged as the remaining step, not silently done.
- **G2 PASS** — untyped attribute (`acuity`): no rich role guessed, renders plainly in
  the assembly, and its `el:attr:case.acuity#dataType` question stays live — the
  styling change does not hide the epistemic gap.
- **G3 PASS** — BOTH programs assemble Meridian-styled from the SAME table;
  `--m-warn:#9c5c0e` (AA-corrected) present; `.m-*` components in use; "laila" = zero
  in output AND mapping code (even Laila's own output is generic). Side-by-side visual
  against localhost:8080 BLOCKED (that server is another project's session; token
  identity is asserted in code instead).
- **G4 PASS** — one added attribute: re-emit fraction < 5% of fabric nodes (measured
  via `diffFabric`), Meridian styling intact on the re-rendered output
  (`pipelineValidation [G4]`; `fabricDelta.test.ts` holds the ~6-node bound).

## Findings, ranked
1. **(drift, highest-risk)** The stakeholder pack still delivers STORED question
   strings (`flowInterviewPacks.questions`) — the one surface off the single-source
   renderer. Until the pack carries loci, a stakeholder can still see phrasing that
   drifts from the queue. Everything client-side is producer-zero; this is the last
   producer, and it lives in the DB/edge path.
2. **(fabrication-adjacent, dormant)** `adapters.ts:19` / `overrideAdapter.ts:13`
   constant owners — not in any live read path, but they are the pattern that caused
   the Chief-of-Surgery bug; retire when those adapters go live.
3. **(process)** In-flight PINNING (link-send freezes routing) remains un-built —
   re-routing during an in-flight link is currently possible in principle.
4. **(cosmetic/structural)** The generated kit document's agenda strings await the
   cache-with-version demotion (schema/edge decision).

**Single highest-risk finding:** #1 — the pack pipeline. It is the only remaining
place a stakeholder-visible question can exist that no ledger locus backs.

## Judgment calls (all logged)
- Surgery checks run on the synthetic mirror (live program DB-only here); every
  BLOCKED entry names the DB dependency rather than substituting the mirror silently.
- `na`-disposition non-supersession treated as intended semantics (decide-fate is the
  overlay), validated the valued-disposition path instead.
- Meridian "retire the old path" implemented as fabric-first default + explicit
  toggle, NOT deletion of the edge agent — retiring the refine loop outright is a
  product decision beyond a validation session.
- F2 enforced per the user's 2026-08-10 "if 0 → hide" override, not the superseded
  three-way empty-state rule.
- localhost:8080 side-by-side replaced by code-level token identity (the 8080 server
  belongs to a different project session; poking it from here was judged out of scope).

## Harness
`scripts/validate-pipeline.sh` — 17 scripted checks, section-tagged to this report,
exit-code gated; cold re-run confirmed stable (exit 0 twice, fresh processes each
time). Not scriptable here and why: live-DB legs (A2-DB, A3-linked-page, B4
construction, C2-live, E1 audit_events, F1-linked-page) need the Supabase store;
the 8080 visual diff needs a human eye or a cross-project fetch.
