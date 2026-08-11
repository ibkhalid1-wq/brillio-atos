/**
 * The Atlas as a TWO-DIMENSIONAL grid: area across, lifecycle phase down.
 *
 * The swimlane atlas has one axis (area). The vertical ordering READS as a
 * lifecycle to a human but is array position to the system. This view adds the
 * second axis for real: the lifecycle phase DERIVED from the ontology's
 * `produces` relation graph (journeyGraph.ts). A workflow lands in the cell
 * where its derived phase meets its owning area.
 *
 * The payoff is the SEAM AS A COORDINATE. Today a seam is an inference ("this
 * workflow crosses areas"). On the grid it becomes a cell you can point at — a
 * specific lifecycle phase meeting a specific function. Contract→Revenue at the
 * Legal/Finance boundary is a cell, not something a coverage matrix infers.
 *
 * Everything vertical here is DERIVED, never asserted — phase assignment has no
 * field in the schema (F-G). Derived placements are marked distinctly (the °
 * glyph + dotted underline) so nothing reads as confirmed. Read-only; no write
 * path; invents no phase field in the stored artifact.
 *
 * Area resolution + coherence helpers mirror AtlasSeamView (kept local to avoid
 * coupling; the seam view remains the authority on seam rendering).
 */
import React, { useMemo } from "react";
import { asArray, asRecord, asText, asStrings } from "./StudioKit";
import { canonicalFrameArea } from "@/v3/components/flow/listenCoverage";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { deriveJourneys, placeWorkflows } from "@/v3/lib/journeyGraph";
import type { ProgramSummary } from "@/new/types";

const EXTERNAL = "External";
const OTHER = "Other";

function areaHue(area: string): number {
  let h = 0;
  for (let i = 0; i < area.length; i += 1) h = (h * 31 + area.charCodeAt(i)) % 360;
  return h;
}
function resolveActorArea(actor: string, frameAreas: string[]): string {
  const a = actor.trim().toLowerCase();
  if (!a) return OTHER;
  if (/\b(end customer|customer|client|prospect|external|vendor)\b/.test(a) && !/success/.test(a)) return EXTERNAL;
  const exact = frameAreas.find((f) => f.toLowerCase() === a);
  if (exact) return exact;
  let best: { area: string; score: number } | null = null;
  for (const area of frameAreas) {
    const words = area.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
    let hits = 0;
    for (const w of words) {
      const stem = w.replace(/s$/, "");
      if (a.includes(w) || a.includes(stem) || (w === "ops" && /oper/.test(a))) hits += 1;
    }
    if (hits) { const score = hits + (hits / words.length) * 0.5 + words.length * 0.01; if (!best || score > best.score) best = { area, score }; }
  }
  return best?.area ?? canonicalFrameArea(frameAreas, actor);
}
function handoffCovers(handoffs: string[], from: string, to: string): boolean {
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const fw = words(from); const tw = words(to);
  return handoffs.some((h) => { const hl = h.toLowerCase(); return fw.some((w) => hl.includes(w)) && tw.some((w) => hl.includes(w)); });
}

interface GridWf {
  wfIndex: number; name: string; owningArea: string; phase: number | null;
  viaEntity: string | null; viaCount: number;
  crossAreas: string[]; undeclared: number; unseenHandoffs: number; gapSteps: number;
}

export default function AtlasLifecycleGrid({ doc, program, frameAreas, onPickWorkflow }: {
  doc: Record<string, unknown>;
  program?: ProgramSummary;
  frameAreas: string[];
  onPickWorkflow?: (wfIndex: number) => void;
}) {
  const ontology = useMemo(() => (program ? (readArtifactDoc(program, "domainOntology") as Record<string, unknown>) ?? {} : {}), [program]);
  const jg = useMemo(() => deriveJourneys(ontology), [ontology]);
  const placed = useMemo(() => placeWorkflows(doc, jg), [doc, jg]);

  const ontoSet = useMemo(() => {
    const set = new Set<string>();
    for (const e of asArray(ontology.entities).map(asRecord)) {
      const n = asText(e.name).trim().toLowerCase(); if (n) set.add(n);
      for (const al of asStrings(e.aliases)) set.add(al.trim().toLowerCase());
    }
    return set;
  }, [ontology]);

  const workflows = useMemo(() => asArray(doc.workflows).map(asRecord), [doc.workflows]);

  const gridWfs = useMemo<GridWf[]>(() => workflows.map((w, wfIndex) => {
    const handoffs = asStrings(w.handoffs);
    const steps = asArray(w.steps).map(asRecord);
    const stepAreas = steps.map((s) => resolveActorArea(asText(s.actor), frameAreas));
    const crossAreas: string[] = [];
    for (const a of stepAreas) if (a && a !== OTHER && a !== EXTERNAL && !crossAreas.includes(a)) crossAreas.push(a);
    // crossings between consecutive steps
    let undeclared = 0; const seen = new Set<string>();
    for (let i = 0; i < stepAreas.length - 1; i += 1) {
      const from = stepAreas[i], to = stepAreas[i + 1];
      if (from !== to && from && to) { seen.add(`${from}»${to}`); if (!handoffCovers(handoffs, from, to)) undeclared += 1; }
    }
    const unseenHandoffs = handoffs.filter((h) => {
      const hw = h.toLowerCase();
      return !stepAreas.some((a, i) => i < stepAreas.length - 1 && stepAreas[i] !== stepAreas[i + 1]
        && (hw.includes(stepAreas[i].toLowerCase()) || hw.includes(stepAreas[i + 1].toLowerCase())));
    }).length;
    const gapSteps = steps.filter((s) => asStrings(s.entities).some((e) => !ontoSet.has(e.trim().toLowerCase()))).length;
    const p = placed[wfIndex];
    const rawArea = asText(w.area).trim();
    const owningArea = rawArea ? resolveActorArea(rawArea, frameAreas) : (crossAreas[0] ?? OTHER);
    return { wfIndex, name: p.name, owningArea, phase: p.phase, viaEntity: p.viaEntity, viaCount: p.viaCount, crossAreas, undeclared, unseenHandoffs, gapSteps };
  }), [workflows, frameAreas, ontoSet, placed]);

  // columns = owning areas, ordered by the earliest phase they carry (reads
  // diagonally like a lifecycle), then name.
  const columns = useMemo(() => {
    const byArea = new Map<string, number>();
    for (const g of gridWfs) {
      const ph = g.phase ?? 99;
      byArea.set(g.owningArea, Math.min(byArea.get(g.owningArea) ?? 99, ph));
    }
    return [...byArea.keys()].sort((a, b) => (byArea.get(a)! - byArea.get(b)!) || a.localeCompare(b));
  }, [gridWfs]);

  const hasUnplaced = gridWfs.some((g) => g.phase === null);
  const rows = useMemo(() => {
    const r = jg.phases.map((p) => p.depth);
    return hasUnplaced ? [...r, null] : r;
  }, [jg.phases, hasUnplaced]);

  const cellOf = (phase: number | null, area: string) => gridWfs.filter((g) => g.phase === phase && g.owningArea === area);
  const bandFor = (depth: number) => jg.phases.find((p) => p.depth === depth);

  const chipStyle = (area: string): React.CSSProperties => ({ borderLeft: `3px solid hsl(${areaHue(area)} 46% 52%)` });

  if (!workflows.length) return <div className="v3fs-stu-empty">No workflows on record yet.</div>;

  return (
    <div className="v3fs-lgrid">
      {/* derived-journey context — what the produces graph let us infer, and didn't */}
      <div className="v3fs-lgrid-ctx">
        <div className="v3fs-lgrid-ctx-row">
          <span className="v3fs-lgrid-tag">Derived axis</span>
          <span>Lifecycle phase is <b>derived</b> from the ontology&apos;s <code>produces</code> graph
            ({jg.verb.produces}/{jg.verb.total} relations use the generic verb) — there is no phase field in the artifact (F-G).
            Every vertical placement is marked <span className="v3fs-der">°derived</span>, never asserted.</span>
        </div>
        <div className="v3fs-lgrid-ctx-row">
          <span className="v3fs-lgrid-tag">Candidates</span>
          <span>
            {jg.totalMaximalPaths} maximal chains through the graph — Aura reports them, it does not pick one.
            Leading: {jg.candidateJourneys.slice(0, 3).map((j) => j.path.join(" → ")).join("  ·  ") || "—"}.
            {" "}The <code>produces</code> verb can&apos;t tell progression from a sub-record, so forks
            (e.g. Opportunity → {jg.forks.find((f) => f.entity === "Opportunity")?.children.length ?? 0} children) are ambiguous.
          </span>
        </div>
        {jg.orphans.length > 0 && (
          <div className="v3fs-lgrid-ctx-row">
            <span className="v3fs-lgrid-tag">Off-chain</span>
            <span>{jg.orphans.length} entities sit on no lifecycle edge: {jg.orphans.join(", ")}.</span>
          </div>
        )}
      </div>

      <div className="v3fs-lgrid-scroll">
        <div className="v3fs-lgrid-table" style={{ gridTemplateColumns: `170px repeat(${columns.length}, minmax(150px, 1fr))` }}>
          {/* header row */}
          <div className="v3fs-lgrid-corner">phase ↓ / area →</div>
          {columns.map((area) => (
            <div key={area} className="v3fs-lgrid-colh" style={{ borderTop: `3px solid hsl(${areaHue(area)} 46% 52%)` }}>{area}</div>
          ))}
          {/* body */}
          {rows.map((depth) => {
            const band = depth === null ? null : bandFor(depth);
            return (
              <React.Fragment key={String(depth)}>
                <div className="v3fs-lgrid-rowh">
                  {depth === null
                    ? <><b>Unplaced</b><span className="v3fs-lgrid-band">no on-chain entity touched</span></>
                    : <><b>Phase {depth}</b><span className="v3fs-lgrid-headline">{band?.headline}</span>
                        <span className="v3fs-lgrid-band">{band?.entities.join(", ")}</span></>}
                </div>
                {columns.map((area) => {
                  const cell = cellOf(depth, area);
                  const cellKey = `${area}::${depth}`;
                  const seamish = cell.some((g) => g.crossAreas.length > 1);
                  return (
                    <div key={cellKey} className={`v3fs-lgrid-cell${cell.length ? "" : " is-empty"}${seamish ? " is-seam" : ""}`}
                      data-cell={cellKey} data-phase={String(depth)} data-area={area}>
                      {cell.map((g) => (
                        // NAMED, never read off its own face. The chip stacks a workflow
                        // name, a derived-from marker and up to three count badges, and
                        // a name computed from all of that ran them together as
                        // "Escalation Management°Escalation→Sales◇1" — degree sign,
                        // rightwards arrow and white diamond, each announced by its
                        // Unicode name in the middle of the words. The badges are a
                        // visual shorthand; this spells out what they abbreviate.
                        <button key={g.wfIndex} type="button" className="v3fs-lgrid-chip" style={chipStyle(area)}
                          aria-label={[
                            `Open the workflow ${g.name}`,
                            g.viaEntity ? `placed here via ${g.viaEntity}` : "",
                            g.crossAreas.filter((a) => a !== area).length
                              ? `crosses into ${g.crossAreas.filter((a) => a !== area).join(", ")}` : "",
                            g.gapSteps > 0 ? `${g.gapSteps} step${g.gapSteps === 1 ? "" : "s"} reference an entity the ontology lacks` : "",
                            g.undeclared > 0 ? `${g.undeclared} area crossing${g.undeclared === 1 ? "" : "s"} with no declared hand-off` : "",
                            g.unseenHandoffs > 0 ? `${g.unseenHandoffs} declared hand-off${g.unseenHandoffs === 1 ? "" : "s"} with no actual crossing` : "",
                          ].filter(Boolean).join(" — ")}
                          onClick={() => onPickWorkflow?.(g.wfIndex)} title={`${g.name} — phase ${g.phase} derived from ${g.viaEntity} (${g.viaCount}×)`}>
                          <span className="v3fs-lgrid-chip-name">{g.name}</span>
                          <span className="v3fs-lgrid-chip-meta">
                            {g.viaEntity && <span className="v3fs-der" title="derived placement">°{g.viaEntity}</span>}
                            {g.crossAreas.filter((a) => a !== area).map((a) => (
                              <span key={a} className="v3fs-lgrid-cross" title={`crosses into ${a}`}>→{a}</span>
                            ))}
                          </span>
                          <span className="v3fs-lgrid-marks">
                            {g.gapSteps > 0 && <span className="v3fs-mark v3fs-mark--gap" title={`${g.gapSteps} step(s) reference an entity the ontology lacks`}>⚠{g.gapSteps}</span>}
                            {g.undeclared > 0 && <span className="v3fs-mark v3fs-mark--cross" title={`${g.undeclared} area crossing(s) with no declared handoff`}>⤫{g.undeclared}</span>}
                            {g.unseenHandoffs > 0 && <span className="v3fs-mark v3fs-mark--unseen" title={`${g.unseenHandoffs} declared handoff(s) with no actual crossing`}>◇{g.unseenHandoffs}</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="v3fs-lgrid-legend">
        <span><span className="v3fs-der">°entity</span> phase derived from this entity</span>
        <span><span className="v3fs-lgrid-cross">→Area</span> workflow crosses into another function (a seam)</span>
        <span><span className="v3fs-mark v3fs-mark--gap">⚠</span> step references a missing entity</span>
        <span><span className="v3fs-mark v3fs-mark--cross">⤫</span> crossing, no declared handoff</span>
        <span><span className="v3fs-mark v3fs-mark--unseen">◇</span> handoff declared, never crossed</span>
        <span className="v3fs-lgrid-seamnote">Shaded cells hold a cross-area workflow — the seam, now a coordinate.</span>
      </div>
    </div>
  );
}
