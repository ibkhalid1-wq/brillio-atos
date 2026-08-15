# ATOS Flow on Azure — environment setup and Supabase exit

Written 2026-08-13, alongside [HANDOFF.md](../../HANDOFF.md), which remains the
orientation document for the codebase itself. This one covers a single question: what
it takes to stand the app up on Azure with **Azure Database for PostgreSQL** instead
of Supabase.

Everything measured below was measured against this repo at `9eaa9ea`. Where a number
appears, it came from a command you can re-run; those commands are in §9 so you can
check the figures rather than trust them.

---

## 1 · Read this first: the size of the ask

**Supabase is not the database.** It is five products behind one SDK, and the app uses
four of them. Swapping the *database* is the easy quarter of the job; the SDK the code
is written against is the other three quarters.

| what Supabase provides | used here? | Azure equivalent | who has to do the work |
|---|---|---|---|
| **Postgres** | yes — 8 tables, 28 migrations | **Azure Database for PostgreSQL — Flexible Server** | mostly a restore; RLS carries over natively |
| **PostgREST** (`.from().select()`) | yes — **56 call sites** | *nothing equivalent* — needs an API tier | **the largest single piece** |
| **GoTrue auth** (`supabase.auth.*`) | yes — **16 call sites, 10 distinct methods** | **Microsoft Entra ID** (or Entra External ID for client users) | a real port, not a shim |
| **Realtime** (`postgres_changes`, presence) | yes — 2 subscriptions + presence | **Azure Web PubSub**, or drop to polling | small, but it is the collaboration feature |
| **Edge Functions** (Deno) | yes — **15 functions, 16,340 lines** | **Azure Functions** or **Container Apps** | mechanical but large; `run-agent` is 12,038 lines of it |
| **Storage** | yes — 1 private bucket, `flow-source-docs` | **Azure Blob Storage** | small |

**The honest summary:** there is no configuration change that moves this to Azure. The
only genuinely small path is *"Azure hosts everything except the data plane"* — see
§2, Option A — and if the requirement is specifically *no Supabase at all*, budget a
port measured in weeks, not days, and read §8 before committing to a date.

---

## 2 · Three options, with what each actually costs

### Option A — Azure for compute, Supabase stays for data
Static Web App / App Service on Azure; Supabase keeps Postgres, auth, realtime,
functions. **This is what you have today** (once the wrong-project problem in §3 is
fixed). Cost: a rebuild. If the driver is "run it in our tenant", this gets you most of
the way; if it is "no Supabase in the stack", it gets you none of it.

### Option B — Azure Postgres, Supabase auth + functions stay
Point the data plane at Azure Database for PostgreSQL, keep GoTrue and edge functions.
**Not recommended.** Supabase's auth and RLS are coupled to *its* Postgres (`auth.uid()`
is a function in that database); splitting them means reimplementing the RLS predicate
layer while still paying for Supabase. Worst of both.

### Option C — full exit to Azure
Everything in §1's right-hand column. This is the one this document specifies, because
it is the one that ends the dependency. **Phased plan in §6.**

---

## 3 · Before anything else: the current deployment is mis-pointed

The app at `brillio-aura-adgyfka4excfakhk.eastus-01.azurewebsites.net` is built against
Supabase project **`bbcfarunonctniexjhon`**, not the project everything else uses
(`vudqrrqpipnkxzxslbim`). `configure-ai-settings` returns **404** on the former and
**401** on the latter — which is exactly why an API key cannot be saved there.

Establish which of those two projects is authoritative before migrating anything. A
migration that copies the wrong project is worse than no migration.

**And the trap that produced it:** `VITE_*` variables are inlined by Vite at **build**
time. Setting them in App Service → Configuration does nothing to an already-built
bundle. They must be present in the process that runs `npm run build`.

Verify any deployment from outside, without logging in:

```bash
curl -s https://<host>/ | grep -oE '/assets/AppShellV3-[a-z0-9]+\.js'
curl -s https://<host>/assets/AppShellV3-<hash>.js | grep -oE 'https://[a-z0-9]+\.supabase\.co' | sort -u
```

The host it prints is the backend that build actually talks to.

---

## 4 · Target architecture on Azure

```
Browser ──► Azure Static Web Apps            the Vite bundle (VITE_* inlined at build)
              │
              ├─► Azure Container Apps        API tier — REPLACES PostgREST + edge functions
              │     ├─ /api/*                 CRUD over the 8 tables, RLS enforced in SQL
              │     └─ /functions/*           the 15 ported functions
              │
              ├─► Microsoft Entra ID          sign-in, tokens (replaces supabase.auth)
              ├─► Azure Web PubSub            change notifications (replaces Realtime)
              └─► Azure Blob Storage          flow-source-docs (private container)

Azure Container Apps ──► Azure Database for PostgreSQL — Flexible Server
                          8 tables · 28 migrations · 18 files of RLS policy
                     ──► Azure Key Vault      ANTHROPIC_API_KEY, OPENAI_API_KEY, DB creds
```

**Why Container Apps rather than Azure Functions for the API tier:** the edge functions
are Deno and import dependencies by URL (`https://esm.sh/...`). Container Apps runs the
Deno image as-is, so the port is "change the Supabase client calls and the HTTP shim",
not "rewrite 16,340 lines for a different runtime". Azure Functions would mean the
latter. If the team prefers Node, `run-agent` alone (12,038 lines) is the reason to
cost that separately.

---

## 5 · Provisioning — the concrete steps

Set these once and reuse:

```bash
RG=rg-atos-flow
LOC=eastus
PG=pg-atos-flow          # must be globally unique
ACR=acratosflow          # must be globally unique
```

### 5.1 Resource group and Postgres

```bash
az group create -n $RG -l $LOC
```

```bash
az postgres flexible-server create -g $RG -n $PG -l $LOC --version 16 --tier Burstable --sku-name Standard_B2s --storage-size 64 --high-availability Disabled --public-access None
```

Then, in order:

1. **Private networking.** `--public-access None` above; add a private endpoint or VNet
   integration for the Container Apps environment. Do not open it to the internet —
   Supabase's RLS was doing more security work than it looks like, and a directly
   reachable Postgres with no PostgREST in front is a different risk profile.
2. **Extensions.** `azure.extensions` must allow `pgcrypto` and `uuid-ossp` (the
   migrations use `gen_random_uuid()`). `pg_cron` is referenced by two migrations but
   guarded by `if exists (select 1 from pg_extension …)` — it is optional; the schedule
   in `001_agent_infrastructure.sql` is commented out.
3. **Database.** `az postgres flexible-server db create -g $RG -s $PG -d atos`.

### 5.2 Schema

The 28 files in `supabase/migrations/` are plain SQL and apply in filename order. Two
things do **not** carry over and must be resolved before the first apply:

- **`auth.uid()`** appears throughout the RLS policies (18 files contain policies). That
  function belongs to Supabase's `auth` schema. On Azure you need an equivalent —
  typically `current_setting('app.user_id', true)::uuid`, with the API tier setting
  `SET LOCAL app.user_id` per transaction from the validated Entra token. **This is the
  single most important decision in the migration**: every policy depends on it, and
  getting it wrong fails open, not closed.
- **`auth.users`** — any foreign key to it needs a local `users` table keyed by the
  Entra object id.

Apply with `psql -f` in filename order, then verify: the 8 tables in §9 exist and
`select count(*) from pg_policies where schemaname='public'` is non-zero.

### 5.3 Data

`pg_dump` from Supabase (`--no-owner --no-acl`, schema `public` only), restore into
Azure. The entire application state is JSONB in `adam_programs.data`, so the dump is
small and the restore is fast — but see §8 on the one-blob shape.

### 5.4 Secrets

Key Vault, referenced by the Container App: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
(optional — transcription 501s without it, by design), the Postgres connection string,
and the Web PubSub key. **Do not carry the Supabase service-role key across** — it is
being rotated and has no meaning on Azure.

### 5.5 Front end

Azure Static Web Apps, with the build receiving:

```
VITE_SUPABASE_URL=…            → replace with VITE_API_BASE_URL once §6.2 lands
VITE_SUPABASE_PUBLISHABLE_KEY=…  → replaced by the Entra client id
VITE_SUPABASE_PROJECT_ID=…
```

Note the variable names: `client.ts` reads `VITE_SUPABASE_PUBLISHABLE_KEY`, **not**
`VITE_SUPABASE_ANON_KEY`. Both README and HANDOFF said the wrong one until 2026-08-13.

---

## 6 · The port, phased so each phase ships

Each phase leaves a working app. Do not start the next until `npm run validate` and
`npm run check:edge` are green and the app runs.

**6.1 — Storage (smallest, proves the pattern).** One private bucket,
`flow-source-docs`, used by `flow-portal` and `flow-extract`; the only operations are
create-bucket, upload, and a 300-second signed URL. Blob Storage does all three with
SAS. ~2 call sites.

**6.2 — The data plane.** Replace 56 `.from()` calls with an API tier. The good news is
that they are already funnelled: **`persistFlowMutation` in `AppShellV3.tsx` is the
single write chokepoint** for programme state, and `getProgramState` / `wrapProgramState`
normalise the two historical blob shapes. Keep that shape — an API that mirrors
PostgREST's `select/insert/update/eq` semantics for these 8 tables is far less work than
redesigning, and lets the client change be mechanical.

**6.3 — Auth.** 16 call sites, 10 methods: `signInWithPassword`, `signInWithOtp`,
`signUp`, `signOut`, `getUser`, `getSession`, `onAuthStateChange`, `updateUser`,
`resetPasswordForEmail`, plus `auth.uid()` in SQL. Entra ID covers all of them, but
`signInWithOtp` (magic link) and `resetPasswordForEmail` are flows you configure rather
than call. **Do this after 6.2** — the RLS predicate decision from §5.2 has to be real
before auth can be enforced end to end.

**6.4 — Realtime.** Two `postgres_changes` subscriptions (`adam_programs` UPDATE in
`AppShellV3.tsx`, `adam_agent_runs` in `useAgentRun.ts`) and one presence channel. Web
PubSub with a Postgres `LISTEN/NOTIFY` trigger is the faithful port. **Polling is a
legitimate interim** — both subscriptions exist to refresh a view, and neither is
correctness-critical.

**6.5 — The functions.** 15 of them, 16,340 lines, of which `run-agent` is 12,038.
Port the small ones first to establish the pattern (`flow-extract` 91, `save-document`
108, `get-agent-trace` 121). `flow-portal` (1,160) is the public token-gated face and
carries the stakeholder write path — port it with `npm run check:edge` extended to
cover it, and re-run `writePathTransport.test.ts`, which is transport-shaped and will
still hold.

**`run-agent` deserves its own decision.** It does not currently type-check —
**273 errors** (HANDOFF §10) — so a port is also the first time anyone has read it with
a compiler on. Budget it separately from the other 14 combined.

---

## 7 · What to verify at each step

The repo already carries the tools; use them rather than inventing new ones.

```bash
npm run validate      # typecheck + lint + build + 2740 tests
npm run check:edge    # Deno type-check of the public-facing functions
```

CI runs both on every push (`.github/workflows/ci.yml`) and deliberately runs
**without** a `.env.local` — which is how it catches the class of bug where an
unconfigured client is `null`. Keep that property: it is the only thing standing
between you and a deployment that works on every laptop and fails in every
environment.

Two specific post-migration checks:

- **`edgeLockstep.test.ts`** parses the client AND the edge source to prove the
  fingerprint algorithm matches. It will fail loudly if a port changes one side. That
  is a feature.
- **The stakeholder write path** (`stakeholderWritePath.test.ts`,
  `writePathTransport.test.ts`) is the newest and least-exercised code. Re-run the live
  test in the worklog after the port: a submission should still move Discover's owned
  count down by one.

---

## 8 · Risks worth naming before a date is committed

1. **`auth.uid()` in RLS.** §5.2. Every policy depends on the replacement, and a wrong
   implementation fails *open*. Have someone other than the implementer review it.
2. **One blob per programme.** `adam_programs.data` holds everything. It is why the
   dump is small and the restore is easy — and why a partial write corrupts a whole
   programme. The IndexedDB snapshot ring (10 per programme) only captures writes
   through the app's own path; direct SQL bypasses it. **Take a `pg_dump` before every
   migration step**, not just the first.
3. **`run-agent`'s 273 type errors.** Unknown-unknowns live there. It is 74% of the
   edge code by line.
4. **~50 Supabase call sites are unguarded against a null client** (HANDOFF §12). During
   a phased port the client is *sometimes* configured, which is precisely the state that
   makes those crash. Guard as you go.
5. **Realtime is a collaboration feature.** If it is dropped to polling "temporarily",
   say so in the product, or two operators will silently overwrite each other.
6. **Cost shape changes.** Supabase bundles; Azure itemises. Flexible Server + Container
   Apps + Web PubSub + Blob + Key Vault is five meters where there was one.

---

## 9 · The measurements, so you can re-run them

```bash
grep -rhoE '\.from\("[a-z_]+"\)' src | sort | uniq -c | sort -rn   # 56 across 8 tables
grep -rhoE 'supabase\.auth\.' src | wc -l                          # 16
grep -rhoE 'supabase\.functions\.invoke' src | wc -l               # 16
grep -rn 'postgres_changes' src | grep -v __tests__                # 2 subscriptions
find supabase/functions -name index.ts | xargs wc -l | tail -1     # 16,340
ls supabase/migrations | wc -l                                     # 28
grep -rl 'create policy' supabase/migrations | wc -l               # 18
```

**Tables in use from the client:** `adam_programs` (34), `adam_agent_runs` (8),
`adam_program_snapshots` (5), `adam_phase_agent_states` (3), `adam_portfolio` (2),
`adam_copilot_threads` (2), `adam_program_members` (1), `adam_audit_log` (1). The
migrations create more than these eight; the extras are written by edge functions, so
inventory them from the SQL before trimming anything.

---

## 10 · What I could not verify

I have no access to your Azure tenant, so **nothing in §5 has been executed** — the
commands are written from the resource shapes, not from a run. The figures in §1, §6
and §9 are measured from the repo and are re-runnable. The `bbcfarunonctniexjhon`
finding in §3 is measured from the deployed bundle.

**Unanswered, and it needs an answer before anyone starts:** whether
`bbcfarunonctniexjhon` is a stale project or a second live environment. If a second
team is using it, this document is describing the migration of the wrong database.
