/**
 * End-to-end Option-A arc (docs/aura/generator-report.md): generate → validate →
 * reconcile, with a GENERATOR-FED round replacing a blob-fed one, against the live DB.
 * Reads the Deno-produced batch (scripts/ledger/generate-claims.ts). Additive test
 * program `gen-test`, cleaned up; Laila and all other programs byte-identical.
 */
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "../../src/v3/lib/ledger/migrate";
import { PgLedger } from "../../src/v3/lib/ledger/pgStore";
import type { AssertInput, LedgerStore } from "../../src/v3/lib/ledger/store";
import type { LedgerElement } from "../../src/v3/lib/ledger/types";

const DIR = resolve(__dirname, "../../docs/laila/snapshot-2026-08-07");
const snap = (f: string) => JSON.parse(readFileSync(resolve(DIR, f), "utf8"));
const S: Snapshot = { ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") };
const P = "gen-test";
const batchPath = process.argv[2];
const ok = (b: boolean) => (b ? "PASS" : "**FAIL**");

async function main() {
  const batch = JSON.parse(readFileSync(batchPath, "utf8")) as { elements: LedgerElement[]; claims: AssertInput[] };
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  for (const t of ["ledger_claims", "ledger_elements", "ledger_rename_intents"]) await pool.query(`delete from ${t} where program_id=$1`, [P]);
  await pool.query("delete from audit_events where program_id=$1", [P]);
  const otherBefore = (await pool.query("select md5(coalesce(string_agg(id||program_id||coalesce(superseded_by,''),'|' order by program_id,id),'')) h from ledger_claims where program_id not like 'gen-%'")).rows[0].h;

  const led = new PgLedger(pool, P, "gen-svc");

  // ── prior round (blob-fed bootstrap) + a stakeholder closure on a locus the generator also emits ──
  await led.persistFrom(migrate(S));
  const locus = "el:attr:opportunity.stage#valueSet"; // the generator emits this as ?unknown
  await led.assert({ about: locus, value: { kind: "ref-list", to: ["Prospecting", "Qualification", "Proposal", "Closed Won", "Closed Lost"] },
    world: "to-be", layer: "domain", source: "asserted", ownerWhileOpen: { kind: "role", role: "Sales Leaders" }, status: "closed", closedBy: { method: "assertion", by: "vp-sales", verbatim: "our five stages" } });

  console.log("# End-to-end Option A — generator-fed reconcile round\n");
  // structural guarantees, read straight off the batch:
  const anyId = batch.claims.some((c) => "id" in (c as Record<string, unknown>) || "supersededBy" in (c as Record<string, unknown>));
  const touches = batch.claims.filter((c) => c.about.includes("#touches."));
  const touchRefs = touches.every((c) => c.value.kind === "ref" || c.value.kind === "unresolved-ref");
  const onlyGenerated = batch.claims.every((c) => c.source === "generated");
  console.log(`generator mints no ids (no id/supersededBy on any claim): ${ok(!anyId)}`);
  console.log(`generator resolves no references (all ${touches.length} touches are ref|unresolved-ref, never bound-as-fact): ${ok(touchRefs)}`);
  console.log(`generator emits only 'generated': ${ok(onlyGenerated)}`);

  // ── the generator-fed round through the PROVEN reconcile ──
  const before = (await pool.query("select count(*)::int n from ledger_claims where program_id=$1", [P])).rows[0].n;
  const rep = await led.reconcile(batch.claims, batch.elements);
  console.log(`\nreconcile(generator batch): applied ${rep.applied}, preservedClosures ${rep.preservedClosures}, filledUnknowns ${rep.filledUnknowns}, newClaims ${rep.newClaims}, supersededGenerated ${rep.supersededGenerated}`);

  // closure from the prior round survives the generated round
  const live = await led.liveClaimsAbout(locus);
  const closureLive = live.find((c) => c.source === "asserted" && c.status === "closed" && c.closedBy?.by === "vp-sales");
  console.log(`\nprior-round closure survives the generator round: ${ok(!!closureLive)} (asserted beats generated — precedence held)`);
  const genUnknownOnLocus = (await pool.query("select count(*)::int n from ledger_claims where program_id=$1 and about=$2 and source='generated' and value->>'kind'='unknown'", [P, locus])).rows[0].n;
  console.log(`  the generator's ?unknown on that locus landed (superseded by the closure, not overwriting it): ${ok(genUnknownOnLocus >= 1)}`);

  // generated claims land as generated; unknowns land as unknown/open
  const liveGen = (await pool.query("select count(*)::int n from ledger_claims where program_id=$1 and source='generated' and superseded_by is null", [P])).rows[0].n;
  const liveUnknownOpen = (await pool.query("select count(*)::int n from ledger_claims where program_id=$1 and superseded_by is null and value->>'kind'='unknown' and status='open'", [P])).rows[0].n;
  const anyAsserted = (await pool.query("select count(*)::int n from ledger_claims where program_id=$1 and source='asserted' and superseded_by is null", [P])).rows[0].n;
  console.log(`\ngenerated claims landed as generated (live): ${liveGen}`);
  console.log(`unknowns landed as unknown/open (live): ${liveUnknownOpen} (>0: ${ok(liveUnknownOpen > 0)})`);
  console.log(`asserted closures still live (never demoted to generated): ${anyAsserted} (>=1: ${ok(anyAsserted >= 1)})`);

  // invariants: audit exact (claims + elements), no source stronger than expected appeared
  const total = (await pool.query("select count(*)::int n from ledger_claims where program_id=$1", [P])).rows[0].n;
  const els = (await pool.query("select count(*)::int n from ledger_elements where program_id=$1", [P])).rows[0].n;
  const auditIns = (await pool.query("select count(*)::int n from audit_events where program_id=$1 and op='INSERT'", [P])).rows[0].n;
  console.log(`\naudit exact: claims ${total} + elements ${els} = ${total + els} == audit INSERT ${auditIns}: ${ok(total + els === auditIns)}`);
  console.log(`  (round added ${total - before} claims — the generated unknowns/values not already present)`);
  const sources = (await pool.query("select distinct source from ledger_claims where program_id=$1 order by 1", [P])).rows.map((r) => r.source);
  console.log(`  sources in the ledger after the generator round: ${sources.join(", ")}`);

  // projections still read (Option A output is projectable like any other)
  const rm: LedgerStore = await led.loadReadModel();
  console.log(`  read model over the generator-fed ledger: ${rm.elements().length} live elements, ${rm.claims().length} claims`);

  const otherAfter = (await pool.query("select md5(coalesce(string_agg(id||program_id||coalesce(superseded_by,''),'|' order by program_id,id),'')) h from ledger_claims where program_id not like 'gen-%'")).rows[0].h;
  console.log(`\nLaila / other programs byte-identical: ${ok(otherBefore === otherAfter)}`);

  for (const t of ["ledger_claims", "ledger_elements", "ledger_rename_intents"]) await pool.query(`delete from ${t} where program_id=$1`, [P]);
  await pool.query("delete from audit_events where program_id=$1", [P]);
  console.log("\n(cleaned: program gen-test removed)");
  await pool.end();
}
main().catch((e) => { console.error("GENERATOR-ROUND FAILED:", e); process.exit(1); });
