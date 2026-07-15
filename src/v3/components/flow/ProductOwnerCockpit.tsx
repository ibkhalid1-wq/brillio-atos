/**
 * The Product Owner cockpit — the orchestration layer ABOVE the per-area loops.
 * Where each area is a squad iterating on its own cadence (Design → Prototype →
 * Validate), the PO owns the whole product: a PROGRAM BOARD of every area's loop
 * state, the UNIFIED BACKLOG of change requests across areas, and a CROSS-AREA
 * COHERENCE strip flagging the ontology entities/workflows that span areas —
 * where four squads can drift into four different products. Read-only projection;
 * the PO steers by opening an area or triaging its backlog in the loop below.
 */
import { useMemo, useState } from "react";
import { loopState, changeRequests, type AreaLoop } from "@/v3/components/flow/flowLoop";
import { projectFutureState } from "@/v3/components/flow/flowFutureState";
import type { ProgramSummary } from "@/new/types";

/** Ontology entities that appear in more than one area's screens — the seams
 * where cross-area coherence has to be actively held. */
function sharedEntities(program: ProgramSummary): Array<{ entity: string; areas: string[] }> {
  const fs = projectFutureState(program);
  const byEntity = new Map<string, Set<string>>();
  for (const s of fs.screens) {
    for (const e of s.entities) {
      const key = e.trim();
      if (!key) continue;
      const set = byEntity.get(key) ?? new Set<string>();
      if (s.area) set.add(s.area);
      byEntity.set(key, set);
    }
  }
  return [...byEntity.entries()]
    .filter(([, areas]) => areas.size > 1)
    .map(([entity, areas]) => ({ entity, areas: [...areas].sort() }))
    .sort((a, b) => b.areas.length - a.areas.length)
    .slice(0, 8);
}

function areaTone(a: AreaLoop): string {
  return a.converged ? "ok" : a.objections ? "obj" : a.pending < a.total ? "part" : "open";
}

export default function ProductOwnerCockpit({ program, onOpenArea }: {
  program: ProgramSummary;
  /** Focus an area — switch the loop to Validate and (later) scope to the area. */
  onOpenArea?: (area: string) => void;
}) {
  const ls = useMemo(() => loopState(program), [program]);
  const reqs = useMemo(() => changeRequests(program), [program]);
  const shared = useMemo(() => sharedEntities(program), [program]);
  const [open, setOpen] = useState(false);

  // The board's areas are the areas that EXIST (from the design), each overlaid
  // with its verdict state — so it's populated before any validation begins.
  const areas = useMemo<AreaLoop[]>(() => {
    const byArea = new Map(ls.areas.map((a) => [a.area, a]));
    return projectFutureState(program).areas.map((area) =>
      byArea.get(area) ?? { area, total: 0, accepted: 0, changes: 0, objections: 0, pending: 0, converged: false });
  }, [program, ls.areas]);
  const converged = areas.filter((a) => a.converged).length;

  // Only meaningful once there are multiple parallel areas to orchestrate.
  if (areas.length < 2) return null;

  return (
    <section className={`v3fs-po${open ? " open" : ""}`} aria-label="Product Owner — across all areas">
      <button type="button" className="v3fs-po-h" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="v3fs-po-chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="v3fs-po-t">Product Owner — orchestrating {areas.length} areas</span>
        <span className="v3fs-po-sum">{converged}/{areas.length} signed off{reqs.length ? ` · ${reqs.length} in the backlog` : ""}</span>
      </button>
      {open ? (
        <div className="v3fs-po-body">
          {/* Program board — every area's loop at a glance. */}
          <div className="v3fs-po-board">
            {areas.map((a) => (
              <button key={a.area} type="button" className={`v3fs-po-lane ${areaTone(a)}`} onClick={() => onOpenArea?.(a.area)}>
                <div className="v3fs-po-lane-h"><b>{a.area}</b><span>{a.converged ? "✓ signed off" : `${a.accepted}/${a.total}`}</span></div>
                <div className="v3fs-po-bar" aria-hidden="true">
                  {a.accepted ? <span className="ok" style={{ flex: a.accepted }} /> : null}
                  {a.changes ? <span className="part" style={{ flex: a.changes }} /> : null}
                  {a.objections ? <span className="obj" style={{ flex: a.objections }} /> : null}
                  {a.pending ? <span className="pend" style={{ flex: a.pending }} /> : null}
                </div>
                <div className="v3fs-po-lane-f">
                  {a.converged ? "ready to ship"
                    : a.objections ? `${a.objections} objection${a.objections === 1 ? "" : "s"}`
                      : a.changes ? `${a.changes} change${a.changes === 1 ? "" : "s"} to fold`
                        : a.pending ? `${a.pending} awaiting verdict` : "no verdicts yet"}
                </div>
              </button>
            ))}
          </div>

          {/* Cross-area coherence — the seams the PO must hold. */}
          {shared.length ? (
            <div className="v3fs-po-coh">
              <span className="v3fs-po-coh-l">⚠ Shared across areas — hold these coherent</span>
              <div className="v3fs-po-coh-list">
                {shared.map((s) => (
                  <span key={s.entity} className="v3fs-po-coh-chip" title={`${s.entity} appears in: ${s.areas.join(", ")}`}>
                    <b>{s.entity}</b> {s.areas.join(" · ")}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Unified backlog — every open change request across areas. */}
          {reqs.length ? (
            <div className="v3fs-po-backlog">
              <span className="v3fs-po-bk-l">Backlog — {reqs.length} open across {new Set(reqs.map((r) => r.area)).size} area{new Set(reqs.map((r) => r.area)).size === 1 ? "" : "s"}</span>
              <ul>
                {reqs.slice(0, 10).map((r, i) => (
                  <li key={i} className={r.blocking ? "block" : ""}>
                    <em>{r.area}</em><b>{r.stakeholder}</b><span>{r.ask || (r.blocking ? "objection" : "a change")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
