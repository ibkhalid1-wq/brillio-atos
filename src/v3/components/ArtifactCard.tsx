import React from "react";

/**
 * Presentational artifact card. All derivation (status, quality score, preflight,
 * generation locks, recommendation counts) is computed by the parent and passed
 * in as a flat model — this component only renders the row, the quality meter and
 * the action set, and reports clicks back through the callbacks. Keeping it dumb
 * means the parent's heavy per-artifact computation stays in one place and the
 * action layout (which becomes origin-aware) lives in one small, testable unit.
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
  /** present && there is content to show. */
  canPreview: boolean;
  /** present && not approved && phase gate not approved. */
  showRecommendations: boolean;
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
  onRecommend: () => void;
  onGenerate: () => void;
  onUnlock: () => void;
}

export default function ArtifactCard({
  model,
  handlers,
}: {
  model: ArtifactCardModel;
  handlers: ArtifactCardHandlers;
}) {
  const {
    index,
    defId,
    label,
    isStrategicRoadmap,
    statusLabel,
    statusTone,
    displayScore,
    present,
    summary,
    canPreview,
    showRecommendations,
    recommendationCount,
    showGenerate,
    generateDisabled,
    generateTitle,
    generateContent,
    showUnlock,
    unlockTitle,
  } = model;

  return (
    <React.Fragment>
      {index > 0 ? (
        <div className="v3-artifact-flow-arrow" aria-hidden="true" title="Generate artifacts in this order">↓</div>
      ) : null}
      <div className="v3-artifact-row" data-io-anchor={`artifact:${defId}`} data-tone={statusTone} data-present={present ? "true" : "false"}>
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
          {canPreview ? (
            isStrategicRoadmap ? (
              <button
                type="button"
                className="v3-button ghost v3-button-inline-xs"
                onClick={handlers.onOpenRoadmap}
                title="Open the Strategic Roadmap"
                aria-label="Open the Strategic Roadmap"
              >
                Open roadmap →
              </button>
            ) : (
              <button
                type="button"
                className="v3-button ghost v3-button-inline-xs"
                onClick={handlers.onPreview}
                title={`Preview ${label}`}
                aria-label={`Preview ${label}`}
              >
                ▾ Preview
              </button>
            )
          ) : null}
          {showRecommendations ? (
            <button
              type="button"
              className="v3-button ghost v3-button-inline-xs"
              onClick={handlers.onRecommend}
              disabled={recommendationCount === 0}
              title={recommendationCount === 0
                ? `No outstanding quality suggestions for ${label} — regenerate or re-review to surface new ones`
                : `Review and improve the quality of ${label} — ${recommendationCount} recommendation${recommendationCount === 1 ? "" : "s"}`}
              aria-label={`Improvement recommendations for ${label}`}
            >
              ✦ Recommendations{recommendationCount ? <span className="v3-button-icon-badge">{recommendationCount}</span> : null}
            </button>
          ) : null}
          {showGenerate ? (
            <button
              type="button"
              className={`v3-button ${present ? "ghost" : "primary"} v3-button-inline-xs v3-artifact-regen`}
              onClick={handlers.onGenerate}
              disabled={generateDisabled}
              title={generateTitle}
            >
              {generateContent}
            </button>
          ) : null}
          {showUnlock ? (
            <button
              type="button"
              className="v3-button ghost v3-button-inline-xs v3-artifact-unlock"
              onClick={handlers.onUnlock}
              title={unlockTitle}
            >
              ⤺ Unlock
            </button>
          ) : null}
        </div>
      </div>
    </React.Fragment>
  );
}
