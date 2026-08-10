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

- ~~**No Frame SoR input field exists.**~~ **BUILT (2026-08-10).** The Flow Frame
  phase now carries a first-class `systemsOfRecord` input (`methodology.ts`), parsed by
  the ONE parser `parseDeclaredSors`. `deriveArtifactAsks({declaredSors})` mints the ask
  from it — **so the ask is born at Frame time, before any ontology exists** — and
  `frameSorReadiness(ontology, marks, dictProvided, declared)` reads both sources for
  the `sor-dictionary` gate item, which is now live at Frame and reports its provenance
  (`N on the ontology · N named in Frame only`). The two sources merge
  **case-insensitively**, the modelled spelling winning, so **one system is never two
  asks**; `ask.source` is `frame` / `ontology` / `both`, never inferred. A declared-only
  ask has `entityCount 0` and honestly carries **no weight** (nothing is modelled
  against it yet) — `asksNeedingChase` keeps it visible on that basis rather than
  hiding it for weighing zero. Conservation is unchanged (asserted). **Gated
  remainder:** feeding the declared systems into the `domain-ontology` /
  `current-state-atlas` prompts so the generator aligns `entities[].systemOfRecord`
  with the sponsor's naming is an EDGE change (`supabase/functions/run-agent`) — the
  field is wired to `usedByArtifacts` but the prompt is not changed, not deployed.
- **The kit artifact schema has no asks section** (`discoveryKit` = interviews /
  personas / coverageMap). Projecting the artifact ask into the GENERATED kit document
  needs a schema + generator change (edge). The read model already carries the asks, so
  the projection is one section away once the schema decision lands.
- ~~The dictionary remains one global upload (`_dataDictionary`).~~ **BUILT (2026-08-10).**
  The field accepts a **keyed map** ADDITIVELY — `{"<SoR>": "<csv>", "*": "<csv>"}` —
  read by the ONE reader `readDictionarySources` and written by `writeDictionaryField`
  through the SAME `useOperatorCommits.commitDictionary` channel (now
  `commitDictionary(csv, sor?)`). **A plain CSV string stays valid** and reads as the
  programme-wide dictionary, so no stored programme changes shape; the keyed form is
  written only once a per-SoR upload happens. Each ask consumes **its own**: a CRM
  export no longer marks the Finance ask provided (`ask.dictionary` / `ask.ownDictionary`
  name which file answered, and whether it was that system's own). The inbox renders an
  upload control **per ask**, its parse preview measured against **that** SoR's loci,
  plus one "covering every system" control. Live on Laila: **5 per-SoR upload controls**
  (CRM 126 · Project Management 31 · Finance 26 · Contract 12 · Content 8 open questions,
  + 40 unattributed = the 243 dictionary bucket).
  **Gated remainder:** nothing — this is entirely client-side. The freeform-document
  (non-CSV) parse remains model-gated as before.
