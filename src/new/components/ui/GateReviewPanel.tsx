import React, { useMemo, useState } from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { GateReview } from "@/new/types";

interface GateReviewPanelProps {
  review: GateReview | null;
  phaseName: string;
  pct: number;
  isRunning: boolean;
  onApprove: () => void;
  onRequestRemediation: (note: string) => void;
  onTrigger: () => void;
}

function ringColor(score: number) {
  if (score >= 0.8) return "#16a34a";
  if (score >= 0.6) return "#d97706";
  return "#dc2626";
}

function artifactGlyph(status: GateReview["artifactsSummary"][number]["status"]) {
  if (status === "complete") return "✓";
  if (status === "partial") return "◐";
  return "✗";
}

export function GateReviewPanel({
  review,
  phaseName,
  pct,
  isRunning,
  onApprove,
  onRequestRemediation,
  onTrigger,
}: GateReviewPanelProps) {
  const [showRemediationForm, setShowRemediationForm] = useState(false);
  const [remediationNote, setRemediationNote] = useState("");

  const score = review?.readinessScore ?? Math.max(0, Math.min(1, pct / 100));
  const scorePct = Math.round(score * 100);
  const circumference = 2 * Math.PI * 28;
  const strokeOffset = circumference - (circumference * scorePct) / 100;
  const canApprove = !!review && review.status === "ready";
  const missingLabel = useMemo(() => {
    if (!review) return "Run the gate review first.";
    const unmet = (review.exitCriteriaStatus || []).filter((entry) => !entry.met).length;
    if ((review.openDecisions ?? 0) > 0) return `${review.openDecisions} decision${review.openDecisions! > 1 ? "s are" : " is"} still open.`;
    if ((review.openRisks ?? 0) > 0) return `${review.openRisks} risk${review.openRisks! > 1 ? "s are" : " is"} still open.`;
    if (unmet > 0) return `${unmet} exit ${unmet > 1 ? "criteria are" : "criterion is"} not yet met.`;
    return "This phase is not yet ready for approval.";
  }, [review]);

  if (!review && pct < 85) {
    return (
      <NotReadyCard
        title="Gate review not available"
        reason="Gate review runs automatically when phase reaches 85% readiness."
        onTrigger={onTrigger}
        triggerLabel="Check gate readiness"
        isRunning={isRunning}
      />
    );
  }

  if (!review) {
    return (
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-title">Gate review</div>
            <div className="adam-body adam-muted">
              {phaseName} is nearing the handoff threshold. Run a gate assessment to evaluate evidence, open decisions, and exit criteria before unlocking the next phase.
            </div>
          </div>
          <button type="button" className="adam-button-ghost" onClick={onTrigger} disabled={isRunning}>
            {isRunning ? "Assessing…" : "Run gate review"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="adam-card p-5">
      <div className="adam-row adam-space-between" style={{ alignItems: "flex-start" }}>
        <div className="adam-stack" style={{ gap: 6 }}>
          <div className="adam-title">Gate review</div>
          <div className="adam-body adam-muted">
            Evidence, exit criteria, and approval posture for {phaseName}.
          </div>
          <div className="adam-micro adam-muted">
            Updated {new Date(review.generatedAt).toLocaleString()}
          </div>
        </div>
        <button type="button" className="adam-button-ghost" onClick={onTrigger} disabled={isRunning}>
          {isRunning ? "Re-assessing…" : "Re-assess"}
        </button>
      </div>

      <div className="adam-gate-layout">
        <div className="adam-gate-ring-block">
          <div className="adam-gate-ring" aria-hidden="true">
            <svg viewBox="0 0 72 72">
              <circle cx="36" cy="36" r="28" stroke="rgba(255,255,255,0.08)" strokeWidth="8" fill="none" />
              <circle
                cx="36"
                cy="36"
                r="28"
                stroke={ringColor(score)}
                strokeWidth="8"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeOffset}
                transform="rotate(-90 36 36)"
              />
            </svg>
            <div className="adam-gate-ring-value">{scorePct}%</div>
          </div>
          <span className={`adam-badge ${
            review.status === "approved"
              ? "green"
              : review.status === "ready"
                ? "blue"
                : review.status === "remediation-requested"
                  ? "amber"
                  : "red"
          }`}>
            {review.status.replace(/-/g, " ")}
          </span>
          <div className="adam-row" style={{ flexWrap: "wrap", gap: 8 }}>
            <span className={`adam-badge ${review.openDecisions > 0 ? "amber" : "green"}`}>
              {review.openDecisions} open decision{review.openDecisions === 1 ? "" : "s"}
            </span>
            <span className={`adam-badge ${review.openRisks > 0 ? "red" : "green"}`}>
              {review.openRisks} open risk{review.openRisks === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="adam-stack" style={{ gap: 14 }}>
          <div>
            <div className="adam-micro adam-muted">Artifacts</div>
            <div className="adam-stack mt-3" style={{ gap: 10 }}>
              {review.artifactsSummary.length ? review.artifactsSummary.map((artifact) => (
                <div key={artifact.name} className="adam-gate-artifact-row">
                  <div className="adam-row" style={{ alignItems: "flex-start", gap: 10 }}>
                    <span className={`adam-gate-artifact-icon ${artifact.status}`}>{artifactGlyph(artifact.status)}</span>
                    <div className="adam-stack" style={{ gap: 6, flex: 1 }}>
                      <div className="adam-body" style={{ fontWeight: 600 }}>{artifact.name}</div>
                      <div className="adam-gate-confidence-track">
                        <span
                          className={`adam-gate-confidence-fill ${artifact.status}`}
                          style={{ width: `${Math.max(8, Math.round(artifact.confidence * 100))}%` }}
                        />
                      </div>
                    </div>
                    <div className="adam-micro adam-muted">{Math.round(artifact.confidence * 100)}%</div>
                  </div>
                </div>
              )) : (
                <div className="adam-list-item adam-body adam-muted">No artifacts were available to assess.</div>
              )}
            </div>
          </div>

          <div>
            <div className="adam-micro adam-muted">Exit criteria</div>
            <div className="adam-stack mt-3" style={{ gap: 8 }}>
              {review.exitCriteriaStatus.length ? review.exitCriteriaStatus.map((criterion) => (
                <div key={criterion.criterion} className="adam-gate-criterion">
                  <span className={`adam-gate-criterion-icon ${criterion.met ? "met" : "missed"}`}>
                    {criterion.met ? "✓" : "✗"}
                  </span>
                  <div className="adam-stack" style={{ gap: 2 }}>
                    <div className="adam-body">{criterion.criterion}</div>
                    {criterion.evidence ? (
                      <div className="adam-micro adam-muted">{criterion.evidence}</div>
                    ) : null}
                  </div>
                </div>
              )) : (
                <div className="adam-list-item adam-body adam-muted">No explicit exit criteria were defined for this phase.</div>
              )}
            </div>
          </div>

          <div className="adam-list-item" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="adam-micro adam-muted">Recommendation</div>
            <div className="mt-2 adam-body" style={{ fontStyle: "italic", color: "#dbe4f7" }}>
              {review.recommendation || "ATOS did not return a recommendation yet."}
            </div>
          </div>

          {review.status === "approved" ? (
            <div className="adam-gate-approved-stamp">
              Approved ✓ {review.approvedAt ? `· ${new Date(review.approvedAt).toLocaleDateString()}` : ""}
              {review.approvedBy ? ` · ${review.approvedBy}` : ""}
            </div>
          ) : null}

          {review.status === "remediation-requested" && review.remediationNote ? (
            <div className="adam-gate-remediation-banner">
              <div className="adam-micro adam-muted">Remediation requested</div>
              <div className="mt-2 adam-body">{review.remediationNote}</div>
            </div>
          ) : null}

          <div className="adam-row" style={{ flexWrap: "wrap" }}>
            <button
              type="button"
              className="adam-button"
              onClick={onApprove}
              disabled={!canApprove}
              title={!canApprove ? missingLabel : undefined}
            >
              {review.status === "approved" ? "Approved" : "Approve gate"}
            </button>
            <button
              type="button"
              className="adam-button-ghost"
              onClick={() => setShowRemediationForm((current) => !current)}
            >
              Request remediation
            </button>
          </div>

          {showRemediationForm ? (
            <div className="adam-stack" style={{ gap: 10 }}>
              <textarea
                className="adam-textarea min-h-[120px]"
                value={remediationNote}
                onChange={(event) => setRemediationNote(event.target.value)}
                placeholder="What needs to be tightened before this phase is approved?"
              />
              <div className="adam-row">
                <button
                  type="button"
                  className="adam-button-ghost"
                  onClick={() => {
                    if (!remediationNote.trim()) return;
                    onRequestRemediation(remediationNote.trim());
                    setRemediationNote("");
                    setShowRemediationForm(false);
                  }}
                  disabled={!remediationNote.trim()}
                >
                  Save remediation note
                </button>
                <button
                  type="button"
                  className="adam-button-ghost"
                  onClick={() => {
                    setRemediationNote("");
                    setShowRemediationForm(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
