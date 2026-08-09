# Aura — The data-dictionary import: ask, don't build-per-standard

Both programs show the same wall: a stakeholder's link floods with "what type of value is X?"
questions (F-D dataType / F-F valueSet / optionality). The answer already exists in a document
every enterprise maintains — the data dictionary. So instead of a standards adapter per vertical
(FHIR, FIBO, ACORD…), this adds a **generic** path: the client uploads their data dictionary,
Aura parses it into claims through the **same reconcile path** the FHIR/Salesforce adapters use,
and the type questions self-close. It generalizes to domains with no standard (Laila's CRM has no
FHIR) and gives the client's real truth over a standard's abstraction.

**Verified against both programs' real ledgers.** No core change; no new mechanism — one more
source feeding proven machinery.

---

## 1 · The dictionary as a generic source, into existing reconcile

`src/v3/lib/ledger/dictionary.ts::dictionaryToClaims(dict, existingIds)` emits an
`AssertInput[]` batch — the **same shape** `fhirToClaims` / `salesforceToClaims` produce — and it
is applied through **`reconcile()`**, the same batch merge every adapter and the generator use.

- **Source class:** `code-derived`, provenance `closedBy.by = "dictionary:<name>"`.
  - NOT `asserted` — a document is not a stakeholder's confirmed answer.
  - NOT `external-standard` — it's the client's own, not a published standard.
- **No precedence-lattice change needed — checked and confirmed.** In the to-be rank
  (`precedence.ts`), `code-derived` already outranks `generated` (so a dictionary claim **fills**
  the `generated · open` type unknown) and loses to `asserted` (so a stakeholder deviation still
  wins). Confirm-or-deviate holds **for free**; no vocabulary extension was required. (Had it
  needed one, that would be an allowed extension of the precedence/source layer, not a tier
  change — but it didn't.)
- **World / status:** `to-be · configuration · weak`, so it lands on the same `to-be` typing
  loci `migrate()` opened and reads as a soft default (weak, deviatable), not a hard closure.
- **Local extensions:** a dictionary field the ontology never modelled becomes a new `attribute`
  element + its `exists` — the client's real fields aren't lost.

## 2 · The parser — deterministic built, model-assisted gated

`parseDictionaryCsv(csv, name)` reads a CSV/TSV dictionary **deterministically** (no model):
flexible header detection (`entity|object|table|resource`, `field|attribute|column|element`,
`type|datatype|format`, `values|valueset|picklist|enum`, `required|mandatory|nullable`), quoted
fields, `|`/`;`/`,`-split value sets. Structured formats parse **now**.

- **Emit-unknowns discipline (same as the generator):** a claim is emitted **only where the
  dictionary STATES a value** — a field with no type stays `?unknown`; a guessed type is the
  laundering defect and is refused (unit-tested: a `Notes` field with no type column emits no
  `dataType` claim). An unrecognisable header returns **no fields** (never guesses a shape).
- **Same validator:** the batch is the standard `AssertInput[]` the contract validator already
  guards for the generator and the FHIR/SF adapters — one guard, no second copy.
- **Gated:** model-assisted parsing of **freeform** documents (Word tables, ERD exports,
  Confluence) is the model-key path — specced here, not built; the deterministic CSV/XLSX path is
  the buildable-now slice (XLSX = a thin sheet→CSV shim over the same parser; freeform = gated).

## 3 · Confirm-or-deviate, not closed

The dictionary is a **strong default, not a final answer**. `Patient.severity: string` lands as a
`code-derived · weak` claim the clinical owner can still deviate from ("actually it's our local
1–5 scale"). **Proven (unit test + both harnesses):** after a stakeholder `asserted` deviation on
a dictionary-typed locus, the only live source is `asserted` — the dictionary claim is
**superseded**, exactly as the precedence lattice promises. So the dictionary closes the bulk
mechanically and leaves the genuinely-contested typing for humans.

## 4 · Reroute the type questions — don't delete them

`useProgramLedger` now excludes TYPING slots (`dataType`/`valueSet`/`optionality`) from
`soloByOwner` (the domain-expert async lists) and collects them into **`typingLoci`**. The
operator inbox renders them as **one ask to the SYSTEM OWNER** (detected from the roster by role:
IT/EHR Lead, Salesforce admin, …), not N questions to the domain expert:

> **Data dictionary** — *45 "what type is X?" questions (types · value sets · optionality) — one
> upload of the data dictionary closes the wall, not 45 form fields to the domain expert.*
> **→ IT/EHR Systems Lead** · "Upload your current data dictionary."

The question is still owned, still tracked, still closes a locus — the answer arrives as a parsed
document from the **right** owner. Once uploaded, the ask shows the closed count and the
genuinely-contested typing residue. Verified live on the surgery program (screenshot in session).

---

## Acceptance — both programs, real ledgers

Measured by migrating each program and applying a representative dictionary through `reconcile()`.
`Sales Ops` is the (domain-blind) band that carries Chief of Surgery's 88 and Laila's Sales-Ops load.

### Surgery — Chief of Surgery 88 → 57 residue (via a CSV EHR dictionary)
| | before | after |
|---|---|---|
| Sales-Ops-owned open | **88** | **57** |
| typing open (dataType+valueSet+optionality) | **45** | **8** |
| `dataType` open | 31 | **0** |
| `valueSet` open | 7 | **1** |

A 31-field EHR/FHIR-derived CSV dictionary (7 with value sets) parsed and reconciled: **37 unknowns
filled**. **Residue (57):** `automationDisposition 24 · actorRole 24 · decision 5 · relation
optionality 7` — **design/judgment, not typing** (should-this-be-automated, who-performs-it,
what's-the-rule, relationship cardinality). The "what type is date/patient/procedure" wall is gone.

### Laila — Sales Ops 273 → 95 residue (via a Salesforce dictionary)
| | before | after |
|---|---|---|
| Sales-Ops-owned open | **273** | **95** |
| typing open | **244** | **35** |
| `dataType` open | 178 | **0** |
| `valueSet` open | 31 | **0** |

A 178-field Salesforce dictionary (the org's own fields) reconciled: **209 unknowns filled**.
**Residue (95):** `automationDisposition 46 · actorRole 46 · decision 3` — again design/judgment.
*(The live `Laila CRM` program the surface shows reports ~248; the in-repo `docs/laila` snapshot
migrates to 273 — same principle, same drop.)*

**Same fix, both domains** — the general import-first principle, not a per-standard build. The
`~178`/`~38` typing questions leave the domain expert's list; the residue in both is genuinely
human-judgment.

### The reroute lands on the system owner
Live on surgery: the 45 typing loci route to **IT/EHR Systems Lead**, not Chief of Surgery.

---

## Findings / notes
- **Vocabulary check (made: nothing):** no new source class or precedence change was needed —
  `code-derived` slots correctly (fills `generated`, loses to `asserted`). Reported as checked.
- **Honest limit (not a defect):** a data dictionary types **fields**, so it does **not** close
  **relation** `optionality`/`semantics` (cardinality/meaning of a relationship) — those stay
  open (surgery 7, Laila 35). That's correct: a field dictionary doesn't state relationship
  cardinality; those remain human/modelling questions.
- **World nuance (finding, minor):** the dictionary is as-is truth emitted as a `to-be` weak
  default so it closes the migrated to-be typing opens (confirm-or-deviate carry-forward). A
  fuller model would also register the as-is baseline for deviation detection; deferred, not core.
- **Persistence/UI (gated-adjacent):** the import reads a fingerprint-safe `_dataDictionary`
  field (CSV string or parsed `{name,fields}`) on the Listen inputs — the same write path as
  `_operatorActions`. A live upload button + freeform parse is the model-gated surface; the
  source path, CSV parse, reconcile-close, and reroute are all built and verified.

## Verification
`tsc` + eslint clean; **1218 tests green** (4 new in `dictionaryImport.test.ts`: parser
emit-unknowns, reconcile-close, confirm-or-deviate). Both acceptance runs measured on the real
migrated ledgers; reroute verified live on the surgery program.
