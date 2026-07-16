/**
 * Experience Design studio — the design crew's working surface. The screens
 * (region/block wireframes), persona flows and workflow machines render as a
 * visual, DIRECTLY EDITABLE design document: the delivery team tunes the
 * governed theme, filters the design to one workflow at a time, reads every
 * flow's steps inline, and marks which steps should be AGENTIFIED — the signal
 * the Agentic Blueprint is built to deliver.
 */
import React, { useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { asArray, asRecord, asText, asStrings, useStudioLocked, TextField, TextArea, StringListEditor, ChipsField, TableEditor, CollapsibleCard as EdCard, type StudioProps } from "./StudioKit";
import { projectFutureState, type FutureWorkflow } from "@/v3/components/flow/flowFutureState";

const WF_REGIONS = ["header", "nav", "main", "aside", "footer"] as const;
const WF_BLOCK_KINDS = ["list", "table", "form", "detail", "metric", "action", "timeline"];

function emptyScreen(): Record<string, unknown> {
  return {
    id: "", name: "", purpose: "", journey: "", stage: "", personas: [], entities: [], primaryActions: [],
    states: { empty: "", loading: "", populated: "", error: "" }, wireframe: [{ region: "main", blocks: [] }], stepBindings: [],
  };
}

/**
 * The GUI screen designer — a modal to design ONE screen: its identity, the
 * states it renders, its wireframe (regions → blocks) with a live skeleton
 * preview, and the workflow STEPS it serves. Edits a draft; Cancel discards,
 * Save applies. Every screen should bind to at least one workflow step.
 */
function ScreenDesigner({ screen, program, onSave, onClose }: {
  screen: Record<string, unknown>; program?: ProgramSummary;
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
  const [states, setStates] = useState({ empty: asText(st0.empty), loading: asText(st0.loading), populated: asText(st0.populated), error: asText(st0.error) });
  const [regions, setRegions] = useState<Record<string, Array<Record<string, unknown>>>>(() => {
    const map: Record<string, Array<Record<string, unknown>>> = {};
    asArray(screen.wireframe).map(asRecord).forEach((r) => {
      const reg = asText(r.region) || "main";
      map[reg] = [...(map[reg] ?? []), ...asArray(r.blocks).map(asRecord)];
    });
    return map;
  });
  const [bindings, setBindings] = useState<Array<{ workflow: string; action: string }>>(
    asArray(screen.stepBindings).map(asRecord).map((b) => ({ workflow: asText(b.workflow), action: asText(b.action) })).filter((b) => b.action));

  const future = useMemo(() => (program ? projectFutureState(program) : null), [program]);

  const setBlock = (region: string, i: number, changes: Record<string, unknown>) =>
    setRegions((prev) => ({ ...prev, [region]: (prev[region] ?? []).map((b, j) => (j === i ? { ...b, ...changes } : b)) }));
  const addBlock = (region: string) =>
    setRegions((prev) => ({ ...prev, [region]: [...(prev[region] ?? []), { kind: "detail", label: "", entity: "", fields: [] }] }));
  const removeBlock = (region: string, i: number) =>
    setRegions((prev) => ({ ...prev, [region]: (prev[region] ?? []).filter((_, j) => j !== i) }));
  const isBound = (w: string, a: string) => bindings.some((b) => b.workflow === w && b.action === a);
  const toggleBind = (w: string, a: string) =>
    setBindings((prev) => (isBound(w, a) ? prev.filter((b) => !(b.workflow === w && b.action === a)) : [...prev, { workflow: w, action: a }]));

  const assemble = (): Record<string, unknown> => ({
    ...screen,
    id: asText(screen.id) || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `screen-${name.length}`,
    name: name.trim(), purpose, journey, stage, personas, entities, primaryActions, states,
    wireframe: WF_REGIONS.filter((r) => (regions[r] ?? []).length).map((r) => ({ region: r, blocks: regions[r] })),
    stepBindings: bindings,
  });
  const preview = assemble();

  return (
    <div className="v3fs-scrd-scrim" role="dialog" aria-modal="true" aria-label="Screen designer" onClick={onClose}>
      <div className="v3fs-scrd" onClick={(e) => e.stopPropagation()}>
        <div className="v3fs-scrd-h">
          <input className="v3fs-scrd-name" value={name} placeholder="Screen name" aria-label="Screen name" onChange={(e) => setName(e.target.value)} />
          <button type="button" className="v3fs-scrd-x" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="v3fs-scrd-body">
          <div className="v3fs-scrd-form">
            <div className="v3fs-scrd-sec">
              <b className="v3fs-scrd-sl">Identity</b>
              <TextArea label="Purpose" rows={2} value={purpose} onChange={setPurpose} placeholder="one sentence — what this screen is for" />
              <div className="v3fs-stu-grid2">
                <TextField label="Journey" value={journey} onChange={setJourney} />
                <TextField label="Stage" value={stage} onChange={setStage} />
              </div>
              <ChipsField label="Personas" values={personas} onChange={setPersonas} />
              <ChipsField label="Entities shown" values={entities} onChange={setEntities} />
              <StringListEditor label="Primary actions" values={primaryActions} onChange={setPrimaryActions} addLabel="action" />
            </div>
            <div className="v3fs-scrd-sec">
              <b className="v3fs-scrd-sl">States</b>
              {(["empty", "loading", "populated", "error"] as const).map((k) => (
                <TextField key={k} label={k} value={states[k]} onChange={(v) => setStates((prev) => ({ ...prev, [k]: v }))} />
              ))}
            </div>
            <div className="v3fs-scrd-sec">
              <b className="v3fs-scrd-sl">Wireframe — regions &amp; blocks</b>
              {WF_REGIONS.map((region) => (
                <div key={region} className="v3fs-scrd-region">
                  <div className="v3fs-scrd-region-h"><span>{region}</span>
                    <button type="button" className="v3fs-a" onClick={() => addBlock(region)}>＋ block</button></div>
                  {(regions[region] ?? []).map((block, i) => (
                    <div key={i} className="v3fs-scrd-block">
                      <select value={asText(block.kind) || "detail"} aria-label="Block kind" onChange={(e) => setBlock(region, i, { kind: e.target.value })}>
                        {WF_BLOCK_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                      <input value={asText(block.label)} placeholder="label" aria-label="Block label" onChange={(e) => setBlock(region, i, { label: e.target.value })} />
                      <input value={asText(block.entity)} placeholder="entity" aria-label="Block entity" onChange={(e) => setBlock(region, i, { entity: e.target.value })} />
                      <input value={asStrings(block.fields).join(", ")} placeholder="fields (comma-separated)" aria-label="Block fields"
                        onChange={(e) => setBlock(region, i, { fields: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                      <button type="button" className="v3fs-stu-x" aria-label="Remove block" onClick={() => removeBlock(region, i)}>×</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="v3fs-scrd-sec">
              <b className="v3fs-scrd-sl">Bound workflow steps <em className="v3fs-scrd-req">— at least one</em></b>
              {future && future.workflows.length ? future.workflows.map((w) => (
                <div key={w.name} className="v3fs-scrd-wf">
                  <div className="v3fs-scrd-wf-n">{w.name}</div>
                  {w.steps.map((step, si) => (
                    <label key={si} className="v3fs-scrd-step">
                      <input type="checkbox" checked={isBound(w.name, step.action)} onChange={() => toggleBind(w.name, step.action)} />
                      <span>{step.action}</span>
                    </label>
                  ))}
                </div>
              )) : <div className="v3fs-empty">No workflows yet — generate the Current-State Atlas in Listen.</div>}
            </div>
          </div>
          <div className="v3fs-scrd-preview">
            <b className="v3fs-scrd-sl">Live preview</b>
            <ScreenCard screen={preview} active={false} onClick={() => { /* preview only */ }} />
          </div>
        </div>
        <div className="v3fs-scrd-foot">
          <span className={`v3fs-scrd-hint${bindings.length ? "" : " warn"}`}>
            {bindings.length ? `Bound to ${bindings.length} workflow step${bindings.length === 1 ? "" : "s"}` : "⚠ Not bound to any workflow step yet"}
          </span>
          <div className="v3fs-scrd-actions">
            <button type="button" className="v3fs-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="v3fs-btn pri" disabled={!name.trim()} onClick={() => onSave(assemble())}>Save screen</button>
          </div>
        </div>
      </div>
    </div>
  );
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
          onSave={saveScreen}
          onClose={() => setEditScreen(null)} />
      ) : null}
    </>
  );
}
