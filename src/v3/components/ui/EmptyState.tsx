import React from "react";

const ILLUSTRATIONS: Record<string, React.ReactNode> = {
  artifacts: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect x="8" y="6" width="32" height="36" rx="4" fill="var(--v3-surface-3)" stroke="var(--v3-border)" strokeWidth="1.5"/>
      <rect x="14" y="14" width="14" height="2" rx="1" fill="var(--v3-accent)" opacity="0.6"/>
      <rect x="14" y="19" width="20" height="1.5" rx="0.75" fill="var(--v3-border)"/>
      <rect x="14" y="23" width="18" height="1.5" rx="0.75" fill="var(--v3-border)"/>
      <rect x="14" y="27" width="15" height="1.5" rx="0.75" fill="var(--v3-border)"/>
      <circle cx="36" cy="36" r="8" fill="var(--v3-surface-2)" stroke="var(--v3-accent)" strokeWidth="1.5"/>
      <path d="M33 36h6M36 33v6" stroke="var(--v3-accent)" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  decisions: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="16" fill="var(--v3-surface-3)" stroke="var(--v3-border)" strokeWidth="1.5"/>
      <path d="M17 24l5 5 9-10" stroke="var(--v3-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  gates: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect x="10" y="8" width="28" height="32" rx="4" fill="var(--v3-surface-3)" stroke="var(--v3-border)" strokeWidth="1.5"/>
      <rect x="18" y="8" width="12" height="32" fill="var(--v3-surface-2)" stroke="var(--v3-border)" strokeWidth="1"/>
      <circle cx="24" cy="24" r="3" fill="var(--v3-accent)"/>
    </svg>
  ),
  agents: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="14" fill="var(--v3-surface-3)" stroke="var(--v3-border)" strokeWidth="1.5"/>
      <circle cx="24" cy="24" r="6" fill="var(--v3-accent-soft)" stroke="var(--v3-accent)" strokeWidth="1.5"/>
      <path d="M24 10v4M24 34v4M10 24h4M34 24h4" stroke="var(--v3-border)" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="24" cy="24" r="2" fill="var(--v3-accent)"/>
    </svg>
  ),
  default: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect x="8" y="8" width="32" height="32" rx="8" fill="var(--v3-surface-3)" stroke="var(--v3-border)" strokeWidth="1.5"/>
      <path d="M20 24h8M24 20v8" stroke="var(--v3-text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
};

type EmptyStateAction = {
  label: string;
  onClick: () => void;
  loading?: boolean;
};

interface EmptyStateProps {
  icon?: string;
  illustration?: "artifacts" | "decisions" | "gates" | "agents" | "default";
  title: string;
  description: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  compact?: boolean;
}

export function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
}: EmptyStateProps) {
  const iconContent = illustration
    ? ILLUSTRATIONS[illustration]
    : icon
    ? icon
    : ILLUSTRATIONS["default"];

  return (
    <div className={`v3-empty ${compact ? "compact" : ""}`}>
      <div
        className="v3-empty-icon"
        aria-hidden="true"
        style={{ fontSize: 36, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.7 }}
      >
        {iconContent}
      </div>
      <div className="v3-empty-title">{title}</div>
      <div className="v3-empty-body">{description}</div>
      {action ? (
        <button
          type="button"
          className="v3-button primary"
          style={{ fontSize: compact ? 12 : 13, marginTop: compact ? 12 : 16 }}
          disabled={action.loading}
          onClick={action.onClick}
        >
          {action.loading ? "Working…" : action.label}
        </button>
      ) : null}
      {secondaryAction ? (
        <button
          type="button"
          className="v3-button ghost"
          style={{ fontSize: 12, marginTop: 8 }}
          disabled={secondaryAction.loading}
          onClick={secondaryAction.onClick}
        >
          {secondaryAction.loading ? "Working…" : secondaryAction.label}
        </button>
      ) : null}
    </div>
  );
}
