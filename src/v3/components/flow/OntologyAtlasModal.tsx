/**
 * OntologyAtlasModal — the read-only "see the complete ontology" view, opened
 * from the Discovery tab's area lanes. Two sections, each with a visual-first
 * toggle and a jump to the editable artifact page:
 *   Business map        → OntologyGraph (SVG node-edge diagram) | List
 *   How it works today  → WorkflowFlow (actor-coloured step flow) | List
 * `section` deep-links to just one; `area` scopes both to a single area.
 * Salvaged from the retired reimagined chrome (FlowNextBoard).
 */
import { useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { ontologyEntities, ontologyRelations, atlasWorkflows, entityArea, workflowArea } from "@/v3/components/flow/flowAreas";
import { areaAccent } from "@/v3/components/flow/CollectBoard";
import { layeredPositions } from "@/v3/components/flow/studio/graphKit";

// ── Read-only graphical business map: entities as nodes, relationships as
// directed edges, laid out with the studios' crossing-minimising layout (no
// React Flow — a self-contained SVG, so the modal stays light). Nodes are
// tinted by the area they belong to, so the COMPLETE view reads as area clusters.
function OntologyGraph({ program, entities }: { program: ProgramSummary; entities: Record<string, unknown>[] }) {
  const s = (v: unknown): string => (v == null ? "" : String(v)).trim();
  // Node per entity, keyed by its (case-insensitive) name.
  const nodes = entities.map((e) => ({ name: s(e.name) || "Entity", area: entityArea(e, program), sor: s(e.systemOfRecord) }))
    .filter((n) => n.name);
  const byKey = new Map(nodes.map((n) => [n.name.toLowerCase(), n] as const));
  // Links, from BOTH sources: the ontology's sibling `relations` array (how the
  // graph editor and generator store edges) AND any relationships some entities
  // nest inline. Only edges between two entities visible in THIS view are drawn
  // (unknown/out-of-area targets stay in the text list). Deduped by direction.
  const links: Array<{ from: string; to: string; label: string }> = [];
  const seen = new Set<string>();
  const addLink = (fromRaw: string, toRaw: string, label: string) => {
    const from = fromRaw.trim().toLowerCase(), to = toRaw.trim().toLowerCase();
    if (!from || !to || from === to || !byKey.has(from) || !byKey.has(to)) return;
    const key = `${from}→${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ from, to, label });
  };
  for (const r of ontologyRelations(program)) addLink(s(r.from), s(r.to) || s(r.target) || s(r.entity), s(r.label) || s(r.type) || s(r.name));
  for (const e of entities) {
    if (!Array.isArray(e.relationships)) continue;
    for (const r of e.relationships as unknown[]) {
      const rr = (r ?? {}) as Record<string, unknown>;
      addLink(s(e.name), s(rr.to) || s(rr.target) || s(rr.entity), s(rr.type) || s(rr.label));
    }
  }

  const CHAR = 7.1, PADX = 26, H = 44;
  const widthOf = (name: string) => Math.min(230, Math.max(112, Math.round(name.length * CHAR) + PADX));
  const sizes: Record<string, { width: number; height: number }> = {};
  for (const n of nodes) sizes[n.name.toLowerCase()] = { width: widthOf(n.name), height: H };
  const ids = nodes.map((n) => n.name.toLowerCase());
  // With edges, the crossing-minimising layered layout; without, a plain grid
  // (layeredPositions would stack disconnected nodes into one tall column).
  // Both return CENTRE-x / TOP-y per node.
  let pos: Record<string, { x: number; y: number }>;
  if (links.length) {
    pos = layeredPositions(ids, links, { sizes, y: 132, gapX: 46 });
  } else {
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    const colW = Math.max(0, ...nodes.map((n) => widthOf(n.name))) + 46;
    const rowH = H + 34;
    pos = {};
    nodes.forEach((n, i) => { pos[ids[i]] = { x: (i % cols) * colW + colW / 2, y: Math.floor(i / cols) * rowH }; });
  }

  // Bounds → viewBox. layeredPositions (with sizes) returns CENTRE-x, TOP-y per
  // node, so the left edge is cx − w/2.
  const boxes = nodes.map((n) => { const k = n.name.toLowerCase(); const p = pos[k] ?? { x: 0, y: 0 }; const sz = sizes[k]; return { ...n, k, x: p.x - sz.width / 2, y: p.y, w: sz.width, h: sz.height, cx: p.x, cy: p.y + sz.height / 2 }; });
  const boxByKey = new Map(boxes.map((b) => [b.k, b] as const));
  const M = 28;
  const minX = Math.min(...boxes.map((b) => b.x)) - M, maxX = Math.max(...boxes.map((b) => b.x + b.w)) + M;
  const minY = Math.min(...boxes.map((b) => b.y)) - M, maxY = Math.max(...boxes.map((b) => b.y + b.h)) + M;
  const vw = Math.max(1, maxX - minX), vh = Math.max(1, maxY - minY);

  // Clip the centre-to-centre line to each node's rectangle border, so the arrow
  // lands ON the target's edge (not hidden under it).
  const clip = (b: { cx: number; cy: number; w: number; h: number }, tx: number, ty: number) => {
    const dx = tx - b.cx, dy = ty - b.cy;
    if (!dx && !dy) return { x: b.cx, y: b.cy };
    const sx = Math.abs(dx) > 1e-6 ? (b.w / 2) / Math.abs(dx) : Infinity;
    const sy = Math.abs(dy) > 1e-6 ? (b.h / 2) / Math.abs(dy) : Infinity;
    const t = Math.min(sx, sy);
    return { x: b.cx + dx * t, y: b.cy + dy * t };
  };

  return (
    <div className="v3fs-onto-g-wrap">
      <svg className="v3fs-onto-g" viewBox={`${minX} ${minY} ${vw} ${vh}`} role="img"
        aria-label={`Business map — ${nodes.length} entities, ${links.length} relationships`}
        style={{ minWidth: Math.min(vw, 760), width: "100%", height: Math.min(vh, 460) }}>
        <defs>
          <marker id="v3fs-onto-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--v3-line-strong, #9aa2b1)" />
          </marker>
        </defs>
        {links.map((l, i) => {
          const a = boxByKey.get(l.from), b = boxByKey.get(l.to);
          if (!a || !b) return null;
          const start = clip(a, b.cx, b.cy), end = clip(b, a.cx, a.cy);
          const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
          return (
            <g key={i} className="v3fs-onto-g-edge">
              <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} markerEnd="url(#v3fs-onto-arrow)" />
              {l.label ? (
                <text x={mx} y={my - 3} className="v3fs-onto-g-elabel" textAnchor="middle">{l.label}</text>
              ) : null}
            </g>
          );
        })}
        {boxes.map((b) => {
          const acc = areaAccent(b.area);
          return (
            <g key={b.k} className="v3fs-onto-g-node">
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={9} fill="var(--v3-surface, #fff)" stroke={acc} strokeWidth={1.5} />
              <rect x={b.x} y={b.y} width={4} height={b.h} rx={2} fill={acc} />
              <text x={b.x + b.w / 2} y={b.cy + (b.sor ? -3 : 4)} className="v3fs-onto-g-name" textAnchor="middle">{b.name}</text>
              {b.sor ? <text x={b.x + b.w / 2} y={b.cy + 12} className="v3fs-onto-g-sor" textAnchor="middle">{b.sor}</text> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── A single workflow as a polished left-to-right flow: each step a card, the
// actor colour-coded so hand-offs between roles read at a glance, connected by
// chevrons. Horizontally scrollable — a modern current-state-atlas view.
function WorkflowFlow({ workflow }: { workflow: Record<string, unknown> }) {
  const s = (v: unknown): string => (v == null ? "" : String(v)).trim();
  const steps = (Array.isArray(workflow.steps) ? workflow.steps : []).map((st) => {
    const r = (st ?? {}) as Record<string, unknown>;
    return {
      actor: s(r.actor),
      action: s(r.action) || s(r.step) || s(r.beat) || s(r.name) || s(r.description),
      system: s(r.system) || s(r.systemOfRecord),
      entities: Array.isArray(r.entities) ? r.entities.map(s).filter(Boolean) : [],
    };
  }).filter((st) => st.actor || st.action);
  const owner = s(workflow.owner);
  return (
    <div className="v3fs-wff">
      <div className="v3fs-wff-h">
        <b>{s(workflow.name) || "Workflow"}</b>
        {owner ? <span className="v3fs-wff-owner"><i style={{ background: areaAccent(owner) }} aria-hidden="true" />{owner}</span> : null}
      </div>
      {steps.length ? (
        <div className="v3fs-wff-track">
          {steps.map((st, j) => (
            <div key={j} className="v3fs-wff-cellwrap">
              <div className="v3fs-wff-step" style={{ "--acc": st.actor ? areaAccent(st.actor) : "var(--v3-line-strong,#9aa2b1)" } as React.CSSProperties}>
                <div className="v3fs-wff-top">
                  <span className="v3fs-wff-idx">{j + 1}</span>
                  {st.actor ? <span className="v3fs-wff-actor">{st.actor}</span> : null}
                </div>
                <div className="v3fs-wff-act">{st.action || "—"}</div>
                {st.system || st.entities.length ? (
                  <div className="v3fs-wff-meta">
                    {st.system ? <span className="sys">{st.system}</span> : null}
                    {st.entities.slice(0, 3).map((e, k) => <span key={k} className="ent">{e}</span>)}
                  </div>
                ) : null}
              </div>
              {j < steps.length - 1 ? <span className="v3fs-wff-arrow" aria-hidden="true">›</span> : null}
            </div>
          ))}
        </div>
      ) : <p className="v3fs-nb-modal-empty">No steps mapped for this workflow.</p>}
    </div>
  );
}

// ── The area-scoped (or complete) ontology + current-state atlas, read-only.
export default function OntologyAtlasModal({ program, area, section, onOpenWorkspace, onClose }: { program: ProgramSummary; area: string | null; section?: "map" | "atlas"; onOpenWorkspace?: (artifactId: string) => void; onClose: () => void }) {
  const s = (v: unknown): string => (v == null ? "" : String(v)).trim();
  const entities = ontologyEntities(program).filter((e) => !area || entityArea(e, program) === area);
  const workflows = atlasWorkflows(program).filter((w) => !area || workflowArea(w) === area);
  // Which sections to show — a caller can deep-link to just one (so a
  // business-map button and a "how it works today" button open DIFFERENT
  // views, not the same combined modal); "See the complete ontology" shows both.
  const showMap = section !== "atlas";
  const showAtlas = section !== "map";
  // Default to the graph — the operator asked to SEE the map — with a List
  // toggle for the definitions/relationships text (which also carries links to
  // entities outside this view that the graph can't draw).
  const [mapView, setMapView] = useState<"graph" | "list">("graph");
  const [atlasView, setAtlasView] = useState<"flow" | "list">("flow");
  const stepText = (step: unknown): string => {
    if (!step || typeof step !== "object") return s(step);
    const r = step as Record<string, unknown>;
    const actor = s(r.actor);
    const act = s(r.action) || s(r.step) || s(r.beat) || s(r.name);
    return [actor, act].filter(Boolean).join(" — ") || s(r.description);
  };
  return (
    <div className="v3fs-nb-modal-scrim" role="dialog" aria-modal="true" aria-label={area ? `${area} business map` : "Complete ontology"} onClick={onClose}>
      <div className="v3fs-nb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="v3fs-nb-modal-h">
          <div>
            <div className="v3fs-nb-modal-eyebrow">{area ? `${area} · Listen` : "Every area · Listen"}</div>
            <h2 className="v3fs-nb-modal-title">{
              section === "map" ? (area ? `${area} — business map` : "The complete business map")
                : section === "atlas" ? (area ? `${area} — how it works today` : "How it works today")
                : (area ? `${area} — business map & how it works today` : "The complete ontology & current-state atlas")
            }</h2>
          </div>
          <button type="button" className="v3fs-nb-modal-x" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="v3fs-nb-modal-b">
          {showMap ? (
          <section className="v3fs-nb-modal-sec">
            <div className="v3fs-nb-modal-sh">
              <b>Business map</b><span className="code">ontology · {entities.length} {entities.length === 1 ? "entity" : "entities"}</span>
              {entities.length ? (
                <span className="v3fs-nb-modal-vt" role="tablist" aria-label="Business map view">
                  <button type="button" role="tab" aria-selected={mapView === "graph"} className={mapView === "graph" ? "on" : ""} onClick={() => setMapView("graph")}>Graph</button>
                  <button type="button" role="tab" aria-selected={mapView === "list"} className={mapView === "list" ? "on" : ""} onClick={() => setMapView("list")}>List</button>
                </span>
              ) : null}
              {onOpenWorkspace ? <button type="button" className="v3fs-nb-modal-edit" onClick={() => { onOpenWorkspace("domain-ontology"); onClose(); }}>Open in workspace →</button> : null}
            </div>
            {entities.length && mapView === "graph" ? (
              <OntologyGraph program={program} entities={entities} />
            ) : entities.length ? (
              <div className="v3fs-nb-modal-ents">
                {entities.map((e, i) => (
                  <div key={i} className="v3fs-nb-modal-ent">
                    <div className="v3fs-nb-modal-ent-h"><b>{s(e.name) || "Entity"}</b>{s(e.systemOfRecord) ? <span className="sor">{s(e.systemOfRecord)}</span> : null}</div>
                    {s(e.definition) ? <p className="def">{s(e.definition)}</p> : null}
                    {Array.isArray(e.relationships) && e.relationships.length ? (
                      <p className="rel">{(e.relationships as unknown[]).map((r) => { const rr = r as Record<string, unknown>; return `${s(rr.type) || "relates to"} → ${s(rr.to) || s(rr.target) || s(rr.entity)}`; }).filter((t) => t.trim() !== "relates to → ").slice(0, 6).join(" · ")}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : <p className="v3fs-nb-modal-empty">No entities mapped {area ? "for this area" : "yet"}.</p>}
          </section>
          ) : null}
          {showAtlas ? (
          <section className="v3fs-nb-modal-sec">
            <div className="v3fs-nb-modal-sh">
              <b>How it works today</b><span className="code">current-state atlas · {workflows.length} {workflows.length === 1 ? "workflow" : "workflows"}</span>
              {workflows.length ? (
                <span className="v3fs-nb-modal-vt" role="tablist" aria-label="Atlas view">
                  <button type="button" role="tab" aria-selected={atlasView === "flow"} className={atlasView === "flow" ? "on" : ""} onClick={() => setAtlasView("flow")}>Flow</button>
                  <button type="button" role="tab" aria-selected={atlasView === "list"} className={atlasView === "list" ? "on" : ""} onClick={() => setAtlasView("list")}>List</button>
                </span>
              ) : null}
              {onOpenWorkspace ? <button type="button" className="v3fs-nb-modal-edit" onClick={() => { onOpenWorkspace("current-state-atlas"); onClose(); }}>Open in workspace →</button> : null}
            </div>
            {workflows.length && atlasView === "flow" ? (
              <div className="v3fs-nb-modal-flows">
                {workflows.map((w, i) => <WorkflowFlow key={i} workflow={w} />)}
              </div>
            ) : workflows.length ? (
              <div className="v3fs-nb-modal-wfs">
                {workflows.map((w, i) => {
                  const steps = Array.isArray(w.steps) ? (w.steps as unknown[]) : [];
                  return (
                    <div key={i} className="v3fs-nb-modal-wf">
                      <div className="v3fs-nb-modal-ent-h"><b>{s(w.name) || "Workflow"}</b>{s(w.owner) ? <span className="sor">{s(w.owner)}</span> : null}</div>
                      {steps.length ? <ol className="steps">{steps.map((st, j) => <li key={j}>{stepText(st)}</li>)}</ol> : null}
                    </div>
                  );
                })}
              </div>
            ) : <p className="v3fs-nb-modal-empty">No workflows mapped {area ? "for this area" : "yet"}.</p>}
          </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
