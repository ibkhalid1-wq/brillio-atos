/**
 * The Envision cockpit — the phase reimagined as three acts, not a document
 * folder: DIRECTION (choose the architecture, a recorded ceremony), DESIGN (the
 * one coherent future-state: today→tomorrow per workflow, the KPIs it moves,
 * and the experience↔agents that deliver it — cross-highlighting), and (below,
 * the collect board it sits above) VALIDATION. Projected from the record, so it
 * can never drift from the artifacts it summarises.
 */
import { useMemo, useState } from "react";
import { projectFutureState, type FutureState } from "@/v3/components/flow/flowFutureState";
import type { ProgramSummary } from "@/new/types";

const MODE_LABEL: Record<string, string> = { agentify: "agent runs it", assist: "agent assists · you decide", keep: "stays human" };

export default function EnvisionCockpit({ program, onSaveInputs, onRunAgent }: {
  program: ProgramSummary;
  onSaveInputs?: (movementId: string, patch: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
  onRunAgent?: (agentId: string, phaseId?: string) => void;
}) {
  const fs = useMemo<FutureState>(() => projectFutureState(program), [program]);
  // Cross-highlight focus: a screen id or an agent name lights up its partners.
  const [focus, setFocus] = useState<{ kind: "agent" | "screen"; key: string } | null>(null);
  const [area, setArea] = useState("");
  const [pick, setPick] = useState("");
  const [tradeaway, setTradeaway] = useState("");
  const [recording, setRecording] = useState(false);

  if (!fs.hasArchitecture && !fs.hasDesign && !fs.hasBlueprint) return null;

  const agentLit = (name: string): boolean =>
    focus?.kind === "agent" ? focus.key === name : focus?.kind === "screen"
      ? !!fs.screens.find((s) => s.id === focus.key)?.agentNames.includes(name) : false;
  const screenLit = (id: string): boolean =>
    focus?.kind === "screen" ? focus.key === id : focus?.kind === "agent"
      ? !!fs.agents.find((a) => a.name === focus.key)?.screenIds.includes(id) : false;
  const dim = (lit: boolean) => (focus ? (lit ? "" : " dim") : "");

  const inArea = <T extends { area?: string }>(items: T[]) => (area ? items.filter((i) => (i.area ?? "General") === area) : items);
  const workflows = inArea(fs.workflows);
  const agents = inArea(fs.agents);
  const screens = inArea(fs.screens);

  const recordDirection = async () => {
    if (!onSaveInputs || !pick) return;
    const text = `Chosen direction: ${pick}.${tradeaway.trim() ? `\nTraded away: ${tradeaway.trim()}` : ""}`;
    setRecording(true);
    try {
      await onSaveInputs("envision", { directionDecision: text },
        { attest: { action: `Architecture direction chosen — ${pick}`, detail: tradeaway.trim().slice(0, 140) } });
    } finally { setRecording(false); }
  };

  return (
    <div className="v3fs-envc">
      {/* ── DIRECTION ─────────────────────────────────────────────────────── */}
      {fs.direction.candidates.length ? (
        <section className="v3fs-envc-act">
          <div className="v3fs-envc-ah"><span className="v3fs-envc-an">1</span> Direction — choose the shape of the future</div>
          {fs.direction.chosen ? (
            <div className="v3fs-envc-chosen">✓ Direction on the record: <b>{fs.direction.chosen}</b></div>
          ) : null}
          <div className="v3fs-envc-cands">
            {fs.direction.candidates.map((c) => (
              <button key={c.name} type="button"
                className={`v3fs-envc-cand${pick === c.name ? " on" : ""}${c.recommended ? " rec" : ""}`}
                aria-pressed={pick === c.name} onClick={() => setPick((p) => (p === c.name ? "" : c.name))}>
                <div className="v3fs-envc-candh">
                  <b>{c.name}</b>
                  {c.shape ? <span className="v3fs-envc-shape">{c.shape}</span> : null}
                  {c.recommended ? <span className="v3fs-envc-recbadge">✓ recommended</span> : null}
                </div>
                {c.description ? <p>{c.description}</p> : null}
              </button>
            ))}
          </div>
          {pick && !fs.direction.chosen ? (
            <div className="v3fs-envc-decide">
              <label>
                <span>What does choosing <b>{pick}</b> trade away? <em>(recorded with the decision)</em></span>
                <textarea rows={2} value={tradeaway} onChange={(e) => setTradeaway(e.target.value)}
                  placeholder="The other candidate's strengths you're consciously giving up…" />
              </label>
              <button type="button" className="v3fs-btn pri" disabled={recording || !onSaveInputs}
                onClick={() => void recordDirection()}>{recording ? "Recording…" : `✓ Record this direction`}</button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ── DESIGN ────────────────────────────────────────────────────────── */}
      {(fs.workflows.length || fs.agents.length) ? (
        <section className="v3fs-envc-act">
          <div className="v3fs-envc-ah"><span className="v3fs-envc-an">2</span> Design — the future state, as one thing</div>
          {fs.areas.length > 1 ? (
            <div className="v3fs-envc-areas" role="group" aria-label="Filter by area">
              <button type="button" className={`v3fs-envc-area${area === "" ? " on" : ""}`} onClick={() => setArea("")}>All areas</button>
              {fs.areas.map((a) => <button key={a} type="button" className={`v3fs-envc-area${area === a ? " on" : ""}`} onClick={() => setArea(a)}>{a}</button>)}
            </div>
          ) : null}
          {fs.kpis.length ? (
            <div className="v3fs-envc-kpis">
              <span className="lbl">Moves the numbers</span>
              {fs.kpis.map((k, i) => <span key={i} className="v3fs-envc-kpi">◎ {k}</span>)}
            </div>
          ) : null}

          {/* today → tomorrow per workflow */}
          {workflows.map((wf, i) => (
            <div key={i} className="v3fs-envc-wf">
              <div className="v3fs-envc-wfh"><b>{wf.name}</b>{wf.area && wf.area !== "General" ? <span className="v3fs-envc-tag">{wf.area}</span> : null}</div>
              <ol className="v3fs-envc-steps">
                {wf.steps.map((s, si) => (
                  <li key={si} className={`v3fs-envc-step ${s.mode}`}>
                    <span className="v3fs-envc-act-txt">{s.action}</span>
                    <span className="v3fs-envc-arrow" aria-hidden="true">→</span>
                    <span className="v3fs-envc-mode">
                      {s.agent && s.mode !== "keep" ? <b>{s.agent}</b> : null} {MODE_LABEL[s.mode]}
                      {s.hitl ? <em className="v3fs-envc-hitl"> ⛨ you approve</em> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}

          {/* the two lenses — experience ↔ agents, cross-highlighting */}
          {(agents.length || screens.length) ? (
            <div className="v3fs-envc-lenses">
              {agents.length ? (
                <div className="v3fs-envc-lens">
                  <div className="v3fs-envc-lensh">The agents{focus ? <button type="button" className="v3fs-a" onClick={() => setFocus(null)}>clear</button> : <span> — tap to see the screens it powers</span>}</div>
                  {agents.map((a) => (
                    <button key={a.name} type="button" className={`v3fs-envc-agent${agentLit(a.name) ? " lit" : ""}${dim(agentLit(a.name))}`}
                      onClick={() => setFocus((f) => (f?.kind === "agent" && f.key === a.name ? null : { kind: "agent", key: a.name }))}>
                      <div className="v3fs-envc-agenth"><b>{a.name}</b>{a.autonomyLevel ? <span className="v3fs-envc-auto">{a.autonomyLevel}</span> : null}</div>
                      {a.purpose ? <p>{a.purpose}</p> : null}
                      {a.screenIds.length ? <span className="v3fs-envc-count">powers {a.screenIds.length} screen{a.screenIds.length === 1 ? "" : "s"}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              {screens.length ? (
                <div className="v3fs-envc-lens">
                  <div className="v3fs-envc-lensh">The screens{focus ? "" : <span> — tap to see the agents behind it</span>}</div>
                  {screens.map((s) => (
                    <button key={s.id} type="button" className={`v3fs-envc-screen${screenLit(s.id) ? " lit" : ""}${dim(screenLit(s.id))}`}
                      onClick={() => setFocus((f) => (f?.kind === "screen" && f.key === s.id ? null : { kind: "screen", key: s.id }))}>
                      <b>{s.name}</b>
                      {s.entities.length ? <span className="v3fs-envc-ents">{s.entities.slice(0, 4).join(" · ")}</span> : null}
                      {s.agentNames.length ? <span className="v3fs-envc-count">{s.agentNames.length} agent{s.agentNames.length === 1 ? "" : "s"}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {onRunAgent && !fs.hasDesign ? (
            <button type="button" className="v3fs-btn v3fs-envc-genexp" onClick={() => onRunAgent("experience-design", "envision")}>
              ✦ Generate the Experience Design to complete the picture
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
