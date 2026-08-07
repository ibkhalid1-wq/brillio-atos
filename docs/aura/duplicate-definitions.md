# Aura — The Duplicate-Definition Audit

The same defect has surfaced five times, each found by accident while doing something
else: four audit sinks with no authority; one table defined twice with incompatible
schemas; two normalizations of the claim hash; duplicate edge run-status helpers; two
artifact-dependency maps. Each is **one concept defined in more than one place**, free to
drift. This is the deliberate sweep for the rest.

**What matters is SILENT drift.** A loud mismatch — a compile error, a failing test, a
runtime 400 — announces itself and gets fixed. A silent one (two copies quietly computing
different answers, a cap truncating on one side only) ships wrong behaviour with nothing to
catch it. The findings are ranked by that, not by severity of the concept.

**Method.** Four lenses swept in parallel — table/type shapes across migrations; constants
duplicated as literals; enum-like string sets; and validation/ordering logic. Every finding
below marked **[verified]** I confirmed by reading both definitions; **[reported]** means a
sweep surfaced it and it's plausible but I did not independently re-read both sides. Nothing
here is fixed — this is the map, per the task.

**Not fixed. Nothing in this file changes code.**

---

## Tier 1 — SILENT drift, UNMANAGED (fix these first)

Two copies, no test between them; when they diverge, nothing complains.

### S1 · `flowAreas` core — area inference copied client ↔ edge **[verified]**
- **Concept:** deterministic assignment of a person / workflow to a business area from
  keyword and stop-token tables (`AREA_KEYWORDS`, stop tokens, `stakeholderPrimaryArea`).
- **Defined in:** `src/v3/components/flow/flowAreas.ts` (client, ~25 KB) **and**
  `supabase/functions/_shared/flowAreas.ts` (edge, ~8 KB — the copied subset the generator
  needs). The client does **not** import the edge copy; they are two files.
- **Agree today?** Yes. The edge file carries the honest warning three times: *"MUST stay in
  lockstep"* / *"Keep in lockstep"* (lines 4, 23, 85).
- **Drift = SILENT.** A keyword or stop-token added on one side only tags the same workflow
  to a different area on the client vs the edge. The Show demo and Experience Design then
  split by the wrong stakeholder lane, invisibly — no error, wrong grouping.
- **Guard:** none. The area tests that exist (`areaVocabulary*.test.ts`, `atlasAreaChecklist`)
  test methodology vocabulary, **not** client↔edge `flowAreas` parity. The "lockstep" comment
  is unenforced.

### S2 · The `200` attestation-retention cap — 15 literal sites **[verified]**
- **Concept:** keep only the last **200** flow attestations per program (`…log….slice(-200)`).
- **Defined in:** 13 client sites (e.g. `flowGovernance.ts:117`, `flowStakeholders.ts:1099,
  :1223`, plus `flowPortal/flowApprovals/flowShip/flowDecisions/useGateReview` …) **and** 2
  edge sites (`flow-portal/index.ts:953`, `run-agent/index.ts:7890`). All bare `200`
  literals; no shared constant. *(The `.slice(0,200)` string-truncation sites are a different
  concept and excluded.)*
- **Agree today?** Yes — every site is `200`.
- **Drift = SILENT.** Change the cap on one side (say the edge trims to 150 for cost) and the
  two sides retain different windows of the audit trail. The trail silently gains gaps or
  disagrees between the writer that produced it and the one that trims it. No test asserts the
  number matches.
- **Guard:** none. `edgeLockstep.test.ts` checks vocabulary and studio contracts, not this.

### S3 · `AGENT_ID_ALIASES` — planner-synonym → canonical-agent map, copied client ↔ edge **[verified]**
- **Concept:** map a planner-emitted synonym artifact id to the canonical producing agent.
- **Defined in:** `src/v3/lib/agentMeta.ts:122` (`export const AGENT_ID_ALIASES`) **and**
  `supabase/functions/run-agent/index.ts:146` (`const AGENT_ID_ALIASES`, applied at `:9859`).
- **Agree today?** Yes.
- **Drift = SILENT.** An alias added on the client resolves a Generate click to agent X; the
  edge, lacking the alias, dispatches the raw id to a different (or no) handler. The artifact
  that lands is not the one the tile promised, with no error on the happy path.
- **Guard:** none found (`dynamicSchema.test.ts` does not assert cross-side parity).

### S4 · The `200`-cousin: `1200` copilot-token & `20000` answer-char caps, client ↔ edge **[verified: 20000; reported: 1200]**
- **Concept:** two more client/edge shared caps — copilot response budget `1200` tokens
  (`src/lib/adamCopilot.ts` ↔ `copilot-chat/index.ts`, `run-agent/index.ts`) and the portal
  answer length `20_000` chars (`FlowRespond.tsx:668,:707` `maxLength={20000}` ↔
  `flow-portal/index.ts:28` `MAX_ANSWER_CHARS = 20_000`, enforced at `:811+`).
- **Drift = SILENT.** Raise the client `maxLength` above the edge cap and the user types text
  the server silently truncates on submit — data loss, no notice. Lower the copilot budget on
  one side and advice truncates mid-sentence looking complete.
- **Guard:** none. Same shape as S2 — a shared numeric contract with no shared source.

---

## Tier 2 — SILENT drift, UNMANAGED, but narrower blast radius

### S5 · `FORMAL_ARTIFACT_FIELD_KEYS` (client) ↔ `FORMAL_ARTIFACT_AGENTS.fieldKey` (edge) **[verified]**
- **Concept:** the kebab-artifact-id → camelCase-storage-fieldKey crosswalk (26 entries), plus
  the phase-home twin (`FORMAL_ARTIFACT_PHASES` ↔ `FORMAL_ARTIFACT_AGENTS.phase`).
- **Defined in:** `src/v3/lib/formalArtifacts.ts:13` & `:47` **and**
  `supabase/functions/run-agent/index.ts:~933` (inside `FORMAL_ARTIFACT_AGENTS`). Both files
  carry a *"Keep … in sync"* comment; **no test asserts key-set equality.**
- **Drift = SILENT (mostly).** An artifact whose fieldKey diverges lands in a blob field the
  client never reads (data persists, invisible). **New dependency:** the task-C lockstep test
  (`generationPrereqLockstep.test.ts`) now bridges client↔edge artifact ids *through this
  crosswalk* — if a key drifts, that test maps the id to `undefined` and silently skips it,
  quietly weakening the very guard added in task C. → flagged under Steps 1–4.
- **Guard:** partial/indirect (runtime dispatch rejects an unknown agent id — loud; but a
  wrong-but-known fieldKey is silent).

### S6 · Agent registry: edge `VALID_AGENT_IDS` vs client `AGENT_META`; `RETIRED_AGENT_IDS`, `SUPPORT_ARTIFACT_IDS` **[reported]**
- **Concept:** the set of dispatchable agent ids (edge `VALID_AGENT_IDS`, run-agent:61) vs the
  client's authoritative `AGENT_META` (agentMeta.ts:13); plus `RETIRED_AGENT_IDS`,
  `SUPPORT_ARTIFACT_IDS` (client) enforced only implicitly on the edge/UI.
- **Drift:** adding an agent to `AGENT_META` but not `VALID_AGENT_IDS` → Generate → edge 400
  (**loud**). Retiring one on the client but not the edge, or vice-versa → a dead Generate or
  an untracked artifact (**silent**). Mixed loud/silent; comments say "keep in lockstep", no
  test.

---

## Tier 3 — SILENT/ambiguous, DB-schema (also Steps 1–4; see below)

### S7 · `adam_program_events` — one table, three incompatible schemas + a live writer **[verified]**
- **Concept:** the program event journal.
- **Defined in, incompatibly:**
  - `migrations/20260613093000_event_access_foundation.sql` — `id uuid`, `event_type`,
    `payload`, `actor_id/name`, `phase_id`, `agent_id`.
  - `migrations/20260714_event_journal.sql` — `id bigint`, `ts`, `actor`, `kind`, `detail`
    (a different design; delivered, never applied).
  - `migrations/20260807_audit_events.sql` — **retires** `adam_program_events` (renames it to
    `…_retired_20260807`) and replaces the concept with the trigger-written `audit_events`.
- **Live writer:** `src/v3/lib/flowEvents.ts:28` `logFlowEvent` inserts
  `{program_id, kind, actor, detail}` (the `20260714` shape) into `adam_program_events`, and
  is imported by `src/new/lib/usePrograms.ts` — i.e. a **live client write path.**
- **Drift = SILENT / breaking.** The writer's columns match the `20260714` design, not the
  `20260613093000` one that may actually be live — so the insert may already fail silently
  against the deployed schema; and it **will** break when `20260807` renames the table away.
  *(I cannot query the live DB to see which schema is deployed — that residue needs a DB check.)*

### S8 · `program_id` foreign-key type: `text` referencing a `uuid` PK **[verified]**
- **Concept:** the program foreign key.
- **Mismatch:** `adam_programs.id` is `uuid` (`20260610_adam_backend.sql:2`), but
  `adam_program_members.program_id` (`20260616_program_access_control.sql:18`) and
  `adam_program_snapshots.program_id` (`20260619_program_snapshots.sql:17`) are declared
  `text ... references adam_programs(id)`.
- **Drift/effect = SILENT.** Postgres coerces across the FK, so it "works" — but the type
  contract is inconsistent, RLS helpers take `text` and join on `uuid`, and a `text`
  program_id that fails to parse as a uuid would be caught only at insert. Relevant wherever
  `program_id` provenance is resolved — including the audit trigger. → Steps 1–4.

---

## Tier 4 — LOUD drift (a compiler / test / runtime error catches it; lower priority)

- **L1 · `audit_events` absent from generated `src/integrations/supabase/types.ts`** — until
  the `20260807` migration applies and types are regenerated, any code using the type fails to
  compile. **Loud, and a sequencing note for Step 1** (regenerate types right after apply).
  **[verified: table not in types.ts]**
- **L2 · `FORMAL_ARTIFACT_PHASES` vs `FORMAL_ARTIFACT_AGENTS.phase`** — a phase mismatch makes
  the edge inject a phase artifact from the wrong bucket → runtime failure. **Loud.** **[reported]**
- **L3 · Hardcoded movement sets** `PLAN_MOVEMENTS` / `AUTO_GATE_MOVEMENTS` in `AppShellV3`
  (inline `new Set(["frame","listen","envision","show"])` ×2) vs the six-item
  `FLOW_MOVEMENT_SEQUENCE`. **Likely intentional** (ship/evolve are excluded from auto-gate by
  design), so this is a *readability/consolidation* nit, not a drift bug — listed so it isn't
  re-found as one. **[reported]**

---

## Already MANAGED (a test guards drift — listed so they're not re-swept)

These are duplicated by necessity (client ↔ Deno edge cannot share a runtime module) but a
lockstep test asserts parity, so drift is loud:

| Concept | Sides | Guard |
|---|---|---|
| Claim-line normalization + hash | one module, `claimsGuard.ts` | `claimsRegister.test.ts` |
| Industry options / segment steering | methodology ↔ run-agent | `edgeLockstep.test.ts` |
| Staleness fingerprint (djb2) | flowShellData ↔ run-agent | `edgeLockstep.test.ts` |
| Studio docOrder ↔ edge JSON contract | studios.tsx ↔ run-agent | `edgeLockstep.test.ts` |
| llmReplay canonicalize / fingerprint | llmReplay.ts ↔ _shared/llmReplay | `llmReplay.test.ts` |
| jsonRepair / programTexts | client imports `_shared/*` | shared module + tests |
| `GENERATION_PREREQS` ↔ `UPSTREAM_ARTIFACT_DEPS` | lineModel ↔ run-agent | `generationPrereqLockstep.test.ts` *(added task C)* |

**Deliberate future duplicate (planned, not a defect):** the action_type / affected_kind
vocabulary (`docs/aura/action-type-vocabulary.md`) will be mirrored by an exported
`ACTION_TYPES` const in Step 1b; §6 of that doc already specifies the enumeration test that
keeps doc and code in lockstep. Noted so it is built *with* its guard, not without.

**Agent over-reach corrected:** edge-only sets (`LARGE_OUTPUT_AGENTS`, `COMPACT_OUTPUT_AGENTS`,
`CONVERSATION_RECORD_AGENTS`, `INBOX_CAP`) and client-only caps (`APPROVAL_CAP`, `BRIEF_CAP`)
have a **single definition** — they are not duplicates and cannot drift against a twin. Type
representation gaps (`confidence float` vs `number`, `trust_threshold numeric` vs `number`)
are IEEE-754-compatible and low-risk. These are excluded from the tiers above.

---

## Flagged for Steps 1–4 specifically

The task asks which of these touch the audit-spine steps. Fix these before building on top:

- **S7 (`adam_program_events` × live `logFlowEvent` writer) — Step 1, HIGH.** The Step-1
  migration retires the table; a live client writer targets it with a third-schema shape. Left
  as-is, applying Step 1 breaks that write (or it is already silently failing). Decide the
  writer's fate (retire it, or repoint it) **as part of** applying the migration.
- **S8 (`program_id` text→uuid FK) — Step 1, MEDIUM.** The audit trigger records `program_id`;
  an inconsistent FK type is exactly the kind of thing that makes provenance resolution
  version-fragile. Confirm the trigger reads a consistent type.
- **L1 (`audit_events` not in `types.ts`) — Step 1, sequencing.** Regenerate Supabase types in
  the same change that applies the migration, or client code that reads the audit table won't
  compile.
- **S5 (`FORMAL_ARTIFACT_FIELD_KEYS` crosswalk) — Step C dependency, MEDIUM.** The task-C
  lockstep test bridges ids through this crosswalk; if it drifts, that test silently skips the
  unmapped id. A direct key-set-parity test for the crosswalk would harden both.
- **Vocabulary ↔ `ACTION_TYPES` (Step 1b).** Build the const with its enumeration test, per
  §6 — a doc/code pair is a duplicate the moment the const exists.

---

*Swept 2026-08-07. Four parallel lenses; load-bearing findings re-read and marked [verified],
the rest [reported]. No code changed. Recommended remedy for the Tier-1 items is the same
each time — one shared definition, or (across the Deno boundary where sharing is impossible) a
lockstep test in the `edgeLockstep`/`generationPrereqLockstep` idiom — but remedy is out of
scope here.*
