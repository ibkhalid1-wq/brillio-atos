/**
 * Shared graph machinery for the studios: the floating angled edge (attaches
 * to whichever sides of two nodes face each other, re-computed live as nodes
 * move) and the layered crossing-minimising layout (BFS rows from the
 * best-connected node, one barycenter ordering pass per row).
 */
import {
  BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useInternalNode, Position,
  type EdgeProps, type InternalNode,
} from "@xyflow/react";

function sidePoint(node: InternalNode, side: Position): { x: number; y: number } {
  const { x, y } = node.internals.positionAbsolute;
  const width = node.measured?.width ?? 160;
  const height = node.measured?.height ?? 44;
  switch (side) {
    case Position.Left: return { x, y: y + height / 2 };
    case Position.Right: return { x: x + width, y: y + height / 2 };
    case Position.Top: return { x: x + width / 2, y };
    default: return { x: x + width / 2, y: y + height };
  }
}

export function FloatingStepEdge({ id, source, target, markerEnd, label, selected }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;
  const sw = sourceNode.measured?.width ?? 160, sh = sourceNode.measured?.height ?? 44;
  const tw = targetNode.measured?.width ?? 160, th = targetNode.measured?.height ?? 44;
  const dx = (targetNode.internals.positionAbsolute.x + tw / 2) - (sourceNode.internals.positionAbsolute.x + sw / 2);
  const dy = (targetNode.internals.positionAbsolute.y + th / 2) - (sourceNode.internals.positionAbsolute.y + sh / 2);
  const horizontal = Math.abs(dx) > Math.abs(dy);
  const sourcePosition = horizontal ? (dx > 0 ? Position.Right : Position.Left) : (dy > 0 ? Position.Bottom : Position.Top);
  const targetPosition = horizontal ? (dx > 0 ? Position.Left : Position.Right) : (dy > 0 ? Position.Top : Position.Bottom);
  const start = sidePoint(sourceNode, sourcePosition);
  const end = sidePoint(targetNode, targetPosition);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: start.x, sourceY: start.y, sourcePosition,
    targetX: end.x, targetY: end.y, targetPosition,
    borderRadius: 6,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd}
        style={selected ? { stroke: "var(--v3-accent-2)", strokeWidth: 2 } : undefined} />
      {label ? (
        <EdgeLabelRenderer>
          <div className={`v3fs-onto-elabel${selected ? " on" : ""}`}
            style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)` }}>
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const FLOATING_EDGE_TYPES = { floating: FloatingStepEdge };

// ─── Routed edges (ELK) ───────────────────────────────────────────────────────
// A "routed" edge follows a PRECOMPUTED polyline (ELK's orthogonal routing,
// which steers around nodes and minimises crossings) instead of pointing
// straight at its target. The points live on edge.data and are only valid for
// the node positions ELK produced them with — callers drop the routes (edges
// fall back to "floating") the moment a node is dragged or the doc changes.

type RoutePoint = { x: number; y: number };

function roundedOrthPath(points: RoutePoint[], radius = 8): string {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1], corner = points[i], next = points[i + 1];
    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const inX = corner.x - ((corner.x - prev.x) / (inLen || 1)) * r;
    const inY = corner.y - ((corner.y - prev.y) / (inLen || 1)) * r;
    const outX = corner.x + ((next.x - corner.x) / (outLen || 1)) * r;
    const outY = corner.y + ((next.y - corner.y) / (outLen || 1)) * r;
    d += ` L ${inX} ${inY} Q ${corner.x} ${corner.y} ${outX} ${outY}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** The point halfway along the polyline BY LENGTH — where the label sits. */
function polylineMidpoint(points: RoutePoint[]): RoutePoint {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  let remaining = total / 2;
  for (let i = 1; i < points.length; i += 1) {
    const seg = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (seg >= remaining) {
      const t = seg ? remaining / seg : 0;
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t };
    }
    remaining -= seg;
  }
  return points[Math.floor(points.length / 2)];
}

export function RoutedEdge({ id, data, markerEnd, label, selected }: EdgeProps) {
  const points = ((data as { points?: RoutePoint[] } | undefined)?.points) ?? [];
  if (points.length < 2) return null;
  const mid = polylineMidpoint(points);
  return (
    <>
      <BaseEdge id={id} path={roundedOrthPath(points)} markerEnd={markerEnd}
        style={selected ? { stroke: "var(--v3-accent-2)", strokeWidth: 2 } : undefined} />
      {label ? (
        <EdgeLabelRenderer>
          <div className={`v3fs-onto-elabel${selected ? " on" : ""}`}
            style={{ transform: `translate(-50%,-50%) translate(${mid.x}px,${mid.y}px)` }}>
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const ROUTED_EDGE_TYPES = { ...FLOATING_EDGE_TYPES, routed: RoutedEdge };

/**
 * The full ELK layered layout: node positions AND orthogonal edge routes that
 * steer around nodes with crossing minimisation — strictly better than
 * layeredPositions wherever the caller can render routed edges. Loaded on
 * demand (elkjs is ~350KB gzipped, its own lazy chunk); callers should fall
 * back to layeredPositions when the import fails.
 */
export async function elkGraphLayout(
  nodes: Array<{ id: string; width: number; height: number }>,
  edges: Array<{ id: string; source: string; target: string }>,
): Promise<{ positions: Record<string, RoutePoint>; routes: Record<string, RoutePoint[]> }> {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const elk = new ELK();
  const graph: import("elkjs").ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      // Deterministic tie-breaking: same graph → same layout, run to run.
      "elk.randomSeed": "1",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
      "elk.spacing.edgeNode": "24",
      "elk.spacing.edgeEdge": "16",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    },
    children: nodes.map((node) => ({ id: node.id, width: node.width, height: node.height })),
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };
  const out = await elk.layout(graph);
  const positions: Record<string, RoutePoint> = {};
  for (const child of out.children ?? []) positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
  const routes: Record<string, RoutePoint[]> = {};
  for (const edge of out.edges ?? []) {
    const section = edge.sections?.[0];
    if (!section) continue;
    routes[edge.id] = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
  }
  return { positions, routes };
}

/**
 * A layered (Sugiyama-style) layout: entities fall into rows by BFS distance
 * from the best-connected hub, then each row is re-ordered by the MEDIAN of its
 * neighbours' slots — swept up AND down and iterated — to pull connected nodes
 * in line and cut edge crossings. When node `sizes` are supplied the row is
 * packed by real widths (never overlapping) with rows spaced by real heights;
 * without sizes it falls back to fixed slots (callers that don't measure).
 */
export function layeredPositions(
  ids: string[],
  links: Array<{ from: string; to: string }>,
  opts: { x?: number; y?: number; gapX?: number; sizes?: Record<string, { width: number; height: number }> } = {},
): Record<string, { x: number; y: number }> {
  const slotX = opts.x ?? 240;
  const rowGap = opts.y ?? 150;
  const gapX = opts.gapX ?? 60;
  const sizes = opts.sizes;
  const widthOf = (id: string) => Math.max(120, sizes?.[id]?.width ?? 170);
  const heightOf = (id: string) => Math.max(40, sizes?.[id]?.height ?? 48);

  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const link of links) {
    if (link.from !== link.to && neighbours.has(link.from) && neighbours.has(link.to)) {
      neighbours.get(link.from)!.push(link.to);
      neighbours.get(link.to)!.push(link.from);
    }
  }

  // ── Layer assignment: BFS rows from the most-connected unplaced node. ──
  const layers: string[][] = [];
  const unvisited = new Set(ids);
  const degree = (id: string) => neighbours.get(id)!.length;
  while (unvisited.size) {
    const root = [...unvisited].sort((a, b) => degree(b) - degree(a))[0];
    let frontier = [root];
    unvisited.delete(root);
    let depth = layers.length;
    while (frontier.length) {
      (layers[depth] ??= []).push(...frontier);
      const next: string[] = [];
      for (const id of frontier) {
        for (const other of neighbours.get(id)!) {
          if (unvisited.has(other)) { unvisited.delete(other); next.push(other); }
        }
      }
      frontier = next;
      depth += 1;
    }
  }

  // ── Crossing reduction: median heuristic, alternating sweeps, iterated. A
  // node with no neighbour in the adjacent row keeps its current slot. ──
  const median = (id: string, adjPos: Map<string, number>): number => {
    const ps = neighbours.get(id)!.map((n) => adjPos.get(n)).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
    if (!ps.length) return -1;
    const mid = Math.floor(ps.length / 2);
    return ps.length % 2 ? ps[mid] : (ps[mid - 1] + ps[mid]) / 2;
  };
  const reorder = (layer: string[], adj: string[]): string[] => {
    const adjPos = new Map(adj.map((id, i) => [id, i]));
    return layer
      .map((id, i) => ({ id, key: (() => { const m = median(id, adjPos); return m < 0 ? i * (adj.length / Math.max(1, layer.length)) : m; })() }))
      .sort((a, b) => a.key - b.key)
      .map((k) => k.id);
  };
  for (let pass = 0; pass < 8 && layers.length > 1; pass += 1) {
    if (pass % 2 === 0) {
      for (let depth = 1; depth < layers.length; depth += 1) layers[depth] = reorder(layers[depth], layers[depth - 1]);
    } else {
      for (let depth = layers.length - 2; depth >= 0; depth -= 1) layers[depth] = reorder(layers[depth], layers[depth + 1]);
    }
  }

  // ── Placement. With sizes: pack rows by real widths (no overlap), space rows
  // by real heights, then STRAIGHTEN — iteratively pull each node toward its
  // neighbours' centre (keeping the row overlap-free) so edges shorten, stop
  // cutting across unrelated nodes, and cross far less. Without sizes: the old
  // centred fixed slots (Blueprint graph). ──
  const out: Record<string, { x: number; y: number }> = {};
  if (sizes) {
    const layerOf = new Map<string, number>();
    const yByLayer: number[] = [];
    const xById = new Map<string, number>();
    let y = 0;
    layers.forEach((layer, li) => {
      const total = layer.reduce((sum, id) => sum + widthOf(id), 0) + gapX * Math.max(0, layer.length - 1);
      let cx = -total / 2;
      for (const id of layer) { xById.set(id, cx + widthOf(id) / 2); cx += widthOf(id) + gapX; layerOf.set(id, li); }
      yByLayer.push(y);
      y += Math.max(...layer.map(heightOf), 0) + rowGap;
    });
    const minGap = (a: string, b: string) => widthOf(a) / 2 + gapX + widthOf(b) / 2;
    for (let pass = 0; pass < 6; pass += 1) {
      const order = pass % 2 === 0 ? layers.map((_, i) => i) : layers.map((_, i) => i).reverse();
      for (const li of order) {
        const layer = layers[li];
        // Desired x: the average of each node's connected neighbours (any row).
        const desired = layer.map((id) => {
          const xs = neighbours.get(id)!.map((n) => xById.get(n)).filter((v): v is number => v !== undefined);
          return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : xById.get(id)!;
        });
        // Enforce order + gap left→right, then shift the whole (rigid) row back
        // onto the desired barycentre — preserves spacing, kills rightward drift.
        const xs = desired.slice();
        for (let i = 1; i < layer.length; i += 1) xs[i] = Math.max(xs[i], xs[i - 1] + minGap(layer[i - 1], layer[i]));
        const shift = (desired.reduce((s, v) => s + v, 0) - xs.reduce((s, v) => s + v, 0)) / Math.max(1, layer.length);
        layer.forEach((id, i) => xById.set(id, xs[i] + shift));
      }
    }
    for (const id of ids) {
      if (xById.has(id)) out[id] = { x: Math.round(xById.get(id)!), y: Math.round(yByLayer[layerOf.get(id)!]) };
    }
  } else {
    layers.forEach((layer, depth) => {
      layer.forEach((id, index) => {
        out[id] = { x: Math.round((index - (layer.length - 1) / 2) * slotX), y: depth * rowGap };
      });
    });
  }
  return out;
}
