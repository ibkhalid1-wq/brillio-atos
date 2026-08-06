/**
 * The Line — the production-line home view, mounted BESIDE the classic Flow
 * chrome as a flag-gated sibling (appbar toggle · `?ui=line` · localStorage).
 *
 * Read-only by construction: it renders buildLineModel's projection of the
 * same live record the classic UI edits, and its only interactions are
 * (a) opening a gate's criteria checklist and (b) opening an artifact in the
 * existing FlowArtifactStudio — with no save/regenerate handlers passed, so
 * the studio presents its read-only face. Both chromes can therefore run at
 * the same time, on the same programme, and can never disagree or conflict:
 * there is one write path, and it lives in the classic views.
 */
import { Suspense, lazy, useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { buildLineModel, LINE_GLYPHS, type LineBand, type LineStation } from "@/v3/lib/lineModel";
import type { ArtifactCardModel } from "@/v3/components/flow/flowShellData";
import "./theLine.css";

const FlowArtifactStudio = lazy(() => import("./studio/FlowArtifactStudio"));

function Segments({ station }: { station: LineStation }) {
  if (!station.perArea) return null;
  return (
    <div className="v3ln-seg" aria-label={`${station.title} — maturity per area`}>
      {station.perArea.map((seg) => (
        <span key={seg.area} className={`v3ln-sg m${seg.maturity}`}
          title={`${seg.area} · ${LINE_GLYPHS[seg.maturity]}`}>
          {seg.maturity > 0 ? seg.initials : ""}
        </span>
      ))}
    </div>
  );
}

function Station({ station, onOpen }: { station: LineStation; onOpen: (card: ArtifactCardModel) => void }) {
  const openable = !!station.card?.present;
  return (
    <button type="button" className="v3ln-stn" disabled={!openable}
      title={openable ? `Open ${station.title}` : `${station.title} — not seeded yet`}
      onClick={() => { if (station.card) onOpen(station.card); }}>
      <span className="v3ln-stn-h">
        {!station.perArea ? (
          <span className={`v3ln-g m${station.maturity}`} aria-hidden="true">{LINE_GLYPHS[station.maturity]}</span>
        ) : null}
        <span className="v3ln-stn-n">{station.title}</span>
        {station.needsRefresh ? <span className="v3ln-rf">needs refresh ↻</span> : null}
      </span>
      {station.subtitle ? <span className="v3ln-stn-sub">{station.subtitle}</span> : null}
      <Segments station={station} />
    </button>
  );
}

function GateSheet({ band, onClose }: { band: LineBand; onClose: () => void }) {
  return (
    <>
      <div className="v3ln-gate-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="v3ln-gate" role="dialog" aria-modal="true" aria-label={`${band.name} gate criteria`}>
        <div className="v3ln-gate-h">
          <h3>{band.name} — the gate, item by item</h3>
          <button type="button" className="v3ln-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {band.gate.length === 0 ? (
          <p className="v3ln-gate-empty">No criteria yet — this gate seeds with the movement.</p>
        ) : (
          <ul className="v3ln-crit">
            {band.gate.map((item, index) => (
              <li key={index} className={item.advisory ? "adv" : undefined}>
                <span className={`v3ln-tick ${item.done ? "d" : "o"}`} aria-hidden="true">{item.done ? "✓" : "…"}</span>
                <span className="v3ln-crit-b">
                  {item.label}
                  {item.why ? <em>{item.why}</em> : null}
                  {item.advisory ? <em>advisory — informs, never gates</em> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="v3ln-gate-f">Frame, Listen and the Loop close themselves when every criterion is met. Ship and Evolve stay deliberate decisions.</p>
      </div>
    </>
  );
}

export default function TheLine({ program }: { program: ProgramSummary }) {
  const model = useMemo(() => buildLineModel(program), [program]);
  const [gateFor, setGateFor] = useState<LineBand | null>(null);
  const [docFor, setDocFor] = useState<ArtifactCardModel | null>(null);

  return (
    <div className="v3ln">
      <div className="v3ln-stats">
        <div><span className="v3ln-sl">Round</span><span className="v3ln-sv">{model.round}</span></div>
        <div><span className="v3ln-sl">Converged — signed off</span><span className="v3ln-sv">{model.stats.converged} of {model.stats.areasTotal} areas</span></div>
        <div><span className="v3ln-sl">Voices heard</span><span className="v3ln-sv">{model.stats.heardTotal > 0 ? `${model.stats.heardDone} of ${model.stats.heardTotal}` : "—"}</span></div>
        <div><span className="v3ln-sl">Needs refresh</span><span className={`v3ln-sv${model.stats.refresh > 0 ? " acc" : ""}`}>{model.stats.refresh > 0 ? `${model.stats.refresh} station${model.stats.refresh === 1 ? "" : "s"}` : "—"}</span></div>
        <div className="v3ln-sp" />
        <span className="v3ln-ro" title="This view is a read-only projection of the same record the classic chrome edits — switch back any time; nothing diverges.">read-only projection · classic chrome edits</span>
      </div>

      {model.bands.map((band) => (
        <section key={band.id} className={`v3ln-band${band.id === "loop" ? " loop" : ""}`} aria-label={band.name}>
          <header className="v3ln-band-h">
            <span className="v3ln-band-n">{band.name}</span>
            {band.half ? <span className="v3ln-half">{band.half}</span> : null}
            <span className="v3ln-scope">{band.scope}</span>
            <span className="v3ln-band-sp" />
            <button type="button" className={`v3ln-chip ${band.chip.tone}`}
              onClick={() => setGateFor(band)}
              title={`Open the ${band.name} gate's criteria`}>
              {band.chip.text} ›
            </button>
          </header>
          {band.intake ? <div className="v3ln-intake"><span>evidence in</span>{band.intake}</div> : null}
          <div className={`v3ln-stns n${band.stations.length}`}>
            {band.stations.map((s) => <Station key={s.id} station={s} onOpen={setDocFor} />)}
          </div>
          {band.note ? <div className="v3ln-note">{band.note}</div> : null}
        </section>
      ))}

      <div className="v3ln-legend">
        <span className="v3ln-sl">Segments read</span>
        <span>{model.areas.map((a) => a).join(" · ") || "areas arrive when the Discovery Kit names them"}</span>
        <span className="v3ln-glyphs">○ not seeded · ◔ provisional · ◑ grounded · ◕ reviewed · ● approved</span>
      </div>

      {gateFor ? <GateSheet band={gateFor} onClose={() => setGateFor(null)} /> : null}
      {docFor ? (
        <Suspense fallback={null}>
          <FlowArtifactStudio program={program} artifact={docFor} onClose={() => setDocFor(null)} />
        </Suspense>
      ) : null}
    </div>
  );
}
