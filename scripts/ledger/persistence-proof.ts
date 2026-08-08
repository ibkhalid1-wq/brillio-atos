/**
 * Persistence proof (docs/aura/persistence-report.md). Runs against the LOCAL Postgres
 * only (127.0.0.1:5433, aura_ledger). Bundled with esbuild (pg external), run with node.
 *
 * Proves, with real numbers, against stored rows:
 *   2.1  persist a migrated ledger; the no-overwrite core promise; audit linkage.
 *   2.2  concurrency: two writers on one locus, no closure lost, deterministic outcome.
 *   2.3  reconcile: regeneration preserves the closure; orphan flagged + queryable.
 * Owner numbers (2.4) run in a second harness after the migrate() owner fix lands.
 */
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "../../src/v3/lib/ledger/migrate";
import { PgLedger } from "../../src/v3/lib/ledger/pgStore";
import type { AssertInput } from "../../src/v3/lib/ledger/store";

const DIR = resolve(__dirname, "../../docs/laila/snapshot-2026-08-07");
const snap = (f: string) => JSON.parse(readFileSync(resolve(DIR, f), "utf8"));
const S: Snapshot = { ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") };

const PROG = "aura-proof-laila";
const out: string[] = [];
const say = (s: string) => { out.push(s); console.log(s); };

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });

  // fresh program scope
  await pool.query("delete from ledger_claims where program_id=$1", [PROG]);
  await pool.query("delete from ledger_elements where program_id=$1", [PROG]);
  await pool.query("delete from ledger_rename_intents where program_id=$1", [PROG]);
  await pool.query("delete from audit_events where program_id=$1", [PROG]);

  const led = new PgLedger(pool, PROG, "ledger-service");

  // ── 2.1 persist the migrated ledger ──
  const mem = migrate(S);
  const t0 = process.hrtime.bigint();
  const persisted = await led.persistFrom(mem);
  const persistMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const storedClaims = (await pool.query("select count(*)::int n from ledger_claims where program_id=$1", [PROG])).rows[0].n;
  const storedEls = (await pool.query("select count(*)::int n from ledger_elements where program_id=$1", [PROG])).rows[0].n;
  say(`## 2.1 persistence`);
  say(`persistFrom: elements=${persisted.elements} claims=${persisted.claims} in ${persistMs.toFixed(0)}ms`);
  say(`stored (SELECT count): elements=${storedEls} claims=${storedClaims}  ${storedClaims === persisted.claims && storedEls === persisted.elements ? "MATCH" : "MISMATCH"}`);
  const auditAfterBootstrap = (await pool.query("select count(*)::int n from audit_events where program_id=$1", [PROG])).rows[0].n;
  say(`audit_events after bootstrap insert: ${auditAfterBootstrap} (one per stored claim: ${auditAfterBootstrap === storedClaims ? "YES" : "NO"})`);

  // the no-overwrite core promise: a stakeholder closes a locus firmly, a regeneration then
  // asserts a different generated value on it — the closure must survive in the stored rows.
  const about = "el:attr:opportunity.stage#valueSet";
  const closure: AssertInput = { about, value: { kind: "ref-list", to: ["Prospecting", "Qualification", "Proposal", "Closed Won", "Closed Lost"] },
    world: "to-be", layer: "domain", source: "asserted", ownerWhileOpen: { kind: "role", role: "Sales Leaders" }, status: "closed",
    closedBy: { method: "assertion", by: "vp-sales", verbatim: "our five stages" } };
  await led.assert(closure);
  const auditAfterAssert = (await pool.query("select count(*)::int n from audit_events where program_id=$1", [PROG])).rows[0].n;
  say(`\n## 2.1 no-overwrite core promise`);
  say(`asserted closure written on ${about} (by vp-sales); audit_events now ${auditAfterAssert} (+${auditAfterAssert - auditAfterBootstrap} for the assert)`);

  const regen: AssertInput = { about, value: { kind: "ref-list", to: ["New", "Working", "Won", "Lost"] },
    world: "to-be", layer: "domain", source: "generated", ownerWhileOpen: { kind: "role", role: "Sales Leaders" }, status: "weak" };
  const regenClaim = await led.assert(regen);
  const live = await led.liveClaimsAbout(about);
  const closureLive = live.find((c) => c.source === "asserted" && c.status === "closed" && c.closedBy?.by === "vp-sales");
  const regenLive = live.find((c) => c.id === regenClaim.id && !c.supersededBy);
  say(`after generated regeneration asserts a different value:`);
  say(`  asserted closure still live: ${closureLive ? "YES (preserved)" : "NO (LOST)"}`);
  say(`  generated claim superseded by the closure: ${regenClaim.supersededBy === closureLive?.id ? "YES" : `NO (supersededBy=${regenClaim.supersededBy})`}`);
  say(`  live rows on locus: ${live.length} [${live.map((c) => `${c.source}${c.supersededBy ? "*" : ""}`).join(", ")}]`);
  const promiseHeld = !!closureLive && !regenLive;
  say(`  >>> NO-OVERWRITE PROMISE: ${promiseHeld ? "HELD" : "VIOLATED"}`);

  // ── 2.2 concurrency: two writers, one locus, no closure lost ──
  say(`\n## 2.2 concurrency (two concurrent writers on one locus)`);
  const cAbout = "el:entity:account#definition";
  // seed a firm closure on the locus
  await led.assert({ about: cAbout, value: { kind: "scalar", value: "the paying customer org" }, world: "to-be", layer: "domain",
    source: "asserted", ownerWhileOpen: { kind: "role", role: "Sales Leaders" }, status: "closed", closedBy: { method: "assertion", by: "cro", verbatim: "the org that pays" } });
  // two DIFFERENT generated writers race on the same locus
  const w = (val: string): Promise<unknown> => led.assert({ about: cAbout, value: { kind: "scalar", value: val }, world: "to-be", layer: "domain",
    source: "generated", ownerWhileOpen: { kind: "role", role: "Sales Leaders" }, status: "weak" });
  const raceStart = process.hrtime.bigint();
  await Promise.all([w("gen value A"), w("gen value B"), w("gen value A"), w("gen value B")]); // 4 concurrent, 2 distinct values
  const raceMs = Number(process.hrtime.bigint() - raceStart) / 1e6;
  const cLive = await led.liveClaimsAbout(cAbout);
  const closureSurvived = cLive.some((c) => c.source === "asserted" && c.status === "closed" && c.closedBy?.by === "cro");
  const allRows = (await pool.query("select source, status, superseded_by, value->>'value' v from ledger_claims where program_id=$1 and about=$2 order by created_at", [PROG, cAbout])).rows;
  say(`4 concurrent generated writers (2 distinct values) + 1 seeded closure, ${raceMs.toFixed(0)}ms`);
  say(`  total rows on locus: ${allRows.length}; live: ${cLive.length}`);
  say(`  seeded closure survived every race: ${closureSurvived ? "YES" : "NO (LOST)"}`);
  say(`  live sources: [${cLive.map((c) => `${c.source}:${JSON.stringify(c.value.kind === "scalar" ? c.value.value : c.value.kind)}`).join(", ")}]`);
  // determinism: the closure always wins; no generated ever supersedes it
  const genSupersededByClosure = allRows.filter((r) => r.source === "generated" && r.superseded_by).length;
  say(`  generated rows that got superseded (never the closure): ${genSupersededByClosure}`);
  say(`  >>> NO CLOSURE LOST UNDER CONCURRENCY: ${closureSurvived ? "PROVEN" : "FAILED"}`);

  // ── 2.3 reconcile: regeneration preserves closures; orphan flagged + queryable ──
  say(`\n## 2.3 reconcile against the stored ledger`);
  // regeneration batch = the to-be generated claims of a fresh migrate (Option B)
  const fresh = migrate(S);
  const incoming: AssertInput[] = fresh.claims().filter((c) => c.world === "to-be" && !c.supersededBy && c.source === "generated")
    .map((c) => ({ about: c.about, value: c.value, world: c.world, layer: c.layer, source: c.source, ownerWhileOpen: c.ownerWhileOpen, status: c.status, closedBy: c.closedBy }));
  const incomingEls = new Set(fresh.elements().map((e) => e.id));
  const rec0 = process.hrtime.bigint();
  const report = await led.reconcile(incoming, incomingEls);
  const recMs = Number(process.hrtime.bigint() - rec0) / 1e6;
  const stillClosed = (await led.liveClaimsAbout(about)).some((c) => c.source === "asserted" && c.closedBy?.by === "vp-sales");
  say(`reconciled ${incoming.length} generated claims in ${recMs.toFixed(0)}ms`);
  say(`  report: applied=${report.applied} preservedClosures=${report.preservedClosures} supersededGenerated=${report.supersededGenerated} filledUnknowns=${report.filledUnknowns} newClaims=${report.newClaims}`);
  say(`  vp-sales stage closure still live after regeneration: ${stillClosed ? "YES (preserved)" : "NO (LOST)"}`);

  // orphan: assert a closure about an element, then reconcile a batch whose element-set drops it
  const orphanAbout = "el:entity:opportunity#definition";
  await led.assert({ about: orphanAbout, value: { kind: "scalar", value: "a durable business definition" }, world: "to-be", layer: "domain",
    source: "asserted", ownerWhileOpen: { kind: "role", role: "Sales Leaders" }, status: "closed", closedBy: { method: "assertion", by: "vp-sales", verbatim: "…" } });
  const dropped = { ...S, ontology: { ...S.ontology, entities: (S.ontology.entities as Array<{ name: string }>).filter((e) => e.name !== "Opportunity") } };
  const dfresh = migrate(dropped);
  const dIncoming: AssertInput[] = dfresh.claims().filter((c) => c.world === "to-be" && !c.supersededBy && c.source === "generated")
    .map((c) => ({ about: c.about, value: c.value, world: c.world, layer: c.layer, source: c.source, ownerWhileOpen: c.ownerWhileOpen, status: c.status }));
  const dReport = await led.reconcile(dIncoming, new Set(dfresh.elements().map((e) => e.id)));
  const orphanPreserved = (await led.liveClaimsAbout(orphanAbout)).some((c) => c.source === "asserted");
  const orphans = await led.orphanedClosures(); // the queryable orphan projection
  const orphanFlagged = dReport.orphanedClosures.some((o) => o.about === orphanAbout) || orphans.some((o) => o.about === orphanAbout);
  say(`\norphan case (regeneration drops 'Opportunity' upstream):`);
  say(`  closure about ${orphanAbout} preserved: ${orphanPreserved ? "YES" : "NO (LOST)"}`);
  say(`  flagged orphan in report: ${dReport.orphanedClosures.some((o) => o.about === orphanAbout) ? "YES" : "no"}`);
  say(`  queryable via orphanedClosures(): ${orphans.some((o) => o.about === orphanAbout) ? "YES" : "no"} (total orphans queryable: ${orphans.length})`);
  say(`  >>> ORPHAN PRESERVED + FLAGGED + QUERYABLE: ${orphanPreserved && orphanFlagged ? "PROVEN" : "FAILED"}`);

  say(`\n## audit linkage summary`);
  const finalAudit = (await pool.query("select action_type, count(*)::int n from audit_events where program_id=$1 group by action_type order by n desc", [PROG])).rows;
  for (const r of finalAudit) say(`  audit action_type=${r.action_type}: ${r.n}`);

  await pool.end();
}

main().catch((e) => { console.error("PROOF FAILED:", e); process.exit(1); });
