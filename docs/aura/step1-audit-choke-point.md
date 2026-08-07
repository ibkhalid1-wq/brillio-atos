# Aura Spine — Step 1: Audit Choke-Point (handover)

**Status:** authored, **NOT APPLIED**, **NOT EXECUTED**. No local Postgres, node,
docker, or supabase CLI was available in the authoring environment, so nothing
below has run. This is the Q3 "you apply, I verify on your numbers" path.

**Delivered files**
- `supabase/migrations/20260807_audit_events.sql` — the migration (inline rollback at bottom).
- `supabase/migrations/_verify/20260807_audit_events.verify.sql` — run on a scratch DB after apply.

## The decision this implements
`audit_events` is the single authoritative, append-only, trigger-enforced log for
every state change to the three state-bearing tables: `adam_programs`,
`adam_agent_runs`, `adam_program_artifacts`. The trigger is the **sole writer**;
the app publishes semantics via a transaction-local `set_config('aura.intent', …, true)`
and the trigger reads it. Missing intent still writes an event, flagged
`intent_missing` — completeness is guaranteed, the gap is visible not silent.
Ships in **warn mode** (`aura_audit_config.enforce = false`) so applying is
additive-safe; flip to enforce only after every write path sets intent and
`intent_missing = 0`.

## Authority decision (recorded — this was the flagged spec question)
Four partial audit trails exist; none was authoritative:
`flowAttestations` (in-blob, capped, opt-in), `adam_audit_log` (client, best-effort,
**live** via `adamSync.writeAuditLog`), `adam_program_events` (dormant, double-defined),
`adam_decision_audit` (RLS, no writer). **Resolution: `audit_events` is the system
of record from this migration forward.** The others are **demoted, not deleted**:
they keep writing during warn mode and are retired only after enforce-flip with
`intent_missing = 0`. Only the fully-dormant `adam_program_events` is retired now
(renamed to `adam_program_events_retired_20260807`, INSERT revoked — never dropped).

## PREREQUISITES you must run before applying (I cannot reach these)
1. **Establish the real shape of `adam_program_events` in each environment** —
   two incompatible historical definitions exist (`20260613093000` uuid/event_type
   vs `20260714` bigint/kind); which is live is an application-order fact, not a
   repo fact. Run in local, staging, prod:
   ```sql
   select column_name, data_type from information_schema.columns
    where table_schema='public' and table_name='adam_program_events' order by ordinal_position;
   select count(*) from public.adam_program_events;   -- rows = partial record
   ```
   The migration's retirement is **shape-agnostic** (a rename), so it is safe
   either way. **If the table holds rows, do NOT migrate them into `audit_events`**
   — that would contaminate a complete log with an incomplete one. Leave them in
   the retired table.
2. **Confirm the three state-bearing tables are the complete set.** I verified
   these three carry mutable state; if a fourth table holds engagement state,
   the trigger must attach there too or completeness covers only part.

## What local could NOT verify (needs your run)
- **Everything functional** — the SQL has never executed. Run the verify script;
  every line must print ` PASS`.
- **Grant-level sole-writer** (verify step 6) — needs a role switch to
  `authenticated`; confirm the direct insert is denied.
- **Real concurrency** — simultaneous client-session and edge service-role writes
  under load; single-user verification will not surface interleaving.
- **Trigger cost at production blob sizes** — O(blob size) on every write. Treat any
  local timing as indicative; **re-measure on a production-sized `adam_programs.data`
  after apply.** If cost is unacceptable, the expensive part is **`md5(doc::text)`**,
  which serializes the entire JSONB to text before hashing; the changed-top-level-key
  comparison operates on the already-parsed jsonb structure and is comparatively cheap.
  So **drop or defer the fingerprints and keep `changed_keys`** — not the reverse.

## Assumptions baked into the SQL that you should sanity-check
- `auth.uid() IS NULL` reliably distinguishes service-role from client session in
  trigger context (standard Supabase, but confirm for your edge invocation path).
- The trigger function is `SECURITY DEFINER` owned by a role that bypasses RLS on
  `audit_events` (table owner, RLS not FORCEd) — so it can insert while all app
  roles have INSERT revoked. Confirm the migration runs as such an owner.
- `adam_programs.id` is text in practice; `audit_events.program_id`/`row_pk` are text.

## Step 1b — the enforcement model (REVISED; supersedes "wire intent before each write")

### The finding that forced the revision
The action_type census proved the DB write sites are not the actions; a topology
check then proved **there is no singular client funnel to enforce at**:
- **`saveProgramToSupabase` (adamSync) — the presumed funnel — has ZERO callers. Dead
  code** (→ delete; Findings below).
- The live client (`AppShellV3`) writes `adam_programs` **directly, inline** (upsert
  :1238, insert :1770/:1856, rename :2005, archive :1953, tag/comment :2076/:2114) and
  drives `usePrograms` (:461/681/712) + **seven feature hooks** (`useGateReview`,
  `useMilestones`, `useBudgetTracking`, `useClosure`, `useDecisionQueue`,
  `useProgramNotes`, `usePhaseProgress` in `src/new/lib/*` — all imported by
  `AppShellV3`, therefore **live**) that each write directly.
- Edge: `run-agent` **does** funnel through `persistProgramData` / `persistAgentArtifact`
  (singular for that function); `flow-portal`, `resume-agent`, `restore-artifact`, and
  run-agent's own **run-status** writes go direct.

So "set intent immediately before each write and prove precedence with a static test"
**cannot work**: intent is set in a mutator/hook and the write is many frames down a
call chain — locality proves nothing. The model changes to funnel-based.

### The four guarantees, and which layer provides each
1. **Completeness — the DB trigger (Step 1).** An event for every write, any call
   depth, any path, including direct SQL. Never depended on a funnel; still doesn't.
2. **Intent present — the funnel.** No single funnel exists, so Step 1b *creates the
   enforcement points*:
   - **Client:** introduce ONE persistence funnel — `persistProgram(intent, programId,
     data, baseUpdatedAt)` — and route **every** client write to the three tables
     through it. It sets `aura.intent` from the caller's intent, then writes. The
     caller (mutator/hook/handler) supplies the action — the action is known upstream,
     not at the DB call. This is a **refactor**, and it is the whole point: one runtime
     assertion covers every caller, present and future, at any depth, surviving
     refactors — and it consolidates the sprawling write paths (see duplicate finding).
   - **Edge:** `persistProgramData` / `persistAgentArtifact` become the run-agent
     funnels (set/require intent inside, once). The other edge writers are direct and
     each set intent at their site (few, enumerated below).
3. **Intent well-formed — the static test** (its real, reduced scope below).
4. **The warn-mode gap — `intent_missing`** counts writes that still arrive bare.

### Refuse behaviour, by mode, and where the switch lives
One switch governs the whole layer: the existing `aura_audit_config.enforce` flag the
trigger reads — the funnel reads the same flag.
- **warn (enforce=false, default):** the funnel does not refuse; it sets whatever
  intent it has and writes; the trigger records `intent_missing` for gaps. Additive-safe.
- **enforce (enforce=true):** the funnel **throws** on missing intent — client and edge
  service-role alike (both are our own code; an unwired path is a bug to fix, not ship;
  the edge trigger would raise anyway). Throwing is correct here and wrong in warn — hence
  the mode gate. Funnel and trigger flip together on the one flag.

### Client vs edge — the two domains reach the funnel differently
Two funnel implementations, matching the two helpers: the **client** funnel runs under
the user session and does NOT send `actor` (JWT supplies it); the **edge** funnels run
service-role and REQUIRE `actor`. Same "intent present" check, different actor rule.

### Funnelled vs direct — the funnel guarantee covers only the funnelled
- **Funnelled (client), after the refactor:** all AppShellV3 program writes, `usePrograms`,
  the seven hooks, and `writeQueue` replay → through `persistProgram`. Then **no client
  `.from("<state table>").<write>` exists outside the funnel module** — the static test
  enforces exactly that.
- **Direct (edge) — each needs its own intent call; the funnel does NOT cover them:**
  `flow-portal` :699/737/956 (`system.ingest_stakeholder_response`), :771
  (`system.record_link_engagement`); `resume-agent` :243/:373 (`system.resume_agent_run`);
  `restore-artifact` :198/179 (`system.restore_artifact`); run-agent **run-status** writes
  (:10156/10258/10312/10454/10502/11490/11590/11746/11844 — NOT inside persistProgramData;
  see consolidation finding). run-agent's `persistProgramData`/`persistAgentArtifact` ARE
  the funnel for its program/artifact writes → set intent inside once.

### The static test's real scope — and what it can no longer prove
It **cannot** prove intent precedes a write by locality. Build to what it *can* assert:
- **No direct client write** — the only client `.from("<state table>").(update|insert|upsert|delete)`
  occurrences are inside the funnel module. Any other is a bypass → fail. *(This is the
  static half of the funnel guarantee — stronger than the old precedence check.)*
- **Vocabulary membership** — every `action_type` / `affected_kind` literal passed to a
  helper ∈ its closed set (`docs/aura/action-type-vocabulary.md`).
- **Actor rule** — no client helper call passes `actor`; every edge one does (also type-enforced).
- **No inline intent** — `set_config('aura.intent', …)` appears only inside the two helpers.
- **Edge direct-writers pinned** — a new edge `.from("<state table>").<write>` outside the
  enumerated list and not through a funnel → fail (forces a decision).

**NOT statically checkable — do not let anyone believe the test proves more:**
- Intent's *value* being **correct** — a mutator can pass a valid-but-wrong action_type;
  no layer detects semantic mislabelling.
- `affected_id` pointing at the right element.
- That the runtime `set_config` actually ran in-transaction before the write (the funnel's
  runtime job, not statically provable).

### writeQueue — transaction-local intent does not survive a retry
`enqueueWrite` stores `{table, programId, payload, baseUpdatedAt}` in localStorage and
replays as a blind update — **no intent**. Specify:
- **Add `intent`** (the full payload) to the queued record.
- **Replay through the same funnel**, re-setting `aura.intent` from the stored intent
  before the write — the queue goes *through* `persistProgram`, not around it.
- **Stale vocabulary:** on replay, validate the stored `action_type`/`affected_kind`
  against the *current* closed sets. If the vocabulary moved and the stored action is no
  longer valid → do **not** write it under a dead verb; record `intent_missing` (or a
  reserved `action_type:"legacy_replay"`) and surface it.
- **Timestamps — record both.** The event's authoritative `ts` = server clock at the
  actual write (**replay time** — when it truly landed; do not backdate, it would falsify
  append-only ordering). Carry the original **`enqueuedAt`** in the event detail (when the
  user did it). "When did it happen" vs "when did it land" differ, and someone will ask both.

### The three-layer picture — and the failures NO layer catches
| layer | guarantees | catches |
|---|---|---|
| DB trigger | an event exists for every write | a write with no event → impossible; direct-SQL/service write → recorded (intent_missing) |
| Funnel (+ static "no direct client write") | the write carries intent | client write with no intent → throw (enforce) / intent_missing (warn) |
| Static test | the intent is well-formed | bad action_type/kind, actor misuse, inline set_config, client write bypassing the funnel |
| `intent_missing` counter | measures the warn gap | how many writes still lack intent before the flip |

**No layer catches:** (1) intent present but **semantically wrong** (right shape, wrong
action) — review + mutator naming only; (2) `affected_id` imprecise/wrong; (3) a **new
state-bearing table** written without the trigger attached — invisible to trigger *and*
test until registered; (4) an **edge direct-writer that forgets intent** — recorded as
intent_missing, not prevented, until wired; (5) **wrong human behind an authentic session**
— the AccessGrant/identity problem (Steps 2/6), not this layer. A defence-in-depth diagram
that implied full coverage would be worse than none — these are the holes.

### Carried unchanged from the earlier plan
- **run-agent RPC:** wrap the three un-transactioned writes (`persistAgentArtifact` +
  `persistProgramData` + run-row status) in ONE `SECURITY DEFINER` RPC at that call site —
  fixes the cross-table partial + `outputRepaired` gap, and gives one place to set intent
  for the whole generation transaction.
- **Two helpers, two signatures:** client helper has **no `actor` param** (JWT supplies it);
  edge helper **requires** it. Trust in types, not discipline.
- **Enforce sequence:** wire funnel + edge direct-writers in warn → watch `intent_missing → 0`
  → flip `enforce` (funnel + trigger together) → then retire `adam_audit_log` (shim
  `writeAuditLog` to set intent) and demote `flowAttestations` to a derived UX projection.

### Findings awaiting a decision (recommend; do not act)
- **`saveProgramToSupabase` is dead (zero callers). Recommend DELETE** — a "funnel" that
  funnels nothing invites someone to wire intent into a path that never runs. Cost: nil
  (unreferenced); fold into the funnel refactor.
- **`src/new/lib/*` hooks are LIVE** (imported by `AppShellV3`) — this **resolves the
  vocabulary's F3. Recommend WIRE, not delete** (vocabulary doc F3 updated to match).
- **Duplicate paths.** *Client* archive-×2 (and every save duplicate) **consolidate for
  free** through the funnel refactor. *Edge run-status* complete-×4 / fail-×4 — **recommend
  consolidate BEFORE wiring**: introduce `setRunComplete()` / `setRunFailed(reason)` helpers,
  route the sites through them, set intent once inside each. **Order cost:** consolidate-first
  = one small refactor, intent set once, one name guaranteed; wire-first = intent at four
  sites per action (four chances to diverge) and a later consolidation re-touches all four.
  Consolidate-first is cheaper and safer.

## Definition-of-done status for Step 1
- [x] Invariant designed and expressed as a migration + verify script.
- [ ] Migration applied and reversible — **blocked on your environment** (author-side had no DB).
- [ ] Real data run through it, numbers reported — **blocked**; verify script ready.
- [x] Nothing downstream removed (retirement is additive rename; legacy trails still write).
- [ ] Claims register updated — pending apply; on success, "auditable" moves from
  false to true (complete + affected_id), per the Step-6 claims register.
