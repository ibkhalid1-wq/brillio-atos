/**
 * Knowledge Graph traversal — the query layer for scoped context retrieval.
 *
 * The Token Governance mandate is explicit: "Before any AI execution: identify
 * impacted object → traverse Program Knowledge Graph → retrieve only connected
 * lineage → build scoped context package → execute AI. Never perform broad
 * retrieval when graph traversal can identify required context."
 *
 * `buildKnowledgeGraph()` already produces a typed graph, but it exposes no way
 * to *walk* it. Context assembly therefore had no choice but to send the whole
 * program. This module adds a pure, indexed traversal API over an existing
 * `KnowledgeGraph` so a capability can start from one node (a risk, a decision,
 * an artifact) and pull exactly the connected lineage it needs — nothing more.
 *
 * Everything here is a pure function of the graph it is given: no program reads,
 * no backend, fully unit-testable. It builds a one-shot adjacency index per call
 * so callers never mutate the graph or pay repeated O(E) scans within a walk.
 */
import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  GraphNodeKind,
  GraphEdgeKind,
} from "@/v3/lib/knowledgeGraph";

/**
 * Direction of travel along directed edges.
 *  • "downstream" — follow edges source→target (consumers / things this feeds).
 *  • "upstream"   — follow edges target→source (producers / things this needs).
 *  • "both"       — ignore direction; treat the graph as undirected.
 */
export type TraversalDirection = "downstream" | "upstream" | "both";

export interface TraversalOptions {
  /** Max hops from the start node. Omit/Infinity for unbounded. Distance 0 = start only. */
  maxDistance?: number;
  direction?: TraversalDirection;
  /** Only traverse across these edge kinds (omit = all kinds). */
  edgeKinds?: ReadonlySet<GraphEdgeKind> | GraphEdgeKind[];
  /** Only return nodes of these kinds (start node is filtered too; omit = all kinds). */
  nodeKinds?: ReadonlySet<GraphNodeKind> | GraphNodeKind[];
  /** Include the start node in the result set. Default true. */
  includeStart?: boolean;
}

interface AdjacencyEntry {
  /** Edge to a neighbour reachable by travelling source→target. */
  out: GraphEdge[];
  /** Edge to a neighbour reachable by travelling target→source. */
  in: GraphEdge[];
}

/**
 * A reusable adjacency index over a graph. Build once, query many times — every
 * traversal helper accepts either a raw graph or a prebuilt index, so a caller
 * doing several walks over the same graph pays the indexing cost only once.
 */
export interface GraphIndex {
  graph: KnowledgeGraph;
  nodeById: Map<string, GraphNode>;
  adjacency: Map<string, AdjacencyEntry>;
}

function toSet<T>(value: ReadonlySet<T> | T[] | undefined): ReadonlySet<T> | null {
  if (!value) return null;
  return value instanceof Set ? value : new Set(value as T[]);
}

/** Build the adjacency index for a graph. Pure; does not mutate the graph. */
export function indexGraph(graph: KnowledgeGraph): GraphIndex {
  const nodeById = new Map<string, GraphNode>();
  const adjacency = new Map<string, AdjacencyEntry>();

  for (const node of graph.nodes) {
    nodeById.set(node.id, node);
    adjacency.set(node.id, { out: [], in: [] });
  }

  for (const edge of graph.edges) {
    // Tolerate edges that reference nodes absent from the node list.
    let from = adjacency.get(edge.source);
    if (!from) {
      from = { out: [], in: [] };
      adjacency.set(edge.source, from);
    }
    let to = adjacency.get(edge.target);
    if (!to) {
      to = { out: [], in: [] };
      adjacency.set(edge.target, to);
    }
    from.out.push(edge);
    to.in.push(edge);
  }

  return { graph, nodeById, adjacency };
}

function resolveIndex(source: KnowledgeGraph | GraphIndex): GraphIndex {
  return "adjacency" in source ? source : indexGraph(source);
}

/** Neighbouring edges to traverse from `nodeId` given a direction + edge filter. */
function steppableEdges(
  index: GraphIndex,
  nodeId: string,
  direction: TraversalDirection,
  edgeKinds: ReadonlySet<GraphEdgeKind> | null,
): Array<{ edge: GraphEdge; next: string }> {
  const entry = index.adjacency.get(nodeId);
  if (!entry) return [];
  const steps: Array<{ edge: GraphEdge; next: string }> = [];

  if (direction === "downstream" || direction === "both") {
    for (const edge of entry.out) {
      if (edgeKinds && !edgeKinds.has(edge.kind)) continue;
      steps.push({ edge, next: edge.target });
    }
  }
  if (direction === "upstream" || direction === "both") {
    for (const edge of entry.in) {
      if (edgeKinds && !edgeKinds.has(edge.kind)) continue;
      steps.push({ edge, next: edge.source });
    }
  }
  return steps;
}

/**
 * Breadth-first traversal from `startId`. Returns the reachable nodes (excluding
 * or including the start per options), each annotated with its hop distance.
 * The shortest distance wins when a node is reachable by multiple paths.
 */
export function traverse(
  source: KnowledgeGraph | GraphIndex,
  startId: string,
  options: TraversalOptions = {},
): Array<{ node: GraphNode; distance: number }> {
  const index = resolveIndex(source);
  const start = index.nodeById.get(startId);
  if (!start) return [];

  const direction = options.direction ?? "downstream";
  const maxDistance = options.maxDistance ?? Infinity;
  const edgeKinds = toSet(options.edgeKinds);
  const nodeKinds = toSet(options.nodeKinds);
  const includeStart = options.includeStart ?? true;

  const distances = new Map<string, number>([[startId, 0]]);
  const queue: string[] = [startId];

  while (queue.length) {
    const currentId = queue.shift() as string;
    const currentDistance = distances.get(currentId) as number;
    if (currentDistance >= maxDistance) continue;

    for (const { next } of steppableEdges(index, currentId, direction, edgeKinds)) {
      if (distances.has(next)) continue;
      distances.set(next, currentDistance + 1);
      queue.push(next);
    }
  }

  const results: Array<{ node: GraphNode; distance: number }> = [];
  for (const [id, distance] of distances) {
    if (id === startId && !includeStart) continue;
    const node = index.nodeById.get(id);
    if (!node) continue;
    if (nodeKinds && !nodeKinds.has(node.kind)) continue;
    results.push({ node, distance });
  }
  results.sort((a, b) => a.distance - b.distance || a.node.id.localeCompare(b.node.id));
  return results;
}

/** Reachable nodes (without distance) — the common case for context assembly. */
export function getReachableNodes(
  source: KnowledgeGraph | GraphIndex,
  startId: string,
  options: TraversalOptions = {},
): GraphNode[] {
  return traverse(source, startId, options).map((hit) => hit.node);
}

/**
 * Upstream lineage: the producers/inputs a node depends on. Follows edges in the
 * reverse direction (target→source). Excludes the start node by default.
 */
export function getUpstreamDependencies(
  source: KnowledgeGraph | GraphIndex,
  startId: string,
  options: Omit<TraversalOptions, "direction"> = {},
): GraphNode[] {
  return getReachableNodes(source, startId, {
    includeStart: false,
    ...options,
    direction: "upstream",
  });
}

/**
 * Downstream consumers: what a node feeds / affects. Follows edges source→target.
 * Excludes the start node by default.
 */
export function getDownstreamConsumers(
  source: KnowledgeGraph | GraphIndex,
  startId: string,
  options: Omit<TraversalOptions, "direction"> = {},
): GraphNode[] {
  return getReachableNodes(source, startId, {
    includeStart: false,
    ...options,
    direction: "downstream",
  });
}

/** Immediate neighbours (distance 1) in the given direction. */
export function getNeighbors(
  source: KnowledgeGraph | GraphIndex,
  startId: string,
  direction: TraversalDirection = "both",
  options: Omit<TraversalOptions, "direction" | "maxDistance"> = {},
): GraphNode[] {
  return getReachableNodes(source, startId, {
    ...options,
    direction,
    maxDistance: 1,
    includeStart: false,
  });
}

/**
 * The connected lineage subgraph around a node — the scoped context package the
 * mandate describes. Returns the start node plus everything reachable within
 * `maxDistance` in `direction`, as a self-contained `KnowledgeGraph` (only edges
 * whose both endpoints are kept), with recomputed stats.
 */
export function buildLineageContext(
  source: KnowledgeGraph | GraphIndex,
  startId: string,
  options: TraversalOptions = {},
): KnowledgeGraph {
  const index = resolveIndex(source);
  const reachable = traverse(index, startId, { ...options, includeStart: true });
  const keep = new Set(reachable.map((hit) => hit.node.id));

  const nodes = index.graph.nodes.filter((node) => keep.has(node.id));
  const edges = index.graph.edges.filter(
    (edge) => keep.has(edge.source) && keep.has(edge.target),
  );

  const byKind: Record<GraphNodeKind, number> = {
    phase: 0,
    artifact: 0,
    decision: 0,
    risk: 0,
    milestone: 0,
    gate: 0,
  };
  for (const node of nodes) byKind[node.kind] += 1;

  const incident = new Set<string>();
  for (const edge of edges) {
    incident.add(edge.source);
    incident.add(edge.target);
  }
  const orphans = nodes.reduce(
    (count, node) => (incident.has(node.id) ? count : count + 1),
    0,
  );

  return {
    nodes,
    edges,
    stats: { nodeCount: nodes.length, edgeCount: edges.length, byKind, orphans },
  };
}

/** Whether `targetId` is reachable from `startId` within the given options. */
export function isReachable(
  source: KnowledgeGraph | GraphIndex,
  startId: string,
  targetId: string,
  options: TraversalOptions = {},
): boolean {
  if (startId === targetId) return options.includeStart ?? true;
  return traverse(source, startId, options).some((hit) => hit.node.id === targetId);
}
