import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";
import { derivePhaseFlowEdges } from "@/v3/lib/phaseFlowEdges";
import { getDynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import { assessField } from "@/v3/components/PhaseInputsPanel";

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

type FieldTone = "green" | "amber" | "red" | "muted";
type Line = { x1: number; y1: number; x2: number; y2: number; tone: FieldTone; key: string };

// Stroke styling per source-field quality, mirroring the inline field-quality
// badges (green = complete, amber = fair, red = brief/thin, muted = empty). Each
// tone carries a brighter "soft" companion used for the source→target gradient.
const TONE_STYLE: Record<FieldTone, { stroke: string; soft: string; width: number; glow: number; dot: number }> = {
  green: { stroke: "#2DD4BF", soft: "#5EEAD4", width: 1.75, glow: 0.18, dot: 0.85 },
  amber: { stroke: "#F59E0B", soft: "#FBBF24", width: 1.75, glow: 0.16, dot: 0.8 },
  red: { stroke: "#F43F5E", soft: "#FB7185", width: 1.4, glow: 0.14, dot: 0.7 },
  muted: { stroke: "#94A3B8", soft: "#CBD5E1", width: 1.1, glow: 0.0, dot: 0.32 },
};

const TONES: FieldTone[] = ["green", "amber", "red", "muted"];

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
    const store = getDynamicSchemaStore(program.rawData);
    const schema = getPhaseInputSchema(phaseId, store);
    const persisted = readPhaseInputs(program, phaseId);
    const typeOf = new Map(schema.fields.map((field) => [field.id, field.type]));
    const toneOf = (id: string): FieldTone => {
      const value = persisted[id];
      const str = typeof value === "string" ? value : value != null ? String(value) : undefined;
      return assessField(str, typeOf.get(id) ?? "text").tone;
    };
    return derivePhaseFlowEdges(phaseId, schema.fields.map((field) => field.id), store)
      .map((edge) => ({ ...edge, tone: toneOf(edge.from) }));
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
      next.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, tone: edge.tone, key: `${edge.from}-${edge.to}-${index}` });
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
      <defs>
        <filter id="v3-flow-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
        {TONES.map((tone) => (
          <linearGradient key={tone} id={`v3-flow-grad-${tone}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={TONE_STYLE[tone].stroke} stopOpacity={0.12} />
            <stop offset="24%" stopColor={TONE_STYLE[tone].stroke} stopOpacity={0.85} />
            <stop offset="76%" stopColor={TONE_STYLE[tone].soft} stopOpacity={0.85} />
            <stop offset="100%" stopColor={TONE_STYLE[tone].soft} stopOpacity={0.18} />
          </linearGradient>
        ))}
      </defs>

      {/* Soft glow underlay — gives the connectors depth without obscuring text. */}
      {lines.map((line) => {
        const style = TONE_STYLE[line.tone];
        if (style.glow === 0) return null;
        const dx = Math.max(36, (line.x2 - line.x1) * 0.5);
        return (
          <path
            key={`glow-${line.key}`}
            d={`M ${line.x1} ${line.y1} C ${line.x1 + dx} ${line.y1}, ${line.x2 - dx} ${line.y2}, ${line.x2} ${line.y2}`}
            fill="none"
            stroke={style.soft}
            strokeWidth={style.width + 3}
            strokeOpacity={style.glow}
            strokeLinecap="round"
            filter="url(#v3-flow-glow)"
          />
        );
      })}

      {/* Crisp gradient strokes + endpoint nodes. */}
      {lines.map((line) => {
        const style = TONE_STYLE[line.tone];
        const dx = Math.max(36, (line.x2 - line.x1) * 0.5);
        return (
          <g key={line.key}>
            <path
              d={`M ${line.x1} ${line.y1} C ${line.x1 + dx} ${line.y1}, ${line.x2 - dx} ${line.y2}, ${line.x2} ${line.y2}`}
              fill="none"
              stroke={`url(#v3-flow-grad-${line.tone})`}
              strokeWidth={style.width}
              strokeLinecap="round"
            />
            <circle cx={line.x1} cy={line.y1} r={2.1} fill={style.stroke} fillOpacity={style.dot} />
            <circle cx={line.x2} cy={line.y2} r={2.4} fill={style.soft} fillOpacity={style.dot} />
          </g>
        );
      })}
    </svg>
  );
}
