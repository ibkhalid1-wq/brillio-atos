/**
 * Visual building blocks for the stakeholder review surfaces — a premium,
 * self-contained rendering of the two things a stakeholder reviews:
 *   · WorkflowFlow — their workflow as a vertical flow diagram they can edit in
 *     place (fix a step, add one between, mark one that doesn't happen).
 *   · OntologyMap  — the domain's terms as a node-link map (deterministic
 *     layout + SVG connectors), selecting a node to read it and flag it.
 *
 * No external libraries — laid out deterministically so it renders identically
 * on any device and inside the no-login portal.
 */
import { useState } from "react";
import type { OntologyTerm, OntologyRelation } from "@/v3/components/flow/flowReviews";
import { DictationButton, joinDictation } from "@/v3/components/flow/FlowDictation";

/** A workflow step as the editor holds it — the compose reads action/original/
 * added/removed; actor/system/entities ride along for display only. */
export interface FlowNode {
  action: string;
  original?: string;
  added?: boolean;
  removed?: boolean;
  actor?: string;
  originalActor?: string;
  system?: string;
  originalSystem?: string;
  entities?: string[];
}

const AREA_HUES: Record<string, number> = {};
let hueSeed = 0;
/** A stable hue per area label so a node's area reads at a glance. */
function areaHue(area: string | undefined): number {
  const key = (area || "General").toLowerCase();
  if (!(key in AREA_HUES)) { AREA_HUES[key] = key === "general" ? 230 : (hueSeed = (hueSeed + 47) % 360); }
  return AREA_HUES[key];
}

/** The editable workflow, drawn as a vertical flow. Steps drag to reorder; the
 * actor and system are editable inline. */
export function WorkflowFlow({ name, trigger, steps, onEdit, onEditMeta, onToggleRemove, onAdd, onReorder }: {
  name: string;
  trigger?: string;
  steps: FlowNode[];
  onEdit: (index: number, action: string) => void;
  onEditMeta: (index: number, field: "actor" | "system", value: string) => void;
  onToggleRemove: (index: number) => void;
  onAdd: (afterIndex: number) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return (
    <div className="v3fs-vflow">
      <div className="v3fs-vflow-h">
        <span className="v3fs-vflow-start">▸</span>
        <div>
          <b>{name}</b>
          {trigger ? <span>Starts when: {trigger}</span> : null}
        </div>
      </div>
      <ol className="v3fs-vflow-list">
        {steps.map((node, si) => (
          <li key={si}
            className={`v3fs-vflow-node${node.removed ? " removed" : ""}${node.added ? " added" : ""}${drag === si ? " dragging" : ""}${over === si && drag !== null && drag !== si ? " over" : ""}`}
            draggable={!node.removed}
            onDragStart={(e) => { setDrag(si); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            onDragOver={(e) => { if (drag !== null) { e.preventDefault(); setOver(si); } }}
            onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== si) onReorder(drag, si); setDrag(null); setOver(null); }}>
            <div className="v3fs-vflow-rail">
              <span className="v3fs-vflow-grip" aria-hidden="true" title="Drag to reorder">⠿</span>
              <span className="v3fs-vflow-dot" aria-hidden="true">{node.added ? "+" : node.removed ? "×" : si + 1}</span>
            </div>
            <div className="v3fs-vflow-card">
              <input className="v3fs-vflow-action" value={node.action} disabled={node.removed}
                placeholder={node.added ? "Describe the step we missed…" : ""}
                onChange={(e) => onEdit(si, e.target.value)} aria-label={`Step ${si + 1}`} />
              {!node.removed ? (
                <div className="v3fs-vflow-meta">
                  <label className="v3fs-vflow-metaf actor">
                    <span aria-hidden="true">who</span>
                    <input value={node.actor ?? ""} placeholder="who does this?"
                      onChange={(e) => onEditMeta(si, "actor", e.target.value)} aria-label="Who does this step" />
                  </label>
                  <label className="v3fs-vflow-metaf sys">
                    <span aria-hidden="true">on</span>
                    <input value={node.system ?? ""} placeholder="which system?"
                      onChange={(e) => onEditMeta(si, "system", e.target.value)} aria-label="Which system" />
                  </label>
                  {(node.entities ?? []).slice(0, 4).map((ent) => <span key={ent} className="v3fs-vflow-ent">{ent}</span>)}
                </div>
              ) : null}
              <button type="button" className="v3fs-vflow-x" onClick={() => onToggleRemove(si)}
                title={node.removed ? "Keep this step" : node.added ? "Delete" : "This step doesn't happen"}>
                {node.removed ? "↺ keep" : node.added ? "✕" : "✕ doesn't happen"}
              </button>
            </div>
            <button type="button" className="v3fs-vflow-insert" onClick={() => onAdd(si)} aria-label="Add a step after this one">
              <span>＋</span>
            </button>
          </li>
        ))}
        {!steps.length ? (
          <li className="v3fs-vflow-empty"><button type="button" className="v3fs-btn" onClick={() => onAdd(-1)}>＋ Add the first step</button></li>
        ) : null}
      </ol>
    </div>
  );
}

/** The ontology as a node-link map. Deterministic grid layout; SVG curves for
 * relations; select a node to read and flag it. */
export function OntologyMap({ terms, relations, comments, onComment }: {
  terms: OntologyTerm[];
  relations: OntologyRelation[];
  comments: Record<string, string>;
  onComment: (index: number, value: string) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  if (!terms.length) return null;

  const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(terms.length))));
  const rows = Math.ceil(terms.length / cols);
  const CELL_W = 172, CELL_H = 118, PAD = 12;
  const W = cols * CELL_W, H = rows * CELL_H;
  const pos = (i: number) => ({ col: i % cols, row: Math.floor(i / cols) });
  const center = (i: number) => { const { col, row } = pos(i); return { x: col * CELL_W + CELL_W / 2, y: row * CELL_H + CELL_H / 2 }; };
  const indexOf = (name: string) => terms.findIndex((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase());
  const commented = new Set(Object.entries(comments).filter(([, v]) => v.trim()).map(([k]) => Number(k)));

  return (
    <div className="v3fs-omap">
      <div className="v3fs-omap-scroll">
      <div className="v3fs-omap-canvas" style={{ width: W, height: H }}>
        <svg className="v3fs-omap-edges" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
          <defs>
            <marker id="omap-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="v3fs-omap-arrowhead" />
            </marker>
          </defs>
          {relations.map((rel, ri) => {
            const a = indexOf(rel.from), b = indexOf(rel.to);
            if (a < 0 || b < 0 || a === b) return null;
            const p1 = center(a), p2 = center(b);
            const active = selected === a || selected === b;
            const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
            const curve = `M ${p1.x} ${p1.y} Q ${mx} ${my - 26} ${p2.x} ${p2.y}`;
            return (
              <g key={ri} className={`v3fs-omap-edge${active ? " on" : ""}`}>
                <path d={curve} fill="none" markerEnd="url(#omap-arrow)" />
                {active ? (
                  <>
                    <rect x={mx - rel.relation.length * 3.2 - 6} y={my - 34} width={rel.relation.length * 6.4 + 12} height={16} rx={8} className="v3fs-omap-edgelabel-bg" />
                    <text x={mx} y={my - 22} textAnchor="middle" className="v3fs-omap-edgelabel">{rel.relation}</text>
                  </>
                ) : null}
              </g>
            );
          })}
        </svg>
        {terms.map((term, i) => {
          const { col, row } = pos(i);
          return (
            <button key={i} type="button"
              className={`v3fs-omap-node${selected === i ? " on" : ""}${commented.has(i) ? " flagged" : ""}`}
              style={{ left: col * CELL_W + PAD / 2, top: row * CELL_H + PAD / 2, width: CELL_W - PAD, height: CELL_H - PAD, ["--hue" as string]: areaHue(term.area) }}
              onClick={() => setSelected((cur) => (cur === i ? null : i))}
              title={term.definition || term.name}>
              <b>{term.name}</b>
              {term.systemOfRecord ? <span className="v3fs-omap-sor">{term.systemOfRecord}</span> : null}
              {term.definition ? <em>{term.definition}</em> : null}
              {commented.has(i) ? <span className="v3fs-omap-flag" aria-hidden="true">✎</span> : null}
            </button>
          );
        })}
      </div>
      </div>
      <div className="v3fs-omap-detail">
        {selected != null && terms[selected] ? (
          <>
            <div className="v3fs-omap-detail-h">
              <b>{terms[selected].name}</b>
              {terms[selected].area ? <span className="v3fs-omap-area">{terms[selected].area}</span> : null}
            </div>
            {terms[selected].definition ? <p>{terms[selected].definition}</p> : null}
            {terms[selected].aliases && terms[selected].aliases!.length ? <p className="v3fs-omap-aka">also called: {terms[selected].aliases!.join(", ")}</p> : null}
            <div className="v3fs-rvw-field">
              <input className="v3fs-omap-comment" value={comments[String(selected)] ?? ""}
                onChange={(e) => onComment(selected, e.target.value)}
                placeholder="Wrong, missing, or named differently? (optional)" autoFocus />
              <DictationButton compact label="Speak this note"
                onText={(spoken) => onComment(selected, joinDictation(comments[String(selected)] ?? "", spoken))} />
            </div>
          </>
        ) : (
          <p className="v3fs-omap-hint">Tap a term to read it and tell us if it&rsquo;s wrong or missing. Lines show how they connect.</p>
        )}
      </div>
    </div>
  );
}
