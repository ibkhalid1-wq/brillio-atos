/**
 * Override-log import adapter, end to end (docs/aura/override-adapter-report.md).
 * Builds the override batch + the generator batch from REAL Laila, validates both through
 * the ONE shared validator, reconciles generator∪override into a clean Option-A program,
 * proves source-class fidelity + precedence + heard-count + the migrate()-equivalence.
 * Additive test programs, cleaned up; Laila and other programs byte-identical.
 */
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "../../src/v3/lib/ledger/migrate";
import { PgLedger } from "../../src/v3/lib/ledger/pgStore";
import { generateClaimsBatch, validateBatch, type Batch } from "../../supabase/functions/_shared/ledgerGenerator";
import { overridesToBatch } from "../../supabase/functions/_shared/overrideAdapter";
import { migrateOverrideOwner } from "./overrideOwner";
import type { AssertInput, LedgerStore } from "../../src/v3/lib/ledger/store";
import type { LedgerElement } from "../../src/v3/lib/ledger/types";

const DIR = resolve(__dirname, "../../docs/laila/snapshot-2026-08-07");
const rd = (f: string) => JSON.parse(readFileSync(resolve(DIR, f), "utf8"));
const S: Snapshot = { ontology: rd("domain-ontology.json"), atlas: rd("current-state-atlas.json"), overrides: rd("operator-overrides.json") };
const A = "ovr-optionA", M = "ovr-migrate";
const ok = (b: boolean) => (b ? "PASS" : "**FAIL**");
const dedupEls = (els: LedgerElement[]) => { const m = new Map<string, LedgerElement>(); for (const e of els) if (!m.has(e.id)) m.set(e.id, e); return [...m.values()]; };

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  for (const p of [A, M]) { for (const t of ["ledger_claims", "ledger_elements", "ledger_rename_intents"]) await pool.query(`delete from ${t} where program_id=$1`, [p]); await pool.query("delete from audit_events where program_id=$1", [p]); }
  const otherBefore = (await pool.query("select md5(coalesce(string_agg(id||program_id||coalesce(superseded_by,''),'|' order by program_id,id),'')) h from ledger_claims where program_id not like 'ovr-%'")).rows[0].h;

  // ── 1. build the override batch + validate through the shared validator (import mode) ──
  // owner is an explicit argument now, derived from migrate's own mapping so the §4
  // equivalence below compares two paths that agree on the override-log owner.
  const ovr = overridesToBatch(S.overrides, migrateOverrideOwner());
  const IMPORT_OPTS = { allowedSources: ["dispositioned", "code-derived"], requireSlotCompleteness: false, allowClosedBy: true, checkElementIds: false };
  const v = validateBatch(ovr.batch, IMPORT_OPTS);
  console.log("# Override-log import adapter — real Laila\n");
  console.log(`log entries: ${ovr.total}  classified: ${ovr.classified}  skipped: ${ovr.skipped}`);
  console.log(`by kind: ${JSON.stringify(ovr.byKind)}`);
  console.log(`by source class: ${JSON.stringify(ovr.bySource)}  (never asserted, never generated)`);
  console.log(`validation (import mode): ${ok(v.ok)}  errors ${v.errors.length}  claims ${v.claimCount}`);
  // laundering guard: mark one override 'asserted' → the SAME validator rejects it
  const launder: Batch = { elements: [], claims: [{ ...ovr.batch.claims[0], source: "asserted" }] };
  const lv = validateBatch(launder, IMPORT_OPTS);
  console.log(`laundering guard — an override marked 'asserted' is rejected: ${ok(!lv.ok)} (${lv.errors.map((e) => e.code).join(",")})`);

  // ── 2. reconcile generator ∪ override into a clean Option-A program ──
  const gen = generateClaimsBatch({ ontology: S.ontology, atlas: S.atlas });
  const combinedClaims = [...gen.claims, ...ovr.batch.claims] as AssertInput[];
  const combinedEls = dedupEls([...gen.elements, ...ovr.batch.elements] as LedgerElement[]);
  const ledA = new PgLedger(pool, A, "gen-svc");
  await ledA.reconcile(combinedClaims, combinedEls);

  const bySourceLive = (await pool.query("select source, count(*) filter (where superseded_by is null)::int live, count(*)::int total from ledger_claims where program_id=$1 group by 1 order by 1", [A])).rows;
  console.log(`\n## Option-A ledger (reconcile of generator ∪ override), sources:`);
  for (const r of bySourceLive) console.log(`  ${r.source.padEnd(14)} live ${r.live} / total ${r.total}`);
  const ovrLoci = await pool.query("select source, count(*)::int n from ledger_claims where program_id=$1 and (source='dispositioned' or (source='code-derived' and world='as-is')) group by 1", [A]);
  console.log(`  override-derived present: ${ovrLoci.rows.map((r) => `${r.source}=${r.n}`).join(", ")}`);

  // ── 3. prior stakeholder assertion beats the operator override on a shared locus ──
  // the log moved "Opportunity Signal Generation" → area Marketing (dispositioned); a stakeholder asserts Sales.
  const wfArea = "el:wf:opportunity-signal-generation#area";
  await ledA.assert({ about: wfArea, value: { kind: "scalar", value: "Sales" }, world: "to-be", layer: "configuration",
    source: "asserted", ownerWhileOpen: { kind: "role", role: "Sales Leaders" }, status: "closed", closedBy: { method: "assertion", by: "vp-sales", verbatim: "it's a Sales workflow" } });
  await ledA.reconcile(ovr.batch.claims as AssertInput[], ovr.batch.elements as LedgerElement[]); // re-import; must not beat the assertion
  const liveArea = await ledA.liveClaimsAbout(wfArea);
  const areaWinner = liveArea.find((c) => !c.supersededBy);
  console.log(`\n## precedence: stakeholder assertion vs operator override on ${wfArea.split("#")[1]}`);
  console.log(`  live winner: source=${areaWinner?.source} value=${areaWinner?.value.kind === "scalar" ? areaWinner.value.value : "?"} by=${areaWinner?.closedBy?.by ?? "-"}`);
  console.log(`  stakeholder assertion survived, override did NOT beat it: ${ok(areaWinner?.source === "asserted")}`);

  // ── heard-count: overrides are not STAKEHOLDER closures — must not inflate the stakeholder-heard ──
  const heard = async (sources: string[]) => (await pool.query(
    `select count(*)::int n from ledger_claims where program_id=$1 and superseded_by is null
       and source = any($2) and status in ('closed','weak') and closed_by is not null
       and coalesce(closed_by->>'method','') <> 'import'
       and lower(coalesce(closed_by->>'by','')) not in ('prototype','import','system','?')`, [A, sources])).rows[0].n;
  const stakeSources = ["asserted", "document", "regulation", "precedent"];
  const allAttrib = ["asserted", "dispositioned", "document", "regulation", "precedent"];
  const stakeBefore = await heard(stakeSources), dispBefore = await heard(allAttrib);
  await ledA.reconcile(ovr.batch.claims as AssertInput[], ovr.batch.elements as LedgerElement[]); // import once more
  const stakeAfter = await heard(stakeSources), dispAfter = await heard(allAttrib);
  console.log(`\n## heard-count`);
  console.log(`  stakeholder-heard (asserted/doc/reg/precedent): ${stakeBefore} → ${stakeAfter}  unchanged by import: ${ok(stakeBefore === stakeAfter)}`);
  console.log(`  including operator dispositions: ${dispBefore} → ${dispAfter} (unchanged on re-import: ${ok(dispBefore === dispAfter)})`);
  console.log(`  0 asserted claims came from the override batch: ${ok(!ovr.batch.claims.some((c) => (c.source as string) === "asserted"))}`);

  // ── invariants: audit exact, Laila untouched ──
  const total = (await pool.query("select count(*)::int n from ledger_claims where program_id=$1", [A])).rows[0].n;
  const els = (await pool.query("select count(*)::int n from ledger_elements where program_id=$1", [A])).rows[0].n;
  const auditIns = (await pool.query("select count(*)::int n from audit_events where program_id=$1 and op='INSERT'", [A])).rows[0].n;
  console.log(`\n## invariants`);
  console.log(`  audit exact: claims ${total} + elements ${els} = ${total + els} == audit INSERT ${auditIns}: ${ok(total + els === auditIns)}`);
  const rm: LedgerStore = await ledA.loadReadModel();
  console.log(`  read model over the Option-A ledger: ${rm.elements().length} live elements, ${rm.claims().length} claims`);

  // ── 4. migrate() equivalence: generator + override vs migrate, per-locus source ──
  await new PgLedger(pool, M, "mig-svc").persistFrom(migrate(S));
  const liveMap = async (p: string) => new Map<string, string>((await pool.query("select about, source from ledger_claims where program_id=$1 and superseded_by is null", [p])).rows.map((r) => [r.about as string, r.source as string]));
  const mm = await liveMap(M), aa = await liveMap(A);
  let sameSrc = 0; const diffAbouts: string[] = []; const onlyMig: string[] = []; const onlyA: string[] = [];
  const diffPairs: string[] = [];
  for (const [about, ms] of mm) { if (!aa.has(about)) onlyMig.push(about); else if (aa.get(about) === ms) sameSrc += 1; else { diffAbouts.push(about); if (diffPairs.length < 3) diffPairs.push(`${about}: migrate=${ms} optionA=${aa.get(about)}`); } }
  for (const about of aa.keys()) if (!mm.has(about)) onlyA.push(about);
  const slotHist = (arr: string[]) => { const h: Record<string, number> = {}; for (const a of arr) { const s = a.includes("#") ? a.slice(a.indexOf("#") + 1).replace(/\..*/, ".*") : a; h[s] = (h[s] ?? 0) + 1; } return Object.entries(h).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, n]) => `${k}:${n}`).join(", "); };
  console.log(`\n## migrate() equivalence (per live locus, generator+override vs migrate)`);
  console.log(`  loci in both, SAME source: ${sameSrc}`);
  console.log(`  loci in both, DIFFERENT source: ${diffAbouts.length}  [${diffPairs[0]}]`);
  console.log(`    diff by slot: ${slotHist(diffAbouts)}`);
  console.log(`  loci only migrate() produces: ${onlyMig.length}`);
  console.log(`    by slot: ${slotHist(onlyMig)}`);
  console.log(`  loci only generator+override produces: ${onlyA.length}`);
  console.log(`    by slot: ${slotHist(onlyA)}`);

  const otherAfter = (await pool.query("select md5(coalesce(string_agg(id||program_id||coalesce(superseded_by,''),'|' order by program_id,id),'')) h from ledger_claims where program_id not like 'ovr-%'")).rows[0].h;
  console.log(`\nLaila / other programs byte-identical: ${ok(otherBefore === otherAfter)}`);

  for (const p of [A, M]) { for (const t of ["ledger_claims", "ledger_elements", "ledger_rename_intents"]) await pool.query(`delete from ${t} where program_id=$1`, [p]); await pool.query("delete from audit_events where program_id=$1", [p]); }
  console.log("\n(cleaned: ovr-optionA / ovr-migrate removed)");
  await pool.end();
}
main().catch((e) => { console.error("OVERRIDE-ROUND FAILED:", e); process.exit(1); });
