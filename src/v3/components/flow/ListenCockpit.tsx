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
import type { ProgramSummary } from "@/new/types";

export default function ListenCockpit({ program }: {
  program: ProgramSummary;
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
