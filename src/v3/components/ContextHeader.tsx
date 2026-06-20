import React from "react";
import { NumberCountUp } from "@/v3/components/ui/NumberCountUp";
import { RichTooltip } from "@/v3/components/ui/RichTooltip";
import type { V3CommandMode } from "@/v3/types";

interface ContextHeaderProps {
  programName: string;
  mode: V3CommandMode;
  phaseLabel?: string | null;
  activeTab?: string | null;
  onNavigateToProgram?: () => void;
  onNavigateToMode?: () => void;
  confidenceScore?: number | null;
  lastSavedAt?: number | null;
  onOpenCommandPalette?: () => void;
}

const MODE_LABELS: Record<V3CommandMode, string> = {
  delivery: "Deliver", governance: "Gates", oversight: "Monitor", portfolio: "Portfolio",
};

function RelativeTime({ ts }: { ts: number }) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  const text = diff < 10 ? "just now" : diff < 60 ? `${diff}s ago` : diff < 3600 ? `${Math.floor(diff / 60)}m ago` : `${Math.floor(diff / 3600)}h ago`;
  return <span>{text}</span>;
}

function ScorePill({ score }: { score: number }) {
  const color = score >= 80 ? "var(--v3-accent)" : score >= 60 ? "var(--v3-green)" : score >= 40 ? "var(--v3-amber)" : "var(--v3-red)";
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
      background: `color-mix(in srgb, ${color} 15%, transparent)`,
      color, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
    }}><NumberCountUp value={score} duration={400} /></span>
  );
}

/**
 * Render a label string, wrapping any occurrence of the word "Gate" with a
 * RichTooltip that explains what gates are.
 */
function LabelWithGateTooltip({ label }: { label: string }) {
  if (!label.includes("Gate")) {
    return <>{label}</>;
  }

  // Split on "Gate" and interleave tooltip-wrapped "Gate" between parts
  const parts = label.split("Gate");
  return (
    <>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <RichTooltip
              title="Gate"
              description="A phase gate is a quality checkpoint. Before moving to the next phase, an AI review confirms readiness. Approving the gate unlocks the next phase."
              side="bottom"
            >
              <span style={{ borderBottom: "1px dashed var(--v3-text-muted)", cursor: "help" }}>Gate</span>
            </RichTooltip>
          )}
        </React.Fragment>
      ))}
    </>
  );
}

export function ContextHeader({ programName, mode, phaseLabel, activeTab, onNavigateToProgram, onNavigateToMode, confidenceScore, lastSavedAt, onOpenCommandPalette }: ContextHeaderProps) {
  const sep = <span style={{ color: "var(--v3-text-muted)", margin: "0 6px", fontSize: 12 }}>›</span>;
  const segments = [
    { label: programName, onClick: onNavigateToProgram },
    { label: MODE_LABELS[mode], onClick: onNavigateToMode },
    phaseLabel ? { label: phaseLabel, onClick: undefined } : null,
    activeTab ? { label: activeTab, onClick: undefined } : null,
  ].filter(Boolean) as Array<{ label: string; onClick?: () => void }>;

  return (
    <div style={{
      height: 36, display: "flex", alignItems: "center", justifyContent: "space-between",
      background: "var(--v3-surface)", borderBottom: "1px solid var(--v3-border)",
      padding: "0 var(--v3-space-4)", flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        {segments.map((seg, i) => (
          <React.Fragment key={i}>
            {i > 0 && sep}
            {seg.onClick ? (
              <button onClick={seg.onClick} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--v3-text-secondary)", padding: 0, fontFamily: "var(--v3-font)" }}>
                <LabelWithGateTooltip label={seg.label} />
              </button>
            ) : (
              <span style={{ fontSize: 12, color: i === segments.length - 1 ? "var(--v3-text-primary)" : "var(--v3-text-secondary)", fontWeight: i === segments.length - 1 ? 500 : 400 }}>
                <LabelWithGateTooltip label={seg.label} />
              </span>
            )}
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {confidenceScore != null && <ScorePill score={confidenceScore} />}
        {lastSavedAt != null && <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>Saved <RelativeTime ts={lastSavedAt} /></span>}
        {onOpenCommandPalette != null && (
          <button
            type="button"
            onClick={onOpenCommandPalette}
            title="Command palette (⌘K)"
            style={{ fontSize: 11, color: "var(--v3-text-muted)", background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius)", padding: "3px 8px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--v3-font)" }}
          >
            <span>⌘K</span>
          </button>
        )}
      </div>
    </div>
  );
}
