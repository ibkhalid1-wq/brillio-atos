import React from "react";

/**
 * Presentational artifact card. All derivation (status, quality score, preflight,
 * generation locks, recommendation counts) is computed by the parent and passed
 * in as a flat model — this component only renders the row, the quality meter and
 * the origin-aware action set, reporting clicks back through the callbacks.
 *
 * The action set is keyed off the artifact's lifecycle origin:
 *   • new (not present)        → Generate · Attach
 *   • generated (AI-produced)  → Preview · Improve · Regenerate · Attach
 *   • attached (uploaded doc)  → Improve (read-only recs) · Reattach · Delete
 *   • approved (either origin) → Preview · Unlock
 * An attached document is the user's source of truth, so it offers no Generate
 * (nothing to produce) and its Improve surfaces recommendations to act on in the
 * source file, not an in-app apply.
 */
export interface ArtifactCardModel {
  index: number;
  defId: string;
  label: string;
  /** Strategic roadmap previews open the dedicated roadmap view, not the modal. */
  isStrategicRoadmap: boolean;
  statusLabel: string;
  statusTone: string;
  displayScore: number | null;
  present: boolean;
  summary: string;
  state: string;
  origin: "generated" | "uploaded" | "required";
  /** state === "approved". */
  approved: boolean;
  /** Phase gate approved → mutating actions (generate/improve/attach/delete) are off. */
  phaseLocked: boolean;
  /** present && there is content to show. */
  canPreview: boolean;
  recommendationCount: number;
  /** state !== "approved". */
  showGenerate: boolean;
  generateDisabled: boolean;
  generateTitle: string;
  generateContent: React.ReactNode;
  /** present && has an artifact id && approved && phase not locked. */
  showUnlock: boolean;
  unlockTitle: string;
}

export interface ArtifactCardHandlers {
  onPreview: () => void;
  onOpenRoadmap: () => void;
  /** Open the quality/recommendations modal (read-only for attached docs). */
  onRecommend: () => void;
  onGenerate: () => void;
  onUnlock: () => void;
  /** Attach a document to this artifact slot (new + generated). */
  onAttach: () => void;
  /** Replace the attached document. */
  onReattach: () => void;
  /** Remove the attached document. */
  onDelete: () => void;
}

function PreviewButton({ model, handlers }: { model: ArtifactCardModel; handlers: ArtifactCardHandlers }) {
  if (!model.canPreview) return null;
  if (model.isStrategicRoadmap) {
    return (
      <button
        type="button"
        className="v3-button ghost v3-button-inline-xs"
        onClick={handlers.onOpenRoadmap}
        title="Open the Strategic Roadmap"
        aria-label="Open the Strategic Roadmap"
      >
        Open roadmap →
      </button>
    );
  }
  return (
    <button
      type="button"
      className="v3-button ghost v3-button-inline-xs"
      onClick={handlers.onPreview}
      title={`Preview ${model.label}`}
      aria-label={`Preview ${model.label}`}
    >
      ▾ Preview
    </button>
  );
}

function ImproveButton({ model, handlers, readOnly }: { model: ArtifactCardModel; handlers: ArtifactCardHandlers; readOnly: boolean }) {
  const none = model.recommendationCount === 0;
  return (
    <button
      type="button"
      className="v3-button ghost v3-button-inline-xs"
      onClick={handlers.onRecommend}
      disabled={none}
      title={none
        ? readOnly
          ? `No outstanding recommendations for ${model.label}`
          : `No outstanding quality suggestions for ${model.label} — regenerate or re-review to surface new ones`
        : readOnly
          ? `Review recommendations for ${model.label} — ${model.recommendationCount} item${model.recommendationCount === 1 ? "" : "s"}`
          : `Review and improve the quality of ${model.label} — ${model.recommendationCount} recommendation${model.recommendationCount === 1 ? "" : "s"}`}
      aria-label={`Improvement recommendations for ${model.label}`}
    >
      ✦ Improve{model.recommendationCount ? <span className="v3-button-icon-badge">{model.recommendationCount}</span> : null}
    </button>
  );
}

function GenerateButton({ model, handlers }: { model: ArtifactCardModel; handlers: ArtifactCardHandlers }) {
  if (!model.showGenerate) return null;
  return (
    <button
      type="button"
      className={`v3-button ${model.present ? "ghost" : "primary"} v3-button-inline-xs v3-artifact-regen`}
      onClick={handlers.onGenerate}
      disabled={model.generateDisabled}
      title={model.generateTitle}
    >
      {model.generateContent}
    </button>
  );
}

export default function ArtifactCard({
  model,
  handlers,
}: {
  model: ArtifactCardModel;
  handlers: ArtifactCardHandlers;
}) {
  const { defId, label, statusLabel, statusTone, displayScore, present, summary } = model;
  const isAttached = model.origin === "uploaded";

  return (
    <React.Fragment>
      {model.index > 0 ? (
        <div className="v3-artifact-flow-arrow" aria-hidden="true" title="Generate artifacts in this order">↓</div>
      ) : null}
      <div className="v3-artifact-row" data-io-anchor={`artifact:${defId}`} data-tone={statusTone} data-present={present ? "true" : "false"} data-origin={model.origin}>
        <div className="v3-artifact-row-head">
          <span className="v3-artifact-row-label">{label}</span>
          <span className={`v3-chip ${statusTone}`} style={{ flex: "0 0 auto" }}>
            {statusLabel}{present && displayScore != null ? ` · ${displayScore}%` : ""}
          </span>
        </div>
        {present && displayScore != null ? (
          <div className="v3-artifact-quality-meter" title={`Quality ${displayScore}%`}>
            <span className={`v3-artifact-quality-fill ${displayScore >= 90 ? "is-high" : displayScore >= 70 ? "is-mid" : "is-low"}`} style={{ width: `${Math.max(0, Math.min(100, displayScore))}%` }} />
          </div>
        ) : null}
        <p className="v3-artifact-row-desc">{summary}</p>
        <div className="v3-artifact-row-actions">
          {model.approved ? (
            <>
              <PreviewButton model={model} handlers={handlers} />
              {model.showUnlock ? (
                <button
                  type="button"
                  className="v3-button ghost v3-button-inline-xs v3-artifact-unlock"
                  onClick={handlers.onUnlock}
                  title={model.unlockTitle}
                >
                  ⤺ Unlock
                </button>
              ) : null}
            </>
          ) : isAttached ? (
            <>
              {!model.phaseLocked ? <ImproveButton model={model} handlers={handlers} readOnly /> : null}
              {!model.phaseLocked ? (
                <button
                  type="button"
                  className="v3-button ghost v3-button-inline-xs"
                  onClick={handlers.onReattach}
                  title={`Replace the attached document for ${label}`}
                >
                  ⇄ Reattach
                </button>
              ) : null}
              {!model.phaseLocked ? (
                <button
                  type="button"
                  className="v3-button ghost v3-button-inline-xs v3-artifact-delete"
                  onClick={handlers.onDelete}
                  title={`Remove the attached document for ${label}`}
                >
                  ✕ Delete
                </button>
              ) : null}
            </>
          ) : (
            <>
              <PreviewButton model={model} handlers={handlers} />
              {present && !model.phaseLocked ? <ImproveButton model={model} handlers={handlers} readOnly={false} /> : null}
              <GenerateButton model={model} handlers={handlers} />
              {!model.phaseLocked ? (
                <button
                  type="button"
                  className="v3-button ghost v3-button-inline-xs v3-artifact-attach"
                  onClick={handlers.onAttach}
                  title={`Attach a document for ${label} instead of generating it`}
                >
                  ⎙ Attach
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </React.Fragment>
  );
}
