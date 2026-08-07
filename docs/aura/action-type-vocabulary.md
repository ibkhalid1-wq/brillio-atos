# Aura — `action_type` Vocabulary

The closed set of `action_type` values the audit trail (`audit_events`, Step 1) is
written and read in. Decided once, now, with the whole write census in hand —
because the alternative is inventing thirty names under deadline at thirty call
sites with no view of the set, which is how one action ends up with three names
and the log becomes unqueryable.

`action_type` answers **"what was someone doing?"** — a domain verb, never the
mechanical `update/insert/delete`. This document is the prose companion; the
machine-checkable source is a committed `ACTION_TYPES` set (see §6).

---

## The central finding — the DB write sites are NOT the actions

The write census (§4) is small and **generic**: nearly every state change to
`adam_programs` is a whole-blob `update`/`upsert` through one of a few persistence
functions. The *meaning* — capture evidence, resolve a decision, approve a gate,
edit an artifact — lives in the **flow mutator** that builds the new blob and hands
it to the generic save (`flowDecisions.ts`, `flowApprovals.ts`, `flowArtifactEdit.ts`,
`flowStakeholders.ts`, `flowGovernance.ts`, `useGateReview.ts`, …). So:

> **`action_type` must be published by the caller that knows the intent — the flow
> mutator / handler — not defaulted at the DB write.** The generic save is only where
> the trigger *reads* the intent; the action is named upstream.

The vocabulary below is therefore keyed on **actions** (what the mutator does), and
§4 maps each DB write site to the action(s) that reach it. A site that can carry
many actions is flagged — that is a finding, not a name.

---

## §1 · User actions (client, attributed to a JWT person) — bare names

| action_type | what the person did | affected_kind | origin (mutator/handler) |
|---|---|---|---|
| `create_program` | start a new engagement from seed | program | AppShellV3 new-program |
| `clone_program` | start a new engagement copied from an existing one | program | AppShellV3 clone |
| `rename_program` | rename the engagement | program | AppShellV3 rename |
| `archive_program` | soft-delete (is_deleted) the engagement | program | AppShellV3 / adamSync |
| `migrate_local_program` | promote a local-only engagement to the cloud | program | useLocalProgramMigration |
| `request_agent_run` | ask for a generation (creates the run row) | agent_run | client run trigger (adamSync) |
| `capture_evidence` | save attributed evidence/inputs into a movement | phase_inputs | flowCapture / onSaveInputs |
| `edit_artifact` | edit a generated document | artifact | flowArtifactEdit |
| `resolve_decision` | confirm or decline a flow decision | decision | flowDecisions |
| `file_contradiction` | log a contradiction between statements | decision | flowDecisions |
| `approve_gate` | record a gate as approved | gate | useGateReview.approveGate |
| `reopen_gate` | reopen a previously-approved gate | gate | useGateReview.reopenGate |
| `send_for_approval` | send an artifact to stakeholders for sign-off | gate | flowApprovals |
| `record_approval_decision` | approver signs off / requests changes | gate | flowApprovals |
| `tag_claim` | tag a claim on an artifact | program | AppShellV3 claim tags |
| `comment_claim` | comment on a claim | program | AppShellV3 comments |
| `rename_person` | rename a participant across the record | phase_inputs | flowStakeholders |
| `add_stakeholder` | add a person to the roster | phase_inputs | flowStakeholders |
| `mint_interview_pack` | issue a stakeholder share link | program | flowPortal (client) |
| `mint_sponsor_brief` | issue a sponsor brief link | program | flowBriefs |
| `schedule_meeting` | schedule a stakeholder meeting | program | flowMeetings |
| `update_metric_registry` | change a governed metric definition | metric | governed metrics (F-002) |
| `record_ship_action` | record a Ship-phase action | program | flowShip |
| `update_milestones` | edit programme milestones | program | useMilestones |
| `update_budget` | update budget tracking | program | useBudgetTracking |
| `edit_notes` | edit programme notes | program | useProgramNotes |
| `update_phase_progress` | record phase progress | program | usePhaseProgress |
| `setup_program` | set up / configure the engagement | program | useProgramSetup |
| `record_closure` | record programme closure | program | useClosure |
| `resolve_inbox_decision` | resolve an Inbox decision | decision | useDecisionQueue |
| `create_snapshot` | save a recovery snapshot of the engagement (safety ring) | program | useProgramSnapshots |

**Provenance RESOLVED — LIVE (see F3):** the Step-1b topology check found these
`src/new/lib/*` hooks imported by `AppShellV3` (the live v3 chrome), so they are live.
Now enumerated above in §1 and per-site in §4 (naming done): `update_milestones`
(useMilestones), `update_budget` (useBudgetTracking), `edit_notes` (useProgramNotes),
`update_phase_progress` (usePhaseProgress), `setup_program` (useProgramSetup),
`record_closure` (useClosure), `resolve_inbox_decision` (useDecisionQueue), and
`create_snapshot` (useProgramSnapshots, adam_program_snapshots — a table the first
census sweep missed). (`useGateReview` was already confirmed live.) Naming and census
only — the intent wiring itself is Step-1b work, behind the gate.

`save_program_state` — the generic whole-blob autosave/sync. **Not a real action.**
It is the fallback the persistence layer uses; every write above ultimately lands
through it. It exists in the set only so an *unclassified* save is nameable and
visibly ungrounded (like `intent_missing`), never as a legitimate resting name for
a real action. If it appears often in the audit, that is a wiring defect.

## §2 · System actions (service-role) — `system.` prefix

| action_type | what the system did | affected_kind | origin |
|---|---|---|---|
| `system.generate_artifact` | generate/supersede an artifact + write it into the blob | artifact | run-agent |
| `system.start_agent_run` | create/establish a run record | agent_run | run-agent |
| `system.update_agent_run` | stash run context mid-run (e.g. cross-artifact validator) | agent_run | run-agent |
| `system.complete_agent_run` | mark a run complete | agent_run | run-agent / resume-agent |
| `system.pause_agent_run` | pause a run (partial draft) | agent_run | run-agent |
| `system.fail_agent_run` | mark a run failed (reason in detail: error / governance / budget / timeout) | agent_run | run-agent |
| `system.resume_agent_run` | resume a paused run | agent_run | resume-agent |
| `system.ingest_stakeholder_response` | record a stakeholder's portal submission (question / design feedback / interview response) on their behalf | phase_inputs | flow-portal |
| `system.record_link_engagement` | record share-link telemetry (opened / dwell / step) | program | flow-portal |
| `system.restore_artifact` | restore a prior artifact version + rewrite the blob | artifact | restore-artifact |

## §3 · Why `system.` prefix, not a shared namespace

Service-role writes carry the `system.` prefix; user actions are bare. `actor`
already differs (a system write has no JWT person; a user write does), so the
prefix is deliberate redundancy that buys three things:
1. **`action_type` alone is queryable** — `where action_type like 'system.%'` answers
   "what did the platform do" without joining or interpreting `actor`.
2. **No collision** — a user `resolve_decision` can never be confused with a system
   transition of a similar name.
3. **The "on behalf of" case is expressible.** `system.ingest_stakeholder_response`
   is a *system* write (service-role) whose content is *attributed to a named
   stakeholder* (the assertion's `source_participant`, once Step 3 lands). The prefix
   says "the system performed the write"; the assertion says "on behalf of Renée."
   The two questions — *what did this person say* vs *what did the system do for
   them* — stay separable, which they would not if both were bare.

## §4 · The write-site census → action_type

Every double-quoted `.from("<table>")` **write** (verb confirmed). Reads excluded.

### `adam_programs`
| site | verb | action_type |
|---|---|---|
| AppShellV3.tsx:1770 | insert | `create_program` |
| AppShellV3.tsx:1856 | insert | `clone_program` |
| AppShellV3.tsx:2005 | update | `rename_program` |
| AppShellV3.tsx:1953 | update(is_deleted) | `archive_program` |
| adamSync.ts:205 | update(is_deleted) | `archive_program` *(dup path — F2)* |
| useLocalProgramMigration.ts:90 | insert | `migrate_local_program` |
| AppShellV3.tsx:1238 | upsert | `save_program_state` *(generic — carries the real action from its caller, F1)* |
| adamSync.ts:142 | upsert | `save_program_state` *(dup — F1/F2)* |
| usePrograms.ts:461 / :681 / :712 | upsert/update/upsert | `save_program_state` *(dup — F1/F2)* |
| AppShellV3.tsx:2076 | update | `tag_claim` |
| AppShellV3.tsx:2114 | update | `comment_claim` |
| useGateReview.ts:207 / :218 | update / upsert | `approve_gate` / `reopen_gate` *(the update path serves both; disambiguated by the mutator)* |
| flow-portal:699 | update | `system.ingest_stakeholder_response` (question) |
| flow-portal:737 | update | `system.ingest_stakeholder_response` (design feedback) |
| flow-portal:956 | update | `system.ingest_stakeholder_response` (interview response) |
| flow-portal:771 | update | `system.record_link_engagement` |
| run-agent:5274 / :5294 / :5326 | update | `system.generate_artifact` (blob write of the generated doc) |
| restore-artifact:198 | update | `system.restore_artifact` |
| resume-agent:373 | update | `system.resume_agent_run` (blob restore on resume) |
| useMilestones.ts:57 | update | `update_milestones` |
| useBudgetTracking.ts:57 | update | `update_budget` |
| useProgramNotes.ts:22 | update | `edit_notes` |
| usePhaseProgress.ts:26 | update | `update_phase_progress` |
| useClosure.ts:52 | update | `record_closure` |
| useProgramSetup.ts:109 / :120 | update / upsert | `setup_program` |
| useDecisionQueue.ts:37 | update | `resolve_inbox_decision` |

### `adam_agent_runs`
| site | verb | action_type |
|---|---|---|
| adamSync.ts:306 | upsert | `request_agent_run` (client-initiated) |
| run-agent:5346 | insert | `system.start_agent_run` |
| run-agent:10190 | upsert | `system.start_agent_run` (idempotent establish) |
| run-agent:10409 | update(input_context) | `system.update_agent_run` |
| run-agent:10258 / :10312 / :11490 / :11746 | update(status=complete) | `system.complete_agent_run` *(four paths — F2)* |
| resume-agent:384 | update(status=complete) | `system.complete_agent_run` |
| run-agent:11590 | update(status=paused) | `system.pause_agent_run` |
| run-agent:10156 / :10454 / :10502 / :11844 | update(status=failed) | `system.fail_agent_run` *(four paths; reason=error/governance/budget — F2)* |
| resume-agent:243 | update(status=running) | `system.resume_agent_run` |

### `adam_program_artifacts`
| site | verb | action_type |
|---|---|---|
| run-agent:5025 | insert | `system.generate_artifact` |
| run-agent:5043 | update(superseded_*) | `system.generate_artifact` (supersede prior version) |
| restore-artifact:179 | (write) | `system.restore_artifact` |

### `adam_program_snapshots`
Missed by the first census sweep (a separate table from the three state-bearing
ones); useProgramSnapshots is imported by `AppShellV3`, so it is live.
| site | verb | action_type |
|---|---|---|
| useProgramSnapshots.ts:123 | insert | `create_snapshot` |
| useProgramSnapshots.ts:134 | delete | `create_snapshot` *(ring prune — housekeeping in the same action: drops the oldest beyond the retention budget)* |

## §5 · `affected_kind` — the closed set

Seven values — the *type* of thing an action touches. The exact sub-element is the
`affected_id` JSON-pointer path (Step 1), so `affected_kind` stays coarse and finite.

| affected_kind | is | action_types that pair with it |
|---|---|---|
| `program` | the engagement row / whole blob | create/clone/rename/archive/migrate/save_program_state, tag_claim, comment_claim, mint_*, schedule_meeting, record_ship_action, update_milestones, update_budget, edit_notes, update_phase_progress, setup_program, record_closure, create_snapshot, system.record_link_engagement |
| `phase_inputs` | captured evidence/inputs within a movement | capture_evidence, rename_person, add_stakeholder, system.ingest_stakeholder_response |
| `artifact` | a generated document (blob field and/or artifacts row) | edit_artifact, system.generate_artifact, system.restore_artifact |
| `agent_run` | a run record | request/system.start/update/complete/pause/fail/resume_agent_run |
| `decision` | a flow decision | resolve_decision, file_contradiction, resolve_inbox_decision |
| `gate` | a gate review / approval | approve_gate, reopen_gate, send_for_approval, record_approval_decision |
| `metric` | a governed metric definition | update_metric_registry |

## §6 · How a new action gets added (so nobody invents a synonym)

1. **One committed source of truth:** an exported `ACTION_TYPES` set (a `const` array
   / union) that lives beside the Step-1b intent helpers and mirrors this document.
   The intent helpers accept only members of it (a typed union — an unknown string
   won't compile client-side).
2. **Where the next person looks:** this file. It is linked from the intent-helper
   module header. Adding a write path = find the action here; if it exists, reuse the
   exact string; if not, add it here **and** to `ACTION_TYPES` in the same PR, so a
   reviewer sees a *new* audit verb enter the vocabulary deliberately.
3. **What stops a synonym:** the Step-1b **enumeration test** (already required to
   assert every state write publishes intent) additionally asserts **every emitted
   `action_type` ∈ `ACTION_TYPES`**, and (client-side) the union type rejects an
   unlisted string at compile time. A synonym for an existing action fails one of the
   two. **This requirement goes into Step 1b's definition of done.**

## §7 · Findings (code, not just naming)

- **F1 — the generic save choke-point.** `save_program_state` (AppShellV3:1238,
  adamSync:142, usePrograms:461/681/712) is a single generic whole-blob write that
  many *semantic* actions funnel through. Action_type therefore **cannot** be defaulted
  at the DB call; it must be set by the flow mutator/handler upstream. Wiring intent
  only at the DB sites would collapse the whole vocabulary to `save_program_state`.
- **F2 — duplicate paths for one action.** `archive_program` (AppShellV3:1953 **and**
  adamSync:205); `system.complete_agent_run` (four run-agent sites + resume-agent);
  `system.fail_agent_run` (four sites). Same action, multiple call sites — exactly the
  shape that produces divergent names if left to wiring time. They get **one** name
  each here. Worth a separate look at whether the duplicate archive/complete/fail
  paths should be consolidated in code.
- **F3 — RESOLVED + ENUMERATED: `src/new/lib/*` hooks are LIVE.** The Step-1b topology
  check found all eight (`useGateReview`, `useMilestones`, `useBudgetTracking`,
  `useProgramNotes`, `usePhaseProgress`, `useClosure`, `useProgramSetup`,
  `useDecisionQueue`) imported by `AppShellV3` (the live v3 chrome). **They are live →
  wire, not delete.** Their names are now in the §1 table and each has its own §4 census
  row (the earlier lumped "UNCERTAIN" row is gone). This pass also caught a table the
  first census sweep missed — `adam_program_snapshots` (useProgramSnapshots, likewise
  live) — now a §4 section with `create_snapshot`. Naming + census only; intent wiring
  is Step-1b, behind the gate.
- **F6 — DONE (delete) + no singular write funnel.** `saveProgramToSupabase` (adamSync) —
  the presumed client funnel — had **zero callers**; **now deleted** (commit in the
  gate-independent backlog; confirmed dead by repo-wide + full-tree search before
  removal). The live client writes `adam_programs` from ~10 direct sites plus the seven
  hooks, with no convergence. So the enforcement model cannot "check intent at the
  funnel" — there is none. It is redesigned around *introducing* a `persistProgram`
  funnel; see `docs/aura/step1-audit-choke-point.md` "Step 1b — the enforcement model
  (REVISED)".
- **F4 — `writeQueue.ts` replays, it does not originate.** The offline write queue
  re-executes previously-queued writes; it must **carry the original action_type**, not
  stamp one of its own, or replayed events would all read as a queue-flush.
- **F5 — census caveat.** A 6-line-lookahead classifier produced one false positive
  (`run-agent:10516` is a `select`, not an update — an adjacent `.update` bled into the
  window). All write rows in §4 were verb-confirmed by reading the site. If a write
  path uses a non-literal table reference (none found today — every write is a
  double-quoted `.from("<table>")`), this census would miss it; the Step-1b trigger
  catches it regardless (completeness is the trigger's job, this doc's is the naming).

---

*Census taken 2026-08-07 against the committed tree; revisited same day to enumerate
the confirmed-live `src/new/lib/*` hooks per-site and add the `adam_program_snapshots`
table the first sweep missed. Re-take when a state-bearing write path is added — and
add its action_type here and to `ACTION_TYPES` first.*
