# Step 1 — Scratch project setup (dashboard, no CLI)

From zero to kit-ready for someone who has never used the Supabase dashboard for this.
**Estimated time: ~20 minutes** — most of it waiting for the project to provision. The
gate has been open partly because its size was never stated; this is the size.

The whole run needs **no CLI, no psql, no local database**. You paste SQL into a browser
and read the result table. There are two databases in play and the kit keeps them apart
on purpose — read the safety box before you touch production.

> ## ⚠️ TWO DATABASES — do not mix them
> - **PRODUCTION** — touched by **exactly one block**, and it is **read-only**:
>   `adam_program_events_shape.sql` (a couple of catalog SELECTs). Nothing else in the
>   kit goes near production.
> - **SCRATCH** — a throwaway project you create below. **Everything else** runs here. It
>   holds **no real data**: the bootstrap creates its own tiny schema and the cost harness
>   generates synthetic blobs. You delete it at the end.
>
> The kit is built so this is hard to get wrong: the production block is its own file and
> starts with a read-only banner; every scratch file names the scratch project in its
> header. If a block doesn't say "PRODUCTION (read-only)", it is a scratch block.

---

## 1. Create the throwaway project (~5 min, mostly provisioning)

1. Go to the Supabase dashboard → **New project**.
2. **Name it so nobody confuses it with production.** Use something like
   **`aura-step1-scratch-DELETEME`**. Put it in any org; a free-tier project is fine.
3. Set a database password (you won't need it for the editor — the editor authenticates
   you as the dashboard user). Pick any region.
4. Create, and wait for it to finish provisioning (the green "healthy" state).

Do **not** create a *branch* of production for this — a branch copies real content, and
the point of scratch is that it starts empty. A brand-new standalone project is correct.

## 2. Find the SQL editor

Left sidebar → **SQL Editor** → **New query**. You paste SQL into the big text area and
click **Run** (or Cmd/Ctrl-Enter). The result grid below shows the **last statement's**
result — which is why every kit block ends in a single `SELECT` with a PASS/FAIL column.

## 3. Run the kit, in order, in the SCRATCH project

Each step = open the named file, copy its whole contents, paste into a new query, Run,
read the result. Full expectations are in `step1-verify-runbook.md` (Part B). In brief:

1. `supabase/migrations/_verify/scratch_01_bootstrap.sql` → final row `bootstrap | PASS`.
2. `supabase/migrations/20260807_audit_events.sql` (the migration itself — paste the whole
   file) → then run the confirm one-liner from the runbook (audit_events + trigger exist,
   enforce=false).
3. `supabase/migrations/_verify/20260807_audit_events.verify.sql` → all rows PASS (check 7
   may be N/A on scratch).
4. `supabase/migrations/_verify/scratch_02_contract_checks.sql` → **Block A** all PASS;
   **Block B** (C4/C6) needs the `authenticated` role — if it returns BLOCKED, note it and
   run Block B over a direct connection or MCP (see `db-access-options.md`). Don't skip it.
5. `supabase/migrations/_verify/scratch_03_cost_measure.sql` → run 4.0, 4.1, 4.2, 4.3, 4.4
   in order; read the 4.4 summary.
6. `supabase/migrations/_verify/scratch_04_reversibility.sql` → R1–R5; then re-run the
   migration (step 2) and the commented **R6** block to confirm a clean count of 0.

## 4. Capture results

Fill `step1-verify-results-template.md` **as you go**, pasting each block's result grid.
It's built so one pass is enough — paste the actual output, not just a tick, so the gate
can be decided without a second round.

## 5. Delete the scratch project

Dashboard → project **Settings → General → Delete project**. Nothing synthetic needs to
linger. (Because it never held real data, deleting it loses nothing.)

---

## The ONE production block (separate, read-only)

`supabase/migrations/_verify/adam_program_events_shape.sql` is the only block you run
against a **real** environment (local, staging, production). It performs **no writes, no
DDL, not even a temp table** — pure catalog SELECTs. Run **BLOCK P1** in each environment's
SQL editor; if it reports PRESENT, also run **BLOCK P2** for the exact row count. Record
the shape + count per environment in the results template. That's the entire production
footprint of Step 1's verification.

**Structural guard against running the wrong block on the wrong database:** the production
file contains *only* P1/P2 and opens with a read-only banner; every other file names the
scratch project in its first lines and writes/DDLs freely. If you ever see a `create`,
`insert`, `update`, `drop`, or `alter` in the block in front of you, it is a **scratch**
block — it must not be in the production project's editor tab.
