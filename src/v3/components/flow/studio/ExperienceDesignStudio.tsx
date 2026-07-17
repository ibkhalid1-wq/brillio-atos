/**
 * Experience Design studio — the design crew's working surface. The screens
 * (region/block wireframes), persona flows and workflow machines render as a
 * visual, DIRECTLY EDITABLE design document: the delivery team tunes the
 * governed theme, filters the design to one workflow at a time, reads every
 * flow's steps inline, and marks which steps should be AGENTIFIED — the signal
 * the Agentic Blueprint is built to deliver.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { asArray, asRecord, asText, asStrings, useStudioLocked, TextField, TextArea, StringListEditor, ChipsField, TableEditor, CollapsibleCard as EdCard, type StudioProps } from "./StudioKit";
import { projectFutureState, type FutureWorkflow } from "@/v3/components/flow/flowFutureState";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";

const WF_REGIONS = ["header", "nav", "main", "aside", "footer"] as const;
const WF_BLOCK_KINDS = ["list", "table", "form", "detail", "metric", "action", "timeline"];

function emptyScreen(): Record<string, unknown> {
  return {
    id: "", name: "", purpose: "", journey: "", stage: "", personas: [], entities: [], primaryActions: [],
    states: { empty: "", loading: "", populated: "", error: "" }, wireframe: [{ region: "main", blocks: [] }], stepBindings: [],
  };
}

interface Block { kind: string; label: string; entity: string; fields: string[] }
type Regions = Record<string, Block[]>;
const SCRD_STATES = ["empty", "loading", "populated", "error"] as const;
type ScrdState = typeof SCRD_STATES[number];

const toBlock = (r: Record<string, unknown>): Block => ({
  kind: asText(r.kind) || "detail", label: asText(r.label), entity: asText(r.entity), fields: asStrings(r.fields),
});

/**
 * The GUI screen designer — a canvas-first modal to design ONE screen. Three
 * panes: a PALETTE of block kinds to drop in, an editable CANVAS (a device
 * frame with click-to-select and drag-to-reorder blocks, and a state toggle),
 * and a contextual INSPECTOR that shows the screen's identity + workflow
 * bindings when nothing is selected, or the block's properties (ontology-aware
 * entity → fields pickers) when a block is. Edits a draft; Cancel discards
 * (guarding unsaved changes), Save applies. Esc cancels, ⌘/Ctrl+Enter saves.
 */
function ScreenDesigner({ screen, program, allScreens, onSave, onClose }: {
  screen: Record<string, unknown>; program?: ProgramSummary; allScreens: Array<Record<string, unknown>>;
  onSave: (next: Record<string, unknown>) => void; onClose: () => void;
}) {
  const [name, setName] = useState(asText(screen.name));
  const [purpose, setPurpose] = useState(asText(screen.purpose));
  const [journey, setJourney] = useState(asText(screen.journey));
  const [stage, setStage] = useState(asText(screen.stage));
  const [personas, setPersonas] = useState(asStrings(screen.personas));
  const [entities, setEntities] = useState(asStrings(screen.entities));
  const [primaryActions, setPrimaryActions] = useState(asStrings(screen.primaryActions));
  const st0 = asRecord(screen.states);
  const [states, setStates] = useState<Record<ScrdState, string>>({
    empty: asText(st0.empty), loading: asText(st0.loading), populated: asText(st0.populated), error: asText(st0.error),
  });
  const [regions, setRegions] = useState<Regions>(() => {
    const map: Regions = {};
    asArray(screen.wireframe).map(asRecord).forEach((r) => {
      const reg = asText(r.region) || "main";
      map[reg] = [...(map[reg] ?? []), ...asArray(r.blocks).map(asRecord).map(toBlock)];
    });
    return map;
  });
  const [bindings, setBindings] = useState<Array<{ workflow: string; action: string }>>(
    asArray(screen.stepBindings).map(asRecord).map((b) => ({ workflow: asText(b.workflow), action: asText(b.action) })).filter((b) => b.action));

  const [sel, setSel] = useState<{ region: string; index: number } | null>(null);
  const [activeState, setActiveState] = useState<ScrdState>("populated");
  const [drag, setDrag] = useState<{ region: string; index: number } | null>(null);

  const future = useMemo(() => (program ? projectFutureState(program) : null), [program]);
  // Ontology entities → their field names, so the block inspector offers real
  // entities and checkable fields instead of free text.
  const ontology = useMemo(() => {
    const od = program ? readArtifactDoc(program, "domainOntology") : null;
    return asArray(od?.entities).map(asRecord)
      .map((e) => ({ name: asText(e.name), attributes: asStrings(e.attributes) }))
      .filter((e) => e.name);
  }, [program]);

  const setBlock = (region: string, i: number, changes: Partial<Block>) =>
    setRegions((prev) => ({ ...prev, [region]: (prev[region] ?? []).map((b, j) => (j === i ? { ...b, ...changes } : b)) }));
  const addBlock = (region: string, kind: string) => {
    setRegions((prev) => {
      const next = [...(prev[region] ?? []), { kind, label: "", entity: "", fields: [] } as Block];
      setSel({ region, index: next.length - 1 });
      return { ...prev, [region]: next };
    });
  };
  const removeBlock = (region: string, i: number) => {
    setRegions((prev) => ({ ...prev, [region]: (prev[region] ?? []).filter((_, j) => j !== i) }));
    setSel(null);
  };
  const moveBlock = (from: { region: string; index: number }, toRegion: string, toIndex: number) => {
    setRegions((prev) => {
      const src = [...(prev[from.region] ?? [])];
      const [moved] = src.splice(from.index, 1);
      if (!moved) return prev;
      const next: Regions = { ...prev, [from.region]: src };
      const dst = from.region === toRegion ? src : [...(next[toRegion] ?? [])];
      const at = Math.max(0, Math.min(toIndex, dst.length));
      dst.splice(at, 0, moved);
      next[toRegion] = dst;
      setSel({ region: toRegion, index: at });
      return next;
    });
  };

  const isBound = (w: string, a: string) => bindings.some((b) => b.workflow === w && b.action === a);
  const toggleBind = (w: string, a: string) =>
    setBindings((prev) => (isBound(w, a) ? prev.filter((b) => !(b.workflow === w && b.action === a)) : [...prev, { workflow: w, action: a }]));
  // Coverage — how many of a workflow's steps ANY screen (other screens plus
  // this draft) already serves, so the designer sees the gaps it's filling.
  const coverageFor = (w: FutureWorkflow) => {
    const covered = new Set<string>();
    allScreens.forEach((s, i) => {
      if (editMatches(s, screen, i)) return; // skip the screen we're editing; use live draft instead
      asArray(s.stepBindings).map(asRecord).forEach((b) => { if (asText(b.workflow) === w.name) covered.add(asText(b.action)); });
    });
    bindings.forEach((b) => { if (b.workflow === w.name) covered.add(b.action); });
    return w.steps.filter((s) => covered.has(s.action)).length;
  };

  const assemble = (): Record<string, unknown> => ({
    ...screen,
    id: asText(screen.id) || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `screen-${name.length}`,
    name: name.trim(), purpose, journey, stage, personas, entities, primaryActions, states,
    wireframe: WF_REGIONS.filter((r) => (regions[r] ?? []).length).map((r) => ({ region: r, blocks: regions[r] })),
    stepBindings: bindings,
  });

  // Dirty-guard — snapshot the incoming screen once; compare on close.
  const baseline = useRef(JSON.stringify({
    name: asText(screen.name), purpose: asText(screen.purpose), journey: asText(screen.journey), stage: asText(screen.stage),
    personas: asStrings(screen.personas), entities: asStrings(screen.entities), primaryActions: asStrings(screen.primaryActions),
    states: { empty: asText(st0.empty), loading: asText(st0.loading), populated: asText(st0.populated), error: asText(st0.error) },
    regions: (() => { const m: Regions = {}; asArray(screen.wireframe).map(asRecord).forEach((r) => { const reg = asText(r.region) || "main"; m[reg] = [...(m[reg] ?? []), ...asArray(r.blocks).map(asRecord).map(toBlock)]; }); return m; })(),
    bindings: asArray(screen.stepBindings).map(asRecord).map((b) => ({ workflow: asText(b.workflow), action: asText(b.action) })).filter((b) => b.action),
  }));
  const dirty = () => JSON.stringify({ name, purpose, journey, stage, personas, entities, primaryActions, states, regions, bindings }) !== baseline.current;
  const tryClose = () => { if (!dirty() || window.confirm("Discard unsaved changes to this screen?")) onClose(); };
  const save = () => { if (name.trim()) onSave(assemble()); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); tryClose(); }
      else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selBlock = sel ? (regions[sel.region] ?? [])[sel.index] : undefined;
  const selEntity = selBlock ? ontology.find((e) => e.name === selBlock.entity) : undefined;
  const stateNote = states[activeState];

  return (
    <div className="v3fs-scrd-scrim" role="dialog" aria-modal="true" aria-label="Screen designer" onClick={tryClose}>
      <div className="v3fs-scrd" onClick={(e) => e.stopPropagation()}>
        <div className="v3fs-scrd-h">
          <input className="v3fs-scrd-name" value={name} placeholder="Untitled screen" aria-label="Screen name" onChange={(e) => setName(e.target.value)} autoFocus />
          <span className="v3fs-scrd-kbd" aria-hidden="true"><kbd>⌘</kbd><kbd>↵</kbd> save · <kbd>esc</kbd> cancel</span>
          <button type="button" className="v3fs-scrd-x" aria-label="Close" onClick={tryClose}>✕</button>
        </div>

        <div className="v3fs-scrd-body">
          {/* PALETTE — drag a tile onto a region, or click to add to the selected region. */}
          <div className="v3fs-scrd-palette">
            <b className="v3fs-scrd-pl">Blocks</b>
            <p className="v3fs-scrd-pal-hint">Drag onto the canvas, or click to add.</p>
            <div className="v3fs-scrd-pal-grid">
              {WF_BLOCK_KINDS.map((k) => (
                <button key={k} type="button" className="v3fs-scrd-pal" draggable
                  onDragStart={(e) => { e.dataTransfer.setData("text/scrd-kind", k); e.dataTransfer.effectAllowed = "copy"; }}
                  onClick={() => addBlock(sel?.region ?? "main", k)} title={`Add a ${k} block`}>
                  <span className="v3fs-scrd-pal-ic" aria-hidden="true">{BLOCK_GLYPH[k] ?? "¶"}</span>
                  <span className="v3fs-scrd-pal-l">{k}</span>
                </button>
              ))}
            </div>
          </div>

          {/* CANVAS — the device frame; states toggle; selectable/draggable blocks. */}
          <div className="v3fs-scrd-canvaswrap">
            <div className="v3fs-scrd-states" role="tablist" aria-label="Screen state">
              {SCRD_STATES.map((s) => (
                <button key={s} type="button" role="tab" aria-selected={activeState === s}
                  className={`v3fs-scrd-state${activeState === s ? " on" : ""}`} onClick={() => setActiveState(s)}>{s}</button>
              ))}
            </div>
            <div className="v3fs-scrd-canvas" onClick={() => setSel(null)}>
              <div className="v3fs-scrd-device">
                <div className="v3fs-scrd-device-bar" aria-hidden="true"><i /><i /><i /><span>{name.trim() || "Untitled screen"}</span></div>
                {stateNote ? <div className={`v3fs-scrd-statebanner ${activeState}`}>{activeState}: {stateNote}</div> : null}
                {WF_REGIONS.map((region) => {
                  const blocks = regions[region] ?? [];
                  return (
                    <div key={region} className={`v3fs-scrd-cregion ${region}`}
                      onDragOver={(e) => { if (e.dataTransfer.types.includes("text/scrd-kind") || drag) e.preventDefault(); }}
                      onDrop={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        const kind = e.dataTransfer.getData("text/scrd-kind");
                        if (kind) addBlock(region, kind);
                        else if (drag) moveBlock(drag, region, blocks.length);
                        setDrag(null);
                      }}>
                      <div className="v3fs-scrd-cregion-h">
                        <span>{region}</span>
                        <button type="button" className="v3fs-scrd-cadd" aria-label={`Add block to ${region}`}
                          onClick={(e) => { e.stopPropagation(); addBlock(region, "detail"); }}>＋</button>
                      </div>
                      {blocks.length ? blocks.map((block, i) => (
                        <button key={i} type="button" draggable
                          className={`v3fs-scrd-cblock ${block.kind}${sel?.region === region && sel.index === i ? " sel" : ""}`}
                          onClick={(e) => { e.stopPropagation(); setSel({ region, index: i }); }}
                          onDragStart={(e) => { setDrag({ region, index: i }); e.dataTransfer.effectAllowed = "move"; }}
                          onDragEnd={() => setDrag(null)}
                          onDragOver={(e) => { if (drag) { e.preventDefault(); e.stopPropagation(); } }}
                          onDrop={(e) => { if (drag) { e.preventDefault(); e.stopPropagation(); moveBlock(drag, region, i); setDrag(null); } }}>
                          <span className="v3fs-scrd-cblock-ic" aria-hidden="true">{BLOCK_GLYPH[block.kind] ?? "¶"}</span>
                          <span className="v3fs-scrd-cblock-l">{block.label || block.kind}</span>
                          {block.entity ? <em className="v3fs-scrd-cblock-e">{block.entity}</em> : null}
                        </button>
                      )) : <div className="v3fs-scrd-cempty">drop a block here</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* INSPECTOR — block properties when a block is selected, else the screen's. */}
          <div className="v3fs-scrd-inspect">
            {selBlock ? (
              <>
                <div className="v3fs-scrd-ihead">
                  <b className="v3fs-scrd-pl">Block</b>
                  <button type="button" className="v3fs-scrd-idel" onClick={() => removeBlock(sel!.region, sel!.index)}>Delete</button>
                </div>
                <label className="v3fs-stu-field">
                  <span className="v3fs-stu-fl">Kind</span>
                  <select value={selBlock.kind} onChange={(e) => setBlock(sel!.region, sel!.index, { kind: e.target.value })}>
                    {WF_BLOCK_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
                <TextField label="Label" value={selBlock.label} onChange={(v) => setBlock(sel!.region, sel!.index, { label: v })} placeholder="what this block shows" />
                <label className="v3fs-stu-field">
                  <span className="v3fs-stu-fl">Region</span>
                  <select value={sel!.region} onChange={(e) => moveBlock({ region: sel!.region, index: sel!.index }, e.target.value, (regions[e.target.value] ?? []).length)}>
                    {WF_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                <label className="v3fs-stu-field">
                  <span className="v3fs-stu-fl">Entity</span>
                  <select value={selBlock.entity} onChange={(e) => setBlock(sel!.region, sel!.index, { entity: e.target.value, fields: [] })}>
                    <option value="">— none —</option>
                    {ontology.map((e) => <option key={e.name} value={e.name}>{e.name}</option>)}
                    {selBlock.entity && !ontology.some((e) => e.name === selBlock.entity) ? <option value={selBlock.entity}>{selBlock.entity}</option> : null}
                  </select>
                </label>
                {selEntity && selEntity.attributes.length ? (
                  <div className="v3fs-scrd-fields">
                    <span className="v3fs-stu-fl">Fields</span>
                    {selEntity.attributes.map((f) => {
                      const on = selBlock.fields.includes(f);
                      return (
                        <label key={f} className="v3fs-scrd-fld">
                          <input type="checkbox" checked={on} onChange={() => setBlock(sel!.region, sel!.index, { fields: on ? selBlock.fields.filter((x) => x !== f) : [...selBlock.fields, f] })} />
                          <span>{f}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <ChipsField label="Fields" values={selBlock.fields} onChange={(v) => setBlock(sel!.region, sel!.index, { fields: v })} placeholder="field names" />
                )}
              </>
            ) : (
              <>
                <b className="v3fs-scrd-pl">Screen</b>
                <TextArea label="Purpose" rows={2} value={purpose} onChange={setPurpose} placeholder="one sentence — what this screen is for" />
                <div className="v3fs-stu-grid2">
                  <TextField label="Journey" value={journey} onChange={setJourney} />
                  <TextField label="Stage" value={stage} onChange={setStage} />
                </div>
                <ChipsField label="Personas" values={personas} onChange={setPersonas} />
                <ChipsField label="Entities shown" values={entities} onChange={setEntities} />
                <StringListEditor label="Primary actions" values={primaryActions} onChange={setPrimaryActions} addLabel="action" />
                <label className="v3fs-stu-field">
                  <span className="v3fs-stu-fl">Note for “{activeState}” state</span>
                  <textarea rows={2} value={stateNote} placeholder={`what the ${activeState} state shows`}
                    onChange={(e) => setStates((prev) => ({ ...prev, [activeState]: e.target.value }))} />
                </label>
                <div className="v3fs-scrd-bind">
                  <span className="v3fs-stu-fl">Bound workflow steps <em className="v3fs-scrd-req">— at least one</em></span>
                  {future && future.workflows.length ? future.workflows.map((w) => {
                    const cov = coverageFor(w);
                    return (
                      <div key={w.name} className="v3fs-scrd-wf">
                        <div className="v3fs-scrd-wf-n">{w.name}
                          <em className={`v3fs-scrd-cov${cov >= w.steps.length ? " full" : ""}`}>{cov}/{w.steps.length}</em>
                        </div>
                        {w.steps.map((step, si) => (
                          <label key={si} className="v3fs-scrd-step">
                            <input type="checkbox" checked={isBound(w.name, step.action)} onChange={() => toggleBind(w.name, step.action)} />
                            <span>{step.action}</span>
                          </label>
                        ))}
                      </div>
                    );
                  }) : <div className="v3fs-empty">No workflows yet — generate the Current-State Atlas in Listen.</div>}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="v3fs-scrd-foot">
          <span className={`v3fs-scrd-hint${bindings.length ? "" : " warn"}`}>
            {bindings.length ? `Bound to ${bindings.length} workflow step${bindings.length === 1 ? "" : "s"}` : "⚠ Not bound to any workflow step yet"}
          </span>
          <div className="v3fs-scrd-actions">
            <button type="button" className="v3fs-btn" onClick={tryClose}>Cancel</button>
            <button type="button" className="v3fs-btn pri" disabled={!name.trim()} onClick={save}>Save screen</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** True when `s` (the i-th of allScreens) is the same screen we're editing —
 *  match by id when present, else by object identity / name, so coverage never
 *  double-counts the draft. */
function editMatches(s: Record<string, unknown>, editing: Record<string, unknown>, _i: number): boolean {
  const eid = asText(editing.id), sid = asText(s.id);
  if (eid && sid) return eid === sid;
  return s === editing || (!!asText(editing.name) && asText(s.name) === asText(editing.name));
}

const BLOCK_GLYPH: Record<string, string> = {
  list: "☰", table: "▦", form: "✎", detail: "¶", metric: "◔", action: "▸", timeline: "⋯",
};

export function WireBlock({ block }: { block: Record<string, unknown> }) {
  const kind = asText(block.kind) || "detail";
  const fields = asStrings(block.fields);
  return (
    <div className={`v3fs-wf-block ${kind}`}>
      <div className="v3fs-wf-block-h">
        <span aria-hidden="true">{BLOCK_GLYPH[kind] ?? "¶"}</span>
        <b>{asText(block.label) || kind}</b>
        {asText(block.entity) ? <em className="v3fs-wf-entity">{asText(block.entity)}</em> : null}
      </div>
      {/* Skeleton lines suggest the block's shape without inventing content. */}
      {kind === "table" || kind === "list" ? (
        <div className="v3fs-wf-skel rows">{[0, 1, 2].map((i) => <span key={i} />)}</div>
      ) : kind === "form" ? (
        <div className="v3fs-wf-skel fields">{(fields.length ? fields.slice(0, 4) : ["", ""]).map((f, i) => (
          <label key={i}>{f || "…"}<span /></label>
        ))}</div>
      ) : kind === "metric" ? (
        <div className="v3fs-wf-skel metric"><b>—</b><span /></div>
      ) : kind === "action" ? (
        <div className="v3fs-wf-skel action"><span className="v3fs-wf-btn">{fields[0] || asText(block.label) || "Action"}</span></div>
      ) : (
        <div className="v3fs-wf-skel rows">{[0, 1].map((i) => <span key={i} />)}</div>
      )}
      {fields.length && kind !== "form" && kind !== "action" ? (
        <div className="v3fs-wf-fields">{fields.slice(0, 5).join(" · ")}</div>
      ) : null}
    </div>
  );
}

export function ScreenCard({ screen, active, onClick }: { screen: Record<string, unknown>; active: boolean; onClick: () => void }) {
  const regions = asArray(screen.wireframe).map(asRecord);
  const byRegion = (name: string) => regions.filter((r) => asText(r.region) === name);
  const mains = [...byRegion("main"), ...regions.filter((r) => !["header", "nav", "main", "aside", "footer"].includes(asText(r.region)))];
  const asides = byRegion("aside");
  return (
    <button type="button" className={`v3fs-wf-screen${active ? " on" : ""}`} onClick={onClick}
      title={asText(screen.purpose) || undefined}>
      <div className="v3fs-wf-title">
        <b>{asText(screen.name) || asText(screen.id) || "Screen"}</b>
        <span>{[asText(screen.journey), asText(screen.stage)].filter(Boolean).join(" · ")}</span>
      </div>
      <div className="v3fs-wf-frame">
        {byRegion("header").length ? <div className="v3fs-wf-region header">{byRegion("header").flatMap((r) => asArray(r.blocks).map(asRecord)).map((b, i) => <WireBlock key={i} block={b} />)}</div> : null}
        <div className="v3fs-wf-body">
          {byRegion("nav").length ? <div className="v3fs-wf-region nav">{byRegion("nav").flatMap((r) => asArray(r.blocks).map(asRecord)).map((b, i) => <WireBlock key={i} block={b} />)}</div> : null}
          <div className="v3fs-wf-region main">{mains.flatMap((r) => asArray(r.blocks).map(asRecord)).map((b, i) => <WireBlock key={i} block={b} />)}</div>
          {asides.length ? <div className="v3fs-wf-region aside">{asides.flatMap((r) => asArray(r.blocks).map(asRecord)).map((b, i) => <WireBlock key={i} block={b} />)}</div> : null}
        </div>
      </div>
      <div className="v3fs-wf-meta">
        {asStrings(screen.personas).slice(0, 3).map((p) => <span key={p} className="v3fs-wf-chip">{p}</span>)}
        {asStrings(screen.entities).slice(0, 3).map((e) => <span key={e} className="v3fs-wf-chip ent">{e}</span>)}
      </div>
    </button>
  );
}

/** The seven governed theme tokens, editable as live colour wells. */
const THEME_SWATCHES: Array<[string, string]> = [
  ["brandHue", "Brand"], ["accent", "Accent"], ["neutral", "Neutral"], ["surface", "Surface"],
  ["good", "Good"], ["warn", "Warn"], ["critical", "Critical"],
];

export default function ExperienceDesignStudio({ doc, onChange, program }: StudioProps) {
  const locked = useStudioLocked();
  const intent = asRecord(doc.designIntent);
  const theme = asRecord(doc.theme);
  const screens = useMemo(() => asArray(doc.screens).map(asRecord), [doc.screens]);
  const flows = useMemo(() => asArray(doc.flows).map(asRecord), [doc.flows]);
  const machines = asArray(doc.workflowMachines).map(asRecord);
  // The screen designer modal: an index into `screens`, "new" for a fresh
  // screen, or null when closed.
  const [editScreen, setEditScreen] = useState<number | "new" | null>(null);

  // The Screens filter — focus the wireframes on one journey. The Workflows
  // section below has its own area grouping (the Listen workflows), so it isn't
  // driven by this filter.
  const journeys = useMemo(() => {
    const set = new Set<string>();
    flows.forEach((f) => { const j = asText(f.journey) || asText(f.name); if (j) set.add(j); });
    return [...set];
  }, [flows]);
  const [filter, setFilter] = useState<string>("");
  const screenInFilter = (s: Record<string, unknown>) => !filter || asText(s.journey) === filter;
  const shownScreens = screens.filter(screenInFilter);

  // The Listen workflows, grouped by area, with a per-step agentic SUGGESTION
  // (from the future-state projection) the delivery team approves — plus a
  // manual mark for steps the suggestion didn't flag. Marks persist on this doc
  // as `agentifyMarks` (a map keyed by workflow::action), so the Blueprint reads
  // one agreed direction.
  const future = useMemo(() => (program ? projectFutureState(program) : null), [program]);
  const marks = asRecord(doc.agentifyMarks);
  const markKey = (workflow: string, action: string) => `${workflow}::${action}`;
  const isMarked = (key: string) => Object.prototype.hasOwnProperty.call(marks, key);
  const toggleMark = (workflow: string, area: string, action: string, suggested: boolean) => {
    const key = markKey(workflow, action);
    const next = { ...marks };
    if (isMarked(key)) delete next[key];
    else next[key] = { workflow, area, action, suggested };
    patch({ agentifyMarks: next });
  };
  const workflowsByArea = useMemo(() => {
    const map = new Map<string, FutureWorkflow[]>();
    (future?.workflows ?? []).forEach((w) => {
      if (!map.has(w.area)) map.set(w.area, []);
      map.get(w.area)!.push(w);
    });
    return [...map.entries()];
  }, [future]);

  // Direct edits — this is the delivery team's own document.
  const patch = (next: Record<string, unknown>) => onChange({ ...doc, ...next });
  // Screen CRUD via the designer modal.
  const saveScreen = (next: Record<string, unknown>) => {
    const arr = [...screens];
    if (editScreen === "new") arr.push(next);
    else if (typeof editScreen === "number") arr[editScreen] = next;
    patch({ screens: arr });
    setEditScreen(null);
  };
  const removeScreen = (index: number) => patch({ screens: screens.filter((_, i) => i !== index) });
  const setTheme = (key: string, value: string) => patch({ theme: { ...theme, [key]: value } });
  const setIntent = (key: string, value: string) => patch({ designIntent: { ...intent, [key]: value } });
  const setMachines = (next: Record<string, unknown>[]) => patch({ workflowMachines: next });
  const setMachine = (index: number, changes: Record<string, unknown>) =>
    setMachines(machines.map((m, i) => (i === index ? { ...m, ...changes } : m)));
  const str = (v: unknown) => (typeof v === "number" ? String(v) : asText(v));
  const hexOf = (v: unknown) => { const s = asText(v).trim(); return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : "#6455b8"; };

  return (
    <>
      {(asText(intent.personality) || asText(intent.vocabulary) || asText(intent.density) || !locked) ? (
        <EdCard label="Design intent" hint="how the product should feel — grounded in the client's world">
          {locked ? (
            <div className="v3fs-wf-intent">
              {asText(intent.personality) ? <p>{asText(intent.personality)}</p> : null}
              <div className="v3fs-wf-meta">
                {asText(intent.density) ? <span className="v3fs-wf-chip">{asText(intent.density)}</span> : null}
                {asText(intent.vocabulary) ? <span className="v3fs-wf-chip ent" title="the stakeholders' own terms the UI must use">{asText(intent.vocabulary).slice(0, 80)}</span> : null}
              </div>
            </div>
          ) : (
            <div className="v3fs-wf-intent-edit">
              <TextArea label="Personality — how it should feel" rows={2} value={asText(intent.personality)}
                placeholder="e.g. trustworthy and calm; sharp and precise" onChange={(v) => setIntent("personality", v)} />
              <TextArea label="Vocabulary — the stakeholders' own terms the UI must use" rows={2} value={asText(intent.vocabulary)}
                placeholder="their words, comma-separated" onChange={(v) => setIntent("vocabulary", v)} />
              <div className="v3fs-wf-tokens">
                <TextField label="Density" value={asText(intent.density)} placeholder="comfortable / compact" onChange={(v) => setIntent("density", v)} />
              </div>
            </div>
          )}
        </EdCard>
      ) : null}

      {THEME_SWATCHES.some(([k]) => asText(theme[k])) || !locked ? (
        <EdCard label="Theme" hint={asText(theme.personalityNote) || "the design system every prototype builds from — tune it here"}>
          <div className="v3fs-wf-theme">
            <div className="v3fs-wf-swatches editable">
              {THEME_SWATCHES.map(([k, l]) => (
                <label key={k} className="v3fs-wf-swatch">
                  {locked
                    ? <span className="sw" style={{ background: asText(theme[k]) || "transparent" }} />
                    : <input className="sw" type="color" value={hexOf(theme[k])} aria-label={`${l} colour`}
                        onChange={(e) => setTheme(k, e.target.value)} />}
                  <b>{l}</b>
                  {locked
                    ? <em>{asText(theme[k]) || "—"}</em>
                    : <input className="v3fs-wf-hex" value={asText(theme[k])} placeholder="#hex"
                        onChange={(e) => setTheme(k, e.target.value)} aria-label={`${l} hex`} />}
                </label>
              ))}
            </div>
            <div className="v3fs-wf-tokens">
              {locked ? (
                <div className="v3fs-wf-meta">
                  {asText(theme.fontStack) ? <span className="v3fs-wf-chip">font · {asText(theme.fontStack).split(",")[0].replace(/["']/g, "")}</span> : null}
                  {str(theme.radius) ? <span className="v3fs-wf-chip">radius {str(theme.radius)}px</span> : null}
                  {str(theme.spacingBase) ? <span className="v3fs-wf-chip">spacing {str(theme.spacingBase)}px</span> : null}
                  {asText(theme.density) ? <span className="v3fs-wf-chip">{asText(theme.density)}</span> : null}
                </div>
              ) : (
                <>
                  <label className="v3fs-wf-token"><span>Font stack</span>
                    <input value={asText(theme.fontStack)} placeholder="'Inter', sans-serif" onChange={(e) => setTheme("fontStack", e.target.value)} /></label>
                  <label className="v3fs-wf-token sm"><span>Radius</span>
                    <input inputMode="numeric" value={str(theme.radius)} onChange={(e) => setTheme("radius", e.target.value.replace(/[^0-9.]/g, ""))} /></label>
                  <label className="v3fs-wf-token sm"><span>Spacing</span>
                    <input inputMode="numeric" value={str(theme.spacingBase)} onChange={(e) => setTheme("spacingBase", e.target.value.replace(/[^0-9.]/g, ""))} /></label>
                  <label className="v3fs-wf-token"><span>Density</span>
                    <input value={asText(theme.density)} placeholder="comfortable" onChange={(e) => setTheme("density", e.target.value)} /></label>
                </>
              )}
            </div>
          </div>
        </EdCard>
      ) : null}

      <EdCard label="Screens" badge={shownScreens.length} hint="click a screen to open the designer; ＋ adds one">
        <div className="v3fs-wf-screenbar">
          {journeys.length > 1 ? (
            <div className="v3fs-wf-filter" role="tablist" aria-label="Focus a journey">
              <button type="button" role="tab" aria-selected={!filter} className={`v3fs-wf-filter-b${!filter ? " on" : ""}`} onClick={() => setFilter("")}>All</button>
              {journeys.map((j) => (
                <button key={j} type="button" role="tab" aria-selected={filter === j} className={`v3fs-wf-filter-b${filter === j ? " on" : ""}`} onClick={() => setFilter(j)}>{j}</button>
              ))}
            </div>
          ) : <span />}
          {!locked ? <button type="button" className="v3fs-btn pri v3fs-wf-addscreen" onClick={() => setEditScreen("new")}>＋ Add screen</button> : null}
        </div>
        <div className="v3fs-wf-grid">
          {shownScreens.map((screen) => {
            const realIndex = screens.indexOf(screen);
            return (
              <div key={realIndex} className="v3fs-wf-screenwrap">
                <ScreenCard screen={screen} active={false} onClick={() => setEditScreen(realIndex)} />
                {!locked ? (
                  <button type="button" className="v3fs-wf-screendel" aria-label="Remove screen"
                    title="Remove this screen" onClick={(e) => { e.stopPropagation(); removeScreen(realIndex); }}>×</button>
                ) : null}
              </div>
            );
          })}
          {!shownScreens.length ? <div className="v3fs-empty">No screens{filter ? " in this journey" : " yet"} — use ＋ Add screen to design one.</div> : null}
        </div>
      </EdCard>

      <EdCard label="Workflows to agentify" hint="the Listen workflows by area — approve a suggested step, or mark your own">
        {!workflowsByArea.length ? (
          <div className="v3fs-empty">No workflows yet — generate the Current-State Atlas in Listen, and its workflows appear here.</div>
        ) : (
          <div className="v3fs-agtree">
            {workflowsByArea.map(([area, list]) => {
              const areaSteps = list.reduce((n, w) => n + w.steps.length, 0);
              const areaMarked = list.reduce((n, w) => n + w.steps.filter((s) => isMarked(markKey(w.name, s.action))).length, 0);
              const areaSuggested = list.reduce((n, w) => n + w.steps.filter((s) => s.mode === "agentify" && !isMarked(markKey(w.name, s.action))).length, 0);
              return (
                <details key={area} className="v3fs-agtree-area" open>
                  <summary>
                    <span className="v3fs-agtree-tw" aria-hidden="true">{(area || "·").slice(0, 2).toUpperCase()}</span>
                    <b>{area}</b>
                    <span className="v3fs-agtree-meta">{list.length} workflow{list.length === 1 ? "" : "s"} · {areaSteps} steps</span>
                    {areaMarked ? <span className="v3fs-agtree-n ag" title="steps set to agentify">⚡ {areaMarked}</span> : null}
                    {areaSuggested ? <span className="v3fs-agtree-n sug" title="suggested, awaiting approval">✨ {areaSuggested}</span> : null}
                    <span className="v3fs-agtree-caret" aria-hidden="true">▾</span>
                  </summary>
                  <div className="v3fs-agtree-body">
                    {list.map((w) => (
                      <div key={w.name} className="v3fs-agtree-wf">
                        <div className="v3fs-agtree-wf-h">
                          <b>{w.name}</b>
                          {w.trigger ? <span>on {w.trigger}</span> : null}
                        </div>
                        <ol className="v3fs-agtree-steps">
                          {w.steps.map((step, si) => {
                            const key = markKey(w.name, step.action);
                            const marked = isMarked(key);
                            const suggested = step.mode === "agentify";
                            return (
                              <li key={si} className={`v3fs-agtree-step${marked ? " ag" : suggested ? " sug" : ""}`}>
                                <span className="v3fs-agtree-step-n">{si + 1}</span>
                                <span className="v3fs-agtree-step-body">
                                  <span className="v3fs-agtree-step-act">{step.action}</span>
                                  {step.hitl ? <em className="v3fs-agtree-step-hitl" title="a judgement step — a human decides, an agent can assist">⛨ human decides</em> : null}
                                </span>
                                {marked ? (
                                  <button type="button" className="v3fs-wf-agentify on" disabled={locked}
                                    aria-pressed="true" title="Set to agentify — the Blueprint builds an agent for this step. Click to remove."
                                    onClick={() => toggleMark(w.name, w.area, step.action, suggested)}>⚡ Agentify</button>
                                ) : suggested ? (
                                  <span className="v3fs-agtree-suggest">
                                    <span className="v3fs-agtree-suggest-l" title="the future-state projection suggests an agent can run this step">✨ Suggested</span>
                                    <button type="button" className="v3fs-agtree-approve" disabled={locked}
                                      onClick={() => toggleMark(w.name, w.area, step.action, true)}>Approve</button>
                                  </span>
                                ) : (
                                  <button type="button" className="v3fs-wf-agentify" disabled={locked}
                                    aria-pressed="false" title="Mark this step to be run by an agent"
                                    onClick={() => toggleMark(w.name, w.area, step.action, false)}>⚡ Agentify?</button>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </EdCard>

      {machines.length || !locked ? (
        <EdCard label="Workflow machines" badge={machines.length || undefined} hint="the behaviour the prototype runs — HITL points are explicit states" defaultOpen={false}>
          {locked ? (
            <div className="v3fs-wf-machines">
              {machines.map((machine, index) => (
                <div key={index} className="v3fs-wf-machine">
                  <b>{asText(machine.name) || `Machine ${index + 1}`}</b>
                  <div className="v3fs-wf-statesrow">
                    {asStrings(machine.states).map((state, i, all) => (
                      <React.Fragment key={i}>
                        <span className="v3fs-wf-chip">{state}</span>
                        {i < all.length - 1 ? <em aria-hidden="true">→</em> : null}
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="v3fs-wf-trans">
                    {asArray(machine.transitions).map(asRecord).slice(0, 8).map((t, i) => (
                      <div key={i}><b>{asText(t.from)}</b> → <b>{asText(t.to)}</b> on <span>{asText(t.on)}</span>{asText(t.actor) ? <em> · {asText(t.actor)}</em> : null}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="v3fs-wf-machines-edit">
              {machines.map((machine, index) => (
                <div key={index} className="v3fs-wf-machine-edit">
                  <div className="v3fs-wf-machine-edit-h">
                    <TextField label="Machine" value={asText(machine.name)} placeholder="e.g. Quote lifecycle"
                      onChange={(v) => setMachine(index, { name: v })} />
                    <button type="button" className="v3fs-stu-x" aria-label="Remove machine"
                      onClick={() => setMachines(machines.filter((_, i) => i !== index))}>×</button>
                  </div>
                  <StringListEditor label="States (in order)" values={asStrings(machine.states)}
                    onChange={(next) => setMachine(index, { states: next })} addLabel="state" placeholder="state name" />
                  <TableEditor
                    columns={[{ key: "from", label: "From" }, { key: "to", label: "To" }, { key: "on", label: "On (trigger)" }, { key: "actor", label: "Actor", grow: 0.8 }]}
                    rows={asArray(machine.transitions).map(asRecord)}
                    onChange={(next) => setMachine(index, { transitions: next })}
                    addLabel="transition" emptyHint="No transitions yet — add the state changes and what triggers them." />
                </div>
              ))}
              <button type="button" className="v3fs-a" onClick={() => setMachines([...machines, { name: "", states: [], transitions: [] }])}>＋ Add machine</button>
            </div>
          )}
        </EdCard>
      ) : null}

      {editScreen !== null ? (
        <ScreenDesigner
          screen={editScreen === "new" ? emptyScreen() : (screens[editScreen] ?? emptyScreen())}
          program={program}
          allScreens={screens}
          onSave={saveScreen}
          onClose={() => setEditScreen(null)} />
      ) : null}
    </>
  );
}
