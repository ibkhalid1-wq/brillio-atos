import React from "react";
import { AgentCard, type AgentCardProps } from "@/new/components/ui/AgentCard";
import { AgentPulse } from "@/new/components/ui/AgentPulse";

interface AgentActivityRailProps {
  cards: AgentCardProps[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpenTraces: () => void;
  onOpenSchedules: () => void;
}

export function AgentActivityRail({
  cards,
  collapsed,
  onCollapsedChange,
  onOpenTraces,
  onOpenSchedules,
}: AgentActivityRailProps) {
  return (
    <aside className={`adam-rail ${collapsed ? "is-collapsed" : ""}`}>
      <div className="adam-rail-inner">
        <div className="adam-row adam-space-between px-3 py-3">
          {!collapsed ? <div className="adam-title">Agent Activity</div> : null}
          <button type="button" className="adam-button-ghost min-h-[32px]" onClick={() => onCollapsedChange(!collapsed)}>
            {collapsed ? "→" : "←"}
          </button>
        </div>
        <div className="adam-divider" />
        <div className="adam-scroll flex-1 px-3 py-3">
          {collapsed ? (
            <div className="flex flex-col items-center gap-3">
              {cards.map((card) => (
                <button key={card.phaseId} type="button" onClick={() => onCollapsedChange(false)} className="rounded-full border border-white/10 adam-pad-tight">
                  <AgentPulse status={card.status} size="sm" />
                </button>
              ))}
            </div>
          ) : (
            <div className="adam-stack">
              {cards.length ? cards.map((card) => (
                <AgentCard key={card.phaseId} {...card} />
              )) : (
                <div className="adam-empty">
                  <div className="adam-title">No agent activity yet</div>
                  <div className="adam-body adam-muted">
                    The rail will populate as soon as phases start running or handing off work.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {!collapsed ? (
          <>
            <div className="adam-divider" />
            <div className="adam-stack p-3">
              <button type="button" className="adam-button-ghost" onClick={onOpenTraces}>
                View all traces
              </button>
              <button type="button" className="adam-button-ghost" onClick={onOpenSchedules}>
                Manage schedules
              </button>
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}
