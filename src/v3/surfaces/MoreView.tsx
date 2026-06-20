import React, { useMemo, useState } from "react";
import type { V3MoreView } from "@/v3/types";
import { AdamErrorBoundary } from "@/v3/components/AdamErrorBoundary";

// ---------------------------------------------------------------------------
// Workspace tile definitions
// ---------------------------------------------------------------------------

type WorkspaceTile = {
  view: V3MoreView;
  label: string;
  description: string;
  icon: string;
  accent?: "green" | "amber" | "red" | "blue" | "purple";
};

// ── Phase-aware workspace recommendations (Priority 6) ────────────────────────
// Maps each methodology phase to the workspaces most useful for that phase.
// Users are no longer expected to discover the right workspace manually.
// Phase-relevant areas — only references tiles that exist in WORKSPACE_GROUPS
const PHASE_RECOMMENDED_WORKSPACES: Record<string, V3MoreView[]> = {
  strategy:    ["documents"],
  mobilise:    ["stakeholders", "documents"],
  discover:    ["stakeholders", "change-impact", "documents"],
  design:      ["change-impact"],
  build:       ["budget", "scope-pcr"],
  operate:     ["change-impact", "budget"],
  govern:      ["decision-audit"],
  optimize:    ["budget"],
  valuerealize:["closure", "decision-audit"],
};

function getPhaseRecommendedTiles(phaseId: string | null): WorkspaceTile[] {
  if (!phaseId) return [];
  const recommended = PHASE_RECOMMENDED_WORKSPACES[phaseId] ?? [];
  return recommended
    .map((view) => WORKSPACE_GROUPS.flatMap((g) => g.tiles).find((t) => t.view === view))
    .filter((t): t is WorkspaceTile => Boolean(t));
}

const WORKSPACE_GROUPS: Array<{
  label: string;
  tiles: WorkspaceTile[];
}> = [
  {
    label: "Delivery",
    tiles: [
      // Risks/blockers live in the Action Center (DecideView); milestones and
      // critical-path are surfaced in-context (Programme Health / Plan), so their
      // standalone workspace tiles were removed to avoid duplicate entry points.
      { view: "budget", label: "Budget", description: "Budget tracking, forecasts and variance", icon: "◈", accent: "amber" },
      { view: "scope-pcr", label: "Scope Changes", description: "Scope baseline and change request log", icon: "◫", accent: "amber" },
    ],
  },
  {
    label: "People & Change",
    tiles: [
      // Stakeholders and Change Impact consolidated — separate views kept for depth
      { view: "stakeholders", label: "Stakeholders", description: "Stakeholder map, influence and engagement", icon: "◎", accent: "purple" },
      { view: "change-impact", label: "Change & Adoption", description: "Organisational change impact and adoption readiness", icon: "↺", accent: "amber" },
      // Removed: adoption (merged into change-impact description above — view still accessible)
    ],
  },
  {
    label: "Governance & Closure",
    tiles: [
      { view: "decision-audit", label: "Decision Audit", description: "Full decision audit trail and history", icon: "⊟", accent: "amber" },
      { view: "access", label: "Access & Sharing", description: "Invite collaborators and manage admin / editor / viewer roles", icon: "◐", accent: "blue" },
      { view: "closure", label: "Benefits & Closure", description: "Benefits realisation tracking, lessons learned, and programme closure pack", icon: "◈", accent: "green" },
      // Removed: Digital Twin, Retrospective, Pattern Library, Benchmarks (implementation details / low-frequency)
    ],
  },
  {
    label: "Documents & Reports",
    tiles: [
      { view: "documents", label: "Documents", description: "Uploaded documents and extracted insights", icon: "⊡", accent: "amber" },
      { view: "artifact-map", label: "Artifact Map", description: "The complete programme tree — every phase with its artifacts, inputs and provenance", icon: "⊞", accent: "blue" },
      // Removed: Programme Narrative, Action Plan (content surfaced on Home)
    ],
  },
];

// ---------------------------------------------------------------------------
// ATOS Marketplace accelerators (Brillio's pre-built packs)
// ---------------------------------------------------------------------------

type MarketplaceItem = {
  id: string;
  label: string;
  description: string;
  icon: string;
  category: string;
  isNew?: boolean;
};

const MARKETPLACE_ITEMS: MarketplaceItem[] = [
  { id: "risk-accelerator", label: "Risk Intelligence Pack", description: "Pre-configured RAID templates and risk heat-map agent for SAP and Oracle transformations", icon: "△", category: "Delivery", isNew: false },
  { id: "ocm-pack", label: "OCM Accelerator", description: "Organisational change management playbook with stakeholder impact matrices and readiness surveys", icon: "◎", category: "People", isNew: false },
  { id: "data-migration", label: "Data Migration Toolkit", description: "ETL validation rules, data quality scoring and cutover runbook templates", icon: "⇄", category: "Technical", isNew: true },
  { id: "erp-governance", label: "ERP Governance Framework", description: "Gate review criteria, steering committee packs and executive reporting for ERP programmes", icon: "⬡", category: "Governance", isNew: false },
  { id: "agile-delivery", label: "Agile Delivery Pack", description: "Sprint ceremonies, velocity tracking and scaled agile governance for hybrid delivery", icon: "↻", category: "Delivery", isNew: true },
  { id: "benefit-tracker", label: "Benefits Realisation Suite", description: "Benefit milestone framework, ROI modelling and value realisation dashboard templates", icon: "◈", category: "Executive", isNew: false },
];

const MARKETPLACE_STORAGE_KEY = "adam-marketplace-installed";

function useMarketplace() {
  const [installed, setInstalled] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(window.localStorage.getItem(MARKETPLACE_STORAGE_KEY) || "[]") as string[];
    } catch {
      return [];
    }
  });

  const toggle = (id: string) => {
    setInstalled((prev) => {
      const next = prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(MARKETPLACE_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  return { installed, toggle };
}

// ---------------------------------------------------------------------------
// WorkspaceTileCard
// ---------------------------------------------------------------------------

const ACCENT_COLORS: Record<string, string> = {
  green: "var(--v3-green)",
  amber: "var(--v3-amber)",
  red: "var(--v3-red)",
  blue: "var(--v3-accent)",
  purple: "#a78bfa",
};

function WorkspaceTileCard({ tile, onClick }: { tile: WorkspaceTile; onClick: () => void }) {
  const color = ACCENT_COLORS[tile.accent ?? "blue"] ?? "var(--v3-accent)";
  return (
    <button
      type="button"
      className="v3-workspace-tile"
      onClick={onClick}
      title={tile.label}
    >
      <span className="v3-workspace-tile-icon" style={{ color }}>{tile.icon}</span>
      <span className="v3-workspace-tile-label">{tile.label}</span>
      <span className="v3-workspace-tile-desc">{tile.description}</span>
      <span className="v3-workspace-tile-arrow">›</span>
    </button>
  );
}

function MarketplaceCard({ item, installed, onToggle }: { item: MarketplaceItem; installed: boolean; onToggle: () => void }) {
  return (
    <div className={`v3-marketplace-card${installed ? " is-installed" : ""}`}>
      <div className="v3-marketplace-card-icon">{item.icon}</div>
      <div className="v3-marketplace-card-body">
        <div className="v3-marketplace-card-header">
          <span className="v3-marketplace-card-label">{item.label}</span>
          {item.isNew ? <span className="v3-chip blue" style={{ fontSize: 10 }}>New</span> : null}
          <span className="v3-chip muted" style={{ fontSize: 10 }}>{item.category}</span>
        </div>
        <div className="v3-marketplace-card-desc">{item.description}</div>
      </div>
      <button
        type="button"
        className={`v3-marketplace-card-btn${installed ? " is-installed" : ""}`}
        onClick={onToggle}
      >
        {installed ? "Remove" : "Add"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MoreViewProps {
  currentView: V3MoreView | null;
  onSelectView: (view: V3MoreView | null) => void;
  renderView: () => React.ReactNode;
  /** Active phase ID — used to surface phase-relevant workspace recommendations. */
  activePhaseId?: string | null;
  /** Active phase display name — shown in the recommendation header. */
  activePhaseName?: string | null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MoreView({ currentView, onSelectView, renderView, activePhaseId, activePhaseName }: MoreViewProps) {
  const [search, setSearch] = useState("");
  const { installed, toggle } = useMarketplace();
  const phaseRecommendedTiles = useMemo(
    () => getPhaseRecommendedTiles(activePhaseId ?? null),
    [activePhaseId],
  );

  // Detail view mode — rendered in ProgramView/ProgramDetailRouter
  if (currentView) {
    return (
      <div className="v3-more-detail">
        <div className="v3-more-detail-header">
          <button
            className="v3-button ghost"
            style={{ fontSize: 12, padding: "4px 10px" }}
            onClick={() => onSelectView(null)}
          >
            ← All Areas
          </button>
        </div>
        <div className="v3-embedded-view">
          <AdamErrorBoundary context={{ surface: "more", view: currentView }}>{renderView()}</AdamErrorBoundary>
        </div>
      </div>
    );
  }

  const filtered = search.trim().toLowerCase();

  const visibleGroups = useMemo(
    () =>
      WORKSPACE_GROUPS.map((group) => ({
        ...group,
        tiles: filtered
          ? group.tiles.filter(
              (t) => t.label.toLowerCase().includes(filtered) || t.description.toLowerCase().includes(filtered),
            )
          : group.tiles,
      })).filter((g) => g.tiles.length > 0),
    [filtered],
  );

  const installedItems = MARKETPLACE_ITEMS.filter((item) => installed.includes(item.id));
  const marketplaceItems = filtered
    ? MARKETPLACE_ITEMS.filter((item) =>
        item.label.toLowerCase().includes(filtered) || item.description.toLowerCase().includes(filtered),
      )
    : MARKETPLACE_ITEMS;

  return (
    <div className="v3-section v3-workspaces-layout">
      {/* Header */}
      <div className="v3-workspaces-header">
        <div>
          <h1 className="v3-workspaces-title">More Areas</h1>
          <p className="v3-workspaces-subtitle">Additional delivery, governance, and document workspaces.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="v3-chip muted">
            {WORKSPACE_GROUPS.reduce((n, g) => n + g.tiles.length, 0)} areas
          </span>
        </div>
      </div>

      {/* Search */}
      <div style={{ position: "relative", maxWidth: 360 }}>
        <input
          className="v3-more-search"
          placeholder="Search areas…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--v3-text-muted)", fontSize: 16, lineHeight: 1 }}
          >
            ×
          </button>
        )}
      </div>

      {/* Empty search */}
      {search && visibleGroups.length === 0 && marketplaceItems.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--v3-text-muted)", fontSize: 13 }}>
          No areas match "<strong>{search}</strong>"
        </div>
      )}

      {/* Phase-aware recommendations (Priority 6) */}
      {!filtered && phaseRecommendedTiles.length > 0 && (
        <section className="v3-workspace-group">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <h2 className="v3-workspace-group-label" style={{ margin: 0 }}>
              Recommended for {activePhaseName ?? "this phase"}
            </h2>
            <span className="v3-chip blue" style={{ fontSize: 10 }}>Phase-relevant</span>
          </div>
          <p style={{ fontSize: 12, color: "var(--v3-text-muted)", marginBottom: 14, marginTop: -6 }}>
            These areas are most relevant to your active {activePhaseName ?? ""} phase work.
          </p>
          <div className="v3-workspace-tile-grid">
            {phaseRecommendedTiles.map((tile) => (
              <WorkspaceTileCard
                key={tile.view}
                tile={tile}
                onClick={() => onSelectView(tile.view)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Workspace tile groups */}
      {visibleGroups.map((group) => (
        <section key={group.label} className="v3-workspace-group">
          <h2 className="v3-workspace-group-label">{group.label}</h2>
          <div className="v3-workspace-tile-grid">
            {group.tiles.map((tile) => (
              <WorkspaceTileCard
                key={tile.view}
                tile={tile}
                onClick={() => onSelectView(tile.view)}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Installed accelerators — shown as tiles above marketplace */}
      {!filtered && installedItems.length > 0 ? (
        <section className="v3-workspace-group">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <h2 className="v3-workspace-group-label" style={{ margin: 0 }}>Your Accelerators</h2>
            <span className="v3-chip green" style={{ fontSize: 11 }}>{installedItems.length} installed</span>
          </div>
          <div className="v3-workspace-tile-grid">
            {installedItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="v3-workspace-tile v3-workspace-tile--accelerator"
                onClick={() => onSelectView("accelerators")}
              >
                <span className="v3-workspace-tile-icon" style={{ color: "var(--v3-green)" }}>{item.icon}</span>
                <span className="v3-workspace-tile-label">{item.label}</span>
                <span className="v3-workspace-tile-desc">{item.description}</span>
                <span className="v3-chip green" style={{ fontSize: 10, marginTop: "auto" }}>Installed</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* ATOS Marketplace */}
      {(!filtered || marketplaceItems.length > 0) ? (
        <section className="v3-workspace-group v3-marketplace-section">
          <div className="v3-marketplace-header">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <h2 className="v3-workspace-group-label" style={{ margin: 0 }}>ATOS Marketplace</h2>
                <span className="v3-chip blue" style={{ fontSize: 10 }}>Brillio Accelerators</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--v3-text-muted)", margin: 0 }}>
                Pre-built accelerator packs built by Brillio. Add packs to your programme to unlock templates, agents and frameworks.
              </p>
            </div>
          </div>
          <div className="v3-marketplace-list">
            {marketplaceItems.map((item) => (
              <MarketplaceCard
                key={item.id}
                item={item}
                installed={installed.includes(item.id)}
                onToggle={() => toggle(item.id)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
