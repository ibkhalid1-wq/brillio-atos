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
export function WorkflowFlow({ name, trigger, steps, onEdit, onEditMeta, onToggleRemove, onAdd, onReorder, stepComment, onStepComment, stepConfirmed, onToggleStepConfirm }: {
  name: string;
  trigger?: string;
  steps: FlowNode[];
  onEdit: (index: number, action: string) => void;
  onEditMeta: (index: number, field: "actor" | "system", value: string) => void;
  onToggleRemove: (index: number) => void;
  onAdd: (afterIndex: number) => void;
  onReorder: (from: number, to: number) => void;
  /** Read/write a free-text note on a phase/step (text + voice). When provided,
   *  each step gains a "comment on this phase" field. */
  stepComment?: (index: number) => string;
  onStepComment?: (index: number, value: string) => void;
  /** Tap-to-validate: whether the stakeholder confirmed this step is right, and
   *  a toggle. The positive counterpart to "✕ doesn't happen". */
  stepConfirmed?: (index: number) => boolean;
  onToggleStepConfirm?: (index: number) => void;
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
            className={`v3fs-vflow-node${node.removed ? " removed" : ""}${node.added ? " added" : ""}${stepConfirmed?.(si) ? " confirmed" : ""}${drag === si ? " dragging" : ""}${over === si && drag !== null && drag !== si ? " over" : ""}`}
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
              <textarea className="v3fs-vflow-action" value={node.action} disabled={node.removed} rows={1}
                placeholder={node.added ? "Describe the step we missed…" : ""}
                ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } }}
                onChange={(e) => { e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; onEdit(si, e.target.value); }}
                aria-label={`Step ${si + 1}`} />
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
              <div className="v3fs-vflow-vld">
                {!node.removed && !node.added && onToggleStepConfirm ? (
                  <button type="button" className={`v3fs-vld yes${stepConfirmed?.(si) ? " on" : ""}`}
                    aria-pressed={!!stepConfirmed?.(si)} onClick={() => onToggleStepConfirm(si)}
                    title="This step is right as shown">✓ Right</button>
                ) : null}
                <button type="button" className={`v3fs-vld no${node.removed ? " on" : ""}`} onClick={() => onToggleRemove(si)}
                  title={node.removed ? "Keep this step" : node.added ? "Delete" : "This step doesn't happen"}>
                  {node.removed ? "↺ keep" : node.added ? "✕ remove" : "✗ doesn't happen"}
                </button>
              </div>
              {!node.removed && onStepComment ? (
                <div className="v3fs-vflow-note">
                  <input value={stepComment?.(si) ?? ""} placeholder="Comment on this phase (optional)"
                    onChange={(e) => onStepComment(si, e.target.value)} aria-label={`Comment on step ${si + 1}`} />
                  <DictationButton compact label="Speak this comment"
                    onText={(spoken) => onStepComment(si, joinDictation(stepComment?.(si) ?? "", spoken))} />
                </div>
              ) : null}
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

/** The ontology as a readable, responsive set of term cards. Each card carries
 * the term, its system of record, the FULL definition, and the relationships it
 * takes part in (rendered as inline text, not overlapping SVG labels); tap a
 * card to flag it and leave a note. Replaces the earlier fixed-grid node-link
 * map — on the narrow linked page that map clipped long definitions and let its
 * edge labels overlap the cards, so it "did not show clearly". A flowing card
 * list reads cleanly at any width, never truncates, and scrolls with the page. */
export function OntologyMap({ terms, relations, comments, onComment, confirmed, onToggleConfirm, dataElements, onDataElements }: {
  terms: OntologyTerm[];
  relations: OntologyRelation[];
  comments: Record<string, string>;
  onComment: (index: number, value: string) => void;
  /** Tap-to-validate: a term the stakeholder actively confirmed is right.
   * Confirmation is signal too — silence stops meaning "maybe". */
  confirmed?: Record<string, boolean>;
  onToggleConfirm?: (index: number) => void;
  /** The key data elements (fields) the stakeholder tracks about each term —
   * the attributes that matter to them. Surfaces requirements straight from the
   * people who live in the data. Free text per term (comma-separated). */
  dataElements?: Record<string, string>;
  onDataElements?: (index: number, value: string) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  if (!terms.length) return null;

  const norm = (s: string) => s.trim().toLowerCase();
  // Every relation this term takes part in, phrased FROM the term outward so it
  // reads as a sentence: outgoing keeps the verb ("owns → Contact"), incoming
  // flips to the passive so direction stays honest ("Account owns →").
  const relsFor = (name: string): Array<{ label: string; other: string; incoming: boolean }> => {
    const out: Array<{ label: string; other: string; incoming: boolean }> = [];
    for (const rel of relations) {
      if (!rel.relation) continue;
      if (norm(rel.from) === norm(name) && rel.to) out.push({ label: rel.relation, other: rel.to, incoming: false });
      else if (norm(rel.to) === norm(name) && rel.from) out.push({ label: rel.relation, other: rel.from, incoming: true });
    }
    return out;
  };
  const commented = new Set(Object.entries(comments).filter(([, v]) => v.trim()).map(([k]) => Number(k)));

  return (
    <div className="v3fs-olist">
      {terms.map((term, i) => {
        const rels = relsFor(term.name);
        const isSel = selected === i;
        const isFlagged = commented.has(i);
        const isConfirmed = !!confirmed?.[String(i)];
        return (
          <div key={i} className={`v3fs-olist-card${isSel ? " on" : ""}${isFlagged ? " flagged" : ""}${isConfirmed ? " confirmed" : ""}`}
            style={{ ["--hue" as string]: areaHue(term.area) }}>
            <button type="button" className="v3fs-olist-body" aria-expanded={isSel}
              onClick={() => setSelected((cur) => (cur === i ? null : i))}>
              <span className="v3fs-olist-h">
                <b>{term.name}</b>
                {term.area ? <span className="v3fs-olist-area">{term.area}</span> : null}
                {isFlagged ? <span className="v3fs-olist-flag" aria-hidden="true">✎</span> : null}
              </span>
              {term.systemOfRecord ? <span className="v3fs-olist-sor">{term.systemOfRecord}</span> : null}
              {term.definition ? <span className="v3fs-olist-def">{term.definition}</span> : null}
              {term.aliases && term.aliases.length ? <span className="v3fs-olist-aka">also called: {term.aliases.join(", ")}</span> : null}
              {rels.length ? (
                <span className="v3fs-olist-rels">
                  {rels.map((r, ri) => (
                    <span key={ri} className="v3fs-olist-rel">
                      {r.incoming ? <>{r.other} <em>{r.label}</em> ↦</> : <><em>{r.label}</em> ↦ {r.other}</>}
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
            <div className="v3fs-vld-row">
              {onToggleConfirm ? (
                <button type="button" className={`v3fs-vld yes${isConfirmed ? " on" : ""}`} aria-pressed={isConfirmed}
                  onClick={() => { onToggleConfirm(i); if (!isConfirmed) setSelected((cur) => (cur === i ? null : cur)); }}>
                  ✓ Looks right
                </button>
              ) : null}
              <button type="button" className={`v3fs-vld no${isFlagged || isSel ? " on" : ""}`} aria-pressed={isSel}
                onClick={() => setSelected(isSel ? null : i)}>
                {isFlagged ? "✎ Edit note" : "✗ Not quite"}
              </button>
            </div>
            {onDataElements ? (
              <div className={`v3fs-olist-data${(dataElements?.[String(i)] ?? "").trim() ? " filled" : ""}`}>
                <span className="lbl">Key things you track about {/^[aeiou]/i.test(term.name.trim()) ? "an" : "a"} {term.name.toLowerCase()}</span>
                <div className="v3fs-rvw-field">
                  <input className="v3fs-olist-input" value={dataElements?.[String(i)] ?? ""}
                    onChange={(e) => onDataElements(i, e.target.value)}
                    placeholder="e.g. stage, amount, close date, owner…" />
                  <DictationButton compact label="Speak the fields"
                    onText={(spoken) => onDataElements(i, joinDictation(dataElements?.[String(i)] ?? "", spoken))} />
                </div>
              </div>
            ) : null}
            {isSel ? (
              <div className="v3fs-olist-note">
                <div className="v3fs-rvw-field">
                  <input className="v3fs-olist-input" value={comments[String(i)] ?? ""}
                    onChange={(e) => onComment(i, e.target.value)}
                    placeholder="Wrong, missing, or named differently? (optional)" autoFocus />
                  <DictationButton compact label="Speak this note"
                    onText={(spoken) => onComment(i, joinDictation(comments[String(i)] ?? "", spoken))} />
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
