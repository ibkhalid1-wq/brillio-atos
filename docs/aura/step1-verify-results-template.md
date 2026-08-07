# Aura Step 1 — Verification Results

Fill every field. Numbers, not prose. Return this whole file.

Run by: __________   Date: __________   Step 1 migration commit: `ba0d961`

---

## Gate item 1 — Step 1 applies cleanly on the throwaway project
- Bootstrap (B2) ran without error: ☐ yes ☐ no — error if any: ______________________
- Migration apply (B3) ran without error: ☐ yes ☐ no — error if any: __________________
- Functional verify (B4) — all ` PASS`? ☐ yes ☐ no — list any FAIL: _________________

## Gate item 2 — Contract checks (B5)
| Check | Result | Notes |
|---|---|---|
| C1 client missing-intent recorded, not raised | ☐ PASS ☐ FAIL | |
| C2 service missing-intent raises | ☐ PASS ☐ FAIL | |
| C3 **SECURITY DEFINER intent reaches trigger** | ☐ PASS ☐ FAIL | RPC design depends on this |
| C4a direct INSERT denied | ☐ PASS ☐ FAIL | |
| C4b direct UPDATE denied | ☐ PASS ☐ FAIL | |
| C4c direct DELETE denied | ☐ PASS ☐ FAIL | |
| C5 trigger writes under app-role caller | ☐ PASS ☐ FAIL | |
| C5b actor from JWT not client intent | ☐ PASS ☐ FAIL | |
| C5c spoofed actor recorded (not dropped) | ☐ PASS ☐ FAIL | `actor_intent_mismatch` |
| C6 owner-only read | ☐ PASS ☐ FAIL | |

Trigger correction (actor JWT-wins + `actor_intent_mismatch`): APPLIED in migration. Any concern? __________

## Gate item 3 — `adam_program_events` shape per environment (A1, prod read-only)
| Env | PRESENT/ABSENT | Shape (613093000 / 20260714 / n-a) | row_count |
|---|---|---|---|
| local | | | |
| staging | | | |
| production | | | |

Any env with row_count > 0? ☐ no ☐ yes → confirm rows will NOT be migrated: ☐ confirmed

## Gate item 4 — Trigger cost (B6)
| Blob size | actual_size | full ms/write | baseline ms/write | nofp ms/write | trigger cost (full−baseline) | md5 cost (full−nofp) |
|---|---|---|---|---|---|---|
| ~1 MB | | | | | | |
| ~5 MB | | | | | | |
| ~10 MB | | | | | | |

Is `full` at 10 MB acceptable per write? ☐ yes ☐ no → if no, adopt fingerprint-drop fallback: ☐ yes

## Reversibility (B7)
- R1 rows before rollback: ☐ PASS ☐ FAIL
- R2–R4 rollback drops cleanly: ☐ PASS ☐ FAIL
- Re-apply succeeded, final count = 0: ☐ yes ☐ no

## Anything the kit did not ask about but you observed
(unexpected errors, warnings, timings, behaviour — write freely)
______________________________________________________________________
______________________________________________________________________

---
**Gate verdict:** ☐ all four items answered, Step 1b may begin  ☐ blocked (reason): __________
