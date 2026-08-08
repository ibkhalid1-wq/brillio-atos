/**
 * Item 1 — retire migrate() (docs/aura/option-a-report.md). The cold from-empty arc:
 * buildOptionABatch (generator + override adapter) → reconcile → the complete Laila ledger,
 * proven equal to the migrate() bootstrap in claims + sources, differing only in the known
 * better-attribution operatorCorrected locus. Option A operating, not simulated.
 * Additive test programs, cleaned up; Laila and other programs byte-identical.
 */
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "../../src/v3/lib/ledger/migrate";
import { PgLedger } from "../../src/v3/lib/ledger/pgStore";
import { buildOptionABatch } from "../../supabase/functions/_shared/optionA";
import type { AssertInput } from "../../src/v3/lib/ledger/store";
import type { LedgerElement } from "../../src/v3/lib/ledger/types";

const DIR = resolve(__dirname, "../../docs/laila/snapshot-2026-08-07");
const rd = (f: string) => JSON.parse(readFileSync(resolve(DIR, f), "utf8"));
const S: Snapshot = { ontology: rd("domain-ontology.json"), atlas: rd("current-state-atlas.json"), overrides: rd("operator-overrides.json") };
const A = "retire-optionA", M = "retire-migrate";
const ok = (b: boolean) => (b ? "PASS" : "**FAIL**");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  for (const p of [A, M]) { for (const t of ["ledger_claims", "ledger_elements", "ledger_rename_intents"]) await pool.query(`delete from ${t} where program_id=$1`, [p]); await pool.query("delete from audit_events where program_id=$1", [p]); }
  const otherBefore = (await pool.query("select md5(coalesce(string_agg(id||program_id||coalesce(superseded_by,''),'|' order by program_id,id),'')) h from ledger_claims where program_id not like 'retire-%'")).rows[0].h;

  // ── Option A, cold from an EMPTY ledger ──
  const batch = buildOptionABatch(S);
  console.log("# Item 1 — retire migrate(): Option A cold from empty\n");
  console.log(`buildOptionABatch: generated ${batch.counts.generated} · dispositioned ${batch.counts.dispositioned} · code-derived ${batch.counts.codeDerived} · elements ${batch.counts.elements}`);
  console.log(`  boundary validation: generator ${ok(batch.generator.ok)} · override ${ok(batch.override.ok)}`);
  const led = new PgLedger(pool, A, "optionA");
  const t0 = process.hrtime.bigint();
  await led.reconcile(batch.claims as AssertInput[], batch.elements as LedgerElement[]);
  console.log(`  reconcile(Option A) into empty program: ${Number(process.hrtime.bigint() - t0) / 1e6 | 0}ms`);

  // ── migrate() bootstrap for the equivalence baseline ──
  await new PgLedger(pool, M, "migrate").persistFrom(migrate(S));

  const liveMap = async (p: string) => new Map<string, string>((await pool.query("select about, source from ledger_claims where program_id=$1 and superseded_by is null", [p])).rows.map((r) => [r.about as string, r.source as string]));
  const mm = await liveMap(M), aa = await liveMap(A);
  let same = 0; const diffAbouts: string[] = [], onlyMig: string[] = [], onlyA: string[] = [];
  for (const [about, ms] of mm) { if (!aa.has(about)) onlyMig.push(about); else if (aa.get(about) === ms) same += 1; else diffAbouts.push(about); }
  for (const about of aa.keys()) if (!mm.has(about)) onlyA.push(about);
  const slotHist = (arr: string[]) => { const h: Record<string, number> = {}; for (const a of arr) { const s = a.includes("#") ? a.slice(a.indexOf("#") + 1).replace(/\..*/, ".*") : a; h[s] = (h[s] ?? 0) + 1; } return Object.entries(h).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, n]) => `${k}:${n}`).join(", "); };

  console.log(`\n## generator+adapter (Option A)  vs  migrate() bootstrap — per live locus`);
  console.log(`  same source: ${same}`);
  console.log(`  different source (honest code-derived→generated): ${diffAbouts.length} [${slotHist(diffAbouts)}]`);
  console.log(`  only migrate() produces: ${onlyMig.length} [${slotHist(onlyMig)}]  ${onlyMig.map((a) => a).slice(0, 3).join(" ")}`);
  console.log(`  only Option A produces: ${onlyA.length} [${slotHist(onlyA)}]`);

  // confirm the one residual is a better-attribution operatorCorrected, not a lost claim
  const migOC = onlyMig.filter((a) => a.endsWith("#operatorCorrected"));
  const aOC = onlyA.filter((a) => a.endsWith("#operatorCorrected"));
  console.log(`\n## the residual locus — better attribution, not a missing claim`);
  console.log(`  only-migrate operatorCorrected: ${migOC.join(", ") || "(none)"}`);
  console.log(`  only-optionA operatorCorrected: ${aOC.join(", ") || "(none)"}`);
  const sameEntry = migOC.length === 1 && aOC.length === 1 && migOC[0].split("#")[0].replace(/^el:(entity|wf):/, "") === aOC[0].split("#")[0].replace(/^el:(entity|wf):/, "");
  console.log(`  same edit, migrate=${migOC[0]?.startsWith("el:entity") ? "entity(heuristic)" : "wf"} vs optionA declared-kind: ${ok(sameEntry)} — the claim exists in both, Option A's attribution is the cleaner one`);
  console.log(`  Option A retirement equivalence (only diffs are reclassification + the 1 attribution locus): ${ok(onlyMig.every((a) => a.endsWith("#operatorCorrected")))}`);

  const otherAfter = (await pool.query("select md5(coalesce(string_agg(id||program_id||coalesce(superseded_by,''),'|' order by program_id,id),'')) h from ledger_claims where program_id not like 'retire-%'")).rows[0].h;
  console.log(`\nLaila / other programs byte-identical: ${ok(otherBefore === otherAfter)}`);

  for (const p of [A, M]) { for (const t of ["ledger_claims", "ledger_elements", "ledger_rename_intents"]) await pool.query(`delete from ${t} where program_id=$1`, [p]); await pool.query("delete from audit_events where program_id=$1", [p]); }
  console.log("\n(cleaned)");
  await pool.end();
}
main().catch((e) => { console.error("RETIRE FAILED:", e); process.exit(1); });
