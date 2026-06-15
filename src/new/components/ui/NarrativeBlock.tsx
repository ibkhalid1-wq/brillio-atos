import React from "react";
import { RefreshIcon } from "@/new/components/ui/Icons";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";

export interface NarrativeBlockProps {
  programName: string;
  narrative: string;
  generatedAt: string;
  isStale: boolean;
  onRefresh: () => void;
  isRunning?: boolean;
}

export function NarrativeBlock({
  narrative,
  generatedAt,
  isStale,
  onRefresh,
  isRunning = false,
}: NarrativeBlockProps) {
  if (!narrative) {
    return (
      <section className="adam-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="adam-title" style={{ color: "var(--adam-slate-400)" }}>Program narrative</div>
            <div className="mt-2 adam-body adam-muted">
              ATOS will write a 2–3 sentence executive summary once a phase has measurable progress.
              It updates automatically as the program advances — no plan required.
            </div>
          </div>
          <span className="adam-badge slate" style={{ flexShrink: 0 }}>Not ready</span>
        </div>
        <button
          type="button"
          className="adam-button-ghost mt-4"
          onClick={onRefresh}
          disabled={isRunning}
        >
          {isRunning ? "Generating…" : "Generate narrative"}
        </button>
      </section>
    );
  }

  const timestamp = generatedAt ? new Date(generatedAt).toLocaleString() : "just now";

  return (
    <section className="adam-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="max-w-4xl border-l-4 border-blue-500 pl-5">
          <p className="adam-heading-lg" style={{ fontWeight: 400, lineHeight: 1.7 }}>
            {narrative}
          </p>
        </div>
        <button
          type="button"
          className="adam-button-ghost"
          onClick={onRefresh}
          disabled={isRunning}
        >
          <RefreshIcon className={`h-4 w-4 ${isRunning ? "adam-pulse" : ""}`} />
          {isRunning ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="mt-4 adam-row adam-space-between">
        <span className="adam-micro adam-muted">Updated {timestamp}</span>
        {isStale
          ? <span className="adam-badge amber">Stale context</span>
          : <span className="adam-badge green">Fresh</span>}
      </div>
    </section>
  );
}
