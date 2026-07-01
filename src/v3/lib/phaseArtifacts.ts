/**
 * Phase-specific artifact catalogue for the phase screen's artifacts column.
 *
 * The artifacts a phase produces are declared by the methodology
 * (`ATOS_STANDARD.phases[].requiredArtifacts`, as producing-agent ids) — so
 * Mobilise yields Governance Model and RACI Matrix, Design yields Solution
 * Architecture, etc. Nothing is hard-coded here: the catalogue is exactly the
 * methodology's required set plus any ai-derived dynamic artifacts. Labels
 * resolve through the agent catalogue (`getAgentMeta(id).outputArtifact`).
 *
 * This is the single source of truth for both the rendered artifact chips and
 * the flow-overlay edge targets, so every connector resolves to a real anchor.
 */
import { ATOS_STANDARD } from "@/v3/lib/methodology";
import { getAgentMeta, AGENT_META, RETIRED_AGENT_IDS, SUPPORT_ARTIFACT_IDS } from "@/v3/lib/agentMeta";
import { canonicalArtifactId, dynamicArtifactDefs, type DynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import { FORMAL_ARTIFACT_PHASES } from "@/v3/lib/formalArtifacts";

export interface PhaseArtifactDef {
  /** Stable id — the producing-agent id. */
  id: string;
  label: string;
  /** One-line plain-English summary of what this artifact captures. */
  description: string;
}

function artifactLabel(id: string): string {
  const meta = getAgentMeta(id);
  return meta.outputArtifact || meta.label || id;
}

function artifactDescription(id: string): string {
  return getAgentMeta(id).description || "";
}

/**
 * The methodology-declared deliverables a phase's inputs are wired to feed — the
 * artifact ids named as targets in `artifactInputFlow`. These are the phase's
 * fall-through agent deliverables (Operate → support-model, runbook, adoption;
 * Optimize → optimization-backlog). A dynamic-only phase declares `requiredArtifacts:
 * []` and relies on the planner's dynamicSchema to surface these as chips — but when
 * the planner omits one, the deliverable never renders, so the inputs declared to
 * feed it (e.g. the hyper-care / support-model fields) have no anchor and their flow
 * lines silently vanish, and the user has no chip to generate the deliverable from.
 *
 * Surfacing them here — sourced from the methodology registry — makes those
 * deliverables render as OPTIONAL chips regardless of the planner, so every declared
 * input→artifact flow resolves and the deliverable is generatable. They are appended
 * (not required): gate readiness and methodology completeness read
 * `requiredArtifacts` + dynamic defs directly, never this catalogue, so nothing is
 * retroactively gated. Excluded: support-only stubs (SUPPORT_ARTIFACT_IDS, seeded
 * separately and never a gateable deliverable), retired generators, the program-level
 * narrative, and formal artifacts homed to another phase.
 */
// Phases whose deliverables the planner names *divergently* (Design emits
// "solution-design" where the methodology declares canonical "solution-architecture";
// Build emits "milestone-register"/"uat-plan"). Their flow edges resolve by intent
// keyword against whatever artifacts actually render (PHASE_FIELD_INTENT in
// phaseFlowEdges.ts), and the produced artifact surfaces as an orphan chip. Pre-
// rendering the canonical id here would sit a second, near-duplicate chip beside the
// planner's variant — so these phases keep their produce-then-show orphan pattern and
// are excluded from the fall-through deliverable surfacing below. (Declared locally
// rather than imported to avoid a cycle: phaseFlowEdges.ts imports this module.)
const INTENT_FLOW_PHASES = new Set<string>(["design", "build"]);

function flowTargetDeliverables(phaseId: string, existingIds: Set<string>): PhaseArtifactDef[] {
  if (INTENT_FLOW_PHASES.has(phaseId)) return [];
  const flow = ATOS_STANDARD.phases.find((p) => p.id === phaseId)?.artifactInputFlow ?? {};
  const out: PhaseArtifactDef[] = [];
  const seen = new Set(existingIds);
  for (const rawId of Object.keys(flow)) {
    const id = canonicalArtifactId(phaseId, rawId);
    if (seen.has(id)) continue;
    if (!AGENT_META[id]) continue; // only real, renderable producing agents
    if (id === "narrative") continue; // program-level briefing, never a phase chip
    if (RETIRED_AGENT_IDS.has(id)) continue; // dead generator — Generate would no-op
    if (SUPPORT_ARTIFACT_IDS.has(id)) continue; // backs cards/metrics, not a deliverable
    const homePhase = FORMAL_ARTIFACT_PHASES[id];
    if (homePhase && homePhase !== phaseId) continue; // pinned to its methodology home
    seen.add(id);
    out.push({ id, label: artifactLabel(id), description: artifactDescription(id) });
  }
  return out;
}

/**
 * Ordered artifact definitions for a phase: the methodology's required
 * artifacts, then any ai-derived dynamic artifacts from the programme's `store`,
 * then the methodology's declared fall-through deliverables (its `artifactInputFlow`
 * targets) not already covered — all appended and deduped. Omitting `store` still
 * yields the fall-through deliverables (they are methodology-declared, not planner-
 * derived), so a phase's declared input→artifact flows resolve without a store.
 */
export function getPhaseArtifactDefs(phaseId: string, store?: DynamicSchemaStore): PhaseArtifactDef[] {
  const phase = ATOS_STANDARD.phases.find((p) => p.id === phaseId);
  const ordered: string[] = [];
  for (const id of phase?.requiredArtifacts ?? []) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  const defs = ordered.map((id) => ({ id, label: artifactLabel(id), description: artifactDescription(id) }));
  for (const dyn of dynamicArtifactDefs(phaseId, store)) {
    if (!defs.some((d) => d.id === dyn.id)) defs.push(dyn);
  }
  for (const deliverable of flowTargetDeliverables(phaseId, new Set(defs.map((d) => d.id)))) {
    defs.push(deliverable);
  }
  return defs;
}

/** The set of artifact ids a phase renders — used to constrain flow-edge targets. */
export function getPhaseArtifactIds(phaseId: string, store?: DynamicSchemaStore): string[] {
  return getPhaseArtifactDefs(phaseId, store).map((a) => a.id);
}
