# Aura Step 1 — Verification Results

Fill every field and return this whole file. The round trip is the expensive part, not
the SQL — so paste the **actual result-set output** of each block (not just a tick), and
note anything unexpected inline. With that, the gate can be decided without a second round.

Run by: __________   Date: __________   Step 1 migration commit: `ba0d961`
How run (circle one): dashboard SQL editor · direct psql · MCP connector · mixed (note per block)

---

## Gate item 3 — `adam_program_events` shape per environment (Part A, PRODUCTION read-only)

Run BLOCK P1 (and P2 if PRESENT) per env. Paste the P1 row, and P2's row_count if run.

| Env | presence | shape (613093000 / 20260714 / n-a) | row_count (P2) |
|---|---|---|---|
| local | | | |
| staging | | | |
| production | | | |

Any env with row_count > 0? ☐ no ☐ yes → confirm those rows will NOT be migrated into `audit_events`: ☐ confirmed
Unexpected (extra columns, an unrecognised shape, an error)? ______________________________

---

## Gate item 1 — Step 1 applies cleanly on the throwaway project (Part B1–B3)

- **B1 bootstrap** — final row: `bootstrap | ____` (expected PASS). Error if any: __________________
- **B2 apply migration** — confirm one-liner output: `audit_events=____ trigger_fn=____ enforce=____`
  (expected: both non-null, enforce=false). Error if any: __________________
- **B3 functional verify** — paste the result set (expected every row PASS; check 7 may be N/A):

  | check_name | status | reason (paste) |
  |---|---|---|
  | 1 completeness — no-intent write recorded | | |
  | 2 rich event — intent honoured | | |
  | 3 changed_keys — floor, no deep diff | | |
  | 4 fingerprints — before <> after | | |
  | 5 enforce raises on service no-intent | | |
  | 7 dormant table retired | | |

---

## Gate item 2 — Contract checks (Part B4)

**Block A (editor-safe).** Paste the result set:

| check_name | status | reason (paste) |
|---|---|---|
| C1 client missing-intent recorded not raised | | |
| C2 service missing-intent raises | | |
| C3 **SECURITY DEFINER intent reaches trigger** | | (RPC design depends on this) |
| C5 trigger writes under client caller | | |
| C5b actor from JWT not client intent | | |
| C5c spoofed actor recorded not dropped | | |
| C7a intent_missing => partial NULL | | |
| C7b asserted partial=false recorded | | |
| C7c NULL distinct from false | | |

**Block B (needs the `authenticated` role).** How run: ☐ editor accepted `set role` ☐ direct psql ☐ MCP ☐ **returned BLOCKED**
If BLOCKED, say so and re-run over a direct connection before deciding the gate. Paste:

| check_name | status | reason (paste) |
|---|---|---|
| C4a direct INSERT denied | | |
| C4b direct UPDATE denied | | |
| C4c direct DELETE denied | | |
| C6 owner-only RLS read | | (mine>=1, theirs=0) |

---

## Gate item 4 — Trigger cost (Part B5)

Paste the **4.4 summary** row per size (tune the `_gen_blob` ints until actual_size ≈ target):

| size | actual_size | full_ms | baseline_ms | nofp_ms | trigger_cost_ms (full−baseline) | md5_cost_ms (full−nofp) |
|---|---|---|---|---|---|---|
| ~1 MB | | | | | | |
| ~5 MB | | | | | | |
| ~10 MB | | | | | | |

Is `full` at 10 MB acceptable per write? ☐ yes ☐ no → if no, adopt the fingerprint-drop fallback (keep changed_keys): ☐ yes
Unexpected (timeout, a size that wouldn't calibrate, wildly variable ms)? ______________________________

---

## Reversibility (Part B6)

- R1 rows before rollback: status `____` (paste reason: ____ rows)
- R2–R4 rollback drops cleanly: R2 `____` R3 `____` R4 `____`
- R5 name restored: `____` (N/A on scratch is expected)
- Re-applied migration, then R6 → `audit_events` exists and count = 0: ☐ yes ☐ no — paste R6 row: ____________

---

## Anything the kit did not ask about but you observed
(unexpected errors, warnings, timings, behaviour — write freely; this is where a second
round trip gets avoided)
______________________________________________________________________
______________________________________________________________________

---
**Gate verdict:** ☐ all four items answered, Step 1b may begin  ☐ blocked (reason): __________
If any check returned BLOCKED and was not re-run over a direct connection, the gate is **not** yet decided.
