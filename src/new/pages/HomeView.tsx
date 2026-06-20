import React from "react";
import { NarrativeBlock } from "@/new/components/ui/NarrativeBlock";
import { PlanCard } from "@/new/components/ui/PlanCard";
import { ReadinessSignal } from "@/new/components/ui/ReadinessSignal";
import { DecisionItem } from "@/new/components/ui/DecisionItem";
import { EmptyState } from "@/new/components/ui/EmptyState";
import { ValueMeter } from "@/new/components/ui/ValueMeter";
import { EscalationBanner } from "@/new/components/ui/EscalationBanner";
import { HealthHeatmap } from "@/new/components/ui/HealthHeatmap";
import { formatCurrency } from "@/new/lib/programData";
import type { AgentCardModel, AppView, NudgeSummary, PlanSummary, ProgramSummary } from "@/new/types";
import { AgentPulse } from "@/new/components/ui/AgentPulse";

interface HomeViewProps {
  program: ProgramSummary | null;
  onRefreshNarrative: () => void;
  agentCards: AgentCardModel[];
  onNavigate: (view: AppView) => void;
  decisionCount: number;
  recommendedNudge?: NudgeSummary | null;
  narrativeIsRunning?: boolean;
  plan: PlanSummary | null;
  planGeneratedAt: string;
  planIsRunning?: boolean;
  onTriggerPlan: () => void;
  onAcknowledgeEscalation: (id: string) => void;
  onResolveEscalation: (id: string) => void;
  onDismissClosurePrompt: () => void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function timeAgo(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.round(deltaMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function TwinPreview({
  nodeCount,
  edgeCount,
  onOpen,
}: {
  nodeCount: number;
  edgeCount: number;
  onOpen: () => void;
}) {
  const circles = Array.from({ length: Math.min(nodeCount || 4, 8) }, (_, index) => ({
    x: 36 + index * 34,
    y: index % 2 === 0 ? 44 : 86,
  }));
  return (
    <div className="adam-card p-5">
      <div className="adam-row adam-space-between">
        <div className="adam-title">Twin preview</div>
        <button type="button" className="adam-button-ghost" onClick={onOpen}>
          Explore in Twin →
        </button>
      </div>
      <svg viewBox="0 0 320 130" className="mt-4 h-[150px] w-full rounded-2xl bg-white/5">
        {circles.slice(1).map((circle, index) => {
          const previous = circles[index];
          return (
            <path
              key={`${circle.x}-${circle.y}`}
              d={`M${previous.x} ${previous.y} C ${previous.x + 14} ${previous.y}, ${circle.x - 14} ${circle.y}, ${circle.x} ${circle.y}`}
              stroke="rgba(37,99,235,0.28)"
              strokeWidth="2"
              fill="none"
            />
          );
        })}
        {circles.map((circle, index) => (
          <g key={index}>
            <circle cx={circle.x} cy={circle.y} r="12" fill="rgba(37,99,235,0.18)" stroke="rgba(37,99,235,0.45)" />
            <circle cx={circle.x} cy={circle.y} r="4" fill="#60a5fa" />
          </g>
        ))}
      </svg>
      <div className="mt-3 adam-micro adam-muted">{nodeCount} nodes · {edgeCount} relationships</div>
    </div>
  );
}

function BudgetHealthWidget({
  program,
  onOpen,
}: {
  program: ProgramSummary;
  onOpen: () => void;
}) {
  const budget = program.budgetTracking;
  const badge = budget?.healthSignal === "green"
    ? "green"
    : budget?.healthSignal === "amber"
      ? "amber"
      : budget
        ? "red"
        : "slate";
  const headline = budget
    ? budget.healthReason
    : "Budget posture becomes available once ADAM has enough progress context.";

  return (
    <div className="adam-card adam-stack p-5">
      <div className="adam-title">Budget health</div>
      <div className="adam-heading-lg">
        {budget?.roi !== null && budget?.roi !== undefined && Number.isFinite(budget.roi)
          ? `${budget.roi.toFixed(1)}x`
          : formatCurrency(program.valueProjected)}
      </div>
      <div className="adam-body adam-muted" style={{ minHeight: 42 }}>
        {headline}
      </div>
      <div className="adam-row adam-space-between">
        <span className={`adam-badge ${badge}`}>
          {budget ? budget.healthSignal.toUpperCase() : "Pending"}
        </span>
        <button type="button" className="adam-button-ghost" onClick={onOpen}>
          Open budget
        </button>
      </div>
    </div>
  );
}

function HealthWidget({
  program,
  onOpen,
}: {
  program: ProgramSummary;
  onOpen: () => void;
}) {
  if (!program.healthHeatmap) return null;
  return (
    <div className="adam-card adam-stack p-5">
      <div className="adam-row adam-space-between">
        <div className="adam-title">Program health</div>
        <button type="button" className="adam-button-ghost" onClick={onOpen}>
          Open health
        </button>
      </div>
      <div className="adam-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`adam-badge ${program.healthHeatmap.overallRag === "green" ? "green" : program.healthHeatmap.overallRag === "amber" ? "amber" : "red"}`}>
          {program.healthHeatmap.overallRag}
        </span>
        <span className="adam-heading-lg">{program.healthHeatmap.overallHealthScore}</span>
        <span className="adam-micro adam-muted">{program.healthHeatmap.programMomentum}</span>
      </div>
      <div className="adam-body adam-muted">
        {program.healthHeatmap.summary}
      </div>
      <HealthHeatmap heatmap={program.healthHeatmap} compact onSelectPhase={() => onOpen()} />
    </div>
  );
}

export function HomeView({
  program,
  onRefreshNarrative,
  agentCards,
  onNavigate,
  decisionCount,
  recommendedNudge,
  narrativeIsRunning = false,
  plan,
  planGeneratedAt,
  planIsRunning = false,
  onTriggerPlan,
  onAcknowledgeEscalation,
  onResolveEscalation,
  onDismissClosurePrompt,
}: HomeViewProps) {
  if (!program) {
    return (
      <EmptyState
        context="No active program yet"
        explanation="ADAM needs a program record before it can narrate work, show the Twin, or surface decisions."
        recommendation="Connect to Supabase and create your first program to begin the reimagined shell."
      />
    );
  }

  const runningAgents = agentCards.filter((card) => card.status === "running");
  const pausedAgents = agentCards.filter((card) => card.status === "paused");
  const latestDecision = program.decisionQueue[0];
  const blockers = program.risks
    .filter((risk) => risk.severity === "critical" || risk.severity === "high")
    .slice(0, 3)
    .map((risk) => ({
      label: risk.label,
      severity: risk.severity === "critical" ? "critical" : "high" as const,
      action: risk.action,
      actionView: "work" as AppView,
    }));
  const rawInner = asRecord(asRecord(program.rawData).data);
  const closurePromptDismissed = (rawInner.closurePromptDismissed ?? asRecord(program.rawData).closurePromptDismissed) === true;
  const recommendedPcrSignals = program.scopePcr?.scopeSignals.filter((signal) => signal.recommendPcr) || [];

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6">
      <EscalationBanner
        escalations={program.escalations}
        onAcknowledge={onAcknowledgeEscalation}
        onResolve={onResolveEscalation}
      />

      {program.closure?.status === "ready" && !closurePromptDismissed ? (
        <section className="adam-closure-approved-banner">
          <div className="adam-row adam-space-between" style={{ alignItems: "center" }}>
            <div>
              <div className="adam-title">This program is ready to close</div>
              <div className="mt-2 adam-body">
                Review the closure pack, confirm the realised value story, and approve archive when you are comfortable with the lessons and final artifacts.
              </div>
            </div>
            <div className="adam-row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button type="button" className="adam-button" onClick={() => onNavigate("closure")}>
                View closure pack
              </button>
              <button type="button" className="adam-button-ghost" onClick={onDismissClosurePrompt}>
                Dismiss
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {program.scopePcr?.overallScopeRisk === "high" && recommendedPcrSignals.length > 0 ? (
        <section className="adam-card p-5" style={{ borderColor: "rgba(220,38,38,0.28)", background: "rgba(220,38,38,0.08)" }}>
          <div className="adam-row adam-space-between" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div className="adam-stack" style={{ gap: 6 }}>
              <div className="adam-title">Scope creep detected</div>
              <div className="adam-body adam-muted">
                {recommendedPcrSignals.length} PCR{recommendedPcrSignals.length > 1 ? "s" : ""} recommended. Review the signals before they land as delivery drag.
              </div>
            </div>
            <button type="button" className="adam-button" onClick={() => onNavigate("scope-pcr")}>
              Review scope &amp; PCR
            </button>
          </div>
        </section>
      ) : null}

      <NarrativeBlock
        programName={program.name}
        narrative={program.narrative}
        generatedAt={program.narrativeGeneratedAt}
        isStale={Date.now() - new Date(program.narrativeGeneratedAt || program.updatedAt).getTime() > 1000 * 60 * 60 * 24}
        onRefresh={onRefreshNarrative}
        isRunning={narrativeIsRunning}
      />

      <PlanCard
        plan={plan}
        planGeneratedAt={planGeneratedAt}
        criticalPathAnalysis={program.criticalPath}
        onTrigger={onTriggerPlan}
        isRunning={planIsRunning}
      />

      <div className="adam-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
        <ValueMeter delivered={program.valueDelivered} projected={program.valueProjected} />
        <div className="adam-card adam-stack p-5">
          <div className="adam-title">Readiness</div>
          <div className="adam-heading-lg">{program.readiness}%</div>
          <span className={`adam-badge ${program.readiness >= 75 ? "green" : program.readiness >= 45 ? "amber" : "red"}`}>
            {program.readiness >= 75 ? "Ready" : program.readiness >= 45 ? "At risk" : "Blocked"}
          </span>
          <button type="button" className="adam-button-ghost" onClick={() => onNavigate("work")}>
            Open readiness
          </button>
        </div>
        <div className="adam-card adam-stack p-5">
          <div className="adam-title">Agents</div>
          <div className="adam-heading-lg">{runningAgents.length} running</div>
          <div className="adam-body adam-muted">
            {pausedAgents.length} paused · {agentCards.filter((card) => card.status === "complete").length} complete today
          </div>
          <div className="adam-list">
            {agentCards.slice(0, 3).map((card) => (
              <div key={card.phaseId} className="adam-row adam-space-between">
                <span className="adam-micro">{card.displayName}</span>
                <AgentPulse status={card.status} size="sm" />
              </div>
            ))}
          </div>
        </div>
        <BudgetHealthWidget program={program} onOpen={() => onNavigate("budget")} />
        {program.healthHeatmap ? <HealthWidget program={program} onOpen={() => onNavigate("health-heatmap")} /> : null}
      </div>

      <div className="adam-grid two">
        <div className="adam-stack">
          <div className="adam-card p-5">
            <div className="adam-row adam-space-between">
              <div>
                <div className="adam-title">Decision spotlight</div>
                <div className="adam-micro adam-muted">{decisionCount} decisions in the queue</div>
              </div>
              <button type="button" className="adam-button-ghost" onClick={() => onNavigate("decisions")}>
                View all →
              </button>
            </div>
            <div className="mt-4">
              {latestDecision ? (
                <DecisionItem
                  id={latestDecision.id}
                  title={latestDecision.title}
                  priority={latestDecision.priority}
                  phaseLabel={latestDecision.phaseId}
                  subtitle={latestDecision.question}
                  timeAgo={timeAgo(latestDecision.createdAt)}
                  onSelect={() => onNavigate("decisions")}
                />
              ) : (
                <EmptyState
                  context="All decisions resolved"
                  explanation="Agents are not waiting on any human handoffs right now."
                  recommendation="Keep the next phase moving or wait for ADAM to surface the next decision."
                  learnMoreLabel="Open decisions"
                  onLearnMore={() => onNavigate("decisions")}
                />
              )}
            </div>
          </div>

          <ReadinessSignal
            canProceed={program.readiness >= 75}
            readinessScore={program.readiness}
            blockers={blockers}
            topRisks={program.risks.slice(0, 3).map((risk) => ({
              label: risk.label,
              severity: risk.severity === "critical" ? "high" : risk.severity === "high" ? "high" : risk.severity === "medium" ? "medium" : "low",
            }))}
            phase={program.activePhaseName}
            onAction={onNavigate}
          />
        </div>

        <div className="adam-stack">
          <TwinPreview
            nodeCount={program.twinGraph.nodes.length}
            edgeCount={program.twinGraph.edges.length}
            onOpen={() => onNavigate("twin")}
          />
          <div className="adam-card p-5">
            <div className="adam-title">Recommended next action</div>
            <div className="mt-3 adam-heading-lg">{recommendedNudge?.actionLabel || "Review the current phase"}</div>
            <div className="mt-2 adam-body adam-muted">
              {recommendedNudge?.message || `ADAM recommends opening ${program.activePhaseName} and tightening the next evidence gap.`}
            </div>
            <button
              type="button"
              className="adam-button mt-4"
              onClick={() => onNavigate(recommendedNudge?.actionView || "work")}
            >
              Take action
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
