// Deno runner (docs/aura/generator-report.md): generate claims-with-unknowns from
// REAL Laila source, validate at the boundary, write the batch for reconcile, and
// prove the validator rejects a malformed batch. Run:
//   deno run --allow-read --allow-write scripts/ledger/generate-claims.ts <out.json>
import { generateClaimsBatch, validateBatch, slotOf, type GeneratedBatch } from "../../supabase/functions/_shared/ledgerGenerator.ts";

const DIR = new URL("../../docs/laila/snapshot-2026-08-07/", import.meta.url);
const rd = async (f: string) => JSON.parse(await Deno.readTextFile(new URL(f, DIR)));
const outPath = Deno.args[0] ?? "/tmp/aura-generated-batch.json";

const source = { ontology: await rd("domain-ontology.json"), atlas: await rd("current-state-atlas.json") };

// ── generate against real Laila input ──
const batch: GeneratedBatch = generateClaimsBatch(source);
const v = validateBatch(batch);

console.log("# Generator — against real Laila source (deterministic; model content is Laila's artifacts)\n");
console.log(`elements: ${v.elementCount}  claims: ${v.claimCount}  unknown claims: ${v.unknownCount}`);
console.log(`validation: ${v.ok ? "PASS (batch conforms to the contract)" : "FAIL"}  errors: ${v.errors.length}`);

// unknown breakdown by slot — the "declared unknowns" inversion, shown concretely
const unkBySlot = new Map<string, number>();
for (const c of batch.claims) if (c.value.kind === "unknown") { const s = slotOf(c.about); unkBySlot.set(s, (unkBySlot.get(s) ?? 0) + 1); }
console.log(`\nunknowns by slot (what the generator declares it does NOT know):`);
for (const [s, n] of [...unkBySlot.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(22)} ${n}`);
const subst = batch.claims.filter((c) => c.value.kind !== "unknown").length;
console.log(`\nsubstantive claims: ${subst}  ·  declared unknowns: ${v.unknownCount}  ·  ratio unknown = ${(100 * v.unknownCount / v.claimCount).toFixed(0)}%`);
console.log(`sources present: ${[...new Set(batch.claims.map((c) => c.source))].join(", ")} (must be only 'generated')`);

// ── prove the validator rejects malformed output (the guard, not just acceptance) ──
console.log(`\n# Validator rejects a malformed batch (four contract violations injected)`);
const bad: GeneratedBatch = {
  elements: [{ id: "el:entity:widget", kind: "entity", name: "Widget" }, { id: "el:entity:MINTED-BY-MODEL", kind: "entity", name: "Ghost" }],
  claims: [
    { about: "el:entity:widget#definition", value: { kind: "scalar", value: "x" }, world: "to-be", layer: "domain", source: "asserted" as unknown as "generated", status: "weak", ownerWhileOpen: { kind: "role", role: "R" } }, // source ceiling
    { about: "el:entity:widget#exists", value: { kind: "scalar", value: true }, world: "to-be", layer: "domain", source: "generated", status: "closed", ownerWhileOpen: { kind: "role", role: "R" } }, // status coherence (closed)
    { about: "el:step:s1#touches.account", value: { kind: "scalar", value: "Account" }, world: "to-be", layer: "domain", source: "generated", status: "weak", ownerWhileOpen: { kind: "role", role: "R" } }, // reference shape (bare name)
    { about: "el:entity:widget#systemOfRecord", value: { kind: "unknown" }, world: "to-be", layer: "domain", source: "generated", status: "open", ownerWhileOpen: { kind: "role", role: "R" }, id: "cl:forbidden" } as unknown as GeneratedBatch["claims"][number], // forbidden key (minted id)
  ],
};
const bv = validateBatch(bad);
console.log(`  ok: ${bv.ok} (expected false); errors: ${bv.errors.length}`);
for (const e of bv.errors) console.log(`   ✗ [${e.code}] ${e.about ?? ""} — ${e.detail}`);
// Widget is missing definition? no — has definition+exists; missing systemOfRecord? present(unknown). missing nothing required for a partial demo, so slot-incomplete may or may not fire; the four injected violations are the point.

await Deno.writeTextFile(outPath, JSON.stringify(batch));
console.log(`\nwrote validated batch → ${outPath} (for the reconcile round)`);
if (!v.ok) { for (const e of v.errors.slice(0, 20)) console.log("  REAL-BATCH ERROR:", e.code, e.about, e.detail); Deno.exit(1); }
