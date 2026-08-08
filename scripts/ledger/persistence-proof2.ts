/**
 * Persistence proof, part 2 (local Postgres only). Continues the build:
 *   2.5  rename-intent capture — durable old→new element id, survives a fresh connection.
 *   2.6  projections over the STORED ledger via loadReadModel(); cost + parity vs in-memory.
 *   2.7  honest heard-count = attributed HUMAN closures per band/total (the register fix).
 */
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "../../src/v3/lib/ledger/migrate";
import { PgLedger } from "../../src/v3/lib/ledger/pgStore";
import { buildUnknownQueue, buildKitView, buildOntologyView, buildAtlasView, buildDeviationRegister, buildHeardRegister } from "../../src/v3/lib/ledger/projections";

const DIR = resolve(__dirname, "../../docs/laila/snapshot-2026-08-07");
const snap = (f: string) => JSON.parse(readFileSync(resolve(DIR, f), "utf8"));
const S: Snapshot = { ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") };
const PROG = "aura-proof-p2";
const ms = (t: bigint) => (Number(process.hrtime.bigint() - t) / 1e6).toFixed(1);

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  for (const t of ["ledger_claims", "ledger_elements", "ledger_rename_intents"]) await pool.query(`delete from ${t} where program_id=$1`, [PROG]);
  await pool.query("delete from audit_events where program_id=$1", [PROG]);

  const mem = migrate(S);
  const led = new PgLedger(pool, PROG, "ledger-service");
  await led.persistFrom(mem);

  // ── 2.5 rename intent, durable ──
  console.log(`## 2.5 rename intent (durable old→new element id)`);
  await led.recordRenameIntent("el:entity:opportunity", "el:entity:deal", "vp-sales");
  await led.recordRenameIntent("el:entity:account", "el:entity:client-org", "cro");
  // read back through a SEPARATE pool (a fresh connection = a later session)
  const pool2 = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const rows = (await pool2.query("select old_element_id, new_element_id, by, at from ledger_rename_intents where program_id=$1 order by at", [PROG])).rows;
  await pool2.end();
  for (const r of rows) console.log(`  ${r.old_element_id} → ${r.new_element_id}  (by ${r.by}, at ${r.at ? "stamped" : "NULL"})`);
  console.log(`  durable rows read from a fresh connection: ${rows.length} — ${rows.length === 2 && rows.every((r) => r.at) ? "DURABLE" : "FAILED"}`);

  // ── 2.6 projections over the stored ledger + cost ──
  console.log(`\n## 2.6 projections over the STORED ledger (loadReadModel → sync projections)`);
  const t0 = process.hrtime.bigint();
  const rm = await led.loadReadModel();
  const loadMs = ms(t0);
  const time = <T>(f: () => T): [T, string] => { const t = process.hrtime.bigint(); const r = f(); return [r, ms(t)]; };
  const [uq, uqMs] = time(() => buildUnknownQueue(rm));
  const [kit, kitMs] = time(() => buildKitView(rm));
  const [ont, ontMs] = time(() => buildOntologyView(rm));
  const [atlas, atlasMs] = time(() => buildAtlasView(rm));
  const [dev, devMs] = time(() => buildDeviationRegister(rm));
  console.log(`  loadReadModel (955 claims / 310 elements): ${loadMs}ms`);
  console.log(`  buildUnknownQueue: ${uqMs}ms — ${uq.counts.total} unknowns (blocking ${uq.counts.blocking}, unowned ${uq.counts.unowned}, blocked ${uq.counts.blocked})`);
  console.log(`  buildKitView: ${kitMs}ms — ${kit.bands.length} bands, burn-down ${kit.burnDown.pctClosed}% closed`);
  console.log(`  buildOntologyView: ${ontMs}ms — ${ont.length} elements`);
  console.log(`  buildAtlasView: ${atlasMs}ms — ${atlas.length} workflows`);
  console.log(`  buildDeviationRegister: ${devMs}ms — ${dev.length} deviations`);

  // parity: the stored read model must project IDENTICALLY to the in-memory store
  const memQ = buildUnknownQueue(mem), memKit = buildKitView(mem);
  const parity = uq.counts.total === memQ.counts.total && kit.burnDown.closed === memKit.burnDown.closed && ont.length === buildOntologyView(mem).length;
  console.log(`  parity with in-memory projection (queue total, burn-down closed, element count): ${parity ? "IDENTICAL" : "DIVERGENT"}`);
  console.log(`    stored: queue=${uq.counts.total} closed=${kit.burnDown.closed} | memory: queue=${memQ.counts.total} closed=${memKit.burnDown.closed}`);

  // ── 2.7 honest heard-count ──
  console.log(`\n## 2.7 honest heard-count (attributed human closures, not machine imports)`);
  const reg = buildHeardRegister(rm);
  console.log(`  register (old, conflated) closed|weak total: ${reg.totalClosedOrWeak}`);
  console.log(`  register (honest) attributed-human heard total: ${reg.total}`);
  console.log(`  per area:`);
  for (const b of reg.byBand) console.log(`    ${b.band}: ${b.heard}`);
  const overstate = reg.totalClosedOrWeak - reg.total;
  console.log(`  the old register overstated "heard" by ${overstate} machine-import closures (${reg.totalClosedOrWeak} → ${reg.total}).`);

  await pool.end();
}
main().catch((e) => { console.error("PROOF2 FAILED:", e); process.exit(1); });
