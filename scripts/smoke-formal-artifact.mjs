#!/usr/bin/env node
/**
 * Smoke test for the formal-artifact agents (ATOS Methodology Completeness, Cycle C).
 *
 * Fires ONE formal-artifact agent against a real programme through the deployed
 * `run-agent` edge function, then reads the programme back and checks that the
 * artifact slot was satisfied. It classifies the outcome so you can tell apart:
 *
 *   ✅ SUCCESS         agent ran, artifact written, slot satisfied  -> Cycle C verified
 *   ⚠️  PROVIDER/OUTAGE upstream model error (the Anthropic outage)  -> retry later
 *   🔒 AUTH            JWT missing/expired/not allowed              -> refresh token
 *   ❌ WIRING/OTHER    ran but no artifact landed, or 4xx/validation -> investigate
 *
 * USAGE
 *   USER_JWT=<your session access_token> PROGRAM_ID=<uuid> \
 *     node scripts/smoke-formal-artifact.mjs [agentId] [phaseId]
 *
 *   agentId defaults to "charter". phaseId defaults to the agent's spec phase.
 *
 * GET YOUR JWT (run in the app's browser devtools console while logged in):
 *   (await window.supabase?.auth.getSession())?.data?.session?.access_token
 *   // or, if not exposed: JSON.parse(localStorage.getItem(
 *   //   Object.keys(localStorage).find(k=>k.endsWith('-auth-token')))).access_token
 *
 * Reads VITE_SUPABASE_URL + anon key from .env.local automatically.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Formal-artifact registry (mirror of FORMAL_ARTIFACT_AGENTS in run-agent) ──
const FORMAL_ARTIFACT_AGENTS = {
  "charter":                { phase: "strategy", fieldKey: "transformationCharter", title: "Transformation Charter" },
  "business-case":          { phase: "strategy", fieldKey: "businessCaseDoc",       title: "Business Case" },
  "outcome-framework":      { phase: "strategy", fieldKey: "outcomeFramework",       title: "Outcome Framework" },
  "strategic-roadmap":      { phase: "strategy", fieldKey: "strategicRoadmap",       title: "Strategic Roadmap" },
  "governance-model":       { phase: "mobilise", fieldKey: "governanceModel",        title: "Governance Model" },
  "raci-matrix":            { phase: "mobilise", fieldKey: "raciMatrix",             title: "RACI Matrix" },
  "requirements-catalog":   { phase: "discover", fieldKey: "requirementsCatalog",    title: "Requirements Catalog" },
  "future-state-design":    { phase: "design",   fieldKey: "futureStateDesign",      title: "Future State Design" },
  "target-operating-model": { phase: "design",   fieldKey: "targetOperatingModel",   title: "Target Operating Model" },
  "solution-architecture":  { phase: "design",   fieldKey: "solutionArchitecture",   title: "Solution Architecture" },
  "test-plan":              { phase: "build",    fieldKey: "testPlan",               title: "Test Plan" },
  "runbook":                { phase: "operate",  fieldKey: "runbook",                title: "Runbook" },
  "support-model":          { phase: "operate",  fieldKey: "supportModel",           title: "Support Model" },
  "optimization-backlog":   { phase: "optimize", fieldKey: "optimizationBacklog",    title: "Optimization Backlog" },
};

// ── Tiny .env parser (no dependency) ──
function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(join(ROOT, file), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* file may not exist */ }
  return out;
}

const env = { ...loadEnv(".env"), ...loadEnv(".env.local"), ...process.env };

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const USER_JWT = env.USER_JWT;
const PROGRAM_ID = env.PROGRAM_ID;
const AGENT_ID = process.argv[2] || env.AGENT_ID || "charter";
const spec = FORMAL_ARTIFACT_AGENTS[AGENT_ID];
const PHASE_ID = process.argv[3] || env.PHASE_ID || spec?.phase || "strategy";

// ── Pre-flight ──
function fail(msg) { console.error(`\n  ✗ ${msg}\n`); process.exit(1); }

if (!SUPABASE_URL || !ANON_KEY) fail("Missing VITE_SUPABASE_URL / anon key in .env.local");
if (!USER_JWT) fail("Set USER_JWT=<your session access_token>. See header of this file for how to grab it.");
if (!PROGRAM_ID) fail("Set PROGRAM_ID=<uuid of a programme you can edit>.");
if (!spec) fail(`Unknown formal-artifact agent "${AGENT_ID}". Known: ${Object.keys(FORMAL_ARTIFACT_AGENTS).join(", ")}`);

const headers = {
  "Authorization": `Bearer ${USER_JWT}`,
  "apikey": ANON_KEY,
  "Content-Type": "application/json",
};

const PROVIDER_RE = /overload|rate.?limit|upstream|unavailable|timed?\s*out|timeout|503|529|capacity|provider|anthropic|model_error|api error/i;
const AUTH_RE = /jwt|unauthor|forbidden|not allowed|permission|sign|token|401|403/i;

// ── Helpers ──
function innerOf(data) {
  // programState wraps as { data: inner } when usesNestedData; otherwise flat.
  if (data && typeof data === "object" && data.data && typeof data.data === "object" && !Array.isArray(data.data)) {
    return data.data;
  }
  return data || {};
}

function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

async function fetchProgram() {
  const url = `${SUPABASE_URL}/rest/v1/adam_programs?id=eq.${PROGRAM_ID}&select=data`;
  const r = await fetch(url, { headers });
  const body = await r.text();
  if (!r.ok) return { ok: false, status: r.status, body };
  let rows;
  try { rows = JSON.parse(body); } catch { return { ok: false, status: r.status, body }; }
  return { ok: true, row: Array.isArray(rows) ? rows[0] : null };
}

function checkSlot(programRow) {
  const inner = innerOf(programRow?.data);
  const pa = inner.phaseArtifacts && inner.phaseArtifacts[PHASE_ID];
  const entry = pa && pa[AGENT_ID];
  const mirror = inner[spec.fieldKey];
  const titleMatches = entry && norm(entry.title).length > 0 &&
    (norm(entry.title) === norm(spec.title) || norm(entry.title).includes(norm(spec.title)) || norm(spec.title).includes(norm(entry.title)));
  return {
    artifactPresent: Boolean(entry),
    titleMatches: Boolean(titleMatches),
    entryTitle: entry?.title ?? null,
    mirrorPresent: mirror !== undefined && mirror !== null,
  };
}

// ── Run ──
console.log(`\n  ATOS formal-artifact smoke test`);
console.log(`  ───────────────────────────────`);
console.log(`  programme : ${PROGRAM_ID}`);
console.log(`  agent     : ${AGENT_ID}   (expects: "${spec.title}" in phase "${spec.phase}")`);
console.log(`  phase     : ${PHASE_ID}`);
console.log(`  endpoint  : ${SUPABASE_URL}/functions/v1/run-agent\n`);

// Snapshot slot state before, so we can prove the run changed it.
const before = await fetchProgram();
if (!before.ok) {
  if (AUTH_RE.test(String(before.status) + before.body)) {
    console.error(`  🔒 AUTH — could not read programme (status ${before.status}). JWT likely expired or lacks access.\n`);
  } else {
    console.error(`  ❌ Could not read programme before run (status ${before.status}): ${before.body}\n`);
  }
  process.exit(1);
}
const slotBefore = checkSlot(before.row);
console.log(`  slot before run : artifactPresent=${slotBefore.artifactPresent} titleMatches=${slotBefore.titleMatches}` +
  (slotBefore.entryTitle ? ` ("${slotBefore.entryTitle}")` : ""));

console.log(`\n  → firing agent…`);
const t0 = Date.now();
let resp, raw;
try {
  resp = await fetch(`${SUPABASE_URL}/functions/v1/run-agent`, {
    method: "POST",
    headers,
    body: JSON.stringify({ agentId: AGENT_ID, programId: PROGRAM_ID, phaseId: PHASE_ID, triggeredBy: "smoke-test" }),
  });
  raw = await resp.text();
} catch (e) {
  fail(`Network error calling run-agent: ${e.message}`);
}
const ms = Date.now() - t0;
let parsed; try { parsed = JSON.parse(raw); } catch { parsed = null; }
const errText = (parsed && (parsed.error || parsed.message)) ? String(parsed.error || parsed.message) : raw;

console.log(`  ← HTTP ${resp.status} in ${ms} ms`);

// ── Classify ──
if (resp.status === 401 || resp.status === 403 || (resp.status >= 400 && AUTH_RE.test(errText) && !PROVIDER_RE.test(errText))) {
  console.error(`\n  🔒 AUTH — ${errText}\n  Refresh your access_token and retry.\n`);
  process.exit(2);
}
if (!resp.ok && PROVIDER_RE.test(errText)) {
  console.error(`\n  ⚠️  PROVIDER / OUTAGE — upstream model error: ${errText}\n  The wiring is fine; the AI provider is unavailable. Retry when it recovers.\n`);
  process.exit(3);
}
if (!resp.ok) {
  console.error(`\n  ❌ ERROR (status ${resp.status}): ${errText}\n`);
  process.exit(4);
}

// 2xx — confirm the artifact actually landed.
console.log(`  agent returned summary: ${parsed?.summary ? JSON.stringify(parsed.summary).slice(0, 120) : "(none in payload)"}`);
console.log(`\n  → re-reading programme to verify slot…`);
const after = await fetchProgram();
if (!after.ok) {
  console.error(`\n  ⚠️  Agent returned 200 but could not re-read programme (status ${after.status}). Check the ledger in the UI.\n`);
  process.exit(5);
}
const slotAfter = checkSlot(after.row);
console.log(`  slot after run  : artifactPresent=${slotAfter.artifactPresent} titleMatches=${slotAfter.titleMatches}` +
  (slotAfter.entryTitle ? ` ("${slotAfter.entryTitle}")` : ""));
console.log(`  inner["${spec.fieldKey}"] mirror present: ${slotAfter.mirrorPresent}`);

if (slotAfter.artifactPresent && slotAfter.titleMatches) {
  const changed = !slotBefore.artifactPresent || !slotBefore.titleMatches;
  console.log(`\n  ✅ SUCCESS — formal-artifact agent verified end-to-end.` +
    (changed ? `  Slot flipped missing → satisfied.` : `  (Slot was already satisfied before this run.)`) + `\n`);
  process.exit(0);
}

console.error(`\n  ❌ WIRING — agent returned 200 but the artifact slot is NOT satisfied.` +
  `\n     Check that FORMAL_ARTIFACT_AGENTS["${AGENT_ID}"].title ("${spec.title}")` +
  `\n     matches agentMeta outputArtifact, and that the dispatch branch wrote phaseArtifacts["${PHASE_ID}"]["${AGENT_ID}"].\n`);
process.exit(6);
