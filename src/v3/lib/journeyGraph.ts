/**
 * Journey derivation — the lifecycle axis (docs/aura/the-lifecycle-axis).
 *
 * The atlas has one dimension (workflows grouped by area). The SECOND dimension
 * is the cross-entity lifecycle already latent in the ontology's relations:
 * `Lead produces Opportunity produces Contract produces SOW …`. This module
 * traverses that relation graph DETERMINISTICALLY and reports the candidate
 * journeys — it does NOT pick one, because an ontology holds several overlapping
 * chains (customer / quote / engagement lifecycles) and which is primary is an
 * engagement-level choice, not something to guess.
 *
 * HONESTY about the verb: on Laila 34 of 35 relations use the generic `produces`
 * verb. That makes the graph uniformly traversable but semantically THIN — the
 * verb cannot distinguish "Opportunity ADVANCES TO Contract" (lifecycle) from
 * "Opportunity HAS MANY Quotes" (sub-record). So a `produces` fork is reported as
 * a fork, not silently resolved; the fan-out is a finding, not noise.
 *
 * Pure, deterministic, no model call, read-only over the ontology. Same ontology
 * in → same journeys out (tested).
 */

export interface Fork { entity: string; children: string[]; }
export interface CandidateJourney {
  path: string[];
  length: number;
  terminal: "sink" | "cycle";
  /** product of root→node and node→sink path counts summed over the path — how
   *  "trunk" this chain is (high = passes through the busiest nodes). */
  trunkWeight: number;
}
export interface PhaseBand {
  depth: number;
  entities: string[];
  /** the highest-participation entity in the band — a label, derived not asserted. */
  headline: string;
}
export interface JourneyGraph {
  verb: { produces: number; other: number; total: number; otherVerbs: Record<string, number> };
  roots: string[];
  sinks: string[];
  orphans: string[];           // entities on no forward (produces) edge at all
  forks: Fork[];               // out-degree > 1 — an ambiguous branch
  cycles: string[][];          // back-edges found (empty on a clean DAG)
  candidateJourneys: CandidateJourney[]; // ranked, capped at MAX_JOURNEYS
  totalMaximalPaths: number;   // exact count (DP), even when candidateJourneys is capped
  trunk: string[];             // entities by participation desc — the spine
  phases: PhaseBand[];         // topological depth bands = the derived vertical axis
  entityPhase: Record<string, number>; // on-chain entity name → depth
  maxDepth: number;
  truncated: boolean;          // true if enumeration hit MAX_JOURNEYS
}

const MAX_JOURNEYS = 60;       // cap on enumerated display paths (count is exact via DP)
const FORWARD_VERB = "produces";

const nm = (s: unknown): string => String(s ?? "").trim();

export function deriveJourneys(ontology: Record<string, unknown>): JourneyGraph {
  const entities = (Array.isArray(ontology.entities) ? ontology.entities : []) as Array<Record<string, unknown>>;
  const relations = (Array.isArray(ontology.relations) ? ontology.relations : []) as Array<Record<string, unknown>>;
  const names = entities.map((e) => nm(e.name)).filter(Boolean);
  const nameSet = new Set(names);

  // forward (lifecycle) edges = the `produces` verb only. Membership verbs like
  // "is part of" (N:1) are aggregation, not progression — excluded from the axis.
  const otherVerbs: Record<string, number> = {};
  let producesCount = 0;
  const fwd = new Map<string, string[]>();      // parent → ordered children
  const preds = new Map<string, string[]>();    // child → parents
  for (const n of names) { fwd.set(n, []); preds.set(n, []); }
  for (const r of relations) {
    const verb = nm(r.relation).toLowerCase();
    const from = nm(r.from), to = nm(r.to);
    if (verb === FORWARD_VERB) {
      producesCount += 1;
      if (nameSet.has(from) && nameSet.has(to) && from !== to) {
        if (!fwd.get(from)!.includes(to)) fwd.get(from)!.push(to);
        if (!preds.get(to)!.includes(from)) preds.get(to)!.push(from);
      }
    } else if (verb) {
      otherVerbs[verb] = (otherVerbs[verb] ?? 0) + 1;
    }
  }
  // deterministic neighbour order
  for (const n of names) { fwd.get(n)!.sort(); preds.get(n)!.sort(); }

  const outDeg = (n: string) => fwd.get(n)!.length;
  const inDeg = (n: string) => preds.get(n)!.length;

  const roots = names.filter((n) => inDeg(n) === 0 && outDeg(n) > 0).sort();
  const sinks = names.filter((n) => outDeg(n) === 0 && inDeg(n) > 0).sort();
  const orphans = names.filter((n) => inDeg(n) === 0 && outDeg(n) === 0).sort();
  const forks: Fork[] = names.filter((n) => outDeg(n) > 1).sort().map((entity) => ({ entity, children: [...fwd.get(entity)!] }));

  // ── topological order (Kahn, alphabetical tiebreak). Nodes never emitted are in cycles. ──
  const indegLive = new Map(names.map((n) => [n, inDeg(n)] as const));
  const ready = names.filter((n) => indegLive.get(n) === 0).sort();
  const topo: string[] = [];
  const emitted = new Set<string>();
  while (ready.length) {
    const n = ready.shift()!;
    if (emitted.has(n)) continue;
    topo.push(n); emitted.add(n);
    for (const c of fwd.get(n)!) {
      indegLive.set(c, (indegLive.get(c) ?? 1) - 1);
      if (indegLive.get(c) === 0 && !emitted.has(c)) { ready.push(c); ready.sort(); }
    }
  }
  // cycle members: any on-chain node not emitted. Report the back-edges as 2-cycles-ish.
  const cycleNodes = names.filter((n) => !emitted.has(n) && (inDeg(n) > 0 || outDeg(n) > 0));
  const cycles: string[][] = cycleNodes.length ? [cycleNodes.slice().sort()] : [];

  // ── depth = longest path from any root (guarded against cycles) ──
  const depth: Record<string, number> = {};
  const depthOf = (n: string, stack: Set<string>): number => {
    if (n in depth) return depth[n];
    if (stack.has(n)) return 0;
    const ps = preds.get(n)!;
    const d = ps.length === 0 ? 0 : 1 + Math.max(...ps.map((p) => depthOf(p, new Set(stack).add(n))));
    depth[n] = d; return d;
  };
  for (const n of names) depthOf(n, new Set());

  // ── participation via DP over the DAG (exact, no enumeration) ──
  // pathsTo[n] = # root→n paths; pathsFrom[n] = # n→sink paths.
  const pathsTo: Record<string, number> = {};
  const pathsFrom: Record<string, number> = {};
  for (const n of topo) {
    const ps = preds.get(n)!.filter((p) => emitted.has(p));
    pathsTo[n] = ps.length === 0 ? 1 : ps.reduce((s, p) => s + (pathsTo[p] ?? 0), 0);
  }
  for (let i = topo.length - 1; i >= 0; i -= 1) {
    const n = topo[i];
    const cs = fwd.get(n)!.filter((c) => emitted.has(c));
    pathsFrom[n] = cs.length === 0 ? 1 : cs.reduce((s, c) => s + (pathsFrom[c] ?? 0), 0);
  }
  const participation: Record<string, number> = {};
  for (const n of names) participation[n] = (pathsTo[n] ?? 0) * (pathsFrom[n] ?? 0);
  const totalMaximalPaths = sinks.reduce((s, sk) => s + (pathsTo[sk] ?? 0), 0);

  const onChain = names.filter((n) => inDeg(n) > 0 || outDeg(n) > 0);
  const trunk = [...onChain].sort((a, b) => participation[b] - participation[a] || a.localeCompare(b));

  // ── phase bands = depth levels ──
  const byDepth = new Map<number, string[]>();
  for (const n of onChain) { const d = depth[n]; (byDepth.get(d) ?? byDepth.set(d, []).get(d)!).push(n); }
  const maxDepth = byDepth.size ? Math.max(...byDepth.keys()) : 0;
  const phases: PhaseBand[] = [...byDepth.keys()].sort((a, b) => a - b).map((d) => {
    const ents = byDepth.get(d)!.slice().sort();
    const headline = ents.slice().sort((a, b) => participation[b] - participation[a] || a.localeCompare(b))[0] ?? "";
    return { depth: d, entities: ents, headline };
  });
  const entityPhase: Record<string, number> = {};
  for (const n of onChain) entityPhase[n] = depth[n];

  // ── candidate journeys: enumerate maximal paths, capped, ranked ──
  const journeys: CandidateJourney[] = [];
  let hitCap = false;
  const walk = (node: string, path: string[], seen: Set<string>) => {
    if (hitCap) return;
    const children = fwd.get(node)!;
    let extended = false;
    for (const c of children) {
      if (seen.has(c)) { journeys.push(mkJourney([...path, c], "cycle")); extended = true; continue; }
      extended = true;
      if (journeys.length >= MAX_JOURNEYS * 4) { hitCap = true; return; }
      walk(c, [...path, c], new Set(seen).add(c));
    }
    if (!extended) journeys.push(mkJourney(path, "sink"));
  };
  const mkJourney = (path: string[], terminal: "sink" | "cycle"): CandidateJourney => ({
    path, length: path.length, terminal,
    trunkWeight: path.reduce((s, n) => s + (participation[n] ?? 0), 0),
  });
  for (const r of roots) walk(r, [r], new Set([r]));
  if (hitCap) journeys.push({ path: ["…truncated"], length: 0, terminal: "sink", trunkWeight: -1 });
  journeys.sort((a, b) => b.length - a.length || b.trunkWeight - a.trunkWeight || a.path.join(">").localeCompare(b.path.join(">")));
  const candidateJourneys = journeys.filter((j) => j.length > 0).slice(0, MAX_JOURNEYS);

  return {
    verb: { produces: producesCount, other: relations.length - producesCount, total: relations.length, otherVerbs },
    roots, sinks, orphans, forks, cycles,
    candidateJourneys, totalMaximalPaths, trunk, phases, entityPhase, maxDepth,
    truncated: hitCap,
  };
}

// ── workflow → phase placement (derived, marked as such) ──────────────────────

export interface WorkflowPhase {
  wfIndex: number;
  name: string;
  area: string;
  phase: number | null;        // null when no step touches an on-chain entity
  viaEntity: string | null;    // the entity that placed it (most-referenced, deepest tiebreak)
  viaCount: number;
  entitiesTouched: string[];
  method: "derived";
}

/** Place each atlas workflow at the phase of its most-referenced on-chain entity.
 *  Deterministic: max count, tiebreak deeper phase then name. Marked `derived`. */
export function placeWorkflows(atlas: Record<string, unknown>, jg: JourneyGraph): WorkflowPhase[] {
  const workflows = (Array.isArray(atlas.workflows) ? atlas.workflows : []) as Array<Record<string, unknown>>;
  return workflows.map((w, wfIndex) => {
    const steps = (Array.isArray(w.steps) ? w.steps : []) as Array<Record<string, unknown>>;
    const count = new Map<string, number>();
    for (const s of steps) {
      const ents = Array.isArray(s.entities) ? s.entities : [];
      for (const e of ents) {
        const name = nm(e);
        if (name in jg.entityPhase) count.set(name, (count.get(name) ?? 0) + 1);
      }
    }
    const touched = [...count.keys()].sort();
    let viaEntity: string | null = null; let viaCount = 0; let phase: number | null = null;
    if (count.size) {
      const best = [...count.entries()].sort((a, b) =>
        b[1] - a[1] || jg.entityPhase[b[0]] - jg.entityPhase[a[0]] || a[0].localeCompare(b[0]))[0];
      viaEntity = best[0]; viaCount = best[1]; phase = jg.entityPhase[best[0]];
    }
    return { wfIndex, name: nm(w.name) || `Workflow ${wfIndex + 1}`, area: nm(w.area) || "—", phase, viaEntity, viaCount, entitiesTouched: touched, method: "derived" };
  });
}
