# Dictionary ask — preventive by default, remedial fallback

Amendment to `data-dictionary-import.md`: the ask is no longer a remedial inbox notice
that appears once typing questions pile up — it is an ARTIFACT ASK born at
system-of-record identification, one per SoR, chased through the inbox only while
unprovided.

## The model (`src/v3/lib/ledger/artifactAsks.ts`)

- **Born at SoR identification.** Naming a SoR and creating its ask are one act: the
  ask EXISTS by derivation over the resolved `#systemOfRecord` claims — no write
  creates it, no write can forget it. Laila names **5 SoRs** (CRM 21 entities, Project
  Management 5, Finance 4, Contract 2, Content 1) → 5 asks, not the old single global
  one. Surgery names the EHR → 1 ask.
- **States:** `unrequested` (an incomplete Frame item) → `requested` (operator mark;
  the ageing anchor) → `provided` (dictionary on file, zero residue — self-cleared) /
  `reopened` (questions minted after the import attach HERE — never a second ask) /
  `has-none` (explicit operator mark).
- **Owner:** the SoR's system owner via ONE shared detection (`isSystemOwner`) over the
  roster; none → `null`, rendered **TBC** — never fabricated.
- **Weight:** the open typing questions the artifact closes. **Conservation:** Σ ask
  weights + unattributed === the dictionary bucket (asserted in tests). Typing
  questions on entities with NO named SoR are a **Frame gap**, surfaced as such — not
  silently pooled into an ask.

## The four surfaces, one item, one count

| Surface | Reads |
|---|---|
| **Frame readiness** | `gateChecklist` gains a `sor-dictionary` item (`frameSorReadiness`, pure over the committed ontology + marks): a named SoR with the ask neither provided, requested, nor has-none = incomplete Frame. |
| **Operator inbox** | The dictionary section is now the CHASE list: one item per unprovided ask — owner or TBC, `closes N open questions` as its weight, state line, and the SAME operator-tracked ageing as people (aged from the `requested` mark; hot ≥21d, warm ≥9d). Self-clears on import ("if 0 → hide" holds). Marks (`mark requested` / `has no dictionary`) append to the fingerprint-safe `_artifactAsks` field via the same silent-save channel as operator actions. |
| **Discover** | The inbox lives in the Discover view — the chase item is its Discover presence; `ledger.artifactAsks` is exposed for any further card. |
| **Kit** | The read model exposes the asks; the generated kit ARTIFACT has no asks section yet (finding below). |

## Verification (tests: `src/v3/__tests__/artifactAsks.test.ts`, 8 cases)

- Laila: exactly the 5 named SoRs → 5 asks, all `unrequested`, Frame incomplete;
  owner null until a system owner joins the roster; conservation holds.
- Surgery-shaped: EHR ask exists with the EHR Systems Lead as owner; the
  no-SoR entity's questions land in `unattributed` (Frame gap).
- State machine end to end: request (ageing anchor set, still chases, Frame item
  handled) → provide (weight 0, chase self-clears) → REOPEN on a question minted after
  import (**one** ask, same SoR, back in the inbox) → has-none (chase stops, Frame
  complete).

tsc + eslint clean; 1255 tests green. The **provided-up-front path end to end**
(Laila Salesforce export actually uploaded) and the live-DB surgery EHR chase need the
running program + export — the state machine is proven on the migrated ledgers here.

## Findings (reported, not silently done)

- **No Frame SoR input field exists.** SoR identification happens in the ontology
  (`entities[].systemOfRecord`), generated in Listen — there is no Frame fact field
  where a sponsor NAMES the systems. The gate item honestly reflects the named set
  wherever it originates; a first-class Frame "systems of record" input (naming a SoR
  before any ontology exists) is a generator/inputs change.
- **The kit artifact schema has no asks section** (`discoveryKit` = interviews /
  personas / coverageMap). Projecting the artifact ask into the GENERATED kit document
  needs a schema + generator change (edge). The read model already carries the asks, so
  the projection is one section away once the schema decision lands.
- The dictionary remains one global upload (`_dataDictionary`); per-SoR uploads (a CRM
  dictionary vs a Finance-system dictionary, matched to their own asks) need a keyed
  field — buildable next if wanted.
