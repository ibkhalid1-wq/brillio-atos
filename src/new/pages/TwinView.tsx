import React, { useMemo, useState } from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import { formatCurrency } from "@/new/lib/programData";
import type { ProgramSummary } from "@/new/types";
import {
  buildTwinDomains,
  summariseFidelity,
  buildPhaseSpine,
  projectScenario,
  EMPTY_SCENARIO,
  type TwinScenario,
  type TwinModel,
} from "@/v3/lib/twinProjection";

interface TwinViewProps {
  program: ProgramSummary | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readManualBudget(rawData: Record<string, unknown>) {
  const wrapper = asRecord(rawData);
  const nested = asRecord(wrapper.data);
  const inner = Object.keys(nested).length ? nested : wrapper;
  const budget = asRecord(inner.budget);
  const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const rawPhaseActuals = asRecord(budget.phaseActuals);
  const phaseActuals: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawPhaseActuals)) {
    if (typeof value === "number" && Number.isFinite(value)) phaseActuals[key] = value;
  }
  return {
    projectedCost: num(budget.projectedCost),
    actualSpend: num(budget.actualSpend),
    projectedBenefits: num(budget.projectedBenefits),
    phaseActuals,
  };
}

function domainTone(state: string): string {
  if (state === "modeled") return "green";
  if (state === "partial") return "amber";
  return "slate";
}

function ragColor(rag: string): string {
  if (rag === "green") return "var(--adam-green)";
  if (rag === "amber") return "var(--adam-amber)";
  if (rag === "red") return "var(--adam-red)";
  return "rgba(148,163,184,0.55)";
}

function Bar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ height: 6, borderRadius: 999, background: "rgba(148,163,184,0.22)", overflow: "hidden" }}>
      <div style={{ width: `${clamped}%`, height: "100%", background: color, borderRadius: 999 }} />
    </div>
  );
}

export function TwinView({ program }: TwinViewProps) {
  const [scenario, setScenario] = useState<TwinScenario>(EMPTY_SCENARIO);

  const manual = useMemo(() => readManualBudget(program?.rawData || {}), [program?.id, program?.rawData]);

  const budget = program?.budgetTracking ?? null;
  const projectedCost = budget?.projectedCost ?? manual.projectedCost;
  const actualSpend = budget?.actualSpend ?? manual.actualSpend;
  const projectedBenefits = budget?.projectedBenefits ?? manual.projectedBenefits;

  const domains = useMemo(
    () =>
      program
        ? buildTwinDomains({
            narrative: program.narrative,
            plan: program.plan,
            milestones: program.milestones,
            budgetTracking: program.budgetTracking,
            criticalPath: program.criticalPath,
            stakeholders: program.stakeholders,
            healthHeatmap: program.healthHeatmap,
            raidEntries: program.raidEntries,
          })
        : [],
    [program],
  );
  const fidelity = useMemo(() => summariseFidelity(domains), [domains]);

  const spine = useMemo(
    () =>
      program
        ? buildPhaseSpine({
            phases: program.phases,
            healthPhases: program.healthHeatmap?.phaseHealth ?? [],
            raidEntries: program.raidEntries.map((entry) => ({ phase: entry.phase, status: entry.status })),
            workstreams: (program.workstreams ?? []).map((workstream) => ({ phaseId: workstream.phaseId })),
            projectedCost,
            phaseActuals: manual.phaseActuals,
          })
        : [],
    [program, projectedCost, manual.phaseActuals],
  );

  const model: TwinModel = useMemo(
    () => ({
      phases: (program?.phases ?? []).map((phase) => ({ id: phase.id, pct: phase.pct })),
      workstreams: (program?.workstreams ?? []).map((workstream) => ({
        id: workstream.id,
        phaseId: workstream.phaseId,
        weight: workstream.weight,
        pct: workstream.pct,
      })),
      milestones: (program?.milestones ?? []).map((milestone) => ({
        id: milestone.id,
        title: milestone.title,
        phaseId: milestone.phaseId,
      })),
      projectedCost,
      actualSpend,
      projectedBenefits,
    }),
    [program, projectedCost, actualSpend, projectedBenefits],
  );

  const projection = useMemo(() => projectScenario(model, scenario), [model, scenario]);

  if (!program) {
    return (
      <NotReadyCard
        title="Digital twin"
        reason="No active program. Connect Supabase and select a program to begin."
      />
    );
  }

  const workstreams = program.workstreams ?? [];
  const hasScenario =
    projection.scheduleSlipWeeks > 0 ||
    scenario.droppedWorkstreamIds.length > 0 ||
    scenario.budgetDeltaPct !== 0;

  const completionDelta =
    projection.baselineCompletionPct !== null && projection.projectedCompletionPct !== null
      ? projection.projectedCompletionPct - projection.baselineCompletionPct
      : null;

  const overallRag = program.healthHeatmap?.overallRag ?? "grey";

  const setDelay = (phaseId: string, value: string) => {
    const weeks = Number(value);
    setScenario((current) => {
      const next = { ...current.phaseDelaysWeeks };
      if (!value || !Number.isFinite(weeks) || weeks <= 0) delete next[phaseId];
      else next[phaseId] = weeks;
      return { ...current, phaseDelaysWeeks: next };
    });
  };

  const toggleWorkstream = (id: string) => {
    setScenario((current) => {
      const dropped = current.droppedWorkstreamIds.includes(id)
        ? current.droppedWorkstreamIds.filter((existing) => existing !== id)
        : [...current.droppedWorkstreamIds, id];
      return { ...current, droppedWorkstreamIds: dropped };
    });
  };

  return (
    <div className="adam-stack" style={{ maxWidth: 1040 }}>
      {/* ── Twin header: fidelity + health ─────────────────────────────── */}
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-heading-xl">Digital Twin</div>
            <div className="adam-body adam-muted">
              A live model of the program you can run scenarios against. Nothing here changes the real program.
            </div>
          </div>
          <div className="adam-stack" style={{ gap: 4, alignItems: "flex-end" }}>
            <div className="adam-heading-lg">{Math.round(fidelity.score * 100)}%</div>
            <div className="adam-micro adam-muted">twin fidelity</div>
            <span className={`adam-badge ${overallRag === "green" ? "green" : overallRag === "amber" ? "amber" : overallRag === "red" ? "red" : "slate"}`}>
              {overallRag === "grey" ? "health pending" : `${overallRag} health`}
            </span>
          </div>
        </div>

        <div className="adam-row" style={{ gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          {domains.map((domain) => (
            <span key={domain.key} className={`adam-badge ${domainTone(domain.state)}`} title={domain.state}>
              {domain.label}
            </span>
          ))}
        </div>
        <div className="adam-micro adam-muted" style={{ marginTop: 10 }}>
          {fidelity.modeled} modeled · {fidelity.partial} partial · {fidelity.empty} not yet modeled
        </div>
      </section>

      {/* ── Phase spine: live mirror ───────────────────────────────────── */}
      <section className="adam-card p-5">
        <div className="adam-title">Phase spine</div>
        <div className="adam-micro adam-muted">
          Current state per phase — completion, health, cost posture, open RAID and workstream load.
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 16, overflowX: "auto", paddingBottom: 4 }}>
          {spine.map((node) => (
            <div
              key={node.phaseId}
              className="adam-list-item"
              style={{ minWidth: 190, flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 8 }}
            >
              <div className="adam-row adam-space-between" style={{ alignItems: "center", gap: 6 }}>
                <span className="adam-body" style={{ fontWeight: 600 }}>{node.phaseName}</span>
                <span
                  aria-label={`${node.rag} health`}
                  style={{ width: 10, height: 10, borderRadius: 999, background: ragColor(node.rag), flex: "0 0 auto" }}
                />
              </div>
              <Bar pct={node.pct} color={ragColor(node.rag === "grey" ? "green" : node.rag)} />
              <div className="adam-micro adam-muted">{Math.round(node.pct)}% · {node.status}</div>
              <div className="adam-micro adam-muted">
                {node.estimatedCost !== null ? `Est ${formatCurrency(node.estimatedCost)}` : "Est —"}
                {" · "}
                <span
                  style={
                    node.costStatus === "over"
                      ? { color: "var(--adam-red)" }
                      : node.costStatus === "under"
                        ? { color: "var(--adam-green)" }
                        : undefined
                  }
                >
                  {node.actualCost !== null ? `Act ${formatCurrency(node.actualCost)}` : "Act —"}
                </span>
              </div>
              <div className="adam-row" style={{ gap: 6, flexWrap: "wrap" }}>
                {node.openRaidCount > 0 ? (
                  <span className="adam-badge red">{node.openRaidCount} RAID</span>
                ) : null}
                {node.workstreamCount > 0 ? (
                  <span className="adam-badge slate">{node.workstreamCount} WS</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Signal rails ───────────────────────────────────────────────── */}
      <section className="adam-grid two" style={{ alignItems: "start" }}>
        <div className="adam-card p-5">
          <div className="adam-title">Momentum &amp; critical path</div>
          <div className="adam-stack" style={{ gap: 10, marginTop: 12 }}>
            <div className="adam-row adam-space-between">
              <span className="adam-micro adam-muted">Program momentum</span>
              <span className="adam-body" style={{ textTransform: "capitalize" }}>
                {program.healthHeatmap?.programMomentum ?? "unknown"}
              </span>
            </div>
            <div className="adam-row adam-space-between">
              <span className="adam-micro adam-muted">Health trend</span>
              <span className="adam-body" style={{ textTransform: "capitalize" }}>
                {program.healthHeatmap?.trend ?? "unknown"}
              </span>
            </div>
            <div className="adam-row adam-space-between">
              <span className="adam-micro adam-muted">Est. completion delta</span>
              <span className="adam-body">{program.criticalPath?.estimatedCompletionDelta ?? "—"}</span>
            </div>
            {program.criticalPath?.currentBottleneck ? (
              <div
                className="adam-list-item"
                style={{ borderColor: "rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)" }}
              >
                <div className="adam-micro" style={{ color: "var(--adam-red)", fontWeight: 600 }}>Bottleneck</div>
                <div className="adam-body" style={{ marginTop: 4 }}>
                  {program.criticalPath.currentBottleneck.phaseName}
                </div>
                <div className="adam-micro adam-muted" style={{ marginTop: 2 }}>
                  {program.criticalPath.currentBottleneck.reason}
                </div>
              </div>
            ) : (
              <div className="adam-micro adam-muted">No active bottleneck on the critical path.</div>
            )}
          </div>
        </div>

        <div className="adam-card p-5">
          <div className="adam-title">Value &amp; stakeholders</div>
          <div className="adam-stack" style={{ gap: 10, marginTop: 12 }}>
            <div className="adam-row adam-space-between">
              <span className="adam-micro adam-muted">Projected benefits</span>
              <span className="adam-body">{projectedBenefits !== null ? formatCurrency(projectedBenefits) : "—"}</span>
            </div>
            <div className="adam-row adam-space-between">
              <span className="adam-micro adam-muted">Realised benefits</span>
              <span className="adam-body">
                {budget?.realisedBenefits != null ? formatCurrency(budget.realisedBenefits) : "—"}
              </span>
            </div>
            <div className="adam-row adam-space-between">
              <span className="adam-micro adam-muted">Stakeholders tracked</span>
              <span className="adam-body">{program.stakeholders.length}</span>
            </div>
            <div className="adam-row adam-space-between">
              <span className="adam-micro adam-muted">At risk of disengaging</span>
              <span className="adam-body">
                {program.stakeholders.filter((s) => s.riskOfDisengagement === "high").length}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── What-if strip ──────────────────────────────────────────────── */}
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="adam-title">What-if simulation</div>
            <div className="adam-micro adam-muted">
              Model delays, descope, and budget change. Projections are read-only and never saved.
            </div>
          </div>
          {hasScenario ? (
            <button type="button" className="adam-button-ghost" onClick={() => setScenario(EMPTY_SCENARIO)}>
              Reset scenario
            </button>
          ) : null}
        </div>

        <div className="adam-grid two" style={{ marginTop: 16, gap: 24, alignItems: "start" }}>
          {/* Controls */}
          <div className="adam-stack" style={{ gap: 16 }}>
            <div className="adam-stack" style={{ gap: 8 }}>
              <span className="adam-micro adam-muted">Phase delay (weeks)</span>
              {program.phases.map((phase) => (
                <div key={phase.id} className="adam-row adam-space-between" style={{ gap: 8, alignItems: "center" }}>
                  <span className="adam-body">{phase.displayName}</span>
                  <input
                    className="adam-input"
                    type="number"
                    min={0}
                    style={{ width: 90 }}
                    value={scenario.phaseDelaysWeeks[phase.id] ?? ""}
                    onChange={(event) => setDelay(phase.id, event.target.value)}
                    placeholder="0"
                  />
                </div>
              ))}
            </div>

            <div className="adam-stack" style={{ gap: 8 }}>
              <span className="adam-micro adam-muted">Budget change ({scenario.budgetDeltaPct > 0 ? "+" : ""}{scenario.budgetDeltaPct}%)</span>
              <input
                type="range"
                min={-50}
                max={50}
                step={5}
                value={scenario.budgetDeltaPct}
                onChange={(event) => setScenario((current) => ({ ...current, budgetDeltaPct: Number(event.target.value) }))}
              />
            </div>

            {workstreams.length ? (
              <div className="adam-stack" style={{ gap: 8 }}>
                <span className="adam-micro adam-muted">Descope workstreams</span>
                {workstreams.map((workstream) => {
                  const dropped = scenario.droppedWorkstreamIds.includes(workstream.id);
                  return (
                    <label key={workstream.id} className="adam-row" style={{ gap: 8, alignItems: "center" }}>
                      <input type="checkbox" checked={dropped} onChange={() => toggleWorkstream(workstream.id)} />
                      <span className="adam-body" style={dropped ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                        {workstream.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* Projected outputs */}
          <div className="adam-stack" style={{ gap: 12 }}>
            <div className="adam-list-item">
              <div className="adam-micro adam-muted">Schedule slip</div>
              <div className="adam-heading-lg">
                {projection.scheduleSlipWeeks > 0 ? `+${projection.scheduleSlipWeeks} wk` : "No slip"}
              </div>
            </div>
            <div className="adam-list-item">
              <div className="adam-micro adam-muted">Delivered scope</div>
              <div className="adam-heading-lg">
                {projection.projectedCompletionPct !== null ? `${Math.round(projection.projectedCompletionPct)}%` : "—"}
                {completionDelta !== null && Math.abs(completionDelta) >= 0.5 ? (
                  <span className={`adam-badge ${completionDelta >= 0 ? "green" : "red"}`} style={{ marginLeft: 8 }}>
                    {completionDelta >= 0 ? "+" : ""}{Math.round(completionDelta)} pts
                  </span>
                ) : null}
              </div>
            </div>
            <div className="adam-list-item">
              <div className="adam-micro adam-muted">Projected cost</div>
              <div className="adam-heading-lg">
                {projection.projectedCost !== null ? formatCurrency(projection.projectedCost) : "—"}
                {projection.costUtilization !== null ? (
                  <span className="adam-micro adam-muted" style={{ marginLeft: 8 }}>
                    {Math.round(projection.costUtilization * 100)}% used
                  </span>
                ) : null}
              </div>
            </div>
            <div className="adam-list-item">
              <div className="adam-micro adam-muted">Value at risk</div>
              <div className="adam-heading-lg">
                {projection.valueAtRisk !== null ? formatCurrency(projection.valueAtRisk) : "—"}
              </div>
              {projection.atRiskMilestones.length ? (
                <div className="adam-micro adam-muted" style={{ marginTop: 4 }}>
                  {projection.atRiskMilestones.length} milestone{projection.atRiskMilestones.length === 1 ? "" : "s"} exposed
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
