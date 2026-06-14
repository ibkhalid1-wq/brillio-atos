import React, { useEffect, useMemo, useState } from "react";
import type { AppView, Persona, ProgramSummary } from "@/new/types";
import {
  BellIcon,
  ChevronIcon,
  CommandIcon,
  RefreshIcon,
  SearchIcon,
  SparklesIcon,
  UserIcon,
} from "@/new/components/ui/Icons";

interface SearchItem {
  id: string;
  title: string;
  subtitle: string;
  action: () => void;
}

interface CommandBarProps {
  programs: ProgramSummary[];
  activeProgramId: string;
  onProgramChange: (programId: string) => void;
  persona: Persona;
  onPersonaChange: (persona: Persona) => void;
  syncStatus: "synced" | "syncing" | "error";
  unreadCount: number;
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  searchItems: SearchItem[];
  onNavigate: (view: AppView) => void;
}

const PERSONAS: Persona[] = ["executive", "lead", "architect", "fde", "engineer"];

export function CommandBar({
  programs,
  activeProgramId,
  onProgramChange,
  persona,
  onPersonaChange,
  syncStatus,
  unreadCount,
  open,
  onOpenChange,
  searchItems,
  onNavigate,
}: CommandBarProps) {
  const [query, setQuery] = useState("");
  const [showPrograms, setShowPrograms] = useState(false);
  const [showPersona, setShowPersona] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
      if (event.key === "Escape") {
        onOpenChange(false);
        setShowPrograms(false);
        setShowPersona(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  const activeProgram = programs.find((program) => program.id === activeProgramId) || programs[0] || null;
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return searchItems.slice(0, 16);
    return searchItems.filter((item) => (
      `${item.title} ${item.subtitle}`.toLowerCase().includes(normalizedQuery)
    )).slice(0, 20);
  }, [query, searchItems]);

  return (
    <>
      <header className="adam-topbar">
        <div className="flex h-full items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-3">
            <button type="button" className="adam-button-ghost min-h-[36px]" onClick={() => onNavigate("home")}>
              <SparklesIcon className="h-4 w-4 text-blue-300" />
              <span style={{ color: "var(--adam-cobalt-light)", fontWeight: 700 }}>ADAM</span>
            </button>
            <div className="relative">
              <button
                type="button"
                className="adam-button-ghost min-h-[36px]"
                onClick={() => setShowPrograms((current) => !current)}
              >
                <span>{activeProgram?.name || "Choose program"}</span>
                <ChevronIcon className="h-4 w-4" />
              </button>
              {showPrograms ? (
                <div className="adam-dropdown-panel w-[320px] p-3">
                  <div className="adam-stack">
                    {programs.map((program) => (
                      <button
                        key={program.id}
                        type="button"
                        className={`adam-list-item text-left ${program.id === activeProgramId ? "border-blue-500/40 bg-blue-500/10" : ""}`}
                        onClick={() => {
                          onProgramChange(program.id);
                          setShowPrograms(false);
                        }}
                      >
                        <div className="adam-row adam-space-between">
                          <div className="adam-stack" style={{ gap: 4 }}>
                            <span className="adam-title">{program.name}</span>
                            <span className="adam-micro adam-muted">{program.industry}</span>
                          </div>
                          <span className={`adam-badge ${program.readiness >= 75 ? "green" : program.readiness >= 45 ? "amber" : "red"}`}>
                            {program.readiness}%
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className="adam-button-ghost min-h-[36px]" onClick={() => onOpenChange(true)}>
              <CommandIcon className="h-4 w-4" />
              <span className="adam-micro">⌘K</span>
            </button>
            <span className={`adam-badge ${syncStatus === "synced" ? "green" : syncStatus === "syncing" ? "amber" : "red"}`}>
              <RefreshIcon className={`h-3.5 w-3.5 ${syncStatus === "syncing" ? "adam-pulse" : ""}`} />
              {syncStatus}
            </span>
            <button type="button" className="adam-button-ghost min-h-[36px] relative" onClick={() => onNavigate("decisions")}>
              <BellIcon className="h-4 w-4" />
              {unreadCount > 0 ? (
                <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                  {unreadCount}
                </span>
              ) : null}
            </button>
            <div className="relative">
              <button
                type="button"
                className="adam-button-ghost min-h-[36px]"
                onClick={() => setShowPersona((current) => !current)}
              >
                <UserIcon className="h-4 w-4" />
                <span className="capitalize">{persona}</span>
              </button>
              {showPersona ? (
                <div className="adam-sheet !top-[56px] !bottom-auto w-[220px] p-3">
                  <div className="adam-stack">
                    {PERSONAS.map((option) => (
              <button
                key={option}
                type="button"
                className={`adam-list-item text-left capitalize ${option === persona ? "border-blue-500/40 bg-blue-500/10" : ""}`}
                        onClick={() => {
                          onPersonaChange(option);
                          setShowPersona(false);
                        }}
                      >
                        {option}
                      </button>
              ))}
            </div>
          </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {open ? (
        <>
          <div className="adam-modal-scrim" onClick={() => onOpenChange(false)} />
          <div className="adam-modal p-4">
            <div className="adam-card p-4">
              <div className="adam-row">
                <SearchIcon className="h-4 w-4 text-slate-300" />
                <input
                  className="adam-input border-none bg-transparent p-0 text-base shadow-none"
                  placeholder="Search programs, workspaces, artifacts, decisions, agents..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
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
                          onOpenChange(false);
                        }}
                      >
                        <div className="adam-title">{item.title}</div>
                        <div className="adam-micro adam-muted">{item.subtitle}</div>
                      </button>
                    ))}
                    {!filteredItems.length ? (
                      <div className="adam-list-item adam-body adam-muted">No matches yet.</div>
                    ) : null}
                  </div>
                </div>
                <div className="adam-stack">
                  <div className="adam-micro adam-muted">Quick actions</div>
                  <div className="adam-list">
                    <button type="button" className="adam-list-item text-left" onClick={() => { onNavigate("home"); onOpenChange(false); }}>
                      <div className="adam-title">Open home</div>
                      <div className="adam-micro adam-muted">Return to the operating center.</div>
                    </button>
                    <button type="button" className="adam-list-item text-left" onClick={() => { onNavigate("twin"); onOpenChange(false); }}>
                      <div className="adam-title">Open Twin</div>
                      <div className="adam-micro adam-muted">Explore the transformation graph.</div>
                    </button>
                    <button type="button" className="adam-list-item text-left" onClick={() => { onNavigate("decisions"); onOpenChange(false); }}>
                      <div className="adam-title">Review decisions</div>
                      <div className="adam-micro adam-muted">Jump straight to the human-agent inbox.</div>
                    </button>
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
