/**
 * Declared input → artifact dependency model for the phase flow wiring.
 *
 * Only Strategy carries a static field→artifact map; every later phase is
 * dynamic, so its input→artifact edges come entirely from the programme's
 * dynamicSchema (via `dynamicFieldArtifacts`) plus the methodology's declared
 * `artifactInputFlow`.
 *
 * Targets are constrained to the phase's own artifact set
 * (`getPhaseArtifactIds`), so every edge resolves to a real DOM anchor in the
 * artifacts column and no connector dangles. Any declared target not present in
 * the phase (e.g. Narrative on a dynamic-only phase) is silently dropped.
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

/**
 * Extra artifact targets per field, beyond Narrative. Strategy is the only
 * static phase, so it is the only one with a hand-declared map; dynamic phases
 * derive their field→artifact targets from the dynamicSchema at runtime.
 */
const PHASE_FIELD_ARTIFACTS: Record<string, Record<string, string[]>> = {
  strategy: {
    businessObjective: ["charter", "business-case"],
    sponsor: ["charter"],
    constraints: ["business-case"],
    successMetric: ["outcome-framework"],
  },
};

/**
 * The input field ids declared to flow into a given artifact, across all three
 * sources that wire the phase flow: the methodology's `artifactInputFlow`
 * (artifact → fields), Strategy's hand-declared field → artifact map, and the
 * programme's dynamic schema. Returns the deduped field ids — the inputs that
 * must be complete before the artifact can be meaningfully generated. An empty
 * result means no input is declared to feed the artifact (nothing to wait on).
 */
export function getArtifactInputFields(phaseId: string, artifactId: string, store?: DynamicSchemaStore): string[] {
  const fields = new Set<string>();
  const methodologyFlow = ATOS_STANDARD.phases.find((phase) => phase.id === phaseId)?.artifactInputFlow ?? {};
  for (const fieldId of methodologyFlow[artifactId] ?? []) fields.add(fieldId);
  const fieldMap = PHASE_FIELD_ARTIFACTS[phaseId] ?? {};
  for (const [fieldId, artifacts] of Object.entries(fieldMap)) {
    if (artifacts.includes(artifactId)) fields.add(fieldId);
  }
  const dynamicFlow = store?.artifactInputFlow?.[phaseId] ?? {};
  for (const fieldId of dynamicFlow[artifactId] ?? []) fields.add(fieldId);
  return [...fields];
}

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
