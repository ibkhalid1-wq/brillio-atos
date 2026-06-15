import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";
import { derivePhaseFlowEdges } from "@/v3/lib/phaseFlowEdges";

/**
 * PhaseFlowOverlay — draws connector lines that are *pinned to the real DOM*:
 * each input field row (left column) is wired to the artifacts it feeds (right
 * column). Unlike a static diagram, the endpoints are measured from the live
 * elements via their `data-io-anchor` attributes, so the lines stay attached
 * when a field grows (textarea expands), an artifact preview is opened, or the
 * window is resized — a ResizeObserver + MutationObserver re-measure on any of
 * those changes (rAF-throttled).
 *
 * The SVG is an absolutely-positioned, click-through (pointer-events:none)
 * layer over `.v3-phase-main` (which must be position:relative). Wiring is
 * suppressed below the 1100px breakpoint, where the columns stack and
 * left→right lines no longer read.
 */

interface PhaseFlowOverlayProps {
  containerRef: React.RefObject<HTMLElement | null>;
  program: ProgramSummary;
  phaseId: string;
  enabled: boolean;
}

type Line = { x1: number; y1: number; x2: number; y2: number; filled: boolean; key: string };

function readPhaseInputs(program: ProgramSummary, phaseId: string): Record<string, unknown> {
  const raw = program.rawData as Record<string, unknown> | null;
  const source = raw && typeof raw.data === "object" && raw.data !== null
    ? (raw.data as Record<string, unknown>)
    : raw ?? {};
  const phaseInputs = source.phaseInputs && typeof source.phaseInputs === "object" && !Array.isArray(source.phaseInputs)
    ? (source.phaseInputs as Record<string, Record<string, unknown>>)
    : {};
  return phaseInputs[phaseId] ?? {};
}

export default function PhaseFlowOverlay({ containerRef, program, phaseId, enabled }: PhaseFlowOverlayProps) {
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const rafRef = useRef<number | null>(null);

  // Edges come from the declared per-phase input → artifact dependency model.
  // Every target is an artifact chip that always renders, so each anchor
  // resolves. `filled` reflects whether the source field has a value.
  const edges = useMemo(() => {
    const schema = getPhaseInputSchema(phaseId);
    const persisted = readPhaseInputs(program, phaseId);
    const filledOf = (id: string) => {
      const value = persisted[id];
      return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
    };
    return derivePhaseFlowEdges(phaseId, schema.fields.map((field) => field.id))
      .map((edge) => ({ ...edge, filled: filledOf(edge.from) }));
  }, [program, phaseId]);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!enabled || (typeof window !== "undefined" && window.matchMedia("(max-width: 1100px)").matches)) {
      setLines([]);
      return;
    }
    const cRect = container.getBoundingClientRect();
    const anchor = (sel: string, side: "left" | "right") => {
      const el = container.querySelector(`[data-io-anchor="${sel}"]`) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return { x: (side === "right" ? r.right : r.left) - cRect.left, y: r.top + r.height / 2 - cRect.top };
    };
    const next: Line[] = [];
    edges.forEach((edge, index) => {
      const from = anchor(`input:${edge.from}`, "right");
      const to = anchor(`artifact:${edge.to}`, "left");
      if (!from || !to || to.x <= from.x) return;
      next.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, filled: edge.filled, key: `${edge.from}-${edge.to}-${index}` });
    });
    setSize({ w: container.clientWidth, h: container.scrollHeight });
    setLines(next);
  }, [containerRef, edges, enabled]);

  const schedule = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(measure);
  }, [measure]);

  useLayoutEffect(() => {
    schedule();
  }, [schedule]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(schedule);
    ro.observe(container);
    container.querySelectorAll(".v3-phase-col").forEach((col) => ro.observe(col));
    const mo = new MutationObserver(schedule);
    mo.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("resize", schedule);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, schedule]);

  if (!enabled || lines.length === 0 || size.w === 0) return null;

  return (
    <svg
      className="v3-flow-overlay"
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      aria-hidden="true"
    >
      {lines.map((line) => {
        const mx = (line.x1 + line.x2) / 2;
        return (
          <path
            key={line.key}
            d={`M ${line.x1} ${line.y1} C ${mx} ${line.y1}, ${mx} ${line.y2}, ${line.x2} ${line.y2}`}
            fill="none"
            stroke={line.filled ? "#2DD4BF" : "var(--v3-border)"}
            strokeWidth={line.filled ? 1.6 : 1}
            strokeOpacity={line.filled ? 0.55 : 0.28}
          />
        );
      })}
    </svg>
  );
}
