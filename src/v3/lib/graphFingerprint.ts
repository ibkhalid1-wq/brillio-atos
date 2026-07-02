/**
 * Graph fingerprinting — a stable, order-independent snapshot of a Program Graph
 * that lets one run be diffed against another.
 *
 * `buildProgramGraph` is pure and deterministic for a given ProgramSummary, but
 * its output is a fresh array of objects every call, so two runs can't be
 * compared by reference or by naive JSON (array order, object key order, and
 * volatile properties all defeat that). This module distils a graph down to a
 * canonical fingerprint: a content hash per node, a sorted set of node ids, a
 * sorted set of canonical edge keys, and one overall hash over the lot. Two
 * graphs with the same fingerprint hash are structurally identical; when they
 * differ, `diffFingerprints` names exactly what changed — nodes added, removed,
 * or mutated in place, and edges added or removed.
 *
 * This is what turns the knowledge graph from a snapshot into a *timeline*: a
 * caller can persist a run's fingerprint and, on the next run, surface "since you
 * last looked, 2 requirements were added and the charter's grounding changed"
 * without diffing whole graphs by hand.
 *
 * Pure and dependency-free: no I/O, no program state, no crypto module — the hash
 * is a deterministic FNV-1a so the module stays importable anywhere.
 */
import type { ProgramGraph, ProgramGraphNode, ProgramGraphEdge } from "@/v3/lib/programGraph";

export interface GraphFingerprint {
  /** Order-independent content hash over every node and edge. */
  hash: string;
  nodeCount: number;
  edgeCount: number;
  /** Every node id, sorted — the set membership used for add/remove diffing. */
  nodeIds: string[];
  /** Canonical `from→to→type` key for every edge, sorted. */
  edgeKeys: string[];
  /** Per-node content hash keyed by node id — detects a node changing in place. */
  nodeHashes: Record<string, string>;
}

export interface GraphDiff {
  addedNodes: string[];
  removedNodes: string[];
  /** Same id in both runs but a different content hash (label/phase/props moved). */
  changedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
  /** True when any of the above is non-empty. */
  changed: boolean;
}

/** FNV-1a 32-bit hash → 8-char hex. Deterministic and dependency-free. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619, kept in 32-bit unsigned space via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Deterministic JSON of a value with object keys sorted recursively, so two
 * semantically-equal property bags hash identically regardless of key order.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

/** Canonical, id-scheme-independent key for an edge. */
export function edgeKey(edge: ProgramGraphEdge): string {
  return `${edge.from}\u2192${edge.to}\u2192${edge.type}`;
}

/** Content hash of a node: its identity plus the fields a run-over-run diff cares
 *  about (type, label, owning phase, confidence, properties). */
function hashNode(node: ProgramGraphNode): string {
  return fnv1a(
    stableStringify({
      id: node.id,
      type: node.type,
      label: node.label,
      phaseCreated: node.phaseCreated ?? null,
      confidence: node.confidence ?? null,
      properties: node.properties ?? null,
    }),
  );
}

/** Distil a Program Graph into a stable, comparable fingerprint. */
export function fingerprintGraph(graph: ProgramGraph): GraphFingerprint {
  const nodeHashes: Record<string, string> = {};
  for (const node of graph.nodes) {
    // First-wins on a duplicate id mirrors the graph builder's addNode dedupe.
    if (!(node.id in nodeHashes)) nodeHashes[node.id] = hashNode(node);
  }
  const nodeIds = Object.keys(nodeHashes).sort();
  const edgeKeys = [...new Set(graph.edges.map(edgeKey))].sort();
  // Overall hash folds each node's id+hash and every edge key, in sorted order,
  // so it is independent of the array order the builder happened to emit.
  const material = [
    ...nodeIds.map((id) => `${id}=${nodeHashes[id]}`),
    ...edgeKeys.map((k) => `e:${k}`),
  ].join("\n");
  return {
    hash: fnv1a(material),
    nodeCount: nodeIds.length,
    edgeCount: edgeKeys.length,
    nodeIds,
    edgeKeys,
    nodeHashes,
  };
}

/** Diff two fingerprints: what changed going from `prev` to `next`. */
export function diffFingerprints(prev: GraphFingerprint, next: GraphFingerprint): GraphDiff {
  const prevNodes = new Set(prev.nodeIds);
  const nextNodes = new Set(next.nodeIds);
  const prevEdges = new Set(prev.edgeKeys);
  const nextEdges = new Set(next.edgeKeys);

  const addedNodes = next.nodeIds.filter((id) => !prevNodes.has(id));
  const removedNodes = prev.nodeIds.filter((id) => !nextNodes.has(id));
  const changedNodes = next.nodeIds.filter(
    (id) => prevNodes.has(id) && prev.nodeHashes[id] !== next.nodeHashes[id],
  );
  const addedEdges = next.edgeKeys.filter((k) => !prevEdges.has(k));
  const removedEdges = prev.edgeKeys.filter((k) => !nextEdges.has(k));

  return {
    addedNodes,
    removedNodes,
    changedNodes,
    addedEdges,
    removedEdges,
    changed:
      addedNodes.length > 0 ||
      removedNodes.length > 0 ||
      changedNodes.length > 0 ||
      addedEdges.length > 0 ||
      removedEdges.length > 0,
  };
}
