/**
 * Experience Design studio — the wireframe renderer. The design crew's JSON
 * (screens with region/block wireframes, persona flows, workflow machines)
 * renders as a visual design document: skeleton screens you can read at a
 * glance, and a FLOW WALKER that steps a chosen persona journey through its
 * screens — the seed of the interpretive prototype. Derived from the record,
 * read-only by contract: changes arrive as evidence and resynthesis.
 */
import React, { useMemo, useState } from "react";
import { Section, asArray, asRecord, asText, asStrings, type StudioProps } from "./StudioKit";

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

export default function ExperienceDesignStudio({ doc }: StudioProps) {
  const intent = asRecord(doc.designIntent);
  const screens = useMemo(() => asArray(doc.screens).map(asRecord), [doc.screens]);
  const flows = useMemo(() => asArray(doc.flows).map(asRecord), [doc.flows]);
  const machines = asArray(doc.workflowMachines).map(asRecord);
  const [focusScreen, setFocusScreen] = useState<string | null>(null);
  // The FLOW WALKER: pick a flow, step through it — each step spotlights its
  // screen above, so the journey reads as the demo it will become.
  const [walkFlow, setWalkFlow] = useState<number | null>(null);
  const [walkStep, setWalkStep] = useState(0);
  const steps = walkFlow != null ? asArray(flows[walkFlow]?.steps).map(asRecord) : [];
  const currentStep = steps[walkStep];
  const activeScreenId = walkFlow != null && currentStep ? asText(currentStep.screen) : focusScreen;
  const focused = screens.find((s) => asText(s.id) === activeScreenId || asText(s.name) === activeScreenId);

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

      {(() => {
        const theme = asRecord(doc.theme);
        const swatches: Array<[string, string]> = [["brandHue", "Brand"], ["accent", "Accent"], ["neutral", "Neutral"], ["surface", "Surface"], ["good", "Good"], ["warn", "Warn"], ["critical", "Critical"]];
        if (!swatches.some(([k]) => asText(theme[k]))) return null;
        const str = (v: unknown) => (typeof v === "number" ? String(v) : asText(v));
        return (
          <Section label="Theme — the design system every prototype builds from" hint={asText(theme.personalityNote) || "governed tokens; the Experience Designer tunes them, and every area's prototype renders from the same system"}>
            <div className="v3fs-wf-theme">
              <div className="v3fs-wf-swatches">
                {swatches.map(([k, l]) => asText(theme[k]) ? (
                  <span key={k} className="v3fs-wf-swatch"><span className="sw" style={{ background: asText(theme[k]) }} /><b>{l}</b><em>{asText(theme[k])}</em></span>
                ) : null)}
              </div>
              <div className="v3fs-wf-meta">
                {asText(theme.fontStack) ? <span className="v3fs-wf-chip">font · {asText(theme.fontStack).split(",")[0].replace(/["']/g, "")}</span> : null}
                {str(theme.radius) ? <span className="v3fs-wf-chip">radius {str(theme.radius)}px</span> : null}
                {str(theme.spacingBase) ? <span className="v3fs-wf-chip">spacing {str(theme.spacingBase)}px</span> : null}
                {asText(theme.density) ? <span className="v3fs-wf-chip">{asText(theme.density)}</span> : null}
              </div>
            </div>
          </Section>
        );
      })()}

      <Section label={`Screens (${screens.length})`} hint="wireframes speak the ontology's vocabulary — click a screen for its states">
        <div className="v3fs-wf-grid">
          {screens.map((screen, index) => (
            <ScreenCard key={index} screen={screen}
              active={!!focused && screen === focused}
              onClick={() => { setWalkFlow(null); setFocusScreen(asText(screen.id) || asText(screen.name)); }} />
          ))}
          {!screens.length ? <div className="v3fs-empty">No screens yet — generate the Experience Design from the Blueprint and Atlas.</div> : null}
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

      <Section label={`Flows (${flows.length})`} hint="each flow names the verbatim pain it dissolves — walk it to preview the demo">
        <div className="v3fs-wf-flows">
          {flows.map((flow, index) => {
            const pain = asRecord(flow.painAnswered);
            const walking = walkFlow === index;
            return (
              <div key={index} className={`v3fs-wf-flow${walking ? " on" : ""}`}>
                <div className="v3fs-wf-flow-h">
                  <b>{asText(flow.name) || `Flow ${index + 1}`}</b>
                  <span>{[asText(flow.persona), asText(flow.journey)].filter(Boolean).join(" · ")}</span>
                  <button type="button" className="v3fs-btn" onClick={() => {
                    if (walking) { setWalkFlow(null); return; }
                    setWalkFlow(index); setWalkStep(0); setFocusScreen(null);
                  }}>{walking ? "Stop" : "▶ Walk"}</button>
                </div>
                {asText(pain.quote) ? (
                  <blockquote className="v3fs-wf-pain">“{asText(pain.quote)}”{asText(pain.who) ? <cite> — {asText(pain.who)}</cite> : null}</blockquote>
                ) : null}
                {walking ? (
                  <div className="v3fs-wf-walk">
                    {steps.map((step, i) => (
                      <button key={i} type="button" className={`v3fs-wf-step${i === walkStep ? " on" : ""}`} onClick={() => setWalkStep(i)}>
                        <b>{i + 1}</b>
                        <span>{asText(step.action)}</span>
                        {asText(step.hitl) ? <em title={asText(step.hitl)}>⛨ approval</em> : null}
                      </button>
                    ))}
                    {currentStep ? <div className="v3fs-wf-outcome">→ {asText(currentStep.outcome)}</div> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {!flows.length ? <div className="v3fs-empty">No flows yet.</div> : null}
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
