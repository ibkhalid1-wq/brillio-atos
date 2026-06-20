import { useState } from "react";
import { FormattedDocument } from "@/components/FormattedDocument";

interface ExitCriterion {
  criterion: string;
  artifactEvidence: Array<{ artifactId: string; excerpt: string }>;
  fieldEvidence: Array<{ fieldId: string; value: string }>;
  status: "pending" | "met" | "not_met" | "partial";
}

interface GatePackage {
  phaseId: string;
  gateReadiness: number;
  exitCriteria: ExitCriterion[];
  blockers: string[];
  approvedArtifacts: string[];
  missingArtifacts: string[];
  approvalWorkflow: any | null;
  briefing: string | null;
  openRAID: any[];
  reviewStartedAt: string;
}

interface GateReviewViewProps {
  pkg: GatePackage;
  onCriterionUpdate: (index: number, status: ExitCriterion["status"]) => void;
  onPassGate: (notes: string) => void;
  onFailGate: (reason: string) => void;
  onClose: () => void;
}

const STATUS_CONFIG = {
  pending: { label: "Pending", bg: "#f3f4f6", color: "#6b7280", border: "#e5e7eb" },
  met: { label: "Met", bg: "#dcfce7", color: "#14532d", border: "#86efac" },
  partial: { label: "Partial", bg: "#fef3c7", color: "#92400e", border: "#fde68a" },
  not_met: { label: "Not Met", bg: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
};

export function GateReviewView({ pkg, onCriterionUpdate, onPassGate, onFailGate, onClose }: GateReviewViewProps) {
  const [step, setStep] = useState(0);
  const [notes, setNotes] = useState("");
  const [criteria, setCriteria] = useState<ExitCriterion[]>(pkg.exitCriteria);
  const totalSteps = criteria.length + 2;
  const approvalPending = pkg.approvalWorkflow && pkg.approvalWorkflow.status !== "approved";

  const updateCriterion = (index: number, status: ExitCriterion["status"]) => {
    setCriteria((prev) => prev.map((criterion, criterionIndex) => (
      criterionIndex === index ? { ...criterion, status } : criterion
    )));
    onCriterionUpdate(index, status);
  };

  const metCount = criteria.filter((criterion) => criterion.status === "met").length;
  const notMetCount = criteria.filter((criterion) => criterion.status === "not_met").length;
  const partialCount = criteria.filter((criterion) => criterion.status === "partial").length;
  const allReviewed = criteria.every((criterion) => criterion.status !== "pending");
  const canPass = allReviewed && notMetCount === 0 && !approvalPending;
  const progress = Math.round((step / Math.max(totalSteps - 1, 1)) * 100);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "white", borderRadius: 16, width: 680, maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ background: "#1e3a5f", color: "white", padding: "16px 24px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Gate Review — {pkg.phaseId}</div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
              Step {Math.min(step + 1, totalSteps)} of {totalSteps} · {pkg.gateReadiness}% readiness
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "white", fontSize: 20, cursor: "pointer", opacity: 0.7 }}>×</button>
        </div>

        <div style={{ height: 3, background: "#e5e7eb" }}>
          <div style={{ width: `${progress}%`, height: "100%", background: "#2563eb", transition: "width 0.3s" }} />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {step === 0 ? (
            <div>
              <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Phase Briefing</h3>
              {pkg.briefing ? (
                <FormattedDocument content={pkg.briefing} compact />
              ) : (
                <p style={{ color: "#9ca3af", fontSize: 13 }}>No briefing generated yet. Proceed to review exit criteria.</p>
              )}
              {approvalPending ? (
                <div style={{ marginTop: 12, padding: 12, background: "#fef3c7", borderRadius: 8, fontSize: 12, color: "#92400e" }}>
                  Gate signatory approval is still pending. You can complete the review now, but the gate cannot pass until approvals are complete.
                </div>
              ) : null}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 16 }}>
                {[
                  { label: "Approved Artifacts", value: pkg.approvedArtifacts.length, color: "#16a34a" },
                  { label: "Missing Artifacts", value: pkg.missingArtifacts.length, color: pkg.missingArtifacts.length > 0 ? "#d97706" : "#16a34a" },
                  { label: "Open RAID Items", value: pkg.openRAID.length, color: pkg.openRAID.length > 0 ? "#dc2626" : "#16a34a" },
                ].map((kpi) => (
                  <div key={kpi.label} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{kpi.label}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {step >= 1 && step <= criteria.length ? (() => {
            const criterion = criteria[step - 1];
            return (
              <div>
                <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>Exit Criterion {step} of {criteria.length}</div>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, lineHeight: 1.5 }}>{criterion.criterion}</h3>

                {criterion.fieldEvidence.length > 0 ? (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", marginBottom: 6 }}>Field Evidence</div>
                    {criterion.fieldEvidence.map((evidence) => (
                      <div key={evidence.fieldId} style={{ padding: 8, background: "#f9fafb", borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                        <strong>{evidence.fieldId}:</strong> {evidence.value}
                      </div>
                    ))}
                  </div>
                ) : null}

                {criterion.artifactEvidence.length > 0 ? (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", marginBottom: 6 }}>Artifact Evidence</div>
                    {criterion.artifactEvidence.map((evidence) => (
                      <div key={evidence.artifactId} style={{ padding: 8, background: "#f0fdf4", borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                        <strong>{evidence.artifactId}:</strong> {evidence.excerpt}...
                      </div>
                    ))}
                  </div>
                ) : null}

                <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 8 }}>Mark this criterion:</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["met", "partial", "not_met"] as const).map((status) => {
                    const cfg = STATUS_CONFIG[status];
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => updateCriterion(step - 1, status)}
                        style={{
                          flex: 1,
                          padding: "10px 8px",
                          borderRadius: 8,
                          border: "2px solid",
                          borderColor: criterion.status === status ? cfg.border : "#e5e7eb",
                          background: criterion.status === status ? cfg.bg : "white",
                          color: criterion.status === status ? cfg.color : "#6b7280",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: criterion.status === status ? 700 : 400,
                        }}
                      >
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })() : null}

          {step === totalSteps - 1 ? (
            <div>
              <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>Review Summary</h3>
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                {[
                  { label: "Criteria Met", value: metCount, color: "#16a34a", bg: "#dcfce7" },
                  { label: "Partial", value: partialCount, color: "#d97706", bg: "#fef3c7" },
                  { label: "Not Met", value: notMetCount, color: "#dc2626", bg: "#fee2e2" },
                ].map((kpi) => (
                  <div key={kpi.label} style={{ flex: 1, border: "1px solid", borderColor: kpi.color, borderRadius: 8, padding: 12, textAlign: "center", background: kpi.bg }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
                    <div style={{ fontSize: 11, color: kpi.color }}>{kpi.label}</div>
                  </div>
                ))}
              </div>

              {pkg.blockers.length > 0 ? (
                <div style={{ marginBottom: 16, padding: 12, background: "#fef3c7", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Open Blockers</div>
                  {pkg.blockers.map((blocker, index) => <div key={`${blocker}-${index}`} style={{ fontSize: 12, color: "#92400e" }}>• {blocker}</div>)}
                </div>
              ) : null}

              {approvalPending ? (
                <div style={{ marginBottom: 16, padding: 12, background: "#eff6ff", borderRadius: 8, fontSize: 12, color: "#1d4ed8" }}>
                  Approval workflow status: {pkg.approvalWorkflow?.status}. Complete the outstanding signatory approvals before passing the gate.
                </div>
              ) : null}

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>Review notes</label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Add any notes for the record..."
                  style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13, minHeight: 80, boxSizing: "border-box" }}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ padding: "14px 24px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fafafa" }}>
          <button
            type="button"
            onClick={() => setStep((value) => Math.max(0, value - 1))}
            disabled={step === 0}
            style={{ padding: "7px 16px", borderRadius: 6, border: "1px solid #d1d5db", cursor: step === 0 ? "default" : "pointer", opacity: step === 0 ? 0.4 : 1, fontSize: 13 }}
          >
            ← Back
          </button>

          <div style={{ fontSize: 11, color: "#9ca3af" }}>
            {criteria.filter((criterion) => criterion.status !== "pending").length}/{criteria.length} criteria reviewed
          </div>

          {step < totalSteps - 1 ? (
            <button
              type="button"
              onClick={() => setStep((value) => value + 1)}
              style={{ padding: "7px 16px", borderRadius: 6, background: "#2563eb", color: "white", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
            >
              Next →
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => onFailGate(notes)}
                style={{ padding: "7px 16px", borderRadius: 6, background: "#dc2626", color: "white", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
              >
                Fail Gate
              </button>
              <button
                type="button"
                onClick={() => {
                  if (canPass) onPassGate(notes);
                }}
                disabled={!canPass}
                style={{ padding: "7px 16px", borderRadius: 6, background: canPass ? "#16a34a" : "#9ca3af", color: "white", border: "none", cursor: canPass ? "pointer" : "default", fontSize: 13, fontWeight: 600 }}
                title={!canPass ? "All criteria must be Met and signatory approvals completed before passing." : ""}
              >
                Pass Gate ✓
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
