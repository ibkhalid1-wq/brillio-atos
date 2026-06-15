/**
 * Phase-specific artifact catalogue for the phase screen's artifacts column.
 *
 * The artifacts a phase produces are declared by the methodology
 * (`ATOS_STANDARD.phases[].requiredArtifacts`, as producing-agent ids) — so
 * Mobilise yields Governance Model and RACI Matrix, Design yields Solution
 * Architecture, etc., rather than a generic narrative/documents/risks set.
 *
 * The Narrative leads (it is a required artifact in every phase and carries a
 * live inline preview); the phase's specialised required artifacts follow.
 * Labels resolve through the agent catalogue (`getAgentMeta(id).outputArtifact`).
 *
 * This is the single source of truth for both the rendered artifact chips and
 * the flow-overlay edge targets, so every connector resolves to a real anchor.
 */
import { ATOS_STANDARD } from "@/v3/lib/methodology";
import { getAgentMeta } from "@/v3/lib/agentMeta";

export interface PhaseArtifactDef {
  /** Stable id — the producing-agent id, or "narrative"/"deck" for the core pair. */
  id: string;
  label: string;
}

function artifactLabel(id: string): string {
  if (id === "narrative") return "Narrative";
  const meta = getAgentMeta(id);
  return meta.outputArtifact || meta.label || id;
}

/** Ordered artifact definitions for a phase: Narrative first, then required artifacts. */
export function getPhaseArtifactDefs(phaseId: string): PhaseArtifactDef[] {
  const phase = ATOS_STANDARD.phases.find((p) => p.id === phaseId);
  const ordered: string[] = ["narrative"];
  for (const id of phase?.requiredArtifacts ?? []) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered.map((id) => ({ id, label: artifactLabel(id) }));
}

/** The set of artifact ids a phase renders — used to constrain flow-edge targets. */
export function getPhaseArtifactIds(phaseId: string): string[] {
  return getPhaseArtifactDefs(phaseId).map((a) => a.id);
}
