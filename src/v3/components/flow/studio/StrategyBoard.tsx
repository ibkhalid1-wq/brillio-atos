/**
 * The Architecture Strategy as a decision board. The options run as a summary
 * row — name, topology, the recommended crown, a compact score read — and
 * clicking one TOGGLES a full detail panel below it: a shape-specific visual
 * architecture diagram (derived from the option's topology + integration map),
 * the agentic pattern, every score with its basis, strengths/risks, the
 * build-vs-buy calls and the failure modes. Choosing "Recommend" writes the
 * same recommendation object the generator emits.
 */
import { useMemo, useState } from "react";
import { asArray, asRecord, asText, asStrings, EmptyState, useStudioLocked, type StudioProps } from "./StudioKit";

const SCORE_DIMS: Array<{ key: string; label: string }> = [
  { key: "fitToWorkflows", label: "Fit to workflows" },
  { key: "timeToFirstDemo", label: "Time to first demo" },
  { key: "operability", label: "Operability" },
  { key: "reliability", label: "Reliability" },
  { key: "scaleLatency", label: "Scale & latency" },
  { key: "security", label: "Security" },
  { key: "dataResidencyPII", label: "Data residency / PII" },
  { key: "cost", label: "Cost" },
];
// The four headline dims that lead each summary card.
const HEADLINE_DIMS = SCORE_DIMS.slice(0, 4);

const score10 = (raw: unknown): number => Math.max(0, Math.min(10, Number(asText(raw)) || 0));

const SHAPE_LABEL: Record<string, string> = {
  orchestrator: "Orchestrator hub",
  crew: "Crew of peers",
  embedded: "Embedded per-workflow",
  pipeline: "Pipeline",
  mesh: "Agent mesh",
};

/** A shape-aware architecture diagram for one option. The agent layer is drawn
 * per topology (a central hub, a peer crew on an event bus, or agents embedded
 * in the systems); the systems come straight from the option's integration
 * map, with directional edges labelled by method. Pure SVG, theme-var colours. */
function ArchDiagram({ shape, integrationMap }: { shape: string; integrationMap: Array<Record<string, unknown>> }) {
  const systems = integrationMap.slice(0, 6).map((m) => ({
    system: asText(m.system) || "System",
    method: asText(m.method) || "",
    direction: asText(m.direction) || "both",
  }));
  const W = 640, H = Math.max(200, 70 + systems.length * 46);
  const sysX = 470, sysW = 150, sysH = 30, sysGap = 16;
  const sysTop = (H - (systems.length * sysH + (systems.length - 1) * sysGap)) / 2;
  const sysY = (i: number) => sysTop + i * (sysH + sysGap) + sysH / 2;
  const arrow = (dir: string, fromX: number, y: number, toX: number) => {
    // read = system→agents (leftward), write = agents→system (rightward), both = ↔
    const rightward = dir === "write";
    const leftward = dir === "read";
    const both = !rightward && !leftward;
    return (
      <g key={`e-${y}-${toX}`}>
        <line x1={fromX} y1={y} x2={toX} y2={y} stroke="var(--fs-line)" strokeWidth="1.5" />
        {(rightward || both) ? <polygon points={`${toX},${y} ${toX - 7},${y - 4} ${toX - 7},${y + 4}`} fill="var(--v3-accent-2)" /> : null}
        {(leftward || both) ? <polygon points={`${fromX},${y} ${fromX + 7},${y - 4} ${fromX + 7},${y + 4}`} fill="var(--v3-accent-2)" /> : null}
      </g>
    );
  };
  const hubX = 150, hubMidY = H / 2;
  // Agent-layer nodes per shape.
  const agents = shape === "crew"
    ? ["Specialist A", "Specialist B", "Specialist C"]
    : shape === "embedded"
      ? []
      : ["Tool agent", "Tool agent", "Tool agent"];

  return (
    <svg className="v3fs-arch-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Architecture topology — ${SHAPE_LABEL[shape] || shape}`}>
      {/* systems column */}
      {systems.map((s, i) => (
        <g key={`sys-${i}`}>
          <rect x={sysX} y={sysY(i) - sysH / 2} width={sysW} height={sysH} rx="7"
            fill="var(--v3-surface)" stroke="var(--fs-line)" />
          <text x={sysX + 12} y={sysY(i) + 4} className="v3fs-arch-sys">{s.system}</text>
          {s.method ? <text x={sysX + sysW - 10} y={sysY(i) + 4} textAnchor="end" className="v3fs-arch-meth">{s.method}</text> : null}
        </g>
      ))}
      {shape === "embedded" ? (
        <>
          {/* an embedded agent chip on each system, driven by a shared user */}
          {systems.map((s, i) => (
            <g key={`emb-${i}`}>
              <circle cx={sysX - 4} cy={sysY(i)} r="9" fill="var(--v3-accent-2)" />
              <text x={sysX - 4} y={sysY(i) + 3} textAnchor="middle" className="v3fs-arch-chip">A</text>
              {arrow(s.direction, hubX + 46, sysY(i), sysX - 16)}
            </g>
          ))}
          <rect x={hubX - 46} y={hubMidY - 20} width="92" height="40" rx="9" fill="var(--fs-indigo-wash)" stroke="var(--v3-accent-2)" />
          <text x={hubX} y={hubMidY + 4} textAnchor="middle" className="v3fs-arch-hub">Users</text>
        </>
      ) : shape === "crew" ? (
        <>
          {/* peers on a vertical event bus, each fanning to the systems */}
          <line x1={hubX} y1={30} x2={hubX} y2={H - 30} stroke="var(--v3-accent-2)" strokeWidth="2" strokeDasharray="4 4" />
          <text x={hubX} y={22} textAnchor="middle" className="v3fs-arch-cap">event bus</text>
          {agents.map((a, i) => {
            const ay = 50 + i * ((H - 100) / Math.max(1, agents.length - 1 || 1));
            return (
              <g key={`ag-${i}`}>
                <rect x={hubX - 62} y={ay - 15} width="70" height="30" rx="8" fill="var(--v3-surface-2)" stroke="var(--v3-accent-2)" />
                <text x={hubX - 27} y={ay + 4} textAnchor="middle" className="v3fs-arch-ag">{a}</text>
                <line x1={hubX - 62} y1={ay} x2={hubX} y2={ay} stroke="var(--v3-accent-2)" strokeWidth="1.5" />
              </g>
            );
          })}
          {systems.map((s, i) => arrow(s.direction, hubX + 4, sysY(i), sysX - 6))}
        </>
      ) : (
        <>
          {/* orchestrator hub → tool agents → systems */}
          <rect x={hubX - 50} y={hubMidY - 22} width="100" height="44" rx="10" fill="var(--v3-accent-2)" />
          <text x={hubX} y={hubMidY - 2} textAnchor="middle" className="v3fs-arch-hub on">Orchestrator</text>
          <text x={hubX} y={hubMidY + 13} textAnchor="middle" className="v3fs-arch-hubsub">agent</text>
          {agents.map((a, i) => {
            const ax = 285, ay = 45 + i * ((H - 90) / Math.max(1, agents.length - 1 || 1));
            return (
              <g key={`ta-${i}`}>
                <line x1={hubX + 50} y1={hubMidY} x2={ax} y2={ay} stroke="var(--fs-line)" strokeWidth="1.5" />
                <rect x={ax} y={ay - 14} width="96" height="28" rx="8" fill="var(--v3-surface-2)" stroke="var(--v3-accent-2)" />
                <text x={ax + 48} y={ay + 4} textAnchor="middle" className="v3fs-arch-ag">{a}</text>
                {arrow(systems[i]?.direction ?? "both", ax + 96, systems[i] ? sysY(i) : ay, sysX - 6)}
              </g>
            );
          })}
          {/* systems past the agent count still tether to the hub */}
          {systems.slice(agents.length).map((s, i) => arrow(s.direction, hubX + 50, sysY(agents.length + i), sysX - 6))}
        </>
      )}
    </svg>
  );
}

function ScoreRow({ label, value, wide }: { label: string; value: number; wide?: boolean }) {
  return (
    <div className={`v3fs-strat-score${wide ? " wide" : ""}`}>
      <span>{label}</span>
      <div className="v3fs-strat-bar"><div style={{ width: `${value * 10}%` }} /></div>
      <em>{value || "—"}</em>
    </div>
  );
}

export default function StrategyBoard({ doc, onChange }: StudioProps) {
  const locked = useStudioLocked();
  const candidates = useMemo(() => asArray(doc.candidates).map(asRecord), [doc.candidates]);
  const recommendation = asRecord(doc.recommendation);
  const recommended = asText(recommendation.candidate);
  // Which option's detail panel is expanded. Defaults to the recommended one.
  const [openIndex, setOpenIndex] = useState<number | null>(() => {
    const i = candidates.findIndex((c) => asText(c.name) && asText(c.name) === recommended);
    return i >= 0 ? i : (candidates.length ? 0 : null);
  });

  const recommend = (name: string) => {
    onChange({ ...doc, recommendation: { ...recommendation, candidate: name } });
  };

  if (!candidates.length) {
    return <EmptyState icon="🏛" title="No architecture candidates yet" hint="Add them below, or regenerate the Architecture Strategy to derive options from the Atlas and Ontology." />;
  }

  const active = openIndex != null ? candidates[openIndex] : null;

  return (
    <div className="v3fs-strat">
      {/* Options lead — the cards sit at the top, right under the header. */}
      <div className="v3fs-strat-hint">Click an option to see its architecture diagram and full detail.</div>
      <div className="v3fs-strat-board" style={{ gridTemplateColumns: `repeat(${candidates.length}, minmax(210px, 1fr))` }}>
        {candidates.map((candidate, index) => {
          const name = asText(candidate.name) || `Candidate ${index + 1}`;
          const isRec = recommended && name === recommended;
          const isOpen = openIndex === index;
          const scores = asRecord(candidate.scores);
          const shape = asText(candidate.shape);
          return (
            <button key={index} type="button"
              className={`v3fs-strat-col${isRec ? " rec" : ""}${isOpen ? " open" : ""}`}
              aria-expanded={isOpen} aria-controls={`strat-detail-${index}`}
              onClick={() => setOpenIndex(isOpen ? null : index)}>
              {isRec ? <div className="v3fs-strat-crown">★ Recommended</div> : null}
              <div className="v3fs-strat-name">{name}</div>
              {shape ? <div className="v3fs-strat-shape">{SHAPE_LABEL[shape] || shape}</div> : null}
              <div className="v3fs-strat-scores">
                {HEADLINE_DIMS.map((dim) => <ScoreRow key={dim.key} label={dim.label} value={score10(scores[dim.key])} />)}
              </div>
              <span className="v3fs-strat-toggle" aria-hidden="true">{isOpen ? "Hide detail ▲" : "View detail ▼"}</span>
            </button>
          );
        })}
      </div>
      {asText(doc.summary) ? <p className="v3fs-strat-summary">{asText(doc.summary)}</p> : null}

      {active ? (() => {
        const name = asText(active.name) || `Candidate ${openIndex! + 1}`;
        const scores = asRecord(active.scores);
        const shape = asText(active.shape);
        const integrationMap = asArray(active.integrationMap).map(asRecord);
        const buildVsBuy = asArray(active.buildVsBuy).map(asRecord);
        const failureModes = asArray(active.failureModes).map(asRecord);
        const isRec = recommended && name === recommended;
        return (
          <section id={`strat-detail-${openIndex}`} className="v3fs-strat-detail">
            <header className="v3fs-strat-dh">
              <div>
                <div className="v3fs-strat-deyebrow">{SHAPE_LABEL[shape] || shape || "Architecture option"}</div>
                <h4 className="v3fs-strat-dt">{name}</h4>
              </div>
              {!isRec && !locked ? (
                <button type="button" className="v3fs-btn pri" onClick={() => recommend(name)}>★ Recommend this option</button>
              ) : isRec ? <span className="v3fs-strat-dbadge">★ Recommended</span> : null}
            </header>

            {asText(active.description) ? <p className="v3fs-strat-desc">{asText(active.description)}</p> : null}

            {integrationMap.length || shape ? (
              <div className="v3fs-strat-diagram">
                <div className="v3fs-strat-diagram-h">Architecture diagram</div>
                <ArchDiagram shape={shape} integrationMap={integrationMap} />
                <div className="v3fs-arch-legend">
                  <span><i className="v3fs-arch-lg agent" /> Agents</span>
                  <span><i className="v3fs-arch-lg sys" /> Systems</span>
                  <span>→ write · ← read · ↔ both</span>
                </div>
              </div>
            ) : null}

            {asText(active.agenticPattern) ? (
              <div className="v3fs-strat-block">
                <div className="v3fs-strat-block-l">Agentic pattern</div>
                <p>{asText(active.agenticPattern)}</p>
              </div>
            ) : null}

            {(() => {
              // scoresBasis is a per-dimension map (dimKey → rationale); a bare
              // string is tolerated as a single overall note.
              const basis = asRecord(active.scoresBasis);
              const basisNote = typeof active.scoresBasis === "string" ? asText(active.scoresBasis) : "";
              const hasKeyed = SCORE_DIMS.some((d) => asText(basis[d.key]));
              return (
                <div className="v3fs-strat-block">
                  <div className="v3fs-strat-block-l">Scores{hasKeyed ? " — how they were judged" : ""}</div>
                  <div className="v3fs-strat-scoregrid">
                    {SCORE_DIMS.map((dim) => (
                      <div key={dim.key}>
                        <ScoreRow label={dim.label} value={score10(scores[dim.key])} wide />
                        {asText(basis[dim.key]) ? <p className="v3fs-strat-basis">{asText(basis[dim.key])}</p> : null}
                      </div>
                    ))}
                  </div>
                  {basisNote ? <p className="v3fs-strat-basis">{basisNote}</p> : null}
                </div>
              );
            })()}

            <div className="v3fs-strat-splits">
              {asStrings(active.strengths).length ? (
                <div className="v3fs-strat-block">
                  <div className="v3fs-strat-block-l ok">Strengths</div>
                  <ul className="v3fs-strat-list plus">{asStrings(active.strengths).map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
              ) : null}
              {asStrings(active.risks).length ? (
                <div className="v3fs-strat-block">
                  <div className="v3fs-strat-block-l warn">Risks</div>
                  <ul className="v3fs-strat-list minus">{asStrings(active.risks).map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
              ) : null}
            </div>

            {buildVsBuy.length ? (
              <div className="v3fs-strat-block">
                <div className="v3fs-strat-block-l">Build vs buy</div>
                <div className="v3fs-strat-bvb">
                  {buildVsBuy.map((b, i) => (
                    <div key={i} className="v3fs-strat-bvb-row">
                      <span className="v3fs-strat-bvb-cap">{asText(b.capability) || "Capability"}</span>
                      <span className={`v3fs-strat-bvb-v ${asText(b.verdict).toLowerCase()}`}>{asText(b.verdict) || "—"}</span>
                      <span className="v3fs-strat-bvb-r">{asText(b.rationale)}{asText(b.switchingCost) ? ` · switching cost: ${asText(b.switchingCost)}` : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {failureModes.length ? (
              <div className="v3fs-strat-block">
                <div className="v3fs-strat-block-l warn">Failure modes</div>
                <div className="v3fs-strat-fm">
                  {failureModes.map((f, i) => (
                    <div key={i} className="v3fs-strat-fm-row">
                      <div className="v3fs-strat-fm-head">
                        <span className="v3fs-strat-fm-mode">{asText(f.mode) || "Failure"}</span>
                        {asText(f.impact) ? <span className={`v3fs-strat-fm-tag i-${asText(f.impact).toLowerCase()}`}>impact: {asText(f.impact)}</span> : null}
                        {asText(f.likelihood) ? <span className="v3fs-strat-fm-tag">likelihood: {asText(f.likelihood)}</span> : null}
                      </div>
                      {asText(f.mitigation) ? <p className="v3fs-strat-fm-mit">{asText(f.mitigation)}</p> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        );
      })() : null}

      {asText(recommendation.rationale) ? (
        <p className="v3fs-strat-why">“{asText(recommendation.rationale)}”</p>
      ) : null}
    </div>
  );
}
