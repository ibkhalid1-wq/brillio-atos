/**
 * The Product Owner cockpit — the orchestration layer ABOVE the per-area loops.
 * Where each area is a squad iterating on its own cadence (Design → Prototype →
 * Validate), the PO owns the whole product: a PROGRAM BOARD of every area's loop
 * state, the UNIFIED BACKLOG of change requests across areas, and a CROSS-AREA
 * COHERENCE strip flagging the ontology entities/workflows that span areas —
 * where four squads can drift into four different products. Read-only projection;
 * the PO steers by opening an area or triaging its backlog in the loop below.
 */
import { useMemo, useState, type CSSProperties } from "react";
import { loopState, changeRequests, type AreaLoop } from "@/v3/components/flow/flowLoop";
import { projectFutureState } from "@/v3/components/flow/flowFutureState";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { areaAccent, areaMonogram } from "@/v3/components/flow/CollectBoard";
import type { ProgramSummary } from "@/new/types";

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => String(v ?? "").trim()).filter(Boolean) : [];

/** A special board tile (not a business area) that scopes the design below to the
 * delivery team's cross-cutting work — architecture direction, strategy, the
 * agentic blueprint — rather than one business area's future state. */
export const DESIGN_TEAM = "Design team";

function areaTone(a: AreaLoop): string {
  return a.converged ? "ok" : a.objections ? "obj" : a.pending < a.total ? "part" : "open";
}

export default function ProductOwnerCockpit({ program, selected = [], onToggleArea }: {
  program: ProgramSummary;
  /** Areas currently used as a filter — the selected lanes. Empty = show all. */
  selected?: string[];
  /** Toggle an area lane into/out of the filter set for everything below. */
  onToggleArea?: (area: string) => void;
}) {
  const ls = useMemo(() => loopState(program), [program]);
  const reqs = useMemo(() => changeRequests(program), [program]);
  // The loop's changelog: the screens/areas the last Prototype Build touched —
  // surfaced on the phase HOME so the iteration's changes read at a glance, not
  // buried inside the Build studio.
  const refined = useMemo(() => asStrings(readArtifactDoc(program, "prototypeBuild")?.changed), [program]);
  // Loop-state first: the orchestration board leads the Prototype home, open by
  // default, so "where is each area in the loop" is the first thing you see.
  const [open, setOpen] = useState(true);

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
        <span className="v3fs-po-t">Orchestration — {areas.length} areas{ls.round > 1 ? ` · iteration ${ls.round}` : ""}</span>
        <span className="v3fs-po-sum">{converged}/{areas.length} signed off{reqs.length ? ` · ${reqs.length} in the backlog` : ""}</span>
      </button>
      {open ? (
        <div className="v3fs-po-body">
          {/* The loop's changelog on the home — what the last build refined. */}
          {refined.length ? (
            <div className="v3fs-po-refined" title="Screens/areas the last Prototype Build refined this iteration.">
              <span className="v3fs-po-refined-l">↻ Refined this iteration</span>
              <div className="v3fs-po-refined-chips">
                {refined.slice(0, 12).map((c, i) => <span key={i} className="v3fs-po-refined-chip">{c}</span>)}
                {refined.length > 12 ? <span className="v3fs-po-refined-chip more">+{refined.length - 12}</span> : null}
              </div>
            </div>
          ) : null}
          {onToggleArea ? (
            <div className="v3fs-lc-filterhint" role="note">
              {selected.length
                ? <>Filtering to <b>{selected.join(" · ")}</b> — <button type="button" className="v3fs-lc-clearf" onClick={() => selected.forEach((a) => onToggleArea(a))}>clear</button></>
                : "Tap an area to filter everything below · tap again to clear"}
            </div>
          ) : null}
          {/* Program board — every area's loop at a glance, and the filter for
              the Design/Validate detail below. */}
          <div className="v3fs-po-board">
            {/* The delivery team's own tile — filters the design below to the
                cross-cutting architecture / direction / blueprint work. */}
            {onToggleArea ? (() => {
              const isSel = selected.includes(DESIGN_TEAM);
              const dim = selected.length > 0 && !isSel;
              return (
                <button type="button" className={`v3fs-po-lane v3fs-po-lane-design${isSel ? " sel" : ""}${dim ? " dim" : ""}`}
                  aria-pressed={isSel} onClick={() => onToggleArea(DESIGN_TEAM)}
                  title={isSel ? "Remove the Design-team filter" : "Show the delivery team's architecture, direction & blueprint"}>
                  <div className="v3fs-po-lane-h">
                    <span className="v3fs-po-lane-ic" aria-hidden="true">✎</span>
                    <b>Design team</b>
                  </div>
                  <div className="v3fs-po-lane-f">architecture · direction · blueprint</div>
                </button>
              );
            })() : null}
            {areas.map((a) => {
              const isSel = selected.includes(a.area);
              const dim = selected.length > 0 && !isSel;
              return (
              <button key={a.area} type="button" className={`v3fs-po-lane ${areaTone(a)}${isSel ? " sel" : ""}${dim ? " dim" : ""}`}
                aria-pressed={isSel} onClick={() => onToggleArea?.(a.area)} style={{ "--lane-accent": areaAccent(a.area) } as CSSProperties}
                title={isSel ? `Remove ${a.area} from the filter` : `Filter everything below to ${a.area}`}>
                <div className="v3fs-po-lane-h">
                  <span className="v3fs-po-lane-ic" aria-hidden="true">{areaMonogram(a.area)}</span>
                  <b>{a.area}</b>
                  <span className="v3fs-po-lane-n">{a.converged ? "✓" : `${a.accepted}/${a.total}`}</span>
                </div>
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
              );
            })}
          </div>

          {/* Unified backlog — every open change request across areas, scoped to
              the filter when areas are selected. */}
          {(() => {
            const shownReqs = selected.length ? reqs.filter((r) => selected.includes(r.area)) : reqs;
            const areaCount = new Set(shownReqs.map((r) => r.area)).size;
            return shownReqs.length ? (
            <div className="v3fs-po-backlog">
              <span className="v3fs-po-bk-l">Backlog — {shownReqs.length} open across {areaCount} area{areaCount === 1 ? "" : "s"}</span>
              <ul>
                {shownReqs.slice(0, 10).map((r, i) => (
                  <li key={i} className={r.blocking ? "block" : ""}>
                    <em>{r.area}</em><b>{r.stakeholder}</b><span>{r.ask || (r.blocking ? "objection" : "a change")}</span>
                  </li>
                ))}
              </ul>
            </div>
            ) : null;
          })()}
        </div>
      ) : null}
    </section>
  );
}
