import React from "react";
import { getAgentMeta } from "@/v3/lib/agentMeta";
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";

/** Human label for an artifact id, for drill-down chips. */
export function artifactLabelFor(id: string): string {
  const meta = getAgentMeta(id);
  return meta.outputArtifact || meta.label || id;
}

/** Human label for an input field id within a phase, for drill-down chips. */
export function inputLabelFor(phaseId: string, id: string): string {
  const field = getPhaseInputSchema(phaseId).fields.find((candidate) => candidate.id === id);
  return field?.label || id;
}

/**
 * Renders "Linked to" chips that drill an action / blocker / risk down to the
 * exact artifact or input it was derived from. Clicking a chip navigates to the
 * owning phase and scrolls to that element's `data-io-anchor`. Renders nothing
 * when the item carries no provenance, so older items degrade gracefully.
 *
 * Shared by the Action Center (DecideView) and the programme right rail
 * (PhaseRailPanels) so both surfaces drill down identically.
 */
export function DrillDownLinks({
  phaseId,
  relatedArtifactId,
  relatedInputIds,
  onDrill,
}: {
  phaseId: string;
  relatedArtifactId?: string | null;
  relatedInputIds?: string[];
  onDrill: (anchor: string) => void;
}) {
  const links: { anchor: string; label: string; kind: "artifact" | "input" }[] = [];
  if (relatedArtifactId) {
    links.push({ anchor: `artifact:${relatedArtifactId}`, label: artifactLabelFor(relatedArtifactId), kind: "artifact" });
  }
  for (const id of relatedInputIds ?? []) {
    links.push({ anchor: `input:${id}`, label: inputLabelFor(phaseId, id), kind: "input" });
  }
  if (!links.length) return null;
  return (
    <div className="v3-drilldown-row">
      <span className="v3-drilldown-label">Linked to</span>
      {links.map((link) => (
        <button
          key={link.anchor}
          type="button"
          className="v3-drilldown-chip"
          data-kind={link.kind}
          onClick={(event) => { event.stopPropagation(); onDrill(link.anchor); }}
          title={`Open source ${link.kind}: ${link.label}`}
        >
          <span aria-hidden="true">{link.kind === "artifact" ? "◆ " : "▸ "}</span>
          {link.label}
        </button>
      ))}
    </div>
  );
}

export default DrillDownLinks;
