/**
 * Collision-completeness audit (docs/aura/collision-audit.md) — RUNTIME half.
 * Loads TWO programs into the same local DB sharing one contentId key space (both
 * migrated from Laila, so identical ids/abouts) and proves isolation. Additive test
 * data only (programs `audit-A` / `audit-B`), cleaned at the end; touches no other
 * program's stored ledger. READ-ONLY on the existing data.
 */
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "../../src/v3/lib/ledger/migrate";
import { PgLedger } from "../../src/v3/lib/ledger/pgStore";
import { buildOntologyView } from "../../src/v3/lib/ledger/projections";
import type { AssertInput } from "../../src/v3/lib/ledger/store";

const DIR = resolve(__dirname, "../../docs/laila/snapshot-2026-08-07");
const snap = (f: string) => JSON.parse(readFileSync(resolve(DIR, f), "utf8"));
const S: Snapshot = { ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") };
const A = "audit-A", B = "audit-B";
const ok = (b: boolean) => (b ? "PASS" : "FAIL");

async function checksum(pool: Pool, prog: string): Promise<string> {
  // deterministic content fingerprint of a program's entire ledger — claims AND elements
  // (order-independent), so the reconcile-isolation test also covers the element writes.
  const r = await pool.query(
    `select md5(coalesce(string_agg(t.line, '|' order by t.line), '')) h from (
       select id||':'||about||':'||world||':'||source||':'||status||':'||coalesce(superseded_by,'')||':'||value::text||':'||owner::text line
       from ledger_claims where program_id=$1
       union all
       select 'E:'||id||':'||kind||':'||name||':'||coalesce(of,'')||':'||dropped::text||':'||refs::text
       from ledger_elements where program_id=$1) t`, [prog]);
  return r.rows[0].h ?? "(empty)";
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
  for (const p of [A, B]) for (const t of ["ledger_claims", "ledger_elements", "ledger_rename_intents"]) await pool.query(`delete from ${t} where program_id=$1`, [p]);
  for (const p of [A, B]) await pool.query("delete from audit_events where program_id=$1", [p]);

  const mem = migrate(S);
  const ledA = new PgLedger(pool, A, "svc-A"), ledB = new PgLedger(pool, B, "svc-B");

  // ── 1. both programs persist fully; neither swallowed by the shared key space ──
  console.log("## 1. row counts per program (shared contentId key space)");
  const pa = await ledA.persistFrom(mem), pb = await ledB.persistFrom(mem);
  const cnt = async (p: string) => (await pool.query("select count(*)::int n from ledger_claims where program_id=$1", [p])).rows[0].n;
  const na = await cnt(A), nb = await cnt(B), total = (await pool.query("select count(*)::int n from ledger_claims where program_id in ($1,$2)", [A, B])).rows[0].n;
  console.log(`  A stored ${na}/${pa.claims}, B stored ${nb}/${pb.claims}, A+B total ${total}`);
  console.log(`  neither swallowed (both 955, total 1910): ${ok(na === 955 && nb === 955 && total === 1910)}`);
  // sanity: the ids ARE shared (collision condition present, not avoided)
  const shared = (await pool.query("select count(*)::int n from ledger_claims a join ledger_claims b on a.id=b.id and a.program_id=$1 and b.program_id=$2", [A, B])).rows[0].n;
  console.log(`  shared claim ids across A and B (the collision condition): ${shared} (expected 955)`);

  // ── 2. detectable marker: a B-only locus must never appear in A's projection ──
  console.log("\n## 2. cross-program projection isolation (detectable marker)");
  const markerAbout = "el:entity:zzz-b-only#definition";
  await ledB.assert({ about: markerAbout, value: { kind: "scalar", value: "B-ONLY MARKER" }, world: "to-be", layer: "domain", source: "asserted", ownerWhileOpen: { kind: "role", role: "R" }, status: "closed", closedBy: { method: "assertion", by: "b-user", verbatim: "marker" } });
  const rmA = await ledA.loadReadModel(), rmB = await ledB.loadReadModel();
  const aHasMarker = rmA.claims().some((x) => x.about === markerAbout);
  const bHasMarker = rmB.claims().some((x) => x.about === markerAbout);
  const ontA = buildOntologyView(rmA);
  const aClaimCount = rmA.claims().length, bClaimCount = rmB.claims().length;
  console.log(`  A read-model claims ${aClaimCount}, B read-model claims ${bClaimCount}`);
  console.log(`  B-only marker present in B: ${ok(bHasMarker)}; ABSENT from A: ${ok(!aHasMarker)}`);
  console.log(`  A ontology view element count: ${ontA.length} (unchanged by B's marker)`);

  // ── 3. same-locus, SAME-VALUE closure in both programs → identical contentId, two rows ──
  console.log("\n## 3. same-locus same-value closure in A and B (identical contentId)");
  const locus = "el:attr:opportunity.stage#valueSet";
  const closure = (by: string): AssertInput => ({ about: locus, value: { kind: "ref-list", to: ["S1", "S2", "S3"] }, world: "to-be", layer: "domain", source: "asserted", ownerWhileOpen: { kind: "role", role: "Sales Leaders" }, status: "closed", closedBy: { method: "assertion", by, verbatim: "the stages" } });
  const wA = await ledA.assert(closure("vp-A"));
  const wB = await ledB.assert(closure("vp-B"));
  console.log(`  A closure id ${wA.id} === B closure id ${wB.id}: ${ok(wA.id === wB.id)} (same contentId — collision condition)`);
  const rows = (await pool.query("select program_id, closed_by->>'by' by from ledger_claims where id=$1 and about=$2 order by program_id", [wA.id, locus])).rows;
  console.log(`  rows with that id: ${rows.length} — ${rows.map((r) => `${r.program_id}:${r.by}`).join(", ")}`);
  const aLive = await ledA.liveClaimsAbout(locus), bLive = await ledB.liveClaimsAbout(locus);
  const aBy = aLive.find((x) => x.source === "asserted")?.closedBy?.by, bBy = bLive.find((x) => x.source === "asserted")?.closedBy?.by;
  console.log(`  A live closure by ${aBy}; B live closure by ${bBy}: ${ok(aBy === "vp-A" && bBy === "vp-B")} (no cross-contamination)`);
  console.log(`  two distinct rows for one contentId, one per program: ${ok(rows.length === 2)}`);

  // ── 4. reconcile on A leaves B byte-unchanged ──
  console.log("\n## 4. reconcile isolation (A regenerates; B must be byte-unchanged)");
  const bBefore = await checksum(pool, B);
  const fresh = migrate(S);
  const incoming: AssertInput[] = fresh.claims().filter((x) => x.world === "to-be" && !x.supersededBy && x.source === "generated")
    .map((x) => ({ about: x.about, value: x.value, world: x.world, layer: x.layer, source: x.source, ownerWhileOpen: x.ownerWhileOpen, status: x.status }));
  const rep = await ledA.reconcile(incoming, fresh.elements());
  const bAfter = await checksum(pool, B);
  console.log(`  reconcile(A) applied ${rep.applied}; B checksum before===after: ${ok(bBefore === bAfter)}`);
  console.log(`    B ${bBefore.slice(0, 12)} → ${bAfter.slice(0, 12)}`);

  // ── 5. audit linkage: every audit row attributed to the correct program ──
  console.log("\n## 5. audit linkage isolation");
  const aud = (await pool.query("select program_id, count(*)::int n from audit_events where program_id in ($1,$2) group by 1 order by 1", [A, B])).rows;
  for (const r of aud) console.log(`  audit_events program_id=${r.program_id}: ${r.n}`);
  const leak = (await pool.query(
    `select count(*)::int n from audit_events e where e.program_id=$1
       and not exists (select 1 from ledger_claims lc where lc.program_id=$1 and lc.id = e.row_pk)`, [A])).rows[0].n;
  const bWrongProg = (await pool.query("select count(*)::int n from audit_events where program_id=$1 and table_name<>'ledger_claims'", [B])).rows[0].n;
  console.log(`  A audit rows whose row_pk is NOT an A claim (cross-program mis-attribution): ${leak} — ${ok(leak === 0)}`);
  console.log(`  B audit rows not from ledger_claims: ${bWrongProg} — ${ok(bWrongProg === 0)}`);

  // cleanup (leave the DB as found)
  for (const p of [A, B]) for (const t of ["ledger_claims", "ledger_elements", "ledger_rename_intents"]) await pool.query(`delete from ${t} where program_id=$1`, [p]);
  for (const p of [A, B]) await pool.query("delete from audit_events where program_id=$1", [p]);
  console.log("\n(cleaned: test programs audit-A / audit-B removed)");
  await pool.end();
}
main().catch((e) => { console.error("AUDIT HARNESS FAILED:", e); process.exit(1); });
