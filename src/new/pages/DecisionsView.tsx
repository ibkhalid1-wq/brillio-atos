import React, { useMemo, useState } from "react";
import { DecisionItem } from "@/new/components/ui/DecisionItem";
import { EmptyState } from "@/new/components/ui/EmptyState";
import type { AgentRun } from "@/lib/adamSync";
import type { DecisionSummary, ProgramSummary } from "@/new/types";

interface DecisionsViewProps {
  program: ProgramSummary | null;
  activeRuns: AgentRun[];
  onResolve: (decision: DecisionSummary, resolution: "approved" | "rejected" | "modified", note?: string) => Promise<void>;
}

function timeAgo(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.round(deltaMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function DecisionsView({ program, activeRuns, onResolve }: DecisionsViewProps) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [selectedOption, setSelectedOption] = useState<string>("");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const decisions = program?.decisionQueue || [];
  const selected = useMemo(() => (
    decisions.find((entry) => entry.id === selectedId) || decisions[0] || null
  ), [decisions, selectedId]);

  const resolveSelected = async () => {
    if (!selected) return;
    setIsSubmitting(true);
    try {
      const resolution = selectedOption.toLowerCase().includes("reject")
        ? "rejected"
        : selectedOption && !selectedOption.toLowerCase().includes("approve")
          ? "modified"
          : "approved";
      await onResolve(selected, resolution, note);
      setSelectedId("");
      setSelectedOption("");
      setNote("");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!program) {
    return (
      <EmptyState
        context="No decision context yet"
        explanation="Decisions flow from a specific program, agent run, and phase."
        recommendation="Choose a program first, then return to the inbox."
      />
    );
  }

  if (!decisions.length) {
    return (
      <EmptyState
        context="All decisions resolved"
        explanation="ADAM has no open human-agent handoffs in this program right now."
        recommendation="Run the next agent or wait for the next escalation to arrive."
      />
    );
  }

  const activeRun = activeRuns.find((run) => run.id === selected?.runId);

  return (
    <div className="flex gap-5">
      <aside className="adam-card h-[calc(100vh-170px)] w-[320px] p-4">
        <div className="adam-row adam-space-between">
          <div>
            <div className="adam-heading-lg">Decisions</div>
            <div className="adam-micro adam-muted">{decisions.length} open</div>
          </div>
          <span className="adam-badge red">{decisions.filter((entry) => entry.priority === "critical").length} critical</span>
        </div>
        <div className="mt-4 adam-scroll h-[calc(100%-72px)]">
          <div className="adam-list">
            {decisions.map((decision) => (
              <DecisionItem
                key={decision.id}
                id={decision.id}
                title={decision.title}
                priority={decision.priority}
                phaseLabel={decision.phaseId}
                timeAgo={timeAgo(decision.createdAt)}
                subtitle={decision.runId ? "Paused agent" : "Escalated"}
                compact
                selected={selected?.id === decision.id}
                onSelect={() => setSelectedId(decision.id)}
              />
            ))}
          </div>
        </div>
      </aside>

      <section className="adam-card flex-1 p-6">
        {selected ? (
          <div className="adam-stack">
            <div className="adam-row adam-space-between">
              <div className="adam-stack" style={{ gap: 6 }}>
                <div className="adam-heading-lg">{selected.title}</div>
                <div className="adam-body adam-muted">
                  {selected.agentId ? `${selected.agentId} queued this decision` : "A human review item is ready."}
                  {activeRun?.confidence != null ? ` · ${Math.round(activeRun.confidence * 100)}% confidence` : ""}
                </div>
              </div>
              <span className={`adam-badge ${selected.priority === "critical" ? "red" : selected.priority === "high" ? "amber" : "blue"}`}>
                {selected.priority}
              </span>
            </div>

            <div className="adam-card p-5" style={{ background: "rgba(37,99,235,0.12)" }}>
              <div className="adam-title">Agent recommendation</div>
              <div className="mt-2 adam-body">
                {selected.recommendation || selected.question}
              </div>
            </div>

            <div className="adam-stack">
              <div className="adam-title">Decision options</div>
              <div className="adam-grid two">
                {selected.options.length ? selected.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`adam-list-item text-left ${selectedOption === option ? "border-blue-500/50 bg-blue-500/10" : ""}`}
                    onClick={() => setSelectedOption(option)}
                  >
                    <div className="adam-title">{option}</div>
                  </button>
                )) : (
                  <div className="adam-list-item adam-body adam-muted">No explicit options were provided for this decision.</div>
                )}
              </div>
            </div>

            <label className="adam-stack">
              <span className="adam-title">Human note</span>
              <textarea
                className="adam-textarea min-h-[120px]"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Add context for the agent or the next reviewer..."
              />
            </label>

            <div className="adam-row" style={{ flexWrap: "wrap" }}>
              <button type="button" className="adam-button" disabled={isSubmitting} onClick={() => void resolveSelected()}>
                {isSubmitting ? "Resolving..." : "Resolve"}
              </button>
              <button type="button" className="adam-button-ghost" onClick={() => setSelectedOption(selected.options[0] || "")}>
                Approve first option
              </button>
              <button type="button" className="adam-button-ghost" onClick={() => setSelectedOption("Reject and rework")}>
                Reject
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
