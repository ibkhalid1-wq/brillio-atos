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
import { dynamicArtifactDefs, type DynamicSchemaStore } from "@/v3/lib/dynamicSchema";

export interface PhaseArtifactDef {
  /** Stable id — the producing-agent id, or "narrative"/"deck" for the core pair. */
  id: string;
  label: string;
  /** One-line plain-English summary of what this artifact captures. */
  description: string;
}

function artifactLabel(id: string): string {
  if (id === "narrative") return "Narrative";
  const meta = getAgentMeta(id);
  return meta.outputArtifact || meta.label || id;
}

function artifactDescription(id: string): string {
  if (id === "narrative") return "Synthesises this phase into a plain-English narrative summary.";
  return getAgentMeta(id).description || "";
}

/**
 * Ordered artifact definitions for a phase: Narrative first, then the
 * methodology's required artifacts, then any ai-derived dynamic artifacts from
 * the programme's `store` (appended, deduped). Omitting `store` yields the
 * static catalogue unchanged.
 */
export function getPhaseArtifactDefs(phaseId: string, store?: DynamicSchemaStore): PhaseArtifactDef[] {
  const phase = ATOS_STANDARD.phases.find((p) => p.id === phaseId);
  const ordered: string[] = ["narrative"];
  for (const id of phase?.requiredArtifacts ?? []) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  const defs = ordered.map((id) => ({ id, label: artifactLabel(id), description: artifactDescription(id) }));
  for (const dyn of dynamicArtifactDefs(phaseId, store)) {
    if (!defs.some((d) => d.id === dyn.id)) defs.push(dyn);
  }
  return defs;
}

/** The set of artifact ids a phase renders — used to constrain flow-edge targets. */
export function getPhaseArtifactIds(phaseId: string, store?: DynamicSchemaStore): string[] {
  return getPhaseArtifactDefs(phaseId, store).map((a) => a.id);
}
