/**
 * Input → approved-artifact staleness primitives.
 *
 * When a captured input value changes, any approved artifact that the input
 * feeds must be flagged stale and regenerated — approved artifacts are never
 * silently rewritten, but they must not silently drift either. The field →
 * artifact relationships are read from the methodology flow edges
 * (`derivePhaseFlowEdges`, sourced from `artifactInputFlow`), so this logic
 * stays methodology-driven rather than hard-coding which inputs touch which
 * artifacts.
 *
 * The same primitive answers the reimport question in reverse: which incoming
 * fields must be left untouched because they feed an already-approved artifact.
 *
 * Pure, deterministic, unit-testable. No AI, no backend.
 */
import { derivePhaseFlowEdges } from "@/v3/lib/phaseFlowEdges";
import { type DynamicSchemaStore } from "@/v3/lib/dynamicSchema";

/** A phase's artifact bucket: artifactId → entry (we only read `status`). */
export type PhaseArtifactBucket = Record<string, unknown> | undefined;

const RESERVED_INPUT_KEYS = new Set(["savedAt"]);

function isApproved(entry: unknown): boolean {
  return Boolean(entry && typeof entry === "object" && (entry as { status?: unknown }).status === "approved");
}

/** Approved artifact ids in a phase bucket. */
function approvedArtifactIds(bucket: PhaseArtifactBucket): Set<string> {
  const approved = new Set<string>();
  if (!bucket || typeof bucket !== "object") return approved;
  for (const [artifactId, entry] of Object.entries(bucket)) {
    if (isApproved(entry)) approved.add(artifactId);
  }
  return approved;
}

/** Artifact ids (within the phase) that the given input fields flow into. */
export function artifactsForInputFields(
  phaseId: string,
  fieldIds: string[],
  store?: DynamicSchemaStore,
): Set<string> {
  const targets = new Set<string>();
  for (const edge of derivePhaseFlowEdges(phaseId, fieldIds, store)) targets.add(edge.to);
  return targets;
}

/**
 * The input field ids whose value differs between the previously-saved bucket
 * and the incoming values. Reserved/meta keys (`savedAt`, anything prefixed
 * with `_`, e.g. provenance) are ignored. Values are compared as strings so a
 * grid serialised to JSON and a plain text field are handled uniformly.
 */
export function changedInputFields(prevBucket: unknown, inputs: Record<string, string>): string[] {
  const prev = (prevBucket && typeof prevBucket === "object" ? prevBucket : {}) as Record<string, unknown>;
  const changed: string[] = [];
  for (const [fieldId, value] of Object.entries(inputs)) {
    if (fieldId.startsWith("_") || RESERVED_INPUT_KEYS.has(fieldId)) continue;
    if (String(prev[fieldId] ?? "") !== String(value ?? "")) changed.push(fieldId);
  }
  return changed;
}

/**
 * Approved artifacts in `bucket` that the changed input fields feed — the
 * artifacts to move to "stale" and require regeneration.
 */
export function approvedArtifactsToStale(
  phaseId: string,
  changedFieldIds: string[],
  bucket: PhaseArtifactBucket,
  store?: DynamicSchemaStore,
): string[] {
  if (!changedFieldIds.length) return [];
  const approved = approvedArtifactIds(bucket);
  if (!approved.size) return [];
  const targets = artifactsForInputFields(phaseId, changedFieldIds, store);
  return [...targets].filter((artifactId) => approved.has(artifactId));
}

/**
 * Every artifact in `bucket` that the changed input fields feed — regardless of
 * status — so that ANY artifact built from those inputs (draft, ready, OR
 * approved) is moved to "stale" and must be regenerated. `archived` artifacts are
 * left alone (intentionally retired). This is the broader counterpart to
 * `approvedArtifactsToStale`, which only touches approved artifacts.
 */
export function relatedArtifactsToStale(
  phaseId: string,
  changedFieldIds: string[],
  bucket: PhaseArtifactBucket,
  store?: DynamicSchemaStore,
): string[] {
  if (!changedFieldIds.length) return [];
  if (!bucket || typeof bucket !== "object") return [];
  const targets = artifactsForInputFields(phaseId, changedFieldIds, store);
  return [...targets].filter((artifactId) => {
    const entry = (bucket as Record<string, unknown>)[artifactId];
    if (!entry || typeof entry !== "object") return false;
    const status = (entry as { status?: unknown }).status;
    return status !== "archived" && status !== "stale";
  });
}

/**
 * The subset of `fieldIds` that must NOT be overwritten on reimport because
 * they feed an already-approved artifact. Protecting these keeps an approved
 * artifact's source inputs stable rather than silently staling it on every
 * document re-scan.
 */
export function fieldsFeedingApprovedArtifacts(
  phaseId: string,
  fieldIds: string[],
  bucket: PhaseArtifactBucket,
  store?: DynamicSchemaStore,
): Set<string> {
  const blocked = new Set<string>();
  const approved = approvedArtifactIds(bucket);
  if (!approved.size) return blocked;
  for (const fieldId of fieldIds) {
    for (const edge of derivePhaseFlowEdges(phaseId, [fieldId], store)) {
      if (approved.has(edge.to)) {
        blocked.add(fieldId);
        break;
      }
    }
  }
  return blocked;
}
