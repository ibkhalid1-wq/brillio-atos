/**
 * Shared graph machinery for the studios: the floating angled edge (attaches
 * to whichever sides of two nodes face each other, re-computed live as nodes
 * move) and the layered crossing-minimising layout (BFS rows from the
 * best-connected node, one barycenter ordering pass per row).
 */
import React from "react";
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

export function layeredPositions(
  ids: string[],
  links: Array<{ from: string; to: string }>,
  spacing: { x?: number; y?: number } = {},
): Record<string, { x: number; y: number }> {
  const stepX = spacing.x ?? 240;
  const stepY = spacing.y ?? 150;
  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const link of links) {
    if (neighbours.has(link.from) && neighbours.has(link.to)) {
      neighbours.get(link.from)!.push(link.to);
      neighbours.get(link.to)!.push(link.from);
    }
  }
  const layers: string[][] = [];
  const unvisited = new Set(ids);
  while (unvisited.size) {
    const root = [...unvisited].sort((a, b) => (neighbours.get(b)!.length - neighbours.get(a)!.length))[0];
    let frontier = [root];
    unvisited.delete(root);
    let depth = layers.length;
    while (frontier.length) {
      (layers[depth] ??= []).push(...frontier);
      const next: string[] = [];
      for (const id of frontier) {
        for (const other of neighbours.get(id)!) {
          if (unvisited.has(other)) {
            unvisited.delete(other);
            next.push(other);
          }
        }
      }
      frontier = next;
      depth += 1;
    }
  }
  for (let depth = 1; depth < layers.length; depth += 1) {
    const above = new Map(layers[depth - 1].map((id, index) => [id, index]));
    layers[depth].sort((a, b) => {
      const mean = (id: string) => {
        const ups = neighbours.get(id)!.map((other) => above.get(other)).filter((v): v is number => v !== undefined);
        return ups.length ? ups.reduce((sum, v) => sum + v, 0) / ups.length : Number.MAX_SAFE_INTEGER;
      };
      return mean(a) - mean(b);
    });
  }
  const out: Record<string, { x: number; y: number }> = {};
  layers.forEach((layer, depth) => {
    layer.forEach((id, index) => {
      out[id] = { x: Math.round((index - (layer.length - 1) / 2) * stepX), y: depth * stepY };
    });
  });
  return out;
}
