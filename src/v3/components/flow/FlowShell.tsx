import React, { useEffect, useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import FlowCanvas from "@/v3/components/flow/FlowCanvas";
import {
  flowMovements, movementEvidence, movementArtifacts, listenCoverage,
  demoAcceptance, daysToFirstDemo, wordsOfEvidence, frameKpis,
} from "@/v3/components/flow/flowShellData";

interface FlowShellProps {
  program: ProgramSummary;
  programs: ProgramSummary[];
  runningAgentIds: Set<string>;
  onSelectProgram: (id: string) => void;
  onCreateProgram: () => void;
  onOpenSetup: () => void;
  onOpenCopilot: () => void;
  onExitShell: () => void;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean }) => Promise<void>;
}

type FlowView = "flow" | "library" | "pulse";

/**
 * "Paper & Flow" — the reimagined shell for ATOS Flow programmes. None of the
 * classic chrome renders here: a floating dock (Flow · Library · Pulse ·
 * Copilot), an editorial hero with the one metric that matters (days to first
 * demo), and the pipeline as the page. Brand hues carry one grammar: blue =
 * what people said, indigo = what ATOS made, green = what was demonstrated.
 * Theme-aware — follows the app's data-theme like every other surface.
 */
export default function FlowShell(props: FlowShellProps) {
  const { program } = props;
  const [view, setView] = useState<FlowView>("flow");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const days = daysToFirstDemo(program);

  // The switcher dismisses like a menu should: backdrop click or Escape.
  useEffect(() => {
    if (!switcherOpen) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSwitcherOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [switcherOpen]);

  return (
    <div className="v3fs-app">
      <nav className="v3fs-dock" aria-label="Primary">
        <button type="button" className="v3fs-brand" onClick={() => setSwitcherOpen((v) => !v)} aria-label="Programme menu" aria-expanded={switcherOpen}>
          {(program.name || "F").slice(0, 1).toUpperCase()}
          <span className="v3fs-brand-caret" aria-hidden="true">▾</span>
        </button>
        {([["flow", "⟶", "Flow"], ["library", "◫", "Library"], ["pulse", "◉", "Pulse"]] as const).map(([id, icon, label]) => (
          <button key={id} type="button" className={view === id ? "on" : ""} onClick={() => { setView(id); window.scrollTo({ top: 0 }); }}>
            <span className="v3fs-ric" aria-hidden="true">{icon}</span><span className="v3fs-rlb">{label}</span>
          </button>
        ))}
        <div className="v3fs-dock-sep" aria-hidden="true" />
        <button type="button" className="v3fs-cp" onClick={props.onOpenCopilot}>
          <span className="v3fs-ric" aria-hidden="true">✦</span><span className="v3fs-rlb">Copilot</span>
        </button>
      </nav>

      {switcherOpen ? (
        <div className="v3fs-switcher-backdrop" onClick={() => setSwitcherOpen(false)} aria-hidden="true" />
      ) : null}
      {switcherOpen ? (
        <div className="v3fs-switcher" role="menu">
          <div className="v3fs-switcher-l">Programmes</div>
          {props.programs.map((entry) => (
            <button key={entry.id} type="button" role="menuitem" className={entry.id === program.id ? "on" : ""}
              onClick={() => { setSwitcherOpen(false); props.onSelectProgram(entry.id); }}>
              {entry.name}
            </button>
          ))}
          <div className="v3fs-switcher-sep" />
          <button type="button" role="menuitem" onClick={() => { setSwitcherOpen(false); props.onCreateProgram(); }}>＋ New programme</button>
          <button type="button" role="menuitem" onClick={() => { setSwitcherOpen(false); props.onOpenSetup(); }}>Programme setup</button>
          <button type="button" role="menuitem" onClick={() => { setSwitcherOpen(false); props.onExitShell(); }}>Open classic workspace</button>
        </div>
      ) : null}

      <div className="v3fs-wrap">
        <header className="v3fs-hero">
          <h1 className="v3fs-hero-title">
            <span className="v3fs-hero-brand">ATOS Flow</span> · {program.name}
            {program.client ? <span className="v3fs-hero-client"> · {program.client}</span> : null}
          </h1>
          <p className="v3fs-how">
            Work each movement in turn: add the recorded conversations and facts it needs, review the
            artifacts ATOS drafts from them, and advance once the gate&rsquo;s demonstration is accepted.
            Add new evidence any time — everything downstream re-generates to match.
          </p>
          {days != null ? (
            <div className="v3fs-hero-row">
              <div className="v3fs-count">
                <div className="v3fs-count-n"><b>{days}</b> day{Math.abs(days) === 1 ? "" : "s"}</div>
                <div className="v3fs-count-l">
                  {days >= 0 ? "until the first stakeholder demonstration" : "past the planned first demonstration — update the target in Frame"}
                </div>
              </div>
            </div>
          ) : null}
          <div className="v3fs-grammar">
            <span><i style={{ background: "var(--v3-accent-b)" }} /> Stakeholder evidence</span>
            <span><i style={{ background: "var(--v3-accent)" }} /> Generated by ATOS</span>
            <span><i style={{ background: "var(--v3-green)" }} /> Demonstrated & accepted</span>
          </div>
        </header>

        {view === "flow" ? (
          <FlowCanvas program={program} runningAgentIds={props.runningAgentIds} onRunAgent={props.onRunAgent} onSaveInputs={props.onSaveInputs} />
        ) : view === "library" ? (
          <FlowLibrary program={program} />
        ) : (
          <FlowPulse program={program} />
        )}
      </div>
    </div>
  );
}

/* ── Library: everything the programme knows ─────────────────────────────── */

function FlowLibrary({ program }: { program: ProgramSummary }) {
  const movements = useMemo(() => flowMovements(), []);
  const [query, setQuery] = useState("");
  const all = useMemo(() => ({
    evidence: movements.flatMap((m) => movementEvidence(program, m)),
    artifacts: movements.flatMap((m) => movementArtifacts(program, m)),
  }), [program, movements]);
  const q = query.trim().toLowerCase();
  const evidence = q ? all.evidence.filter((e) => `${e.who} ${e.fieldLabel} ${e.excerpt}`.toLowerCase().includes(q)) : all.evidence;
  const artifacts = q ? all.artifacts.filter((a) => `${a.title} ${a.excerpt ?? ""}`.toLowerCase().includes(q)) : all.artifacts;
  const label = (id: string) => movements.find((m) => m.id === id)?.displayName ?? id;

  return (
    <div className="v3fs-grid2">
      <div className="v3fs-search-row">
        <input
          className="v3fs-search"
          placeholder="Search everything the programme knows — a name, a number, a phrase…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search evidence and artifacts"
        />
      </div>
      <div className="v3fs-panel">
        <div className="v3fs-ph"><h3>Evidence</h3><span>all conversations and source material on record</span></div>
        {evidence.length === 0 ? <div className="v3fs-empty">{q ? "Nothing matches that search." : "No evidence captured yet. Add the first conversation in Frame or Listen."}</div> : null}
        {evidence.map((entry, i) => (
          <div key={i} className="v3fs-row">
            <span className="v3fs-tag ev">{label(entry.movementId)}</span>
            <div className="v3fs-row-g">
              <div className="v3fs-row-n">{entry.who}</div>
              <div className="v3fs-row-m">{entry.kind === "reference" ? entry.meta : `${entry.words.toLocaleString()} words`}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="v3fs-panel">
        <div className="v3fs-ph"><h3>Artifacts</h3><span>generated documents — versioned, traceable to evidence</span></div>
        {artifacts.map((artifact) => (
          <div key={`${artifact.movementId}:${artifact.id}`} className="v3fs-row">
            <span className={`v3fs-st ${artifact.present ? "ok" : "none"}`} />
            <div className="v3fs-row-g">
              <div className="v3fs-row-n">{artifact.title}</div>
              <div className="v3fs-row-m">{artifact.present ? (artifact.confidence != null ? `generated · ${artifact.confidence}%` : "generated") : "not yet generated"}</div>
            </div>
            <span className="v3fs-tag gn">{label(artifact.movementId)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Pulse: the steering-meeting screen ──────────────────────────────────── */

function FlowPulse({ program }: { program: ProgramSummary }) {
  const days = daysToFirstDemo(program);
  const coverage = listenCoverage(program);
  const demos = demoAcceptance(program);
  const words = wordsOfEvidence(program);
  const kpis = frameKpis(program);

  return (
    <div className="v3fs-pulse">
      <div className="v3fs-stats">
        <div className="v3fs-stat hero">
          <div className="v3fs-stat-n">{days != null ? <b>{days}</b> : <b>—</b>}{days != null ? <small> days</small> : null}</div>
          <div className="v3fs-stat-l">{days != null ? "to first demo" : "first-demo date unset"}</div>
        </div>
        <div className="v3fs-stat"><div className="v3fs-stat-n"><b>{coverage.done}</b><small>/{coverage.total || "?"}</small></div><div className="v3fs-stat-l">stakeholders engaged</div></div>
        <div className="v3fs-stat"><div className="v3fs-stat-n"><b>{demos.accepted}</b><small>/{demos.total || "?"}</small></div><div className="v3fs-stat-l">demonstrations accepted</div></div>
        <div className="v3fs-stat"><div className="v3fs-stat-n"><b>{words.toLocaleString()}</b></div><div className="v3fs-stat-l">words of evidence</div></div>
      </div>
      <div className="v3fs-grid2">
        <div className="v3fs-panel">
          <div className="v3fs-ph"><h3>Stakeholder demonstrations</h3><span>acceptance recorded person by person</span></div>
          {demos.rows.length === 0 ? <div className="v3fs-empty">Demonstrations are scheduled and recorded in the Show movement.</div> : null}
          {demos.rows.map((row, i) => (
            <div key={i} className="v3fs-row">
              <div className="v3fs-row-g">
                <div className="v3fs-row-n">{row.stakeholder || "—"}</div>
                <div className="v3fs-row-m">{row.reaction || row.date || ""}</div>
              </div>
              <span className={`v3fs-vc ${/accepted/i.test(row.verdict ?? "") ? "acc" : "pen"}`}>{row.verdict || "Pending"}</span>
            </div>
          ))}
        </div>
        <div className="v3fs-panel">
          <div className="v3fs-ph"><h3>Outcomes</h3><span>measured against stakeholder-stated baselines</span></div>
          {kpis.length === 0 ? <div className="v3fs-empty">Success KPIs defined in Frame appear here, with baselines drawn from discovery.</div> : null}
          {kpis.map((kpi, i) => (
            <div key={i} className="v3fs-kpi">
              <div className="v3fs-kpi-t"><b>{kpi.name}</b><span>{[kpi.baseline, kpi.target].filter(Boolean).join(" → ")}{kpi.unit ? ` ${kpi.unit}` : ""}</span></div>
              <div className="v3fs-river"><div className="v3fs-river-to" /><div className="v3fs-river-mk" /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
