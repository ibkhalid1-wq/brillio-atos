# Aura — Generation contract, in ledger terms (gated)

The generator's output stops being three separate documents and becomes **claims-with-unknowns**
against the shape modules. This is the **gated edge change** — specified completely here, implemented
nowhere (no Deno, no edge in this environment). F-A..F-G stop being seven schema patches; each becomes
a **slot in a Tier-3 shape**, born `?unknown`.

## Output schema (what the generator emits)

Not prose blobs — a batch of claims and elements:

```jsonc
{
  "elements": [ { "id": "el:entity:opportunity", "kind": "entity", "name": "Opportunity" }, … ],
  "claims": [
    { "about": "el:entity:opportunity#definition", "value": {"kind":"scalar","value":"…"},
      "world": "to-be", "layer": "domain", "source": "generated", "status": "weak",
      "ownerWhileOpen": {"kind":"role","role":"Sales Leaders"} },
    // EVERY schema-relevant slot is emitted — including the ones it doesn't know:
    { "about": "el:attr:opportunity.stage#valueSet", "value": {"kind":"unknown"},
      "world": "to-be", "layer": "domain", "source": "generated", "status": "open",
      "ownerWhileOpen": {"kind":"role","role":"Sales Leaders"} }
  ]
}
```

**The one hard rule (the whole point):** the generator **emits an `?unknown` claim for every
schema-relevant slot it cannot fill** — it never omits a slot. Omission is what made a guess look like
fact. A validation pass rejects output that has an element without the full slot set its kind + active
shapes require.

## F-A..F-G become shape slots, not patches

The shapes (Tier 3) are declared per engagement in Frame; each adds slots, born `?unknown`:

| Finding | Was (a patch) | Becomes (a shape slot) |
|---|---|---|
| F-A automation boundary | a `disposition` field on the step | `decision`/`lifecycle` shape → `step#automationDisposition` (born unknown) |
| F-B decision points | a decision struct on the step | `decision` shape → `step#decision{condition,authority,outcomes}` |
| F-D attribute types / optionality | `type` + `optionality` fields | base attribute slots `#dataType`, relation `#optionality` (generator proposes, born weak/unknown) |
| F-F attribute value set | a `valueSet` field | `lifecycle` shape → `attr#valueSet{members,terminal}` (born unknown — the highest-value Listen ask) |
| F-G workflow phase | a `phase` field | `lifecycle` shape → `workflow#phase` (born unknown; the grid derives until asserted) |
| F-C cross-artifact coherence | a side-computed check | falls out of the ledger — a step's entity ref that resolves to no element is an `unresolved-ref` claim; contradiction is a live pair, not a check |
| F-E design system | a prompt patch | out of the claims schema — an appearance concern, not a claim |

## Prompt changes

- **Emit unknowns, don't omit.** The system prompt instructs: for every slot the active shapes define
  on an element, output a claim; if you don't know the value, output `{"kind":"unknown"}` with
  `status:"open"` and your best guess at `ownerWhileOpen` — never skip the slot.
- **Source is always `generated`, status `weak` at best.** The generator may never emit `asserted`,
  `closed`, `document`, `regulation`, or `precedent` — those sources belong to humans, imports, and the
  precedent library. A generated value is `weak` (a strong default awaiting confirmation), never
  `closed`. This is what makes *asserted outranks generated* hold at the source.
- **Reference by id, never by name.** A step touching an entity emits `{"kind":"ref","to":"<elementId>"}`;
  if it can't resolve the id, `{"kind":"unresolved-ref","name":"…","why":"…"}` — never a bare name.
- **Never overwrite.** Regeneration emits claims; the store's precedence-aware insert decides what
  survives. A regenerated `generated` claim can never supersede an `asserted` closure (enforced in the
  store, tested) — the generator does not need to know what's already closed; it cannot win against it.

## Validation (rejects bad output before it enters the ledger)

1. **Slot completeness** — every element has the full slot set its kind + active shapes require; a
   missing slot fails (the anti-omission guard).
2. **Source ceiling** — no claim has a source stronger than `generated`; a generator claiming
   `asserted`/`closed` fails.
3. **Reference shape** — every reference is a `ref` or `unresolved-ref`, never a scalar name where a ref
   is expected.
4. **Status coherence** — `unknown` value ⇒ `open`; `na` ⇒ `n/a`; substantive value ⇒ `weak`
   (never `closed`).

## Gated

All of the above is the edge generator + its validation — **no Deno here**, so authored not executed
(consistent with the migration's honesty). The client side that *consumes* claims-with-unknowns (the
store, the projections, the queue) is built and tested. When the edge lands, this contract is the
generator's output schema and validation.
