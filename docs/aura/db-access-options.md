# Database access options — dashboard vs psql vs MCP

Every step from Step 1 onward ends in the same **apply-and-verify** cycle: change SQL,
run it against a database, read the result, decide. How you reach the database decides
whether that cycle is a manual paste-and-report round trip or something that runs inside
the loop. Three options, what each is good for, and a recommendation that differs for
Step 1 versus the steps after it.

## 1. Dashboard SQL editor
- **Setup:** none. Log into the Supabase dashboard, open SQL Editor, paste, Run.
- **How it runs:** shows the **last statement's** result set; the whole kit is packaged
  so every block ends in one `SELECT` with a PASS/FAIL column (no `RAISE NOTICE`).
- **Reaches:** everything a normal SQL session does, **as the dashboard's role**. That
  role is typically a superuser/owner, which **bypasses grants and RLS** — so the two
  role-sensitive checks (C4 grant-denial, C6 RLS read) can be meaningless here. The kit's
  Block B attempts `set role authenticated`; if the editor rejects it or you're on a
  BYPASSRLS role, those two checks need option 2 or 3.
- **Good for:** a **one-time** run. Zero setup, and it's enough for all of Step 1 except
  possibly C4/C6.
- **Poor for:** a repeated loop. Every iteration is manual: paste, Run, copy the grid,
  paste it back into a report. The round trip — not the SQL — is the cost.

## 2. Direct `psql` connection
- **Setup:** get the connection string from **Project Settings → Database → Connection
  string** (the direct connection, not only the pooler). Run `psql "<conn>"`.
- **Reaches:** the same SQL, and crucially lets you run **as a chosen role**. Connect (or
  `set role`) as a non-superuser `authenticated` and the grant/RLS checks (C4, C6) become
  real. This is the route that unblocks the two checks a hosted editor can't establish.
- **Good for:** completing C4/C6, and for anyone who already has `psql`.
- **Poor for:** the in-loop cycle — it's still a human at a terminal pasting results back,
  just with role control the editor lacks.

## 3. Local MCP Postgres connector
- **What it is:** an MCP server that exposes a Postgres connection to the agent as tools,
  so the **verification runs inside the loop** — the agent applies SQL and reads the
  result directly, no human paste-and-report between change and check. That is what makes
  it the better fit for steps 2–4, which are all apply-and-verify.
- **Setup (what would need configuring):** register a Postgres MCP server pointed at the
  **scratch** project's connection string, in the agent's MCP config. The **role in that
  connection string decides everything about grants/RLS** — point it at a non-superuser
  `authenticated`-capable role if you want C4/C6 to be meaningful; a superuser string
  will bypass them exactly as the dashboard does.
- **Reaches / does not reach — VERIFY against current docs, do not take this as asserted:**
  I can reason about the shape but cannot verify this specific connector's feature set from
  here. Before relying on it, confirm: (a) whether the connector allows **writes/DDL** or
  is **read-only** (some Postgres MCP servers are read-only by default — the kit needs
  writes on scratch, so a read-only connector would only cover the prod read-only block and
  SELECT-only checks); (b) whether it runs statements over a **pooler** (transaction-pooled
  connections can break session state like `set role` and temp tables — the kit avoids
  temp-table reliance, but `set role` for C4/C6 still needs a session-capable connection);
  (c) whether multi-statement scripts and dollar-quoted `DO $$…$$` blocks are supported as
  sent. Treat these as questions to check, not settled facts.
- **Good for:** steps 2–4 (and re-running Step 1) as a repeatable in-loop cycle.
- **Poor for:** first-time, one-off use where the setup cost isn't yet worth it — and it is
  **not** for production (point it at scratch only; the same read-only discipline applies).

## Recommendation

- **Step 1 (this gate): the dashboard SQL editor.** It's a one-time run; zero setup wins.
  Do the prod read-only block and all of scratch in the editor. For the two checks the
  editor can't establish (C4, C6), fall to a **direct `psql`** connection as a
  non-superuser — that's the minimal extra reach, and only for two checks.
- **Steps 2–4 (the repeating loop): the MCP Postgres connector**, pointed at a scratch
  project with a non-superuser role — **after** verifying the three capability questions
  above. The dashboard is fine once and poor as a permanent loop; the value of the MCP
  route is removing the manual round trip from every subsequent apply-and-verify, which is
  the expensive part of this whole arrangement.

Net: the database gate was never a CLI gate. Step 1 needs a browser and, for two checks, a
direct connection. The steps after it are worth wiring the MCP connector for.
