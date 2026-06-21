import React, { useMemo, useState } from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { ProgramSummary, StakeholderProfile } from "@/new/types";
import { RiskBadge } from "@/v3/components/ui/RiskBadge";
import { confidenceLabel, confidenceTone } from "@/v3/utils";

interface StakeholderViewProps {
  program: ProgramSummary | null;
  isRunning: boolean;
  onTriggerStakeholders: () => void;
}

type StakeholderFilter = "all" | "champions" | "at-risk" | "resistant";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function filterStakeholders(stakeholders: StakeholderProfile[], filter: StakeholderFilter) {
  if (filter === "champions") return stakeholders.filter((entry) => entry.currentEngagement === "champion");
  if (filter === "at-risk") return stakeholders.filter((entry) => entry.riskOfDisengagement === "high");
  if (filter === "resistant") return stakeholders.filter((entry) => entry.currentEngagement === "resistant");
  return stakeholders;
}

function sentimentClass(sentiment: StakeholderProfile["sentiment"]) {
  if (sentiment === "positive") return "green";
  if (sentiment === "negative") return "red";
  if (sentiment === "neutral") return "blue";
  return "slate";
}

function engagementClass(value: StakeholderProfile["currentEngagement"]) {
  if (value === "champion" || value === "supportive") return "green";
  if (value === "resistant") return "red";
  if (value === "neutral") return "amber";
  return "slate";
}

function stakeholderConfidence(program: ProgramSummary): number | null {
  const raw = program.rawData || {};
  const inner = typeof raw.data === "object" && raw.data !== null && !Array.isArray(raw.data)
    ? raw.data as Record<string, unknown>
    : raw;
  const summary = typeof inner.stakeholderSummary === "object" && inner.stakeholderSummary !== null && !Array.isArray(inner.stakeholderSummary)
    ? inner.stakeholderSummary as Record<string, unknown>
    : null;
  return typeof summary?.confidence === "number" ? summary.confidence : null;
}

function exportStakeholdersCsv(stakeholders: StakeholderProfile[], programName: string) {
  const headers = ["Name", "Role", "Organisation", "Engagement", "Sentiment", "Influence", "Interest", "Risk", "Recommended Action"];
  const rows = stakeholders.map((entry) => [
    `"${entry.name.replace(/"/g, "\"\"")}"`,
    `"${(entry.role || "").replace(/"/g, "\"\"")}"`,
    `"${(entry.organisation || "").replace(/"/g, "\"\"")}"`,
    entry.currentEngagement,
    entry.sentiment,
    entry.influence,
    entry.interest,
    entry.riskOfDisengagement,
    `"${entry.recommendedActions.join("; ").replace(/"/g, "\"\"")}"`,
  ].join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${programName}-stakeholders.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function StakeholderView({
  program,
  isRunning,
  onTriggerStakeholders,
}: StakeholderViewProps) {
  const [filter, setFilter] = useState<StakeholderFilter>("all");

  const stakeholders = useMemo(
    () => filterStakeholders(program?.stakeholders || [], filter),
    [filter, program?.stakeholders],
  );

  if (!program) {
    return (
      <NotReadyCard
        title="Stakeholder Map"
        reason="No active program. Connect Supabase and choose a program to begin."
      />
    );
  }

  const confidence = stakeholderConfidence(program);

  if (!program.stakeholders.length) {
    return (
      <NotReadyCard
        title="Stakeholder Map"
        reason="ATOS needs at least one phase underway to identify stakeholders and engagement signals."
        onTrigger={onTriggerStakeholders}
        triggerLabel="Generate stakeholder map"
        isRunning={isRunning}
      />
    );
  }

  return (
    <div className="adam-stack" style={{ maxWidth: 1120 }}>
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-heading-xl">Stakeholder Map</div>
            {confidence !== null ? (
              <div>
                <span className={`v3-chip ${confidenceTone(confidence)}`} title={confidenceLabel(confidence)}>
                  {Math.round(confidence * 100)}% confidence
                </span>
              </div>
            ) : null}
            <div className="adam-body adam-muted">
              {program.stakeholders.length} stakeholders identified across the current transformation context.
            </div>
            {program.stakeholderGeneratedAt ? (
              <div className="adam-micro adam-muted">
                Updated {new Date(program.stakeholderGeneratedAt).toLocaleString()}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="adam-button-ghost"
            onClick={onTriggerStakeholders}
            disabled={isRunning}
          >
            {isRunning ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className="v3-export-btn" onClick={() => exportStakeholdersCsv(program.stakeholders || [], program.name || "program")}>
            Export CSV
          </button>
        </div>

        <div className="mt-4 adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
          {([
            ["all", "All"],
            ["champions", "Champions"],
            ["at-risk", "At risk"],
            ["resistant", "Resistant"],
          ] as [StakeholderFilter, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`adam-chip ${filter === id ? "is-active" : ""}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="adam-card p-5">
        <div className="adam-title">Influence / interest matrix</div>
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <div style={{ minWidth: 480 }}>
            <div className="mt-4 adam-stakeholder-matrix">
              {(["high", "medium", "low"] as const).flatMap((interest) => (
                ["low", "medium", "high"] as const
              ).map((influence) => {
                const matches = stakeholders.filter((entry) => entry.interest === interest && entry.influence === influence);
                const label = interest === "high" && influence === "high"
                  ? "Manage closely"
                  : interest === "high" && influence === "low"
                    ? "Keep informed"
                    : interest === "low" && influence === "high"
                      ? "Keep satisfied"
                      : "Monitor";
                return (
                  <div key={`${interest}-${influence}`} className="adam-stakeholder-quadrant">
                    <div className="adam-micro adam-muted">{interest} interest · {influence} influence</div>
                    <div className="adam-micro" style={{ color: "rgba(255,255,255,0.86)" }}>{label}</div>
                    <div className="adam-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                      {matches.length ? matches.map((entry) => (
                        <span
                          key={entry.id}
                          className="adam-stakeholder-chip"
                          title={`${entry.name} · ${entry.role} · ${entry.currentEngagement} · ${entry.sentiment}`}
                        >
                          <span className={`adam-badge ${sentimentClass(entry.sentiment)}`}>{initials(entry.name)}</span>
                          <span>{entry.name}</span>
                        </span>
                      )) : (
                        <span className="adam-micro adam-muted">No mapped stakeholders</span>
                      )}
                    </div>
                  </div>
                );
              }))}
            </div>
          </div>
        </div>
      </section>

      <section className="adam-card p-5">
        <div className="adam-title">Stakeholder list</div>
        <div className="mt-4 adam-list">
          {stakeholders.map((entry) => (
            <div key={entry.id} className={`adam-list-item ${isRunning ? "animate-pulse" : ""}`}>
              <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div className="adam-stack" style={{ gap: 4 }}>
                  <div className="adam-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {entry.name}
                    <RiskBadge risk={(entry as unknown as Record<string,unknown>).engagementRisk as "high"|"medium"|"low"|null} reason={(entry as unknown as Record<string,unknown>).engagementRiskReason as string} />
                  </div>
                  <div className="adam-micro adam-muted">
                    {entry.role || "Role pending"}
                    {entry.organisation ? ` · ${entry.organisation}` : ""}
                    {entry.owner ? ` · Owner ${entry.owner}` : ""}
                  </div>
                </div>
                <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className={`adam-badge ${engagementClass(entry.currentEngagement)}`}>{entry.currentEngagement}</span>
                  <span className={`adam-badge ${sentimentClass(entry.sentiment)}`}>{entry.sentiment}</span>
                  <span className={`adam-badge ${entry.riskOfDisengagement === "high" ? "red" : entry.riskOfDisengagement === "medium" ? "amber" : "green"}`}>
                    {entry.riskOfDisengagement} risk
                  </span>
                </div>
              </div>

              <div className="mt-3 adam-grid two">
                <div className="adam-stack" style={{ gap: 6 }}>
                  <div className="adam-micro adam-muted">Recommended actions</div>
                  {entry.recommendedActions.length ? entry.recommendedActions.map((action, index) => (
                    <div key={`${entry.id}-${index}`} className="adam-body">{action}</div>
                  )) : (
                    <div className="adam-body adam-muted">No targeted actions suggested yet.</div>
                  )}
                </div>
                <div className="adam-stack" style={{ gap: 6 }}>
                  <div className="adam-micro adam-muted">Target posture</div>
                  <div className="adam-body">{entry.targetEngagement}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
