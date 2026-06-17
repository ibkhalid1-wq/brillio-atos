/**
 * Declared input → artifact dependency model for the phase flow wiring.
 *
 * Each input field always feeds the phase Narrative (the primary synthesis);
 * specialised fields additionally feed the phase-specific artifacts they most
 * directly inform (e.g. on Mobilise, the governance model field → Governance
 * Model, key roles → RACI Matrix + Stakeholder Map).
 *
 * Targets are constrained to the phase's own artifact set
 * (`getPhaseArtifactIds`), so every edge resolves to a real DOM anchor in the
 * artifacts column and no connector dangles. Any declared target not present in
 * the phase is silently dropped.
 */
import { getPhaseArtifactIds } from "@/v3/lib/phaseArtifacts";
import { ATOS_STANDARD } from "@/v3/lib/methodology";
import { dynamicFieldArtifacts, type DynamicSchemaStore } from "@/v3/lib/dynamicSchema";

export interface FlowEdge {
  from: string;
  to: string;
}

/**
 * Methodology-declared input → artifact relationships, inverted from the phase's
 * `artifactInputFlow` (which is keyed artifact → input fields). Keeping the flow
 * wiring sourced from the methodology means a relationship declared once there
 * (e.g. industry / start / end feeding the Charter and Roadmap) shows up in the
 * visual flow automatically, with no parallel hand-maintained edge list.
 */
function methodologyFieldArtifacts(phaseId: string): Record<string, string[]> {
  const flow = ATOS_STANDARD.phases.find((phase) => phase.id === phaseId)?.artifactInputFlow ?? {};
  const inverted: Record<string, string[]> = {};
  for (const [artifactId, fieldIds] of Object.entries(flow)) {
    for (const fieldId of fieldIds) {
      (inverted[fieldId] ??= []).push(artifactId);
    }
  }
  return inverted;
}

/** Extra artifact targets per field, beyond the always-present Narrative. */
const PHASE_FIELD_ARTIFACTS: Record<string, Record<string, string[]>> = {
  strategy: {
    businessObjective: ["charter", "business-case"],
    sponsor: ["charter"],
    constraints: ["business-case"],
    successMetric: ["outcome-framework"],
    keyRoles: ["charter"],
  },
  mobilise: {
    programDirector: ["governance-model", "raci-matrix"],
    teamSize: ["raci-matrix"],
    governanceModel: ["governance-model"],
    keyRoles: ["raci-matrix", "stakeholder"],
  },
  discover: {
    currentState: ["requirements-catalog"],
    scopeInclusions: ["requirements-catalog"],
    scopeExclusions: ["requirements-catalog"],
  },
  design: {
    solutionApproach: ["future-state-design", "solution-architecture"],
    integrationPoints: ["solution-architecture"],
    designConstraints: ["solution-architecture", "risk"],
    keyRoles: ["target-operating-model"],
  },
  build: {
    sprintVelocity: ["milestone", "plan"],
    blockers: ["milestone"],
    testCoverage: ["test-plan"],
  },
  operate: {
    goLivePlanOwner: ["runbook"],
    supportModel: ["support-model"],
    trackedKpi: ["adoption"],
    runbookReference: ["runbook"],
    adoptionApproach: ["adoption"],
  },
  govern: {
    complianceOwner: ["risk"],
    controlMatrix: ["risk"],
    auditEvidencePlan: ["risk"],
    escalationPath: ["risk"],
  },
  optimize: {
    benefitBaseline: ["optimization-backlog"],
    improvementBacklog: ["optimization-backlog"],
    experimentProposal: ["optimization-backlog"],
  },
  valuerealize: {
    realisedBenefits: ["closure"],
    lessonsLearnedReference: ["closure"],
    bauOwner: ["closure"],
    closurePackReference: ["closure"],
  },
};

/**
 * Derive the input → artifact edges for a phase. Each field yields one edge to
 * Narrative plus one edge per declared specialised target that exists in the
 * phase, de-duplicated and in a stable order (Narrative first, then declared
 * targets).
 */
export function derivePhaseFlowEdges(phaseId: string, fieldIds: string[], store?: DynamicSchemaStore): FlowEdge[] {
  const map = PHASE_FIELD_ARTIFACTS[phaseId] ?? {};
  const methodologyMap = methodologyFieldArtifacts(phaseId);
  const dynamicMap = dynamicFieldArtifacts(phaseId, store);
  const valid = new Set(getPhaseArtifactIds(phaseId, store));
  const edges: FlowEdge[] = [];
  for (const fieldId of fieldIds) {
    const seen = new Set<string>();
    const targets = ["narrative", ...(map[fieldId] ?? []), ...(methodologyMap[fieldId] ?? []), ...(dynamicMap[fieldId] ?? [])];
    for (const to of targets) {
      if (seen.has(to) || !valid.has(to)) continue;
      seen.add(to);
      edges.push({ from: fieldId, to });
    }
  }
  return edges;
}
