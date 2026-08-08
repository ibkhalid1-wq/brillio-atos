# Aura — Generator fixes: contentId parity + omitted slots

The override adapter closed its half of migrate-retirement. The equivalence check named what still
blocked it — all in the generator, not the ledger. This session closes those gaps and re-runs the
equivalence. **Deno confirmed on PATH first (2.9.5, `~/.deno`).** The frozen ledger core (store,
precedence, reconcile, audit trigger) is untouched.

**Result: `migrate()` is retireable.** After both fixes, generator + override adapter reproduce migrate's
coverage — same claims, honest-or-better sources — with a single, benign attribution difference. Option A
is real except for the live model key and the binder.

Verified: `deno check` clean, Node `tsc` clean, `eslint --max-warnings 0` clean, 44 ledger unit tests
green, all proofs run against the live Postgres.

---

## Fix 1 — contentId: copy kept, but the drift made impossible (not "import", and why)

**The bug:** the store's `contentId` (`src/v3/lib/ledger/types.ts`) joins parts with an invisible
`"\x01"` (SOH); the generator's copy joined with `""`. So `contentId("el:step", …)` diverged — **46
steps, 0 shared ids** with the store. Generated step claims would land as brand-new elements, silently
duplicating, no error.

**Import was evaluated and rejected for this codebase.** `deno check` confirms the edge module *can*
type-import `types.ts` (a pure leaf — only a type-import of `precedence`). But the edge
(`supabase/functions/`) is deliberately **self-contained: zero edge files import `src/`**, and shared
logic is *copied* into `_shared/` (e.g. `flowAreas.ts`). Supabase deploys the functions directory; a
cross-boundary `src/` import is unverifiable here (no Supabase CLI) and would be the first of its kind
against a 100%-consistent convention. Per the prompt's clause — *if a module boundary genuinely prevents
the import, fall back to a shared-constant-plus-lockstep-test* — the **copy stays**, fixed to `"\x01"`.

**But the copy is now drift-proof, which the four prior duplication failures never were.** The real
defect wasn't "a copy exists" — it was "a copy drifted with nothing to catch it." So this ships an
**enforced lockstep guard**, `scripts/ledger/contentid-parity.ts`, that fails on any drift:

- **(a)** the two `contentId`s agree on sampled inputs — **4/4**;
- **(b)** generator step element ids == migrate/store step ids on real Laila — **46 store · 46 generator
  · 46 SHARED** (was 0). The separator is written as the escape `"\x01"`, not the raw invisible char, so
  it can't silently vanish again.

## Fix 2 — the omitted slots (and a subtlety corrected)

Added `workflow#owner`, `workflow#trigger`, and `entity#alias.*` where migrate emits them — **and made
them obey the anti-omission discipline**, which the first cut did not:

- `owner`/`trigger` are emitted **unconditionally**: the value where present, **`?unknown` where
  absent** — never omitted — and added to `REQUIRED_SLOTS.workflow` so the validator *enforces* their
  presence. (The initial cut emitted them `if (w.owner)` / `if (w.trigger)`, silently dropping them when
  absent — the exact pre-ledger behavior this project exists to kill. Corrected.)
- `alias.*` emits the alias name, or an `unresolved-ref` when it collides with a distinct element (A2).

Known/unknown split on real Laila: claims **1211 → 1251** (+40). All 40 are **known** here — every one of
the 14 Laila workflows carries an `owner` and a `trigger`, and aliases are names — so the unknown count
holds at **640**. The `?unknown` machinery is coded and enforced; Laila's data simply happens to fill
these slots. A workflow missing either would emit a declared `?unknown`, not a hole.

## The payoff — equivalence re-run (generator + override vs migrate, live DB)

| | before fixes | after fixes |
|---|---|---|
| loci **same source** | 363 | **552** |
| loci **different source** | 294 | 398 — all `code-derived`→`generated` honest reclassification (`exists` 211, `touches` 104, `cardinality` 35, `systemOfRecord` 33, `area` 14, `semantics` 1) |
| loci **only migrate produces** | 294 | **1** |
| loci **only generator+override** | 600 | 347 — the fuller unknowns (`optionality` 178, `valueSet` 147) + relations |

**The lone "only migrate" locus is one `operatorCorrected`** — migrate resolves the edited element by
`entIdByName.get(name) ?? el:wf` (a name-lookup heuristic), while the adapter resolves by the note's
**declared kind** (Entity vs Workflow). The *same* correction claim exists in both pipelines; only its
element attribution differs, and the adapter's (trust the declared kind) is at least as faithful as
migrate's heuristic. **It is not a claim migrate uniquely produces** — so nothing is lost by retiring
migrate.

The 398 "different source" are not divergences to fix: migrate marked extraction facts `code-derived`;
the generator honestly marks model-proposed facts `generated`. That reclassification is the *point* — a
real `code-derived` fact would arrive through the Salesforce/FHIR adapters, not the generator.

**Verdict: `migrate()` is retireable.** generator + override adapter → reconcile reproduces its every
claim, with honest sources and fuller unknowns. What remains for Option A is the live model key (content
proposal) and the binder — neither is `migrate`'s job.

## Guardrails — all held after the fixes

- **Only `generated`.** The new slots are all `generated`; the batch's sole source is `generated`.
- **No id minting, no reference resolution.** `contentId` is code computing a deterministic id that now
  matches the store byte-for-byte (parity guard proves it); it is not the model minting one. Refs stay
  `ref`/`unresolved-ref`.
- **Malformed-batch rejection holds** — the injected four violations still produce **8 errors**
  (source-ceiling, status-coherence, reference-shape, forbidden-key/binder, element-id, slot-incomplete).
- **The five invariants hold** — the multi-round reconcile harness is unchanged and green (closures 4/4,
  live-generated flat 528→525→528→527, report==query, audit exact, precedence stable). The generator
  fixes don't touch reconcile.
- **Heard-count unchanged** — the new slots are `generated`, not attributed closures; stakeholder-heard
  stays 1→1, 0 asserted from any import. Laila and other programs byte-identical.

## Anything that suggested a core change — reported, not made

Nothing touched the frozen core. Two notes: (1) the one `operatorCorrected` attribution difference is a
`migrate` heuristic quirk, not a ledger issue — the adapter's declared-kind resolution is the cleaner
behavior and needs no change. (2) The import-vs-copy decision for `contentId` is an *architecture* call
(edge self-containment) I resolved toward the copy + enforced guard; if the team later decides the edge
may depend on `src/`, the import becomes a one-line change and the guard still protects it.

---

*Changed: `supabase/functions/_shared/ledgerGenerator.ts` (contentId `"\x01"` + enforced-guard comment;
`owner`/`trigger` unconditional + in `REQUIRED_SLOTS`; `alias.*`), `scripts/ledger/contentid-parity.ts`
(the lockstep guard). Store, precedence, reconcile, audit trigger untouched.*
