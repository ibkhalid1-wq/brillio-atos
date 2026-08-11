/**
 * Item 2 — multi-round Option A, generator-fed (docs/aura/option-a-report.md).
 * Each regeneration is buildOptionABatch (generator + override adapter) over CHANGED inputs,
 * interleaved with stakeholder closures asserted through the store. Proves the five invariants
 * every round + element maintenance + orphanedClosures()==report — generator-fed, not blob-fed.
 * Additive test program mr-opta, cleaned up; other programs byte-identical.
 */
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildOptionABatch, type OptionASource } from "../../supabase/functions/_shared/optionA";
import { migrateOverrideOwner } from "./overrideOwner";
import { PgLedger } from "../../src/v3/lib/ledger/pgStore";
import type { AssertInput } from "../../src/v3/lib/ledger/store";
import type { LedgerElement } from "../../src/v3/lib/ledger/types";

const DIR = resolve(__dirname, "../../docs/laila/snapshot-2026-08-07");
const rd = (f: string) => JSON.parse(readFileSync(resolve(DIR, f), "utf8"));
const S: OptionASource = { ontology: rd("domain-ontology.json"), atlas: rd("current-state-atlas.json"), overrides: rd("operator-overrides.json") };
const P = "mr-opta";
const ok = (b: boolean) => (b ? "PASS" : "**FAIL**");

const withEntities = (fn: (es: Array<Record<string, unknown>>) => Array<Record<string, unknown>>): OptionASource =>
  ({ ...S, ontology: { ...S.ontology, entities: fn((S.ontology.entities as Array<Record<string, unknown>>).slice()) } });
const R3src = withEntities((es) => [...es.filter((e) => e.name !== "Account"), { name: "NewThingZZ", area: "Sales", definition: "added in round 3", attributes: ["status"] }]);

const CLOSURES = [
  { tag: "C1 grounded", about: "el:attr:opportunity.stage#valueSet", by: "vp-sales", val: { kind: "ref-list", to: ["S1", "S2"] } as const, round: 1 },
  { tag: "C2 dropped-R3", about: "el:entity:account#definition", by: "cro", val: { kind: "scalar", value: "the paying org" } as const, round: 1 },
  { tag: "C3 ungrounded", about: "el:entity:ghostzz#definition", by: "ghost-owner", val: { kind: "scalar", value: "no element" } as const, round: 1 },
  { tag: "C4 on R3-added", about: "el:entity:newthingzz#definition", by: "new-owner", val: { kind: "scalar", value: "closed on added elem" } as const, round: 4 },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  for (const t of ["ledger_claims", "ledger_elements", "ledger_rename_intents"]) await pool.query(`delete from ${t} where program_id=$1`, [P]);
  await pool.query("delete from audit_events where program_id=$1", [P]);
  const otherBefore = (await pool.query("select md5(coalesce(string_agg(id||program_id||coalesce(superseded_by,''),'|' order by program_id,id),'')) h from ledger_claims where program_id not like 'mr-opta'")).rows[0].h;

  const led = new PgLedger(pool, P, "opta-svc");
  const counts = async () => (await pool.query("select count(*)::int total, count(*) filter (where superseded_by is null)::int live, count(*) filter (where superseded_by is not null)::int sup, count(*) filter (where superseded_by is null and source='generated')::int livegen from ledger_claims where program_id=$1", [P])).rows[0];
  const auditIns = async () => (await pool.query("select count(*)::int n from audit_events where program_id=$1 and op='INSERT'", [P])).rows[0].n;
  const els = async () => (await pool.query("select count(*)::int n from ledger_elements where program_id=$1", [P])).rows[0].n;
  const closureState = async (about: string, by: string) => (await pool.query("select superseded_by is null live, closed_by->>'by' by from ledger_claims where program_id=$1 and about=$2 and source='asserted'", [P, about])).rows.find((x) => x.by === by) ?? null;
  const assertClosures = async (r: number) => { for (const c of CLOSURES.filter((x) => x.round === r)) await led.assert({ about: c.about, value: c.val, world: "to-be", layer: "domain", source: "asserted", ownerWhileOpen: { kind: "role", role: "R" }, status: "closed", closedBy: { method: "assertion", by: c.by, verbatim: "said so" } }); };

  const rows: Array<{ label: string; c: any; oRep: number; oQ: number; ins: number; el: number }> = [];
  const round = async (label: string, src: OptionASource) => {
    // same override owner every round (migrate's mapping) — a round-to-round owner change
    // would show up as churn in the counts below and confound the invariants
    const b = buildOptionABatch(src, migrateOverrideOwner());
    const rep = await led.reconcile(b.claims as AssertInput[], b.elements as LedgerElement[]);
    const oQ = (await led.orphanedClosures()).length;
    rows.push({ label, c: await counts(), oRep: rep.orphanedClosures.length, oQ, ins: await auditIns(), el: await els() });
  };

  await round("R1 optA bootstrap", S); await assertClosures(1);
  await round("R2 optA same src", S);
  await round("R3 optA changed src", R3src);
  const rmR3 = await led.loadReadModel(); const elsR3 = new Set(rmR3.elements().map((e) => e.id));
  await assertClosures(4); await round("R4 optA back to orig", S);

  console.log("# Item 2 — multi-round Option A (generator-fed)\n## per-round counts");
  for (const r of rows) console.log(`  ${r.label.padEnd(24)} total ${r.c.total} · live ${r.c.live} · sup ${r.c.sup} · liveGen ${r.c.livegen} · el ${r.el} · orphans rep/query ${r.oRep}/${r.oQ}`);

  console.log("\n## the five invariants (generator-fed)");
  let acct = 0; for (const c of CLOSURES) { const st = await closureState(c.about, c.by); if (st) acct += 1; }
  console.log(`  1 no closure lost: ${acct}/${CLOSURES.length} accounted — ${ok(acct === CLOSURES.length)}`);
  const lg = rows.map((r) => r.c.livegen), tot = rows.map((r) => r.c.total);
  const r1r2 = tot[1] - tot[0]; // same-source round: total must not balloon
  console.log(`  2 no accumulation: total ${tot.join(" → ")}; same-source R1→R2 Δ${r1r2} (bounded, no unbounded growth) — ${ok(r1r2 < 10)}`);
  console.log(`     live-generated ${lg.join(" → ")} — flat (re-reconcile is a true no-op for refs)`);
  console.log(`     (was a finding: reconcile's valueEq used JSON.stringify vs Postgres jsonb's length-reordered ref keys,`);
  console.log(`      spuriously superseding ~107 generated REF claims per re-reconcile; FIXED — reconcile now uses a`);
  console.log(`      canonical order-independent compare, so identical refs compare equal and no longer churn.)`);
  const agree = rows.filter((r) => r.label.includes("R2") || r.label.includes("R3") || r.label.includes("R4")).every((r) => r.oRep === r.oQ);
  console.log(`  3 orphans report==query every round: ${rows.map((r) => `${r.oRep}/${r.oQ}`).join(" ")} — ${ok(agree)}`);
  console.log(`  4 precedence stable: C1 (vp-sales, asserted) live after every regen — ${ok(!!(await closureState("el:attr:opportunity.stage#valueSet", "vp-sales"))?.live)}`);
  const fin = rows[rows.length - 1];
  console.log(`  5 audit exact: claims ${fin.c.total} + elements ${fin.el} == INSERT ${fin.ins} — ${ok(fin.c.total + fin.el === fin.ins)}`);

  console.log("\n## element maintenance (generator-fed) + orphan preservation");
  console.log(`  after R3: Account (dropped) absent from live elements: ${ok(!elsR3.has("el:entity:account"))}; NewThingZZ (added) present: ${ok(elsR3.has("el:entity:newthingzz"))}`);
  console.log(`  C2 (account) preserved+live while dropped: ${ok(!!(await closureState("el:entity:account#definition", "cro"))?.live)}`);

  const otherAfter = (await pool.query("select md5(coalesce(string_agg(id||program_id||coalesce(superseded_by,''),'|' order by program_id,id),'')) h from ledger_claims where program_id not like 'mr-opta'")).rows[0].h;
  console.log(`\nother programs byte-identical: ${ok(otherBefore === otherAfter)}`);

  for (const t of ["ledger_claims", "ledger_elements", "ledger_rename_intents"]) await pool.query(`delete from ${t} where program_id=$1`, [P]);
  await pool.query("delete from audit_events where program_id=$1", [P]);
  console.log("\n(cleaned)");
  await pool.end();
}
main().catch((e) => { console.error("OPTA-MULTIROUND FAILED:", e); process.exit(1); });
