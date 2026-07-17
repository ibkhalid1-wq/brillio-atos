/**
 * FlowNextBoard — the reimagined phase home for the two workstream phases
 * (Listen · Prototype), shown only under the `?ui=next` chrome. Both phases run
 * PER AREA in parallel: the board shows every area at once (the Focus card picks
 * the single most valuable move across them), then Focus one area to open its
 * three-zone workspace. "Open the workspace" drops into the existing, proven
 * movement body for the actual editing — this layer is navigation + overview.
 *
 * All figures are REAL, read from the same derivations the classic surfaces use:
 *   Listen    → areaProgress()  (heard / personas, entities, business map)
 *   Prototype → loopState()     (round, per-area verdicts, convergence)
 */
import { useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { areaProgress, areaHasModel, hasMultipleAreas } from "@/v3/components/flow/flowAreas";
import { loopState, changeRequests, type AreaLoop } from "@/v3/components/flow/flowLoop";
import { areaAccent, areaMonogram } from "@/v3/components/flow/CollectBoard";

type Phase = "listen" | "prototype";

const initials = (name: string): string => {
  const w = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? "")).toUpperCase() || (name.slice(0, 2).toUpperCase());
};

export default function FlowNextBoard({ program, phase, onOpenWork }: {
  program: ProgramSummary;
  phase: Phase;
  onOpenWork: () => void;
}) {
  const [focusArea, setFocusArea] = useState<string | null>(null);
  const rows = areaProgress(program);
  const ls = loopState(program);
  const multi = hasMultipleAreas(program);

  // ── The Focus card — "do this next", computed across every area ──────────
  const focus = (() => {
    if (phase === "listen") {
      const open = rows.filter((r) => r.personas.length > 0 && !r.listenReady);
      if (!rows.length) return { mark: "🎧", title: "Listen hasn't started yet.", sub: "Add the people to hear from and send them discovery links.", cta: "Open the workspace" };
      if (!open.length) return { mark: "🎧", title: "Every area has a complete picture — ready for Prototype.", sub: "All voices heard and the business map confirmed across areas.", cta: "Open the workspace" };
      // Closest to done = smallest remaining, ties broken by highest ratio heard.
      const best = [...open].sort((a, b) => (a.personas.length - a.heard.length) - (b.personas.length - b.heard.length) || (b.heard.length / b.personas.length) - (a.heard.length / a.personas.length))[0];
      const left = best.personas.length - best.heard.length;
      return {
        mark: "🎧",
        title: `${best.area} is ${left} interview${left === 1 ? "" : "s"} from a complete picture — the most valuable move across ${multi ? "all areas" : "the programme"}.`,
        sub: `${best.heard.length} of ${best.personas.length} heard. Send the remaining discovery link${left === 1 ? "" : "s"} to close it.`,
        cta: `Focus ${best.area}`,
        area: best.area,
      };
    }
    // Prototype
    if (!ls.hasPrototype) return { mark: "◎", title: "Build the prototype to start validating.", sub: "Design assembles one clickable build from the areas' slices, then pilots weigh in.", cta: "Open the workspace" };
    if (ls.converged) return { mark: "◎", title: "Approved — every area signed off and the sponsor accepted.", sub: "The areas' prototypes are ready to merge into one build for Ship.", cta: "Open the workspace" };
    const contending = ls.areas.filter((a) => !a.converged && a.total > 0);
    const best = [...contending].sort((a, b) => (a.total - a.accepted) - (b.total - b.accepted))[0];
    if (best) {
      const need = Math.max(0, Math.ceil(best.total / 2) - best.accepted) + best.pending;
      return {
        mark: "◎",
        title: `${best.area} is ${best.pending} verdict${best.pending === 1 ? "" : "s"} from converging — the first area to clear opens the merge.`,
        sub: `${best.accepted} of ${best.total} pilots approved. ${best.objections + best.changes} change request${best.objections + best.changes === 1 ? "" : "s"} queued for the next round.`,
        cta: `Focus ${best.area}`,
        area: best.area,
        _need: need,
      };
    }
    return { mark: "◎", title: `${ls.areasConverged}/${ls.areasTotal} areas signed off — awaiting verdicts.`, sub: "Each area converges on its own; the build merges once all clear.", cta: "Open the workspace" };
  })();

  const goFocus = () => { if ((focus as { area?: string }).area) setFocusArea((focus as { area?: string }).area!); else onOpenWork(); };

  return (
    <div className="v3fs-nb">
      {/* Focus — the one thing to do next, across areas */}
      <div className="v3fs-nb-focus">
        <div className="v3fs-nb-fmark" aria-hidden="true">{focus.mark}</div>
        <div className="v3fs-nb-ftext">
          <div className="v3fs-nb-flabel">{focusArea ? `${focusArea} · do this next` : "Across areas · do this next"}</div>
          <h2 className="v3fs-nb-ftitle">{focus.title}</h2>
          <div className="v3fs-nb-fsub">{focus.sub}</div>
        </div>
        <button type="button" className="v3fs-nb-primary" onClick={focusArea ? onOpenWork : goFocus}>
          {focusArea ? "Open the workspace" : focus.cta}
        </button>
      </div>

      {focusArea
        ? <FocusedArea program={program} phase={phase} area={focusArea} rows={rows} ls={ls} onBack={() => setFocusArea(null)} onOpenWork={onOpenWork} />
        : <Board program={program} phase={phase} rows={rows} ls={ls} onFocus={setFocusArea} />}
    </div>
  );
}

// ── The parallel board: one lane per area ──────────────────────────────────
function Board({ program, phase, rows, ls, onFocus }: {
  program: ProgramSummary;
  phase: Phase;
  rows: ReturnType<typeof areaProgress>;
  ls: ReturnType<typeof loopState>;
  onFocus: (area: string) => void;
}) {
  if (phase === "listen") {
    return (
      <>
        <p className="v3fs-nb-note">Each area builds its <b>own</b> understanding in parallel — its business map and its “how it works today”. An area is ready for Prototype when it’s fully heard.</p>
        {rows.map((r) => {
          const map = areaHasModel(program, r.area);
          const pct = r.personas.length ? Math.round((100 * r.heard.length) / r.personas.length) : 0;
          const idle = r.personas.length === 0;
          return (
            <div key={r.area} className={`v3fs-nb-lane${idle ? " idle" : ""}`}>
              <div className="v3fs-nb-lname" style={{ "--acc": areaAccent(r.area) } as React.CSSProperties}>
                <span className="v3fs-nb-mono" aria-hidden="true">{areaMonogram(r.area)}</span>
                <span>{r.area}</span>
              </div>
              <div className="v3fs-nb-lstat">
                <div className="v3fs-nb-b"><span className="v3fs-nb-k">Heard</span><span className="v3fs-nb-v">{r.heard.length} / {r.personas.length || "—"}</span><span className="v3fs-nb-meter"><i style={{ width: `${pct}%` }} /></span></div>
                <div className="v3fs-nb-b"><span className="v3fs-nb-k">Business map</span><span className="v3fs-nb-v">{map ? <span className="ok">✓ confirmed</span> : <span className="wip">● drafting</span>}</span></div>
                <div className="v3fs-nb-b"><span className="v3fs-nb-k">How it works today</span><span className="v3fs-nb-v">{r.workflows > 0 ? <span className="ok">✓ {r.workflows} workflow{r.workflows === 1 ? "" : "s"}</span> : <span className="idle">○ seeded</span>}</span></div>
              </div>
              <button type="button" className="v3fs-nb-focusbtn" onClick={() => onFocus(r.area)}>{r.listenReady ? "Review" : "Focus"} →</button>
            </div>
          );
        })}
      </>
    );
  }
  // Prototype board
  const byArea = new Map(ls.areas.map((a) => [a.area, a]));
  const closest = ls.areas.filter((a) => !a.converged && a.total > 0).sort((a, b) => (a.total - a.accepted) - (b.total - b.accepted))[0]?.area;
  return (
    <>
      <div className="v3fs-nb-merge"><span className="v3fs-nb-merge-ic" aria-hidden="true">⤷</span><div>All areas’ prototypes <b>merge into one build</b> before Ship — <b>{ls.areasConverged} of {ls.areasTotal || rows.length}</b> converged. Each area builds &amp; validates its own slice first.</div></div>
      {(rows.length ? rows.map((r) => r.area) : ls.areas.map((a) => a.area)).map((area) => {
        const P = byArea.get(area);
        if (!P || P.total === 0) {
          const lp = rows.find((r) => r.area === area);
          return (
            <div key={area} className="v3fs-nb-lane idle">
              <div className="v3fs-nb-lname" style={{ "--acc": areaAccent(area) } as React.CSSProperties}><span className="v3fs-nb-mono" aria-hidden="true">{areaMonogram(area)}</span><span>{area}</span></div>
              <div className="v3fs-nb-lstat"><div className="v3fs-nb-b"><span className="v3fs-nb-k">Status</span><span className="v3fs-nb-v idle">{lp && lp.listenReady ? "Ready — no verdicts yet" : "Still in Listen — prototype not started"}</span></div></div>
              <button type="button" className="v3fs-nb-focusbtn" onClick={() => onFocus(area)}>Focus →</button>
            </div>
          );
        }
        return (
          <div key={area} className="v3fs-nb-lane">
            <div className="v3fs-nb-lname" style={{ "--acc": areaAccent(area) } as React.CSSProperties}><span className="v3fs-nb-mono" aria-hidden="true">{areaMonogram(area)}</span><span>{area}</span></div>
            <div className="v3fs-nb-lstat">
              <div className="v3fs-nb-b"><span className="v3fs-nb-k">Round</span><span className="v3fs-nb-v">Round {ls.round}</span></div>
              <div className="v3fs-nb-b"><span className="v3fs-nb-k">Verdicts</span><span className="v3fs-nb-v v3fs-nb-vd"><span className="vd ok">{P.accepted} ✓</span><span className="vd no">{P.objections + P.changes} ✕</span><span className="vd wait">{P.pending} ⧗</span></span></div>
            </div>
            {P.converged ? <span className="v3fs-nb-tag close">signed off</span> : area === closest ? <span className="v3fs-nb-tag close">closest</span> : <span className="v3fs-nb-tag mid">iterating</span>}
            <button type="button" className="v3fs-nb-focusbtn" onClick={() => onFocus(area)}>Focus →</button>
          </div>
        );
      })}
    </>
  );
}

// ── Focused area: the three-zone workspace overview ────────────────────────
function FocusedArea({ program, phase, area, rows, ls, onBack, onOpenWork }: {
  program: ProgramSummary;
  phase: Phase;
  area: string;
  rows: ReturnType<typeof areaProgress>;
  ls: ReturnType<typeof loopState>;
  onBack: () => void;
  onOpenWork: () => void;
}) {
  const back = (
    <div className="v3fs-nb-backrow">
      <button type="button" className="v3fs-nb-back" onClick={onBack}>← All areas</button>
      <span className="v3fs-nb-title" style={{ "--acc": areaAccent(area) } as React.CSSProperties}>{area}<span className="v3fs-nb-dom">{phase === "listen" ? "Listen" : "Prototype"}</span></span>
    </div>
  );

  if (phase === "listen") {
    const r = rows.find((x) => x.area === area);
    const map = areaHasModel(program, area);
    const pct = r && r.personas.length ? Math.round((100 * r.heard.length) / r.personas.length) : 0;
    return (
      <>
        {back}
        <div className="v3fs-nb-zones">
          <div className="v3fs-nb-zone">
            <p className="v3fs-nb-ztag">This area · Listen</p>
            <div className="v3fs-nb-prog"><span className="big">{r?.heard.length ?? 0}</span><span className="of">/ {r?.personas.length ?? 0} heard</span></div>
            <span className="v3fs-nb-meter wide"><i style={{ width: `${pct}%` }} /></span>
            <ul className="v3fs-nb-produces">
              <li><span className={`ic ${map ? "ok" : "wip"}`}>{map ? "✓" : "●"}</span> Business map</li>
              <li><span className={`ic ${(r?.workflows ?? 0) > 0 ? "ok" : "dot"}`}>{(r?.workflows ?? 0) > 0 ? "✓" : "○"}</span> How it works today</li>
            </ul>
            <div className="v3fs-nb-ready"><b>Ready when</b> this area is fully heard and its map is confirmed.</div>
          </div>
          <div className="v3fs-nb-zone">
            <p className="v3fs-nb-ztag">The work</p>
            <div className="v3fs-nb-worksum">
              <div className="v3fs-nb-ws"><span className="n">{r?.entities ?? 0}</span><span className="l">entities in the business map</span></div>
              <div className="v3fs-nb-ws"><span className="n">{r?.workflows ?? 0}</span><span className="l">workflows on the atlas</span></div>
            </div>
            <button type="button" className="v3fs-nb-open" onClick={onOpenWork}>Open the workspace →</button>
            <p className="v3fs-nb-hint">Edit the business map, atlas and discovery in the full workspace.</p>
          </div>
          <div className="v3fs-nb-zone">
            <p className="v3fs-nb-ztag">The record · heard</p>
            <ul className="v3fs-nb-rec">
              {(r?.heard ?? []).map((who) => (
                <li key={who}><span className="av">{initials(who)}</span><div><div className="who">{who}</div><div className="what">Listen evidence on record</div></div></li>
              ))}
              {!(r?.heard ?? []).length ? <li className="empty">No one heard in this area yet.</li> : null}
            </ul>
          </div>
        </div>
      </>
    );
  }

  // Prototype focused
  const P: AreaLoop | undefined = ls.areas.find((x) => x.area === area);
  const reqs = changeRequests(program).filter((c) => c.area === area);
  if (!P || P.total === 0) {
    const r = rows.find((x) => x.area === area);
    return (
      <>
        {back}
        <div className="v3fs-nb-gatebox">
          <b>Prototype hasn’t started for {area}.</b>
          {r && r.listenReady ? "This area is fully heard — its build begins as Design assembles the prototype." : `This area is still in Listen — ${r?.heard.length ?? 0} of ${r?.personas.length ?? 0} heard. Its build begins once the picture is complete.`}
        </div>
      </>
    );
  }
  return (
    <>
      {back}
      <div className="v3fs-nb-zones">
        <div className="v3fs-nb-zone">
          <p className="v3fs-nb-ztag">This area · Prototype</p>
          <div className="v3fs-nb-prog"><span className="big">Round {ls.round}</span></div>
          <ul className="v3fs-nb-produces">
            <li><span className={`ic ${ls.hasPrototype ? "ok" : "dot"}`}>{ls.hasPrototype ? "✓" : "○"}</span> Clickable prototype</li>
            <li><span className={`ic ${P.pending === 0 ? "ok" : "wip"}`}>{P.pending === 0 ? "✓" : "●"}</span> Pilot verdicts</li>
          </ul>
          <div className="v3fs-nb-ready"><b>Ready when</b> the sponsor and a majority of this area’s pilots approve. Then it merges toward Ship.</div>
        </div>
        <div className="v3fs-nb-zone">
          <p className="v3fs-nb-ztag">The work · verdicts</p>
          <div className="v3fs-nb-worksum">
            <div className="v3fs-nb-ws"><span className="n ok">{P.accepted}</span><span className="l">approved</span></div>
            <div className="v3fs-nb-ws"><span className="n no">{P.objections + P.changes}</span><span className="l">change{P.objections + P.changes === 1 ? "" : "s"}</span></div>
            <div className="v3fs-nb-ws"><span className="n wait">{P.pending}</span><span className="l">pending</span></div>
          </div>
          <button type="button" className="v3fs-nb-open" onClick={onOpenWork}>Open the validation board →</button>
        </div>
        <div className="v3fs-nb-zone">
          <p className="v3fs-nb-ztag">The record · change requests</p>
          <ul className="v3fs-nb-rec">
            {reqs.map((c, i) => (
              <li key={`${c.stakeholder}-${i}`}><span className="av">{initials(c.stakeholder)}</span><div><div className="who">{c.stakeholder}{c.blocking ? <span className="v3fs-nb-block"> objection</span> : null}</div><div className="what">{c.ask || c.verdict}</div></div></li>
            ))}
            {!reqs.length ? <li className="empty">No open change requests — everyone’s approved or pending.</li> : null}
          </ul>
        </div>
      </div>
    </>
  );
}
