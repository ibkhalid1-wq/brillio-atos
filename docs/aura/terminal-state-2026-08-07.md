# Aura — Terminal state (2026-08-07)

> The directive was: *reach a state where nothing remains that can be done without a database, then
> list what remains gated and why.* This is that list. Everything above the line is **done and needs
> nothing**; everything below is **blocked**, each with the one thing that unblocks it.

The rule this session ran under: read-only against engagement data; nothing touches the database, the
edge/Deno, or the Step-1 gate; stop at any mechanism that needs a name→id join. That rule is exactly
what draws the line below — the remaining work is remaining *because* it crosses one of those.

---

## Done — deterministic, tested, needs nothing

The entire client-buildable "Architect data half" and its supporting measurements:

- **Fabric** — `deriveFabric(ontology, atlas)` (`fabric.ts`): 33 entities/35 relations → 359 name-based
  nodes, 0 model tokens, byte-identical per input (idempotent, tested).
- **Semantic roles** — `deriveRoles` (`semanticRoles.ts`): the bridge. Relationship roles 100% derived
  from cardinality; value roles 0% type-derived (attributes are untyped fleet-wide → name heuristic).
- **Seed data** — `generateSeed` (`seedData.ts`): referential, deterministic, every row
  `SYNTHETIC-SEED`, planted extremes, assumptions emitted as Listen questions.
- **Prototype assembly** — `assemblePrototype` (`prototypeAssembly.ts`): the four concerns joined; every
  region `data-fabric-id`-tagged. `public/prototype-assembled.html` renders from Laila's real data.
- **Incremental delta** — `diffFabric` + `reconcileRefinements` (`fabricDelta.ts`): a one-attribute
  change re-emits **3 of 359 nodes (0.84%)**; refinements are preserved / conflicted / orphaned, never
  silently overwritten, never auto-merged.
- **Token claim, MEASURED** (was modelled): structure generation moves from ~7,156 model tokens **to 0**
  (deterministic render). Recorded in `fabric.md`, propagated to the session report.
- **Ontology protection** — the dated Listen snapshot (`docs/laila/snapshot-2026-08-07/`) and the
  regeneration warning that counts stakeholder corrections about to be discarded (item 1a/1b). The
  inline atlas editor's edits are **already** covered by that warning (audit §I).
- **Measured on Laila:** grounding-by-provenance (61% touched / 39% code-derived / 0% attributed),
  system-resolution 41% (39/94), the corrected recurrence census (~2%, not 35%).
- **Step-1b static test** — `auditVocabulary.test.ts`: closed-set membership + the client-sets-no-intent
  invariant. 6 tests.

1156 tests green across 77 files.

---

## Gated — and the single unblock for each

### A · Needs a fleet READ (cross-engagement, read-only)
The mechanism is proven — the F-D universality (0% typed across 57 ontologies) was measured this way —
but each needs a live authenticated session to query `adam_programs` blobs across engagements.

| # | What | Why it's blocked | Unblock |
|---|---|---|---|
| 1c | Fleet stale+override **exposure** — how many engagements carry stale artifacts with operator overrides a regeneration would discard | The count is a property of every engagement's blob, not Laila's | One read-only fleet query; per-blob check `status==='stale' && flowOperatorOverrides.length>0` |
| 6c | Is Laila's **61%-touched / 39%-code-derived** typical? | Needs the same provenance split computed per engagement | Same fleet read; run the §J measurement per blob |
| 6b | Rename-classifier frequency (carried / ambiguous / dropped) | Needs engagements that regenerated **more than once** with rename events; Laila has one generation | Fleet read + generation history in the blob |

### B · Needs a fleet WRITE (mutates engagement data)
| # | What | Why it's blocked | Unblock |
|---|---|---|---|
| 4 | Gap-disposition **surface** — an owner records an assumption/owner against an ungrounded element | Recording a disposition writes engagement data; this session is read-only against it | Build behind the attested `applyArtifactEdit` write path (a DB write). *The read-only half — the ungrounded-element list and un-dispositioned count — already lives in `listen-gap-list.md`.* |

### C · Needs the edge / Deno (unavailable locally)
| # | What | Why it's blocked | Unblock |
|---|---|---|---|
| — | Fabric delta→region **resolution in the live generator** (emit `data-fabric-id` markup; rewrite only delta regions) | `run-agent` is Deno edge code; no Deno locally, and it's the gated **F-E** change | Edge work + deploy. Note: deterministic rendering can run **client-side**, which removes the edge dependency for structure — the recommended direction. |
| — | **Step-1b runtime** — client publishes `aura.intent` on every write so the audit trigger records `action_type`/`affected_kind` | Touches the Step-1 gate + every write path; the DB trigger is migrated but the client emit layer isn't wired | Wire the intent helper + an exported `ACTION_TYPES` const into each write site; the static test's replacement then asserts every emit ∈ the set and carries no `actor` |

### D · Needs the ontology-id binder (the name-join stop)
| # | What | Why it's blocked | Unblock |
|---|---|---|---|
| — | A live **Design-Loop conflict queue** keyed to ontology ids (not names) | The stop condition: a mechanism that must join fabric regions to entities by a stable id beyond the name. The fabric uses name-based ids as a deliberate interim | The spine's binder — swap `source` refs from names to real ids without changing the fabric's own id scheme (`fabric.ts` header documents the swap point) |

### E · Deliberately NOT built (scope calls, not gates)
- **Auto-merge** of overlapping refinements — no structured diff exists against free-form markup; preserve-or-escalate is the honest answer.
- **Heuristic rename inference** in `diffFabric` — it would be a guess; the region-identity discipline exists to forbid guesses. A rename is carried only when the edit event supplies old→new.
- **The Architect's agent half (F-A / F-B)** — agent design is gated by the directive itself.

---

## The one honest caveat that travels with all of it

Every "grounded" number here is **grounding by provenance, not by confirmation**. Laila's override log
records *that* a stakeholder touched an element, never the diff or the reason — so even the 61%-touched
tier is *touched, not confirmed*, and 0% carries a rationale. The whole point of the gated re-ingestion
(once the governance substrate lands) is to replace this "touched" signal with a real assertion that
carries its source. Until then, do not read "grounded" as "verified."
