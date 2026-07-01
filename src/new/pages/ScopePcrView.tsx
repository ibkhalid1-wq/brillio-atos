import React from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { AppView, ProgramSummary } from "@/new/types";
import { deriveChangeRequests } from "@/v3/lib/changeRequests";

interface ScopePcrViewProps {
  program: ProgramSummary | null;
  isRunning: boolean;
  onTriggerScopePcr: () => void;
  onNavigate: (view: AppView) => void;
}

export function ScopePcrView({
  program,
  isRunning,
  onTriggerScopePcr,
  onNavigate,
}: ScopePcrViewProps) {
  if (!program) {
    return (
      <NotReadyCard
        title="Scope & PCR"
        reason="No active program. Connect Supabase and choose a program to inspect scope change signals."
      />
    );
  }

  const summary = program.scopePcr;
  if (!summary) {
    return (
      <NotReadyCard
        title="Scope & PCR"
        reason="ATOS monitors for scope changes once 2 or more phases are underway."
        onTrigger={onTriggerScopePcr}
        triggerLabel="Scan for scope creep"
        isRunning={isRunning}
      />
    );
  }

  const changeRequests = deriveChangeRequests(program);

  return (
    <div className="adam-stack" style={{ maxWidth: 1120 }}>
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-heading-xl">Scope &amp; PCR</div>
            <div className="adam-body adam-muted">{summary.summary}</div>
            {program.scopePcrGeneratedAt ? (
              <div className="adam-micro adam-muted">
                Updated {new Date(program.scopePcrGeneratedAt).toLocaleString()}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="adam-button-ghost"
            onClick={onTriggerScopePcr}
            disabled={isRunning}
          >
            {isRunning ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="adam-row" style={{ gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <span className={`adam-badge ${summary.overallScopeRisk === "high" ? "red" : summary.overallScopeRisk === "medium" ? "amber" : summary.overallScopeRisk === "low" ? "blue" : "green"}`}>
            {summary.overallScopeRisk} scope risk
          </span>
          <span className="adam-badge slate">{summary.openPcrCount} open PCR decisions</span>
          <span className="adam-badge blue">{Math.round(summary.confidence * 100)}% confidence</span>
        </div>
      </section>

      <div className="adam-grid two">
        {summary.scopeSignals.length ? summary.scopeSignals.map((signal) => (
          <section
            key={signal.id}
            className="adam-card p-5"
            style={signal.recommendPcr
              ? { borderLeft: "4px solid var(--adam-red)", background: "rgba(220,38,38,0.08)" }
              : undefined}
          >
            <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div className="adam-stack" style={{ gap: 4 }}>
                <div className="adam-title">{signal.description}</div>
                <div className="adam-micro adam-muted">{signal.phase}</div>
              </div>
              <div className="adam-row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <span className="adam-badge slate">{signal.source}</span>
                <span className={`adam-badge ${signal.severity === "critical" || signal.severity === "high" ? "red" : signal.severity === "medium" ? "amber" : "green"}`}>
                  {signal.severity}
                </span>
              </div>
            </div>

            <div className="mt-4 adam-stack" style={{ gap: 8 }}>
              {signal.impactOnTimeline ? <div className="adam-body adam-muted">Timeline impact: {signal.impactOnTimeline}</div> : null}
              {signal.impactOnBudget ? <div className="adam-body adam-muted">Budget impact: {signal.impactOnBudget}</div> : null}
              {signal.pcrRationale ? <div className="adam-body adam-muted">{signal.pcrRationale}</div> : null}
            </div>

            {signal.recommendPcr ? (
              <div className="mt-4">
                <button type="button" className="adam-button" onClick={() => onNavigate("decisions")}>
                  Raise PCR
                </button>
              </div>
            ) : null}
          </section>
        )) : (
          <section className="adam-card p-5">
            <div className="adam-body adam-muted">No material scope creep signals are active right now.</div>
          </section>
        )}
      </div>

      <section className="adam-card p-5">
        <div className="adam-title">Change requests</div>

        <div className="mt-4 adam-stack" style={{ gap: 10 }}>
          {changeRequests.open.length ? changeRequests.open.map((cr) => (
            <div key={cr.id} className="adam-card p-4" style={{ borderLeft: "4px solid var(--adam-amber)" }}>
              <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div className="adam-stack" style={{ gap: 4 }}>
                  <div className="adam-title">{cr.title}</div>
                  <div className="adam-micro adam-muted">
                    {cr.phaseId} · raised {new Date(cr.requestedAt).toLocaleDateString()} by {cr.requestedBy}
                  </div>
                </div>
                <span className="adam-badge amber">open</span>
              </div>
              {cr.reason ? <div className="mt-3 adam-body adam-muted">{cr.reason}</div> : null}
            </div>
          )) : (
            <div className="adam-body adam-muted">No open change requests awaiting a decision.</div>
          )}
        </div>

        {changeRequests.history.length ? (
          <div className="mt-5 adam-stack" style={{ gap: 8 }}>
            <div className="adam-micro adam-muted">Change request history</div>
            {changeRequests.history.map((cr) => (
              <div key={cr.id} className="adam-card p-4">
                <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div className="adam-stack" style={{ gap: 2 }}>
                    <div className="adam-body">{cr.title}</div>
                    <div className="adam-micro adam-muted">
                      {cr.phaseId} · raised {new Date(cr.requestedAt).toLocaleDateString()} by {cr.requestedBy}
                    </div>
                  </div>
                  <div className="adam-row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <span className={`adam-badge ${cr.status === "rejected" ? "red" : "green"}`}>
                      {cr.status}
                    </span>
                  </div>
                </div>
                {cr.reason ? <div className="mt-2 adam-body adam-muted">{cr.reason}</div> : null}
                {cr.decidedAt ? (
                  <div className="mt-2 adam-micro adam-muted">
                    {cr.status === "approved" ? "Approved" : "Rejected"} {new Date(cr.decidedAt).toLocaleDateString()}
                    {cr.decidedBy ? ` by ${cr.decidedBy}` : ""}
                    {cr.decisionNote ? ` — ${cr.decisionNote}` : ""}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="adam-card p-5">
        <div className="adam-title">Recommended actions</div>
        <div className="mt-4 adam-list">
          {summary.recommendedActions.length ? summary.recommendedActions.map((item, index) => (
            <div key={`${item}-${index}`} className="adam-list-item adam-body">{item}</div>
          )) : (
            <div className="adam-list-item adam-body adam-muted">No immediate actions recommended beyond keeping current controls in place.</div>
          )}
        </div>
      </section>
    </div>
  );
}
