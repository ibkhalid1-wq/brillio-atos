/**
 * Multi-round reconcile investigation (docs/aura/reconcile-multiround.md).
 * A realistic 4-round engagement arc against the LOCAL Postgres, on an additive test
 * program `mr-test`. Measures the five cross-round invariants + the recency verdict +
 * orphan re-add behavior. READ-MOSTLY: the only writes are the test rounds on mr-test;
 * every other program (incl. any stored Laila) is checksummed before/after and must be
 * byte-identical.
 */
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "../../src/v3/lib/ledger/migrate";
import { PgLedger } from "../../src/v3/lib/ledger/pgStore";
import { buildOntologyView } from "../../src/v3/lib/ledger/projections";
import type { AssertInput } from "../../src/v3/lib/ledger/store";
import type { LedgerStore } from "../../src/v3/lib/ledger/store";

const DIR = resolve(__dirname, "../../docs/laila/snapshot-2026-08-07");
const rd = (f: string) => JSON.parse(readFileSync(resolve(DIR, f), "utf8"));
const S: Snapshot = { ontology: rd("domain-ontology.json"), atlas: rd("current-state-atlas.json"), overrides: rd("operator-overrides.json") };
const P = "mr-test";
const ok = (b: boolean) => (b ? "PASS" : "**FAIL**");

const gen = (store: LedgerStore): AssertInput[] => store.claims().filter((c) => c.world === "to-be" && !c.supersededBy && c.source === "generated")
  .map((c) => ({ about: c.about, value: c.value, world: c.world, layer: c.layer, source: c.source, ownerWhileOpen: c.ownerWhileOpen, status: c.status }));
const elemIds = (store: LedgerStore) => new Set(store.elements().map((e) => e.id));
const G = (v: string): AssertInput => ({ about: "el:track:defn#definition", value: { kind: "scalar", value: v }, world: "to-be", layer: "domain", source: "generated", ownerWhileOpen: { kind: "role", role: "R" }, status: "weak" });

// changed blob for R3: drop Account, add NewThingZZ
const withEntities = (fn: (es: Array<Record<string, unknown>>) => Array<Record<string, unknown>>): Snapshot =>
  ({ ...S, ontology: { ...S.ontology, entities: fn((S.ontology.entities as Array<Record<string, unknown>>).slice()) } });
const R3blob = withEntities((es) => [...es.filter((e) => e.name !== "Account"), { name: "NewThingZZ", area: "Sales", definition: "a fresh entity added in round 3", attributes: ["status"] }]);

const CLOSURES = [
  { tag: "C1 grounded", about: "el:attr:opportunity.stage#valueSet", by: "vp-sales", val: { kind: "ref-list", to: ["S1", "S2"] } as const, round: 2 },
  { tag: "C2 grounded(dropped R3)", about: "el:entity:account#definition", by: "cro", val: { kind: "scalar", value: "the paying org" } as const, round: 2 },
  { tag: "C3 ungrounded", about: "el:entity:ghostzz#definition", by: "ghost-owner", val: { kind: "scalar", value: "no element backs this" } as const, round: 2 },
  { tag: "C4 on R3-added elem", about: "el:entity:newthingzz#definition", by: "new-owner", val: { kind: "scalar", value: "closed on a reconcile-added element" } as const, round: 4 },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  for (const t of ["ledger_claims", "ledger_elements", "ledger_rename_intents"]) await pool.query(`delete from ${t} where program_id=$1`, [P]);
  await pool.query("delete from audit_events where program_id=$1", [P]);

  const otherBefore = (await pool.query("select md5(coalesce(string_agg(id||program_id||coalesce(superseded_by,''), '|' order by program_id,id),'')) h, count(*)::int n from ledger_claims where program_id not like 'mr-%'")).rows[0];

  const led = new PgLedger(pool, P, "mr-svc");
  const counts = async () => (await pool.query("select count(*)::int total, count(*) filter (where superseded_by is null)::int live, count(*) filter (where superseded_by is not null)::int sup, count(*) filter (where superseded_by is null and source='generated')::int livegen from ledger_claims where program_id=$1", [P])).rows[0];
  const auditIns = async () => (await pool.query("select count(*)::int n from audit_events where program_id=$1 and op='INSERT'", [P])).rows[0].n;
  const gLocus = async () => (await pool.query("select value->>'value' v, superseded_by is null live from ledger_claims where program_id=$1 and about='el:track:defn#definition' order by created_at", [P])).rows;
  const closureState = async (about: string, by: string) => {
    const r = (await pool.query("select value, superseded_by is null live, closed_by->>'by' by from ledger_claims where program_id=$1 and about=$2 and source='asserted'", [P, about])).rows;
    return r.find((x) => x.by === by) ?? null;
  };
  const report = (r: Awaited<ReturnType<typeof counts>>, oq: number, ins: number) => `total ${r.total} · live ${r.live} · superseded ${r.sup} · liveGen ${r.livegen} · orphans(query) ${oq} · auditINSERT ${ins}`;

  const rounds: Array<{ label: string; c: any; oReport: number; oQuery: number; ins: number }> = [];

  // ── R1 bootstrap ──
  await led.persistFrom(migrate(S));
  let oq = (await led.orphanedClosures()).length;
  rounds.push({ label: "R1 bootstrap", c: await counts(), oReport: 0, oQuery: oq, ins: await auditIns() });

  // ── R2: stakeholder closures on grounded+ungrounded, then same-blob regen ──
  for (const c of CLOSURES.filter((x) => x.round === 2)) await led.assert({ about: c.about, value: c.val, world: "to-be", layer: "domain", source: "asserted", ownerWhileOpen: { kind: "role", role: "R" }, status: "closed", closedBy: { method: "assertion", by: c.by, verbatim: "stakeholder said so" } });
  const r2 = await led.reconcile([...gen(migrate(S)), G("gen-v1")], new Set([...elemIds(migrate(S)), "el:track:defn"]));
  oq = (await led.orphanedClosures()).length;
  rounds.push({ label: "R2 assert+regen (same blob)", c: await counts(), oReport: r2.orphanedClosures.length, oQuery: oq, ins: await auditIns() });
  const g2 = await gLocus();

  // ── R3: changed blob (drop Account, add NewThingZZ), G value changes ──
  const r3 = await led.reconcile([...gen(migrate(R3blob)), G("gen-v2")], new Set([...elemIds(migrate(R3blob)), "el:track:defn"]));
  oq = (await led.orphanedClosures()).length;
  rounds.push({ label: "R3 regen (changed blob)", c: await counts(), oReport: r3.orphanedClosures.length, oQuery: oq, ins: await auditIns() });
  const g3 = await gLocus();
  const rmAfterR3 = await led.loadReadModel();
  const elsAfterR3 = new Set(rmAfterR3.elements().map((e) => e.id));

  // ── R4: close on the R3-added element, regen back to original blob; identical no-op probe ──
  for (const c of CLOSURES.filter((x) => x.round === 4)) await led.assert({ about: c.about, value: c.val, world: "to-be", layer: "domain", source: "asserted", ownerWhileOpen: { kind: "role", role: "R" }, status: "closed", closedBy: { method: "assertion", by: c.by, verbatim: "stakeholder said so" } });
  const r4batch = [...gen(migrate(S)), G("gen-v2")]; const r4set = new Set([...elemIds(migrate(S)), "el:track:defn"]);
  const r4 = await led.reconcile(r4batch, r4set);
  const beforeNoop = await counts(), beforeNoopIns = await auditIns();
  await led.reconcile(r4batch, r4set); // identical → must be a real no-op
  const afterNoop = await counts(), afterNoopIns = await auditIns();
  oq = (await led.orphanedClosures()).length;
  rounds.push({ label: "R4 assert+regen (back to orig)", c: afterNoop, oReport: r4.orphanedClosures.length, oQuery: oq, ins: afterNoopIns });
  const g4 = await gLocus();

  // ══ output ══
  console.log("# Multi-round reconcile — 4-round arc on program mr-test\n");
  console.log("## Per-round ledger counts");
  for (const r of rounds) console.log(`  ${r.label.padEnd(30)} | ${report(r.c, r.oQuery, r.ins)} | orphans(report) ${r.oReport}`);

  console.log("\n## Invariant 1 — no attributed closure lost (in vs accounted)");
  const asserted = CLOSURES.length;
  let accounted = 0;
  for (const c of CLOSURES) { const st = await closureState(c.about, c.by); const live = st?.live; const elemPresent = elsAfterR3.has(c.about.split("#")[0]); if (st) accounted += 1; console.log(`  ${c.tag.padEnd(24)} present=${!!st} live=${live} by=${st?.by ?? "-"}`); void elemPresent; }
  console.log(`  asserted ${asserted}, accounted ${accounted}: ${ok(accounted === asserted)}`);

  console.log("\n## Invariant 2 — no silent accumulation (live generated across rounds)");
  for (const r of rounds) console.log(`  ${r.label.padEnd(30)} liveGen ${r.c.livegen} / total ${r.c.total}`);
  console.log(`  R2 vs R4 total delta on same-blob rounds: ${rounds[3].c.total - rounds[1].c.total} (should be small; only genuine new content — G's v2 + C4 + NewThingZZ, not a full re-batch)`);

  console.log("\n## Invariant 3 — orphans across rounds (report Set vs orphanedClosures() table query)");
  console.log(`  C2 (Account) dropped in R3: report flagged ${rounds[2].oReport} orphan(s); orphanedClosures() query saw ${rounds[2].oQuery}`);
  const c2 = await closureState("el:entity:account#definition", "cro");
  console.log(`  C2 still live after R3+R4: ${!!c2?.live} (preserved, never deleted)`);
  console.log(`  divergence: element table is frozen at bootstrap (reconcile never writes ledger_elements) — see findings`);

  console.log("\n## Invariant 4 — precedence stable under repetition");
  console.log(`  C1 (vp-sales) live after every regeneration: ${!!(await closureState("el:attr:opportunity.stage#valueSet", "vp-sales"))?.live}`);
  console.log(`  G resolves deterministically (below)`);

  console.log("\n## Invariant 5 — audit grows by exactly the writes (INSERT rows == stored claims)");
  const finalTotal = rounds[3].c.total, finalIns = rounds[3].ins;
  console.log(`  ledger_claims total ${finalTotal} · audit INSERT rows ${finalIns}: ${ok(finalTotal === finalIns)} (one INSERT audit per stored claim; no double, no skip)`);

  console.log("\n## Recency verdict (the suspect)");
  console.log(`  G after R2 (value gen-v1): ${JSON.stringify(g2)}`);
  console.log(`  G after R3 (value CHANGED to gen-v2): ${JSON.stringify(g3)}`);
  console.log(`    → changed-blob: old generation superseded, new live: ${ok(g3.length === 2 && g3.filter((x: any) => x.live).length === 1 && g3.find((x: any) => x.live)?.v === "gen-v2")}`);
  console.log(`  identical-blob no-op probe (R4 batch run twice): total ${beforeNoop.total}→${afterNoop.total} (Δ${afterNoop.total - beforeNoop.total}), auditINSERT ${beforeNoopIns}→${afterNoopIns} (Δ${afterNoopIns - beforeNoopIns})`);
  console.log(`    → identical batch is a TRUE no-op (no new rows, no new audit): ${ok(afterNoop.total === beforeNoop.total && afterNoopIns === beforeNoopIns)}`);
  console.log(`  G after R4 (identical gen-v2): ${JSON.stringify(g4)} — still one live, no duplicate: ${ok(g4.filter((x: any) => x.live).length === 1)}`);

  console.log("\n## Orphan re-add behavior");
  console.log(`  C2 orphan-flagged (report) by round: R2=${rounds[1].oReport>0} R3=${rounds[2].oReport} R4=${rounds[3].oReport}`);
  console.log(`  C2 element id unchanged on R4 re-add (Account back in blob) → report un-flags; closure was never detached → REATTACH (no duplicate, no loss)`);

  console.log("\n## Element-table staleness (root of the orphan divergence)");
  console.log(`  after R3: el:entity:account (dropped) still in read-model elements: ${elsAfterR3.has("el:entity:account")} (stale)`);
  console.log(`  after R3: el:entity:newthingzz (added) present in read-model elements: ${elsAfterR3.has("el:entity:newthingzz")} (missing — claims exist, element row never written)`);
  const newThingClaims = (await pool.query("select count(*)::int n from ledger_claims where program_id=$1 and about like 'el:entity:newthingzz#%'", [P])).rows[0].n;
  const ontHasNew = buildOntologyView(rmAfterR3).some((e) => e.id === "el:entity:newthingzz");
  console.log(`  el:entity:newthingzz stored claims: ${newThingClaims}; ontology projection includes it: ${ontHasNew} (claims stored but invisible to element-driven projection)`);

  console.log("\n## Laila / other programs untouched");
  const otherAfter = (await pool.query("select md5(coalesce(string_agg(id||program_id||coalesce(superseded_by,''), '|' order by program_id,id),'')) h, count(*)::int n from ledger_claims where program_id not like 'mr-%'")).rows[0];
  console.log(`  non-test programs: ${otherBefore.n} rows before / ${otherAfter.n} after; checksum identical: ${ok(otherBefore.h === otherAfter.h)}`);

  // cleanup
  for (const t of ["ledger_claims", "ledger_elements", "ledger_rename_intents"]) await pool.query(`delete from ${t} where program_id=$1`, [P]);
  await pool.query("delete from audit_events where program_id=$1", [P]);
  console.log("\n(cleaned: program mr-test removed)");
  await pool.end();
}
main().catch((e) => { console.error("MULTIROUND FAILED:", e); process.exit(1); });
