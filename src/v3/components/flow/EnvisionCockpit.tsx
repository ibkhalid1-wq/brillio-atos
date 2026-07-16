/**
 * The Envision cockpit — the delivery team's build studio as a scannable
 * OVERVIEW of three acts, not a document dump: DIRECTION (choose the
 * architecture, recorded), DESIGN (the one future-state at a glance —
 * per-workflow mode-mix, expandable to the detail, with the experience↔agents
 * lenses behind a toggle), and BUILD (is the prototype assembled and ready to
 * demonstrate). Projected from the record; the full documents live in the
 * artifact tabs. Client validation happens in SHOW, not here. Premium means
 * legible at a glance, deep on demand.
 */
import { useMemo, useState } from "react";
import { projectFutureState, type FutureState, type FutureWorkflow } from "@/v3/components/flow/flowFutureState";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { loopState, changeRequests, type ChangeRequest } from "@/v3/components/flow/flowLoop";
import { readMovementInputs } from "@/v3/components/flow/flowShellData";
import { DESIGN_TEAM } from "@/v3/components/flow/ProductOwnerCockpit";
import type { ProgramSummary } from "@/new/types";

type ChangeRoute = "design" | "listen" | "frame";

const MODE_LABEL: Record<string, string> = { agentify: "agent runs it", assist: "agent assists · you decide", keep: "stays human" };

function modeMix(wf: FutureWorkflow): { agentify: number; assist: number; keep: number } {
  return wf.steps.reduce((m, s) => ({ ...m, [s.mode]: m[s.mode] + 1 }), { agentify: 0, assist: 0, keep: 0 } as Record<string, number>) as { agentify: number; assist: number; keep: number };
}

export default function EnvisionCockpit({ program, areaFilter, onSaveInputs, onOpenArtifact }: {
  program: ProgramSummary;
  /** When provided, the phase-home area board controls the area filter — the
   * cockpit scopes its future-state to these areas (empty = all) and hides its
   * own "Filter by area" chip row so there's one filter, not two. */
  areaFilter?: string[];
  onSaveInputs?: (movementId: string, patch: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
  /** Open one of the Design workspaces (Architecture · Experience · Prototype). */
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const fs = useMemo<FutureState>(() => projectFutureState(program), [program]);
  const hasPrototype = useMemo(() => {
    return Boolean(readArtifactDoc(program, "prototypeBuild") || readArtifactDoc(program, "prototypePack"));
  }, [program]);
  const [focus, setFocus] = useState<{ kind: "agent" | "screen"; key: string } | null>(null);
  // Progressive disclosure: the three acts (Direction · Design · Build) are an
  // ACCORDION. null = auto-open the current (first not-done) act; done acts stay
  // collapsed so the phase home reads as a scannable summary, not a wall.
  const [openAct, setOpenAct] = useState<string | null>(null);
  const [area, setArea] = useState("");
  const [openWf, setOpenWf] = useState<string | null>(null);
  const [showLenses, setShowLenses] = useState(false);
  const [pick, setPick] = useState("");
  const [tradeaway, setTradeaway] = useState("");
  const [recording, setRecording] = useState(false);
  const [iterating, setIterating] = useState(false);
  const [routed, setRouted] = useState<Record<string, ChangeRoute>>({});
  const ls = useMemo(() => loopState(program), [program]);
  const incoming = useMemo(() => changeRequests(program), [program]);
  const crKey = (cr: ChangeRequest) => `${cr.stakeholder}::${cr.ask}`;

  // Triage a change request. Not every "change" is a design fix: some tell us we
  // got the CLIENT'S WORLD wrong (a current-state correction → Listen, which then
  // cascades the ontology/workflows forward), and some are NEW REQUIREMENTS
  // (→ Frame's scope). Only design fixes are addressed by the rebuild here.
  const routeChange = async (cr: ChangeRequest, route: ChangeRoute) => {
    if (route !== "design" && onSaveInputs) {
      const note = `\n\n— ${cr.stakeholder} · from Show validation (iteration ${ls.round}) —\n${cr.ask || "(see their demo verdict)"}`;
      if (route === "listen") {
        const cur = String(readMovementInputs(program, "listen").interviewTranscripts ?? "");
        await onSaveInputs("listen", { interviewTranscripts: (cur + note).trimStart() },
          { attest: { action: `Current-state correction routed to Listen — ${cr.stakeholder}`, detail: cr.ask.slice(0, 140) } });
      } else {
        const cur = String(readMovementInputs(program, "frame").sponsorConversation ?? "");
        await onSaveInputs("frame", { sponsorConversation: (cur + note).trimStart() },
          { attest: { action: `New requirement routed to Frame scope — ${cr.stakeholder}`, detail: cr.ask.slice(0, 140) } });
      }
    }
    setRouted((prev) => ({ ...prev, [crKey(cr)]: route }));
  };

  // Start the next iteration: record the round bump (feedback → design), then
  // open the Prototype workspace so the team rebuilds to the changes.
  const newIteration = async () => {
    if (!onSaveInputs) return;
    setIterating(true);
    try {
      await onSaveInputs("show", { iterationRound: String(ls.round + 1) },
        { attest: { action: `Started prototype iteration ${ls.round + 1}`, detail: `${incoming.length} change request${incoming.length === 1 ? "" : "s"} from Show` } });
      onOpenArtifact?.("prototype-build");
    } finally { setIterating(false); }
  };

  if (!fs.hasArchitecture && !fs.hasDesign && !fs.hasBlueprint) return null;

  const acts = [
    { label: "Direction", done: !!fs.direction.chosen, hint: fs.direction.chosen || "choose the shape" },
    { label: "Design", done: fs.hasDesign && fs.hasBlueprint, hint: fs.hasDesign && fs.hasBlueprint ? "the future state" : "not yet complete" },
    { label: "Build", done: hasPrototype, hint: hasPrototype ? "prototype ready to show" : "assemble the prototype" },
  ];
  // The act to show expanded: the operator's explicit pick, else the first that
  // isn't done (the work in front of you). "" is a valid pick meaning all closed.
  const effectiveOpen = openAct ?? (acts.find((a) => !a.done)?.label ?? "");
  const toggleAct = (label: string) => setOpenAct(effectiveOpen === label ? "" : label);

  const agentLit = (name: string): boolean =>
    focus?.kind === "agent" ? focus.key === name : focus?.kind === "screen" ? !!fs.screens.find((s) => s.id === focus.key)?.agentNames.includes(name) : false;
  const screenLit = (id: string): boolean =>
    focus?.kind === "screen" ? focus.key === id : focus?.kind === "agent" ? !!fs.agents.find((a) => a.name === focus.key)?.screenIds.includes(id) : false;
  const dim = (lit: boolean) => (focus ? (lit ? "" : " dim") : "");

  // Area scope: when the phase-home board controls the filter (areaFilter is
  // passed), use its selection (empty = all); otherwise fall back to this
  // cockpit's own single-area chip selection.
  const externalControlled = areaFilter !== undefined;
  const sel = areaFilter ?? [];
  const designTeamSel = sel.includes(DESIGN_TEAM);
  const bizAreas = sel.filter((a) => a !== DESIGN_TEAM);
  const filtering = externalControlled && sel.length > 0;
  // The DIRECTION act (architecture strategy, direction, blueprint) is the
  // delivery team's cross-cutting work — it belongs to the Design team ALONE, so
  // it shows ONLY when the Design-team tile is selected (never in the unfiltered
  // or business-area views). The per-area DESIGN/BUILD acts show when unfiltered
  // or a business area is selected.
  const showDirection = designTeamSel;
  const showDesignBuild = !filtering || bizAreas.length > 0;
  const activeAreas = externalControlled ? bizAreas : (area ? [area] : []);
  const inArea = <T extends { area?: string }>(items: T[]) => (activeAreas.length ? items.filter((i) => activeAreas.includes(i.area ?? "General")) : items);
  const workflows = inArea(fs.workflows);
  const agents = inArea(fs.agents);
  const screens = inArea(fs.screens);

  const recordDirection = async () => {
    if (!onSaveInputs || !pick) return;
    setRecording(true);
    try {
      await onSaveInputs("envision", { directionDecision: `Chosen direction: ${pick}.${tradeaway.trim() ? `\nTraded away: ${tradeaway.trim()}` : ""}` },
        { attest: { action: `Architecture direction chosen — ${pick}`, detail: tradeaway.trim().slice(0, 140) } });
    } finally { setRecording(false); }
  };

  return (
    <div className="v3fs-envc">
      {/* ── INCOMING FROM SHOW ────────────────────────────────────────────────
          The loop closing: change requests stakeholders raised on the prototype,
          waiting for the team to fold into the design and rebuild. */}
      {incoming.length ? (
        <section className="v3fs-envc-incoming" aria-label="Incoming from Show">
          <div className="v3fs-envc-inc-h">
            <span className="v3fs-envc-inc-t">◀ Incoming from Show — {incoming.length} change{incoming.length === 1 ? "" : "s"} to fold in</span>
            <span className="v3fs-envc-inc-round">iteration {ls.round}</span>
          </div>
          {/* Grouped by area — parallel areas route their changes to their own
              workspace slice, so the team can address one area without the others. */}
          {[...new Set(incoming.map((c) => c.area))].map((area) => (
            <div key={area} className="v3fs-envc-inc-area">
              <div className="v3fs-envc-inc-al">{area}<em>{incoming.filter((c) => c.area === area).length}</em></div>
              <ul className="v3fs-envc-inc-list">
                {incoming.filter((c) => c.area === area).map((cr, i) => {
                  const route = routed[crKey(cr)];
                  return (
                    <li key={i} className={`v3fs-envc-inc-cr${cr.blocking ? " block" : ""}${route ? ` routed-${route}` : ""}`}>
                      <div className="v3fs-envc-inc-crtop">
                        <b>{cr.stakeholder}</b>
                        <em>{cr.blocking ? "objection" : "change"}</em>
                        {cr.ask ? <span>{cr.ask}</span> : <span className="v3fs-envc-inc-noask">asked for a change — see their demo row</span>}
                      </div>
                      {/* Triage: not every change is a design fix. */}
                      {route ? (
                        <div className="v3fs-envc-inc-routed">
                          {route === "design" ? "→ design fix — folds into the rebuild"
                            : route === "listen" ? "→ current-state correction — sent to Listen; the model re-derives"
                              : "→ new requirement — sent to Frame scope"}
                        </div>
                      ) : onSaveInputs ? (
                        <div className="v3fs-envc-inc-triage" role="group" aria-label={`Route ${cr.stakeholder}'s change`}>
                          <span className="lbl">This is a</span>
                          <button type="button" onClick={() => void routeChange(cr, "design")}>design fix</button>
                          <button type="button" onClick={() => void routeChange(cr, "listen")} title="We got their current-state model wrong — update the ontology/workflows and cascade forward">current-state correction</button>
                          <button type="button" onClick={() => void routeChange(cr, "frame")} title="A new ask beyond the agreed scope">new requirement</button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {onSaveInputs ? (
            <button type="button" className="v3fs-btn pri v3fs-envc-inc-go" disabled={iterating} onClick={() => void newIteration()}>
              {iterating ? "Starting…" : `▶ Address & rebuild — start iteration ${ls.round + 1}`}
            </button>
          ) : null}
        </section>
      ) : null}

      {/* ── DIRECTION ─────────────────────────────────────────────────────── */}
      {fs.direction.candidates.length && showDirection ? (
        <section className={`v3fs-envc-act${effectiveOpen === "Direction" ? " open" : ""}`}>
          <div className="v3fs-envc-ah">
            <button type="button" className="v3fs-envc-ahbtn" aria-expanded={effectiveOpen === "Direction"} onClick={() => toggleAct("Direction")}>
              <span className="v3fs-envc-an">1</span>Direction
              {fs.direction.chosen ? <span className="v3fs-envc-ahsum done">✓ {fs.direction.chosen}</span> : <span className="v3fs-envc-ahsum todo">choose the shape</span>}
              <span className="v3fs-envc-ahchev" aria-hidden="true">{effectiveOpen === "Direction" ? "▾" : "▸"}</span>
            </button>
            {fs.hasArchitecture && onOpenArtifact ? <button type="button" className="v3fs-a v3fs-envc-open" onClick={() => onOpenArtifact("architecture-strategy")}>view the strategy →</button> : null}
          </div>
          {effectiveOpen !== "Direction" ? null : fs.direction.chosen ? (
            <div className="v3fs-envc-chosen">✓ On the record: <b>{fs.direction.chosen}</b></div>
          ) : (
            <>
              <div className="v3fs-envc-cands">
                {fs.direction.candidates.map((c) => (
                  <button key={c.name} type="button" className={`v3fs-envc-cand${pick === c.name ? " on" : ""}${c.recommended ? " rec" : ""}`}
                    aria-pressed={pick === c.name} onClick={() => setPick((p) => (p === c.name ? "" : c.name))}>
                    <div className="v3fs-envc-candh"><b>{c.name}</b>{c.shape ? <span className="v3fs-envc-shape">{c.shape}</span> : null}{c.recommended ? <span className="v3fs-envc-recbadge">✓ recommended</span> : null}</div>
                    {c.description ? <p>{c.description}</p> : null}
                  </button>
                ))}
              </div>
              {pick ? (
                <div className="v3fs-envc-decide">
                  <label><span>What does choosing <b>{pick}</b> trade away? <em>(recorded)</em></span>
                    <textarea rows={2} value={tradeaway} onChange={(e) => setTradeaway(e.target.value)} placeholder="The candidate's strengths you're consciously giving up…" /></label>
                  <button type="button" className="v3fs-btn pri" disabled={recording || !onSaveInputs} onClick={() => void recordDirection()}>{recording ? "Recording…" : "✓ Record this direction"}</button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {/* ── DESIGN ────────────────────────────────────────────────────────── */}
      {(fs.workflows.length || fs.agents.length) && showDesignBuild ? (
        <section className={`v3fs-envc-act${effectiveOpen === "Design" ? " open" : ""}`}>
          <div className="v3fs-envc-ah">
            <button type="button" className="v3fs-envc-ahbtn" aria-expanded={effectiveOpen === "Design"} onClick={() => toggleAct("Design")}>
              <span className="v3fs-envc-an">2</span>Design
              <span className={`v3fs-envc-ahsum ${fs.hasDesign && fs.hasBlueprint ? "done" : "todo"}`}>{fs.hasDesign && fs.hasBlueprint ? "the future state, at a glance" : "not yet complete"}</span>
              <span className="v3fs-envc-ahchev" aria-hidden="true">{effectiveOpen === "Design" ? "▾" : "▸"}</span>
            </button>
            {fs.hasDesign && onOpenArtifact ? <button type="button" className="v3fs-a v3fs-envc-open" onClick={() => onOpenArtifact("experience-design")}>open the design →</button> : null}
          </div>
          {effectiveOpen === "Design" ? (<>
          {!externalControlled && fs.areas.length > 1 ? (
            <div className="v3fs-envc-areas" role="group" aria-label="Filter by area">
              <button type="button" className={`v3fs-envc-area${area === "" ? " on" : ""}`} onClick={() => setArea("")}>All areas</button>
              {fs.areas.map((a) => (
                <button key={a} type="button" className={`v3fs-envc-area${area === a ? " on" : ""}`} onClick={() => setArea((cur) => cur === a ? "" : a)}>
                  {a}
                </button>
              ))}
            </div>
          ) : null}
          {fs.kpis.length ? (
            <div className="v3fs-envc-kpis"><span className="lbl">Moves</span>{fs.kpis.slice(0, 4).map((k, i) => <span key={i} className="v3fs-envc-kpi">◎ {k}</span>)}</div>
          ) : null}

          {/* Per-workflow: one legible row (mode-mix bar), expand for the steps. */}
          <div className="v3fs-envc-wfs">
            {workflows.map((wf, i) => {
              const key = `${wf.area}::${wf.name}`;
              const mix = modeMix(wf);
              const open = openWf === key;
              const total = wf.steps.length || 1;
              return (
                <div key={i} className={`v3fs-envc-wfrow${open ? " open" : ""}`}>
                  <button type="button" className="v3fs-envc-wfbtn" aria-expanded={open} onClick={() => setOpenWf((c) => (c === key ? null : key))}>
                    <span className="v3fs-envc-wfname">{wf.name}{wf.area && wf.area !== "General" ? <em className="v3fs-envc-tag">{wf.area}</em> : null}</span>
                    <span className="v3fs-envc-mixbar" aria-hidden="true">
                      {mix.agentify ? <span className="a" style={{ flex: mix.agentify }} /> : null}
                      {mix.assist ? <span className="s" style={{ flex: mix.assist }} /> : null}
                      {mix.keep ? <span className="k" style={{ flex: mix.keep }} /> : null}
                    </span>
                    <span className="v3fs-envc-mixn">{mix.agentify ? `${mix.agentify} agentify` : ""}{mix.assist ? ` · ${mix.assist} assist` : ""}{mix.keep ? ` · ${mix.keep} human` : ""} / {total}</span>
                    <span className="v3fs-envc-chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
                  </button>
                  {open ? (
                    <ol className="v3fs-envc-steps">
                      {wf.steps.map((s, si) => (
                        <li key={si} className={`v3fs-envc-step ${s.mode}`}>
                          <span className="v3fs-envc-act-txt">{s.action}</span>
                          <span className="v3fs-envc-arrow" aria-hidden="true">→</span>
                          <span className="v3fs-envc-mode">{s.agent && s.mode !== "keep" ? <b>{s.agent}</b> : null} {MODE_LABEL[s.mode]}{s.hitl ? <em className="v3fs-envc-hitl"> ⛨ you</em> : null}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* The two lenses — behind a toggle; the cross-highlight is the payoff. */}
          {(agents.length || screens.length) ? (
            <div className="v3fs-envc-lenswrap">
              <button type="button" className="v3fs-envc-lenstoggle" aria-expanded={showLenses} onClick={() => setShowLenses((v) => !v)}>
                {showLenses ? "▾" : "▸"} How it fits together — {agents.length} agent{agents.length === 1 ? "" : "s"} ↔ {screens.length} screen{screens.length === 1 ? "" : "s"}
              </button>
              {showLenses ? (
                <div className="v3fs-envc-lenses">
                  {agents.length ? (
                    <div className="v3fs-envc-lens">
                      <div className="v3fs-envc-lensh">Agents{focus ? <button type="button" className="v3fs-a" onClick={() => setFocus(null)}>clear</button> : <span> — tap for its screens</span>}</div>
                      {agents.map((a) => (
                        <button key={a.name} type="button" className={`v3fs-envc-agent${agentLit(a.name) ? " lit" : ""}${dim(agentLit(a.name))}`}
                          onClick={() => setFocus((f) => (f?.kind === "agent" && f.key === a.name ? null : { kind: "agent", key: a.name }))}>
                          <div className="v3fs-envc-agenth"><b>{a.name}</b>{a.autonomyLevel ? <span className="v3fs-envc-auto">{a.autonomyLevel}</span> : null}</div>
                          {a.screenIds.length ? <span className="v3fs-envc-count">powers {a.screenIds.length} screen{a.screenIds.length === 1 ? "" : "s"}</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {screens.length ? (
                    <div className="v3fs-envc-lens">
                      <div className="v3fs-envc-lensh">Screens{focus ? "" : <span> — tap for its agents</span>}</div>
                      {screens.map((s) => (
                        <button key={s.id} type="button" className={`v3fs-envc-screen${screenLit(s.id) ? " lit" : ""}${dim(screenLit(s.id))}`}
                          onClick={() => setFocus((f) => (f?.kind === "screen" && f.key === s.id ? null : { kind: "screen", key: s.id }))}>
                          <b>{s.name}</b>{s.entities.length ? <span className="v3fs-envc-ents">{s.entities.slice(0, 4).join(" · ")}</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {onOpenArtifact && !fs.hasDesign ? (
            <button type="button" className="v3fs-btn v3fs-envc-genexp" onClick={() => onOpenArtifact("experience-design")}>✦ Open the Experience Design to complete the picture</button>
          ) : null}
          </>) : null}
        </section>
      ) : null}

      {/* ── BUILD ─────────────────────────────────────────────────────────── */}
      {fs.hasDesign && showDesignBuild ? (
        <section className={`v3fs-envc-act${effectiveOpen === "Build" ? " open" : ""}`}>
          <div className="v3fs-envc-ah">
            <button type="button" className="v3fs-envc-ahbtn" aria-expanded={effectiveOpen === "Build"} onClick={() => toggleAct("Build")}>
              <span className="v3fs-envc-an">3</span>Build
              <span className={`v3fs-envc-ahsum ${hasPrototype ? "done" : "todo"}`}>{hasPrototype ? "prototype ready to show" : "assemble the prototype"}</span>
              <span className="v3fs-envc-ahchev" aria-hidden="true">{effectiveOpen === "Build" ? "▾" : "▸"}</span>
            </button>
            {hasPrototype && onOpenArtifact ? <button type="button" className="v3fs-a v3fs-envc-open" onClick={() => onOpenArtifact("prototype-build")}>open the prototype →</button> : null}
          </div>
          {effectiveOpen !== "Build" ? null : hasPrototype ? (
            <div className="v3fs-envc-built">✓ Prototype built — the delivery team&rsquo;s runnable app. The Experience Designer refines it here; Show demonstrates it to each stakeholder.</div>
          ) : onOpenArtifact ? (
            <button type="button" className="v3fs-btn v3fs-envc-genexp" onClick={() => onOpenArtifact("prototype-build")}>🖥 Open the Prototype workspace to build it</button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
