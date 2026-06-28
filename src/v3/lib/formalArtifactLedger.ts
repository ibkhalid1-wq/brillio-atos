/**
 * One-off reconciler for the formal-artifact ledger.
 *
 * A formal document is stored in two places: the top-level mirror (the real body
 * under its field key) and a phaseArtifacts ledger stub (the status record the
 * coverage view and gate readiness read). An older run-agent build wrote only the
 * mirror, leaving the ledger bucket empty — so a present document read as
 * "missing" and its phase never counted it toward completeness.
 *
 * This pure reconciler walks every known formal artifact and, where a mirror has
 * content but no ledger stub exists, synthesises a stub matching the native
 * setPhaseArtifactValue shape (title/content/status/agentDrafted/agentDraftedAt/
 * confidence/agentConfidence). It is additive and idempotent: existing stubs are
 * never touched, mirrors without content are skipped. No AI calls.
 */
import {
  FORMAL_ARTIFACT_FIELD_KEYS,
  FORMAL_ARTIFACT_PHASES,
  getFormalArtifactContent,
  getFormalArtifactConfidence,
} from "@/v3/lib/formalArtifacts";

export interface FormalLedgerStub {
  title: string;
  content: Record<string, unknown>;
  status: "draft";
  agentDrafted: true;
  agentDraftedAt: string;
  confidence?: number;
  agentConfidence?: number;
}

export interface FormalArtifactLedgerResult {
  /** New data root with backfilled stubs (a fresh object when changed). */
  data: Record<string, unknown>;
  /** Which (phaseId, artifactId) stubs were added. */
  added: { phaseId: string; artifactId: string }[];
  changed: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function humanizeId(id: string): string {
  return id
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Reconcile the formal-artifact ledger for a program's DATA ROOT — the object
 * that holds both phaseArtifacts and the top-level mirrors. Callers that hold the
 * wrapper (`{ ..., data: {...} }`) must pass the resolved root and re-wrap the
 * result themselves.
 */
export function reconcileFormalArtifactLedger(
  source: Record<string, unknown> | null | undefined,
): FormalArtifactLedgerResult {
  if (!isObject(source)) {
    return { data: {}, added: [], changed: false };
  }

  const existingPhaseArtifacts = isObject(source.phaseArtifacts) ? source.phaseArtifacts : {};
  const added: { phaseId: string; artifactId: string }[] = [];
  // Buckets we mutate, cloned lazily so unchanged input is returned as-is.
  const nextBuckets: Record<string, Record<string, unknown>> = {};

  for (const agentId of Object.keys(FORMAL_ARTIFACT_FIELD_KEYS)) {
    const phaseId = FORMAL_ARTIFACT_PHASES[agentId];
    if (!phaseId) continue;

    const content = getFormalArtifactContent(source, agentId);
    if (!content) continue; // no mirror body → nothing to back-fill

    const existingBucket = isObject(existingPhaseArtifacts[phaseId])
      ? (existingPhaseArtifacts[phaseId] as Record<string, unknown>)
      : {};
    const existingStub = existingBucket[agentId];
    if (isObject(existingStub) && Object.keys(existingStub).length > 0) continue; // already in ledger

    const mirror = source[FORMAL_ARTIFACT_FIELD_KEYS[agentId]] as Record<string, unknown>;
    const title =
      typeof mirror.title === "string" && mirror.title.trim() ? mirror.title.trim() : humanizeId(agentId);
    const generatedAt =
      typeof mirror.generatedAt === "string" && mirror.generatedAt.trim()
        ? mirror.generatedAt
        : new Date().toISOString();
    const confidence = getFormalArtifactConfidence(source, agentId);

    const stub: FormalLedgerStub = {
      title,
      content: mirror,
      status: "draft",
      agentDrafted: true,
      agentDraftedAt: generatedAt,
      ...(confidence != null ? { confidence: confidence / 100, agentConfidence: confidence } : {}),
    };

    const bucket = nextBuckets[phaseId] ?? { ...existingBucket };
    bucket[agentId] = stub;
    nextBuckets[phaseId] = bucket;
    added.push({ phaseId, artifactId: agentId });
  }

  if (added.length === 0) return { data: source, added, changed: false };

  return {
    data: {
      ...source,
      phaseArtifacts: { ...existingPhaseArtifacts, ...nextBuckets },
    },
    added,
    changed: true,
  };
}
