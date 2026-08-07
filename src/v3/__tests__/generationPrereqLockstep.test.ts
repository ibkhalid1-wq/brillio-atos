/**
 * Client ↔ edge lockstep — the Generate-button prerequisite gate must never
 * silently disagree with the edge's artifact dependency graph.
 *
 * The Line's `GENERATION_PREREQS` (src/v3/lib/lineModel.ts) decides when a tile
 * OFFERS Generate: an absent artifact whose upstream inputs are present. The
 * edge's `UPSTREAM_ARTIFACT_DEPS` (supabase/functions/run-agent/index.ts)
 * declares which upstream BODIES a generator injects for grounding. These are
 * DIFFERENT relations — the edge map is a superset (it injects transitively
 * useful context; the client gates on the minimal input) — so they are NOT
 * asserted equal.
 *
 * Why not a single shared module (the task's preferred option): the edge is a
 * Deno module (Deno globals, ~11k lines) that cannot be imported into the Vite
 * client bundle or a vitest run. This is the same boundary every other
 * client↔edge contract lives across — see edgeLockstep.test.ts, which likewise
 * parses the edge source as text. So the fallback: assert the client gate is a
 * SUBGRAPH of the edge's dependency DAG (every client prerequisite is a real
 * upstream dependency the edge recognises), which catches the drift that
 * matters — a dependency the edge removed or reversed while the Line still
 * gates on it.
 *
 * Two divergences are intentional and safe, listed explicitly below so a NEW
 * divergence fails while these stay green:
 *  - demo-scripts gates on the prototype (a client UX choice: Validation is
 *    where clients meet the BUILT prototype). Stricter than the edge, which can
 *    write demo scripts off the blueprint — stricter can only DELAY the offer,
 *    never offer too early, so it cannot mislead.
 *  - runbook / benefits-tracker / optimization-backlog have no edge
 *    UPSTREAM_ARTIFACT_DEPS entry (they route to a generic phase agent); the
 *    Line gates them on the blueprint as a methodological proxy.
 *
 * No DB, no network — pure source scan.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GENERATION_PREREQS } from "@/v3/lib/lineModel";
import { FORMAL_ARTIFACT_FIELD_KEYS } from "@/v3/lib/formalArtifacts";

const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");

/** Parse the edge's `UPSTREAM_ARTIFACT_DEPS` object (keyed by camelCase fieldKey). */
function parseEdgeDeps(): Record<string, string[]> {
  const block = EDGE.match(/UPSTREAM_ARTIFACT_DEPS[^=]*=\s*\{([\s\S]*?)\n\};/);
  expect(block, "UPSTREAM_ARTIFACT_DEPS not found in run-agent/index.ts").toBeTruthy();
  const out: Record<string, string[]> = {};
  for (const line of block![1].matchAll(/\n\s*([A-Za-z]+)\s*:\s*\[([^\]]*)\]/g)) {
    out[line[1]] = [...line[2].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  }
  return out;
}

/** Transitive dependency closure of a fieldKey in the edge DAG. */
function edgeClosure(deps: Record<string, string[]>, key: string): Set<string> {
  const seen = new Set<string>();
  const walk = (k: string) => {
    for (const d of deps[k] ?? []) if (!seen.has(d)) { seen.add(d); walk(d); }
  };
  walk(key);
  return seen;
}

// Client artifacts with no edge dependency entry — Line-only methodological
// proxy gate, not checked against the edge (documented above).
const EDGE_UNMAPPED = new Set(["runbook", "benefits-tracker", "optimization-backlog"]);

// Intentional client-stricter gates: { clientArtifactId: the prereq group that
// diverges }. Safe because stricter only delays the offer. Reviewed here.
const CLIENT_STRICTER: Record<string, string[]> = {
  "demo-scripts": ["prototype-build", "prototype-pack"],
};

const fieldKey = (id: string): string | undefined => FORMAL_ARTIFACT_FIELD_KEYS[id];
const groupEq = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

describe("Generate-button prerequisites stay a subgraph of the edge dependency DAG", () => {
  const edgeDeps = parseEdgeDeps();

  it("the edge map parsed and carries the known artifact keys", () => {
    expect(Object.keys(edgeDeps).length).toBeGreaterThan(8);
    expect(edgeDeps.domainOntology).toContain("discoveryKit");
  });

  it("every client prerequisite is a real upstream dependency the edge recognises", () => {
    const offenders: string[] = [];
    for (const [artifact, groups] of Object.entries(GENERATION_PREREQS)) {
      if (EDGE_UNMAPPED.has(artifact)) continue;
      const yKey = fieldKey(artifact);
      if (!yKey || !edgeDeps[yKey]) {
        offenders.push(`${artifact}: no edge dependency entry (add to EDGE_UNMAPPED if intentional)`);
        continue;
      }
      const closure = edgeClosure(edgeDeps, yKey);
      for (const group of groups) {
        if (CLIENT_STRICTER[artifact] && groupEq(group, CLIENT_STRICTER[artifact])) continue; // documented divergence
        const satisfiable = group.some((dep) => {
          const dKey = fieldKey(dep);
          return dKey && closure.has(dKey);
        });
        if (!satisfiable) {
          offenders.push(`${artifact} requires [${group.join(" | ")}], but the edge lists none of them upstream of ${artifact}`);
        }
      }
    }
    expect(offenders, `\nClient Generate gate diverged from the edge DAG:\n${offenders.join("\n")}\n`).toEqual([]);
  });

  it("no client prerequisite is DOWNSTREAM of its artifact in the edge DAG (no reversal)", () => {
    const reversals: string[] = [];
    for (const [artifact, groups] of Object.entries(GENERATION_PREREQS)) {
      const yKey = fieldKey(artifact);
      if (!yKey) continue;
      for (const group of groups) {
        for (const dep of group) {
          const dKey = fieldKey(dep);
          if (!dKey || !edgeDeps[dKey]) continue;
          // If the edge says the *prerequisite* depends on the artifact, the
          // client has the arrow backwards.
          if (edgeClosure(edgeDeps, dKey).has(yKey)) {
            reversals.push(`${artifact} gates on ${dep}, but the edge makes ${dep} depend on ${artifact}`);
          }
        }
      }
    }
    expect(reversals, `\nReversed dependency between client gate and edge DAG:\n${reversals.join("\n")}\n`).toEqual([]);
  });

  it("the documented divergences still exist (else remove them from the exception lists)", () => {
    // demo-scripts must still gate on the prototype, else CLIENT_STRICTER is stale.
    expect(GENERATION_PREREQS["demo-scripts"]?.some((g) => groupEq(g, CLIENT_STRICTER["demo-scripts"]))).toBe(true);
    // EDGE_UNMAPPED artifacts must still be absent from the edge dep map.
    for (const id of EDGE_UNMAPPED) {
      const k = fieldKey(id);
      if (k) expect(edgeDeps[k], `${id} now HAS an edge dep entry — drop it from EDGE_UNMAPPED and gate it against the edge`).toBeUndefined();
    }
  });
});
