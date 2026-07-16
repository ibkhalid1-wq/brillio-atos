/**
 * Experience Design studio — the design crew's working surface. The screens
 * (region/block wireframes), persona flows and workflow machines render as a
 * visual, DIRECTLY EDITABLE design document: the delivery team tunes the
 * governed theme, filters the design to one workflow at a time, reads every
 * flow's steps inline, and marks which steps should be AGENTIFIED — the signal
 * the Agentic Blueprint is built to deliver.
 */
import React, { useMemo, useState } from "react";
import { Section, asArray, asRecord, asText, asStrings, useStudioLocked, type StudioProps } from "./StudioKit";

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

export default function ExperienceDesignStudio({ doc, onChange }: StudioProps) {
  const locked = useStudioLocked();
  const intent = asRecord(doc.designIntent);
  const theme = asRecord(doc.theme);
  const screens = useMemo(() => asArray(doc.screens).map(asRecord), [doc.screens]);
  const flows = useMemo(() => asArray(doc.flows).map(asRecord), [doc.flows]);
  const machines = asArray(doc.workflowMachines).map(asRecord);
  const [focusScreen, setFocusScreen] = useState<string | null>(null);

  // The workflow FILTER replaces the old walk/stop stepper: pick a workflow /
  // journey to focus the whole design on it; "All" shows everything. Grounded
  // in the journeys the flows already name.
  const journeys = useMemo(() => {
    const set = new Set<string>();
    flows.forEach((f) => { const j = asText(f.journey) || asText(f.name); if (j) set.add(j); });
    return [...set];
  }, [flows]);
  const [filter, setFilter] = useState<string>("");
  const flowInFilter = (f: Record<string, unknown>) => !filter || asText(f.journey) === filter || asText(f.name) === filter;
  const screenInFilter = (s: Record<string, unknown>) => !filter || asText(s.journey) === filter;
  const shownScreens = screens.filter(screenInFilter);
  const focused = shownScreens.find((s) => asText(s.id) === focusScreen || asText(s.name) === focusScreen);

  // Direct edits — this is the delivery team's own document.
  const patch = (next: Record<string, unknown>) => onChange({ ...doc, ...next });
  const setTheme = (key: string, value: string) => patch({ theme: { ...theme, [key]: value } });
  const setStep = (flowIndex: number, stepIndex: number, changes: Record<string, unknown>) => {
    patch({
      flows: flows.map((f, i) => {
        if (i !== flowIndex) return f;
        const steps = asArray(f.steps).map(asRecord).map((s, j) => (j === stepIndex ? { ...s, ...changes } : s));
        return { ...f, steps };
      }),
    });
  };
  const str = (v: unknown) => (typeof v === "number" ? String(v) : asText(v));
  const hexOf = (v: unknown) => { const s = asText(v).trim(); return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : "#6455b8"; };

  return (
    <>
      {(asText(intent.personality) || asText(intent.vocabulary)) ? (
        <Section label="Design intent" hint="how the product should feel — grounded in the client's world">
          <div className="v3fs-wf-intent">
            {asText(intent.personality) ? <p>{asText(intent.personality)}</p> : null}
            <div className="v3fs-wf-meta">
              {asText(intent.density) ? <span className="v3fs-wf-chip">{asText(intent.density)}</span> : null}
              {asText(intent.vocabulary) ? <span className="v3fs-wf-chip ent" title="the stakeholders' own terms the UI must use">{asText(intent.vocabulary).slice(0, 80)}</span> : null}
            </div>
          </div>
        </Section>
      ) : null}

      {THEME_SWATCHES.some(([k]) => asText(theme[k])) || !locked ? (
        <Section label="Theme — the design system every prototype builds from" hint={asText(theme.personalityNote) || "governed tokens; tune them here and every prototype renders from the same system"}>
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
        </Section>
      ) : null}

      {journeys.length > 1 ? (
        <div className="v3fs-wf-filter" role="tablist" aria-label="Focus a workflow">
          <button type="button" role="tab" aria-selected={!filter} className={`v3fs-wf-filter-b${!filter ? " on" : ""}`} onClick={() => setFilter("")}>All workflows</button>
          {journeys.map((j) => (
            <button key={j} type="button" role="tab" aria-selected={filter === j} className={`v3fs-wf-filter-b${filter === j ? " on" : ""}`} onClick={() => setFilter(j)}>{j}</button>
          ))}
        </div>
      ) : null}

      <Section label={`Screens (${shownScreens.length})`} hint="wireframes speak the ontology's vocabulary — click a screen for its states">
        <div className="v3fs-wf-grid">
          {shownScreens.map((screen, index) => (
            <ScreenCard key={index} screen={screen}
              active={!!focused && screen === focused}
              onClick={() => setFocusScreen(asText(screen.id) || asText(screen.name))} />
          ))}
          {!shownScreens.length ? <div className="v3fs-empty">No screens in this workflow{filter ? "" : " yet"}.</div> : null}
        </div>
        {focused ? (
          <div className="v3fs-wf-detail">
            <b>{asText(focused.name)}</b>
            <p>{asText(focused.purpose)}</p>
            <div className="v3fs-wf-states">
              {(["empty", "loading", "populated", "error"] as const).map((state) => {
                const text = asText(asRecord(focused.states)[state]);
                return text ? <div key={state} className="v3fs-wf-state"><em>{state}</em><span>{text}</span></div> : null;
              })}
            </div>
            {asStrings(focused.primaryActions).length ? (
              <div className="v3fs-wf-fields">Primary actions: {asStrings(focused.primaryActions).join(" · ")}</div>
            ) : null}
          </div>
        ) : null}
      </Section>

      <Section label="Workflows" hint="every flow's steps, in order — mark the steps an agent should run">
        <div className="v3fs-wf-flows">
          {flows.map((flow, index) => ({ flow, index })).filter(({ flow }) => flowInFilter(flow)).map(({ flow, index }) => {
            const pain = asRecord(flow.painAnswered);
            const steps = asArray(flow.steps).map(asRecord);
            const agentified = steps.filter((s) => s.agentify).length;
            return (
              <div key={index} className="v3fs-wf-flow">
                <div className="v3fs-wf-flow-h">
                  <b>{asText(flow.name) || `Flow ${index + 1}`}</b>
                  <span>{[asText(flow.persona), asText(flow.journey)].filter(Boolean).join(" · ")}</span>
                  {agentified ? <span className="v3fs-wf-agcount" title="steps marked to agentify">⚡ {agentified}/{steps.length}</span> : null}
                </div>
                {asText(pain.quote) ? (
                  <blockquote className="v3fs-wf-pain">“{asText(pain.quote)}”{asText(pain.who) ? <cite> — {asText(pain.who)}</cite> : null}</blockquote>
                ) : null}
                <ol className="v3fs-wf-steps">
                  {steps.map((step, si) => (
                    <li key={si} className={`v3fs-wf-stepr${step.agentify ? " ag" : ""}`}>
                      <span className="v3fs-wf-stepr-n">{si + 1}</span>
                      <span className="v3fs-wf-stepr-body">
                        <span className="v3fs-wf-stepr-act">{asText(step.action)}</span>
                        {asText(step.outcome) ? <span className="v3fs-wf-stepr-out">→ {asText(step.outcome)}</span> : null}
                      </span>
                      {asText(step.hitl) ? <em className="v3fs-wf-stepr-hitl" title={asText(step.hitl)}>⛨ approval</em> : null}
                      <button type="button" className={`v3fs-wf-agentify${step.agentify ? " on" : ""}`} disabled={locked}
                        aria-pressed={!!step.agentify}
                        title={step.agentify ? "Marked to agentify — the Blueprint builds an agent for this step" : "Mark this step to be run by an agent"}
                        onClick={() => setStep(index, si, { agentify: !step.agentify })}>
                        ⚡ {step.agentify ? "Agentify" : "Agentify?"}
                      </button>
                    </li>
                  ))}
                  {!steps.length ? <li className="v3fs-wf-stepr empty">No steps on this flow yet.</li> : null}
                </ol>
              </div>
            );
          })}
          {!flows.filter(flowInFilter).length ? <div className="v3fs-empty">No workflows{filter ? " in this filter" : " yet"}.</div> : null}
        </div>
      </Section>

      {machines.length ? (
        <Section label={`Workflow machines (${machines.length})`} hint="the behaviour the prototype runs — HITL points are explicit states">
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
        </Section>
      ) : null}
    </>
  );
}
