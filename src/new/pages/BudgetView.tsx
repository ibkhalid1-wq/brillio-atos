import React, { useEffect, useMemo, useState } from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import { formatCurrency } from "@/new/lib/programData";
import type { BenefitMilestone, BudgetTracking, ProgramSummary } from "@/new/types";
import {
  costVariance,
  benefitRealization,
  netValue,
  isMilestoneOverdue,
  summariseMilestones,
  sortMilestonesByTarget,
  derivePhaseSpendRows,
  sumPhaseActuals,
} from "@/v3/lib/budgetMetrics";

interface BudgetViewProps {
  program: ProgramSummary | null;
  budgetIsRunning: boolean;
  onTriggerBudget: () => void;
  onSaveBudgetInputs: (patch: {
    projectedCost: number | null;
    actualSpend: number | null;
    projectedBenefits: number | null;
    realisedBenefits: number | null;
    phaseActuals?: Record<string, number>;
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
  const rawPhaseActuals = asRecord(budget.phaseActuals);
  const phaseActuals: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawPhaseActuals)) {
    if (typeof value === "number" && Number.isFinite(value)) phaseActuals[key] = value;
  }
  return {
    projectedCost: typeof budget.projectedCost === "number" ? budget.projectedCost : null,
    actualSpend: typeof budget.actualSpend === "number" ? budget.actualSpend : null,
    projectedBenefits: typeof budget.projectedBenefits === "number" ? budget.projectedBenefits : null,
    realisedBenefits: typeof budget.realisedBenefits === "number" ? budget.realisedBenefits : null,
    phaseActuals,
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

function benefitStatusBadge(status: BenefitMilestone["status"]) {
  if (status === "realised") return "green";
  if (status === "at-risk") return "amber";
  return "slate";
}

function MeterBar({ ratio, tone }: { ratio: number; tone: "green" | "amber" | "red" }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  const color = tone === "red" ? "var(--adam-red)" : tone === "amber" ? "var(--adam-amber)" : "var(--adam-green)";
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ height: 8, borderRadius: 999, background: "rgba(148,163,184,0.22)", overflow: "hidden" }}
    >
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 999 }} />
    </div>
  );
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
  const [phaseActuals, setPhaseActuals] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const [key, value] of Object.entries(initialInputs.phaseActuals)) seed[key] = value.toString();
    return seed;
  });

  useEffect(() => {
    setInputs({
      projectedCost: initialInputs.projectedCost?.toString() || "",
      actualSpend: initialInputs.actualSpend?.toString() || "",
      projectedBenefits: initialInputs.projectedBenefits?.toString() || "",
      realisedBenefits: initialInputs.realisedBenefits?.toString() || "",
    });
    const seed: Record<string, string> = {};
    for (const [key, value] of Object.entries(initialInputs.phaseActuals)) seed[key] = value.toString();
    setPhaseActuals(seed);
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
  const cost = budget ? costVariance(budget) : null;
  const realization = budget ? benefitRealization(budget) : null;
  const net = budget ? netValue(budget) : null;
  const milestoneSummary = budget ? summariseMilestones(budget.benefitMilestones) : null;
  const sortedMilestones = budget ? sortMilestonesByTarget(budget.benefitMilestones) : [];

  const toNumberOrNull = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && value !== "" ? parsed : null;
  };
  const projectedCostNum = toNumberOrNull(inputs.projectedCost);
  const phaseActualsNum = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(phaseActuals)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && value !== "") out[key] = parsed;
    }
    return out;
  }, [phaseActuals]);
  const phaseRows = derivePhaseSpendRows(
    projectedCostNum,
    program.phases.map((phase) => ({ id: phase.id, displayName: phase.displayName })),
    phaseActualsNum,
  );
  const totalEnteredActual = sumPhaseActuals(phaseActualsNum);
  const anyPhaseEntered = Object.keys(phaseActualsNum).length > 0;

  const saveInputs = async () => {
    await onSaveBudgetInputs({
      projectedCost: projectedCostNum,
      actualSpend: anyPhaseEntered ? totalEnteredActual : toNumberOrNull(inputs.actualSpend),
      projectedBenefits: toNumberOrNull(inputs.projectedBenefits),
      realisedBenefits: toNumberOrNull(inputs.realisedBenefits),
      phaseActuals: phaseActualsNum,
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

          <section className="adam-card p-5">
            <div className="adam-title">Cost &amp; value tracking</div>
            <div className="adam-grid two" style={{ marginTop: 16, gap: 24, alignItems: "start" }}>
              <div className="adam-stack" style={{ gap: 8 }}>
                <div className="adam-row adam-space-between" style={{ alignItems: "center" }}>
                  <span className="adam-micro adam-muted">Budget utilization</span>
                  {cost && cost.kind === "known" ? (
                    <span className={`adam-badge ${cost.status === "over" ? "red" : cost.status === "under" ? "green" : "slate"}`}>
                      {cost.status === "over"
                        ? `${formatCurrency(Math.abs(cost.variance))} over`
                        : cost.status === "under"
                          ? `${formatCurrency(cost.variance)} under`
                          : "on budget"}
                    </span>
                  ) : null}
                </div>
                {cost && cost.kind === "known" ? (
                  <>
                    <MeterBar ratio={cost.utilization} tone={cost.status === "over" ? "red" : cost.status === "under" ? "green" : "amber"} />
                    <div className="adam-micro adam-muted">
                      {formatCurrency(cost.spent)} of {formatCurrency(cost.budgeted)} spent · {Math.round(cost.utilization * 100)}%
                    </div>
                  </>
                ) : (
                  <div className="adam-body adam-muted">Add projected cost and actual spend below to track utilization.</div>
                )}
              </div>

              <div className="adam-stack" style={{ gap: 8 }}>
                <div className="adam-row adam-space-between" style={{ alignItems: "center" }}>
                  <span className="adam-micro adam-muted">Benefit realization</span>
                  {net !== null ? (
                    <span className={`adam-badge ${net >= 0 ? "green" : "red"}`}>
                      {net >= 0 ? `${formatCurrency(net)} net value` : `${formatCurrency(Math.abs(net))} net cost`}
                    </span>
                  ) : null}
                </div>
                {realization && realization.kind === "known" ? (
                  <>
                    <MeterBar ratio={realization.ratio} tone={realization.ratio >= 0.75 ? "green" : realization.ratio >= 0.4 ? "amber" : "red"} />
                    <div className="adam-micro adam-muted">
                      {formatCurrency(realization.realised)} of {formatCurrency(realization.projected)} captured · {Math.round(realization.ratio * 100)}%
                    </div>
                  </>
                ) : (
                  <div className="adam-body adam-muted">Add projected and realised benefits below to track value capture.</div>
                )}
              </div>
            </div>
          </section>

          <section className="adam-card p-5">
            <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div className="adam-title">Phase spend</div>
                <div className="adam-micro adam-muted">
                  Estimated cost splits the projected budget evenly across phases. Enter actual spend per phase to track variance.
                </div>
              </div>
              {anyPhaseEntered ? (
                <span className="adam-badge slate">{formatCurrency(totalEnteredActual)} entered</span>
              ) : null}
            </div>
            <div className="mt-4 adam-list">
              {phaseRows.map((row) => (
                <div key={row.phaseId} className="adam-list-item">
                  <div className="adam-row adam-space-between" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div className="adam-stack" style={{ gap: 4, minWidth: 160, flex: 1 }}>
                      <div className="adam-body">{row.phaseName}</div>
                      <div className="adam-micro adam-muted">
                        Est. {row.estimated !== null ? formatCurrency(row.estimated) : "—"}
                      </div>
                    </div>
                    <div className="adam-stack" style={{ gap: 4, width: 160 }}>
                      <label className="adam-micro adam-muted">Actual spend</label>
                      <input
                        className="adam-input"
                        type="number"
                        value={phaseActuals[row.phaseId] ?? ""}
                        onChange={(event) => {
                          const next = event.target.value;
                          setPhaseActuals((current) => ({ ...current, [row.phaseId]: next }));
                        }}
                        placeholder="0"
                      />
                    </div>
                    <div style={{ width: 96, textAlign: "right" }}>
                      {row.status !== "unknown" && row.variance !== null ? (
                        <span className={`adam-badge ${row.status === "over" ? "red" : row.status === "under" ? "green" : "slate"}`}>
                          {row.status === "over"
                            ? `${formatCurrency(Math.abs(row.variance))} over`
                            : row.status === "under"
                              ? `${formatCurrency(row.variance)} under`
                              : "on budget"}
                        </span>
                      ) : (
                        <span className="adam-micro adam-muted">—</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div
              className="adam-row adam-space-between"
              style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(148,163,184,0.22)" }}
            >
              <span className="adam-micro adam-muted">
                Total estimated {projectedCostNum !== null ? formatCurrency(projectedCostNum) : "—"}
              </span>
              <span className="adam-micro adam-muted">Total entered {formatCurrency(totalEnteredActual)}</span>
            </div>
          </section>

          <section className="adam-card p-5">
            <div className="adam-title">Budget inputs</div>
            <div className="mt-2 adam-body adam-muted">
              These values are stored as program context and fed back into the Budget Agent on the next run.
              Actual spend is rolled up from the phase entries above.
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
          </section>

          <section className="adam-card p-5">
            <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div className="adam-title">Benefit milestones</div>
                <div className="adam-micro adam-muted">Where value is expected to land across the program.</div>
              </div>
              {milestoneSummary && milestoneSummary.total ? (
                <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  {milestoneSummary.overdue ? (
                    <span className="adam-badge red">{milestoneSummary.overdue} overdue</span>
                  ) : null}
                  {milestoneSummary.atRisk ? (
                    <span className="adam-badge amber">{milestoneSummary.atRisk} at risk</span>
                  ) : null}
                  {milestoneSummary.realised ? (
                    <span className="adam-badge green">{milestoneSummary.realised} realised</span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="adam-budget-timeline">
              {sortedMilestones.length ? sortedMilestones.map((milestone) => {
                const overdue = isMilestoneOverdue(milestone);
                return (
                  <div
                    key={milestone.id}
                    className="adam-budget-timeline-card"
                    style={overdue ? { borderColor: "rgba(220,38,38,0.35)", background: "rgba(220,38,38,0.06)" } : undefined}
                  >
                    <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 8 }}>
                      <span className={`adam-badge ${overdue ? "red" : benefitStatusBadge(milestone.status)}`}>
                        {overdue ? "overdue" : milestone.status.replace("-", " ")}
                      </span>
                      <span className={`adam-micro ${overdue ? "" : "adam-muted"}`} style={overdue ? { color: "var(--adam-red)" } : undefined}>
                        {milestone.targetDate ? new Date(milestone.targetDate).toLocaleDateString() : "TBD"}
                      </span>
                    </div>
                    <div className="mt-3 adam-body">{milestone.title}</div>
                    <div className="mt-2 adam-micro adam-muted">
                      {milestone.estimatedValue} · {program.phases.find((phase) => phase.id === milestone.phaseId)?.displayName || milestone.phaseId}
                    </div>
                  </div>
                );
              }) : (
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
