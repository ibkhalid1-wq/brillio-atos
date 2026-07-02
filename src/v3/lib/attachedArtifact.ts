/**
 * Attaching a real document to an artifact slot, in place of generating it.
 *
 * The user's uploaded file becomes the slot's source of truth: it replaces any
 * AI-generated body (clear-on-attach) and is AI-validated for a quality score +
 * improvement recommendations. Both transforms here are pure so they can be unit
 * tested without the edge call or persistence — the AppShellV3 handler supplies
 * the document-intelligence result and persists the returned inner data.
 */
import type { DocumentIntelligence } from "@/new/lib/documentIntelligenceTypes";
import { artifactReviewFieldKey, discountQualityForDeficiencies } from "@/v3/lib/artifactReview";
import { FORMAL_ARTIFACT_FIELD_KEYS } from "@/v3/lib/formalArtifacts";

export interface AttachedArtifactReview {
  score: number;
  improvements: string[];
  suggestedStakeholders: string[];
}

/**
 * Turn a document-intelligence result into the artifact's quality review. The
 * doc-level confidence (0-1) is the score; the model's identified gaps and
 * recommendations become the improvement list. For an attached document these
 * are read-only guidance — acted on in the source file, not applied in-app — so
 * no stakeholder-placeholder set is derived.
 */
export function deriveAttachedArtifactReview(intel: DocumentIntelligence): AttachedArtifactReview {
  const raw = typeof intel.overallConfidence === "number" ? intel.overallConfidence : 0;
  const score = Math.max(0, Math.min(100, Math.round(raw * 100)));
  const improvements: string[] = [];
  for (const gap of intel.entities?.gaps ?? []) {
    const text = gap.impact ? `${gap.description} — ${gap.impact}` : gap.description;
    if (text && text.trim()) improvements.push(text.trim());
  }
  for (const rec of intel.entities?.recommendations ?? []) {
    if (rec.text && rec.text.trim()) improvements.push(rec.text.trim());
  }
  return { score, improvements, suggestedStakeholders: [] };
}

export interface AttachArtifactParams {
  phaseId: string;
  defId: string;
  label: string;
  /** Producing-agent id for the slot — its stale generated ledger entry is cleared too. */
  agentId: string;
  fileName: string;
  review: AttachedArtifactReview;
  /** Document-intelligence one-line summary. */
  summary: string;
  /** Document body text (or summary fallback). */
  content: string;
  now?: string;
}

/**
 * Write an uploaded document into an artifact slot, immutably returning the next
 * inner program data. Sets the ledger entry to a human-provided origin
 * (agentDrafted:false, lastEditedBy:"human" → buildArtifactModel reads
 * origin:"uploaded"), clears the generated body mirror, and stores the AI quality
 * review at the per-phase bucket the reader prefers.
 *
 * Write-back gate: the persisted ledger `confidence` is the review score eroded by
 * the reviewer's own actionable improvements (via the shared
 * discountQualityForDeficiencies), so the *stored* value already reflects the
 * document's admitted gaps — a direct reader of the ledger can never surface a
 * high confidence beside them. The review's `score` is stored RAW, because the
 * display reader (resolveArtifactQualityScore) prefers the review and erodes it
 * itself; eroding both would double-count. The two stay equal by construction.
 */
export function buildAttachedArtifactPatch(
  inner: Record<string, unknown>,
  params: AttachArtifactParams,
): Record<string, unknown> {
  const now = params.now ?? new Date().toISOString();
  const next = { ...inner };
  // Reconcile the persisted confidence against the artifact's own admissions.
  const persistedConfidence = discountQualityForDeficiencies(
    params.review.score,
    params.review.improvements.length,
  );

  const buckets = typeof next.phaseArtifacts === "object" && next.phaseArtifacts !== null && !Array.isArray(next.phaseArtifacts)
    ? { ...(next.phaseArtifacts as Record<string, Record<string, unknown>>) }
    : {};
  const phaseBucket = typeof buckets[params.phaseId] === "object" && buckets[params.phaseId] !== null
    ? { ...(buckets[params.phaseId] as Record<string, unknown>) }
    : {};
  // Clear-on-attach: the attached document replaces whatever generated artifact
  // sat in this slot — including a stale entry keyed by the producing agent id.
  if (params.agentId !== params.defId) delete phaseBucket[params.agentId];
  phaseBucket[params.defId] = {
    title: params.label,
    status: "ready",
    confidence: persistedConfidence,
    agentDrafted: false,
    lastEditedBy: "human",
    contentSummary: params.summary,
    content: params.content,
    attachedFileName: params.fileName,
    agentId: params.agentId,
    updatedAt: now,
    version: 1,
  };
  buckets[params.phaseId] = phaseBucket;
  next.phaseArtifacts = buckets;

  // Clear the formal top-level mirror (the generated body) so a stale generated
  // document can never resurface beside the attached one.
  const mirrorKey = FORMAL_ARTIFACT_FIELD_KEYS[params.defId];
  if (mirrorKey) delete next[mirrorKey];

  const review = {
    score: params.review.score,
    improvements: params.review.improvements,
    suggestedStakeholders: params.review.suggestedStakeholders,
  };
  next[artifactReviewFieldKey(params.defId)] = { ...review, [params.phaseId]: review };

  return next;
}
