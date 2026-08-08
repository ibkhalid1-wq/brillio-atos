// Apply + verify Step 1 (audit foundation) against DATABASE_URL. Bare-Postgres:
// installs the auth shim the kit documents, then bootstrap → migration → verify kit.
import { readFileSync } from "node:fs";
import pg from "pg";
const URL = process.env.DATABASE_URL;
if (!URL) { console.error("no DATABASE_URL"); process.exit(1); }
const M = "supabase/migrations/";
const sql = (p) => readFileSync(M + p, "utf8");
const SHIM = `
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
grant usage on schema public to authenticated, anon, service_role;`;

const c = new pg.Client({ connectionString: URL });
await c.connect();
const run = async (label, text) => { try { await c.query(text); console.log(`  applied: ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${e.message}`); throw e; } };
const table = async (label, name) => {
  const { rows } = await c.query(`select * from ${name} order by seq`);
  console.log(`\n== ${label} ==`);
  for (const r of rows) console.log(`  ${r.status ?? ""}  ${r.check_name ?? r.metric ?? ""}  ${r.reason ?? r.value ?? ""}`.trim());
  return rows;
};

console.log("PHASE 1 — apply Step 1 to", URL.replace(/:[^:@/]+@/, ":***@"));
await run("auth shim (bare-postgres)", SHIM);
await run("scratch_01_bootstrap", sql("_verify/scratch_01_bootstrap.sql"));
await run("20260807_audit_events (migration)", sql("20260807_audit_events.sql"));

// functional verify (checks 1-5,7)
await run("functional verify", sql("_verify/20260807_audit_events.verify.sql"));
const fv = await table("Functional verify (1-5,7)", "_kit_verify");
// contract checks — Block A (editor-safe) + Block B (needs authenticated role; we have it)
await run("contract checks (A+B)", sql("_verify/scratch_02_contract_checks.sql"));
const ca = await table("Contract Block A (C1,C2,C3,C5,C7)", "_kit_contract");
const cb = await table("Contract Block B (C4,C6 — role/RLS)", "_kit_direct");
// reversibility
await run("reversibility", sql("_verify/scratch_04_reversibility.sql"));
const rv = await table("Reversibility (R1-R5)", "_kit_rev");
// re-apply proves idempotency
await run("re-apply migration (idempotency)", sql("20260807_audit_events.sql"));
const { rows: cnt } = await c.query("select count(*)::int n from public.audit_events");
console.log(`\nR6 re-apply: audit_events exists, count = ${cnt[0].n} (expect 0 fresh)`);

const all = [...fv, ...ca, ...cb, ...rv];
const fails = all.filter((r) => String(r.status).toUpperCase().startsWith("FAIL") || String(r.status).toUpperCase()==="BLOCKED");
console.log(`\n=== SUMMARY: ${all.length} checks, ${fails.length} FAIL/BLOCKED ===`);
for (const f of fails) console.log("  FAIL:", f.check_name, "|", f.reason);
await c.end();
process.exit(fails.length ? 2 : 0);
