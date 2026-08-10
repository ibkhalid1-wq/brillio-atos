# The curation path — minting a PROPOSED locus from an ontology-gap kit question

**The gap this closes** (open finding, `kit-question-projection.md`): `reconcileKit`
classifies an unmatched kit question as **`ontology-gap`** — *the kit knows a thing the
ontology missed* — but there was **no way to act on one**. Curation was dismissal and
deferral only (`_curationLog`, `_dismissedAsks`), so a genuine finding could be filed and
never become a question anyone owns. The burn-down could not move on it, because there was
no locus to burn down.

## What was built — `src/v3/lib/ledger/curation.ts`

An operator **MINTS** a proposed element plus **the one `?unknown` it opens**, from a named
kit question. Same shape as the operator verbs that came before it, deliberately:

| | mechanism |
|---|---|
| **write** | a `mint-element` / `retract-mint` action on the existing `_operatorActions` underscore field, through the ONE write path (`useOperatorCommits`, `{silent:true}`). No new channel. |
| **read** | a **read-model overlay** in `useProgramLedger`: the proposed element + claim are appended to what `buildReadModel` is handed, exactly the way `applyOwnership` overlays ownership. |
| **frozen core** | untouched. Nothing here calls `store.addElement` / `store.assert`; no claim is persisted. |
| **undo** | `retract-mint`. The fold replays the log, so a retracted proposal leaves the read model in *exactly* its pre-mint state. |

### The five honesty rules it holds

1. **Provisional and MARKED.** Every minted element id carries the `el:proposed:` prefix, so
   a proposal is never indistinguishable from an element the ontology actually holds — at a
   glance, in a log, or in a locus id. `isProposedLocus(about)` is the one predicate; the
   inbox tags every question line it produces `◇ proposed` (dashed border, not solid).
2. **Attributed.** Who proposed it, from **which kit question**, and when — carried on the
   action and surfaced on `ledger.proposals` (`MintedProposal`).
3. **No fabrication.** The element NAME is operator-supplied; nothing derives a noun from
   free-text question tokens (`mintProposal` returns `null` rather than guess). The claim's
   value is `?unknown` and its owner `unowned`: a proposal asserts only **that there is a
   question here** — never the answer, never the owner.
4. **One definition.** A proposal whose concept the ontology already holds mints **nothing**
   — it is reported `alreadyModelled` pointing at the element that holds it, so curation can
   never fork a second definition. Two gap questions about one missing thing converge on ONE
   element (content-derived id over kind + parent + name), with both questions kept as
   provenance.
5. **Never outranks evidence.** Source `dispositioned` — the honest label for an attributed
   human proposal, and the *weakest* human-decision source, so by precedence `asserted` /
   `document` / `regulation` all win on that locus. Open with no closure, so the heard-count
   cannot move.

Ids are content-derived via `contentId` (stable across renders and re-mints), and the claim
row uses the **same `contentId` formula `store.assert` uses** — the overlay is a preview of
a future persisted curation write, not a parallel dialect (asserted in the test).

## Evidence — real reads

`reconcileKit(["How is a sterilisation tray shortage handled before an operation?"], laila)`
→ `ontology-gap` (the ontology models no element for it). Minting from that question, on
the committed Laila record:

| | elements | claims | open unknowns | need-an-owner | kit questions |
|---|---|---|---|---|---|
| before | 310 | 955 | 395 | 0 | 395 |
| **after mint** | **311** | **956** | **396** | **1** | **396** |
| after retract | 310 | 955 | 395 | 0 | 395 |

Exactly one element, exactly one open locus, and the retract restores the read model
byte-for-byte. The minted locus renders through the ONE renderer — *"What does Sterilisation
Tray mean, exactly?"* (`el:proposed:e3c1c1ee#semantics`) — so kit === queue still holds, and
it routes to **need a human owner** (not the dictionary bucket: a proposal needs a person,
not a data dictionary).

Conservation holds before, during and after: `open === dictionary + need-owner + session +
solo`, and `unowned-open === assignQueue + the unowned slice of typingLoci`.

## Proof — `src/v3/__tests__/curationMint.test.ts` (21 cases)

Read through the SAME functions `useProgramLedger` runs, in the same order.

1. The gap is real (`reconcileKit` → `ontology-gap`) and the mint is derived from it.
2. No fabrication: a mint with no name / no source question / no author / no timestamp is
   refused; `retractProposal("")` is refused.
3. Provisional + attributed + content-addressed; the same proposal always mints the same id;
   a different concept gets a different id.
4. **+1 element, +1 live claim, +1 open unknown — and the added locus IS the minted one.**
5. The claim is an open `?unknown`, unowned, `dispositioned`, no closure, `createdAt` = mint.
6. The heard-count and the closed/weak burn-down cannot move.
7. The overlaid claim id === what `store.assert` produces for the same locus.
8. It is in the queue, unowned, routed to need-an-owner, NOT to the dictionary bucket.
9. It is marked proposed — and every other open locus in the program is not.
10. Its question comes from `renderQuestion` (producer-zero) and reaches the kit projection.
11. Retract restores elements / loci / claims / burn-down exactly; re-mint after retract
    carries fresh attribution; a retract of something never minted is a no-op.
12. Conservation asserted at all three states; the mint moves the need-owner bucket by
    exactly one and no other bucket.
13. One definition: minting an already-modelled name (`Case`) mints nothing and reports
    `alreadyModelled: el:entity:case`; two gap questions about one thing → one element.
14. Promotion rehearsal on a scratch store: an `asserted` answer supersedes the minted
    `?unknown`, the locus leaves the queue, and the ANSWER is heard — the proposal never was.

tsc clean · eslint clean (0 errors, 0 warnings) · 1384 tests green · `validate-pipeline.sh`
all PASS.

## Findings (reported, not silently done)

- **Promotion into the PERSISTED ledger needs a frozen-core change — NOT made.** The overlay
  is browser-only: only the action log is stored, and the proposed element/claim are
  reconstructed on every read. To persist a proposal (so the server ledger, `PgLedger`, and
  any non-hook reader see it), the core needs a first-class marker for provisional identity
  — a `proposed`/`provenance` field on `LedgerElement` in `types.ts` and/or a `proposed`
  member of `Source` in `precedence.ts` (with its rank pinned below every evidence source).
  Today the ONLY marker is the `el:proposed:` id prefix plus the operator-action log; a
  reader that bypasses `useProgramLedger` would see an ordinary element with a
  `dispositioned` open unknown. `types.ts` and `precedence.ts` are frozen core, so this is
  reported for a decision, not made.
- **The MINT ENTRY POINT is library-level; no surface offers "mint" yet.** `reconcileKit` is
  not consumed by any in-browser surface, because the discovery-kit artifact it reconciles
  against is **DB-only in this environment** — a mint button would sit above a list that
  cannot be honestly populated here. What IS wired: the inbox tags every proposed question
  `◇ proposed` with its provenance on hover, and offers **retract proposal** on the row. The
  remaining wiring is one gap-findings panel that calls `mintProposal(...)` and commits it
  through `useOperatorCommits` — the same one-line call the test makes.
