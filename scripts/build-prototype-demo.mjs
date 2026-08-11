/**
 * Regenerate public/prototype-assembled.html from Laila's committed ontology+atlas
 * snapshot, so the assembled-prototype demo can't drift from the modules. Run:
 *   npx esbuild supabase/functions/_shared/prototypeAssembly.ts --bundle --format=esm --outfile=.tmp-assemble.mjs
 *   node scripts/build-prototype-demo.mjs && rm .tmp-assemble.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { assemblePrototype } from "../.tmp-assemble.mjs";

const snap = (f) => JSON.parse(readFileSync(new URL(`../docs/laila/snapshot-2026-08-07/${f}`, import.meta.url), "utf8"));
const out = assemblePrototype(snap("domain-ontology.json"), snap("current-state-atlas.json"));
writeFileSync(new URL("../public/prototype-assembled.html", import.meta.url), out.html);
console.log(`wrote public/prototype-assembled.html — ${out.html.length} bytes, ${out.regionCount} regions, ${out.fabric.nodes.length} fabric nodes, version ${out.fabric.version}`);
