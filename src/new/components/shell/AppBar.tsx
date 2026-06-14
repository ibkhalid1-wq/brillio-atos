import React, { useEffect, useMemo, useState } from "react";
import type { AppView, Persona, ProgramSummary } from "@/new/types";
import { BellIcon, ChevronIcon, SearchIcon, SparklesIcon } from "@/new/components/ui/Icons";

interface SearchItem {
  id: string;
  title: string;
  subtitle: string;
  action: () => void;
}

interface AppBarProps {
  programs: ProgramSummary[];
  activeProgramId: string;
  onProgramChange: (id: string) => void;
  persona: Persona;
  onPersonaChange: (p: Persona) => void;
  syncStatus: "synced" | "syncing" | "error";
  alertCount: number;
  hasEscalations: boolean;
  searchItems: SearchItem[];
  onNavigate: (view: AppView) => void;
  copilotOpen: boolean;
  onCopilotToggle: () => void;
}

const PERSONAS: Persona[] = ["executive", "lead", "architect", "fde", "engineer"];

const PERSONA_LABELS: Record<Persona, string> = {
  executive: "Executive",
  lead: "Program Lead",
  architect: "Architect",
  fde: "FDE Lead",
  engineer: "Engineer",
};

export function AppBar({
  programs,
  activeProgramId,
  onProgramChange,
  persona,
  onPersonaChange,
  syncStatus,
  alertCount,
  hasEscalations,
  searchItems,
  onNavigate,
  copilotOpen,
  onCopilotToggle,
}: AppBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showPrograms, setShowPrograms] = useState(false);
  const [showPersona, setShowPersona] = useState(false);

  const activeProgram = programs.find((p) => p.id === activeProgramId) || programs[0] || null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((s) => !s);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setShowPrograms(false);
        setShowPersona(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return searchItems.slice(0, 16);
    return searchItems
      .filter((i) => `${i.title} ${i.subtitle}`.toLowerCase().includes(q))
      .slice(0, 20);
  }, [query, searchItems]);

  return (
    <>
      <header className="acb-appbar">
        <div className="acb-appbar-inner">
          <div className="acb-appbar-left">
            <button type="button" className="acb-brand" onClick={() => onNavigate("home")}>
              <SparklesIcon className="acb-brand-icon" />
              <span className="acb-brand-name">ADAM</span>
            </button>
            <div className="acb-divider-v" />
            <div className="relative">
              <button
                type="button"
                className="acb-program-selector"
                onClick={() => setShowPrograms((s) => !s)}
              >
                <span className="acb-program-label">{activeProgram?.name || "Select program"}</span>
                {activeProgram ? (
                  <span
                    className={`acb-readiness-dot ${
                      activeProgram.readiness >= 75
                        ? "green"
                        : activeProgram.readiness >= 45
                          ? "amber"
                          : "red"
                    }`}
                  />
                ) : null}
                <ChevronIcon className="acb-chevron" />
              </button>
              {showPrograms ? (
                <div className="acb-dropdown">
                  {programs.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`acb-dropdown-item ${p.id === activeProgramId ? "is-active" : ""}`}
                      onClick={() => {
                        onProgramChange(p.id);
                        setShowPrograms(false);
                      }}
                    >
                      <span className="acb-dropdown-item-name">{p.name}</span>
                      <span className="acb-dropdown-item-sub">{p.industry} · {p.readiness}% ready</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="acb-appbar-right">
            <span
              className={`acb-sync-dot ${syncStatus}`}
              title={syncStatus === "synced" ? "In sync" : syncStatus === "syncing" ? "Syncing…" : "Sync error"}
            />
            <button type="button" className="acb-icon-btn" onClick={() => setSearchOpen(true)} title="Search ⌘K">
              <SearchIcon className="acb-icon" />
            </button>
            <button
              type="button"
              className={`acb-icon-btn ${alertCount > 0 ? "has-badge" : ""} ${hasEscalations ? "has-alert" : ""}`}
              data-count={alertCount > 0 ? alertCount : undefined}
              onClick={() => onNavigate("decisions")}
              title="Decisions and escalations"
            >
              <BellIcon className="acb-icon" />
            </button>
            <div className="acb-divider-v" />
            <div className="relative">
              <button
                type="button"
                className="acb-persona-btn"
                onClick={() => setShowPersona((s) => !s)}
              >
                <span className="acb-persona-avatar">{persona[0].toUpperCase()}</span>
                <span className="acb-persona-label">{PERSONA_LABELS[persona]}</span>
                <ChevronIcon className="acb-chevron" />
              </button>
              {showPersona ? (
                <div className="acb-dropdown acb-dropdown-right">
                  {PERSONAS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`acb-dropdown-item ${p === persona ? "is-active" : ""}`}
                      onClick={() => {
                        onPersonaChange(p);
                        setShowPersona(false);
                      }}
                    >
                      <span className="acb-dropdown-item-name">{PERSONA_LABELS[p]}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={`acb-copilot-btn ${copilotOpen ? "is-open" : ""}`}
              onClick={onCopilotToggle}
            >
              <SparklesIcon className="acb-icon" />
              <span>Copilot</span>
            </button>
          </div>
        </div>
      </header>

      {searchOpen ? (
        <>
          <div className="adam-modal-scrim" onClick={() => setSearchOpen(false)} />
          <div className="adam-modal p-4">
            <div className="adam-card p-4">
              <div className="adam-row">
                <SearchIcon className="h-4 w-4 text-slate-300" />
                <input
                  className="adam-input border-none bg-transparent p-0 text-base shadow-none"
                  placeholder="Search programs, workspaces, artifacts, decisions, agents…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="my-4 adam-divider" />
              <div className="adam-grid two">
                <div className="adam-stack">
                  <div className="adam-micro adam-muted">Results</div>
                  <div className="adam-list">
                    {filteredItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="adam-list-item text-left"
                        onClick={() => {
                          item.action();
                          setSearchOpen(false);
                        }}
                      >
                        <div className="adam-title">{item.title}</div>
                        <div className="adam-micro adam-muted">{item.subtitle}</div>
                      </button>
                    ))}
                    {!filteredItems.length ? (
                      <div className="adam-list-item adam-body adam-muted">No matches.</div>
                    ) : null}
                  </div>
                </div>
                <div className="adam-stack">
                  <div className="adam-micro adam-muted">Quick actions</div>
                  <div className="adam-list">
                    {([
                      ["Overview", "home"],
                      ["Twin", "twin"],
                      ["Accelerators", "accelerators"],
                      ["Decisions", "decisions"],
                      ["Risks", "risks"],
                      ["Budget", "budget"],
                      ["Critical Path", "critical-path"],
                      ["Change Impact", "change-impact"],
                      ["Stakeholders", "stakeholders"],
                      ["Adoption", "adoption"],
                      ["Health", "health-heatmap"],
                      ["Closure", "closure"],
                    ] as [string, AppView][]).map(([label, view]) => (
                      <button
                        key={view}
                        type="button"
                        className="adam-list-item text-left"
                        onClick={() => {
                          onNavigate(view);
                          setSearchOpen(false);
                        }}
                      >
                        <div className="adam-title">{label}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
