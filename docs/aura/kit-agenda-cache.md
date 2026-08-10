# The kit agenda is a CACHE, not a source

Amendment to `kit-question-projection.md`. Questions now project from the ledger
(`renderQuestion.ts` is producer-zero; `kitProjection.ts` projects the open unknowns).
The generated `discoveryKit` artifact predates that and still stores agenda question
STRINGS at `interviews[].agenda[].questions` — a field whose name and position read
like the plan itself. A reader could not tell by looking which of the two it held.

## The demotion (`src/v3/lib/ledger/kitAgendaCache.ts`)

The strings move to a **versioned cache** on the interview:

```jsonc
// discoveryKit.interviews[]
"agenda":      [ { "topic": "Their workflow today", "minutes": 45 } ],   // the PLAN, kept
"agendaCache": {
  "version": 1,
  "questions": ["…"],
  "loci": ["el:attr:quote.status#valueSet"],   // when the mint knew them — the way back
  "at": "2026-08-10T…Z",
  "note": "cache of rendered question text — the ledger's open unknowns are the source"
}
```

- **One accessor.** `readKitAgendaCache` / `kitAgendaQuestions` replaced **five**
  independent "flatten agenda blocks into strings" implementations
  (`flowStakeholders.ts:363`, `flowMeetings.ts:115`, `flowPortal.ts:365`,
  `listenCoverage.ts:189`, `studios.tsx:153`). One definition, read by every surface.
- **Backward compatible, and honest about it.** No cache ⇒ the legacy inline strings
  are read exactly as before and reported `origin: "legacy-inline"`, `version: 0` — a
  legacy artifact is never dressed up as a fresh cache, and `at` stays `null` rather
  than being invented.
- **An EMPTY cache is authoritative.** A cleared question list is not refilled from
  the legacy blocks — that would resurrect what the operator deleted.
- **Idempotent.** `demoteKitAgendas` skips an already-migrated interview and returns
  the same object, so re-saving is a no-op, not a fresh timestamp.
- **The plan survives.** The agenda blocks keep `topic` + `minutes`; a 45-minute shape
  is the conversation's design, not a question producer.

## Where the demotion actually runs

| Layer | State |
|---|---|
| **Readers** (5 surfaces above) | **done** — cache-first, legacy fallback |
| **Client write** — the Discovery Kit studio's question editor | **done** — an operator edit writes the cache and strips `agenda[].questions` |
| **Generator** (`supabase/functions/run-agent/index.ts`, the discoveryKit output contract) | **NOT done — needs an edge deploy.** It still emits inline `agenda[].questions`; until it emits `agendaCache` directly, `readKitAgendaCache` is what keeps the two shapes one reader. |

## Verification (`src/v3/__tests__/kitAgendaCache.test.ts`, 9 cases)

Origin/version honesty, empty-cache authority, idempotence, loci carriage, and the
one that matters: **every reader returns the SAME questions for a legacy kit and for
its demoted twin** — Listen stakeholder cards, the Listen meeting kit, and a minted
stakeholder link, asserted pairwise.

tsc + eslint clean; 1393 tests green; `validate-pipeline.sh` all PASS (A1 — exactly
one question-text producer — still holds: this module moves strings, it never phrases
a question).
