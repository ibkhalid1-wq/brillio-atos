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
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import type { ProgramSummary } from "@/new/types";

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => String(v ?? "").trim()).filter(Boolean) : [];

/** A label (not a business area) for the delivery team's cross-cutting work —
 * architecture direction, strategy, the agentic blueprint. Kept as a shared
 * constant the Envision cockpit reads to show the solution-level Direction act. */
export const DESIGN_TEAM = "Design team";

export default function ProductOwnerCockpit({ program }: {
  program: ProgramSummary;
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
  // With the area board removed, the cockpit only earns its space when it has
  // something to say — this iteration's changelog or an open backlog. A fresh
  // loop with neither renders nothing rather than a bare header.
  if (!refined.length && !reqs.length) return null;

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
          {/* Unified backlog — every open change request across areas. */}
          {(() => {
            const areaCount = new Set(reqs.map((r) => r.area)).size;
            return reqs.length ? (
            <div className="v3fs-po-backlog">
              <span className="v3fs-po-bk-l">Backlog — {reqs.length} open across {areaCount} area{areaCount === 1 ? "" : "s"}</span>
              <ul>
                {reqs.slice(0, 10).map((r, i) => (
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
