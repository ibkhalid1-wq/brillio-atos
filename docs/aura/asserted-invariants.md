# Aura — The Asserted-Invariants Audit

A comment that asserts a property the code must hold — `stable`, `unique`, `append-only`,
`in sync`, `never`, `must` — is a **test's job done by a comment**. It convinces the next
reader the property holds; nothing convinces the code. Three surfaced separately, each by
accident: `EvidenceEntry.id` "survives re-parses" (true, and tested), `MovementStakeholder.id`
"Stable key" (false — an array index), `flowAreas` "MUST stay in lockstep" (unenforced). This
is the deliberate sweep for the rest. It is the internal counterpart of the claims register:
that one keeps *user-facing copy* from asserting what nothing checks; this one does it for
*code comments*.

**Ranked by silent vs loud.** A false-and-silent invariant (wrong row updated, anchor drifts,
override dropped — no error) is the danger. A false-but-loud one (throws, fails a test, RLS
rejects) announces itself. `[verified]` = I read both the comment and the code; `[reported]` =
a sweep surfaced it, plausible, not fully re-read.

**Two lenses swept:** identity/key/ordering invariants, and state/guarantee invariants. One
test was written where the property genuinely should hold and enforcement was cheap and
unambiguous (§ Tier 3). Wrong comments are flagged, **not** "fixed" by rewriting behaviour to
match them — making an index-based id truly stable is a behaviour change with persisted-
reference blast radius, out of scope here.

---

## Tier 1 — the comment is WRONG and drift is SILENT (worst: a false promise)

### I1 · `MovementStakeholder.id` — "Stable key for React + pack matching" **[verified]**
- **Asserts** (`flowStakeholders.ts:17`): *"Stable key for React + pack matching."*
- **Reality:** the id is an **array index**: `persona-${index}` (:349), `iv-${index}` (:426),
  `dir-${movementId}-${index}` (:973), `${movementId}-${index}` for Envision/Show/Evolve roles.
  It is used as a React key (`FlowShell` `key={\`role-${person.id}\`}`) and to match packs.
- **Holds?** No. Reorder / insert / delete a person in the kit and every downstream index
  shifts, so the "stable" id changes.
- **Enforced by:** nothing.
- **Silent drift:** a person's id changes → React remounts their card → draft answers, meeting
  link, assignment orphan onto the wrong voice; a quote "matched to stakeholder 3" now points
  at whoever slid into slot 3. No error.

### I2 · `DrillAnchor.refId` — "Stable reference into the parent's graph" **[verified]**
- **Asserts** (`flowDrilldown.ts:22`): *"Stable reference into the parent's graph (index-based
  for artifact rows)."* The comment contradicts itself — index-based is not stable.
- **Reality:** `ont-${i}` / `wf-${i}` / `ps-${i}` / `kpi-${i}` (flowDrilldown.ts:80–104),
  **persisted** into a child programme's lineage anchor (`AppShellV3` stores
  `{kind, refId, label}`).
- **Holds?** No — the moment the parent's ontology/atlas is regenerated and the entity order
  changes, `ont-5` denotes a different entity.
- **Enforced by:** nothing.
- **Silent drift:** a child programme anchored to `ont-5` (say, a Sales process) silently
  rebinds to whatever is at index 5 after a regen (Ops). All inherited scope and findings are
  now tagged to the wrong business area — invisibly. Highest-consequence of the set (it crosses
  a persisted programme boundary).

*Both are FLAG-only: the honest property (a content/name-derived id) is right, but forcing it
now would rewrite id generation that persisted references depend on — a separate, careful change.*

---

## Tier 2 — the comment is RIGHT but nothing ENFORCES it (silent if it ever drifts)

### I3 · `flowOperatorOverrides` — "fed back … as authoritative; never revert a rename,
resurrect a removal, or drop an addition" **[verified]**
- **Asserts** (`flowOperatorOverrides.ts:2–7` + the injected prompt line ~:162).
- **Reality:** the overrides are appended (append-only holds) and injected into the
  regeneration prompt as an instruction to the model. The "never revert/resurrect/drop"
  guarantee is a **sentence in a prompt**, not a check.
- **Enforced by:** the model's compliance. Nothing compares the regenerated artifact against
  the override list afterward.
- **Silent drift:** the model quietly re-derives a correction the operator made → the
  operator's fix is lost and the artifact is not flagged. Inherent to LLM regeneration; the
  only real enforcement would be a post-regen diff against the override set (non-trivial).

### I4 · "An approved artifact must never silently drift" — cross-phase scope **[reported]**
- **Asserts** (`AppShellV3.tsx:2153`): an approved artifact is flagged stale when an input it
  depends on changes.
- **Reality:** intra-phase staling is implemented (`changedInputFields` on the saved phase).
  Whether a *downstream-phase* approved artifact is flagged when an *upstream* input changes
  depends on the flow-edge map being complete — the sweep flagged this as a possible gap but I
  did not fully trace it.
- **Silent drift (if the gap is real):** an Envision artifact approved off Listen inputs stays
  green after those inputs change. Worth a targeted trace before Step 5's grounding work.

### I5 (minor) · `confidenceHistory` — "append-only" **[verified]**
- `confidenceHistory.ts:10` says append-only; it actually **appends, overwrites the same-day
  entry, and caps at 60** (drops oldest). Harmless (localStorage, non-load-bearing), but the
  one-word summary is misleading. Flag, no action.

---

## Tier 3 — was asserted-only, now ENFORCED (fixed this pass)

### I6 · `flowAreas` — "MUST stay in lockstep" → now a test **[verified + enforced]**
- `supabase/functions/_shared/flowAreas.ts` carried three "MUST stay in lockstep" / "Keep in
  lockstep" comments against `src/v3/components/flow/flowAreas.ts`, with **no test**. The
  `AREA_KEYWORDS` and `AREA_STOP_TOKENS` tables are byte-identical today.
- **Now enforced:** `src/v3/__tests__/flowAreasLockstep.test.ts` (added here) text-parses both
  and asserts the two tables match — a keyword added on one side only now fails CI instead of
  silently splitting the Show demo by the wrong area. (Also the S1 finding in
  `duplicate-definitions.md`; this closes it.)

---

## Enforced and correct (comment holds — the pattern is not universal)

For balance: many asserted invariants here **are** backed by a test, a type, an RLS policy, or
a runtime guard. These are healthy — listed so the audit isn't read as "every comment lies."

| Invariant | Location | Enforced by |
|---|---|---|
| `EvidenceEntry.id` "survives re-parses" | flowShellData.ts:55 | content hash + test (`flowLibs.test.ts`) |
| Watchers "PROPOSE … never a silent apply" | AppShellV3.tsx:1525 | resolver-gated + test |
| "must not save without a resolved owner_id" | AppShellV3.tsx:846 | auth gate + `adam_programs` RLS |
| writeQueue "replay-safe blind-update guard" | writeQueue.ts:56 | staleness + skeleton checks |
| Gate approval "authoritative over a stale RAG" | phaseSchedule.ts:266 | separate store + test |
| `flowAttestations` "append-only, non-load-bearing" | blobGuard.ts:52 | append-only pattern + defensive readers |

---

## Aspirational — honestly marked not-yet-true (not a defect)

- **`audit_events` "single authoritative, append-only, trigger-enforced log."** Asserted in
  `step1-audit-choke-point.md` and the claims register — and both explicitly say it is **not
  yet true** (the migration is authored, unapplied; the live trail is the capped, opt-in
  `flowAttestations`). This is the honest counterpart of the pattern: the assertion is dated to
  when it becomes true (Step 1 apply), not pretended true now.

---

## Ranked summary

| # | Invariant | Silent? | Comment | Enforced | Action |
|---|---|---|---|---|---|
| I2 | DrillAnchor.refId "stable" | **SILENT** | WRONG (index) | no | flag (persisted cross-programme anchor) |
| I1 | MovementStakeholder.id "stable" | **SILENT** | WRONG (index) | no | flag (React key + pack match) |
| I3 | operator overrides "never dropped" | **SILENT** | right | prompt only | flag (needs post-regen diff) |
| I4 | approved artifact "never drifts" | SILENT? | right, narrow | partial | trace cross-phase before Step 5 |
| I5 | confidenceHistory "append-only" | silent, harmless | imprecise | logic | flag wording |
| I6 | flowAreas "MUST stay in lockstep" | was silent | right | **now a test** | ✅ enforced this pass |

*Swept 2026-08-07, two lenses; load-bearing findings re-read and marked [verified], the rest
[reported]. `flowShip` index ids were over-flagged by the sweep (no comment asserts stability
there) and excluded. One test added (I6); the wrong-comment findings (I1, I2) are flagged, not
rewritten — fixing them is a behaviour change with persisted-reference blast radius.*
