import React, { useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";

/**
 * PhaseInputArtifactMap — a collapsible (collapsed by default) graphical view of
 * how this phase's *input fields* feed its *artifacts*. It sits in the middle
 * column, physically between the Input fields card (left) and the Artifacts card
 * (right), and draws connector lines that run edge-to-edge — the left endpoints
 * meet the input card, the right endpoints meet the artifacts card — so the map
 * reads as wiring between the two real cards rather than re-listing their
 * contents (avoids the redundant duplicate node labels).
 *
 * Pure/presentational: it reads input completeness from the program snapshot and
 * draws an SVG flow diagram. No DOM measurement — endpoints are distributed
 * mathematically and the lines reach the column edges adjacent to each card.
 */

type ArtifactDef = { id: string; label: string };

const DEFAULT_ARTIFACTS: ArtifactDef[] = [
  { id: "narrative", label: "Narrative" },
  { id: "deck", label: "Status deck" },
  { id: "gate-review", label: "Gate review" },
];

const PHASE_ARTIFACTS: Record<string, ArtifactDef[]> = {
  strategy: [
    { id: "narrative", label: "Strategy narrative" },
    { id: "deck", label: "Status deck" },
    { id: "gate-review", label: "Gate review" },
  ],
  mobilise: [
    { id: "narrative", label: "Mobilisation plan" },
    { id: "milestone", label: "Milestones" },
    { id: "gate-review", label: "Gate review" },
  ],
  discover: [
    { id: "narrative", label: "Discovery findings" },
    { id: "risk", label: "RAID log" },
    { id: "gate-review", label: "Gate review" },
  ],
  design: [
    { id: "narrative", label: "Target operating model" },
    { id: "deck", label: "Status deck" },
    { id: "gate-review", label: "Gate review" },
  ],
  build: [
    { id: "narrative", label: "Delivery narrative" },
    { id: "milestone", label: "Milestones" },
    { id: "gate-review", label: "Gate review" },
  ],
  operate: [
    { id: "narrative", label: "Go-live plan" },
    { id: "deck", label: "Status deck" },
    { id: "gate-review", label: "Gate review" },
  ],
  govern: [
    { id: "narrative", label: "Governance pack" },
    { id: "risk", label: "Control matrix" },
    { id: "gate-review", label: "Gate review" },
  ],
  optimize: [
    { id: "narrative", label: "Optimisation plan" },
    { id: "deck", label: "Status deck" },
    { id: "gate-review", label: "Gate review" },
  ],
  valuerealize: [
    { id: "narrative", label: "Benefits narrative" },
    { id: "closure", label: "Closure pack" },
    { id: "gate-review", label: "Gate review" },
  ],
};

interface PhaseInputArtifactMapProps {
  program: ProgramSummary;
  phaseId: string;
  defaultOpen?: boolean;
}

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

export default function PhaseInputArtifactMap({ program, phaseId, defaultOpen = false }: PhaseInputArtifactMapProps) {
  const [open, setOpen] = useState(defaultOpen);

  const { inputs, artifacts, edges, filledCount } = useMemo(() => {
    const schema = getPhaseInputSchema(phaseId);
    const persisted = readPhaseInputs(program, phaseId);
    const inputs = schema.fields.map((field) => ({
      id: field.id,
      required: field.required,
      filled: typeof persisted[field.id] === "string"
        ? Boolean((persisted[field.id] as string).trim())
        : Boolean(persisted[field.id]),
    }));

    const artifacts = PHASE_ARTIFACTS[phaseId] ?? DEFAULT_ARTIFACTS;
    const narrativeId = artifacts[0]?.id;
    const gateId = artifacts.find((a) => a.id === "gate-review")?.id;
    const secondaryId = artifacts.find((a) => a.id !== narrativeId && a.id !== gateId)?.id;

    // Every input feeds the primary artifact; required inputs additionally feed
    // the gate review; alternating inputs feed the secondary artifact.
    const edges: Array<{ from: string; to: string }> = [];
    inputs.forEach((input, index) => {
      if (narrativeId) edges.push({ from: input.id, to: narrativeId });
      if (gateId && input.required) edges.push({ from: input.id, to: gateId });
      if (secondaryId && index % 2 === 0) edges.push({ from: input.id, to: secondaryId });
    });

    const filledCount = inputs.filter((i) => i.filled).length;
    return { inputs, artifacts, edges, filledCount };
  }, [program, phaseId]);

  const padY = 12;
  const rowH = 26;
  const rows = Math.max(inputs.length, artifacts.length, 1);
  const height = rows * rowH + padY * 2;
  const width = 240;
  // Endpoints sit flush against the column edges so the lines visually meet the
  // adjacent Input card (left) and Artifacts card (right).
  const leftX = 3;
  const rightX = width - 3;

  const inputY = (i: number) => padY + ((i + 0.5) * (height - padY * 2)) / Math.max(inputs.length, 1);
  const artifactY = (i: number) => padY + ((i + 0.5) * (height - padY * 2)) / Math.max(artifacts.length, 1);

  const inputIndex = new Map(inputs.map((input, index) => [input.id, index]));
  const artifactIndex = new Map(artifacts.map((artifact, index) => [artifact.id, index]));

  return (
    <div className="v3-iomap">
      <button
        type="button"
        className="v3-iomap-toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <div className="v3-iomap-toggle-titles">
          <span className="v3-iomap-toggle-title">Input → artifact flow</span>
          <span className="v3-iomap-toggle-sub">
            {filledCount}/{inputs.length} inputs feeding {artifacts.length} artifacts · {open ? "collapse" : "expand"}
          </span>
        </div>
        <span className="v3-iomap-toggle-glyph">{open ? "▴" : "▾"}</span>
      </button>

      {open ? (
        <div className="v3-iomap-body">
          <div className="v3-iomap-ends">
            <span>Input fields</span>
            <span>Artifacts</span>
          </div>
          <svg
            className="v3-iomap-svg"
            viewBox={`0 0 ${width} ${height}`}
            width="100%"
            height={height}
            preserveAspectRatio="none"
            role="img"
            aria-label="Connections from phase input fields to artifacts"
          >
            {/* connectors — run edge-to-edge between the input card and artifacts card */}
            {edges.map((edge, index) => {
              const fi = inputIndex.get(edge.from);
              const ai = artifactIndex.get(edge.to);
              if (fi === undefined || ai === undefined) return null;
              const y1 = inputY(fi);
              const y2 = artifactY(ai);
              const filled = inputs[fi]?.filled;
              return (
                <path
                  key={`${edge.from}-${edge.to}-${index}`}
                  d={`M ${leftX} ${y1} C ${width * 0.5} ${y1}, ${width * 0.5} ${y2}, ${rightX} ${y2}`}
                  fill="none"
                  stroke={filled ? "#2DD4BF" : "var(--v3-border)"}
                  strokeWidth={filled ? 1.6 : 1}
                  strokeOpacity={filled ? 0.7 : 0.4}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {/* input endpoints — flush to the left (input card) edge */}
            {inputs.map((input, index) => (
              <circle
                key={`in-${input.id}`}
                cx={leftX}
                cy={inputY(index)}
                r={3.5}
                fill={input.filled ? "#2DD4BF" : "var(--v3-surface)"}
                stroke={input.filled ? "#2DD4BF" : "var(--v3-border)"}
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {/* artifact endpoints — flush to the right (artifacts card) edge */}
            {artifacts.map((artifact, index) => (
              <circle
                key={`art-${artifact.id}`}
                cx={rightX}
                cy={artifactY(index)}
                r={3.5}
                fill="#A78BFA"
                stroke="#A78BFA"
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <div className="v3-iomap-legend">
            <span className="v3-iomap-legend-item"><i style={{ background: "#2DD4BF" }} /> Input field</span>
            <span className="v3-iomap-legend-item"><i style={{ background: "#A78BFA" }} /> Artifact</span>
            <span className="v3-iomap-legend-note">Solid links = field captured · faint = still empty</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
