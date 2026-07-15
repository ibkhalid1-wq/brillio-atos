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
import { readMovementInputs } from "@/v3/components/flow/flowShellData";
import type { ProgramSummary } from "@/new/types";

const MODE_LABEL: Record<string, string> = { agentify: "agent runs it", assist: "agent assists · you decide", keep: "stays human" };

function modeMix(wf: FutureWorkflow): { agentify: number; assist: number; keep: number } {
  return wf.steps.reduce((m, s) => ({ ...m, [s.mode]: m[s.mode] + 1 }), { agentify: 0, assist: 0, keep: 0 } as Record<string, number>) as { agentify: number; assist: number; keep: number };
}

export default function EnvisionCockpit({ program, onSaveInputs, onRunAgent }: {
  program: ProgramSummary;
  onSaveInputs?: (movementId: string, patch: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
  onRunAgent?: (agentId: string, phaseId?: string) => void;
}) {
  const fs = useMemo<FutureState>(() => projectFutureState(program), [program]);
  const hasPrototype = useMemo(() => {
    const inputs = readMovementInputs(program, "envision");
    return Boolean(inputs.prototypeBuild || inputs.prototypePack);
  }, [program]);
  const [focus, setFocus] = useState<{ kind: "agent" | "screen"; key: string } | null>(null);
  const [area, setArea] = useState("");
  const [openWf, setOpenWf] = useState<string | null>(null);
  const [showLenses, setShowLenses] = useState(false);
  const [pick, setPick] = useState("");
  const [tradeaway, setTradeaway] = useState("");
  const [recording, setRecording] = useState(false);

  if (!fs.hasArchitecture && !fs.hasDesign && !fs.hasBlueprint) return null;

  const acts = [
    { label: "Direction", done: !!fs.direction.chosen, hint: fs.direction.chosen || "choose the shape" },
    { label: "Design", done: fs.hasDesign && fs.hasBlueprint, hint: fs.hasDesign && fs.hasBlueprint ? "the future state" : "not yet complete" },
    { label: "Build", done: hasPrototype, hint: hasPrototype ? "prototype ready to show" : "assemble the prototype" },
  ];

  const agentLit = (name: string): boolean =>
    focus?.kind === "agent" ? focus.key === name : focus?.kind === "screen" ? !!fs.screens.find((s) => s.id === focus.key)?.agentNames.includes(name) : false;
  const screenLit = (id: string): boolean =>
    focus?.kind === "screen" ? focus.key === id : focus?.kind === "agent" ? !!fs.agents.find((a) => a.name === focus.key)?.screenIds.includes(id) : false;
  const dim = (lit: boolean) => (focus ? (lit ? "" : " dim") : "");

  const inArea = <T extends { area?: string }>(items: T[]) => (area ? items.filter((i) => (i.area ?? "General") === area) : items);
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
      {/* Three-act progress at a glance. */}
      <div className="v3fs-envc-ribbon">
        {acts.map((a, i) => (
          <div key={a.label} className={`v3fs-envc-rstep${a.done ? " done" : ""}`}>
            <span className="v3fs-envc-rn">{a.done ? "✓" : i + 1}</span>
            <span className="v3fs-envc-rl">{a.label}<em>{a.hint}</em></span>
          </div>
        ))}
      </div>

      {/* ── DIRECTION ─────────────────────────────────────────────────────── */}
      {fs.direction.candidates.length ? (
        <section className="v3fs-envc-act">
          <div className="v3fs-envc-ah"><span className="v3fs-envc-an">1</span>Direction{fs.hasArchitecture && onRunAgent ? <button type="button" className="v3fs-a v3fs-envc-open" onClick={() => onRunAgent("architecture-strategy", "envision")}>view the strategy →</button> : null}</div>
          {fs.direction.chosen ? (
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
      {(fs.workflows.length || fs.agents.length) ? (
        <section className="v3fs-envc-act">
          <div className="v3fs-envc-ah"><span className="v3fs-envc-an">2</span>Design — the future state, at a glance
            {fs.hasDesign && onRunAgent ? <button type="button" className="v3fs-a v3fs-envc-open" onClick={() => onRunAgent("experience-design", "envision")}>open the design →</button> : null}</div>
          {fs.areas.length > 1 ? (
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
          {onRunAgent && !fs.hasDesign ? (
            <button type="button" className="v3fs-btn v3fs-envc-genexp" onClick={() => onRunAgent("experience-design", "envision")}>✦ Generate the Experience Design to complete the picture</button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
