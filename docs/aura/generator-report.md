# Aura — The claims-emitting generator (built; Deno/edge)

The persistence substrate is complete, proven, and frozen. This session builds the **generator** — the
thing that makes the ledger self-populating (Option A) instead of migration-fed (Option B). The
generator conforms to the ledger, never the reverse.

**Runtime unblocked this session.** Deno was absent (the standing gate); it was installed with approval
(`deno 2.9.5` at `~/.deno/bin`, user-home, no sudo), so the build ran. One honesty note up front: there
is **no edge model key** wired for `_shared/claudeClient.ts` and **no replay fixtures** for this path, so
the generator ran **deterministically over Laila's real generated artifacts** — the model's content is
already in those artifacts; the generator's job (and the behavioral change this session is about) is
emitting **claims-with-unknowns** from them, validated, into the proven reconcile. That is fully
runnable and uses real Laila input; what a live model would change is *where the content is proposed*
(raw docs vs the existing artifacts), not the contract, the validator, or the reconcile path.

Verified: `deno check` clean on the edge module + runner, Node `tsc` clean, `eslint --max-warnings 0`
clean, and the end-to-end arc run against the live Postgres.

---

## 1 · The generation contract, made executable + the validator

`supabase/functions/_shared/ledgerGenerator.ts` (Deno, runtime-agnostic TS):

- **`generateClaimsBatch(source)`** → `{ elements, claims }` — the exact shape reconcile already
  consumes (`LedgerElement[]` + `AssertInput`-shaped claims). This is the Option-A batch.
- **`validateBatch(batch)`** — the guard between a non-deterministic model and the proven store. It runs
  the contract's four checks plus binder discipline:
  1. **slot completeness** — every element carries the full required slot set for its kind (the
     anti-omission guard);
  2. **source ceiling** — every claim is `source: "generated"`; anything stronger fails;
  3. **reference shape** — a `touches.*` slot must be `ref`/`unresolved-ref`, never a bare scalar name;
  4. **status coherence** — `unknown ⇒ open`, `na ⇒ n/a`, substantive ⇒ `weak` (never `closed`);
  5. **binder discipline** — no claim carries an `id`/`supersededBy`/`contradicts`/`closedBy` (those are
     the store's/human's), and element ids must be **recomputable** from kind+name (a model must not
     mint ids).

**A malformed batch is rejected at the boundary** (not reconciled and cleaned up after). Injecting four
violations produced **8 errors**, each naming the locus:

```
✗ [element-id-not-derived] el:entity:MINTED-BY-MODEL != el:entity:ghost (a model must not mint ids)
✗ [source-ceiling]        el:entity:widget#definition — source 'asserted' > generated
✗ [status-coherence]      el:entity:widget#exists — substantive generated value ⇒ weak, got 'closed'
✗ [reference-shape]       el:step:s1#touches.account — touches slot must be ref|unresolved-ref, got scalar
✗ [forbidden-key]         el:entity:widget#systemOfRecord — claim carries key 'id' (binder discipline)
✗ [slot-incomplete] ×3    el:entity:MINTED-BY-MODEL missing exists/definition/systemOfRecord
```

## 2 · Unknowns as first-class output — against real Laila

`deno run scripts/ledger/generate-claims.ts` over Laila's actual ontology + atlas:

- **306 elements · 1211 claims · 640 declared unknowns (53% of the batch)** · validation **PASS** · only
  `generated` present.

| unknown slot | count | the gap it declares |
|---|---|---|
| `optionality` | 213 | F-D — relation/attribute optionality, unknowable from the artifact |
| `dataType` | 178 | F-D — attribute type |
| `valueSet` | 178 | F-F — enum members (the highest-value Listen ask) |
| `automationDisposition` | 46 | F-A — step automation boundary |
| `phase` | 14 | F-G — workflow phase |
| `decision` | 11 | F-B — decision condition/authority/outcomes |

Every attribute carries `dataType`/`optionality`/`valueSet` as explicit `?unknown` rather than being
silently omitted — the inversion the whole design exists for: **571 substantive claims and 640 declared
unknowns**, so the batch says out loud what it does not know instead of hiding it.

## 3 · Feed reconcile, end to end (Option A) — against the live DB

`scripts/ledger/generator-round.ts`: a **blob-fed prior round** (bootstrap + a `vp-sales` closure on
`opportunity.stage#valueSet`) then a **generator-fed round** — the Deno-produced batch flows through the
**proven, unchanged** reconcile:

- `reconcile(generator batch)`: applied **1211**, preservedClosures **1**, filledUnknowns **291**,
  newClaims **919**.
- **The prior-round closure survives** — asserted beats generated, precedence held. The generator's
  `?unknown` on that same locus landed **superseded by the closure**, never overwriting it.
- **Generated claims landed as generated** (1399 live); **unknowns landed as unknown/open** (742 live);
  the asserted closure is still live (never demoted).
- **Audit exact**: 1862 claims + 356 elements = **2218 == 2218** INSERT rows.
- Sources after the round: `asserted, code-derived, dispositioned, generated` — the generator added only
  `generated`; the bootstrap's stronger sources are untouched.
- **Laila and every other program byte-identical.** Test program cleaned up.

This is Option A exercised: change flowed through **generate → validate → reconcile**, not through
re-migrating a blob, and every invariant held.

## 4 · What the generator does NOT do (confirmed, read off the batch)

- **Mints no ids** — claims are id-less (no `id`/`supersededBy` on any of 1211); ids are the store's
  `contentId`, computed downstream. Structurally impossible for the model to mint one.
- **Resolves no references** — all **104** `touches.*` claims are `ref`/`unresolved-ref` (a name to be
  bound), never a scalar asserting a binding. The binder (unbuilt) would confirm them.
- **Emits only `generated`** — the source ceiling, enforced by the validator and true of the whole batch.

## Is Option A now exercisable? Yes — and what still holds it partly on B

**Exercisable: proven above.** generate → validate → reconcile works end to end, and the write model's
guarantees survive a generator-fed round. Three things stand between "exercisable" and "retire B
entirely":

1. **The live model call.** This session's generator proposed content *deterministically from Laila's
   existing artifacts* (no edge Anthropic key, no replay fixtures). The production Option-A generator
   swaps that one step for a model reading raw Laila documents — **same output contract, same validator,
   same reconcile path**. That's a credential/wiring task, not a design one.
2. **The import/override-derived claims.** `migrate()` also emits things that are *not* generated — the
   `code-derived` as-is `exists` facts and the operator-override `dispositioned` closures (the 26
   corrections). The generator correctly does **not** emit these (they aren't its to propose). So
   retiring `migrate` fully needs those routed through the **import adapters** (`salesforceToClaims`
   etc. exist; an override-log adapter does not yet). *Reported, not built — it's an adapter, not a
   generator or ledger change.*
3. **The binder** is still unbuilt, so references stay claims-to-be-bound (correct) and rename-closure
   reattachment stays gated (as before).

## Did the generator surface anything the ledger must change? No.

The generator conformed to the frozen ledger without friction: its output is exactly `AssertInput[]` +
`LedgerElement[]`, it validated, it reconciled, and all invariants held. Nothing forced — or even
suggested — a ledger change; the structure held as it was cold-reviewed to. One neutral observation (not
a change): the generator emits **306 elements vs migrate's 310** (it doesn't manufacture `el:removed:*`
from the override log — those are import-derived, see #2) and **more claims (1211 vs 955)** because it
emits every unknown. Both are consequences of the contract working as intended, not gaps in the ledger.

---

*Built: `ledgerGenerator.ts` (edge), `generate-claims.ts` (Deno runner), `generator-round.ts` (Node
end-to-end). The frozen core — store, precedence, reconcile, audit trigger — was not touched.*
