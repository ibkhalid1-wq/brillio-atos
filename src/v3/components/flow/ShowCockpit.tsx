/**
 * The Show cockpit — the validation theater as a scannable OVERVIEW, the mirror
 * of the Envision build studio. Show is where CLIENTS validate the prototype the
 * delivery team built: PROTOTYPE (the built app, openable inline) → TOURED (every
 * voice has seen their workflow run) → ACCEPTED (every verdict is in; the demo is
 * the gate). Projected from the record; the per-stakeholder demo links live on
 * the collect board below.
 */
import { useMemo } from "react";
import { demoAcceptance } from "@/v3/components/flow/flowShellData";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { movementValidationCoverage } from "@/v3/components/flow/flowPortal";
import { loopState } from "@/v3/components/flow/flowLoop";
import type { ProgramSummary } from "@/new/types";

export default function ShowCockpit({ program, onOpenDesign }: {
  program: ProgramSummary;
  /** Switch to Design mode and open the Prototype workspace. */
  onOpenDesign?: () => void;
}) {
  const tour = useMemo(() => demoAcceptance(program), [program]);
  const coverage = useMemo(() => movementValidationCoverage(program, "show").filter((r) => r.validated || r.waiting), [program]);
  const html = useMemo(() => {
    const pb = readArtifactDoc(program, "prototypeBuild");
    return pb ? String(pb.html ?? "") : "";
  }, [program]);
  const ls = useMemo(() => loopState(program), [program]);

  if (!tour.total && !html && !coverage.length) return null;

  return (
    <div className="v3fs-envc v3fs-showc">
      {/* Loop status — which court the ball is in this iteration. */}
      {ls.hasPrototype ? (
        <div className={`v3fs-showc-loop ${ls.court}`} role="status">
          <span className="v3fs-showc-loop-r">Iteration {ls.round}</span>
          <span className="v3fs-showc-loop-t">
            {ls.court === "converged"
              ? "✓ Approved — sponsor + majority accepted. Ready to ship."
              : ls.court === "design"
                ? `${ls.openRequests} change${ls.openRequests === 1 ? "" : "s"} sent back to Design — rebuild, then re-share the prototype.`
                : `Awaiting verdicts — ${ls.accepted}/${ls.total} approved so far.`}
          </span>
        </div>
      ) : null}

      {/* The prototype now lives on its OWN "Prototype" tab (above) — the inline
          collapsible was removed. Here we only note whether it's built. */}
      {!html ? (
        <section className="v3fs-envc-act">
          <div className="v3fs-showc-noproto">
            The prototype is built in Envision — Show demonstrates it.
            {onOpenDesign ? <button type="button" className="v3fs-a" onClick={onOpenDesign}> build it in Design →</button> : null}
          </div>
        </section>
      ) : null}

      {/* The per-area "Validation — each area signs off" section was removed —
          the demo verdicts surface on the Show artifact tab, and the loop status
          band above already reports acceptance. */}
    </div>
  );
}
