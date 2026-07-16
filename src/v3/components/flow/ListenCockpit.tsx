/**
 * The Listen cockpit — the phase HOME for Listen, above the Discovery/Ontology/
 * Atlas tabs, giving the phase the same scannable overview the Prototype Loop
 * has. Listen has three moves and this surface reads them at a glance, by AREA:
 *   COLLECT   — whose voices are on record (heard / personas in the area)
 *   MODEL     — the shape the evidence built (workflows · terms), linking into
 *               the Atlas and Ontology editors
 *   RECONCILE — the open contradictions the record still has to settle, as a
 *               first-class strip rather than a buried log row
 * Read-only projection from areaProgress + the deduped contradiction log; the
 * detailed work happens on the tabs below. Only shown once the programme spans
 * more than one area — a single-area programme's Discovery board is enough.
 */
import { useMemo, useState } from "react";
import { areaProgress } from "@/v3/components/flow/flowAreas";
import { readContradictions } from "@/v3/components/flow/flowShellData";
import { areaAccent, areaMonogram } from "@/v3/components/flow/CollectBoard";
import type { ProgramSummary } from "@/new/types";
import type { CSSProperties } from "react";

export default function ListenCockpit({ program, selected = [], onToggleArea }: {
  program: ProgramSummary;
  /** Areas currently used as a filter — the selected cards. Empty = show all. */
  selected?: string[];
  /** Toggle an area card into/out of the filter set. */
  onToggleArea?: (area: string) => void;
}) {
  const rows = useMemo(() => areaProgress(program), [program]);
  const disputes = useMemo(() => readContradictions(program, true), [program]);
  const [open, setOpen] = useState(true);

  // A single-area programme reads fine on the Discovery board alone — the
  // cockpit earns its space only when there are parallel areas to orchestrate.
  if (rows.length < 2) return null;

  const ready = rows.filter((r) => r.listenReady).length;
  const heardTotal = rows.reduce((n, r) => n + r.heard.length, 0);
  const personaTotal = rows.reduce((n, r) => n + r.personas.length, 0);
  // Order: areas with the most open work first (voices still to hear), the
  // areas already ready to envision last — the eye lands on what's unfinished.
  const ordered = [...rows].sort((a, b) => {
    const rd = (a.listenReady ? 1 : 0) - (b.listenReady ? 1 : 0);
    if (rd) return rd;
    return (b.personas.length - b.heard.length) - (a.personas.length - a.heard.length);
  });

  return (
    <section className={`v3fs-po v3fs-lc${open ? " open" : ""}`} aria-label="Listening — across all areas">
      <button type="button" className="v3fs-po-h" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="v3fs-po-chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="v3fs-po-t">Listening — {rows.length} areas</span>
        <span className="v3fs-po-sum">
          {ready}/{rows.length} ready to envision
          {disputes.length ? ` · ${disputes.length} to reconcile` : ""}
        </span>
      </button>
      {open ? (
        <div className="v3fs-po-body">
          {/* COLLECT + MODEL, by area — one lane per business domain. The header
              row toggles the area into the filter for everything below. */}
          {onToggleArea ? (
            <div className="v3fs-lc-filterhint" role="note">
              {selected.length
                ? <>Filtering to <b>{selected.join(" · ")}</b> — <button type="button" className="v3fs-lc-clearf" onClick={() => selected.forEach((a) => onToggleArea(a))}>clear</button></>
                : "Tap an area to filter everything below · tap again to clear"}
            </div>
          ) : null}
          <div className="v3fs-po-board">
            {ordered.map((r) => {
              const accent = areaAccent(r.area);
              const heardPct = r.personas.length ? Math.round((r.heard.length / r.personas.length) * 100) : 0;
              const modelled = r.workflows > 0 && r.entities > 0;
              const tone = r.listenReady ? "ok" : r.heard.length ? "part" : "open";
              const isSel = selected.includes(r.area);
              const dim = selected.length > 0 && !isSel;
              // The WHOLE card is the filter toggle (no nested controls remain),
              // so clicking anywhere on it filters the board below.
              const Tag = onToggleArea ? "button" : "div";
              const inner = (
                <>
                  <div className="v3fs-lc-lane-h">
                    <span className="v3fs-lc-ic" aria-hidden="true">{areaMonogram(r.area)}</span>
                    <b>{r.area}</b>
                    <span className="v3fs-lc-vn" title={`${r.heard.length} of ${r.personas.length} voices in ${r.area} heard`}>
                      {r.personas.length ? <>{r.heard.length}/{r.personas.length}</> : "—"}
                    </span>
                  </div>
                  {/* COLLECT — the voices bar. */}
                  <div className="v3fs-lc-bar" aria-hidden="true">
                    <span className="heard" style={{ width: `${heardPct}%` }} />
                  </div>
                  <div className="v3fs-lc-lane-f">
                    {r.listenReady ? "● ready to envision"
                      : r.personas.length > r.heard.length ? `${r.personas.length - r.heard.length} voice${r.personas.length - r.heard.length === 1 ? "" : "s"} still to hear`
                        : modelled ? "model forming" : "collecting"}
                  </div>
                </>
              );
              return (
                <Tag key={r.area} type={onToggleArea ? "button" : undefined}
                  className={`v3fs-lc-lane ${tone}${isSel ? " sel" : ""}${dim ? " dim" : ""}${onToggleArea ? " v3fs-lc-lane-btn" : ""}`}
                  style={{ "--lane-accent": accent } as CSSProperties}
                  aria-pressed={onToggleArea ? isSel : undefined}
                  onClick={onToggleArea ? () => onToggleArea(r.area) : undefined}
                  title={onToggleArea ? (isSel ? `Remove ${r.area} from the filter` : `Filter everything below to ${r.area}`) : undefined}>
                  {inner}
                </Tag>
              );
            })}
          </div>

          {/* RECONCILE — the open contradictions, first-class. The record can't
              be trusted while two accounts still disagree; this strip is where
              they surface, not a row buried in the Atlas. */}
          {disputes.length ? (
            <div className="v3fs-lc-rec">
              <span className="v3fs-lc-rec-l">⚖ To reconcile — {disputes.length} open</span>
              <ul>
                {disputes.slice(0, 6).map((d, i) => (
                  <li key={i}>
                    <span className="v3fs-lc-rec-stmt">{d.statement || "Two accounts disagree"}</span>
                    {d.between ? <em className="v3fs-lc-rec-btw">{d.between}</em> : null}
                    {d.routedTo ? <span className="v3fs-lc-rec-routed">→ {d.routedTo}</span> : null}
                  </li>
                ))}
                {disputes.length > 6 ? <li className="more">+{disputes.length - 6} more in Discovery</li> : null}
              </ul>
              <span className="v3fs-lc-rec-hint">Settle each on the person&apos;s card in Discovery, or route it to the Inbox.</span>
            </div>
          ) : (
            <div className="v3fs-lc-clear" role="note">
              ✓ No open contradictions — {heardTotal}/{personaTotal} voices heard and the accounts agree.
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
