/**
 * Lockstep guard: the generator's contentId copy (supabase/functions/_shared, kept
 * as a copy because the edge is self-contained and imports nothing from src/) MUST
 * stay byte-identical to the store's contentId (src/v3/lib/ledger/types.ts). Proven
 * two ways: (a) the two functions agree on sampled inputs; (b) generator step element
 * ids == migrate/store step ids on real Laila. Exits non-zero on any drift → CI-usable.
 *   Build+run: esbuild --bundle → node .   (see any scripts/ledger proof harness)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contentId as storeCid } from "../../src/v3/lib/ledger/types";
import { contentId as genCid, slug } from "../../supabase/functions/_shared/ledgerGenerator";
import { migrate, type Snapshot } from "../../src/v3/lib/ledger/migrate";
import { generateClaimsBatch } from "../../supabase/functions/_shared/ledgerGenerator";

const DIR = resolve(__dirname, "../../docs/laila/snapshot-2026-08-07");
const rd = (f: string) => JSON.parse(readFileSync(resolve(DIR, f), "utf8"));
const S: Snapshot = { ontology: rd("domain-ontology.json"), atlas: rd("current-state-atlas.json"), overrides: rd("operator-overrides.json") };

// (a) function-level parity on sampled inputs
const samples: unknown[][] = [["a", "b", "c"], ["el:wf:x", "Marketing", "do a thing"], [""], ["one\x01two", { k: 1 }]];
let fnMismatch = 0;
for (const parts of samples) if (storeCid("p", ...parts) !== genCid("p", ...parts)) fnMismatch += 1;
console.log(`(a) contentId agrees on ${samples.length - fnMismatch}/${samples.length} sampled inputs`);

// (b) generator step ids == store/migrate step ids on real Laila
const migSteps = new Set(migrate(S).elements().filter((e) => e.kind === "step").map((e) => e.id));
const genSteps = new Set(generateClaimsBatch({ ontology: S.ontology, atlas: S.atlas }).elements.filter((e) => e.kind === "step").map((e) => e.id));
const shared = [...migSteps].filter((id) => genSteps.has(id)).length;
console.log(`(b) steps — migrate ${migSteps.size} · generator ${genSteps.size} · SHARED ${shared}`);
void slug;

const ok = fnMismatch === 0 && shared === migSteps.size && shared === genSteps.size && migSteps.size > 0;
console.log(ok ? "PASS — contentId in lockstep; every step id matches the store" : "**FAIL** — contentId drift");
if (!ok) process.exit(1);
