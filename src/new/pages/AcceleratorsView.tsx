import React from "react";
import { EmptyState } from "@/new/components/ui/EmptyState";
import type { AppView, ProgramSummary } from "@/new/types";

interface AcceleratorsViewProps {
  program: ProgramSummary | null;
  onNavigate?: (view: AppView) => void;
  patternsCount?: number;
  onExtractPatterns?: () => Promise<void>;
}

const BRILLIO_ACCELERATORS: Array<{
  id: string;
  title: string;
  category: string;
  description: string;
  chips: string[];
  view: AppView;
  actionLabel: string;
}> = [
  {
    id: "plan-studio",
    title: "Transformation Plan Studio",
    category: "Delivery",
    description: "Phase-by-phase actions, milestones, and bottleneck visibility packaged into a ready-to-run delivery planning workspace.",
    chips: ["Plan", "Milestones", "Critical path"],
    view: "plan",
    actionLabel: "Open plan",
  },
  {
    id: "risk-controls",
    title: "Risk & Controls Radar",
    category: "Governance",
    description: "A reusable operating pack for RAID capture, control posture, gate readiness, and intervention sequencing across active phases.",
    chips: ["Risks", "RAID", "Gate review"],
    view: "risks",
    actionLabel: "Open risks",
  },
  {
    id: "change-adoption",
    title: "Change & Adoption Pack",
    category: "People",
    description: "Stakeholder mapping, change impact assessment, and adoption tracking bundled into one coordinated transformation accelerator.",
    chips: ["Stakeholders", "Change impact", "Adoption"],
    view: "change-impact",
    actionLabel: "Open change pack",
  },
  {
    id: "scenario-twin",
    title: "Scenario & Twin Suite",
    category: "Intelligence",
    description: "A premium analysis accelerator that combines twin signals, pattern context, and scenario planning for executive decision support.",
    chips: ["Twin", "Patterns", "Scenario planning"],
    view: "intelligence",
    actionLabel: "Open twin",
  },
];

export function AcceleratorsView({ program, onNavigate, patternsCount, onExtractPatterns }: AcceleratorsViewProps) {
  if (!program) {
    return (
      <EmptyState
        context="No accelerator context yet"
        explanation="Accelerators become useful once a live program is available and ATOS can relate patterns, plans, and reusable playbooks to it."
        recommendation="Choose a program first, then reopen Accelerators."
      />
    );
  }

  return (
    <div className="adam-stack">
      <div className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="adam-heading-lg">Accelerators</div>
            <div className="mt-2 adam-body adam-muted">
              Reusable packs, patterns, and proven delivery assets are now surfaced through the new ATOS shell instead of the legacy marketplace.
            </div>
          </div>
          <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="adam-badge blue">{patternsCount ?? program.patternExtractCount} extracted</span>
            <span className="adam-badge slate">{program.patternQueryCache.length} cached patterns</span>
          </div>
        </div>
      </div>

      <div className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-heading-lg">Brillio ATOS Accelerators</div>
            <div className="adam-body adam-muted">
              Curated marketplace packs that bundle Brillio delivery methods, agent outputs, and reusable transformation playbooks into focused execution experiences.
            </div>
          </div>
          <span className="adam-badge blue">{BRILLIO_ACCELERATORS.length} curated packs</span>
        </div>

        <div className="adam-grid two" style={{ marginTop: 18 }}>
          {BRILLIO_ACCELERATORS.map((accelerator) => (
            <div key={accelerator.id} className="adam-card p-5" style={{ background: "rgba(15,23,42,0.28)" }}>
              <div className="adam-row adam-space-between" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div className="adam-stack" style={{ gap: 6 }}>
                  <span className="adam-badge slate">{accelerator.category}</span>
                  <div className="adam-title">{accelerator.title}</div>
                </div>
                <span className="adam-badge green">Included</span>
              </div>

              <div className="mt-3 adam-body adam-muted">
                {accelerator.description}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {accelerator.chips.map((chip) => (
                  <span key={chip} className="adam-chip">
                    {chip}
                  </span>
                ))}
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  className="adam-button-ghost"
                  onClick={() => onNavigate?.(accelerator.view)}
                >
                  {accelerator.actionLabel}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="adam-grid two">
        <div className="adam-card adam-stack p-5">
          <div className="adam-title">Organisation patterns</div>
          <div className="adam-body adam-muted">
            Pattern extraction runs after closure and gate approvals, so ATOS can turn what worked here into reusable accelerators for the next program.
          </div>
          <div className="adam-list">
            <div className="adam-list-item">
              <div className="adam-title">Pattern library</div>
              <div className="adam-micro adam-muted">Browse extracted risk, intervention, milestone, adoption, and gate criteria patterns.</div>
            </div>
            <div className="adam-list-item">
              <div className="adam-title">Recent extraction</div>
              <div className="adam-micro adam-muted">
                {program.patternExtractGeneratedAt
                  ? `Last extracted ${new Date(program.patternExtractGeneratedAt).toLocaleString()}.`
                  : "No extraction has been captured for this program yet."}
              </div>
            </div>
          </div>
          <button type="button" className="adam-button-ghost" onClick={() => onNavigate?.("intelligence")}>
            Open Intelligence
          </button>
          {onExtractPatterns ? (
            <button type="button" className="adam-button-ghost" onClick={() => void onExtractPatterns()}>
              Extract patterns
            </button>
          ) : null}
        </div>

        <div className="adam-card adam-stack p-5">
          <div className="adam-title">Program-ready packs</div>
          <div className="adam-body adam-muted">
            The new shell consolidates reusable delivery content into the views teams already work from, so accelerators are tied directly to decisions and artifacts.
          </div>
          <div className="adam-list">
            <div className="adam-list-item">
              <div className="adam-title">Transformation plan</div>
              <div className="adam-micro adam-muted">Use the full plan, milestone, and critical-path views as the primary delivery accelerator surface.</div>
            </div>
            <div className="adam-list-item">
              <div className="adam-title">Executive outputs</div>
              <div className="adam-micro adam-muted">Narrative, deck, closure, and scope views now hold the reusable sponsor-ready material.</div>
            </div>
            <div className="adam-list-item">
              <div className="adam-title">Change and adoption</div>
              <div className="adam-micro adam-muted">Change Impact, Stakeholders, and Adoption provide the intervention packs that used to live in parallel rails.</div>
            </div>
          </div>
          <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="adam-button-ghost" onClick={() => onNavigate?.("plan")}>
              Open Plan
            </button>
            <button type="button" className="adam-button-ghost" onClick={() => onNavigate?.("deck")}>
              Open Deck
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
