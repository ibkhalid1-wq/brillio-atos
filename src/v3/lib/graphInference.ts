/**
 * Graph-derived inference — read-only queries and traversals over the Program
 * Graph that turn the accumulated knowledge graph into actionable intelligence.
 *
 * `buildProgramGraph` (programGraph.ts) assembles the typed instance graph with
 * its structural + derived edges (`grounds`, `traces_to`, `addresses`,
 * `delivers`, `sequence`, `in_phase`). This module reads that graph and answers
 * the questions the raw graph only *implies*:
 *
 *   - coverage gaps    — requirements no design decision addresses, in-scope
 *                        items no increment delivers, facts that ground nothing
 *                        (generalises objectiveGraph's `unreportedKpis`).
 *
 * Every function here is pure: it takes a ProgramGraph (or the primitives a
 * caller already has) and returns plain data — no program state, no I/O — so it
 * is unit-testable in isolation and safe to import anywhere.
 */
import type { ProgramGraph, ProgramGraphNode, ProgramGraphEdge } from "@/v3/lib/programGraph";

/** A place where the graph shows work that is declared but not yet connected to
 *  the downstream element that would satisfy it. */
export interface CoverageGap {
  /**
   * - `untraced-requirement`: a requirement with no design decision `addresses`ing it.
   * - `undelivered-scope`: an in-scope item with no delivery increment `delivers`ing it.
   * - `ungrounded-fact`: a fact that `grounds` no artifact (an orphan citation).
   */
  kind: "untraced-requirement" | "undelivered-scope" | "ungrounded-fact";
  /** Program Graph node id of the uncovered element (e.g. "requirement:REQ-1"). */
  nodeId: string;
  /** The element's human label, for direct surfacing. */
  label: string;
  /** Owning phase id, when the element belongs to one. */
  phaseId?: string;
  /** One-line explanation of what connection is missing. */
  detail: string;
}

/** Index incoming/outgoing edge counts by node id for a given edge type. */
function endpointsWithEdge(edges: ProgramGraphEdge[], type: string, direction: "from" | "to"): Set<string> {
  const set = new Set<string>();
  for (const edge of edges) {
    if (edge.type === type) set.add(direction === "from" ? edge.from : edge.to);
  }
  return set;
}

/**
 * Every coverage gap in the graph. A gap is the *absence* of the edge that would
 * connect a declared element to the work that covers it — the graph analogue of
 * `unreportedKpis` (a KPI with no `reported-by` edge), generalised to
 * requirements, scope items and facts.
 *
 * Results are grouped by kind in a stable order (requirements, then scope, then
 * facts) and, within a kind, in the graph's node order, so the output is
 * deterministic for snapshotting and prompt injection.
 */
export function detectCoverageGaps(graph: ProgramGraph): CoverageGap[] {
  if (!graph || !graph.nodes.length) return [];

  // Requirements a design decision addresses (edge: decision --addresses--> requirement).
  const addressedRequirements = endpointsWithEdge(graph.edges, "addresses", "to");
  // Scope items an increment delivers (edge: increment --delivers--> scope).
  const deliveredScope = endpointsWithEdge(graph.edges, "delivers", "to");
  // Facts that ground at least one artifact (edge: fact --grounds--> artifact).
  const groundingFacts = endpointsWithEdge(graph.edges, "grounds", "from");

  const requirements: CoverageGap[] = [];
  const scope: CoverageGap[] = [];
  const facts: CoverageGap[] = [];

  for (const node of graph.nodes) {
    if (node.type === "requirement" && !addressedRequirements.has(node.id)) {
      requirements.push({
        kind: "untraced-requirement",
        nodeId: node.id,
        label: node.label,
        phaseId: node.phaseCreated,
        detail: `Requirement "${node.label}" is addressed by no design decision.`,
      });
    } else if (node.type === "scope" && !deliveredScope.has(node.id)) {
      scope.push({
        kind: "undelivered-scope",
        nodeId: node.id,
        label: node.label,
        phaseId: node.phaseCreated,
        detail: `In-scope item "${node.label}" is delivered by no increment.`,
      });
    } else if (node.type === "fact" && !groundingFacts.has(node.id)) {
      facts.push({
        kind: "ungrounded-fact",
        nodeId: node.id,
        label: node.label,
        phaseId: node.phaseCreated,
        detail: `Fact "${node.label}" grounds no artifact.`,
      });
    }
  }

  return [...requirements, ...scope, ...facts];
}

/**
 * Dependency edges and the direction the dependency runs, expressed so a single
 * normalised adjacency (dependency → dependent) can be built regardless of the
 * edge's stored from/to orientation.
 *
 *  - `grounds`   fact --grounds--> artifact:      the artifact is derived from the
 *                fact, so the artifact (edge.to) depends on the fact (edge.from).
 *  - `traces_to` artifact --traces_to--> input:   the artifact was built from the
 *                requirement/kpi/scope, so the artifact (edge.from) depends on the
 *                input (edge.to).
 *  - `addresses` decision --addresses--> requirement: the decision responds to the
 *                requirement, so the decision (edge.from) depends on it (edge.to).
 *  - `delivers`  increment --delivers--> scope:    the increment realises the scope
 *                item, so the increment (edge.from) depends on it (edge.to).
 *
 * "forward" means dependency = edge.from and dependent = edge.to; "reverse" is the
 * opposite. Structural edges (sequence, in_phase, mentions, extracted_to) carry no
 * derivation dependency and are excluded.
 */
const DEPENDENCY_EDGES: Record<string, "forward" | "reverse"> = {
  grounds: "forward",
  traces_to: "reverse",
  addresses: "reverse",
  delivers: "reverse",
};

/** dependency node id → dependent node ids (the nodes that would be impacted if
 *  the dependency changed). */
function dependencyAdjacency(edges: ProgramGraphEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (dependency: string, dependent: string) => {
    if (dependency === dependent) return;
    const set = adj.get(dependency) ?? new Set<string>();
    set.add(dependent);
    adj.set(dependency, set);
  };
  for (const edge of edges) {
    const dir = DEPENDENCY_EDGES[edge.type];
    if (!dir) continue;
    if (dir === "forward") link(edge.from, edge.to);
    else link(edge.to, edge.from);
  }
  return adj;
}

/** Breadth-first reachable set from `startId` over an adjacency map, excluding the
 *  start, in first-seen (deterministic) order. */
function bfs(adj: Map<string, Set<string>>, startId: string): string[] {
  const seen = new Set<string>([startId]);
  const order: string[] = [];
  const queue: string[] = [startId];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const next of adj.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      order.push(next);
      queue.push(next);
    }
  }
  return order;
}

/** A reachability result: the reached node ids and their resolved nodes. */
export interface Reachability {
  nodeIds: string[];
  nodes: ProgramGraphNode[];
}

function resolve(graph: ProgramGraph, ids: string[]): Reachability {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return { nodeIds: ids, nodes: ids.map((id) => byId.get(id)).filter((n): n is ProgramGraphNode => Boolean(n)) };
}

/**
 * Every node whose correctness depends, transitively, on `startId` — the blast
 * radius of changing it. Answers "if this requirement changes, what downstream
 * work must be revisited?" by walking the dependency adjacency forward: a
 * requirement reaches the decisions that address it and the artifacts that trace
 * to it; a fact reaches the artifacts it grounds; and so on transitively.
 */
export function impactedBy(graph: ProgramGraph, startId: string): Reachability {
  if (!graph || !graph.nodes.length) return { nodeIds: [], nodes: [] };
  return resolve(graph, bfs(dependencyAdjacency(graph.edges), startId));
}

/** Reverse adjacency: dependent → the dependencies it was derived from. */
function reverseAdjacency(adj: Map<string, Set<string>>): Map<string, Set<string>> {
  const rev = new Map<string, Set<string>>();
  for (const [dependency, dependents] of adj) {
    for (const dependent of dependents) {
      const set = rev.get(dependent) ?? new Set<string>();
      set.add(dependency);
      rev.set(dependent, set);
    }
  }
  return rev;
}

/**
 * Every node `startId` transitively depends on — its provenance / upstream
 * grounding. Answers "what was this artifact built from?" by walking the
 * dependency adjacency backward.
 */
export function dependenciesOf(graph: ProgramGraph, startId: string): Reachability {
  if (!graph || !graph.nodes.length) return { nodeIds: [], nodes: [] };
  return resolve(graph, bfs(reverseAdjacency(dependencyAdjacency(graph.edges)), startId));
}

/* ------------------------------------------------------------------ *
 * Cross-phase contradiction detection
 * ------------------------------------------------------------------ */

/** A detected conflict between two graph nodes. */
export interface Contradiction {
  /**
   * - `conflicting-kpi-target`: two KPI nodes name the same metric but carry
   *   different baseline/target values.
   * - `polarity-conflict`: two statements (facts or requirements) share a strong
   *   subject overlap but differ in negation polarity — one asserts what the other
   *   denies.
   */
  kind: "conflicting-kpi-target" | "polarity-conflict";
  nodeA: string;
  nodeB: string;
  detail: string;
  /** True when the two nodes originate in different phases — the case the
   *  cross-phase check most wants to surface. */
  crossPhase: boolean;
}

const CONTRADICTION_STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "at", "by", "is",
  "are", "be", "been", "must", "should", "shall", "will", "system", "solution",
  "platform", "it", "its", "this", "that", "with", "as", "we", "they",
]);

const NEGATION_TOKENS = new Set([
  "not", "no", "never", "without", "cannot", "cant", "wont", "shouldnt", "dont",
  "doesnt", "isnt", "arent", "exclude", "excluded", "excludes", "prohibit",
  "prohibited", "disallow", "disallowed", "neither", "nor", "none",
]);

/** Content tokens for contradiction matching: lowercase, alphanumeric, minus
 *  stopwords and negation words (negation is scored separately), lightly stemmed. */
function subjectTokens(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/n't\b/g, " not ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !CONTRADICTION_STOPWORDS.has(t) && !NEGATION_TOKENS.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
}

/** Whether a statement carries negation polarity. */
function hasNegation(text: string): boolean {
  const normalized = (text ?? "").toLowerCase().replace(/n't\b/g, " not ");
  const tokens = normalized.replace(/[^a-z0-9]+/g, " ").split(" ");
  return tokens.some((t) => NEGATION_TOKENS.has(t));
}

/** Jaccard similarity of two token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** KPI display label ("Name: baseline → target → unit") reduced to the metric
 *  name for same-metric grouping. */
function kpiName(node: ProgramGraphNode): string {
  return node.label.split(":")[0].trim().toLowerCase();
}

/**
 * Every contradiction the graph exposes structurally. Two families:
 *
 *  1. Conflicting KPI targets — the same metric declared twice (e.g. in Strategy
 *     and again downstream) with different baseline or target values, so the
 *     programme is chasing two numbers for one measure.
 *  2. Polarity conflicts — two requirement/fact statements about the same subject
 *     where one is affirmative and the other negated (Jaccard of subject tokens
 *     ≥ `minOverlap`, differing negation). Catches "must support offline mode"
 *     upstream vs "must not support offline mode" downstream.
 *
 * Pure and deterministic (pairs emitted in node order). `minOverlap` guards
 * against spurious polarity matches on loosely-related statements.
 */
export function detectContradictions(graph: ProgramGraph, minOverlap = 0.6): Contradiction[] {
  if (!graph || !graph.nodes.length) return [];
  const out: Contradiction[] = [];
  const crossPhase = (a: ProgramGraphNode, b: ProgramGraphNode) =>
    Boolean(a.phaseCreated && b.phaseCreated && a.phaseCreated !== b.phaseCreated);

  // 1. Conflicting KPI targets.
  const kpis = graph.nodes.filter((n) => n.type === "kpi");
  for (let i = 0; i < kpis.length; i++) {
    for (let j = i + 1; j < kpis.length; j++) {
      const a = kpis[i];
      const b = kpis[j];
      if (!kpiName(a) || kpiName(a) !== kpiName(b)) continue;
      const targetA = String(a.properties?.target ?? "").trim();
      const targetB = String(b.properties?.target ?? "").trim();
      const baseA = String(a.properties?.baseline ?? "").trim();
      const baseB = String(b.properties?.baseline ?? "").trim();
      const targetConflict = targetA && targetB && targetA !== targetB;
      const baseConflict = baseA && baseB && baseA !== baseB;
      if (!targetConflict && !baseConflict) continue;
      out.push({
        kind: "conflicting-kpi-target",
        nodeA: a.id,
        nodeB: b.id,
        detail: `KPI "${kpiName(a)}" is declared with conflicting ${targetConflict ? `targets (${targetA} vs ${targetB})` : `baselines (${baseA} vs ${baseB})`}.`,
        crossPhase: crossPhase(a, b),
      });
    }
  }

  // 2. Polarity conflicts among requirement/fact statements.
  const statements = graph.nodes
    .filter((n) => n.type === "requirement" || n.type === "fact")
    .map((n) => ({ node: n, tokens: new Set(subjectTokens(n.label)), negated: hasNegation(n.label) }))
    .filter((s) => s.tokens.size >= 2);
  for (let i = 0; i < statements.length; i++) {
    for (let j = i + 1; j < statements.length; j++) {
      const a = statements[i];
      const b = statements[j];
      if (a.negated === b.negated) continue; // same polarity — not a contradiction
      if (jaccard(a.tokens, b.tokens) < minOverlap) continue;
      out.push({
        kind: "polarity-conflict",
        nodeA: a.node.id,
        nodeB: b.node.id,
        detail: `"${a.node.label}" contradicts "${b.node.label}" — same subject, opposite polarity.`,
        crossPhase: crossPhase(a.node, b.node),
      });
    }
  }

  return out;
}

/** Count coverage gaps by kind — a compact health summary for a dashboard. */
export function summarizeCoverageGaps(gaps: CoverageGap[]): Record<CoverageGap["kind"], number> {
  const out: Record<CoverageGap["kind"], number> = {
    "untraced-requirement": 0,
    "undelivered-scope": 0,
    "ungrounded-fact": 0,
  };
  for (const gap of gaps) out[gap.kind] += 1;
  return out;
}

/** Re-export for callers that only need the node shape. */
export type { ProgramGraphNode };
