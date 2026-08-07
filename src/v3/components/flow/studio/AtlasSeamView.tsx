/**
 * The Atlas as a MULTI-AREA seam diagram.
 *
 * The single-workflow swimlane (WorkflowStudio) shows one workflow's steps by
 * persona. That makes the most important thing in the atlas invisible: every
 * cross-area workflow is a SEAM, and seams are where the design breaks. All the
 * personas are single-area, so no one person sees a seam either — this view is
 * the only place a seam is made visible.
 *
 * Read-only. It renders across any selected set of areas and surfaces the three
 * things that only exist BETWEEN lanes:
 *   1. handoffs, as visible crossings (a connector that spans the lanes it jumps),
 *   2. shared entities — two areas' steps touching the same ontology entity, a
 *      dependency even without a handoff,
 *   3. coherence gaps — steps referencing entities the ontology doesn't hold,
 *      marked in place.
 * It also reports the data problems it finds (a crossing with no declared
 * handoff, a handoff with no crossing) rather than papering over them.
 */
import React, { useCallback, useMemo, useState } from "react";
import { asArray, asRecord, asText, asStrings } from "./StudioKit";
import { canonicalFrameArea } from "@/v3/components/flow/listenCoverage";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import type { ProgramSummary } from "@/new/types";

const EXTERNAL = "External";
const OTHER = "Other areas";

/** A low-saturation identity hue per area — a quiet stripe, never a signal that
 * competes with the accent (handoffs) or semantic red/amber (gaps). Stable per
 * area name so the same area is the same colour across every block. */
function areaHue(area: string): number {
  let h = 0;
  for (let i = 0; i < area.length; i += 1) h = (h * 31 + area.charCodeAt(i)) % 360;
  return h;
}

/** Resolve a step's actor to a frame area. canonicalFrameArea's word-ratio
 * scoring misplaces "Sales Operations" onto "Sales", so score by matched words
 * with an ops/operations expansion and prefer the more specific label; guard
 * obvious external actors; fall back to the shared canonicaliser. */
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
    if (hits) {
      const score = hits + (hits / words.length) * 0.5 + words.length * 0.01;
      if (!best || score > best.score) best = { area, score };
    }
  }
  return best?.area ?? canonicalFrameArea(frameAreas, actor);
}

/** Does any declared hand-off name both ends of a crossing? Loose word match. */
function handoffCovers(handoffs: string[], from: string, to: string): boolean {
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const fw = words(from); const tw = words(to);
  return handoffs.some((h) => {
    const hl = h.toLowerCase();
    return fw.some((w) => hl.includes(w)) && tw.some((w) => hl.includes(w));
  });
}

interface SeamStep {
  index: number; actor: string; action: string; system: string;
  area: string; entities: string[]; missing: string[]; evidence: string;
}
interface SeamCrossing { after: number; from: string; to: string; declared: boolean }
interface SeamWf {
  wfIndex: number; name: string; handoffs: string[]; steps: SeamStep[];
  areas: string[]; crossings: SeamCrossing[]; undeclared: number; unseenHandoffs: number;
}

export default function AtlasSeamView({ doc, program, frameAreas, onOpenArtifact, onPickWorkflow }: {
  doc: Record<string, unknown>;
  program?: ProgramSummary;
  frameAreas: string[];
  onOpenArtifact?: (id: string) => void;
  /** Open this workflow in the single-workflow editor below (consolidated view). */
  onPickWorkflow?: (wfIndex: number) => void;
}) {
  const workflows = useMemo(() => asArray(doc.workflows).map(asRecord), [doc.workflows]);

  // The ontology's entity names (+ aliases), lowercased — the set a step's
  // entity is a COHERENCE GAP against when absent.
  const ontoSet = useMemo(() => {
    const set = new Set<string>();
    const ents = program ? asArray(readArtifactDoc(program, "domainOntology")?.entities).map(asRecord) : [];
    for (const e of ents) {
      const name = asText(e.name).trim().toLowerCase();
      if (name) set.add(name);
      for (const alias of asStrings(e.aliases)) set.add(alias.trim().toLowerCase());
    }
    return set;
  }, [program]);
  const resolveArea = useCallback((actor: string) => resolveActorArea(actor, frameAreas), [frameAreas]);

  const wfData = useMemo<SeamWf[]>(() => workflows.map((w, wfIndex) => {
    const handoffs = asStrings(w.handoffs);
    const steps: SeamStep[] = asArray(w.steps).map(asRecord).map((s, index) => {
      const entities = asStrings(s.entities);
      return {
        index, actor: asText(s.actor).trim() || "Unassigned", action: asText(s.action),
        system: asText(s.system), area: resolveArea(asText(s.actor)),
        entities, missing: entities.filter((e) => !ontoSet.has(e.trim().toLowerCase())),
        evidence: asText(s.evidence),
      };
    });
    const crossings: SeamCrossing[] = [];
    for (let i = 0; i < steps.length - 1; i += 1) {
      if (steps[i].area !== steps[i + 1].area) {
        const from = steps[i].area, to = steps[i + 1].area;
        crossings.push({ after: i, from, to, declared: handoffCovers(handoffs, from, to) });
      }
    }
    const areas: string[] = [];
    for (const s of steps) if (!areas.includes(s.area)) areas.push(s.area);
    const undeclared = crossings.filter((c) => !c.declared).length;
    // Declared hand-offs whose crossing never appears in the step sequence.
    const unseenHandoffs = handoffs.filter((h) => {
      const hasCrossing = crossings.some((c) => handoffCovers([h], c.from, c.to));
      return !hasCrossing && /→|->|↔|→|to /i.test(h);
    }).length;
    return { wfIndex, name: asText(w.name) || `Workflow ${wfIndex + 1}`, handoffs, steps, areas, crossings, undeclared, unseenHandoffs };
  }), [workflows, resolveArea, ontoSet]);

  // Areas actually present in the atlas, in the frame's order (external/other last).
  const presentAreas = useMemo(() => {
    const present = new Set<string>();
    wfData.forEach((wf) => wf.areas.forEach((a) => present.add(a)));
    const ordered = frameAreas.filter((a) => present.has(a));
    for (const extra of [EXTERNAL, OTHER]) if (present.has(extra)) ordered.push(extra);
    // any area not in the frame list (shouldn't happen) appended
    [...present].forEach((a) => { if (!ordered.includes(a)) ordered.push(a); });
    return ordered;
  }, [wfData, frameAreas]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(presentAreas));
  const [focusWf, setFocusWf] = useState<number | "all">("all");
  // Keep selection valid if the data changes underneath (area list shifts).
  const sel = useMemo(() => new Set([...selected].filter((a) => presentAreas.includes(a))), [selected, presentAreas]);
  const effSel = useMemo(() => (sel.size ? sel : new Set(presentAreas)), [sel, presentAreas]); // empty selection reads as all

  const toggleArea = (a: string) => setSelected((prev) => {
    const next = new Set(prev.size ? prev : presentAreas);
    if (next.has(a)) next.delete(a); else next.add(a);
    return next;
  });

  // Workflows in scope: any that touch a selected area.
  const scope = useMemo(() => wfData.filter((wf) =>
    (focusWf === "all" || focusWf === wf.wfIndex)
    && wf.areas.some((a) => effSel.has(a)),
  ), [wfData, focusWf, effSel]);

  // Interdependencies (crossings, shared entities, cross-area findings) only
  // mean something once MORE THAN ONE area is in view — surface them then.
  const showInterdeps = effSel.size > 1;

  // Shared entities: an ontology entity touched by steps in ≥2 SELECTED areas
  // (across the in-scope workflows) — a cross-area dependency, visible or not.
  const sharedEntities = useMemo(() => {
    const map = new Map<string, { areas: Set<string>; gap: boolean }>();
    scope.forEach((wf) => wf.steps.forEach((s) => {
      if (!effSel.has(s.area)) return;
      s.entities.forEach((e) => {
        const rec = map.get(e) ?? { areas: new Set<string>(), gap: !ontoSet.has(e.trim().toLowerCase()) };
        rec.areas.add(s.area);
        map.set(e, rec);
      });
    }));
    return [...map.entries()]
      .filter(([, v]) => v.areas.size >= 2)
      .map(([entity, v]) => ({ entity, areas: [...v.areas], gap: v.gap }))
      .sort((a, b) => b.areas.length - a.areas.length || a.entity.localeCompare(b.entity));
  }, [scope, effSel, ontoSet]);

  const findings = useMemo(() => {
    const undeclared = scope.reduce((n, wf) => n + wf.undeclared, 0);
    const unseen = scope.reduce((n, wf) => n + wf.unseenHandoffs, 0);
    const gapSteps = scope.reduce((n, wf) => n + wf.steps.filter((s) => s.missing.length).length, 0);
    return { undeclared, unseen, gapSteps };
  }, [scope]);

  const laneStyle = (area: string): React.CSSProperties => ({ ["--area" as string]: `hsl(${areaHue(area)} 46% 52%)` });
  const rowOrderFor = useCallback((wf: SeamWf): string[] => {
    // Stable lane order per block: selected present areas the wf touches, in the
    // global order, then a single "other" lane if it also leaves the selection.
    const rows = presentAreas.filter((a) => effSel.has(a) && wf.areas.includes(a));
    if (wf.areas.some((a) => !effSel.has(a))) rows.push(OTHER);
    return rows;
  }, [presentAreas, effSel]);

  if (!workflows.length) {
    return <div className="v3fs-stu-empty">No workflows on record yet — regenerate the Current-State Atlas once the transcripts are in.</div>;
  }

  return (
    <div className="v3fs-seam">
      {/* AREA MULTI-SELECT — quick to change; a comparison tool, not a form. */}
      <div className="v3fs-seam-pick" role="group" aria-label="Areas to compare">
        <span className="v3fs-seam-pick-l">Areas</span>
        {presentAreas.map((area) => {
          const on = effSel.has(area);
          return (
            <button key={area} type="button" aria-pressed={on} style={laneStyle(area)}
              className={`v3fs-seam-chip${on ? " on" : ""}`} onClick={() => toggleArea(area)}>
              <span className="v3fs-seam-chip-dot" aria-hidden="true" />{area}
            </button>
          );
        })}
        <span className="v3fs-seam-pick-acts">
          <button type="button" className="v3fs-a" onClick={() => setSelected(new Set(presentAreas))}>All</button>
          <button type="button" className="v3fs-a" onClick={() => setSelected(new Set())}>None</button>
        </span>
      </div>
      <div className="v3fs-seam-controls">
        {showInterdeps
          ? <span className="v3fs-seam-hint" aria-hidden="true" />
          : <span className="v3fs-seam-hint">Select more than one area to reveal the crossings and shared entities between them.</span>}
        <label className="v3fs-seam-wfsel">
          <span>Workflow</span>
          <select value={String(focusWf)} onChange={(e) => setFocusWf(e.target.value === "all" ? "all" : Number(e.target.value))}>
            <option value="all">All in scope ({scope.length})</option>
            {wfData.map((wf) => <option key={wf.wfIndex} value={String(wf.wfIndex)}>{wf.name}</option>)}
          </select>
        </label>
      </div>

      {/* Coherence + data-problem summary — the findings, not hidden in a doc. */}
      {(findings.gapSteps || findings.undeclared || findings.unseen) ? (
        <div className="v3fs-seam-findings" role="status">
          {findings.gapSteps ? <span className="fnd gap">⚠ {findings.gapSteps} step{findings.gapSteps === 1 ? "" : "s"} reference an entity the ontology doesn’t hold</span> : null}
          {findings.undeclared ? <span className="fnd cross">◇ {findings.undeclared} crossing{findings.undeclared === 1 ? "" : "s"} with no declared hand-off</span> : null}
          {findings.unseen ? <span className="fnd unseen">↯ {findings.unseen} declared hand-off{findings.unseen === 1 ? "" : "s"} with no crossing in the steps</span> : null}
        </div>
      ) : null}

      {/* SHARED ENTITIES — dependencies between areas that no hand-off shows.
          Only meaningful with more than one area in view. */}
      {showInterdeps && sharedEntities.length ? (
        <div className="v3fs-seam-shared">
          <div className="v3fs-seam-shared-h">Shared entities <em>across selected areas — a dependency even without a hand-off</em></div>
          <div className="v3fs-seam-shared-list">
            {sharedEntities.map(({ entity, areas, gap }) => (
              <span key={entity} className={`v3fs-seam-shent${gap ? " gap" : ""}`}
                title={gap ? `${entity} — not defined in the ontology (coherence gap)` : `${entity} — touched by ${areas.join(", ")}`}
                role={onOpenArtifact ? "link" : undefined} tabIndex={onOpenArtifact ? 0 : undefined}
                onClick={() => { if (!gap) onOpenArtifact?.("domain-ontology"); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !gap) onOpenArtifact?.("domain-ontology"); }}>
                {gap ? "⚠ " : ""}{entity}
                <span className="v3fs-seam-shent-areas">
                  {areas.map((a) => <i key={a} style={laneStyle(a)} aria-hidden="true" />)}
                  <em>{areas.length} areas</em>
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {scope.length === 0 ? (
        <div className="v3fs-stu-empty">No workflows touch the selected areas. Widen the selection.</div>
      ) : (
        <div className="v3fs-seam-blocks">
          {scope.map((wf) => {
            const rows = rowOrderFor(wf);
            const rowOf = (area: string) => { const i = rows.indexOf(effSel.has(area) ? area : OTHER); return i < 0 ? rows.length - 1 : i; };
            const cols = `118px ${wf.steps.map(() => "minmax(108px,150px) 14px").join(" ")}`;
            const areaPath = wf.areas.filter((a) => a !== OTHER);
            return (
              <section key={wf.wfIndex} className="v3fs-seam-wf">
                <header className="v3fs-seam-wf-h">
                  <div className="v3fs-seam-wf-hl">
                    {onPickWorkflow
                      ? <button type="button" className="v3fs-seam-wf-open" onClick={() => onPickWorkflow(wf.wfIndex)}
                          title="Open this workflow in the editor below">{wf.name}<span className="v3fs-seam-wf-open-i" aria-hidden="true">edit ↓</span></button>
                      : <h4>{wf.name}</h4>}
                    <div className="v3fs-seam-wf-path" aria-label="area path">
                      {areaPath.map((a, i) => (
                        <React.Fragment key={a + i}>
                          {i ? <span className="v3fs-seam-arr" aria-hidden="true">→</span> : null}
                          <span className="v3fs-seam-path-a" style={laneStyle(a)}>{a}</span>
                        </React.Fragment>
                      ))}
                      {areaPath.length > 1
                        ? <span className="v3fs-seam-seambadge">seam</span>
                        : wf.handoffs.length
                          ? <span className="v3fs-seam-seambadge hoff" title="A seam declared only in the hand-off field — the steps don’t cross areas">seam · hand-off only</span>
                          : <span className="v3fs-seam-onebadge">single area</span>}
                    </div>
                  </div>
                  {wf.handoffs.length ? (
                    <div className="v3fs-seam-wf-hoffs" aria-label="declared hand-offs">
                      <span className="v3fs-seam-hoffs-l">hand-offs</span>
                      {wf.handoffs.map((h, i) => <span key={i} className="v3fs-seam-hoff">{h}</span>)}
                    </div>
                  ) : null}
                </header>
                <div className="v3fs-seam-scroll">
                  <div className="v3fs-seam-grid" style={{ gridTemplateColumns: cols, gridTemplateRows: `repeat(${rows.length}, minmax(72px, auto))` }}>
                    {/* lane stripes + labels */}
                    {rows.map((area, r) => (
                      <React.Fragment key={`lane-${area}-${r}`}>
                        <div className="v3fs-seam-band" style={{ gridRow: r + 1, gridColumn: "1 / -1", ...laneStyle(area) }} aria-hidden="true" />
                        <div className={`v3fs-seam-lane${area === OTHER || area === EXTERNAL ? " muted" : ""}`} style={{ gridRow: r + 1, gridColumn: 1, ...laneStyle(area) }}>
                          <span className="v3fs-seam-lane-dot" aria-hidden="true" />{area}
                        </div>
                      </React.Fragment>
                    ))}
                    {/* step tiles */}
                    {wf.steps.map((s) => {
                      const r = rowOf(s.area);
                      const out = !effSel.has(s.area);
                      return (
                        <div key={`st-${s.index}`} className={`v3fs-seam-cell${out ? " out" : ""}`}
                          style={{ gridColumn: 2 + s.index * 2, gridRow: r + 1 }}>
                          <div className={`v3fs-seam-tile${s.missing.length ? " has-gap" : ""}`} style={laneStyle(s.area)}
                            tabIndex={0} title={s.evidence || undefined}>
                            <span className="v3fs-seam-tile-n" aria-hidden="true">{s.index + 1}</span>
                            <span className="v3fs-seam-tile-act">{s.action || "—"}</span>
                            <span className="v3fs-seam-tile-actor">{s.actor}</span>
                            {(s.system || s.entities.length) ? (
                              <span className="v3fs-seam-tile-meta">
                                {s.system ? <span className="v3fs-seam-sys">{s.system}</span> : null}
                                {s.entities.map((e) => {
                                  const gap = s.missing.includes(e);
                                  return (
                                    <span key={e} className={`v3fs-seam-ent${gap ? " gap" : ""}`}
                                      title={gap ? `${e} — not in the ontology (coherence gap)` : `${e} — in the ontology`}
                                      role={onOpenArtifact && !gap ? "link" : undefined} tabIndex={onOpenArtifact && !gap ? 0 : undefined}
                                      onClick={() => { if (!gap) onOpenArtifact?.("domain-ontology"); }}
                                      onKeyDown={(ev) => { if (ev.key === "Enter" && !gap) onOpenArtifact?.("domain-ontology"); }}>
                                      {gap ? "⚠ " : ""}{e}
                                    </span>
                                  );
                                })}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    {/* crossings — the connectors that make a seam a shape */}
                    {wf.steps.slice(0, -1).map((s, i) => {
                      const next = wf.steps[i + 1];
                      const r0 = rowOf(s.area), r1 = rowOf(next.area);
                      const cross = r0 !== r1;
                      const crossing = wf.crossings.find((c) => c.after === i);
                      const declared = crossing ? crossing.declared : true;
                      const top = Math.min(r0, r1) + 1, bot = Math.max(r0, r1) + 2;
                      const dir = r1 > r0 ? "down" : r1 < r0 ? "up" : "flat";
                      return (
                        <div key={`cx-${i}`}
                          className={`v3fs-seam-cx ${dir}${cross ? " cross" : ""}${cross && !declared ? " undeclared" : ""}`}
                          style={{ gridColumn: 3 + i * 2, gridRow: cross ? `${top} / ${bot}` : r0 + 1 }}
                          title={cross ? `${s.area} → ${next.area}${declared ? "" : " — no declared hand-off"}` : undefined}>
                          <span className="v3fs-seam-cx-line" aria-hidden="true" />
                          <span className="v3fs-seam-cx-head" aria-hidden="true">{dir === "up" ? "↑" : dir === "down" ? "↓" : "→"}</span>
                          {cross && !declared ? <span className="v3fs-seam-cx-warn" aria-hidden="true">◇</span> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Legend — three signals kept distinct. */}
      <div className="v3fs-seam-legend" aria-hidden="true">
        <span><i className="lg-cross" />hand-off crossing</span>
        <span><i className="lg-undeclared" />crossing, no declared hand-off</span>
        <span><i className="lg-gap" />entity not in the ontology</span>
        <span><i className="lg-shared" />shared across areas</span>
      </div>
    </div>
  );
}
