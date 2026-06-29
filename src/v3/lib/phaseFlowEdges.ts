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
 * the phase is silently dropped.
 */
import { getPhaseArtifactIds } from "@/v3/lib/phaseArtifacts";
import { ATOS_STANDARD } from "@/v3/lib/methodology";
import { canonicalArtifactId, dynamicFieldArtifacts, type DynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import { getPhaseInputSchema, resolveStakeholderField, STAKEHOLDER_PHASE_ID } from "@/v3/lib/phaseInputSchema";

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
 * Static artifact targets per field. Strategy is the only static phase, so it is
 * the only one with a hand-declared map; dynamic phases derive their
 * field→artifact targets from the dynamicSchema at runtime.
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
 * Semantic input → artifact relationships that hold for any programme regardless
 * of the exact field ids the planner emitted. The Discover stakeholder list
 * always feeds the scope map and requirements catalog — both synthesise who the
 * programme serves and what they need — so we wire that edge deterministically
 * rather than depending on the planner to declare it in `artifactInputFlow`.
 *
 * The stakeholder field is resolved by shape (`resolveStakeholderField`), so this
 * holds whatever column set the planner proposed; targets are still constrained
 * to the phase's real artifact set by callers, so an edge only appears once the
 * scope map / requirements catalog actually exist in the phase.
 */
const STAKEHOLDER_CONSUMER_ARTIFACTS = ["scope-map", "requirements-catalog"];

/**
 * Static inputs that feed a dynamic-artifact phase's deliverables by *intent*, not
 * by a fixed artifact id. Design and Build both declare static inputs but let the
 * planner name the artifacts, so a fixed methodology `artifactInputFlow` only
 * wires the canonical ids — on a planner-divergent programme the architecture /
 * delivery / quality inputs would dangle with no flow line (e.g. Build declares a
 * "milestone" / "test-plan" target, but the planner emits "milestone-register" /
 * "uat-plan" / "build-phase-delivery-report"). Matching each input's intent
 * keywords against whatever artifacts actually render keeps every static input
 * connected regardless of the planner's naming — targets are still constrained to
 * the phase's real artifact set by `getPhaseArtifactIds`, so nothing dangles.
 */
const PHASE_FIELD_INTENT: Record<string, Record<string, string[]>> = {
  design: {
    solutionApproach: ["solution", "design", "architecture", "operating", "model", "approach", "future"],
    targetArchitecture: ["architecture", "solution", "design", "technical", "platform"],
    keyDesignDecisions: ["decision", "architecture", "design", "solution"],
    nonFunctionalRequirements: ["architecture", "solution", "design", "nfr", "quality", "performance", "security", "operating"],
    integrationDataConstraints: ["integration", "data", "critical", "path", "constraint", "migration"],
  },
  build: {
    deliveryIncrements: ["milestone", "increment", "cadence", "delivery", "release"],
    testStrategy: ["test", "uat", "quality", "acceptance"],
    environmentsRelease: ["environment", "release", "go-live", "cutover", "deploy"],
    definitionOfDone: ["done", "acceptance", "readiness", "quality", "uat"],
  },
};

function intentFieldArtifacts(phaseId: string, store?: DynamicSchemaStore): Record<string, string[]> {
  const intent = PHASE_FIELD_INTENT[phaseId];
  if (!intent) return {};
  const artifactIds = getPhaseArtifactIds(phaseId, store);
  if (artifactIds.length === 0) return {};
  const out: Record<string, string[]> = {};
  for (const [fieldId, keywords] of Object.entries(intent)) {
    const matched = artifactIds.filter((id) => {
      const lower = id.toLowerCase();
      return keywords.some((kw) => lower.includes(kw));
    });
    if (matched.length > 0) out[fieldId] = matched;
  }
  return out;
}

function semanticFieldArtifacts(phaseId: string, store?: DynamicSchemaStore): Record<string, string[]> {
  if (PHASE_FIELD_INTENT[phaseId]) return intentFieldArtifacts(phaseId, store);
  if (phaseId !== STAKEHOLDER_PHASE_ID) return {};
  const field = resolveStakeholderField(store, phaseId);
  if (!field) return {};
  return { [field.id]: [...STAKEHOLDER_CONSUMER_ARTIFACTS] };
}

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
  // The flow may be keyed by a phase-prefixed id while callers pass the canonical
  // (producing-agent) id, so match on the canonicalised key.
  for (const [flowArtifactId, fieldIds] of Object.entries(dynamicFlow)) {
    if (canonicalArtifactId(phaseId, flowArtifactId) !== artifactId) continue;
    for (const fieldId of fieldIds ?? []) fields.add(fieldId);
  }
  const semanticMap = semanticFieldArtifacts(phaseId, store);
  for (const [fieldId, artifacts] of Object.entries(semanticMap)) {
    if (artifacts.includes(artifactId)) fields.add(fieldId);
  }
  return [...fields];
}

/**
 * Of the inputs declared to ground an artifact, the subset the user can actually
 * fill — i.e. that exist as input fields in the phase's rendered schema. The
 * dynamic schema's `artifactInputFlow` can name owner/lead fields (e.g.
 * `criticalPathOwner`, `qaLead`) that the roster-owner guardrail drops from the
 * rendered inputs because they resolve from the Mobilise roster and are never
 * typed here. Such a field can never be "filled" from the inputs panel, so
 * gating generation on it would lock the Generate button permanently. Callers
 * that gate the Generate button (or list inputs to enrich) must use this, not
 * the raw declared set, so only genuinely fillable inputs can block generation.
 */
export function getFillableArtifactInputFields(phaseId: string, artifactId: string, store?: DynamicSchemaStore): string[] {
  const fieldIds = new Set(getPhaseInputSchema(phaseId, store).fields.map((field) => field.id));
  return getArtifactInputFields(phaseId, artifactId, store).filter((fieldId) => fieldIds.has(fieldId));
}

/**
 * Derive the input → artifact edges for a phase. Each field yields one edge per
 * declared target (from Strategy's static map, the methodology's
 * `artifactInputFlow`, and the dynamic schema) that exists in the phase's
 * artifact set, de-duplicated in a stable order. Nothing is hard-coded: a field
 * with no declared targets produces no edges.
 */
export function derivePhaseFlowEdges(phaseId: string, fieldIds: string[], store?: DynamicSchemaStore): FlowEdge[] {
  const map = PHASE_FIELD_ARTIFACTS[phaseId] ?? {};
  const methodologyMap = methodologyFieldArtifacts(phaseId);
  const dynamicMap = dynamicFieldArtifacts(phaseId, store);
  const semanticMap = semanticFieldArtifacts(phaseId, store);
  const valid = new Set(getPhaseArtifactIds(phaseId, store));
  const edges: FlowEdge[] = [];
  for (const fieldId of fieldIds) {
    const seen = new Set<string>();
    const targets = [...(map[fieldId] ?? []), ...(methodologyMap[fieldId] ?? []), ...(dynamicMap[fieldId] ?? []), ...(semanticMap[fieldId] ?? [])];
    for (const to of targets) {
      if (seen.has(to) || !valid.has(to)) continue;
      seen.add(to);
      edges.push({ from: fieldId, to });
    }
  }
  return edges;
}
