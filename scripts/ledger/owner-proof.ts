/**
 * 2.4 owner fix — run into the DB, count STORED owner kinds and seams, compare to paper.
 * Paper prediction (docs/aura/ledger-write-model.md): ~24 unowned / ~60 joint / 8 seams,
 * Finance ⋈ Legal among them. Local Postgres only.
 */
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "../../src/v3/lib/ledger/migrate";
import { PgLedger } from "../../src/v3/lib/ledger/pgStore";

const DIR = resolve(__dirname, "../../docs/laila/snapshot-2026-08-07");
const snap = (f: string) => JSON.parse(readFileSync(resolve(DIR, f), "utf8"));
const S: Snapshot = { ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") };
const PROG = "aura-proof-owner";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  for (const t of ["ledger_claims", "ledger_elements"]) await pool.query(`delete from ${t} where program_id=$1`, [PROG]);
  await pool.query("delete from audit_events where program_id=$1", [PROG]);

  const mem = migrate(S);
  const led = new PgLedger(pool, PROG, "ledger-service");
  await led.persistFrom(mem);

  const total = (await pool.query("select count(*)::int n from ledger_claims where program_id=$1", [PROG])).rows[0].n;
  const byKind = (await pool.query("select owner->>'kind' k, count(*)::int n from ledger_claims where program_id=$1 group by 1 order by 2 desc", [PROG])).rows;
  const seams = (await pool.query(
    `select owner->>'a' a, owner->>'b' b, count(*)::int n from ledger_claims
     where program_id=$1 and owner->>'kind'='joint' group by 1,2 order by 3 desc`, [PROG])).rows;

  console.log(`## 2.4 owner fix — STORED numbers (program ${PROG})`);
  console.log(`total claims: ${total}`);
  for (const r of byKind) console.log(`  owner.kind=${r.k}: ${r.n}`);
  const unowned = byKind.find((r) => r.k === "unowned")?.n ?? 0;
  const joint = byKind.find((r) => r.k === "joint")?.n ?? 0;
  console.log(`\ndistinct seams: ${seams.length}`);
  for (const r of seams) console.log(`  ${r.a} ⋈ ${r.b}: ${r.n} claim(s)`);
  const financeLeg = seams.some((r) => [r.a, r.b].sort().join("|") === "Finance|Legal");

  console.log(`\n## paper vs stored`);
  console.log(`  unowned: paper ~24 | stored ${unowned}`);
  console.log(`  joint:   paper ~60 | stored ${joint}`);
  console.log(`  seams:   paper 8   | stored ${seams.length}`);
  console.log(`  Finance ⋈ Legal present: ${financeLeg ? "YES" : "NO"}`);

  await pool.end();
}
main().catch((e) => { console.error("OWNER PROOF FAILED:", e); process.exit(1); });
