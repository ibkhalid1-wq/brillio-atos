# The stakeholder linked page drinks from the one renderer

The linked page was the LAST question producer off the single-source renderer
(the open finding in `one-question-renderer.md` and `kit-question-projection.md`).
The durable-link pack carried stored question STRINGS built from the generated kit
agenda; `FlowRespond` / `FlowReviewSurface` rendered those strings. Two costs:

- a stakeholder could read phrasing **no ledger locus backs**, and
- answering **closed nothing** — the answer landed as prose with no locus, so the
  burn-down could not move.

## What changed (client, end to end)

**The pack carries LOCI, additively.** `FlowInterviewPack.questionLoci?: string[]`
— index-aligned with `questions` (`questionLoci[i]` is the `about` that
`questions[i]` closes). Written by `mintFollowUpPack` / `mintReviewPack`
(`src/v3/components/flow/flowPortal.ts`) only when the caller has loci; absent
otherwise, so a loci-less mint stores exactly what it always stored. The 8-question
cap trims BOTH arrays together, and a later loci-less ask **clears** the field
rather than leaving loci pointing at different questions. `questionLoci` is part of
`askSignature`, so a newly locus-backed ask counts as a genuinely new ask.

**The strings stay stored beside the loci** — deliberately. They are the record of
what was actually ASKED (the model can be re-rendered later), and the edge
validates a deferral against the pack's own question list.

**The operator sends the ask he can see.** `TheLine`'s per-person `⎘ link` used to
mint the kit script; it now mints the OPEN UNKNOWNS ON LOCI THAT PERSON OWNS —
literally the list their drawer shows (`ownedQuestionsFor` ← `ledger.soloByOwner`)
— rendered through `renderQuestion(store, about, "stakeholder")`. A person the
ledger owns nothing for still gets their link, carrying the kit script as before.

**The linked page renders through the ONE renderer.** `FlowRespond` rebuilds a
read-only store on the page from the `liveArtifacts` the edge already ships
(ontology + atlas), through the ONE read path `useProgramLedger` — no second
migration, no second projection. `portalQuestionModel`
(`src/v3/components/flow/portalQuestionModel.ts`) is the single decision:

| pack | store | result |
|---|---|---|
| loci present | resolvable | `mode:"loci"` — `groupQuestions(store, loci, "stakeholder")`, one card per element, sub-questions inside |
| loci present | element missing from this store | that ask falls through to `strings` **with its original index** — never dropped |
| no loci, or no store | — | `mode:"strings"` — renders exactly as before |

The unit stays QUESTIONS: `count = rows + strings`, and the header, the progress
bar and the follow-up banner all read that one number.

**Affordances, from the renderer, with grounded menus.** `PortalQuestions.tsx`
renders each row by `affordance`: chips (Automate / Assist / Keep manual) + an
optional one-line **why**; phase picker; role picker + free text; free text.
Picker menus come from `affordanceOptions(store, kind)` — the values the ledger
ALREADY HOLDS at loci of that kind. An empty list means the ledger states none, and
the surface falls back to free text rather than offering an invented vocabulary.
One component, two mount points (the plain interview page and the Listen review
surface), so the linked page cannot grow a second question UI.

**An answer is attributed to its locus.** `composeLocusAnswers` writes each answer
as `Q: … / A: … / Why: … / [locus: <about>]`, and `parseLocusAnswers` reads it back
to `{about, answer, why}`. It travels the existing quarantine channel
(`flow-portal` POST → `flowPortalInbox` → operator ingest).

### What a chip tap does NOT do — stated plainly

A chip tap is a one-tap ANSWER attributed to an exact locus. It is **not** a
closure. A public linked page has no ledger write path (no auth, no store write;
`useProgramLedger` documents that `ownership.stakeholder` is 0 in-browser by
construction), so the answer rides the same capture channel as every other answer
and becomes a claim only when the programme team confirms it on ingest. The page
says so where the questions are:

> "Each answer is filed against the exact point it settles. The programme team
> reviews it before anything changes in the model — nothing here updates the record
> on its own."

The regression test asserts this: after composing a chip answer, the open-unknown
count is **unchanged**. No faked closure.

## Verification

`src/v3/__tests__/portalLociQuestions.test.ts` — 19 cases, Laila + synthetic
surgery:

1. **One set, two audiences.** For every locus in a pack, the page's text ===
   `renderQuestion(store, about, "stakeholder")` === `ledger.kitQuestions`
   (the operator-side projection). The affordance matches too.
2. Every rendered row resolves to a real OPEN locus in `buildUnknownQueue`.
3. **Counts match:** `rows + strings === pack.questions.length`; group counts sum
   to the row count.
4. **Attribution round-trips** (`[locus: …]` → `{about, answer, why}`), and the
   burn-down does NOT move.
5. Picker options are a subset of the ledger's own live scalar values.
6. **Legacy packs unchanged:** string-only → `mode:"strings"`, same strings, same
   indices; loci with no store → strings; an unresolvable locus keeps its stored
   ask at its original index.
7. **Mint is additive:** no loci in ⇒ no `questionLoci` on the serialised pack; cap
   trims both arrays together; a loci-less re-ask clears stale loci; identical
   re-send is idempotent.

tsc clean · eslint clean (0 errors, 0 warnings) · vitest 96 files / 1340 tests
green · `scripts/validate-pipeline.sh` ALL SCRIPTED CHECKS PASS.

## INCOMPLETE — needs an edge deploy (not deployed here)

The edge is a pass-through and must forward the new field. **The source change is
made and NOT deployed**, so it is unverified in this environment:

`supabase/functions/flow-portal/index.ts`, in the `kind: "interview"` GET response
(beside `questions:`):

```ts
...(Array.isArray(hit.pack.questionLoci) && hit.pack.questionLoci.length
  ? { questionLoci: hit.pack.questionLoci.map(String).slice(0, 12) } : {}),
```

The `slice(0, 12)` must match the `questions` slice exactly or the arrays drift
apart. Nothing else on the edge changes: answers still arrive as `answers` text
(now carrying `[locus: …]` tags), and the deferral guard still validates against
`pack.questions`, which the client sends unchanged (it sends the STORED string, not
the freshly-rendered one).

Until that deploy lands, a served pack has no `questionLoci`, `portalQuestionModel`
returns `mode:"strings"`, and the linked page renders exactly as it does today. The
client side degrades to the old behaviour rather than breaking — that is the whole
point of the additive shape.

Deno cannot check this entrypoint here (remote imports fail TLS in the sandbox), so
the edge edit is verified by inspection only.

## Remaining findings (not done, deliberately)

- **Stakeholder writes are still gated.** Turning a confirmed portal answer into an
  `asserted · closed` claim needs an ingest-side step: parse `[locus: …]` out of the
  quarantined text (`parseLocusAnswers` already exists and is tested) and write
  through the operator commit path. That is an ingest change, not a linked-page
  change, and it is the next wire.
- **`mintReviewPack` accepts `loci` but no caller passes them.** `CollectBoard`'s
  per-person card mints review links from the kit script and has no ledger in hand;
  wiring it means giving that surface `useProgramLedger`. Left as the legacy
  string-only path, which still works.
- **`mintInterviewPacks` (the bulk kit-agenda mint) stays string-only** — it is a
  pure transform over the discovery kit with no ledger. It now explicitly clears
  `questionLoci` on refresh so an agenda change can never leave stale loci behind.
