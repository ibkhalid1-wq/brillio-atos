#!/usr/bin/env node
/**
 * Drop the legacy `tracks` (workstream) model from the two programmes that still
 * carry it — "ClaimPilot — Claims Transformation" and "Laila - CRM" — so they
 * behave like every newer atos-flow programme, which uses the ontology-derived
 * area model and carries no `tracks`.
 *
 * SCOPE: removes exactly `data.tracks` (and nothing else). `runbook` is a
 * legitimate formal artifact and is left untouched.
 *
 * SAFETY:
 *   - Read-only by default. Prints a per-programme diff and a comparison against
 *     a track-less newer programme so you can confirm `tracks` is the only delta.
 *   - `--apply` writes the change, but ONLY after dumping each programme's full
 *     original blob to scripts/backups/<id>.<ts>.json  (full reversibility).
 *   - Removing a key that newer valid programmes already lack cannot produce an
 *     invalid shape.
 *
 * USAGE
 *   node scripts/drop-tracks-migration.mjs            # dry run (no writes)
 *   node scripts/drop-tracks-migration.mjs --apply    # write, with backup
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local automatically.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const APPLY = process.argv.includes("--apply");

function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(join(ROOT, file), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* ignore */ }
  return out;
}
const env = { ...loadEnv(".env.local"), ...loadEnv(".env") };
const URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local"); process.exit(1); }

const db = createClient(URL, KEY, { auth: { persistSession: false } });

const TARGET_NAMES = ["ClaimPilot — Claims Transformation", "Laila - CRM"];
const stamp = process.env.TS_OVERRIDE || String(Date.now());

// data blob can be stored at row.data or row.data.data — normalise the read.
const innerOf = (data) =>
  data && typeof data.data === "object" && data.data !== null ? data.data : (data || {});

async function main() {
  const { data: rows, error } = await db
    .from("adam_programs")
    .select("id,name,methodology,data");
  if (error) { console.error("Query failed:", error.message); process.exit(1); }

  const byName = new Map(rows.map((r) => [r.name, r]));

  // A track-less newer atos-flow programme, for key comparison.
  const reference = rows.find(
    (r) => r.methodology === "atos-flow" &&
      !TARGET_NAMES.includes(r.name) &&
      !Array.isArray(innerOf(r.data).tracks),
  );
  const refKeys = reference ? new Set(Object.keys(innerOf(reference.data))) : new Set();
  console.log(`Reference (track-less) programme: ${reference ? reference.name : "none found"}`);
  console.log(`Mode: ${APPLY ? "APPLY (will write, with backup)" : "DRY RUN (no writes)"}\n`);

  for (const name of TARGET_NAMES) {
    const row = byName.get(name);
    if (!row) { console.log(`✗ NOT FOUND: ${name}\n`); continue; }
    const inner = innerOf(row.data);
    const keys = Object.keys(inner);
    const tracks = Array.isArray(inner.tracks) ? inner.tracks : null;
    const onlyHereVsRef = keys.filter((k) => !refKeys.has(k));

    console.log(`▸ ${name}  [${row.id}]  methodology=${row.methodology}`);
    console.log(`  tracks: ${tracks ? `${tracks.length} track(s) → ${tracks.map((t) => t && t.name).filter(Boolean).join(", ")}` : "none"}`);
    console.log(`  keys present that the reference programme lacks: ${onlyHereVsRef.join(", ") || "(none)"}`);

    if (!tracks) { console.log(`  → nothing to drop.\n`); continue; }

    if (APPLY) {
      mkdirSync(join(__dirname, "backups"), { recursive: true });
      const backup = join(__dirname, "backups", `${row.id}.${stamp}.json`);
      writeFileSync(backup, JSON.stringify(row.data, null, 2));
      console.log(`  ✓ backed up full blob → ${backup}`);

      // Remove ONLY tracks, preserving the row.data vs row.data.data nesting.
      const nextData = JSON.parse(JSON.stringify(row.data));
      const target = nextData && typeof nextData.data === "object" && nextData.data !== null ? nextData.data : nextData;
      delete target.tracks;

      const { error: upErr } = await db.from("adam_programs").update({ data: nextData }).eq("id", row.id);
      if (upErr) { console.log(`  ✗ WRITE FAILED: ${upErr.message}\n`); continue; }
      console.log(`  ✓ tracks removed; wrote ${Object.keys(target).length} keys.\n`);
    } else {
      console.log(`  → would remove data.tracks (${tracks.length} track(s)); backup + write on --apply.\n`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
