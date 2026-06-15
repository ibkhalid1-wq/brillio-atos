import React, { useState, useEffect, useRef } from "react";
import {
  Home,
  Shield,
  Crown,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
  Sun,
  Moon,
  HelpCircle,
  LogOut,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Inbox,
  LayoutGrid,
} from "lucide-react";
import type { V3Surface } from "@/v3/types";
import { getConfidenceColor } from "@/v3/lib/confidenceScore";

// ─── Types ───────────────────────────────────────────────────────────────────

type ProgramEntry = { id: string; name: string };

type HealthSignal = "green" | "amber" | "red";

type ProgramHealth = {
  programme: HealthSignal;
  ai: HealthSignal;
  agents: HealthSignal;
};

type CommandRailProps = {
  activeSurface: V3Surface;
  moreView?: string | null;
  onNavigate: (surface: V3Surface) => void;
  programs?: ProgramEntry[];
  activeProgramId?: string | null;
  onSelectProgram?: (id: string) => void;
  programName: string;
  activePhaseLabel?: string | null;
  confidenceScore?: number | null;
  anyAgentRunning?: boolean;
  userInitial?: string | null;
  userEmail?: string | null;
  onOpenHelp?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenCopilot?: () => void;
  onOpenAISettings?: (tab?: string) => void;
  onOpenWorkspaces?: () => void;
  onSignOut?: () => void;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  pinned?: boolean;
  onTogglePinned?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onCreateProgram?: () => void;
  onDeleteProgram?: () => Promise<void> | void;
  programHealth?: ProgramHealth;
  openDecisionCount?: number;
};

// ─── Primary navigation ───────────────────────────────────────────────────────

const PRIMARY_NAV: Array<{
  id: string;
  surface: V3Surface;
  label: string;
  sublabel: string;
  Icon: React.FC<{ size?: number; strokeWidth?: number }>;
}> = [
  {
    id: "today",
    surface: "insight-feed",
    label: "Home",
    sublabel: "Daily operating briefing",
    Icon: Home,
  },
  {
    id: "action-center",
    surface: "decide",
    label: "Action Center",
    sublabel: "What needs you now",
    Icon: Inbox,
  },
  {
    id: "program",
    surface: "stage",
    label: "Programme",
    sublabel: "Where the work happens",
    Icon: Shield,
  },
  {
    id: "executive",
    surface: "executive",
    label: "Executive summary",
    sublabel: "Leadership view",
    Icon: Crown,
  },
];

function activeNavId(surface: V3Surface, moreView?: string | null): string {
  if (surface === "insight-feed") return "today";
  if (surface === "decide") return "action-center";
  if (surface === "stage" || surface === "pipeline" || surface === "programme-health") return "program";
  if (surface === "program") return moreView === "intelligence" ? "__ai" : "workspaces";
  // Executive summary is a primary rail item (below Programme); highlight it when active.
  if (surface === "executive") return "executive";
  return "today";
}

const PROGRAMME_SURFACES = new Set<V3Surface>(["insight-feed", "pipeline", "stage", "program", "programme-health", "decide"]);

// Delegate to the canonical confidence colour so the brand "% confidence"
// kicker never contradicts the Programme health dot on this same rail (e.g.
// 76% must read green/"On Track", not amber). Single source of truth lives in
// confidenceScore.ts — the 4-band model (≥80 accent, ≥60 green, ≥40 amber, red).
function scoreColor(score: number): string {
  return getConfidenceColor(score);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type RailItemProps = {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  active?: boolean;
  badge?: React.ReactNode;
  title?: string;
  onClick?: () => void;
};

function RailItem({ icon, label, sublabel, active = false, badge, title, onClick }: RailItemProps) {
  return (
    <button
      type="button"
      className={`v3-command-rail-item${active ? " active" : ""}`}
      onClick={onClick}
      title={title || label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
    >
      <span className="v3-command-rail-item-icon">
        {icon}
        {badge}
      </span>
      <span className="v3-command-rail-item-copy">
        <span className="v3-command-rail-item-label">{label}</span>
        {sublabel ? <span className="v3-command-rail-item-sub">{sublabel}</span> : null}
      </span>
    </button>
  );
}

function RailDivider() {
  return <div className="v3-command-rail-divider" role="separator" />;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CommandRail({
  activeSurface,
  moreView,
  onNavigate,
  programs = [],
  activeProgramId,
  onSelectProgram,
  programName,
  activePhaseLabel,
  confidenceScore,
  anyAgentRunning = false,
  userInitial,
  userEmail,
  onOpenHelp,
  onOpenCommandPalette,
  onOpenAISettings,
  onOpenWorkspaces,
  onSignOut,
  theme = "dark",
  onToggleTheme,
  pinned = false,
  onTogglePinned,
  collapsed = false,
  onToggleCollapse,
  onCreateProgram,
  onDeleteProgram,
  programHealth,
  openDecisionCount = 0,
}: CommandRailProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [programMenuOpen, setProgramMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deletingProgram, setDeletingProgram] = useState(false);
  const programMenuRef = useRef<HTMLDivElement>(null);

  // Close bottom menu when the rail collapses
  useEffect(() => {
    if (collapsed) setUserMenuOpen(false);
  }, [collapsed]);

  // Close programme menu when clicking outside
  useEffect(() => {
    if (!programMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (programMenuRef.current && !programMenuRef.current.contains(e.target as Node)) {
        setProgramMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [programMenuOpen]);

  const avatar = (programName || "?").trim().charAt(0).toUpperCase();
  const activeId = activeNavId(activeSurface, moreView);
  const aiSettingsActive = moreView === "intelligence";
  const workspacesActive = activeSurface === "program" && !aiSettingsActive;
  const showStatus = PROGRAMME_SURFACES.has(activeSurface) || moreView != null;
  const railNavigate = (surface: V3Surface) => {
    setUserMenuOpen(false);
    setProgramMenuOpen(false);
    onNavigate(surface);
  };
  const openBottomMenu = () => {
    setProgramMenuOpen(false);
    setUserMenuOpen((open) => !open);
  };

  return (
    <>
    <nav
      className={`v3-command-rail${pinned ? " is-pinned" : ""}${collapsed ? " is-collapsed" : ""}`}
      aria-label="Primary navigation"
    >
    {/* Panel is an inner overlay that expands visually without shifting the flex layout */}
    <div className="v3-command-rail-panel">
      {/* ── Brillio logo ── */}
      <div className="v3-command-rail-brillio-logo" title="Brillio ATOS · Agentic Transformation OS">
        {/* Collapsed: small B mark, always visible when rail is narrow */}
        <span className="v3-command-rail-brillio-mark" aria-hidden="true">B</span>
        {/* Expanded: full wordmark + badge */}
        <svg className="v3-command-rail-brillio-wordmark" viewBox="0 0 80 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Brillio">
          <text x="0" y="15" fontFamily="'Inter', sans-serif" fontWeight="700" fontSize="14" letterSpacing="0.5" fill="currentColor">brillio</text>
        </svg>
        <span className="v3-command-rail-brillio-badge">ATOS</span>
      </div>

      {/* ── Programme identity + portfolio switcher ── */}
      {/* brand-wrap is the positioning parent for both the chevron and the dropdown */}
      <div className="v3-command-rail-brand-wrap" ref={programMenuRef}>
        <button
          type="button"
          className="v3-command-rail-brand"
          onClick={() => railNavigate("insight-feed")}
          title={`${programName} — go to overview`}
          aria-label={`${programName}: go to overview`}
        >
          <span className="v3-command-rail-brand-mark">{avatar}</span>
          <span className="v3-command-rail-brand-copy">
            <span className="v3-command-rail-brand-eyebrow">Programme</span>
            <span className="v3-command-rail-brand-name">{programName}</span>
            <span className="v3-command-rail-brand-kicker">
              {confidenceScore != null ? (
                <span style={{ color: scoreColor(confidenceScore) }}>
                  {confidenceScore}% confidence
                </span>
              ) : (
                "ATOS · Agentic Transformation"
              )}
            </span>
          </span>
        </button>

        {/* Chevron button — always visible in brand-actions */}
        <div className="v3-command-rail-brand-actions">
          <button
            type="button"
            className="v3-command-rail-portfolio-toggle"
            onClick={() => { setUserMenuOpen(false); setProgramMenuOpen((o) => !o); }}
            title="Programme menu"
            aria-label="Programme menu"
            aria-expanded={programMenuOpen}
          >
            {programMenuOpen ? <ChevronUp size={14} strokeWidth={2.5} /> : <ChevronDown size={14} strokeWidth={2.5} />}
          </button>
        </div>

        {/* Dropdown — sibling of brand-actions, anchored to brand-wrap, never inside brand-actions */}
        {programMenuOpen ? (
          // File-style Program menu: Open · Recent · New · Settings · Delete.
          // Portfolio lives here (not in primary navigation).
          <div className="v3-command-rail-program-menu" role="menu">
            {/* ── Open ── */}
            <div className="v3-command-rail-program-menu-section-label">Open</div>
            <button type="button" role="menuitem" className="v3-command-rail-program-menu-item"
              onClick={() => { setProgramMenuOpen(false); railNavigate("portfolio"); }}>
              <LayoutGrid size={12} strokeWidth={2} />
              <span>Portfolio overview</span>
            </button>

            {/* ── Recent programmes ── */}
            {programs.length > 1 && onSelectProgram ? (
              <>
                <div className="v3-command-rail-program-menu-divider" />
                <div className="v3-command-rail-program-menu-section-label">Recent programmes</div>
                {programs.slice(0, 5).map((prog) => (
                  <button
                    key={prog.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={prog.id === activeProgramId}
                    className={`v3-command-rail-program-menu-item${prog.id === activeProgramId ? " is-active" : ""}`}
                    onClick={() => { setProgramMenuOpen(false); onSelectProgram(prog.id); }}
                  >
                    <span style={{
                      width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                      background: prog.id === activeProgramId ? "var(--v3-accent)" : "rgba(255,255,255,0.1)",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 700, color: "#fff",
                    }}>
                      {(prog.name || "?").charAt(0).toUpperCase()}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {prog.name}
                    </span>
                    {prog.id === activeProgramId ? <span style={{ fontSize: 10, opacity: 0.7 }}>✓</span> : null}
                  </button>
                ))}
              </>
            ) : null}

            <div className="v3-command-rail-program-menu-divider" />

            {/* ── Programme actions ── */}
            {onCreateProgram ? (
              <button type="button" role="menuitem" className="v3-command-rail-program-menu-item"
                onClick={() => { setProgramMenuOpen(false); onCreateProgram(); }}>
                <Plus size={12} strokeWidth={2} />
                <span>New programme</span>
              </button>
            ) : null}
            {onOpenAISettings ? (
              <button type="button" role="menuitem" className="v3-command-rail-program-menu-item"
                onClick={() => { setProgramMenuOpen(false); onOpenAISettings(); }}>
                <SlidersHorizontal size={12} strokeWidth={2} />
                <span>Settings</span>
              </button>
            ) : null}
            {onDeleteProgram ? (
              <button type="button" role="menuitem" className="v3-command-rail-program-menu-item danger"
                onClick={() => { setProgramMenuOpen(false); setConfirmDeleteOpen(true); }}>
                <Trash2 size={12} strokeWidth={2} />
                <span>Delete programme</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── Current phase — pinned to the top, above primary nav ── */}
      {activeSurface === "stage" && activePhaseLabel ? (
        <>
          <div className="v3-command-rail-section-label v3-command-rail-phase-label">Current phase</div>
          <div className="v3-command-rail-status-row v3-command-rail-phase-top" title={`Active phase: ${activePhaseLabel}`}>
            <span className="v3-command-rail-phase-indicator" />
            <span className="v3-command-rail-status-label">{activePhaseLabel}</span>
          </div>
          <RailDivider />
        </>
      ) : null}

      {/* ── Primary navigation: Home · Action Center · Program ── */}
      <div className="v3-command-rail-modes" role="list">
        {PRIMARY_NAV.map((item) => {
          const active = item.id === activeId;
          const isActionCenter = item.id === "action-center";
          const sublabel = isActionCenter && openDecisionCount > 0
            ? `${openDecisionCount} awaiting you`
            : item.sublabel;
          return (
            <RailItem
              key={item.id}
              icon={<item.Icon size={16} strokeWidth={active ? 2.25 : 1.7} />}
              label={item.label}
              sublabel={sublabel}
              active={active}
              title={item.label}
              onClick={() => railNavigate(item.surface)}
              badge={
                isActionCenter && openDecisionCount > 0 ? (
                  <span className="v3-command-rail-badge v3-command-rail-badge--decision">
                    {openDecisionCount > 9 ? "9+" : openDecisionCount}
                  </span>
                ) : undefined
              }
            />
          );
        })}
      </div>

      {/* ── Agent activity ── */}
      {showStatus ? (
        <>
          <RailDivider />
          <div
            className={`v3-command-rail-status-row v3-agent-running-row ${anyAgentRunning ? "is-running" : "is-stopped"}`}
            title={anyAgentRunning ? "Agents analysing programme data" : "Agents stopped — no agent running"}
          >
            <span className={`v3-radar-spinner ${anyAgentRunning ? "" : "is-stopped"}`} aria-hidden="true" />
            <span className="v3-command-rail-status-label v3-agent-running-label">
              {anyAgentRunning ? "Agents running" : "Agents stopped"}
            </span>
          </div>
        </>
      ) : null}

      {/* ── Health ── */}
      {programHealth ? (
        <>
          <RailDivider />
          <div className="v3-command-rail-section-label">Health</div>
          <div className="v3-command-rail-health-card">
            {(["programme", "ai", "agents"] as const).map((key) => {
              const sig = programHealth[key];
              const label = key === "ai" ? "AI" : key === "programme" ? "Programme" : "Intelligence";
              const badge = sig === "green" ? "OK" : sig === "amber" ? "Warn" : "Alert";
              const handleClick =
                key === "programme"
                  ? () => railNavigate("stage")
                  : key === "agents"
                  ? () => { setUserMenuOpen(false); setProgramMenuOpen(false); onOpenAISettings?.("Status"); }
                  : () => { setUserMenuOpen(false); setProgramMenuOpen(false); onOpenAISettings?.("Setup"); };
                  // Programme → health view; Agents → AI Settings Status tab; AI → AI Settings Setup tab
              return (
                <button
                  key={key}
                  type="button"
                  className={`v3-health-row v3-health-row--clickable v3-health-row--${sig}`}
                  onClick={handleClick}
                  title={
                    key === "programme"
                      ? `Programme — ${badge} · View health`
                      : key === "ai"
                      ? `AI — ${badge} · Open AI Settings`
                      : `Intelligence — ${badge} · Open AI Settings & Status`
                  }
                >
                  <span className="v3-health-label">{label}</span>
                  <span className={`v3-health-dot v3-health-dot--${sig}`} />
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {/* ── More (overflow areas) ── */}
      <RailDivider />
      <div className="v3-command-rail-tools">
        <RailItem
          icon={<MoreHorizontal size={15} strokeWidth={workspacesActive ? 2.25 : 1.8} />}
          label="More"
          sublabel="Risks, budget, documents & more"
          title="All programme areas"
          active={workspacesActive}
          onClick={() => {
            setProgramMenuOpen(false);
            setUserMenuOpen(false);
            (onOpenWorkspaces ?? (() => onNavigate("program")))();
          }}
        />
      </div>

      {/* ── Spacer — pushes menu to bottom ── */}
      <div className="v3-command-rail-spacer" />

      {/* ── Bottom menu ── */}
      <RailDivider />
      <div className="v3-command-rail-user-wrap" style={{ position: "relative" }}>
        <button
          type="button"
          className="v3-command-rail-usercard v3-command-rail-menu-button"
          onClick={openBottomMenu}
          title="Menu"
          aria-label="Open rail menu"
          aria-expanded={userMenuOpen}
        >
          <span className="v3-command-rail-usericon">
            <MoreHorizontal size={16} strokeWidth={1.9} />
          </span>
          <span className="v3-command-rail-item-copy">
            <span className="v3-command-rail-item-label">Menu</span>
            <span className="v3-command-rail-item-sub">{userEmail ? userEmail.split("@")[0] : "Account, settings, theme"}</span>
          </span>
        </button>

        {userMenuOpen ? (
          <div className="v3-command-rail-user-menu" role="menu">
            {userEmail ? (
              <div className="v3-command-rail-user-menu-email">
                <span className="v3-command-rail-user-menu-avatar">{userInitial || userEmail[0]?.toUpperCase()}</span>
                <span>{userEmail}</span>
              </div>
            ) : null}

            {onOpenCommandPalette ? (
              <button type="button" role="menuitem" className="v3-command-rail-user-menu-item" onClick={() => { setUserMenuOpen(false); onOpenCommandPalette(); }}>
                <span style={{ width: 13, textAlign: "center" }}>⌘</span>
                <span>Command search</span>
              </button>
            ) : null}

            <button type="button" role="menuitem" className="v3-command-rail-user-menu-item" onClick={() => { setUserMenuOpen(false); onOpenAISettings?.(); }}>
              <SlidersHorizontal size={13} strokeWidth={1.8} />
              <span>AI Settings</span>
            </button>

            <button type="button" role="menuitem" className="v3-command-rail-user-menu-item" onClick={() => { setUserMenuOpen(false); onToggleTheme?.(); }}>
              {theme === "dark" ? <Sun size={13} strokeWidth={1.8} /> : <Moon size={13} strokeWidth={1.8} />}
              <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
            </button>

            <button type="button" role="menuitem" className="v3-command-rail-user-menu-item" onClick={() => { setUserMenuOpen(false); onOpenHelp?.(); }}>
              <HelpCircle size={13} strokeWidth={1.8} />
              <span>Help & guide</span>
            </button>

            {onTogglePinned ? (
              <button type="button" role="menuitem" className="v3-command-rail-user-menu-item" onClick={() => { setUserMenuOpen(false); onTogglePinned(); }}>
                {pinned ? <PanelLeftClose size={13} strokeWidth={1.8} /> : <PanelLeftOpen size={13} strokeWidth={1.8} />}
                <span>{pinned ? "Collapse rail" : "Pin rail open"}</span>
              </button>
            ) : null}

            {onSignOut ? (
              <>
                <div className="v3-command-rail-user-menu-divider" />
                <button type="button" role="menuitem" className="v3-command-rail-user-menu-item danger" onClick={() => { setUserMenuOpen(false); onSignOut(); }}>
                  <LogOut size={13} strokeWidth={1.8} />
                  <span>Sign out</span>
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>{/* end v3-command-rail-panel */}
    </nav>

    {/* ── Delete programme confirmation overlay ── */}
    {confirmDeleteOpen && onDeleteProgram && (
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
        onClick={() => { if (!deletingProgram) { setConfirmDeleteOpen(false); } }}
      >
        <div
          style={{
            background: "var(--v3-surface)", border: "1px solid var(--v3-border)",
            borderRadius: 16, padding: "28px 28px 24px", maxWidth: 380, width: "90%",
            boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--v3-text-primary)", marginBottom: 8, fontFamily: "var(--v3-font)" }}>
            Delete programme?
          </div>
          <div style={{ fontSize: 13, color: "var(--v3-text-muted)", lineHeight: 1.6, marginBottom: 20, fontFamily: "var(--v3-font)" }}>
            {programName ? <>This will permanently delete <strong style={{ color: "var(--v3-text-primary)" }}>{programName}</strong> and all associated data.</> : "This will permanently delete the programme and all associated data."} This cannot be undone.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="v3-button ghost"
              style={{ fontSize: 13 }}
              disabled={deletingProgram}
              onClick={() => setConfirmDeleteOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="v3-button"
              style={{ fontSize: 13, background: "var(--v3-red)", color: "#fff", border: "none", opacity: deletingProgram ? 0.6 : 1 }}
              disabled={deletingProgram}
              onClick={async () => {
                setDeletingProgram(true);
                try {
                  await onDeleteProgram();
                  setConfirmDeleteOpen(false);
                } catch {
                  // Error handled upstream — reset spinner so dialog is not stuck
                } finally {
                  setDeletingProgram(false);
                }
              }}
            >
              {deletingProgram ? "Deleting…" : "Delete programme"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
