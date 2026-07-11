/**
 * Hand-edits to generated artifact documents. The studio's WYSIWYG editors
 * produce the SAME structured shape the generators emit, so the reading pane,
 * gate signals and downstream generators keep working — an edit is a merge
 * over the stored doc, stamped and attested like every other action.
 */
import type { ProgramSummary } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";

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

  const attestation = {
    ts,
    agentId: actor,
    phaseId: input.movementId,
    tier: 1,
    action: `Edited: ${input.title}`,
    detail: "hand-edited in the artifact studio",
  };
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];

  return wrapProgramState(
    wrapper,
    { ...inner, [input.fieldKey]: nextDoc, flowAttestations: [...log, attestation].slice(-200) },
    usesNestedData,
  );
}

/** The stored structured document for an artifact, when one exists. */
export function readArtifactDoc(program: ProgramSummary, fieldKey: string): Record<string, unknown> | null {
  const { inner } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  return isRecord(inner[fieldKey]) ? (inner[fieldKey] as Record<string, unknown>) : null;
}
