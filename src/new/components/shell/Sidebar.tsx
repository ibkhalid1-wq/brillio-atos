import React from "react";
import type { AppView } from "@/new/types";
import { GraphIcon, GridIcon, InboxIcon, LayersIcon, SettingsIcon, SparklesIcon } from "@/new/components/ui/Icons";

interface SidebarProps {
  activeView: AppView;
  expanded: boolean;
  pinned: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onPinnedChange: (pinned: boolean) => void;
  onNavigate: (view: AppView) => void;
  hints: Record<AppView, string>;
  unreadCount: number;
}

const NAV_ITEMS: Array<{ id: AppView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "home", label: "Home", icon: GridIcon },
  { id: "twin", label: "Twin", icon: GraphIcon },
  { id: "work", label: "Work", icon: LayersIcon },
  { id: "decisions", label: "Decisions", icon: InboxIcon },
  { id: "intelligence", label: "Intelligence", icon: SparklesIcon },
];

export function Sidebar({
  activeView,
  expanded,
  pinned,
  onExpandedChange,
  onPinnedChange,
  onNavigate,
  hints,
  unreadCount,
}: SidebarProps) {
  return (
    <aside
      className={`adam-sidebar ${expanded ? "is-expanded" : ""}`}
      onMouseEnter={() => onExpandedChange(true)}
      onMouseLeave={() => !pinned && onExpandedChange(false)}
    >
      <div className="adam-sidebar-inner">
        <div className="adam-sidebar-group">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeView;
            return (
              <button
                key={item.id}
                type="button"
                className={`adam-sidebar-item ${isActive ? "is-active" : ""}`}
                onClick={() => onNavigate(item.id)}
              >
                <Icon className="adam-sidebar-icon" />
                {expanded ? (
                  <div className="adam-sidebar-meta">
                    <span className="adam-sidebar-label">{item.label}</span>
                    <span className="adam-sidebar-hint">
                      {item.id === "decisions" && unreadCount > 0 ? `${unreadCount} needs review · ` : ""}
                      {hints[item.id]}
                    </span>
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="adam-sidebar-group">
          <button
            type="button"
            className={`adam-sidebar-item ${activeView === "settings" ? "is-active" : ""}`}
            onClick={() => onNavigate("settings")}
          >
            <SettingsIcon className="adam-sidebar-icon" />
            {expanded ? (
              <div className="adam-sidebar-meta">
                <span className="adam-sidebar-label">Settings</span>
                <span className="adam-sidebar-hint">{hints.settings}</span>
              </div>
            ) : null}
          </button>
          <button
            type="button"
            className="adam-sidebar-item"
            onClick={() => {
              onPinnedChange(!pinned);
              onExpandedChange(!pinned || !expanded);
            }}
          >
            <span className="adam-sidebar-icon" aria-hidden="true">📌</span>
            {expanded ? (
              <div className="adam-sidebar-meta">
                <span className="adam-sidebar-label">{pinned ? "Unpin sidebar" : "Pin sidebar"}</span>
                <span className="adam-sidebar-hint">Keep labels visible while you work</span>
              </div>
            ) : null}
          </button>
        </div>
      </div>
    </aside>
  );
}
