# Transcript externalization — plan

## Problem
A programme's entire state is one `adam_programs.data` JSONB blob. Pasted
transcripts dominate it — Laila's `sponsorConversation` alone is ~118k chars,
pushing the blob to ~4.5MB. Consequences:

- Every write re-ships the whole blob. Large writes hit Postgres's statement
  timeout (57014). That failed write is what the offline queue then replayed
  and clobbered the record with (now guarded in `writeQueue.ts`, but the
  timeout itself remains).
- Every regeneration re-reads the transcript into each agent's prompt (already
  mitigated edge-side by the 700-char grounding cap).

## Fields to externalize
The large free-text capture fields, all under `phaseInputs.<movement>.<field>`:
`sponsorConversation`, `interviewTranscripts`, `steeringConversation`,
`demoFeedback`, `shipConversations`, `opsConversations`
(source of truth: the `captureField` values in `flowMeetings.ts`).

## Architecture — split on write, merge on read
Keep the single-blob **read** model. The ~43 synchronous readers all go through
`readMovementInputs(program, movement)` and must not change.

- **On load / hydrate:** fetch `adam_program_texts` for the programme and merge
  each `content` back into `data.phaseInputs[movement_id][field_key]`. Readers
  see the full blob exactly as today.
- **On write:** before persisting, extract the externalized fields out of the
  blob into the texts table (only when a field's content changed), and store a
  tiny pointer in their place: `{ _ext: true, chars: N }`. The blob shipped to
  `adam_programs.data` is now ~KB, not MB.

This confines the change to **~4 seams**, not 43 read sites:
1. Client hydrate — `usePrograms` fetch (merge texts in).
2. Client persist — `updateProgramData` (split texts out; write table + blob).
3. Edge program load — `run-agent` `getInnerProgramData` path (merge texts in
   before building prompts/evidence).
4. Offline queue — `writeQueue.flushWriteQueue` must not re-inflate (it replays
   the small blob only; texts have their own writes).

## Phased rollout (each phase independently safe, reversible)
1. **Schema** — apply `20260715_program_texts.sql` (empty table; no behavior
   change). ✅ file ready.
2. **Dual-write, flag OFF by default** — persist writes texts to the table AND
   keeps them inline in the blob. Nothing reads the table yet. Verifiable with
   zero user-visible change.
3. **Backfill** — copy existing inline transcripts into the table (idempotent,
   in a transaction, verify row counts vs programmes). Reversible: the inline
   copy is still the source of truth.
4. **Dual-read** — hydrate merges the table, preferring it; falls back to inline
   when a row is absent. Verify parity (fingerprints unchanged) across every
   programme before proceeding.
5. **Cutover** — writes stop keeping the field inline (store the pointer only);
   the blob shrinks. Watch write latency / 57014 disappear.
6. **Edge merge** — deploy `run-agent` reading texts before prompt-building so
   grounding/evidence still see full transcripts. (Until this ships, keep inline
   as the edge's source — do phase 5 client-only after phase 6 is live.)

## Backfill SQL (phase 3, run in a transaction; illustrative)
```sql
-- For each programme, lift each externalizable field out of the blob.
-- Run per field_key; verify counts before committing.
insert into adam_program_texts (program_id, field_key, movement_id, content, chars, updated_at)
select p.id,
       'sponsorConversation',
       'frame',
       p.data #>> '{data,phaseInputs,frame,sponsorConversation}',
       length(p.data #>> '{data,phaseInputs,frame,sponsorConversation}'),
       now()
from adam_programs p
where p.data #>> '{data,phaseInputs,frame,sponsorConversation}' is not null
on conflict (program_id, field_key) do nothing;
-- (repeat for interviewTranscripts@listen, etc.; the blob path is
--  {data,phaseInputs,<movement>,<field>} for nested-data programmes)
```

## Rollback
- Phases 1–4 leave inline copies intact → revert = stop reading the table.
- Phase 5+ → re-merge the table back into the blob (a reverse backfill) before
  dropping the table.

## Risk gates
- Apply and test against a **healthy, authenticated** database — not mid-session
  when the connection is flaky.
- Verify `movementInputsFingerprint` is unchanged for every programme after
  dual-read (proves the merge is byte-identical to the old inline read).
- Do NOT run the backfill or cutover until dual-write + dual-read parity is
  confirmed on a snapshot/restore of the data first.

## Status
- [x] Schema migration written (`20260715_program_texts.sql`) — NOT yet applied to the DB.
- [x] Grounding-fact cap + memory-echo removal shipped (relieves the token side).
- [x] Pure split/merge core + round-trip tests (`src/v3/lib/programTexts.ts`).
- [x] Client wiring — dual-write/dual-read/cutover behind OFF localStorage flags
      (`src/v3/lib/programTextsSync.ts`, wired in `usePrograms.ts`).
- [x] Phase 6 — edge merge-on-read + env-gated (`EXTERNALIZE_CUTOVER`) write-split
      in `run-agent` (`supabase/functions/_shared/programTexts.ts`), with a
      client↔edge lockstep parity test. Deployed? NO — needs `functions deploy`.
- [ ] Apply migration → backfill → flip flags (dual-write → dual-read → cutover)
      + set the edge `EXTERNALIZE_CUTOVER` env — supervised, against the live DB.

## Activation runbook (all code is in; these are the remaining ops steps)
1. Apply `20260715_program_texts.sql` (creates the empty table).
2. Deploy `run-agent` (edge merge is a no-op until texts exist — safe to ship now).
3. Set client `localStorage['atos:externalize:dual-write'] = 'on'`; edit a
   programme; confirm rows land in `adam_program_texts` and the blob still works.
4. Backfill existing inline transcripts (SQL above), verify row counts.
5. Set `localStorage['atos:externalize:dual-read'] = 'on'`; verify
   `movementInputsFingerprint` is unchanged for every programme (parity gate).
6. Cutover: set client `atos:externalize:cutover = 'on'` AND the edge
   `EXTERNALIZE_CUTOVER=on` env together (client stops keeping inline; edge stops
   re-inflating). Watch the blob shrink and the 57014 statement-timeout vanish.
