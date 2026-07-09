import React from "react";
import { getPhaseDefinition } from "@/v3/lib/methodology";

/**
 * ATOS Flow movement guide — the strip under a movement's header that renders
 * the human/machine split the methodology declares: the few conversations the
 * humans have (You), everything ATOS generates between them, and the
 * demonstration that ends the movement (Ready when — or the loop's health
 * signal for Evolve). Stage-gate phases carry no movement metadata, so this
 * renders nothing for them; the strip is what makes a Flow programme read as
 * a pipeline rather than a phase plan.
 */
export default function FlowMovementStrip({ phaseId }: { phaseId: string }) {
  const movement = getPhaseDefinition(phaseId)?.movement;
  if (!movement) return null;

  return (
    <div className="v3-flow-movement-strip" role="note" aria-label="Movement guide">
      <div className="v3-flow-movement-col">
        <div className="v3-flow-movement-label">You</div>
        <ul>
          {movement.humanMoments.map((moment) => (
            <li key={moment}>{moment}</li>
          ))}
        </ul>
      </div>
      <div className="v3-flow-movement-col is-machine">
        <div className="v3-flow-movement-label">ATOS generates</div>
        <ul>
          {movement.automations.map((automation) => (
            <li key={automation}>{automation}</li>
          ))}
        </ul>
      </div>
      <div className="v3-flow-movement-col">
        <div className="v3-flow-movement-label">{movement.isLoop ? "The loop" : "Ready when"}</div>
        <p className="v3-flow-movement-ready">{movement.readyWhen}</p>
      </div>
    </div>
  );
}
