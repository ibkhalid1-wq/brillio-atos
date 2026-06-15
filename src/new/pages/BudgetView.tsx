import React, { useEffect, useMemo, useState } from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import { formatCurrency } from "@/new/lib/programData";
import type { BenefitMilestone, BudgetTracking, ProgramSummary } from "@/new/types";

interface BudgetViewProps {
  program: ProgramSummary | null;
  budgetIsRunning: boolean;
  onTriggerBudget: () => void;
  onSaveBudgetInputs: (patch: {
    projectedCost: number | null;
    actualSpend: number | null;
    projectedBenefits: number | null;
    realisedBenefits: number | null;
  }) => Promise<void> | void;
  savePending?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseBudgetInputs(rawData: Record<string, unknown>) {
  const wrapper = asRecord(rawData);
  const nested = asRecord(wrapper.data);
  const inner = Object.keys(nested).length ? nested : wrapper;
  const budget = asRecord(inner.budget);
  return {
    projectedCost: typeof budget.projectedCost === "number" ? budget.projectedCost : null,
    actualSpend: typeof budget.actualSpend === "number" ? budget.actualSpend : null,
    projectedBenefits: typeof budget.projectedBenefits === "number" ? budget.projectedBenefits : null,
    realisedBenefits: typeof budget.realisedBenefits === "number" ? budget.realisedBenefits : null,
  };
}

function signalBadge(signal: BudgetTracking["healthSignal"] | null | undefined) {
  if (signal === "green") return "green";
  if (signal === "amber") return "amber";
  return "red";
}

function roiLabel(roi: number | null): string {
  if (roi === null || !Number.isFinite(roi)) return "ROI pending";
  return `${roi.toFixed(1)}x return`;
}

function phaseStatusBadge(status: string) {
  if (status === "on-budget" || status === "underspend") return "green";
  if (status === "overspend") return "red";
  return "slate";
}

function benefitStatusBadge(status: BenefitMilestone["status"]) {
  if (status === "realised") return "green";
  if (status === "at-risk") return "amber";
  return "slate";
}

export function BudgetView({
  program,
  budgetIsRunning,
  onTriggerBudget,
  onSaveBudgetInputs,
  savePending = false,
}: BudgetViewProps) {
  const initialInputs = useMemo(
    () => parseBudgetInputs(program?.rawData || {}),
    [program?.id, program?.rawData],
  );
  const [inputs, setInputs] = useState({
    projectedCost: initialInputs.projectedCost?.toString() || "",
    actualSpend: initialInputs.actualSpend?.toString() || "",
    projectedBenefits: initialInputs.projectedBenefits?.toString() || "",
    realisedBenefits: initialInputs.realisedBenefits?.toString() || "",
  });

  useEffect(() => {
    setInputs({
      projectedCost: initialInputs.projectedCost?.toString() || "",
      actualSpend: initialInputs.actualSpend?.toString() || "",
      projectedBenefits: initialInputs.projectedBenefits?.toString() || "",
      realisedBenefits: initialInputs.realisedBenefits?.toString() || "",
    });
  }, [initialInputs]);

  if (!program) {
    return (
      <NotReadyCard
        title="Budget & benefits"
        reason="No active program. Connect Supabase and select a program to begin."
      />
    );
  }

  const budget = program.budgetTracking;
  const saveInputs = async () => {
    const toNumber = (value: string) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && value !== "" ? parsed : null;
    };
    await onSaveBudgetInputs({
      projectedCost: toNumber(inputs.projectedCost),
      actualSpend: toNumber(inputs.actualSpend),
      projectedBenefits: toNumber(inputs.projectedBenefits),
      realisedBenefits: toNumber(inputs.realisedBenefits),
    });
  };

  return (
    <div className="adam-stack" style={{ maxWidth: 1040 }}>
      {budget ? (
        <>
          <section className="adam-card p-5">
            <div className="adam-row adam-space-between" style={{ alignItems: "flex-start" }}>
              <div className="adam-stack" style={{ gap: 6 }}>
                <div className="adam-heading-xl">Budget & Benefits</div>
                <div className="adam-body adam-muted">
                  ATOS is tracking financial health, value timing, and phase-level cost posture.
                </div>
                {program.budgetGeneratedAt ? (
                  <div className="adam-micro adam-muted">
                    Updated {new Date(program.budgetGeneratedAt).toLocaleString()}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="adam-button-ghost"
                onClick={onTriggerBudget}
                disabled={budgetIsRunning}
              >
                {budgetIsRunning ? "Re-assessing…" : "Re-assess with ATOS"}
              </button>
            </div>

            <div className="v3-budget-kpi-grid" style={{ marginTop: 20 }}>
              <div className="adam-kpi">
                <div className="adam-micro adam-muted">Burn rate</div>
                <div className="adam-heading-lg" style={{ textTransform: "capitalize" }}>{budget.burnRate.replace("-", " ")}</div>
                <span className={`adam-badge ${signalBadge(budget.healthSignal)}`}>{budget.healthSignal}</span>
              </div>
              <div className="adam-kpi">
                <div className="adam-micro adam-muted">Value delivery</div>
                <div className="adam-heading-lg" style={{ textTransform: "capitalize" }}>{budget.valueDeliveryRate.replace("-", " ")}</div>
                <div className="adam-body adam-muted">
                  {budget.realisedBenefits !== null
                    ? `${formatCurrency(budget.realisedBenefits)} realised`
                    : "Benefits not confirmed yet"}
                </div>
              </div>
              <div className="adam-kpi">
                <div className="adam-micro adam-muted">ROI outlook</div>
                <div className="adam-heading-lg">{roiLabel(budget.roi)}</div>
                <div className="adam-body adam-muted">
                  {budget.projectedBenefits !== null
                    ? `${formatCurrency(budget.projectedBenefits)} projected`
                    : "Projected value pending"}
                </div>
              </div>
              <div className="adam-kpi">
                <div className="adam-micro adam-muted">Health signal</div>
                <div className="adam-heading-lg">{Math.round(budget.confidence * 100)}% confidence</div>
                <span className={`adam-badge ${signalBadge(budget.healthSignal)}`}>{budget.healthSignal.toUpperCase()}</span>
              </div>
            </div>

            <div
              className="adam-list-item"
              style={{
                marginTop: 18,
                borderColor: budget.healthSignal === "green"
                  ? "rgba(22,163,74,0.25)"
                  : budget.healthSignal === "amber"
                    ? "rgba(217,119,6,0.25)"
                    : "rgba(220,38,38,0.25)",
                background: budget.healthSignal === "green"
                  ? "rgba(22,163,74,0.08)"
                  : budget.healthSignal === "amber"
                    ? "rgba(217,119,6,0.08)"
                    : "rgba(220,38,38,0.08)",
              }}
            >
              <div className="adam-title">Health signal</div>
              <div className="mt-2 adam-body">{budget.healthReason}</div>
            </div>
          </section>

          <section className="adam-grid two" style={{ alignItems: "start" }}>
            <div className="adam-card p-5">
              <div className="adam-title">Phase spend posture</div>
              <div className="mt-4 adam-list">
                {budget.phaseSpend.length ? budget.phaseSpend.map((phase) => (
                  <div key={phase.phaseId} className="adam-list-item">
                    <div className="adam-row adam-space-between" style={{ alignItems: "flex-start" }}>
                      <div className="adam-stack" style={{ gap: 4 }}>
                        <div className="adam-body">{phase.phaseName}</div>
                        <div className="adam-micro adam-muted">
                          Budgeted {phase.budgetedEffort || "TBD"} · Actual {phase.actualEffort || "TBD"}
                        </div>
                      </div>
                      <span className={`adam-badge ${phaseStatusBadge(phase.status)}`}>
                        {phase.status.replace("-", " ")}
                      </span>
                    </div>
                  </div>
                )) : (
                  <div className="adam-list-item adam-body adam-muted">No phase spend signals yet.</div>
                )}
              </div>
            </div>

            <div className="adam-card p-5">
              <div className="adam-title">Budget inputs</div>
              <div className="mt-2 adam-body adam-muted">
                These values are stored as program context and fed back into the Budget Agent on the next run.
              </div>
              <div className="adam-grid two" style={{ marginTop: 16 }}>
                <div className="adam-stack" style={{ gap: 6 }}>
                  <label className="adam-micro adam-muted">Projected cost</label>
                  <input
                    className="adam-input"
                    type="number"
                    value={inputs.projectedCost}
                    onChange={(event) => setInputs((current) => ({ ...current, projectedCost: event.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div className="adam-stack" style={{ gap: 6 }}>
                  <label className="adam-micro adam-muted">Actual spend</label>
                  <input
                    className="adam-input"
                    type="number"
                    value={inputs.actualSpend}
                    onChange={(event) => setInputs((current) => ({ ...current, actualSpend: event.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div className="adam-stack" style={{ gap: 6 }}>
                  <label className="adam-micro adam-muted">Projected benefits</label>
                  <input
                    className="adam-input"
                    type="number"
                    value={inputs.projectedBenefits}
                    onChange={(event) => setInputs((current) => ({ ...current, projectedBenefits: event.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div className="adam-stack" style={{ gap: 6 }}>
                  <label className="adam-micro adam-muted">Realised benefits</label>
                  <input
                    className="adam-input"
                    type="number"
                    value={inputs.realisedBenefits}
                    onChange={(event) => setInputs((current) => ({ ...current, realisedBenefits: event.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="adam-row" style={{ gap: 8, marginTop: 16 }}>
                <button
                  type="button"
                  className="adam-button"
                  onClick={() => void saveInputs()}
                  disabled={savePending}
                >
                  {savePending ? "Saving…" : "Save inputs"}
                </button>
                <button
                  type="button"
                  className="adam-button-ghost"
                  onClick={onTriggerBudget}
                  disabled={budgetIsRunning}
                >
                  {budgetIsRunning ? "Refreshing…" : "Refresh agent view"}
                </button>
              </div>
            </div>
          </section>

          <section className="adam-card p-5">
            <div className="adam-row adam-space-between" style={{ alignItems: "flex-start" }}>
              <div>
                <div className="adam-title">Benefit milestones</div>
                <div className="adam-micro adam-muted">Where value is expected to land across the program.</div>
              </div>
            </div>
            <div className="adam-budget-timeline">
              {budget.benefitMilestones.length ? budget.benefitMilestones.map((milestone) => (
                <div key={milestone.id} className="adam-budget-timeline-card">
                  <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 8 }}>
                    <span className={`adam-badge ${benefitStatusBadge(milestone.status)}`}>{milestone.status.replace("-", " ")}</span>
                    <span className="adam-micro adam-muted">
                      {milestone.targetDate ? new Date(milestone.targetDate).toLocaleDateString() : "TBD"}
                    </span>
                  </div>
                  <div className="mt-3 adam-body">{milestone.title}</div>
                  <div className="mt-2 adam-micro adam-muted">
                    {milestone.estimatedValue} · {program.phases.find((phase) => phase.id === milestone.phaseId)?.displayName || milestone.phaseId}
                  </div>
                </div>
              )) : (
                <div className="adam-list-item adam-body adam-muted">No benefit milestones identified yet.</div>
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          <NotReadyCard
            title="Budget & benefits"
            reason="Complete at least two phases to generate a budget assessment."
            onTrigger={onTriggerBudget}
            triggerLabel="Generate assessment"
            isRunning={budgetIsRunning}
          />
          <section className="adam-card p-5">
            <div className="adam-title">Seed budget inputs</div>
            <div className="mt-2 adam-body adam-muted">
              You can still give ATOS cost and benefits context now so the next assessment is grounded in real program economics.
            </div>
            <div className="adam-grid two" style={{ marginTop: 16 }}>
              <div className="adam-stack" style={{ gap: 6 }}>
                <label className="adam-micro adam-muted">Projected cost</label>
                <input
                  className="adam-input"
                  type="number"
                  value={inputs.projectedCost}
                  onChange={(event) => setInputs((current) => ({ ...current, projectedCost: event.target.value }))}
                />
              </div>
              <div className="adam-stack" style={{ gap: 6 }}>
                <label className="adam-micro adam-muted">Actual spend</label>
                <input
                  className="adam-input"
                  type="number"
                  value={inputs.actualSpend}
                  onChange={(event) => setInputs((current) => ({ ...current, actualSpend: event.target.value }))}
                />
              </div>
              <div className="adam-stack" style={{ gap: 6 }}>
                <label className="adam-micro adam-muted">Projected benefits</label>
                <input
                  className="adam-input"
                  type="number"
                  value={inputs.projectedBenefits}
                  onChange={(event) => setInputs((current) => ({ ...current, projectedBenefits: event.target.value }))}
                />
              </div>
              <div className="adam-stack" style={{ gap: 6 }}>
                <label className="adam-micro adam-muted">Realised benefits</label>
                <input
                  className="adam-input"
                  type="number"
                  value={inputs.realisedBenefits}
                  onChange={(event) => setInputs((current) => ({ ...current, realisedBenefits: event.target.value }))}
                />
              </div>
            </div>
            <div className="adam-row" style={{ gap: 8, marginTop: 16 }}>
              <button
                type="button"
                className="adam-button"
                onClick={() => void saveInputs()}
                disabled={savePending}
              >
                {savePending ? "Saving…" : "Save inputs"}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
