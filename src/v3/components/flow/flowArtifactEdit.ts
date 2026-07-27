/**
 * Hand-edits to generated artifact documents. The studio's WYSIWYG editors
 * produce the SAME structured shape the generators emit, so the reading pane,
 * gate signals and downstream generators keep working — an edit is a merge
 * over the stored doc, stamped and attested like every other action.
 */
import type { ProgramSummary } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import { hasBlockingOntologyViolations } from "@/v3/components/flow/flowOntologyConstraints";
import { overrideNotes, appendOperatorOverrides } from "@/v3/components/flow/flowOperatorOverrides";
import { FORMAL_ARTIFACT_FIELD_KEYS } from "@/v3/lib/formalArtifacts";

/** Which evidence-bearing edits move which downstream movements' inputs —
 * the mirror of listenPlanWrite's planRev discipline for DOC edits. */
const DOWNSTREAM_STAMPS: Record<string, { key: string; movements: string[] }> = {
  discoveryKit: { key: "kitRev", movements: ["listen", "envision", "show"] },
  domainOntology: { key: "ontologyRev", movements: ["listen", "envision", "show"] },
  currentStateAtlas: { key: "atlasRev", movements: ["envision", "show"] },
};
const ARTIFACT_ID_BY_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(FORMAL_ARTIFACT_FIELD_KEYS).map(([artifactId, fieldKey]) => [fieldKey, artifactId]));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Merge an edited artifact document back into the blob. Pure — returns the
 * next blob for persistFlowMutation, or null when there is nothing to write.
 * Generator metadata the editor doesn't touch (confidence, generatedAt, gaps
 * the model raised) survives via the merge; `editedAt`/`editedBy` record that
 * a human shaped this version.
 */
export function applyArtifactEdit(
  program: ProgramSummary,
  input: { fieldKey: string; movementId: string; title: string; doc: Record<string, unknown> },
  actor: string,
): Record<string, unknown> | null {
  if (!input.fieldKey || !isRecord(input.doc)) return null;
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const previous = isRecord(inner[input.fieldKey]) ? (inner[input.fieldKey] as Record<string, unknown>) : {};
  const ts = new Date().toISOString();
  const nextDoc = { ...previous, ...input.doc, editedAt: ts, editedBy: actor };

  // Write-time grounding gate (F-004): the domain ontology's declared
  // domain/range/cardinality is enforced here, not merely displayed. A merge
  // that would leave a relation dangling, mis-cardinalised or self-contradictory
  // is rejected — no client path persists a structurally invalid ontology. The
  // studio blocks Save on the same check, so this is the backstop, not the UX.
  if (input.fieldKey === "domainOntology" && hasBlockingOntologyViolations(nextDoc)) return null;

  const attestation = {
    ts,
    agentId: actor,
    phaseId: input.movementId,
    tier: 1,
    action: `Edited: ${input.title}`,
    detail: "hand-edited in the artifact studio",
  };
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];

  // Evidence-bearing docs (kit, ontology, atlas): the CHANGE itself is
  // captured as an operator override — durable, programme-level, fed back
  // into the regenerator's prompt — because the doc it lives in is replaced
  // wholesale on regeneration.
  const notes = overrideNotes(input.fieldKey, previous, nextDoc);
  const overrides = notes.length
    ? { flowOperatorOverrides: appendOperatorOverrides(inner.flowOperatorOverrides, input.fieldKey, notes, ts, actor) }
    : {};

  // An evidence-bearing DOC edit moves its downstream movements' inputs the
  // same way a kit-matrix edit does: stamp a rev (a NON-underscore key, so it
  // lands in the inputs fingerprint) into each downstream bucket — kit edits
  // prompt Listen/Prototype regeneration, ontology edits prompt the atlas
  // (and Prototype), atlas edits prompt Prototype.
  let phaseInputs = isRecord(inner.phaseInputs) ? (inner.phaseInputs as Record<string, unknown>) : {};
  let phaseArtifactsPatch: Record<string, unknown> = {};
  const stampSpec = DOWNSTREAM_STAMPS[input.fieldKey];
  if (stampSpec) {
    phaseInputs = { ...phaseInputs };
    for (const movementId of stampSpec.movements) {
      const bucket = isRecord(phaseInputs[movementId]) ? { ...(phaseInputs[movementId] as Record<string, unknown>) } : {};
      bucket[stampSpec.key] = ts;
      phaseInputs[movementId] = bucket;
    }
    // Self-exemption: when the edited doc's OWN movement was stamped (the
    // ontology lives in Listen), its stored fingerprint would now read stale
    // for the very edit just made. Refresh its stub to the post-stamp
    // fingerprint — the hash MIRRORS movementInputsFingerprint (and the edge
    // implementation); keep byte-compatible.
    const artifactId = ARTIFACT_ID_BY_FIELD[input.fieldKey];
    if (artifactId && stampSpec.movements.includes(input.movementId)) {
      const bucket = isRecord(phaseInputs[input.movementId]) ? (phaseInputs[input.movementId] as Record<string, unknown>) : {};
      const keys = Object.keys(bucket).filter((key) => !key.startsWith("_")).sort();
      const text = JSON.stringify(keys.map((key) => [key, bucket[key]]));
      let hash = 5381;
      for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
      const stubs = isRecord(inner.phaseArtifacts) ? { ...(inner.phaseArtifacts as Record<string, unknown>) } : {};
      const movementStubs = isRecord(stubs[input.movementId]) ? { ...(stubs[input.movementId] as Record<string, unknown>) } : {};
      const stub = isRecord(movementStubs[artifactId]) ? { ...(movementStubs[artifactId] as Record<string, unknown>) } : {};
      stub.inputsFingerprint = hash.toString(16);
      movementStubs[artifactId] = stub;
      stubs[input.movementId] = movementStubs;
      phaseArtifactsPatch = { phaseArtifacts: stubs };
    }
  }

  return wrapProgramState(
    wrapper,
    { ...inner, [input.fieldKey]: nextDoc, ...overrides, phaseInputs, ...phaseArtifactsPatch, flowAttestations: [...log, attestation].slice(-200) },
    usesNestedData,
  );
}

/** The stored structured document for an artifact, when one exists. */
export function readArtifactDoc(program: ProgramSummary, fieldKey: string): Record<string, unknown> | null {
  const { inner } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  return isRecord(inner[fieldKey]) ? (inner[fieldKey] as Record<string, unknown>) : null;
}
