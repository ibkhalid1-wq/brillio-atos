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
import React, { useCallback, useEffect, useMemo, useState } from "react";
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

export default function AtlasSeamView({ doc, program, frameAreas, onOpenArtifact, onPickWorkflow, onChange, editable }: {
  doc: Record<string, unknown>;
  program?: ProgramSummary;
  frameAreas: string[];
  onOpenArtifact?: (id: string) => void;
  /** Open this workflow in the single-workflow editor below (consolidated view). */
  onPickWorkflow?: (wfIndex: number) => void;
  /** Write the whole doc back (same setter the single-workflow editor uses). */
  onChange?: (next: Record<string, unknown>) => void;
  /** When true (studio not locked), tiles become inline-editable with CRUD. */
  editable?: boolean;
}) {
  const canEdit = editable && !!onChange;
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

  // null = "all areas" (tracks the data as it loads); a Set is an explicit
  // choice — an empty Set means the user cleared the selection.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [focusWf, setFocusWf] = useState<number | "all">("all");
  const [findingFilter, setFindingFilter] = useState<"gap" | "cross" | "unseen" | null>(null);
  // Keep selection valid if the data changes underneath (area list shifts).
  const effSel = useMemo(() => (selected === null
    ? new Set(presentAreas)
    : new Set([...selected].filter((a) => presentAreas.includes(a)))), [selected, presentAreas]);

  const toggleArea = (a: string) => setSelected((prev) => {
    const next = new Set(prev === null ? presentAreas : prev);
    if (next.has(a)) next.delete(a); else next.add(a);
    return next;
  });

  // Position the (fixed) detail popover next to its tile so it escapes the
  // card's overflow-hidden and the lane's horizontal scroll — never clipped.
  const placePop = useCallback((e: React.SyntheticEvent<HTMLDivElement>) => {
    const host = e.currentTarget;
    const pop = host.querySelector<HTMLElement>(".v3fs-seam-pop");
    if (!pop) return;
    const r = host.getBoundingClientRect();
    const pw = pop.offsetWidth || 288, ph = pop.offsetHeight || 200;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = r.left;
    if (left + pw > vw - 8) left = Math.max(8, vw - 8 - pw);
    let top = r.bottom + 7;
    if (top + ph > vh - 8) top = Math.max(8, r.top - 7 - ph); // flip above if it would overflow the viewport
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }, []);

  // Inline CRUD — a clicked tile pins its detail popover open; when editable
  // the popover carries inputs that write straight back to the doc. Key is the
  // stable workflow+step identity, never a render position.
  const [pinned, setPinned] = useState<string | null>(null);
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.(".v3fs-seam-pop, .v3fs-seam-tile")) setPinned(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPinned(null); };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [pinned]);

  const writeWorkflows = useCallback((next: Array<Record<string, unknown>>) => {
    onChange?.({ ...doc, workflows: next });
  }, [doc, onChange]);
  const patchStepAbs = useCallback((wfI: number, stepI: number, patch: Record<string, unknown>) => {
    writeWorkflows(workflows.map((w, i) => (i !== wfI ? w
      : { ...w, steps: asArray(w.steps).map(asRecord).map((s, j) => (j === stepI ? { ...s, ...patch } : s)) })));
  }, [workflows, writeWorkflows]);
  const addStepAfter = useCallback((wfI: number, stepI: number, area: string) => {
    const actor = area && area !== OTHER && area !== EXTERNAL ? area : "";
    writeWorkflows(workflows.map((w, i) => {
      if (i !== wfI) return w;
      const steps = asArray(w.steps).map(asRecord);
      steps.splice(stepI + 1, 0, { actor, action: "New step", system: "", entities: [] });
      return { ...w, steps };
    }));
  }, [workflows, writeWorkflows]);
  const deleteStepAbs = useCallback((wfI: number, stepI: number) => {
    writeWorkflows(workflows.map((w, i) => (i !== wfI ? w
      : { ...w, steps: asArray(w.steps).map(asRecord).filter((_, j) => j !== stepI) })));
    setPinned(null);
  }, [workflows, writeWorkflows]);
  const addWorkflow = useCallback(() => {
    writeWorkflows([...workflows, { name: "New workflow", area: "", trigger: "",
      steps: [{ actor: "", action: "First step", system: "", entities: [] }], handoffs: [], failureModes: [] }]);
  }, [workflows, writeWorkflows]);
  const deleteWorkflow = useCallback((wfI: number) => {
    if (typeof window !== "undefined" && !window.confirm("Delete this whole workflow from the atlas?")) return;
    writeWorkflows(workflows.filter((_, i) => i !== wfI));
  }, [workflows, writeWorkflows]);
  const patchWorkflowAbs = useCallback((wfI: number, patch: Record<string, unknown>) => {
    writeWorkflows(workflows.map((w, i) => (i === wfI ? { ...w, ...patch } : w)));
  }, [workflows, writeWorkflows]);
  // Which workflow's field panel (name/trigger/owner/area/hand-offs) is open.
  const [wfEditKey, setWfEditKey] = useState<number | null>(null);

  // Workflows in scope: any that touch a selected area.
  const inScope = useMemo(() => wfData.filter((wf) =>
    (focusWf === "all" || focusWf === wf.wfIndex)
    && wf.areas.some((a) => effSel.has(a)),
  ), [wfData, focusWf, effSel]);

  // Interdependencies (crossings, cross-area findings) only mean something once
  // MORE THAN ONE area is in view — surface them then.
  const showInterdeps = effSel.size > 1;

  const findings = useMemo(() => {
    const undeclared = inScope.reduce((n, wf) => n + wf.undeclared, 0);
    const unseen = inScope.reduce((n, wf) => n + wf.unseenHandoffs, 0);
    const gapSteps = inScope.reduce((n, wf) => n + wf.steps.filter((s) => s.missing.length).length, 0);
    return { undeclared, unseen, gapSteps };
  }, [inScope]);

  // Blocks shown: in-scope, optionally narrowed to a clicked finding.
  const visibleScope = useMemo(() => (findingFilter === null ? inScope : inScope.filter((wf) =>
    (findingFilter === "gap" && wf.steps.some((s) => s.missing.length))
    || (findingFilter === "cross" && wf.undeclared > 0)
    || (findingFilter === "unseen" && wf.unseenHandoffs > 0))), [inScope, findingFilter]);

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
      {/* Workflow picker first, then the AREA multi-select. */}
      <div className="v3fs-seam-top">
        <label className="v3fs-seam-wfsel">
          <span>Workflow</span>
          <select value={String(focusWf)} onChange={(e) => setFocusWf(e.target.value === "all" ? "all" : Number(e.target.value))}>
            <option value="all">All in scope ({inScope.length})</option>
            {wfData.map((wf) => <option key={wf.wfIndex} value={String(wf.wfIndex)}>{wf.name}</option>)}
          </select>
        </label>
        {!showInterdeps ? <span className="v3fs-seam-hint">Select more than one area to reveal the crossings between them.</span> : null}
      </div>
      {/* AREA multi-select — a refined chip group; a comparison tool, not a form. */}
      <div className="v3fs-seam-pick" role="group" aria-label="Areas to compare">
        <span className="v3fs-seam-pick-l">Areas</span>
        <span className="v3fs-seam-chips">
          {presentAreas.map((area) => {
            const on = effSel.has(area);
            return (
              <button key={area} type="button" aria-pressed={on} style={laneStyle(area)}
                className={`v3fs-seam-chip${on ? " on" : ""}`} onClick={() => toggleArea(area)}>
                <span className="v3fs-seam-chip-dot" aria-hidden="true" />{area}
              </button>
            );
          })}
        </span>
        <span className="v3fs-seam-pick-acts">
          <button type="button" className="v3fs-a" onClick={() => setSelected(null)}>All</button>
          <button type="button" className="v3fs-a" onClick={() => setSelected(new Set())}>Clear</button>
        </span>
      </div>

      {/* Findings — click one to filter the workflows below to just that issue. */}
      {(findings.gapSteps || findings.undeclared || findings.unseen) ? (
        <div className="v3fs-seam-findings" role="group" aria-label="Filter workflows by finding">
          {findings.gapSteps ? <button type="button" aria-pressed={findingFilter === "gap"} className={`fnd gap${findingFilter === "gap" ? " on" : ""}`} onClick={() => setFindingFilter((f) => (f === "gap" ? null : "gap"))}>⚠ {findings.gapSteps} step{findings.gapSteps === 1 ? "" : "s"} reference an entity the ontology doesn’t hold</button> : null}
          {findings.undeclared ? <button type="button" aria-pressed={findingFilter === "cross"} className={`fnd cross${findingFilter === "cross" ? " on" : ""}`} onClick={() => setFindingFilter((f) => (f === "cross" ? null : "cross"))}>◇ {findings.undeclared} crossing{findings.undeclared === 1 ? "" : "s"} with no declared hand-off</button> : null}
          {findings.unseen ? <button type="button" aria-pressed={findingFilter === "unseen"} className={`fnd unseen${findingFilter === "unseen" ? " on" : ""}`} onClick={() => setFindingFilter((f) => (f === "unseen" ? null : "unseen"))}>↯ {findings.unseen} declared hand-off{findings.unseen === 1 ? "" : "s"} with no crossing in the steps</button> : null}
          {findingFilter ? <button type="button" className="v3fs-a v3fs-seam-fnd-clear" onClick={() => setFindingFilter(null)}>show all</button> : null}
        </div>
      ) : null}


      {visibleScope.length === 0 ? (
        <div className="v3fs-stu-empty">No workflows touch the selected areas. Widen the selection.</div>
      ) : (
        <div className="v3fs-seam-blocks">
          {visibleScope.map((wf) => {
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
                    {canEdit ? <button type="button" className="v3fs-seam-wf-editbtn" aria-pressed={wfEditKey === wf.wfIndex}
                      title="Edit this workflow's facts inline"
                      onClick={() => setWfEditKey((k) => (k === wf.wfIndex ? null : wf.wfIndex))}>{wfEditKey === wf.wfIndex ? "Close" : "Edit ✎"}</button> : null}
                    {canEdit ? <button type="button" className="v3fs-seam-wf-del" title="Delete this workflow"
                      onClick={() => deleteWorkflow(wf.wfIndex)}>✕</button> : null}
                    {/* Path only where it carries information — a multi-area seam.
                        For a single-area workflow the lane label already says it. */}
                    {areaPath.length > 1 ? (
                      <div className="v3fs-seam-wf-path" aria-label="area path">
                        {areaPath.map((a, i) => (
                          <React.Fragment key={a + i}>
                            {i ? <span className="v3fs-seam-arr" aria-hidden="true">→</span> : null}
                            <span className="v3fs-seam-path-a" style={laneStyle(a)}>{a}</span>
                          </React.Fragment>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </header>
                {canEdit && wfEditKey === wf.wfIndex ? (() => {
                  const raw = asRecord(workflows[wf.wfIndex]);
                  return (
                    <div className="v3fs-seam-wfedit">
                      <label><span>Name</span><input value={asText(raw.name)} onChange={(e) => patchWorkflowAbs(wf.wfIndex, { name: e.target.value })} /></label>
                      <label><span>Trigger</span><input value={asText(raw.trigger)} placeholder="what starts it" onChange={(e) => patchWorkflowAbs(wf.wfIndex, { trigger: e.target.value })} /></label>
                      <label><span>Owner</span><input value={asText(raw.owner)} onChange={(e) => patchWorkflowAbs(wf.wfIndex, { owner: e.target.value })} /></label>
                      {frameAreas.length ? (
                        <label><span>Area</span>
                          <select value={asText(raw.area)} onChange={(e) => patchWorkflowAbs(wf.wfIndex, { area: e.target.value })}>
                            <option value="">—</option>
                            {frameAreas.map((a) => <option key={a} value={a}>{a}</option>)}
                          </select></label>
                      ) : null}
                      <label className="wide"><span>Hand-offs</span><input value={asStrings(raw.handoffs).join(", ")} placeholder="comma-separated" onChange={(e) => patchWorkflowAbs(wf.wfIndex, { handoffs: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></label>
                      <label className="wide"><span>Failure modes</span><input value={asStrings(raw.failureModes).join(", ")} placeholder="comma-separated" onChange={(e) => patchWorkflowAbs(wf.wfIndex, { failureModes: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></label>
                    </div>
                  );
                })() : null}
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
                      const stepKey = `${wf.wfIndex}:${s.index}`;
                      const isPinned = pinned === stepKey;
                      return (
                        <div key={`st-${s.index}`} className={`v3fs-seam-cell${out ? " out" : ""}`}
                          style={{ gridColumn: 2 + s.index * 2, gridRow: r + 1 }}>
                          <div className={`v3fs-seam-tile${s.missing.length ? " has-gap" : ""}${isPinned ? " pinned" : ""}`} style={laneStyle(s.area)}
                            tabIndex={0} aria-label={`Step ${s.index + 1}: ${s.action || "—"} — ${s.actor}`}
                            onMouseEnter={placePop} onFocus={placePop}
                            onClick={(e) => { placePop(e); setPinned(isPinned ? null : stepKey); }}>
                            {/* Compact face: number + a one-line action. Everything else is on hover/focus. */}
                            <span className="v3fs-seam-tile-n" aria-hidden="true">{s.index + 1}</span>
                            <span className="v3fs-seam-tile-act">{s.action || "—"}</span>
                            {s.missing.length ? <span className="v3fs-seam-tile-flag" aria-hidden="true" title="references an entity the ontology doesn’t hold">⚠</span> : null}
                            {/* Detail popover — hover to preview, click to pin; when editable, its fields write straight back. */}
                            <div className={`v3fs-seam-pop${isPinned ? " pinned" : ""}${canEdit ? " edit" : ""}`} role="group" aria-label={`Step ${s.index + 1} detail`}
                              onClick={(e) => e.stopPropagation()}>
                              <div className="v3fs-seam-pop-h">
                                <span className="v3fs-seam-pop-n">Step {s.index + 1}</span>
                                <span className="v3fs-seam-pop-area" style={laneStyle(s.area)}>{s.area}</span>
                              </div>
                              {canEdit ? (
                                <div className="v3fs-seam-edit">
                                  <label><span>Action</span>
                                    <textarea rows={2} value={s.action} placeholder="what happens in this step"
                                      onChange={(ev) => patchStepAbs(wf.wfIndex, s.index, { action: ev.target.value })} /></label>
                                  <label><span>Actor / lane</span>
                                    <input value={s.actor} placeholder="who performs it"
                                      onChange={(ev) => patchStepAbs(wf.wfIndex, s.index, { actor: ev.target.value })} /></label>
                                  <label><span>System</span>
                                    <input value={s.system} placeholder="system of record"
                                      onChange={(ev) => patchStepAbs(wf.wfIndex, s.index, { system: ev.target.value })} /></label>
                                  <label><span>Entities</span>
                                    <input value={s.entities.join(", ")} placeholder="comma-separated"
                                      onChange={(ev) => patchStepAbs(wf.wfIndex, s.index, { entities: ev.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></label>
                                  <label><span>Evidence</span>
                                    <textarea rows={2} value={s.evidence} placeholder="the quote this step rests on"
                                      onChange={(ev) => patchStepAbs(wf.wfIndex, s.index, { evidence: ev.target.value })} /></label>
                                  <div className="v3fs-seam-edit-acts">
                                    <button type="button" className="v3fs-a" onClick={() => addStepAfter(wf.wfIndex, s.index, s.area)}>＋ Step after</button>
                                    <button type="button" className="v3fs-seam-del" onClick={() => deleteStepAbs(wf.wfIndex, s.index)}>Delete step</button>
                                    <button type="button" className="v3fs-a" onClick={() => setPinned(null)}>Done</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="v3fs-seam-pop-act">{s.action || "—"}</div>
                                  <dl className="v3fs-seam-pop-dl">
                                    <div><dt>Actor</dt><dd>{s.actor}</dd></div>
                                    {s.system ? <div><dt>System</dt><dd>{s.system}</dd></div> : null}
                                    {s.entities.length ? (
                                      <div><dt>Entities</dt><dd className="ents">
                                        {s.entities.map((e) => {
                                          const gap = s.missing.includes(e);
                                          return (
                                            <button key={e} type="button" className={`v3fs-seam-ent${gap ? " gap" : ""}`}
                                              disabled={gap || !onOpenArtifact}
                                              title={gap ? `${e} — not in the ontology (coherence gap)` : (onOpenArtifact ? `${e} — open the ontology` : `${e} — in the ontology`)}
                                              onClick={() => { if (!gap) onOpenArtifact?.("domain-ontology"); }}>
                                              {gap ? "⚠ " : ""}{e}
                                            </button>
                                          );
                                        })}
                                      </dd></div>
                                    ) : null}
                                    {s.evidence ? <div><dt>Evidence</dt><dd className="ev">“{s.evidence}”</dd></div> : null}
                                  </dl>
                                </>
                              )}
                            </div>
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
          {canEdit ? (
            <button type="button" className="v3fs-seam-addwf" onClick={addWorkflow}>＋ Add workflow</button>
          ) : null}
        </div>
      )}

      {/* Legend — three signals kept distinct. */}
      <div className="v3fs-seam-legend" aria-hidden="true">
        <span><i className="lg-cross" />hand-off crossing</span>
        <span><i className="lg-undeclared" />crossing, no declared hand-off</span>
        <span><i className="lg-gap" />entity not in the ontology</span>
      </div>
    </div>
  );
}
