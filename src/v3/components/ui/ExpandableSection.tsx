import React, { useId, useState } from "react";

interface ExpandableSectionProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function ExpandableSection({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}: ExpandableSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className={`v3-expandable ${open ? "open" : ""}`}>
      <button
        type="button"
        className="v3-expandable-toggle"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
      >
        <div className="v3-expandable-copy">
          <div className="v3-expandable-title-row">
            <span className="v3-expandable-title">{title}</span>
            {badge ? <span className="v3-expandable-badge">{badge}</span> : null}
          </div>
          {subtitle ? <div className="v3-expandable-subtitle">{subtitle}</div> : null}
        </div>
        <span className="v3-expandable-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div id={contentId} className="v3-expandable-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}
