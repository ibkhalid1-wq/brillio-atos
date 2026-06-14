import React from "react";
import type { AppView } from "@/new/types";

interface SubNavProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  hints: Record<AppView, string>;
  unreadCount: number;
  agentRunningCount: number;
  closureReady?: boolean;
}

const NAV_ITEMS: Array<{ id: AppView; label: string }> = [
  { id: "home", label: "Overview" },
  { id: "work", label: "Workspace" },
  { id: "twin", label: "Twin" },
  { id: "accelerators", label: "Accelerators" },
  { id: "narrative", label: "Narrative" },
  { id: "plan", label: "Plan" },
  { id: "milestones", label: "Milestones" },
  { id: "decisions", label: "Decisions" },
  { id: "risks", label: "Risks" },
  { id: "budget", label: "Budget" },
  { id: "critical-path", label: "Critical Path" },
  { id: "change-impact", label: "Change Impact" },
  { id: "stakeholders", label: "Stakeholders" },
  { id: "adoption", label: "Adoption" },
  { id: "health-heatmap", label: "Health" },
  { id: "retro", label: "Retro" },
  { id: "scope-pcr", label: "Scope & PCR" },
  { id: "deck", label: "Deck" },
  { id: "closure", label: "Closure" },
  { id: "intelligence", label: "Intelligence" },
  { id: "settings", label: "Settings" },
];

export function SubNav({
  activeView,
  onNavigate,
  hints,
  unreadCount,
  agentRunningCount,
  closureReady = false,
}: SubNavProps) {
  return (
    <nav className="acb-subnav">
      <div className="acb-subnav-tabs">
        {NAV_ITEMS.map(({ id, label }) => {
          const isActive = id === activeView;
          const badge = id === "decisions" && unreadCount > 0 ? unreadCount : null;
          return (
            <button
              key={id}
              type="button"
              className={`acb-tab ${isActive ? "is-active" : ""}`}
              onClick={() => onNavigate(id)}
            >
              <span className="acb-tab-label">{label}</span>
              {id === "closure" && closureReady ? <span className="acb-tab-dot" aria-hidden="true" /> : null}
              {hints[id] && !isActive ? <span className="acb-tab-hint">{hints[id]}</span> : null}
              {badge !== null ? <span className="acb-tab-badge">{badge}</span> : null}
            </button>
          );
        })}
      </div>
      {agentRunningCount > 0 ? (
        <div className="acb-agent-strip">
          <span className="acb-agent-dot" />
          <span className="acb-agent-strip-label">
            {agentRunningCount} agent{agentRunningCount > 1 ? "s" : ""} running
          </span>
        </div>
      ) : null}
    </nav>
  );
}
