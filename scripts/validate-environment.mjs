#!/usr/bin/env node
/**
 * validate-environment — does this environment actually work?
 *
 * Written for the Azure stand-up (docs/aura/azure-environment-setup.md), but it is
 * backend-agnostic on purpose: point it at Supabase or at Azure and it asks the same
 * questions. It is the thing to run after provisioning and again after every phase of
 * the port, because "the app loads" is not the same as "the app can do anything".
 *
 * It only reports what it actually observed. A check it could not run says SKIP and
 * why — never PASS. A green run here is meant to be worth something.
 *
 *   node scripts/validate-environment.mjs
 *   node scripts/validate-environment.mjs --live-ai      # also spends ~1 token
 *
 * Reads (all optional — a missing one turns its checks into SKIP, not failure):
 *   API_BASE_URL        the data/function origin. On Supabase this is the project URL.
 *   API_KEY             the publishable/anon key sent as apikey + Bearer.
 *   DATABASE_URL        postgres://…  — only used if `psql` is on PATH.
 *   ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GEMINI_API_KEY, ADAM_AI_PROVIDER
 *
 * Exit code is 0 only if nothing FAILED. SKIPs do not fail the run; they are printed
 * at the end so nobody mistakes a mostly-skipped run for a healthy one.
 */
import { execFileSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const LIVE_AI = args.has("--live-ai");

const BASE = (process.env.API_BASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.API_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const DB = process.env.DATABASE_URL || "";

/** The tables the CLIENT reads. The migrations create more; these are the ones whose
 *  absence breaks a screen rather than a background job. */
const TABLES = [
  "adam_programs", "adam_agent_runs", "adam_program_snapshots", "adam_phase_agent_states",
  "adam_portfolio", "adam_copilot_threads", "adam_program_members", "adam_audit_log",
];

/** Functions the app invokes. `flow-portal` is the public token-gated face — it is the
 *  only one expected to answer without a user JWT. */
const FUNCTIONS = ["configure-ai-settings", "run-agent", "flow-portal", "save-document"];

const results = [];
const ok = (name, detail) => results.push({ state: "PASS", name, detail });
const bad = (name, detail) => results.push({ state: "FAIL", name, detail });
const skip = (name, detail) => results.push({ state: "SKIP", name, detail });

const timeout = (ms) => AbortSignal.timeout(ms);
const headers = KEY ? { apikey: KEY, Authorization: `Bearer ${KEY}` } : {};

async function checkReachable() {
  if (!BASE) return skip("origin reachable", "API_BASE_URL / VITE_SUPABASE_URL not set");
  try {
    const r = await fetch(`${BASE}/rest/v1/`, { headers, signal: timeout(15000) });
    // Any HTTP answer proves DNS + TLS + a listener. 401 is a healthy answer here.
    ok("origin reachable", `${BASE} → HTTP ${r.status}`);
  } catch (e) {
    bad("origin reachable", `${BASE} → ${e.message}`);
  }
}

async function checkTables() {
  if (!BASE || !KEY) return skip("tables exist", "needs API_BASE_URL and API_KEY");
  const missing = [], denied = [], found = [];
  for (const t of TABLES) {
    try {
      const r = await fetch(`${BASE}/rest/v1/${t}?select=*&limit=0`, { headers, signal: timeout(15000) });
      if (r.status === 404) missing.push(t);
      else if (r.status === 401 || r.status === 403) denied.push(t);
      else if (r.ok) found.push(t);
      else missing.push(`${t}(${r.status})`);
    } catch (e) { missing.push(`${t}(${e.message})`); }
  }
  if (missing.length) bad("tables exist", `missing/erroring: ${missing.join(", ")}`);
  else if (denied.length === TABLES.length) {
    // Everything refused: RLS is on and this key is anonymous. That is CORRECT, and it
    // is not proof the tables exist — say so rather than call it a pass.
    skip("tables exist", `all ${TABLES.length} refused (401/403) — RLS is on and this key is unauthenticated; re-run with a user token to prove the schema`);
  } else {
    // `limit=0` returns [] whether RLS hid every row or the table is empty, so this
    // proves the table EXISTS and the request was authorised at the API layer — it
    // says nothing about row visibility. Named accordingly rather than overclaimed.
    ok("tables exist", `${found.length} present${denied.length ? `, ${denied.length} refused (401/403)` : ""}, 0 missing — row visibility NOT evaluated`);
  }
}

function checkSchemaViaPsql() {
  if (!DB) return skip("schema (psql)", "DATABASE_URL not set");
  try { execFileSync("psql", ["--version"], { stdio: "ignore" }); }
  catch { return skip("schema (psql)", "psql not on PATH"); }
  try {
    const list = TABLES.map((t) => `'${t}'`).join(",");
    const out = execFileSync("psql", [DB, "-tAc",
      `select count(*) from information_schema.tables where table_schema='public' and table_name in (${list})`,
    ], { encoding: "utf8", timeout: 30000 }).trim();
    const n = Number(out);
    if (n === TABLES.length) ok("schema (psql)", `all ${n} client tables present`);
    else bad("schema (psql)", `${n}/${TABLES.length} client tables present — migrations incomplete`);
    const pol = execFileSync("psql", [DB, "-tAc",
      "select count(*) from pg_policies where schemaname='public'",
    ], { encoding: "utf8", timeout: 30000 }).trim();
    // RLS is the security model. Zero policies on a restored database means the
    // restore dropped them, and every row is readable by anyone who can connect.
    if (Number(pol) > 0) ok("RLS policies", `${pol} policies on public`);
    else bad("RLS policies", "ZERO policies on public — the restore lost them, and the data is unprotected");
  } catch (e) {
    bad("schema (psql)", e.message.split("\n")[0]);
  }
}

async function checkFunctions() {
  if (!BASE) return skip("functions deployed", "API_BASE_URL not set");
  const absent = [], present = [];
  for (const f of FUNCTIONS) {
    try {
      // OPTIONS, not POST. A POST 404 is ambiguous: the GATEWAY answers 404 for a
      // function that is not deployed, and a deployed function may answer 404 for a
      // bad request — `flow-portal` does exactly that ("This link is malformed"),
      // which made the first version of this check report the live public endpoint
      // as missing. The preflight has no such overlap: deployed answers 204,
      // absent answers 404 from the gateway.
      const r = await fetch(`${BASE}/functions/v1/${f}`, { method: "OPTIONS", signal: timeout(20000) });
      (r.status === 404 ? absent : present).push(`${f}(${r.status})`);
    } catch (e) { absent.push(`${f}(${e.message})`); }
  }
  if (absent.length) bad("functions deployed", `not found: ${absent.join(", ")}`);
  else ok("functions deployed", present.join(", "));
}

function resolveAI() {
  // The SAME precedence claudeClient.ts uses: env first, then the DB row. Anything
  // else here would be a second definition of which key wins.
  const provider = (process.env.ADAM_AI_PROVIDER || "").toLowerCase();
  const anthropic = process.env.ANTHROPIC_API_KEY || "";
  const openai = process.env.OPENAI_API_KEY || "";
  const google = process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
  if (provider === "openai" && openai) return { provider: "openai", key: openai };
  if (provider === "google" && google) return { provider: "google", key: google };
  if (provider === "anthropic" && anthropic) return { provider: "anthropic", key: anthropic };
  if (anthropic) return { provider: "anthropic", key: anthropic };
  if (openai) return { provider: "openai", key: openai };
  if (google) return { provider: "google", key: google };
  return null;
}

async function checkAI() {
  const ai = resolveAI();
  if (!ai) {
    return skip("AI provider", "no provider key in env — the runtime will fall back to the adam_ai_provider_settings row, which this script cannot read");
  }
  ok("AI provider (env)", `${ai.provider} — env keys WIN over the in-app AI Settings screen`);
  if (!LIVE_AI) return skip("AI round trip", "pass --live-ai to spend ~1 token proving the key works");
  try {
    let r;
    if (ai.provider === "anthropic") {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": ai.key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
        signal: timeout(45000),
      });
    } else if (ai.provider === "openai") {
      r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${ai.key}` },
        body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
        signal: timeout(45000),
      });
    } else {
      return skip("AI round trip", `no probe implemented for ${ai.provider}`);
    }
    if (r.ok) ok("AI round trip", `${ai.provider} answered HTTP ${r.status}`);
    else bad("AI round trip", `${ai.provider} → HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
  } catch (e) {
    bad("AI round trip", `${ai.provider} → ${e.message}`);
  }
}

function checkBuildEnv() {
  // The exact name that has bitten this project twice. client.ts reads
  // VITE_SUPABASE_PUBLISHABLE_KEY; the docs said VITE_SUPABASE_ANON_KEY until 2026-08-13.
  if (process.env.VITE_SUPABASE_ANON_KEY && !process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    bad("client env names", "VITE_SUPABASE_ANON_KEY is set but VITE_SUPABASE_PUBLISHABLE_KEY is not — client.ts reads the latter, so the app will build with NO backend");
  } else if (process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    ok("client env names", "VITE_SUPABASE_PUBLISHABLE_KEY set");
  } else {
    skip("client env names", "no VITE_* key set in this shell (fine if you build elsewhere)");
  }
}

const PAD = 22;
console.log(`\n  ATOS Flow — environment validation`);
console.log(`  target: ${BASE || "(no API_BASE_URL)"}\n`);

checkBuildEnv();
await checkReachable();
await checkTables();
checkSchemaViaPsql();
await checkFunctions();
await checkAI();

const mark = { PASS: "  PASS", FAIL: "  FAIL", SKIP: "  SKIP" };
for (const r of results) {
  console.log(`${mark[r.state]}  ${r.name.padEnd(PAD)}  ${r.detail}`);
}
const failed = results.filter((r) => r.state === "FAIL").length;
const skipped = results.filter((r) => r.state === "SKIP").length;
console.log(`\n  ${results.length - failed - skipped} passed · ${failed} failed · ${skipped} skipped`);
if (skipped) console.log(`  A skipped check proved nothing. Set what it names and run again.\n`);
else console.log("");
process.exit(failed ? 1 : 0);
